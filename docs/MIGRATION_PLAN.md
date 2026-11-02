# Calefica 2.0 — Auditoría y plan de migración

Fecha: 30 de octubre de 2026. Base auditada: commit `7fdab03`.

> Actualización de versionado: la configuración pública de ejecución ahora es `js/config.js`, incluida en Git para que esta versión funcione al clonar. `js/config.local.js` se conserva como copia local excluida. El destino autorizado de esta versión es `EdgarA1989/calefica_velas2.0`; el repositorio anterior permanece sin cambios. Las menciones a configuración local en la auditoría original describen las etapas anteriores.

> Decisión posterior del usuario: conservar HTML, CSS y JavaScript puro. Se descartan React y Vite. La configuración pública se prepara en `js/config.local.js`, a partir de `js/config.example.js`; el catálogo continúa en Sheets. El usuario autorizó avanzar con la etapa 2. Se entregan migraciones y pruebas locales; la aplicación remota y Auth siguen pendientes. Ver [SUPABASE_SETUP.md](SUPABASE_SETUP.md) y [SUPABASE_STAGE_2.md](SUPABASE_STAGE_2.md).

## 1. Alcance y resultado de esta etapa

Etapa 1: auditoría y planificación. Este documento es el único cambio realizado al proyecto. Se conservan Google Sheets, Apps Script, imágenes, interfaz y funcionalidades. No se crearon tablas, conexiones, credenciales ni infraestructura. No se publicó ni se hizo push al repositorio remoto.

**Hallazgo principal de la auditoría inicial:** la landing es HTML, CSS y JavaScript puro, sin herramientas de compilación ni panel administrativo. Se conserva esa arquitectura. En la etapa 2 se agregó `package.json` y lockfile exclusivamente para pruebas SQL locales, sin backend ni compilación del sitio.

El modelo de este plan cubre el contrato encontrado en código y documentación. La planilla viva, sus validaciones y el contenido de Drive todavía deben contrastarse con una exportación completa antes de importar datos. La plantilla CSV es una muestra, no una copia certificada del catálogo real.

## 2. Inventario completo y arquitectura actual

| Archivo o directorio | Función actual |
| --- | --- |
| `index.html` | Página única: cabecera, hero, historia, catálogo, contacto, carrito, modal y pie. Carga `aromas.js` antes de `main.js`. |
| `css/styles.css` | Diseño completo, variables de marca, temas claro/oscuro, animaciones y responsive. |
| `js/main.js` | Configuración, consulta HTTP, caché, normalización, categorías, tarjetas, modal, cantidades, carrito y WhatsApp. |
| `js/aromas.js` | Normalizador de aromas; tiene una copia equivalente dentro de Apps Script. |
| `google-apps-script/catalogo-productos.gs` | API JSON pública; lee Sheets, validaciones de desplegables, maestro de aromas y carpeta de Drive. |
| `docs/manual-cliente.md` | Gestión comercial desde Sheets y Drive; describe stock, aromas, imágenes y pedidos. |
| `docs/selector-aromas-planilla.md` | Prioridad y configuración de las opciones del desplegable. |
| `docs/productos_velas_soja_template.csv` | 13 columnas, 8 productos de ejemplo: 7 activos y 1 inactivo. |
| `tests/aromas.test.cjs` | Seis pruebas unitarias/de contrato mediante `node:test` y `node:vm`. |
| `tests/aromas.browser.test.cjs` | Una prueba con Edge headless y Chrome DevTools Protocol; sirve el sitio localmente y simula la API. |
| `assets/img/calefica_logo.png`, `calefica-vela.svg`, `historia.png` | Identidad e imagen institucional. |
| `assets/img/imagenes-productos-calefica/02 - Imagenes productos/` | Ocho JPG: box, combo, coco, deco, lavanda, nude clásica, rosa y vainilla. |
| `assets/img/imagenes-productos-calefica.zip` | Archivo de imágenes existente, conservado. |
| `.git/` | Versionado local. |

No se encontraron `AGENTS.md`, `.gitignore`, archivos de entorno, workflows, configuración de hosting ni herramientas de build. No hay dependencias npm con versiones declaradas. El navegador usa APIs nativas: Fetch, DOM, History, localStorage, IntersectionObserver e Intl. Google Fonts carga Cormorant Garamond (500/600/700), Inter (400/500/600/700) y Quicksand (700), sin versionado local. Las fotos del hero son externas de Unsplash; la historia y la marca usan archivos locales.

