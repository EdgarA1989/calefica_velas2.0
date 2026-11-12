const BRAND_CONFIG = {
  whatsappNumber: (typeof window !== "undefined" && window.CALEFICA_CONFIG?.whatsappNumber) || "549XXXXXXXXXX",
  instagramUrl: "https://www.instagram.com/",
  email: "hola@calefica.com",
};

const DEFAULT_WHATSAPP_NUMBER = BRAND_CONFIG.whatsappNumber;
const PLACEHOLDER_IMAGE = "";
const CART_STORAGE_KEY = "calefica_cart_v1";

let products = [];

let categories = [{ id: "todos", label: "Todos" }];
let providerCategories = [];
let catalogRequest = null;
let activeCategory = "todos";
let currentSlide = 0;
let mobileCatalogPage = 0;
let quantities = new Map(products.map(product => [product.id, 1]));
let activeModalProductId = null;
let activeModalAromaId = "";
let modalHistoryActive = false;
let modalScrollY = 0;
const MOBILE_CATALOG_PAGE_SIZE = 4;

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initMenu();
  initHomeLinks();
  initContactLinks();
  initCatalog();
  window.addEventListener("focus", () => loadProductsFromApi());
  window.setInterval(() => { if (!document.hidden) loadProductsFromApi(); }, 600000);
  initCarouselControls();
  initMobileCatalogControls();
  initTrackDrag();
  initProductModal();
  initContactForm();
  initReveal();
  initCart();
  document.getElementById("year").textContent = new Date().getFullYear();
});

