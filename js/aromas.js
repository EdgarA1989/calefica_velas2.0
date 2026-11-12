// Normaliza los aromas del catálogo para mostrarlos y seleccionarlos en la tienda.
function normalizeAromas(value) {
  const enabled = (value, fallback) => {
    if (value == null || value === "") return fallback;
    return ["SI", "TRUE", "YES", "1"].includes(String(value).trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase());
  };
  let rows = value;
  if (!Array.isArray(rows)) {
    const text = String(value || "").trim();
    if (!text) return [];
    if (text.startsWith("[")) {
      try { rows = JSON.parse(text); } catch { return []; }
      if (!Array.isArray(rows)) return [];
    } else if (text.includes("|")) {
      rows = text.split(/[;\r\n]+/).filter(row => row.trim()).map(row => {
        const [nombre, color, activo, orden, predeterminado, id] = row.split("|").map(cell => cell.trim());
        return { nombre, color, activo, orden, predeterminado, id };
      });
    } else {
      rows = [{ nombre: text }];
    }
  }
  const seen = new Set();
  return rows.map((row, index) => {
    const item = typeof row === "string" ? { nombre: row } : row || {};
    const nombre = String(item.nombre || "").trim();
    const id = String(item.id || nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()).trim();
    const color = String(item.color || "").trim();
    const order = item.orden == null || item.orden === "" ? index : Number(item.orden);
    return {
      id, nombre,
      color: /^#[0-9a-f]{6}$/i.test(color) ? color : null,
      activo: enabled(item.activo, true),
      orden: Number.isFinite(order) ? order : index,
      predeterminado: enabled(item.predeterminado, false),
    };
  }).filter(item => {
    if (!item.nombre || !item.activo || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).sort((a, b) => a.orden - b.orden);
}