Entorno de verificación inicial: Node `v24.22.1`, npm `11.19.1`. La etapa 2 declara Node >=22 para las herramientas de prueba y fija PGlite en el lockfile. El SDK de Supabase para navegador se incorporará con versión fija al implementar servicios; no se necesita React ni Vite.

### Flujo de datos

1. `DOMContentLoaded` inicializa tema, menú, enlaces, catálogo, modal, formulario y carrito.
2. `initCatalog()` normaliza los siete productos embebidos y consulta `calefica_productos_v3` en localStorage.
3. Si hay caché no vacía, la muestra inmediatamente; después consulta la URL `/exec` de Apps Script con `cache: no-store`.
4. Espera `{ ok, total, productos }`. Guarda los productos normalizados y actualiza catálogo y carrito. Con error conserva la caché previa; sin caché muestra error. Los productos embebidos sirven cuando la API no está configurada; no son el respaldo general de errores HTTP.
5. Apps Script usa `CacheService` por 300 segundos. `cache: no-store` del navegador no elimina esa caché del servidor.
6. El script lee `productos`, filtra `activo = SI`, resuelve imágenes y aromas, y ordena por `orden`.

No se consultó la API viva en esta auditoría: su lectura puede ejecutar `file.setSharing()` en Drive porque `AUTO_SHARE_IMAGES = true`. Tampoco se ejecutó ni se cambió el Apps Script desplegado.

## 3. Contrato real del catálogo

Encabezados exactos: `id, activo, orden, categoria, nombre, descripcion, aroma, precio, nombreImagen, whatsapp, stock, cantidadStock, destacado`. También se admite el alias `aromas` para la columna de aromas. El normalizador de encabezados solo recorta espacios: no cambia mayúsculas ni acentos.

| Origen | Comportamiento encontrado | Destino propuesto |
| --- | --- | --- |
| `id` | Texto; se usa en carrito y selección. El frontend genera uno si falta, de forma potencialmente inestable. | UUID interno + `external_id` estable; rechazar IDs vacíos/duplicados en importación hasta resolverlos. |
| `activo` | SI/NO; el endpoint excluye los NO. | `products.is_active`. |
| `orden` | Número; `Number(value) || 9999` convierte también 0 en 9999. | `products.sort_order`; registrar diferencia si hay ceros. |
| `categoria` | Texto, categoría derivada sin tabla. Hay cuatro alias heredados. | FK `category_id`, conservando valor original en exportación privada. |
| `nombre`, `descripcion` | Texto; frontend aplica valores por defecto si faltan. | `name`, `description`; no inventar nombres al importar. |
| `aroma` / `aromas` | Texto, formato delimitado, JSON o lista efectiva del desplegable. | `aromas` y `product_aromas`, con metadatos por asociación. |
| `precio` | Valor numérico mediante `Number(...) || 0`; ARS, presentación sin decimales. | `price numeric(12,2) >= 0`; moneda ARS en configuración pública. |
| `nombreImagen` | Nombre exacto del archivo de Drive. | `product_images.original_filename`; mapa privado de procedencia. |
| `whatsapp` | Número por producto o valor global. | `products.whatsapp_override` nullable + configuración global. |
| `stock` | Disponibilidad SI/NO; no es una cantidad. | `products.is_available`, independiente de cantidad física. |
| `cantidadStock` | Texto libre interno; se envía al JSON aunque no se dibuja. Los ceros numéricos pueden perderse con `|| ""`. | Tabla privada `product_inventory`, conservando texto original y cantidad nullable. |
| `destacado` | SI/NO; etiqueta visual. | `products.is_featured`. |
| `imagenUrl` | Campo derivado por Apps Script; una imagen por producto. | URL resuelta desde Storage y filas ordenadas en `product_images`. |

### Reglas comerciales que se deben preservar