function initTheme() {
  const toggle = document.getElementById("theme-toggle");
  const savedTheme = localStorage.getItem("calefica-theme") || "light";
  applyTheme(savedTheme);

  toggle?.addEventListener("click", () => {
    const nextTheme = document.body.classList.contains("dark") ? "light" : "dark";
    const animationClass = nextTheme === "dark" ? "is-blowing" : "is-lighting";
    const applyDelay = nextTheme === "dark" ? 650 : 120;

    toggle.classList.remove("is-blowing", "is-lighting");
    toggle.classList.add(animationClass);

    window.setTimeout(() => {
      localStorage.setItem("calefica-theme", nextTheme);
      applyTheme(nextTheme);
    }, applyDelay);

    window.setTimeout(() => {
      toggle.classList.remove(animationClass);
    }, 1050);
  });

  function applyTheme(theme) {
    const isDark = theme === "dark";
    document.body.classList.toggle("dark", isDark);
    toggle?.setAttribute("aria-pressed", String(isDark));
    toggle?.setAttribute("aria-label", isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro");
  }
}

function initMenu() {
  const toggle = document.getElementById("menu-toggle");
  const panel = document.getElementById("nav-panel");
  if (!toggle || !panel) return;

  const closeMenu = () => {
    panel.classList.remove("is-open");
    toggle.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    document.body.classList.remove("menu-open");
  };

  toggle.addEventListener("click", () => {
    const isOpen = panel.classList.toggle("is-open");
    toggle.classList.toggle("is-open", isOpen);
    toggle.setAttribute("aria-expanded", String(isOpen));
    document.body.classList.toggle("menu-open", isOpen);
  });

  panel.querySelectorAll("a").forEach(link => {
    link.addEventListener("click", closeMenu);
  });
}

function initHomeLinks() {
  const closeMenu = () => {
    document.getElementById("nav-panel")?.classList.remove("is-open");
    document.getElementById("menu-toggle")?.classList.remove("is-open");
    document.getElementById("menu-toggle")?.setAttribute("aria-expanded", "false");
    document.body.classList.remove("menu-open");
  };

  document.querySelectorAll('a[href="#inicio"]').forEach(link => {
    link.addEventListener("click", event => {
      event.preventDefault();
      closeMenu();
      history.replaceState(null, "", "#inicio");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

function initContactLinks() {
  const message = "Hola, quiero consultar por las velas de soja artesanales.";
  const whatsappUrl = getWhatsappUrl(message);
  document.getElementById("hero-whatsapp").href = whatsappUrl;
  document.getElementById("contact-whatsapp").href = whatsappUrl;
  document.getElementById("instagram-link").href = BRAND_CONFIG.instagramUrl;
  document.getElementById("email-link").href = `mailto:${BRAND_CONFIG.email}`;
}

function initCatalog() {
  renderCatalogState("loading");
  loadProductsFromApi();
}

async function loadProductsFromApi() {
  if (catalogRequest) return catalogRequest;

  catalogRequest = (async () => { try {
    const data = await window.CaleficaProductsService.loadCatalog();
    if (!data.ok || !Array.isArray(data.productos)) {
      throw new Error(data.error || "La respuesta del catalogo no es valida.");
    }

    providerCategories = data.categorias || [];
    if (data.settings) {
      if (data.settings.whatsapp_number) BRAND_CONFIG.whatsappNumber = data.settings.whatsapp_number;
      if (data.settings.instagram_url) BRAND_CONFIG.instagramUrl = data.settings.instagram_url;
      if (data.settings.contact_email) BRAND_CONFIG.email = data.settings.contact_email;
      initContactLinks();
    }
    const normalizedProducts = data.productos.map(normalizeProduct);
    refreshCatalogData(normalizedProducts);
    renderCategories();
    renderProducts();
  } catch (error) {
    console.error(error);

    products = [];
    refreshCatalogData(products);
    renderCategories();
    renderCatalogState("error");
  } finally { catalogRequest = null; } })();
  return catalogRequest;
}

function refreshCatalogData(nextProducts) {
  products = nextProducts
    .filter(product => product.activo !== false)
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
  quantities = new Map(products.map(product => [product.id, quantities.get(product.id) || 1]));
  categories = buildCategories(products);
  if (!categories.some(category => category.id === activeCategory)) {
    activeCategory = "todos";
  }
  currentSlide = 0;
  syncCartWithProducts(products);
}

function buildCategories(productList) {
  return [{ id: "todos", label: "Todos" }, ...providerCategories
    .filter(category => category.show_when_empty || productList.some(product => product.categoriaId === category.slug))
    .map(category => ({ id: category.slug, label: category.name }))];
}

function normalizeProduct(product) {
  const rawCategory = product.categoria || "Sin categoria";
  const aromas = normalizeAromas(Array.isArray(product.aromas) ? product.aromas : product.aroma);
  const stock = normalizeYesNo(product.stock, "SI");
  const destacado = normalizeYesNo(product.destacado, "NO");
  return {
    id: String(product.id || slugify(product.nombre || `producto-${Date.now()}`)).trim(),
    activo: normalizeYesNo(product.activo, "SI") === "SI",
    orden: Number.isFinite(Number(product.orden)) ? Number(product.orden) : 9999,
    categoria: rawCategory,
    categoriaId: product.categoriaId || slugify(rawCategory),
    nombre: product.nombre || "Producto sin nombre",
    descripcion: product.descripcion || "Producto artesanal de Calefica.",
    aroma: aromas.map(aroma => aroma.nombre).join(", "),
    aromas,
    precio: Number(product.precio) || 0,
    nombreImagen: product.nombreImagen || "",
    imagen: product.imagenUrl || product.imagen || "",
    whatsapp: product.whatsapp || BRAND_CONFIG.whatsappNumber,
    stock,
    cantidadStock: String(product.cantidadStock || "").trim(),
    destacado,
  };
}

function normalizeYesNo(value, fallback = "NO") {
  return normalizeSiNo(value, fallback);
}

function normalizeSiNo(value, fallback = "NO") {
  const text = String(value == null ? fallback : value)
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
  return text === "SI" || text === "YES" || text === "TRUE" ? "SI" : "NO";
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "categoria";
}

function renderCategories() {
  const list = document.getElementById("category-list");
  if (!list) return;

  list.innerHTML = categories.map(category => `
    <button class="category-btn${category.id === activeCategory ? " is-active" : ""}" type="button" data-category="${escapeHtml(category.id)}">
      ${escapeHtml(category.label)}
    </button>
  `).join("");

  list.querySelectorAll("[data-category]").forEach(button => {
    button.addEventListener("click", () => {
      activeCategory = button.dataset.category;
      currentSlide = 0;
      mobileCatalogPage = 0;
      renderCategories();
      renderProducts();
    });
  });
}

function renderProducts() {
  const track = document.getElementById("products-track");
  const title = document.getElementById("catalog-title");
  const count = document.getElementById("catalog-count");
  const dots = document.getElementById("carousel-dots");
  if (!track || !title || !count || !dots) return;

  const category = categories.find(item => item.id === activeCategory);
  const visibleProducts = activeCategory === "todos"
    ? products
    : products.filter(product => product.categoriaId === activeCategory);

  title.textContent = category?.label || "Catalogo";
  count.textContent = `${visibleProducts.length} producto${visibleProducts.length === 1 ? "" : "s"}`;

  if (!products.length) {
    renderCatalogState("empty");
    return;
  }

  if (!visibleProducts.length) {
    renderCatalogState("empty-category");
    return;
  }

  track.innerHTML = visibleProducts.map(product => renderProductCard(product)).join("");
  currentSlide = clampCarouselIndex(track, currentSlide);
  renderCarouselDots(dots, track);

  bindProductActions(track);
  bindDots(dots, track);
  updateMobileCatalogPager();
  scrollToSlide(track, currentSlide);
}

function renderProductCard(product) {
  const isOutOfStock = product.stock === "NO";
  const imageStyle = product.imagen
    ? `style="background-image: url('${escapeHtml(product.imagen.replace(/'/g, "%27"))}')"`
    : "";
  return `
    <article class="product-card${isOutOfStock ? " is-out-of-stock" : ""}" data-product-id="${escapeHtml(product.id)}">
      <div class="product-image${product.imagen ? "" : " product-image--placeholder"}" ${imageStyle}>
        <div class="product-badges">
          ${product.destacado === "SI" ? `<span class="product-badge">Destacado</span>` : ""}
          ${isOutOfStock ? `<span class="product-badge product-badge--stock">Sin stock</span>` : ""}
        </div>
      </div>
      <div class="product-body">
        <h4>${escapeHtml(product.nombre)}</h4>
        <div class="product-meta">
          ${product.aroma ? `<span>Aroma: <strong>${escapeHtml(product.aroma)}</strong></span>` : ""}
          <span class="price">${formatPrice(product.precio)}</span>
        </div>
        <div class="product-actions">
          <button class="btn btn--primary" type="button" data-open-detail>Ver detalle</button>
        </div>
      </div>
    </article>
  `;
}

function renderCatalogState(state) {
  const track = document.getElementById("products-track");
  const dots = document.getElementById("carousel-dots");
  const count = document.getElementById("catalog-count");
  const title = document.getElementById("catalog-title");
  if (!track || !dots) return;

  const states = {
    loading: {
      title: "Catalogo",
      count: "Cargando",
      message: "Cargando productos...",
    },
    error: {
      title: "Catalogo",
      count: "Sin conexion",
      message: "No pudimos cargar los productos en este momento. Intenta nuevamente mas tarde.",
    },
    empty: {
      title: "Catalogo",
      count: "0 productos",
      message: "No hay productos disponibles.",
    },
    "empty-category": {
      title: title?.textContent || "Catalogo",
      count: "0 productos",
      message: "No hay productos disponibles en esta categoria.",
    },
  };

  const current = states[state];
  if (!current) return;
  if (title) title.textContent = current.title;
  if (count) count.textContent = current.count;
  track.innerHTML = state === "loading"
    ? renderCatalogSkeleton(current.message)
    : `<div class="catalog-state">${current.message}</div>`;
  dots.innerHTML = "";
  updateMobileCatalogPager();
}

function renderCatalogSkeleton(message) {
  return Array.from({ length: 3 }, (_, index) => `
    <article class="product-card product-card--skeleton" aria-hidden="${index > 0}">
      <div class="product-image skeleton-shimmer"></div>
      <div class="product-body">
        <span class="skeleton-line skeleton-line--title"></span>
        <span class="skeleton-line"></span>
        <span class="skeleton-line skeleton-line--short"></span>
        <div class="product-actions">
          <span class="skeleton-button"></span>
        </div>
      </div>
      ${index === 0 ? `<span class="catalog-loading-text">${message}</span>` : ""}
    </article>
  `).join("");
}

function bindProductActions(track) {
  track.querySelectorAll(".product-card").forEach(card => {
    const product = products.find(item => item.id === card.dataset.productId);
    if (!product) return;

    card.querySelector("[data-open-detail]")?.addEventListener("click", () => {
      openProductModal(product);
    });
  });
}

function initProductModal() {
  const modal = document.getElementById("product-modal");
  if (!modal) return;

  modal.querySelectorAll("[data-close-product-modal]").forEach(button => {
    button.addEventListener("click", closeProductModal);
  });

  modal.querySelectorAll("[data-modal-qty]").forEach(button => {
    button.addEventListener("click", () => {
      const product = getActiveModalProduct();
      if (!product) return;

      const current = quantities.get(product.id) || 1;
      const next = button.dataset.modalQty === "increase"
        ? current + 1
        : Math.max(1, current - 1);
      quantities.set(product.id, next);
      updateModalQuantity(next);
    });
  });

  document.getElementById("modal-product-buy")?.addEventListener("click", () => {
    const product = getActiveModalProduct();
    if (!product || product.stock === "NO") return;

    const quantity = quantities.get(product.id) || 1;
    addToCart(product, quantity, getSelectedModalAroma());
    quantities.set(product.id, 1);
    closeProductModal();
  });

  document.getElementById("modal-product-consult")?.addEventListener("click", () => {
    const product = getActiveModalProduct();
    if (!product) return;

    const quantity = quantities.get(product.id) || 1;
    window.open(getProductWhatsappUrl(product, quantity, getSelectedModalAroma()), "_blank", "noopener,noreferrer");
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("is-open")) {
      closeProductModal();
    }
  });

  window.addEventListener("popstate", () => {
    if (modal.classList.contains("is-open")) {
      closeProductModal({ fromHistory: true });
    }
  });
}

function openProductModal(product) {
  const modal = document.getElementById("product-modal");
  if (!modal) return;

  const wasOpen = modal.classList.contains("is-open");
  activeModalProductId = product.id;
  modalScrollY = window.scrollY;
  const quantity = quantities.get(product.id) || 1;
  const image = document.getElementById("modal-product-image");
  const buyButton = document.getElementById("modal-product-buy");

  if (image) {
    image.classList.toggle("product-modal__image--placeholder", !product.imagen);
    image.style.backgroundImage = product.imagen ? `url('${product.imagen}')` : "";
  }

  document.getElementById("modal-product-title").textContent = product.nombre;
  document.getElementById("modal-product-description").textContent = product.descripcion;
  renderModalAromas(product);
  document.getElementById("modal-product-price").textContent = formatPrice(product.precio);
  updateModalQuantity(quantity);

  const isOutOfStock = product.stock === "NO";

  if (buyButton) {
    buyButton.disabled = isOutOfStock;
    buyButton.textContent = isOutOfStock ? "Sin stock" : "Agregar al pedido";
  }

  const consultButton = document.getElementById("modal-product-consult");
  if (consultButton) {
    consultButton.disabled = false;
  }

  const qtyWrap = document.querySelector(".product-modal__quantity");
  if (qtyWrap) {
    qtyWrap.style.display = isOutOfStock ? "none" : "";
  }

  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");

  if (!wasOpen && !modalHistoryActive) {
    history.pushState({ caleficaProductModal: true }, "", window.location.href);
    modalHistoryActive = true;
  }

  modal.querySelector(".product-modal__close")?.focus();
}

function closeProductModal({ fromHistory = false } = {}) {
  const modal = document.getElementById("product-modal");
  if (!modal) return;

  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  activeModalProductId = null;
  activeModalAromaId = "";

  if (modalScrollY) {
    window.scrollTo({ top: modalScrollY, behavior: "auto" });
  }

  if (modalHistoryActive) {
    modalHistoryActive = false;
    if (!fromHistory) history.back();
  }
}

function getActiveModalProduct() {
  return products.find(product => product.id === activeModalProductId);
}

function getDefaultAroma(product) {
  return product?.aromas?.find(aroma => aroma.predeterminado) || product?.aromas?.[0] || null;
}

function getSelectedModalAroma() {
  return getActiveModalProduct()?.aromas.find(aroma => aroma.id === activeModalAromaId) || null;
}

function renderModalAromas(product) {
  const fieldset = document.getElementById("modal-product-aromas");
  const options = document.getElementById("modal-aroma-options");
  if (!fieldset || !options) return;
  options.replaceChildren();
  activeModalAromaId = getDefaultAroma(product)?.id || "";
  fieldset.hidden = !product.aromas.length;
  product.aromas.forEach(aroma => {
    const label = document.createElement("label");
    label.className = "aroma-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "product-aroma";
    input.value = aroma.id;
    input.checked = aroma.id === activeModalAromaId;
    input.addEventListener("change", () => {
      if (input.checked) activeModalAromaId = aroma.id;
    });
    const swatch = document.createElement("span");
    swatch.className = "aroma-option__swatch";
    swatch.setAttribute("aria-hidden", "true");
    if (aroma.color) swatch.style.setProperty("--aroma-color", aroma.color);
    const check = document.createElement("span");
    check.className = "aroma-option__check";
    check.textContent = "✓";
    swatch.append(check);
    const name = document.createElement("span");
    name.className = "aroma-option__name";
    name.textContent = aroma.nombre;
    label.append(input, swatch, name);
    options.append(label);
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function updateModalQuantity(quantity) {
  const quantityValue = document.getElementById("modal-product-quantity");
  if (quantityValue) quantityValue.textContent = String(quantity);
}

function initCarouselControls() {
  document.getElementById("prev-product")?.addEventListener("click", () => moveCarousel(-1));
  document.getElementById("next-product")?.addEventListener("click", () => moveCarousel(1));
}

function initMobileCatalogControls() {
  document.getElementById("mobile-catalog-prev")?.addEventListener("click", () => moveMobileCatalogPage(-1));
  document.getElementById("mobile-catalog-next")?.addEventListener("click", () => moveMobileCatalogPage(1));
  window.addEventListener("resize", updateMobileCatalogPager);
}

function initTrackDrag() {
  const track = document.getElementById("products-track");
  if (!track) return;

  // ── Desktop: arrastre con mouse ──────────────────────────────────────
  let isDragging = false;
  let dragStartX = 0;
  let dragScrollLeft = 0;
  let hasMoved = false;

  track.addEventListener("mousedown", (e) => {
    if (window.matchMedia("(max-width: 760px)").matches) return;
    isDragging = true;
    hasMoved = false;
    dragStartX = e.pageX - track.offsetLeft;
    dragScrollLeft = track.scrollLeft;
    track.classList.add("is-dragging");
    track.style.scrollSnapType = "none";
  });

  track.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const walk = (e.pageX - track.offsetLeft) - dragStartX;
    if (Math.abs(walk) > 5) hasMoved = true;
    track.scrollLeft = dragScrollLeft - walk * 1.5;
  });

  const endDrag = () => {
    if (!isDragging) return;
    isDragging = false;
    track.classList.remove("is-dragging");
    track.style.scrollSnapType = "";
  };

  track.addEventListener("mouseup", endDrag);
  track.addEventListener("mouseleave", endDrag);

  // Evita abrir el modal si el usuario solo estaba arrastrando
  track.addEventListener("click", (e) => {
    if (hasMoved) { e.stopPropagation(); hasMoved = false; }
  }, true);

  // Sincroniza currentSlide y dots tras cualquier scroll (arrastre o flechas)
  let syncTimer = null;
  track.addEventListener("scroll", () => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      const cards = [...track.querySelectorAll(".product-card:not(.product-card--skeleton)")];
      if (!cards.length) return;
      let closest = 0;
      let minDist = Infinity;
      cards.forEach((card, index) => {
        const dist = Math.abs(card.offsetLeft - track.offsetLeft - track.scrollLeft);
        if (dist < minDist) { minDist = dist; closest = index; }
      });
      currentSlide = closest;
      updateDots();
    }, 80);
  }, { passive: true });

}

function moveMobileCatalogPage(direction) {
  mobileCatalogPage += direction;
  updateMobileCatalogPager();
}

function updateMobileCatalogPager() {
  const track = document.getElementById("products-track");
  const controls = document.getElementById("mobile-catalog-controls");
  const prevButton = document.getElementById("mobile-catalog-prev");
  const nextButton = document.getElementById("mobile-catalog-next");
  if (!track || !controls || !prevButton || !nextButton) return;

  const isMobile = window.matchMedia("(max-width: 760px)").matches;
  const cards = [...track.querySelectorAll(".product-card:not(.product-card--skeleton)")];
  const maxPage = Math.max(0, Math.ceil(cards.length / MOBILE_CATALOG_PAGE_SIZE) - 1);

  if (!isMobile || cards.length <= MOBILE_CATALOG_PAGE_SIZE) {
    controls.hidden = true;
    cards.forEach(card => card.classList.remove("is-mobile-hidden"));
    return;
  }

  mobileCatalogPage = Math.min(Math.max(mobileCatalogPage, 0), maxPage);
  const start = mobileCatalogPage * MOBILE_CATALOG_PAGE_SIZE;
  const end = start + MOBILE_CATALOG_PAGE_SIZE;

  cards.forEach((card, index) => {
    card.classList.toggle("is-mobile-hidden", index < start || index >= end);
  });

  controls.hidden = false;
  prevButton.disabled = mobileCatalogPage === 0;
  nextButton.disabled = mobileCatalogPage === maxPage;
}

function moveCarousel(direction) {
  const track = document.getElementById("products-track");
  if (!track || !track.children.length) return;

  const { maxStart } = getCarouselMetrics(track);
  if (direction > 0) {
    currentSlide = currentSlide >= maxStart ? 0 : currentSlide + 1;
  } else {
    currentSlide = currentSlide <= 0 ? maxStart : currentSlide - 1;
  }
  scrollToSlide(track, currentSlide);
  updateDots();
}

function bindDots(dots, track) {
  dots.querySelectorAll("[data-slide]").forEach(button => {
    button.addEventListener("click", () => {
      currentSlide = Number(button.dataset.slide);
      scrollToSlide(track, currentSlide);
      updateDots();
    });
  });
}

function scrollToSlide(track, index) {
  const safeIndex = clampCarouselIndex(track, index);
  const card = track.children[safeIndex];
  if (!card) return;
  currentSlide = safeIndex;
  track.scrollTo({ left: card.offsetLeft - track.offsetLeft, behavior: "smooth" });
}

function updateDots() {
  document.querySelectorAll(".dot").forEach((dot, index) => {
    dot.classList.toggle("is-active", index === currentSlide);
  });
}

function renderCarouselDots(dots, track) {
  const { maxStart } = getCarouselMetrics(track);
  dots.innerHTML = Array.from({ length: maxStart + 1 }, (_, index) => `
    <button class="dot${index === currentSlide ? " is-active" : ""}" type="button" aria-label="Ver grupo ${index + 1}" data-slide="${index}"></button>
  `).join("");
}

function clampCarouselIndex(track, index) {
  const { maxStart } = getCarouselMetrics(track);
  return Math.min(Math.max(Number(index) || 0, 0), maxStart);
}

function getCarouselMetrics(track) {
  const totalCards = track.children.length;
  const firstCard = track.children[0];
  if (!totalCards || !firstCard) {
    return { visibleCards: 1, maxStart: 0 };
  }

  const trackWidth = track.clientWidth || firstCard.getBoundingClientRect().width;
  const cardWidth = firstCard.getBoundingClientRect().width || trackWidth;
  const visibleCards = Math.max(1, Math.round(trackWidth / cardWidth));

  return {
    visibleCards,
    maxStart: Math.max(0, totalCards - visibleCards),
  };
}

function buildPaymentUrl(product, quantity) {
  return getProductBuyWhatsappUrl(product, quantity);
}

function getProductWhatsappUrl(product, quantity, aroma = getDefaultAroma(product)) {
  const message = `Hola, quiero consultar por ${quantity} unidad/es de ${product.nombre}.${aroma ? ` Aroma: ${aroma.nombre}.` : ""} Precio publicado: ${formatPrice(product.precio)}.`;
  return getWhatsappUrl(message, product.whatsapp);
}

function getProductBuyWhatsappUrl(product, quantity, aroma = getDefaultAroma(product)) {
  const message = `Hola, quiero comprar ${quantity} unidad/es de ${product.nombre}.${aroma ? ` Aroma: ${aroma.nombre}.` : ""} Precio publicado: ${formatPrice(product.precio)}. ¿Esta disponible?`;
  return getWhatsappUrl(message, product.whatsapp);
}

function getWhatsappUrl(message, phone = BRAND_CONFIG.whatsappNumber) {
  return `https://wa.me/${phone || BRAND_CONFIG.whatsappNumber}?text=${encodeURIComponent(message)}`;
}

function formatPrice(value) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}

function initContactForm() {
  const form = document.getElementById("contact-form");
  const status = document.getElementById("form-status");
  if (!form || !status) return;

  form.addEventListener("submit", event => {
    event.preventDefault();
    const name = document.getElementById("contact-name").value.trim();
    const message = document.getElementById("contact-message").value.trim();
    if (!name || !message) {
      status.textContent = "Completá tu nombre y mensaje para enviar la consulta.";
      return;
    }

    window.open(getWhatsappUrl(`Hola, soy ${name}. ${message}`), "_blank", "noopener,noreferrer");
    status.textContent = "Abrimos WhatsApp con tu consulta lista para enviar.";
    form.reset();
  });
}

function initReveal() {
  const sections = document.querySelectorAll(".section-reveal");
  if (!sections.length) return;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    sections.forEach(section => section.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { threshold: .14 });

  sections.forEach(section => observer.observe(section));
}

// ── Carrito ──────────────────────────────────────────────────────────────────

function getCart() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(item => {
      const aromaId = item.aromaId ?? normalizeAromas(item.aroma)[0]?.id ?? "";
      return { ...item, aromaId, cartKey: getCartItemKey(item.id, aromaId) };
    }) : [];
  } catch {
    return [];
  }
}

