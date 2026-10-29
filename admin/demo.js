// Modo demo: datos de ejemplo en memoria para probar el panel en la
// computadora sin Supabase. Solo se activa en localhost. Imita las reglas de
// la base (stock sin negativos, motivo obligatorio, versiones) pero no guarda
// nada: al recargar la página vuelve al estado inicial.
import { ErrorApp, Conflicto } from "./errores.js";

const ahora = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const copia = o => structuredClone(o);
const espera = () => new Promise(r => setTimeout(r, 150));

export function crearApiDemo() {
  const usuarioDemo = { id: uuid(), email: "dueno@fresca.demo" };
  let usuario = null, oyente = () => {};
  const ajustes = { stock_minimo_general: 3, estado_local: "auto", aviso_local: "",
    horarios: { 1: ["12:00", "23:00"], 2: ["12:00", "23:00"], 3: ["12:00", "23:00"], 4: ["12:00", "23:00"], 5: ["12:00", "23:00"], 6: ["16:00", "23:00"], 0: ["16:00", "22:00"] } };
  const base = (o) => ({
    id: uuid(), descripcion: "", presentacion: "", precio: null, precio_promo: null, sku: null, opciones: "",
    stock: 0, stock_minimo: null, activo: true, orden: 0, foto_sitio: null, eliminado_en: null, version: 1,
    creado_en: ahora(), actualizado_en: ahora(), fotos: [], variantes: [], ...o
  });
  // Igual que la base: lista de opciones sin vacíos ni repetidas, y variantes con stock por talle/color
  const lista = t => [...new Set(String(t || "").split(",").map(x => x.trim()).filter(Boolean))];
  const conTalles = (p, stocks) => { p.variantes = lista(p.opciones).map((n, i) => ({ id: uuid(), nombre: n, stock: stocks?.[i] ?? 0, orden: i + 1 }));
    p.stock = p.variantes.reduce((t, v) => t + v.stock, 0); return p; };
  const sincronizar = (p) => {
    if (!p.variantes.length) return;
    const nombres = lista(p.opciones);
    const resto = p.variantes.find(v => v.stock > 0 && !nombres.includes(v.nombre));
    if (resto) throw new ErrorApp(`La opción «${resto.nombre}» todavía tiene ${resto.stock} unidades. Pasala a 0 con «Mover stock» antes de sacarla.`);
    p.variantes = nombres.map((n, i) => ({ ...(p.variantes.find(v => v.nombre === n) || { id: uuid(), nombre: n, stock: 0 }), orden: i + 1 }));
  };
  const productos = [
    conTalles(base({ nombre: "Gorro de lana Fresca", categoria: "Gorros", descripcion: "Gorro tejido con Fresca bordado. Viene en frasco de vidrio, ideal para regalar.", presentacion: "En frasco", precio: 18000, opciones: "Bordó, Negro, Mostaza, Amarillo, Beige", foto_sitio: "gorro.jpg" }), [4, 3, 2, 3, 0]),
    base({ nombre: "Vaso Fresca", categoria: "Vasos", descripcion: "Vaso de vidrio con el logo Fresca est. 2023.", presentacion: "Unidad", precio: 6500, stock: 2, foto_sitio: "vaso.jpg" }),
    conTalles(base({ nombre: "Remera Fresca Pulpo", categoria: "Remeras", descripcion: "Remera negra. Logo chico adelante, ilustración del pulpo en la espalda.", presentacion: "Algodón negro", precio: 25000, precio_promo: 22000, opciones: "S, M, L, XL, XXL", foto_sitio: "remera.jpg" }), [0, 2, 3, 1, 0]),
    base({ nombre: "Remera La cerveza artesanal es mercedina", categoria: "Remeras", descripcion: "Remera negra con frase en la espalda. Corte hombre y mujer.", presentacion: "Algodón negro", precio: 25000, opciones: "Hombre S, Hombre M, Hombre L, Hombre XL, Mujer S, Mujer M, Mujer L", stock: 9, activo: false, foto_sitio: "remera-mercedina.jpg" })
  ];
  const movimientos = [];
  const urls = new Map();
  let idMov = 1, idPed = 1;
  const hace = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  const pedido = (o) => ({ id: idPed++, numero: "", fecha: ahora(), cliente: "", telefono: "", entrega: "Retiro en el local", direccion: "", pago: "Mercado Pago", detalle: "", total: 0, total_texto: "", comentarios: "", estado: "Nuevo", nota_interna: "", stock_descontado: false, version: 1, actualizado_en: ahora(), ...o });
  const pedidos = [
    pedido({ numero: "F2210-2114", fecha: hace(2), cliente: "Lucía Gómez", telefono: "2324 15 555123", detalle: "1 x Gorro de lana Fresca (Bordó) — $18.000\n2 x Vaso Fresca — $13.000", total: 31000, total_texto: "$31.000", comentarios: "Es para regalo" }),
    pedido({ numero: "F2110-1830", fecha: hace(26), cliente: "Martín Pérez", telefono: "+54 9 2324 444888", entrega: "Envío a domicilio", direccion: "Calle 20 N° 450", pago: "Transferencia", detalle: "1 x Remera Fresca Pulpo (L) — $22.000", total: 22000, total_texto: "$22.000", estado: "Confirmado" }),
    pedido({ numero: "F1810-2045", fecha: hace(98), cliente: "Sofía Ruiz", telefono: "2324 556677", pago: "Efectivo", detalle: "3 x Vaso Fresca — $19.500", total: 19500, total_texto: "$19.500", estado: "Entregado", stock_descontado: true }),
    // Algunos más para que la sección Ventas tenga algo que mostrar
    pedido({ numero: "F1610-2210", fecha: hace(150), cliente: "Juan Torres", telefono: "2324 401122", detalle: "2 x Gorro de lana Fresca (Negro) — $36.000\n1 x Remera La cerveza artesanal es mercedina (Hombre M) — $25.000", total: 61000, total_texto: "$61.000", estado: "Pagado" }),
    pedido({ numero: "F1410-1955", fecha: hace(200), cliente: "Ana Díaz", telefono: "2324 409988", detalle: "1 x Gorro de lana Fresca (Mostaza) — $18.000\n4 x Vaso Fresca — $26.000", total: 44000, total_texto: "$44.000", estado: "Entregado" }),
    pedido({ numero: "F1110-2030", fecha: hace(270), cliente: "Pablo Sosa", telefono: "2324 403344", detalle: "2 x Remera Fresca Pulpo (M) — $44.000\n1 x Remera Fresca Pulpo (XL) — $22.000", total: 66000, total_texto: "$66.000", estado: "Entregado" }),
    pedido({ numero: "F0910-1745", fecha: hace(330), cliente: "Carla Ríos", telefono: "2324 405566", detalle: "1 x Remera Fresca Pulpo (S) — $22.000", total: 22000, total_texto: "$22.000", estado: "Cancelado" }),
    pedido({ numero: "F2809-2120", fecha: hace(600), cliente: "Diego Luna", telefono: "2324 407788", detalle: "6 x Vaso Fresca — $39.000\n1 x Gorro de lana Fresca (Beige) — $18.000", total: 57000, total_texto: "$57.000", estado: "Entregado" })
  ];

  const vivo = (id) => {
    const p = productos.find(x => x.id === id && !x.eliminado_en);
    if (!p) throw new ErrorApp("El producto no existe o fue eliminado.");
    return p;
  };
  const validar = (d) => {
    if (d.nombre !== undefined && (d.nombre.trim().length < 2 || d.nombre.length > 120)) throw new ErrorApp("Algún dato no es válido. Revisá el formulario.");
    if (d.sku && productos.some(p => p.sku === d.sku && p.id !== d.id)) throw new ErrorApp("Ya existe un producto con ese código SKU.");
  };

  return {
    modo: "demo",
    async sesion() { if (/type=recovery/.test(location.hash)) usuario = usuarioDemo; return usuario; }, // simula el enlace del mail
    alCambiarSesion(fn) { oyente = fn; },
    async entrar(email, clave) {
      await espera();
      if (!email || !clave) throw new ErrorApp("Correo o contraseña incorrectos.");
      usuario = { ...usuarioDemo, email }; oyente(usuario); return usuario;
    },
    async salir() { usuario = null; oyente(null); },
    async pedirRecuperacion() { await espera(); },
    async cambiarClave() { await espera(); usuario ??= usuarioDemo; },
    async esAdmin() { return true; },

    async ajustes() { return copia(ajustes); },
    async guardarAjustes(n) { ajustes.stock_minimo_general = n; },
    async guardarLocal(d) {
      await espera();
      if (Object.values(d.horarios).some(h => h && h[0] === h[1])) throw new ErrorApp("Algún dato no es válido. Revisá el formulario.");
      Object.assign(ajustes, copia(d)); return copia({ horarios: ajustes.horarios, estado_local: ajustes.estado_local, aviso_local: ajustes.aviso_local });
    },

    async productos() { await espera(); return copia(productos.filter(p => !p.eliminado_en)); },
    async producto(id) { return copia(productos.find(p => p.id === id) || null); },
    async crearProducto(d) {
      await espera(); validar(d);
      const p = conTalles(base(d)); productos.push(p); return copia(p);
    },
    async actualizarProducto(id, d, version) {
      await espera(); const p = vivo(id);
      if (p.version !== version) throw new Conflicto("Otra persona modificó este producto mientras lo editabas. Recargá la página para ver los cambios.");
      validar({ ...d, id });
      const antes = p.opciones;
      Object.assign(p, d);
      try { sincronizar(p); } catch (e) { p.opciones = antes; throw e; }
      Object.assign(p, { version: p.version + 1, actualizado_en: ahora() }); return copia(p);
    },
    async eliminarProducto(id) {
      await espera(); const p = vivo(id);
      if (movimientos.some(m => m.producto_id === id)) { p.eliminado_en = ahora(); p.activo = false; p.sku = null; p.fotos = []; return "archivado"; }
      productos.splice(productos.indexOf(p), 1); return "eliminado";
    },

    async moverStock(id, tipo, cantidad, motivo, esperado = null, varianteId = null) {
      await espera(); const p = vivo(id); motivo = (motivo || "").trim();
      const v = varianteId ? p.variantes.find(x => x.id === varianteId) : null;
      if (varianteId && !v) throw new ErrorApp("Ese talle o color ya no existe. Recargá la página.");
      if (!v && p.variantes.length) throw new ErrorApp("Elegí el talle o color.");
      const actual = v ? v.stock : p.stock;
      if (!Number.isInteger(cantidad) || cantidad < 0) throw new ErrorApp("La cantidad no es válida.");
      if ((tipo === "ingreso" || tipo === "egreso") && cantidad === 0) throw new ErrorApp("La cantidad tiene que ser mayor a 0.");
      if ((tipo === "egreso" || tipo === "ajuste") && !motivo) throw new ErrorApp("Indicá el motivo del movimiento.");
      if (esperado !== null && esperado !== actual) throw new ErrorApp(`El stock cambió mientras lo editabas (ahora hay ${actual}). Revisalo y volvé a intentar.`);
      if (tipo === "inicial" && movimientos.some(m => m.producto_id === id && (m.variante_id || null) === (varianteId || null))) throw new ErrorApp("Este producto ya tiene stock cargado. Usá un ingreso o un ajuste.");
      const nuevo = tipo === "ingreso" ? actual + cantidad : tipo === "egreso" ? actual - cantidad : cantidad;
      if (nuevo < 0) throw new ErrorApp(`No alcanza el stock: hay ${actual} y querés sacar ${cantidad}.`);
      movimientos.unshift({ id: idMov++, producto_id: id, variante_id: v?.id || null, variante: v?.nombre || "", tipo, cantidad: nuevo - actual, stock_anterior: actual, stock_resultante: nuevo, motivo, usuario_email: usuario?.email, creado_en: ahora(), producto: { nombre: p.nombre } });
      if (v) { v.stock = nuevo; p.stock = p.variantes.reduce((t, x) => t + x.stock, 0); } else p.stock = nuevo;
      return nuevo;
    },
    async separarStock(id, stocks) {
      await espera(); const p = vivo(id);
      if (p.variantes.length) throw new ErrorApp("Este producto ya tiene el stock separado por talle o color.");
      if (stocks.length !== lista(p.opciones).length || stocks.some(n => !Number.isInteger(n) || n < 0)) throw new ErrorApp("Revisá las cantidades: tienen que ser números enteros, 0 o más.");
      const antes = p.stock; conTalles(p, stocks);
      p.variantes.forEach(v => movimientos.unshift({ id: idMov++, producto_id: id, variante_id: v.id, variante: v.nombre, tipo: "ajuste", cantidad: v.stock, stock_anterior: 0, stock_resultante: v.stock, motivo: `Separado por talle o color (antes: ${antes} u. en total)`, usuario_email: usuario?.email, creado_en: ahora(), producto: { nombre: p.nombre } }));
    },
    async movimientos({ productoId } = {}) { await espera(); return copia(movimientos.filter(m => !productoId || m.producto_id === productoId)); },

    async subirFoto(productoId, blob, orden, opcion = null, chica = null) {
      await espera(); const p = vivo(productoId);
      const f = { id: uuid(), ruta: `${productoId}/${uuid()}.webp`, ruta_chica: chica ? `${productoId}/${uuid()}.webp` : null, orden, opcion, principal: !p.fotos.some(x => x.principal) };
      urls.set(f.ruta, URL.createObjectURL(blob)); if (chica) urls.set(f.ruta_chica, URL.createObjectURL(chica));
      p.fotos.push(f); return copia(f);
    },
    async agregarFotoChica(foto, chica) {
      const f = productos.flatMap(p => p.fotos).find(x => x.id === foto.id); if (!f || f.ruta_chica) return null;
      f.ruta_chica = `${foto.ruta.split("/")[0]}/${uuid()}.webp`; urls.set(f.ruta_chica, URL.createObjectURL(chica)); return f.ruta_chica;
    },
    async borrarFoto(foto) {
      const p = productos.find(x => x.fotos.some(f => f.id === foto.id)); if (!p) return;
      p.fotos = p.fotos.filter(f => f.id !== foto.id);
      if (!p.fotos.some(f => f.principal) && p.fotos.length) p.fotos.sort((a, b) => a.orden - b.orden)[0].principal = true;
    },
    async opcionFoto(fotoId, opcion) { const p = productos.find(x => x.fotos.some(f => f.id === fotoId)); p.fotos.find(f => f.id === fotoId).opcion = opcion || null; },
    async fotoPrincipal(fotoId) { const p = productos.find(x => x.fotos.some(f => f.id === fotoId)); p.fotos.forEach(f => f.principal = f.id === fotoId); },
    async ordenarFotos(productoId, ids) { vivo(productoId).fotos.forEach(f => { const i = ids.indexOf(f.id); if (i >= 0) f.orden = i + 1; }); },
    urlFoto(ruta) { return urls.get(ruta) || ""; },

    async pedidos({ estado, desde, hasta, limite = 300 } = {}) {
      await espera();
      return copia(pedidos.filter(p => (!estado || p.estado === estado) && (!desde || p.fecha >= desde) && (!hasta || p.fecha < hasta)).slice(0, limite));
    },
    async ventas({ desde, hasta, limite = 5000 } = {}) {
      await espera();
      return copia(pedidos.filter(p => (!desde || p.fecha >= desde) && (!hasta || p.fecha < hasta)).slice(0, limite));
    },
    // Todo o nada, como la base: primero se revisa que alcance todo y después se descuenta
    async descontarPedido(id, lineas) {
      await espera(); const ped = pedidos.find(x => x.id === id);
      if (!ped) throw new ErrorApp("El pedido no existe.");
      if (ped.stock_descontado) throw new ErrorApp("El stock de este pedido ya se descontó.");
      if (!lineas.length) throw new ErrorApp("No hay artículos para descontar.");
      const quedan = new Map();
      for (const l of lineas) {
        const p = vivo(l.producto), v = l.variante ? p.variantes.find(x => x.id === l.variante) : null;
        if (!v && p.variantes.length) throw new ErrorApp(`${p.nombre}: Elegí el talle o color.`);
        const clave = v ? v.id : p.id, hay = quedan.has(clave) ? quedan.get(clave) : (v ? v.stock : p.stock);
        if (hay < l.cantidad) throw new ErrorApp(`${p.nombre}: No alcanza el stock: hay ${hay} y querés sacar ${l.cantidad}.`);
        quedan.set(clave, hay - l.cantidad);
      }
      for (const l of lineas) await this.moverStock(l.producto, "egreso", l.cantidad, "Pedido " + (ped.numero || "#" + ped.id), null, l.variante);
      Object.assign(ped, { stock_descontado: true, version: ped.version + 1, actualizado_en: ahora() }); return copia(ped);
    },
    async contarPedidos(estado) { return pedidos.filter(p => p.estado === estado).length; },
    async actualizarPedido(id, cambios, version) {
      await espera(); const p = pedidos.find(x => x.id === id);
      if (!p || p.version !== version) throw new Conflicto("Este pedido cambió mientras lo mirabas. Se recargó la lista con los datos actuales.");
      Object.assign(p, cambios, { version: p.version + 1, actualizado_en: ahora() }); return copia(p);
    }
  };
}