- Producto activo agotado: visible, con etiqueta y compra bloqueada; consulta por WhatsApp disponible.
- `cantidadStock` no limita compras ni descuenta unidades. No hay pedidos persistidos, reservas ni transacciones de venta. La migración no debe introducir descuentos de stock implícitos.
- `refreshCatalogData()` excluye categorías cuyo slug sea `clasicas` o `velas-clasicas`; conservar sus datos y representar la exclusión mediante categoría oculta.
- Souvenir aparece siempre, incluso vacío. El enlace Souvenir del menú conduce a contacto, no a una ruta independiente.
- El orden de categorías se deriva de la primera aparición de productos; preservarlo al preparar `categories.sort_order`.
- Los alias `aromaticas`, `decorativas`, `combos` y `extras` tienen etiquetas heredadas. No fusionar automáticamente `Combos / regalos` con `Combos y regalos` sin informe y revisión.
- Carrito local `calefica_cart_v1`: identidad por par producto/aroma, suma cantidades, actualiza precio/nombre y retira productos o aromas ya no disponibles al refrescar catálogo. Mantener identificadores externos en el adaptador o migrar explícitamente ese almacenamiento.
- La caché no tiene caducidad aplicada. Separar claves por proveedor/esquema y revalidar antes de enviar pedido; un producto retirado no debe seguir vendiéndose por una caché anterior.
- Los pedidos de varios teléfonos se envían al primero disponible en el carrito. Preservar y documentar esa regla antes de cualquier cambio comercial.

### Aromas: extracción que evita pérdida de variantes

`readAromaDropdownOptions()` lee `VALUE_IN_LIST` y `VALUE_IN_RANGE`. Todas las opciones del desplegable tienen prioridad sobre la celda seleccionada, incluso si la celda está vacía. La hoja opcional `aromas` aporta `nombre`, `color`, `activo`, `orden`, `predeterminado`, `id`; solo nombre y color son obligatorios si existe esa hoja.

Sin desplegable, se aceptan texto simple, JSON o `Nombre|#HEXCOLOR|activo|orden|predeterminado|id`, separado por punto y coma o salto de línea. `Lavanda + Vainilla` es una sola variante combinada. No separar automáticamente textos por comas sin considerar el maestro y el formato. Color inválido/vacío usa círculo neutro. Se toma el primer aroma predeterminado activo o, en su defecto, el primero ordenado.

Un mismo ID de aroma puede ser local a un producto y tener nombre/color diferentes en otro. No convertirlo en una identidad global sin revisar conflictos. El modelo requiere overrides por asociación y un mapa estable entre IDs antiguos y nuevos.

### Imágenes y venta

Drive se consulta por nombre exacto dentro de una carpeta configurada en el `.gs`; el último archivo homónimo iterado puede sobrescribir al anterior. Las URLs generadas son thumbnails `https://drive.google.com/thumbnail?id=...&sz=w800`, no necesariamente los originales. El código puede hacer públicas las imágenes y silenciar errores de permisos. El frontend muestra un placeholder CSS cuando no hay URL; no hay galería ni recuperación explícita de imágenes remotas rotas.

WhatsApp usa `wa.me`, incluye nombre, aroma, cantidad, precio y total estimado. Contacto y pedido abren una pestaña. `buildPaymentUrl()` también devuelve WhatsApp: **no existe integración activa de Mercado Pago, SDK, QR, checkout ni webhook**. El manual lo confirma. `549XXXXXXXXXX` e Instagram genérico son placeholders; `hola@calefica.com` es un valor configurado, sin validación de pertenencia.

## 4. Navegación, diseño y piezas reutilizables

Una sola página con anclas `#inicio`, `#historia`, `#catalogo`, `#contacto`; no hay router ni ruta `/admin`. El modal usa `pushState`/`popstate` para cerrar con Atrás, sin URL de producto propia. Mantener esa conducta al integrar un router.

Responsive encontrado: menú móvil hasta 978 px; estructura general desde 760 px; categoría lateral desde 960 px; ajustes desde 1080 px y hasta 420 px. Catálogo hasta 760 px: grilla de dos columnas y páginas de cuatro productos; escritorio: carrusel con flechas, dots y arrastre. Carrito móvil inferior de 92dvh y botón flotante; escritorio con panel lateral. El modal adapta columnas y scroll. Hay una superposición de reglas min/max a 760 px que requiere revisión visual específica en la conversión.

Reutilizar CSS, tokens, imágenes, textos y markup de cabecera, hero, historia, categorías, tarjetas, modal, selector de aromas, carrito, contacto y pie. Extraer normalizadores, formato ARS, reglas de carrito y mensajes WhatsApp como funciones puras y módulos JavaScript. No convertir la interfaz a otro framework.

## 5. Arquitectura propuesta