function saveCart(cart) {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  } catch (error) {
    console.warn("No se pudo guardar el carrito.", error);
  }
}

function getCartItemKey(productId, aromaId = "") {
  return encodeURIComponent(JSON.stringify([String(productId), aromaId]));
}

function addToCart(product, quantity, aroma = getDefaultAroma(product)) {
  if (product.stock === "NO" || (product.aromas.length && !product.aromas.some(item => item.id === aroma?.id))) return;
  const aromaId = aroma?.id || "";
  const cartKey = getCartItemKey(product.id, aromaId);
  const cart = getCart();
  const existing = cart.find(item => item.cartKey === cartKey);
  if (existing) {
    existing.cantidad += quantity;
    existing.nombre = product.nombre;
    existing.aroma = aroma?.nombre || "";
    existing.precio = product.precio;
    existing.imagenUrl = product.imagen;
    existing.whatsapp = product.whatsapp;
  } else {
    cart.push({
      id: product.id,
      cartKey,
      aromaId,
      nombre: product.nombre,
      aroma: aroma?.nombre || "",
      precio: product.precio,
      imagenUrl: product.imagen,
      whatsapp: product.whatsapp,
      cantidad: quantity,
    });
  }
  saveCart(cart);
  updateCartCounter();
  renderCart();
}

function removeFromCart(cartKey) {
  saveCart(getCart().filter(item => item.cartKey !== cartKey));
  updateCartCounter();
  renderCart();
}

function increaseCartItem(cartKey) {
  const cart = getCart();
  const item = cart.find(i => i.cartKey === cartKey);
  if (item) item.cantidad += 1;
  saveCart(cart);
  updateCartCounter();
  renderCart();
}

function decreaseCartItem(cartKey) {
  const cart = getCart();
  const item = cart.find(i => i.cartKey === cartKey);
  if (!item) return;
  if (item.cantidad <= 1) {
    removeFromCart(cartKey);
    return;
  }
  item.cantidad -= 1;
  saveCart(cart);
  updateCartCounter();
  renderCart();
}

function clearCart() {
  saveCart([]);
  updateCartCounter();
  renderCart();
}

function calculateCartTotal() {
  return getCart().reduce((sum, item) => sum + item.precio * item.cantidad, 0);
}

function updateCartCounter() {
  const total = getCart().reduce((sum, item) => sum + item.cantidad, 0);
  [
    document.getElementById("cart-counter"),
    document.getElementById("cart-floating-counter"),
  ].forEach(el => {
    if (!el) return;
    el.textContent = String(total);
    el.hidden = total === 0;
  });
}