Frontend HTML/CSS/JS estático, comunicándose directamente con Supabase mediante `@supabase/supabase-js`. Hostinger recibe únicamente archivos públicos del sitio: HTML, CSS, JS e imágenes. Node se usa localmente para pruebas/importación; no habrá servidor Node/Express en hosting ni build obligatorio.

```text
admin/                    # HTML privado mediante Auth/RLS, estilos y scripts propios
js/
  config.js                # configuración pública versionada del navegador
  config.example.js        # plantilla versionada
  auth/                   # sesión y verificación de membresía
  services/
    productsService.js    # contrato común, sin consultas dispersas en la UI
    providers/sheets.js
    providers/supabase.js
    adminService.js       # productos, categorías, aromas y configuración
    imagesService.js
  lib/supabase.js         # único cliente; valida configuración pública
  domain/                 # normalización, carrito y validaciones
supabase/migrations/      # SQL versionado y políticas
scripts/                  # exportación/importación privada de ejecución local
```

Selección explícita `window.CALEFICA_CONFIG.dataProvider` con `sheets|supabase`; error visible si es inválido o falta configuración. Sin fallback silencioso entre proveedores. Mantener el contrato de productos/aromas actual mediante adaptadores durante la transición. Refrescar al cargar catálogo, al volver al foco y tras cambios administrativos; no hace falta recompilar por cambios de datos. Realtime es opcional, no requisito inicial.

Separar gradualmente datos y dominio del render existente, conservando DOM, clases y listeners. Validar paridad con Sheets antes de cambiar de proveedor. No retirar los originales hasta la etapa de cierre autorizada.

## 6. Modelo de datos propuesto según el contrato auditado

Campos nuevos son decisiones de destino, no columnas atribuidas a la planilla. UUID como PK salvo claves indicadas; timestamps `timestamptz`, `created_at`/`updated_at` y actualización automática donde corresponda.

| Tabla | Campos y restricciones previstas |
| --- | --- |
| `categories` | `id`, `name` no vacío, `slug` único, `sort_order`, `is_active` para ocultar, `show_when_empty` para Souvenir, timestamps. |
| `products` | `id`, `source_system` nullable, `external_id` nullable, `name`, `slug` único, `description`, `price numeric(12,2) >= 0`, `category_id` FK, `sort_order`, `is_active`, `is_featured`, `is_available`, `whatsapp_override` nullable, timestamps. Único `(source_system, external_id)` cuando ambos existan; `source_system` identifica la planilla concreta. |
| `product_inventory` | `product_id` PK/FK, `quantity integer` nullable con CHECK >= 0, `legacy_quantity_text text`, timestamps. Solo administradores; `is_available` no se deriva automáticamente de esta tabla. |
| `product_images` | `id`, `product_id` FK, `storage_path` único, `original_filename`, `alt_text`, `sort_order`, `is_primary`, timestamps. Índice único parcial de primaria por producto. Guardar múltiples filas sin imponer galería nueva al catálogo inicial. |
| `aromas` | `id`, `name` no vacío, `color` nullable CHECK hexadecimal de seis dígitos, `is_active`, `sort_order`, timestamps. Nombres semejantes no se fusionan ciegamente. |
| `product_aromas` | PK `(product_id, aroma_id)`, ambas FK; `legacy_aroma_id` para carrito anterior, `sort_order`, `is_default`, `is_active`, `name_override`, `color_override`, `use_neutral_color` para representar ausencia explícita de color. Único `(product_id, legacy_aroma_id)` no nulo y como máximo un predeterminado activo por producto. |
| `admin_users` | `user_id` PK/FK `auth.users`, `role` CHECK inicialmente `admin`, `created_at`. Ninguna política permite autoinscripción o autootorgamiento de rol. |
| `site_settings` | `key` PK y CHECK de lista permitida de claves públicas, `value jsonb` validado según clave, `updated_at`. WhatsApp, Instagram, email público, información comercial y moneda. Sin secretos ni información interna. |

Procedencia completa, celdas originales y manifiestos se guardan fuera del frontend/Git en una exportación privada. Si se necesita persistirlos, crear una tabla en esquema privado, sin exposición por Data API. No agregar esos datos a `site_settings`.