function openCart() {
  const drawer = document.getElementById("cart-drawer");
  const overlay = document.getElementById("cart-overlay");
  if (!drawer) return;
  renderCart();
  drawer.classList.add("is-open");
  drawer.setAttribute("aria-hidden", "false");
  overlay?.classList.add("is-visible");
  document.body.classList.add("cart-open");
  drawer.querySelector(".cart-close")?.focus();
}

function closeCart() {
  const drawer = document.getElementById("cart-drawer");
  const overlay = document.getElementById("cart-overlay");
  if (!drawer) return;
  drawer.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
  overlay?.classList.remove("is-visible");
  document.body.classList.remove("cart-open");
}

function renderCart() {
  const itemsEl = document.getElementById("cart-items");
  const totalEl = document.getElementById("cart-total-value");
  const checkoutBtn = document.getElementById("cart-checkout");
  const clearBtn = document.getElementById("cart-clear");
  if (!itemsEl) return;

  const cart = getCart();

  if (!cart.length) {
    itemsEl.innerHTML = `
      <div class="cart-empty">
        <p class="cart-empty__title">Tu pedido está vacío</p>
        <p class="cart-empty__text">Agregá tus velas favoritas para armar tu pedido.</p>
      </div>
    `;
    if (totalEl) totalEl.textContent = formatPrice(0);
    if (checkoutBtn) checkoutBtn.disabled = true;
    if (clearBtn) clearBtn.hidden = true;
    return;
  }

  itemsEl.innerHTML = cart.map(item => `
    <div class="cart-item" data-item-id="${escapeHtml(item.cartKey)}">
      <div class="cart-item__image${item.imagenUrl ? "" : " cart-item__image--placeholder"}"
           ${item.imagenUrl ? `style="background-image:url('${escapeHtml(String(item.imagenUrl).replace(/'/g, "%27"))}')"` : ""}></div>
      <div class="cart-item__info">
        <p class="cart-item__name">${escapeHtml(item.nombre)}</p>
        ${item.aroma ? `<p class="cart-item__aroma">Aroma: ${escapeHtml(item.aroma)}</p>` : ""}
        <p class="cart-item__price">${formatPrice(item.precio)}</p>
      </div>
      <div class="cart-item__controls">
        <div class="quantity-control">
          <button class="qty-btn" type="button" data-cart-decrease="${escapeHtml(item.cartKey)}" aria-label="Disminuir cantidad de ${escapeHtml(item.nombre)}">−</button>
          <span class="quantity-value">${item.cantidad}</span>
          <button class="qty-btn" type="button" data-cart-increase="${escapeHtml(item.cartKey)}" aria-label="Aumentar cantidad de ${escapeHtml(item.nombre)}">+</button>
        </div>
        <div class="cart-item__bottom">
          <p class="cart-item__subtotal">${formatPrice(item.precio * item.cantidad)}</p>
          <button class="cart-item__remove" type="button" data-cart-remove="${escapeHtml(item.cartKey)}" aria-label="Eliminar ${escapeHtml(item.nombre)}">&times;</button>
        </div>
      </div>
    </div>
  `).join("");

  if (totalEl) totalEl.textContent = formatPrice(calculateCartTotal());
  if (checkoutBtn) checkoutBtn.disabled = false;
  if (clearBtn) clearBtn.hidden = false;

  itemsEl.querySelectorAll("[data-cart-increase]").forEach(btn => {
    btn.addEventListener("click", () => increaseCartItem(btn.dataset.cartIncrease));
  });
  itemsEl.querySelectorAll("[data-cart-decrease]").forEach(btn => {
    btn.addEventListener("click", () => decreaseCartItem(btn.dataset.cartDecrease));
  });
  itemsEl.querySelectorAll("[data-cart-remove]").forEach(btn => {
    btn.addEventListener("click", () => removeFromCart(btn.dataset.cartRemove));
  });
}

function syncCartWithProducts(activeProducts) {
  const cart = getCart();
  if (!cart.length) return;

  const synced = cart
    .filter(item => {
      const product = activeProducts.find(p => p.id === item.id);
      return product && product.activo !== false && product.stock === "SI"
        && (item.aromaId ? product.aromas.some(aroma => aroma.id === item.aromaId) : !product.aromas.length);
    })
    .map(item => {
      const product = activeProducts.find(p => p.id === item.id);
      return {
        ...item,
        nombre: product.nombre,
        aroma: product.aromas.find(aroma => aroma.id === item.aromaId)?.nombre || "",
        precio: product.precio,
        imagenUrl: product.imagen,
        whatsapp: product.whatsapp,
      };
    });

  saveCart(synced);
  updateCartCounter();
  if (document.getElementById("cart-drawer")?.classList.contains("is-open")) {
    renderCart();
  }
}

function showAddFeedback(card) {
  const btn = card.querySelector("[data-add-to-cart]");
  if (!btn || btn.classList.contains("btn--added")) return;
  const original = btn.textContent;
  btn.textContent = "¡Listo!";
  btn.classList.add("btn--added");
  btn.disabled = true;
  window.setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove("btn--added");
    btn.disabled = false;
  }, 1100);
}

function normalizeWhatsAppNumber(number) {
  return String(number || "").replace(/[\s\-+]/g, "");
}