FK de categoría con borrado restringido para no perder productos; `auth.users` puede eliminar su membresía administrativa en cascada. Asociaciones, inventario e imágenes pueden usar cascada de metadatos al eliminar un producto con confirmación, sin borrar archivos Storage implícitamente. Para importar, no se usará DELETE/TRUNCATE. Índices en FK, orden público por categoría/estado/orden, pares externos e imágenes. Triggers de timestamps y validaciones de texto, números y slugs. Preservar descripciones vacías y valores originales en la exportación; los defaults visuales pertenecen al adaptador.

Este modelo resuelve las omisiones de la propuesta inicial: disponibilidad distinta de cantidad, orden de productos, categoría oculta, variantes con predeterminado/orden/overrides y WhatsApp por producto. Se cerrará contra los datos exportados antes de ejecutar SQL sobre un entorno real.

## 7. Seguridad prevista y pruebas de permisos

- RLS en todas las tablas públicas; visitantes y autenticados sin membresía solo leen productos activos de categorías activas, categorías publicadas, aromas activos y relaciones/imágenes de productos publicados. Inventario y administradores no tienen lectura pública.
- Para administradores, lectura completa y CRUD de catálogo/configuración; `USING` y `WITH CHECK` para las escrituras. La comprobación de sesión en JavaScript mejora navegación; PostgreSQL decide permisos.
- Comprobar membresía mediante función `private.is_admin()` `SECURITY DEFINER`, propietario controlado, `search_path` fijo y referencias calificadas; no aceptar un ID arbitrario. La función lee `admin_users` sin entrar en una política recursiva. Limitar EXECUTE a los roles que lo necesiten; prohibir modificaciones de membresías desde el cliente. Probar específicamente revocación, recursión y autenticado no administrador.
- Login por email/contraseña, logout, manejo de sesión vencida, rutas `/admin` privadas. Deshabilitar registro público en Auth; alta inicial de usuario y membresía por Dashboard/SQL administrativo, sin formularios públicos ni trigger que promueva usuarios.
- `site_settings` solo tendrá claves de información pública validadas en base de datos. RLS filtra filas, no columnas: por eso la cantidad/notas internas se separan del producto. El endpoint actual ya transmite `cantidadStock`; no repetir esa exposición.
- Storage: bucket privado `product-images`; subida/actualización/borrado y listado administrativo con políticas acotadas por `bucket_id` y permisos de administrador sobre `storage.objects`. Lectura pública autenticada como `anon` solo para objetos vinculados a productos publicados; generar URLs firmadas temporales mediante el cliente y esa autorización, con caducidad y renovación. No utilizar un bucket público si se exige restringir imágenes de productos ocultos. Una URL firmada previamente seguirá válida hasta expirar; no prometer revocación inmediata.
- Limitar MIME y tamaño, generar rutas propias con UUID/hash y comprobar que la asociación de imagen corresponde al producto. No confiar solo en extensión o validaciones de la interfaz.
- Frontend únicamente con URL y clave publicable; nunca `service_role`, contraseña de PostgreSQL ni secretos en archivos servidos al navegador. Credenciales de importación solo en proceso local privado.

Matriz obligatoria a ejecutar en la etapa de SQL/seguridad:

| Actor | Lectura publicada | Ocultos/inventario | CRUD catálogo | Mutar admin_users | Escribir Storage |
| --- | --- | --- | --- | --- | --- |
| Visitante | Permitida | Denegado | Denegado | Denegado | Denegado |
| Autenticado sin membresía | Permitida | Denegado | Denegado | Denegado | Denegado |
| Administrador | Permitida | Permitido | Permitido | Denegado desde cliente | Permitido en bucket previsto |
| Sesión vencida o membresía revocada | Solo público | Denegado | Denegado | Denegado | Denegado |

Intentar operaciones directamente con la API, incluidos joins, RPC, borrados y reemplazos Storage. Comprobar que vistas no eludan RLS. Ninguna prueba de permisos Supabase se ejecutó aún porque no hay base configurada.