function getCartWhatsAppNumber(cart) {
  const number = cart.find(item => item.whatsapp)?.whatsapp || BRAND_CONFIG.whatsappNumber;
  return normalizeWhatsAppNumber(number);
}

function buildWhatsAppOrderMessage(cart) {
  const lines = ["Hola, quiero hacer un pedido en Calefica:\n"];

  for (const item of cart) {
    const precio = Number(item.precio);
    const precioValido = Number.isFinite(precio) && precio > 0;
    const precioTexto = precioValido ? formatPrice(precio) : "A consultar";
    const subtotalTexto = precioValido ? formatPrice(precio * item.cantidad) : "A consultar";

    lines.push(`• ${item.cantidad} x ${item.nombre}`);
    if (item.aroma) {
      lines.push(`  Aroma/variante: ${item.aroma}`);
    }
    lines.push(`  Precio unitario: ${precioTexto}`);
    lines.push(`  Subtotal: ${subtotalTexto}\n`);
  }

  lines.push(`Total estimado: ${formatPrice(calculateCartTotal())}`);
  lines.push("\nQuedo a la espera para confirmar disponibilidad, forma de pago y entrega.");

  return lines.join("\n");
}

function openWhatsAppOrder() {
  const cart = getCart();
  if (!cart.length) return;

  const message = buildWhatsAppOrderMessage(cart);
  const phone = getCartWhatsAppNumber(cart);
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");

  const statusEl = document.getElementById("cart-checkout-status");
  if (statusEl) {
    statusEl.textContent = "Pedido preparado en WhatsApp.";
    window.setTimeout(() => { statusEl.textContent = ""; }, 3500);
  }
}

function initCart() {
  document.getElementById("cart-button")?.addEventListener("click", openCart);
  document.getElementById("cart-floating")?.addEventListener("click", openCart);
  document.getElementById("cart-close")?.addEventListener("click", closeCart);
  document.getElementById("cart-overlay")?.addEventListener("click", closeCart);

  document.getElementById("cart-clear")?.addEventListener("click", () => {
    if (getCart().length) clearCart();
  });

  document.getElementById("cart-checkout")?.addEventListener("click", openWhatsAppOrder);

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && document.getElementById("cart-drawer")?.classList.contains("is-open")) {
      closeCart();
    }
  });

  updateCartCounter();
  renderCart();
}