Referencias oficiales consultadas para este diseño: [RLS de Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security) y [control de acceso Storage](https://supabase.com/docs/guides/storage/security/access-control). Las migraciones y sus pruebas locales están preparadas; falta verificarlas en el proyecto remoto.

## 8. Estrategia de importación repetible y sin borrados

1. Obtener snapshot privado completo: ambas hojas si existen, filas activas e inactivas, valores sin transformar, validaciones `VALUE_IN_LIST`/`VALUE_IN_RANGE`, contenido de rangos de origen y manifiesto Drive con ID/nombre/MIME. Un CSV solo no conserva validaciones; la API actual además excluye productos/aromas inactivos y puede perder ceros o valores malformados. Preparar exportador local/de Apps Script separado, sin editar el endpoint público ni llamar a `setSharing()`.
2. Validar en dry-run: cabeceras, IDs vacíos/duplicados, colisiones de slugs/categorías, números, SI/NO, nombres de archivo duplicados, aromas por producto y conflictos de ID/color. Precios locales como `22.000` o `22.000,50` requieren reglas explícitas; no convertir ambigüedades silenciosamente en cero. Preservar el texto libre de cantidad y usar `quantity = null` si no es entero no negativo.
3. Crear manifiesto de correspondencias de categorías/aromas/productos. Conservar fuentes, valores originales e IDs del carrito. Generar slugs únicos estables; no renombrarlos en cada reimportación. Resolver predeterminados múltiples conservando el primero efectivo y reportando el conflicto.
4. Importar categorías, aromas, productos, inventario y relaciones mediante UPSERT de claves estables. Relaciones retiradas se desactivan según snapshot explícito; no asumir baja por faltar una fila en un archivo parcial. No borrar registros anteriores. Un producto editado en el admin después de la primera carga se considera conflicto y no se pisa sin revisión; comparar hash previo/estado actual.
5. Ejecutar cada producto y sus asociaciones en una transacción local de PostgreSQL o RPC administrativa restringida; registrar errores por producto y permitir reintentos sin duplicados. El script es repetible, aunque sus credenciales se habiliten temporalmente para la operación.
6. Imágenes: descargar originales por ID de Drive con permisos de lectura y conservarlos. Si solo se obtiene un thumbnail, registrarlo como calidad reducida y no presentarlo como original. Usar rutas deterministas `products/<uuid>/<hash>.<extension>`; no sobrescribir originales. Verificar MIME real, tamaño, hash y respuesta/decodificación de URL nueva antes de asociarla. Reusar el manifiesto para reintentos y admitir varias imágenes por producto.
7. Informe privado JSON/CSV: creados, actualizados, sin cambios, omitidos/conflictos y errores con fila/ID; cantidades por estado y asociaciones, imágenes verificadas/fallidas. Evitar secretos en logs. Segunda ejecución del mismo snapshot debe producir cero duplicados y cero cambios innecesarios.
8. Comparar catálogo Sheets/Supabase y snapshot completo, incluyendo inactivos. Hacer el cambio de proveedor solo después de validar la paridad. Rollback explícito de configuración/despliegue; no restaurar Sheets silenciosamente ante errores.

## 9. Administración prevista

`/admin` y login propios, coherentes con las variables visuales actuales. Dashboard con total/publicados/ocultos/agotados; listado con miniaturas, búsqueda y filtros de categoría/estado; formularios para nombre, descripción, precio, disponibilidad, cantidad interna, destacados, orden, teléfono y aromas. Crear/editar/publicar/ocultar y eliminar con confirmación que identifique el producto. Categorías con ocultamiento y orden; aromas con color, estado y asignación por producto; configuración pública validada.

Subida múltiple de imágenes con progreso, orden y selección de primaria; errores parciales recuperables y limpieza controlada de archivos huérfanos. Formularios utilizables desde celular, etiquetas accesibles, validaciones de dominio y de servidor, estados de carga/vacío/error/éxito, bloqueo de doble envío y advertencia por cambios sin guardar. Distinguir producto oculto de categoría oculta en métricas y listados.

## 10. Archivos previstos para siguientes etapas

| Archivo | Acción prevista |
| --- | --- |
| `index.html` | Conservar contenido y metadatos; integrar configuración y servicios JS cuando se valide el proveedor. |
| `js/main.js` | Extraer dominio/servicios y trasladar secciones sin listeners duplicados; conservar hasta validar sustitución. |
| `js/aromas.js` | Extraer normalizador reutilizable y mantener equivalencia con Apps Script durante transición. |
| `css/styles.css` | Reutilizar sin rediseño; añadir estilos administrativos con alcance propio. |
| `assets/img/**` | Conservar y comprobar subrutas y CSS URLs en hosting estático. |
| `tests/*.cjs` | Mantener casos comerciales y ampliar pruebas de servicios; añadir verificación SQL local. |
| `docs/manual-cliente.md` | Añadir uso del admin sin retirar guía Sheets hasta cierre. |
| `docs/selector-aromas-planilla.md`, plantilla CSV | Conservar como documentación de compatibilidad. |
| `google-apps-script/catalogo-productos.gs` | Mantener operativo; ninguna edición/despliegue necesario para esta etapa. Exportador futuro separado. |
| `package.json`, lockfile | Herramientas de prueba local con PGlite; no se publican dependencias en Hostinger. |
| `js/services/**`, `js/domain/**`, `js/auth/**`, `admin/**` | Nuevos: servicios, dominio, autenticación y panel HTML. |
| `supabase/migrations/*.sql` | Nuevos: esquema, restricciones, índices, funciones, grants y RLS/Storage. |
| `js/config.example.js`, `.gitignore` | Plantilla pública; excluir configuración local, `.env*`, credenciales/importaciones/reportes privados y `node_modules/`. |
| `scripts/**`, pruebas de servicios/SQL | Nuevos: dry-run/importador, manifiestos y pruebas de permisos. |
| Configuración de hosting | Preparar rewrite SPA hacia `index.html` para acceso directo a `/admin` y subrutas; definir `base` si se publica en subcarpeta. No existe hoy. |

Configuración pública preparada (todavía no cargada por la interfaz):

```js
window.CALEFICA_CONFIG = Object.freeze({
  dataProvider: "sheets",
  supabaseUrl: "",
  supabasePublishableKey: "",
});
```

Valores recibidos guardados en `js/config.local.js`, con exclusión verificada mediante `git check-ignore`. Es configuración pública, no un almacén secreto. El navegador no interpreta `.env.local`. Para importación, credenciales privadas fuera de los assets publicados.

## 11. Riesgos y mitigaciones

| Riesgo | Medida |
| --- | --- |
| Cambiar comportamiento al separar servicios | Mismas clases/textos, capturas y pruebas antes/después. |
| Migrar solo activos o solo valores de celda | Exportar filas completas, maestro y reglas de validación. |
| Confundir cantidad con disponibilidad o exponer notas | Separar inventario privado y conservar booleano comercial. |
| Perder carritos al cambiar UUID/IDs de aroma | Adaptador con identidad externa y mapa por producto; prueba de carrito previo. |
| Aromas globales con valores distintos por producto | Overrides y resolución explícita de conflictos, sin fusiones por nombre automáticas. |
| Datos inválidos convertidos a cero/9999 | Exportación cruda, validación estricta, informe; no reutilizar coerciones para importar. |
| Caché mezcla proveedores y sigue mostrando bajas | Claves separadas, expiración, reconsulta y error visible. |
| Drive con nombres duplicados, permisos o thumbnails | Manifiesto por ID/hash, lectura sin cambiar permisos y validación de originales. |
| Edición parcial entre producto/aromas/imágenes | Transacciones de metadatos y recuperación de fallos de Storage. |
| Políticas recursivas, columnas internas o URLs públicas | Función de permisos controlada, inventario separado, bucket privado y pruebas por actor. |
| Enlaces o recursos rotos en Hostinger | Probar rutas de archivos, acceso directo a `/admin/` y recursos; desplegar solo archivos públicos. |
| Alterar producción mediante push o Apps Script | Trabajo local; no push/deploy ni cambios a fuentes de producción en esta auditoría. Confirmar destino remoto independiente antes de publicar. |

## 12. Orden y checklist de implementación

### Etapa 1 — completada

- [x] Inventario, arquitectura, integraciones y campos auditados.
- [x] Diseño de modelo, seguridad, importación, riesgos y lista de archivos.
- [x] Ejecución de pruebas existentes y comprobación de sintaxis.
- [x] Interfaz y fuentes de producción conservadas.

### Etapa 2 — autorizada; SQL preparado y probado localmente

- [x] Preparar `.gitignore` y configuración JS de ejemplo/local; documentar sin inventar credenciales.
- [ ] Obtener exportación completa para contrastar este modelo antes de aplicar tablas a un entorno real.
- [ ] Configurar entorno Supabase de desarrollo aislado, Auth sin registro público y primer administrador.
- [x] Versionar SQL de tablas, constraints, índices, timestamps, grants y RLS, incluida función sin recursión.
- [x] Preparar SQL Storage y pruebas PostgreSQL locales por actor, más guía de ejecución en Dashboard.
- [ ] Configurar bucket privado y políticas Storage; probar matriz con visitante/no admin/admin/revocación.
- [ ] Documentar ejecución y recuperación; no tocar datos de producción ni sustituir Sheets.

### Etapa 3 — capa de servicios JavaScript, manteniendo Sheets

- [x] Configurar SDK de versión fija y servicios JS; conservar comportamiento visual.
- [x] Separar consultas mediante servicio de productos, con normalizadores existentes y caché Sheets conservada.
- [x] Añadir clientes separados para sesión administrativa/catálogo público y proveedor seleccionable sin fallback.
- [x] Verificar las pruebas existentes de modal, variantes, carrito y WhatsApp; probar mapeo Supabase y paginación con fixtures.
- [ ] Comparar el catálogo vivo importado y probar imágenes HTTP reales antes de activar Supabase.

### Etapa 4 — importación a desarrollo

- [x] Exportador de solo lectura ejecutado por el usuario; snapshot completo recibido y validado.
- [x] SQL transaccional sin borrados ni sobrescritura de ediciones, probado dos veces con los datos reales en PostgreSQL local.
- [x] Once originales de Drive descargados y verificados; manifiesto con SHA-256 y cargador autenticado preparados.
- [ ] Aplicar el SQL de datos desde SQL Editor y ejecutar el cargador de imágenes en el proyecto real.
- [ ] Comparar catálogo/imagenes reales y confirmar el cambio de proveedor. Ver [IMPORT_GOOGLE_SHEETS.md](IMPORT_GOOGLE_SHEETS.md).

### Etapa 5 — administración privada

- [x] Login/logout y guard implementados; RLS y revocación probados localmente sin depender de la UI.
- [x] Dashboard, CRUD productos, imágenes, categorías, aromas y configuración pública implementados.
- [x] Validaciones, confirmaciones, estados y pruebas del panel en escritorio y celular.
- [ ] Aplicar migración adicional de operaciones administrativas y validar login/escrituras/imágenes en Supabase real desde el navegador del usuario.

### Etapa 6 — validación, publicación y cierre separado

- [ ] Pruebas de servicios/dominio/RLS, responsive y revisión de secretos en archivos a publicar.
- [ ] Previsualización estática con deep links `/admin`; dominio/subcarpeta de Hostinger definidos.
- [ ] Validar cambios del admin en catálogo sin recompilación; pasar explícitamente a Supabase.
- [ ] Confirmar remoto/destino de publicación y plan de rollback antes del despliegue.
- [ ] Retirar Sheets en una etapa posterior autorizada, conservando respaldo/documentación.

## 13. Verificaciones realizadas y límites

- `node --test tests/aromas.test.cjs tests/aromas.browser.test.cjs`: **7 aprobadas, 0 fallidas, 0 omitidas**. El intento inicial dentro del sandbox falló con `spawn EPERM`; la ejecución autorizada fuera del sandbox completó la suite.
- Prueba Edge con API simulada y recursos HTTPS bloqueados: selección de aromas, teclado, variantes/carrito, consulta WhatsApp, temas claro/oscuro y modal a 1440/390/320 px; scroll de detalle extenso a 1366 px de ancho y alturas 900/768/600. Capturas generadas en el directorio temporal informado por la prueba. Esto no certifica visualmente toda la landing ni la API/Drive de producción.
- `node --check js/main.js` y `node --check js/aromas.js`: aprobados.
- Build: **no aplicable todavía**; no existe `package.json` ni script/build configurado. No se agregó tooling solo para simular una compilación en la etapa de auditoría.
- RLS, Auth, Storage, hosting real y datos vivos: pendientes, sin entorno ni credenciales configurados. No se afirma que estén probados.
- Sin tests nuevos en esta etapa documental: no se implementaron servicios ni validaciones nuevas. Sus casos se incorporarán con cada implementación.

Actualización de etapa 2: migraciones preparadas y probadas en PostgreSQL local en memoria mediante PGlite. Se aprobaron 14 pruebas SQL y las 7 existentes de catálogo/Edge. Auth y Storage se simulan localmente, por lo que resta verificar los servicios HTTP reales. Ver [la guía de aplicación](SUPABASE_STAGE_2.md) para ejecutar los archivos desde SQL Editor y configurar Auth. La clave publicable no puede crear tablas. La interfaz pública y el proveedor Sheets siguen conservados.
