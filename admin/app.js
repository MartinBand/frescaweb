// FRESCA · Panel de administración
// Una sola página: el contenido cambia según el #ancla de la dirección
// (#inicio, #productos, #producto/<id>, #historial, #pedidos, #ventas, #local).
import { ErrorApp, Conflicto } from "./errores.js";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

const ES_LOCAL = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
const CONFIGURADO = Boolean(SUPABASE_URL && SUPABASE_KEY);
const MAX_FOTOS = 8;
const ESTADOS_PEDIDO = ["Nuevo", "Confirmado", "Pagado", "Entregado", "Cancelado"];
const TIPOS_MOV = { inicial: "Carga inicial", ingreso: "Ingreso", egreso: "Egreso", ajuste: "Ajuste" };
const MOTIVOS = ["Compra a proveedor", "Venta en el local", "Venta por WhatsApp", "Rotura o falla", "Conteo de inventario", "Regalo o promoción", "Devolución"];

let api;
const estado = { usuario: null, productos: [], ajustes: { stock_minimo_general: 3 } };
let filtrosProd = { q: "", cat: "", f: "" };
let formSucio = false;

/* ---------- Utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pesos = n => (n === null || n === undefined || n === "") ? "Sin precio" : "$" + Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 });
const fecha = iso => new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const num = v => { const s = String(v ?? "").trim().replace(",", "."); return s === "" ? null : Number(s); };
const entero = v => { const n = num(v); return n === null ? null : (Number.isInteger(n) ? n : NaN); };
const minimoDe = p => p.stock_minimo ?? estado.ajustes.stock_minimo_general;
const nivel = p => p.stock <= 0 ? "agotado" : p.stock <= minimoDe(p) ? "bajo" : "ok";
const NIVEL_TXT = { agotado: "Sin stock", bajo: "Stock bajo", ok: "En stock" };
const ordenFotos = fotos => [...(fotos || [])].sort((a, b) => a.orden - b.orden);
// Stock por talle o color: si un producto tiene variantes, su stock es la suma.
const variantesDe = p => [...(p?.variantes || [])].sort((a, b) => a.orden - b.orden);
const listaOpciones = t => [...new Set(String(t || "").split(",").map(s => s.trim()).filter(Boolean))];
const tallesAgotados = p => p.stock > 0 ? variantesDe(p).filter(v => v.stock <= 0) : [];
const resumenTalles = p => variantesDe(p).map(v => `<span class="${v.stock <= 0 ? "talle-0" : ""}">${esc(v.nombre)}: ${v.stock}</span>`).join(" · ");
function fotoDe(p) {
  const fotos = ordenFotos(p.fotos);
  const f = fotos.find(x => x.principal) || fotos[0];
  if (f) return api.urlFoto(f.ruta_chica || f.ruta);
  return p.foto_sitio ? "../fotos/" + encodeURIComponent(p.foto_sitio) : "";
}
function parsearHash() {
  const [ruta, qs] = location.hash.replace(/^#/, "").split("?");
  return { partes: (ruta || "inicio").split("/"), params: new URLSearchParams(qs || "") };
}

function toast(texto, tipo = "ok") {
  const t = document.createElement("div");
  t.className = "toast " + tipo; t.textContent = texto; t.setAttribute("role", tipo === "error" ? "alert" : "status");
  $("#toasts").appendChild(t);
  setTimeout(() => t.classList.add("fuera"), tipo === "error" ? 6000 : 3000);
  setTimeout(() => t.remove(), tipo === "error" ? 6500 : 3500);
}
function mostrarError(e) {
  if (!(e instanceof ErrorApp)) console.error(e);
  toast(e instanceof ErrorApp ? e.message : "Algo salió mal. Intentá de nuevo.", "error");
}

const modal = () => $("#modal");
function abrirModal(html) { modal().innerHTML = html; modal().showModal(); }
function cerrarModal() { modal().close(); modal().innerHTML = ""; }
function confirmar(titulo, texto, boton = "Eliminar") {
  return new Promise(resolve => {
    abrirModal(`<div class="modal-caja">
      <h2>${esc(titulo)}</h2><p>${esc(texto)}</p>
      <div class="fila-botones"><button type="button" class="btn" data-r="no">Cancelar</button>
      <button type="button" class="btn peligro" data-r="si">${esc(boton)}</button></div></div>`);
    const fin = r => { modal().removeEventListener("close", alCerrar); cerrarModal(); resolve(r); };
    const alCerrar = () => fin(false);
    modal().addEventListener("close", alCerrar);
    modal().querySelectorAll("[data-r]").forEach(b => b.addEventListener("click", () => fin(b.dataset.r === "si")));
  });
}
function cargando(boton, si, texto) {
  if (!boton) return;
  if (si) { boton.dataset.texto = boton.textContent; boton.textContent = texto || "Guardando…"; boton.disabled = true; }
  else { boton.textContent = boton.dataset.texto || boton.textContent; boton.disabled = false; }
}

/* ---------- Inicio y sesión ---------- */
async function iniciar() {
  if (!CONFIGURADO && !ES_LOCAL) {
    return pantallaMensaje("Panel sin configurar", "Falta completar admin/config.js con los datos de Supabase (ver LEEME-panel.md).");
  }
  const demo = ES_LOCAL && (!CONFIGURADO || new URLSearchParams(location.search).has("demo"));
  // El enlace del mail de recuperación vuelve con #access_token=…&type=recovery
  // (o #error=… si venció). Se lee antes de que Supabase limpie la dirección.
  const retorno = new URLSearchParams(location.hash.replace(/^#/, ""));
  const recuperando = retorno.get("type") === "recovery";
  const enlaceVencido = retorno.has("error_code");
  try {
    api = demo ? (await import("./demo.js")).crearApiDemo() : (await import("./api.js")).crearApi();
  } catch (e) {
    console.error(e);
    return pantallaMensaje("No se pudo cargar el panel", "Revisá tu conexión a internet y recargá la página.");
  }
  api.alCambiarSesion(u => { if (!u && estado.usuario) cerrarSesionUI("Se cerró la sesión."); });
  let u = null;
  try { u = await api.sesion(); } catch (e) { console.error(e); }
  if (recuperando || enlaceVencido) { history.replaceState(null, "", location.pathname + location.search); hashAnterior = ""; }
  if (recuperando && u) return pantallaNuevaClave();
  if (enlaceVencido) return pantallaLogin("El enlace para cambiar la contraseña venció o ya se usó. Pedí uno nuevo.");
  if (u && inactivoDemasiado()) {
    await api.salir(); u = null;
    return pantallaLogin("Se cerró la sesión por inactividad. Volvé a ingresar.");
  }
  if (u) await alIngresar(u); else pantallaLogin();
}

/* Cierre de sesión por inactividad: si nadie usa el panel durante este
   tiempo (en ninguna pestaña), se sale solo. La última actividad se anota
   en el navegador para que cuente también al cerrarlo y volver a abrirlo. */
const INACTIVIDAD_MAX = 30 * 60e3;
const CLAVE_ACTIVIDAD = "fresca_panel_actividad";
let ultimaAnotada = 0;
function anotarActividad() {
  const ahora = Date.now();
  if (ahora - ultimaAnotada < 15e3) return; // no escribir en cada movimiento del mouse
  ultimaAnotada = ahora;
  try { localStorage.setItem(CLAVE_ACTIVIDAD, String(ahora)); } catch (e) { /* sin almacenamiento: se usa solo la pestaña */ }
}
function ultimaActividad() {
  let guardada = 0;
  try { guardada = Number(localStorage.getItem(CLAVE_ACTIVIDAD)) || 0; } catch (e) {}
  return Math.max(guardada, ultimaAnotada);
}
const inactivoDemasiado = () => { const u = ultimaActividad(); return u > 0 && Date.now() - u > INACTIVIDAD_MAX; };
["pointerdown", "keydown", "scroll", "touchstart"].forEach(ev =>
  addEventListener(ev, () => { if (estado.usuario) anotarActividad(); }, { passive: true, capture: true }));
async function revisarInactividad() {
  if (!estado.usuario || !inactivoDemasiado()) return;
  cerrarSesionUI("Se cerró la sesión por inactividad. Volvé a ingresar."); // se pierde lo no guardado
  await api.salir();
}
// Deja la pantalla de ingreso limpia: sin ventana abierta ni aviso de cambios sin guardar.
function cerrarSesionUI(aviso = "") {
  formSucio = false;
  estado.usuario = null;
  if ($("#modal").open) cerrarModal();
  pantallaLogin(aviso);
}
setInterval(revisarInactividad, 30e3);
document.addEventListener("visibilitychange", () => { if (!document.hidden) revisarInactividad(); });

function pantallaMensaje(titulo, texto) {
  $("#app").innerHTML = `<div class="centro"><div class="caja"><img class="logo-login" src="../fotos/logo-fresca.png" alt="Fresca">
    <h1>${esc(titulo)}</h1><p class="sub">${esc(texto)}</p></div></div>`;
}

// Campo de contraseña con el botón del ojo para mostrarla u ocultarla.
const OJO = '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>';
const OJO_TACHADO = OJO + '<path d="M4 4l16 16"/>';
const campoClave = atributos => `<div class="clave-caja"><input type="password" ${atributos}>
    <button type="button" class="ojo" data-accion="ver-clave" aria-label="Mostrar contraseña" aria-pressed="false">
    <svg viewBox="0 0 24 24" aria-hidden="true">${OJO}</svg></button></div>`;
function alternarClave(boton) {
  const input = boton.previousElementSibling, ver = input.type === "password";
  input.type = ver ? "text" : "password";
  boton.setAttribute("aria-pressed", String(ver));
  boton.setAttribute("aria-label", ver ? "Ocultar contraseña" : "Mostrar contraseña");
  boton.querySelector("svg").innerHTML = ver ? OJO_TACHADO : OJO;
  input.focus();
}

function pantallaLogin(aviso = "") {
  document.body.classList.remove("con-sesion");
  $("#app").innerHTML = `<div class="centro"><form class="caja" id="formLogin" novalidate>
    <img class="logo-login" src="../fotos/logo-fresca.png" alt="Fresca">
    <h1>Panel de administración</h1>
    ${api.modo === "demo" ? `<p class="aviso">Modo demo: ingresá con cualquier correo y contraseña. Nada de lo que hagas se guarda.</p>` : ""}
    ${aviso ? `<p class="aviso">${esc(aviso)}</p>` : ""}
    <label for="email">Correo</label>
    <input id="email" name="email" type="email" autocomplete="username" required>
    <label for="clave">Contraseña</label>
    ${campoClave('id="clave" name="clave" autocomplete="current-password" required')}
    <p class="error" id="errLogin" role="alert"></p>
    <button class="btn primario ancho" type="submit">Ingresar</button>
    <button class="enlace" type="button" data-accion="olvide">¿Olvidaste tu contraseña?</button>
    <a class="volver" href="../">← Volver a la tienda</a>
  </form></div>`;
  $("#email").focus();
}

function pantallaOlvide(email = "") {
  $("#app").innerHTML = `<div class="centro"><form class="caja" id="formOlvide" novalidate>
    <img class="logo-login" src="../fotos/logo-fresca.png" alt="Fresca">
    <h1>Recuperar contraseña</h1>
    <p class="sub">Escribí tu correo y te mandamos un enlace para elegir una contraseña nueva.</p>
    <label for="email">Correo</label>
    <input id="email" name="email" type="email" autocomplete="username" required value="${esc(email)}">
    <p class="error" id="errOlvide" role="alert"></p>
    <button class="btn primario ancho" type="submit">Enviar enlace</button>
    <button class="enlace" type="button" data-accion="ir-login">← Volver a ingresar</button>
  </form></div>`;
  $("#email").focus();
}

const CLAVE_MIN = 10;
const formClave = (boton) => `
    <label for="clave1">Contraseña nueva</label>
    ${campoClave(`id="clave1" name="clave1" autocomplete="new-password" minlength="${CLAVE_MIN}" required`)}
    <small class="sub">Mínimo ${CLAVE_MIN} caracteres.</small>
    <label for="clave2">Repetila</label>
    ${campoClave('id="clave2" name="clave2" autocomplete="new-password" required')}
    <p class="error" id="errClave" role="alert"></p>
    <button class="btn primario ancho" type="submit">${boton}</button>`;

// Se muestra al abrir el enlace del mail. Supabase ya inició sesión (el enlace
// prueba que el correo es tuyo); acá se elige la contraseña nueva.
function pantallaNuevaClave() {
  document.body.classList.remove("con-sesion");
  $("#app").innerHTML = `<div class="centro"><form class="caja" id="formClave" data-origen="mail" novalidate>
    <img class="logo-login" src="../fotos/logo-fresca.png" alt="Fresca">
    <h1>Nueva contraseña</h1>
    ${formClave("Guardar y entrar")}
  </form></div>`;
  $("#clave1").focus();
}

function abrirCambiarClave() {
  abrirModal(`<form class="modal-caja caja-clave" id="formClave" novalidate>
    <h2>Cambiar contraseña</h2>
    ${formClave("Guardar")}
    <div class="fila-botones"><button type="button" class="btn" data-accion="cerrar-modal">Cancelar</button></div>
  </form>`);
  $("#clave1").focus();
}

async function guardarClave(f) {
  const err = $("#errClave"), btn = f.querySelector("button[type=submit]");
  err.textContent = "";
  if (f.clave1.value.length < CLAVE_MIN) { err.textContent = `La contraseña tiene que tener al menos ${CLAVE_MIN} caracteres.`; return; }
  if (f.clave1.value !== f.clave2.value) { err.textContent = "Las dos contraseñas no coinciden."; return; }
  cargando(btn, true);
  try {
    await api.cambiarClave(f.clave1.value);
  } catch (e) {
    err.textContent = e instanceof ErrorApp ? e.message : "No se pudo cambiar la contraseña.";
    return cargando(btn, false);
  }
  toast("Contraseña cambiada.");
  if (f.dataset.origen !== "mail") return cerrarModal();
  const u = await api.sesion();
  if (u) await alIngresar(u); else pantallaLogin("Contraseña cambiada. Ingresá con la nueva.");
}

async function alIngresar(u) {
  try {
    if (!(await api.esAdmin())) {
      await api.salir();
      return pantallaLogin("Esta cuenta no tiene permiso de administrador.");
    }
    estado.usuario = u;
    ultimaAnotada = 0; anotarActividad();
    [estado.productos, estado.ajustes]= await Promise.all([api.productos(), api.ajustes()]);
  } catch (e) {
    mostrarError(e);
    return pantallaLogin();
  }
  pintarMarco();
  enrutar();
  completarFotosChicas();
}

async function recargarProductos() { estado.productos = await api.productos(); }

/* ---------- Marco: encabezado y navegación ---------- */
const ICONOS = {
  inicio: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  productos: '<path d="M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10"/>',
  historial: '<path d="M12 7v5l3 2M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>',
  pedidos: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6"/>',
  ventas: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
  local: '<path d="M4 10v10h16V10M3 10l2-6h14l2 6zM10 20v-5h4v5"/>'
};
const NAV = [["inicio", "Inicio"], ["productos", "Productos"], ["historial", "Stock"], ["pedidos", "Pedidos"], ["ventas", "Ventas"], ["local", "Local"]];
const icono = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONOS[k]}</svg>`;

function pintarMarco() {
  document.body.classList.add("con-sesion");
  const links = NAV.map(([k, t]) => `<a href="#${k}" data-nav="${k}">${icono(k)}<span>${t}</span></a>`).join("");
  $("#app").innerHTML = `
    <header class="top"><div class="wrap">
      <a class="marca" href="#inicio"><img src="../fotos/logo-fresca.png" alt="Fresca"><span>Panel</span></a>
      <nav class="nav" aria-label="Secciones">${links}</nav>
      <div class="usuario"><span title="${esc(estado.usuario.email)}">${esc(estado.usuario.email)}</span>
        <button class="btn chico" data-accion="cambiar-clave" title="Cambiar contraseña">Contraseña</button>
        <button class="btn chico" data-accion="salir">Salir</button></div>
    </div></header>
    ${api.modo === "demo" ? `<div class="banda-demo">MODO DEMO · datos de ejemplo, nada se guarda</div>` : ""}
    <main id="vista" class="wrap" tabindex="-1"></main>
    <nav class="tabbar" aria-label="Secciones">${links}</nav>`;
}

// Cada vista que espera datos se fija, al recibirlos, si sigue siendo la que se ve:
// así una respuesta lenta de un filtro anterior no pisa la del filtro actual.
let vistaActual = 0;
const vigente = () => { const n = vistaActual; return () => n === vistaActual; };

async function enrutar() {
  if (!estado.usuario) return;
  vistaActual++;
  const { partes, params } = parsearHash();
  const seccion = partes[0] === "producto" ? "productos" : partes[0];
  document.querySelectorAll("[data-nav]").forEach(a => a.classList.toggle("on", a.dataset.nav === seccion));
  const v = $("#vista");
  formSucio = false;
  try {
    if (partes[0] === "producto") await vistaProducto(v, partes[1] || "nuevo");
    else if (partes[0] === "productos") vistaProductos(v, params);
    else if (partes[0] === "historial") await vistaHistorial(v, params);
    else if (partes[0] === "pedidos") await vistaPedidos(v, params);
    else if (partes[0] === "ventas") await vistaVentas(v, params);
    else if (partes[0] === "local") vistaLocal(v);
    else vistaInicio(v);
  } catch (e) {
    mostrarError(e);
    v.innerHTML = `<div class="vacio">No se pudo cargar esta sección. <a href="#inicio">Volver al inicio</a></div>`;
  }
  window.scrollTo(0, 0);
}

/* ---------- Inicio ---------- */
function vistaInicio(v) {
  const ps = estado.productos;
  const agot = ps.filter(p => nivel(p) === "agotado"), bajos = ps.filter(p => nivel(p) === "bajo");
  const tarjeta = (titulo, valor, href, clase = "") =>
    `<a class="tarjeta ${clase}" href="${href}"><span class="valor">${valor}</span><span class="etq">${titulo}</span></a>`;
  const parciales = ps.filter(p => nivel(p) === "ok" && tallesAgotados(p).length);
  const reponer = [...agot, ...bajos, ...parciales];
  const detalleReponer = p => tallesAgotados(p).length
    ? `<span class="badge agotado">Sin stock en ${esc(tallesAgotados(p).map(v => v.nombre).join(", "))}</span>`
    : `<span class="badge ${nivel(p)}">${p.stock} u. · ${NIVEL_TXT[nivel(p)]}</span>`;
  const fijo = estado.ajustes.estado_local;
  v.innerHTML = `
    <h1 class="titulo">Inicio</h1>
    ${fijo === "abierto" || fijo === "cerrado" ? `<p class="aviso">La web muestra el local como <b>${fijo}</b> porque lo fijaste a mano, sin mirar los horarios. <a href="#local">Cambiar</a></p>` : ""}
    <div class="tarjetas">
      ${tarjeta("Pedidos nuevos", '<span id="nNuevos">…</span>', "#pedidos?estado=Nuevo", "acento")}
      ${tarjeta("Productos", ps.length, "#productos")}
      ${tarjeta("Visibles en la web", ps.filter(p => p.activo).length, "#productos?f=activos")}
      ${tarjeta("Sin stock", agot.length, "#productos?f=agotados", agot.length ? "rojo" : "")}
      ${tarjeta("Stock bajo", bajos.length, "#productos?f=bajo", bajos.length ? "amarillo" : "")}
    </div>
    <div class="fila-botones izq">
      <a class="btn primario" href="#producto/nuevo">+ Nuevo producto</a>
      <a class="btn" href="#productos">Ver inventario</a>
      <a class="btn" href="#pedidos">Ver pedidos</a>
      <a class="btn" href="#ventas">Ver ventas</a>
    </div>
    <section class="panel">
      <h2>Para reponer</h2>
      ${reponer.length ? `<ul class="lista-simple">${reponer.map(p => `
        <li><span><b>${esc(p.nombre)}</b> ${detalleReponer(p)}</span>
        <button class="btn chico" data-accion="stock" data-id="${p.id}" data-variante="${tallesAgotados(p)[0]?.id || ""}">Mover stock</button></li>`).join("")}</ul>`
        : `<p class="sub">Todo en orden: ningún producto ni talle está agotado o con stock bajo.</p>`}
    </section>
    <section class="panel">
      <h2>Alerta de stock bajo</h2>
      <form id="formAjustes" class="fila-form" novalidate>
        <label for="minGeneral">Avisar cuando queden</label>
        <input id="minGeneral" name="min" type="number" inputmode="numeric" min="0" step="1" value="${estado.ajustes.stock_minimo_general}">
        <span>unidades o menos</span>
        <button class="btn" type="submit">Guardar</button>
      </form>
      <p class="sub">Se aplica a los productos que no tienen su propio mínimo cargado.</p>
    </section>`;
  api.contarPedidos("Nuevo").then(n => { const el = $("#nNuevos"); if (el) el.textContent = n; })
    .catch(() => { const el = $("#nNuevos"); if (el) el.textContent = "—"; });
}

/* ---------- Productos: listado ---------- */
function vistaProductos(v, params) {
  filtrosProd.f = params.get("f") ?? filtrosProd.f;
  const cats = [...new Set(estado.productos.map(p => p.categoria))].sort();
  v.innerHTML = `
    <div class="cabecera"><h1 class="titulo">Productos</h1><a class="btn primario" href="#producto/nuevo">+ Nuevo producto</a></div>
    <div class="filtros">
      <input type="search" id="fq" placeholder="Buscar por nombre o código" value="${esc(filtrosProd.q)}" aria-label="Buscar">
      <select id="fcat" aria-label="Categoría"><option value="">Todas las categorías</option>
        ${cats.map(c => `<option ${c === filtrosProd.cat ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
      <select id="ff" aria-label="Disponibilidad">
        ${[["", "Todos"], ["activos", "Visibles en la web"], ["inactivos", "Ocultos"], ["agotados", "Sin stock"], ["bajo", "Stock bajo"]]
          .map(([k, t]) => `<option value="${k}" ${k === filtrosProd.f ? "selected" : ""}>${t}</option>`).join("")}</select>
    </div>
    <div id="listaProd"></div>`;
  pintarListaProductos();
}

function pintarListaProductos() {
  const cont = $("#listaProd"); if (!cont) return;
  const q = filtrosProd.q.trim().toLowerCase();
  const lista = estado.productos.filter(p =>
    (!q || p.nombre.toLowerCase().includes(q) || (p.sku || "").toLowerCase().includes(q)) &&
    (!filtrosProd.cat || p.categoria === filtrosProd.cat) &&
    (filtrosProd.f !== "activos" || p.activo) && (filtrosProd.f !== "inactivos" || !p.activo) &&
    (filtrosProd.f !== "agotados" || nivel(p) === "agotado") && (filtrosProd.f !== "bajo" || nivel(p) === "bajo"));
  if (!estado.productos.length) {
    cont.innerHTML = `<div class="vacio">Todavía no hay productos cargados.<br><a class="btn primario" href="#producto/nuevo">+ Cargar el primero</a></div>`;
    return;
  }
  if (!lista.length) { cont.innerHTML = `<div class="vacio">Ningún producto coincide con la búsqueda.</div>`; return; }
  cont.innerHTML = `<p class="sub">${lista.length} de ${estado.productos.length} productos</p>` + lista.map(p => {
    const foto = fotoDe(p), nv = nivel(p);
    return `<div class="fila-prod ${p.activo ? "" : "inactivo"}">
      <div class="mini">${foto ? `<img src="${esc(foto)}" alt="" loading="lazy">` : ""}</div>
      <div class="info"><a href="#producto/${p.id}" class="nombre">${esc(p.nombre)}</a>
        <span class="sub">${esc(p.categoria)}${p.sku ? " · " + esc(p.sku) : ""}</span></div>
      <div class="precio">${p.precio_promo != null ? `<s>${pesos(p.precio)}</s> <b>${pesos(p.precio_promo)}</b>` : `<b>${pesos(p.precio)}</b>`}</div>
      <div class="stock"><span class="badge ${nv}">${p.stock} u.</span><small>${NIVEL_TXT[nv]}</small>
        ${p.variantes?.length ? `<small class="talles">${resumenTalles(p)}</small>` : ""}</div>
      <label class="switch" title="Mostrar en la web"><input type="checkbox" data-cambio="activo" data-id="${p.id}" ${p.activo ? "checked" : ""}>
        <span class="pista"></span><em>${p.activo ? "En la web" : "Oculto"}</em></label>
      <div class="botones">
        <button class="btn chico" data-accion="stock" data-id="${p.id}">Stock</button>
        <a class="btn chico" href="#producto/${p.id}">Editar</a>
        <button class="btn chico peligro" data-accion="eliminar" data-id="${p.id}">Eliminar</button>
      </div></div>`;
  }).join("");
}

async function cambiarActivo(input) {
  const p = estado.productos.find(x => x.id === input.dataset.id); if (!p) return;
  input.disabled = true;
  try {
    Object.assign(p, await api.actualizarProducto(p.id, { activo: input.checked }, p.version));
    toast(p.activo ? `"${p.nombre}" ahora se ve en la web.` : `"${p.nombre}" quedó oculto en la web.`);
  } catch (e) {
    mostrarError(e);
    if (e instanceof Conflicto) await recargarProductos().catch(() => {});
  }
  pintarListaProductos();
}

async function eliminar(id) {
  const p = estado.productos.find(x => x.id === id); if (!p) return;
  const si = await confirmar(`¿Eliminar "${p.nombre}"?`,
    "Deja de mostrarse en la web y en el panel. Si el producto tiene movimientos de stock, se archiva para conservar el historial. No se puede deshacer.");
  if (!si) return;
  try {
    const r = await api.eliminarProducto(id);
    estado.productos = estado.productos.filter(x => x.id !== id);
    toast(r === "archivado" ? `"${p.nombre}" se eliminó (el historial de stock se conserva).` : `"${p.nombre}" se eliminó.`);
    formSucio = false; // el producto ya no existe: no hay cambios que cuidar
    if (location.hash.startsWith("#producto/")) location.hash = "#productos"; else enrutar();
  } catch (e) { mostrarError(e); }
}

/* ---------- Productos: alta y edición ---------- */
let edicion = null; // { id, version, fotos: [{id?, ruta?, blob?, url, principal, opcion, opcionGuardada}], borradas: [] }

async function vistaProducto(v, id) {
  const nuevo = id === "nuevo";
  let p = null;
  if (!nuevo) {
    p = estado.productos.find(x => x.id === id) || await api.producto(id);
    if (!p || p.eliminado_en) { v.innerHTML = `<div class="vacio">Ese producto no existe o fue eliminado. <a href="#productos">Volver a productos</a></div>`; return; }
  }
  edicion = {
    id: p?.id || null, version: p?.version || 0,
    fotos: ordenFotos(p?.fotos).map(f => ({ ...f, url: api.urlFoto(f.ruta), opcionGuardada: f.opcion ?? null })), borradas: []
  };
  const cats = [...new Set(estado.productos.map(x => x.categoria))].sort();
  const val = k => esc(p?.[k] ?? "");
  v.innerHTML = `
    <div class="cabecera"><h1 class="titulo" id="tituloForm">${nuevo ? "Nuevo producto" : "Editar producto"}</h1>
      <a class="btn" href="#productos">← Volver</a></div>
    <form id="formProducto" class="form-prod" novalidate>
      <section class="panel">
        <h2>Datos</h2>
        <div class="campos">
          ${campo("nombre", "Nombre *", `<input id="nombre" name="nombre" maxlength="120" required value="${val("nombre")}" placeholder="Ej: Remera Fresca Pulpo">`)}
          ${campo("categoria", "Categoría *", `<input id="categoria" name="categoria" list="listaCats" maxlength="40" required value="${val("categoria")}" placeholder="Ej: Remeras">
            <datalist id="listaCats">${cats.map(c => `<option value="${esc(c)}">`).join("")}</datalist>`)}
          ${campo("descripcion", "Descripción", `<textarea id="descripcion" name="descripcion" maxlength="1000" rows="3">${val("descripcion")}</textarea>`, "ancho")}
          ${campo("presentacion", "Presentación", `<input id="presentacion" name="presentacion" maxlength="80" value="${val("presentacion")}" placeholder="Ej: Algodón negro, En frasco, Unidad">`)}
          ${campo("opciones", "Talles o colores", `<input id="opciones" name="opciones" maxlength="500" value="${val("opciones")}" placeholder="Ej: S, M, L, XL">`, "", "Separados por coma. Vacío si no tiene opciones.")}
          ${campo("precio", "Precio ($)", `<input id="precio" name="precio" type="number" inputmode="decimal" min="0" step="0.01" value="${val("precio")}">`, "", "Vacío = la web muestra «Precio a consultar».")}
          ${campo("precio_promo", "Precio promocional ($)", `<input id="precio_promo" name="precio_promo" type="number" inputmode="decimal" min="0" step="0.01" value="${val("precio_promo")}">`, "", "Opcional. Si está cargado, la web muestra este precio.")}
          ${campo("sku", "Código interno (SKU)", `<input id="sku" name="sku" maxlength="40" value="${val("sku")}" placeholder="Opcional">`)}
          ${campo("orden", "Orden en la web", `<input id="orden" name="orden" type="number" inputmode="numeric" step="1" value="${p?.orden ?? 0}">`, "", "Los números más bajos aparecen primero.")}
        </div>
        <label class="check"><input type="checkbox" name="activo" ${p ? (p.activo ? "checked" : "") : "checked"}> Mostrar en la web</label>
      </section>

      <section class="panel">
        <h2>Fotos</h2>
        ${p?.foto_sitio && !edicion.fotos.length ? `<p class="aviso">Hoy la web usa la foto <b>fotos/${esc(p.foto_sitio)}</b>. Si subís fotos acá, se usan las nuevas.</p>` : ""}
        <div class="fotos" id="fotos"></div>
        <label class="btn subir" id="btnSubir"><input type="file" id="archivos" class="oculto-visual" accept="image/*" multiple> + Agregar fotos</label>
        <p class="sub">Desde la compu o el celular. Se achican solas para que la web cargue rápido. Hasta ${MAX_FOTOS} fotos; la marcada con ★ es la principal.
          Si el producto tiene talles o colores, podés indicar qué color muestra cada foto: la web la muestra al elegirlo.</p>
      </section>

      <section class="panel">
        <h2>Stock</h2>
        <div class="campos">
          ${nuevo
            ? `<div class="campo ancho" id="stockInicialCont">${htmlStockInicial("")}</div>`
            : `<div class="campo ancho"><span class="etq-campo">Stock actual</span><div id="stockActual">${htmlStock(p)}</div></div>`}
          ${campo("stock_minimo", "Avisar con stock bajo en", `<input id="stock_minimo" name="stock_minimo" type="number" inputmode="numeric" min="0" step="1" value="${val("stock_minimo")}" placeholder="General: ${estado.ajustes.stock_minimo_general}">`, "", "Unidades. Vacío = usa el valor general.")}
        </div>
      </section>

      <div class="barra-guardar">
        ${nuevo ? "" : `<button type="button" class="btn peligro" data-accion="eliminar" data-id="${p.id}">Eliminar</button>`}
        <span class="espacio"></span>
        <a class="btn" href="#productos">Cancelar</a>
        <button class="btn primario" type="submit" id="btnGuardar">${nuevo ? "Crear producto" : "Guardar cambios"}</button>
      </div>
    </form>`;
  pintarFotos();
}

// Producto nuevo: un solo stock inicial, o uno por talle/color si se cargaron opciones.
// Al cambiar las opciones se vuelve a dibujar, conservando lo ya escrito.
function htmlStockInicial(opcionesTexto, previos = {}) {
  const opc = listaOpciones(opcionesTexto);
  if (!opc.length) return `<label for="stockInicial">Stock inicial</label>
    <input id="stockInicial" name="stockInicial" type="number" inputmode="numeric" min="0" step="1" value="${esc(previos[""] ?? "0")}">
    <small>Unidades disponibles hoy. Después se ajusta con «Mover stock».</small><p class="error" id="err_stockInicial"></p>`;
  return `<span class="etq-campo">Stock inicial por talle o color</span>
    <div class="talles-stock">${opc.map(o => `<label class="talle-fila"><span>${esc(o)}</span>
      <input name="stockTalle" data-nombre="${esc(o)}" type="number" inputmode="numeric" min="0" step="1" value="${esc(previos[o] ?? "0")}" aria-label="Stock inicial de ${esc(o)}"></label>`).join("")}</div>
    <small>Cada talle o color lleva su propio stock. La web no deja elegir los que estén en 0.</small><p class="error" id="err_stockInicial"></p>`;
}
function redibujarStockInicial() {
  const cont = $("#stockInicialCont"); if (!cont) return;
  const previos = {};
  cont.querySelectorAll("input[name=stockTalle]").forEach(i => previos[i.dataset.nombre] = i.value);
  if ($("#stockInicial")) previos[""] = $("#stockInicial").value;
  const nuevo = listaOpciones($("#opciones").value).join("|");
  if (cont.dataset.opciones === nuevo) return; // no redibujar mientras se escribe lo mismo
  cont.dataset.opciones = nuevo;
  cont.innerHTML = htmlStockInicial($("#opciones").value, previos);
}

// Producto existente: stock total, o el de cada talle/color con su botón para moverlo.
function htmlStock(p) {
  const total = `<span class="badge ${nivel(p)}">${p.stock} u. · ${NIVEL_TXT[nivel(p)]}</span>`;
  const historial = `<a class="btn chico" href="#historial?p=${p.id}">Ver historial</a>`;
  const vs = variantesDe(p);
  if (vs.length) return `<div class="talles-stock">${vs.map(v => `<div class="talle-fila"><span>${esc(v.nombre)}</span>
      <span class="badge ${v.stock <= 0 ? "agotado" : "ok"}">${v.stock} u.</span>
      <button type="button" class="btn chico" data-accion="stock" data-id="${p.id}" data-variante="${v.id}">Mover</button></div>`).join("")}
    <div class="talle-fila total"><span>Total</span>${total}${historial}</div></div>`;
  return `<div class="stock-actual">${total}
      <button type="button" class="btn chico" data-accion="stock" data-id="${p.id}">Mover stock</button>${historial}</div>
    ${listaOpciones(p.opciones).length ? `<p class="aviso">Este producto tiene un solo stock para todos sus talles o colores.
      <button type="button" class="btn chico" data-accion="separar" data-id="${p.id}">Separar por talle o color</button></p>` : ""}`;
}

function campo(nombre, etiqueta, control, clase = "", ayuda = "") {
  return `<div class="campo ${clase}"><label for="${nombre}">${etiqueta}</label>${control}
    ${ayuda ? `<small>${ayuda}</small>` : ""}<p class="error" id="err_${nombre}"></p></div>`;
}

// Lista para elegir qué talle o color muestra la foto (sale de lo escrito en "Talles o colores").
// Si la foto tiene uno que ya no está en la lista, se conserva hasta que se cambie.
function selectOpcionFoto(f, i, opc) {
  if (!opc.length && !f.opcion) return "";
  const lista = f.opcion && !opc.includes(f.opcion) ? [...opc, f.opcion] : opc;
  return `<select class="opcion-foto" data-foto-opcion="${i}" aria-label="Talle o color de la foto ${i + 1}">
    <option value="">Todos los colores</option>
    ${lista.map(o => `<option value="${esc(o)}" ${o === f.opcion ? "selected" : ""}>${esc(o)}${opc.includes(o) ? "" : " (ya no está)"}</option>`).join("")}</select>`;
}

function pintarFotos() {
  const cont = $("#fotos"); if (!cont) return;
  const fs = edicion.fotos;
  const opc = listaOpciones($("#opciones")?.value || "");
  cont.dataset.opciones = opc.join("|");
  if (fs.length && !fs.some(f => f.principal)) fs[0].principal = true;
  cont.innerHTML = fs.length ? fs.map((f, i) => `
    <figure class="foto ${f.principal ? "principal" : ""}">
      <img src="${esc(f.url)}" alt="Foto ${i + 1}">
      ${f.principal ? `<span class="etq-foto">★ Principal</span>` : ""}${f.blob ? `<span class="etq-foto nueva">Sin guardar</span>` : ""}
      <figcaption>
        <button type="button" data-accion="foto-principal" data-i="${i}" title="Usar como principal" ${f.principal ? "disabled" : ""}>★</button>
        <button type="button" data-accion="foto-mover" data-i="${i}" data-d="-1" title="Mover antes" ${i === 0 ? "disabled" : ""}>◀</button>
        <button type="button" data-accion="foto-mover" data-i="${i}" data-d="1" title="Mover después" ${i === fs.length - 1 ? "disabled" : ""}>▶</button>
        <button type="button" data-accion="foto-quitar" data-i="${i}" title="Quitar foto" class="peligro">✕</button>
      </figcaption>${selectOpcionFoto(f, i, opc)}</figure>`).join("") : `<div class="vacio chico">Sin fotos todavía.</div>`;
  $("#btnSubir").classList.toggle("deshabilitado", fs.length >= MAX_FOTOS);
}

// Cada foto se guarda en dos tamaños: la grande (máx. 1200 px, para la vista ampliada)
// y una chica (máx. 480 px, para las tarjetas de la web, que así cargan más rápido).
const LADO_GRANDE = 1200, LADO_CHICA = 480;
// Achica la imagen y la convierte a WebP (o JPG si el navegador no puede).
async function achicar(bmp, lado) {
  const escala = Math.min(1, lado / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * escala); c.height = Math.round(bmp.height * escala);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  let blob = await new Promise(r => c.toBlob(r, "image/webp", 0.82));
  if (!blob || blob.type !== "image/webp") blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.85));
  return blob && blob.size <= 2 * 1024 * 1024 ? blob : null;
}
async function prepararFoto(archivo) {
  if (archivo.type && !archivo.type.startsWith("image/")) throw new ErrorApp(`"${archivo.name}" no es una imagen.`);
  if (archivo.size > 25 * 1024 * 1024) throw new ErrorApp(`"${archivo.name}" es demasiado pesada (más de 25 MB).`);
  let bmp;
  try { bmp = await createImageBitmap(archivo); }
  catch { throw new ErrorApp(`No se pudo leer "${archivo.name}". Probá con una foto JPG o PNG.`); }
  try {
    const blob = await achicar(bmp, LADO_GRANDE);
    if (!blob) throw new ErrorApp(`No se pudo achicar "${archivo.name}". Probá con otra foto.`);
    return { blob, chica: await achicar(bmp, LADO_CHICA) };
  } finally { bmp.close?.(); }
}

// Fotos subidas antes de que hubiera copias chicas: se crean solas, de a una, al entrar al panel.
let completandoChicas = false;
async function completarFotosChicas() {
  if (completandoChicas) return;
  completandoChicas = true;
  for (const f of estado.productos.flatMap(p => p.fotos || []).filter(f => !f.ruta_chica)) {
    if (!estado.usuario) break;
    try {
      const r = await fetch(api.urlFoto(f.ruta)); if (!r.ok) continue;
      const bmp = await createImageBitmap(await r.blob());
      const chica = await achicar(bmp, LADO_CHICA); bmp.close?.();
      if (chica) f.ruta_chica = await api.agregarFotoChica(f, chica);
    } catch (e) { console.warn("No se pudo crear la copia chica de una foto", e); }
  }
  completandoChicas = false;
}

async function agregarFotos(input) {
  const archivos = [...input.files]; input.value = "";
  const ed = edicion; // si mientras tanto se abre otro producto, las fotos no se le pasan
  formSucio = true;
  let sobran = 0;
  for (const a of archivos) {
    if (ed.fotos.length >= MAX_FOTOS) { sobran++; continue; }
    try {
      const { blob, chica } = await prepararFoto(a);
      if (ed !== edicion) return;
      if (ed.fotos.length >= MAX_FOTOS) { sobran++; continue; }
      ed.fotos.push({ blob, chica, url: URL.createObjectURL(blob), principal: false, opcion: null, opcionGuardada: null });
    } catch (e) { mostrarError(e); }
  }
  if (sobran) toast(`${sobran === 1 ? "Una foto quedó" : sobran + " fotos quedaron"} afuera: el máximo es ${MAX_FOTOS}.`, "error");
  pintarFotos();
}

function accionFoto(accion, i, d) {
  const fs = edicion.fotos;
  if (accion === "foto-principal") fs.forEach((f, j) => f.principal = j === i);
  if (accion === "foto-mover") { const j = i + d; if (j >= 0 && j < fs.length) [fs[i], fs[j]] = [fs[j], fs[i]]; }
  if (accion === "foto-quitar") {
    const [f] = fs.splice(i, 1);
    if (f.id) edicion.borradas.push(f); else URL.revokeObjectURL(f.url);
    if (f.principal && fs.length) fs[0].principal = true;
  }
  formSucio = true;
  pintarFotos();
}

function leerProducto(form) {
  const fd = new FormData(form);
  const txt = k => String(fd.get(k) ?? "").trim();
  return {
    datos: {
      nombre: txt("nombre"), categoria: txt("categoria"), descripcion: txt("descripcion"), presentacion: txt("presentacion"),
      opciones: txt("opciones").split(",").map(s => s.trim()).filter(Boolean).join(", "),
      precio: num(fd.get("precio")), precio_promo: num(fd.get("precio_promo")),
      sku: txt("sku") || null, orden: entero(fd.get("orden")) ?? 0,
      stock_minimo: entero(fd.get("stock_minimo")), activo: fd.get("activo") === "on"
    },
    stockInicial: fd.has("stockInicial") ? (entero(fd.get("stockInicial")) ?? 0) : null,
    // { "S": 3, "M": 0 } para un producto nuevo con talles o colores
    stockTalles: Object.fromEntries([...form.querySelectorAll("input[name=stockTalle]")].map(i => [i.dataset.nombre, entero(i.value) ?? 0]))
  };
}

function validarProducto({ datos: d, stockInicial, stockTalles }) {
  const e = {};
  if (d.nombre.length < 2) e.nombre = "Escribí el nombre (mínimo 2 letras).";
  if (d.categoria.length < 2) e.categoria = "Elegí o escribí una categoría.";
  if (d.precio !== null && !(d.precio >= 0)) e.precio = "Ingresá un precio válido (0 o más).";
  if (d.precio_promo !== null) {
    if (!(d.precio_promo >= 0)) e.precio_promo = "Ingresá un precio válido.";
    else if (d.precio === null) e.precio_promo = "Primero cargá el precio normal.";
    else if (d.precio_promo >= d.precio) e.precio_promo = "Tiene que ser menor al precio normal.";
  }
  if (d.opciones.length > 500) e.opciones = "Demasiadas opciones (máximo 500 caracteres).";
  if (Number.isNaN(d.orden)) e.orden = "Usá un número entero.";
  if (d.stock_minimo !== null && !(d.stock_minimo >= 0)) e.stock_minimo = "Usá un número entero, 0 o más.";
  if (stockInicial !== null && !(stockInicial >= 0 && stockInicial <= 1000000)) e.stockInicial = "Usá un número entero, 0 o más.";
  if (Object.values(stockTalles).some(n => !(n >= 0 && n <= 1000000))) e.stockInicial = "En cada talle o color usá un número entero, 0 o más.";
  if (listaOpciones(d.opciones).some(o => o.length > 60)) e.opciones = "Cada talle o color puede tener hasta 60 letras.";
  return e;
}

async function guardarProducto(form) {
  const leido = leerProducto(form);
  const errores = validarProducto(leido);
  form.querySelectorAll(".error[id^=err_]").forEach(el => el.textContent = "");
  form.querySelectorAll("[aria-invalid]").forEach(el => el.removeAttribute("aria-invalid"));
  const claves = Object.keys(errores);
  if (claves.length) {
    claves.forEach(k => { $("#err_" + k).textContent = errores[k]; $("#" + k)?.setAttribute("aria-invalid", "true"); });
    $("#" + claves[0])?.focus();
    toast("Revisá los campos marcados.", "error");
    return;
  }
  const btn = $("#btnGuardar");
  cargando(btn, true);
  try {
    let p;
    if (!edicion.id) {
      p = await api.crearProducto(leido.datos);
      edicion.id = p.id; edicion.version = p.version;      // si algo falla después, el próximo guardado edita
      $("#tituloForm").textContent = "Editar producto";
      btn.dataset.texto = "Guardar cambios";
    } else {
      p = await api.actualizarProducto(edicion.id, leido.datos, edicion.version);
      edicion.version = p.version;
    }
    // El stock inicial se reintenta en cada guardado hasta que entra (el campo sigue a la vista)
    if (leido.stockInicial > 0) await api.moverStock(edicion.id, "inicial", leido.stockInicial, "Carga inicial");
    if (Object.values(leido.stockTalles).some(n => n > 0)) {
      const fresco = await api.producto(edicion.id); // las variantes las crea la base con las opciones
      for (const v of variantesDe(fresco)) {
        const n = leido.stockTalles[v.nombre] || 0;
        if (n > 0 && v.stock === 0) await api.moverStock(edicion.id, "inicial", n, "Carga inicial", null, v.id);
      }
    }
    $("#stockInicialCont")?.remove();
    for (const f of edicion.borradas) await api.borrarFoto(f);
    edicion.borradas = [];
    for (const [i, f] of edicion.fotos.entries()) {
      if (f.id) continue;
      const subida = await api.subirFoto(edicion.id, f.blob, i + 1, f.opcion, f.chica);
      Object.assign(f, { id: subida.id, ruta: subida.ruta, ruta_chica: subida.ruta_chica, blob: null, chica: null, opcionGuardada: f.opcion });
    }
    for (const f of edicion.fotos) {
      if ((f.opcion ?? null) === f.opcionGuardada) continue;
      await api.opcionFoto(f.id, f.opcion);
      f.opcionGuardada = f.opcion ?? null;
    }
    if (edicion.fotos.length) {
      await api.ordenarFotos(edicion.id, edicion.fotos.map(f => f.id));
      await api.fotoPrincipal((edicion.fotos.find(f => f.principal) || edicion.fotos[0]).id);
    }
    await recargarProductos();
    formSucio = false;
    toast("Producto guardado. Recargá la web para verlo.");
    location.hash = "#productos";
  } catch (e) {
    mostrarError(e);
    pintarFotos();
  } finally {
    cargando(btn, false);
  }
}

/* ---------- Stock ---------- */
function abrirStock(id, varianteId = "") {
  const p = estado.productos.find(x => x.id === id); if (!p) return;
  const vs = variantesDe(p);
  const elegida = vs.find(v => v.id === varianteId) || vs[0];
  abrirModal(`<form class="modal-caja" id="formStock" novalidate>
    <h2>Mover stock</h2>
    <p class="sub">${esc(p.nombre)}</p>
    ${vs.length ? `<label for="varStock">Talle o color</label>
      <select id="varStock" name="variante">${vs.map(v => `<option value="${v.id}" ${v === elegida ? "selected" : ""}>${esc(v.nombre)} (${v.stock} u.)</option>`).join("")}</select>` : ""}
    <div class="stock-actual">Stock actual: <b id="actualStock">${elegida ? elegida.stock : p.stock}</b> u.</div>
    <fieldset class="segmentado"><legend>¿Qué pasó?</legend>
      <label><input type="radio" name="tipo" value="ingreso" checked> Entraron</label>
      <label><input type="radio" name="tipo" value="egreso"> Salieron</label>
      <label><input type="radio" name="tipo" value="ajuste"> Conté y hay</label>
    </fieldset>
    <label for="cantStock" id="etqCant">Unidades que entraron</label>
    <input id="cantStock" name="cantidad" type="number" inputmode="numeric" min="0" step="1" required>
    <label for="motivoStock">Motivo <span id="motivoOpc">(opcional)</span></label>
    <input id="motivoStock" name="motivo" list="motivos" maxlength="300" placeholder="Ej: Compra a proveedor">
    <datalist id="motivos">${MOTIVOS.map(m => `<option value="${m}">`).join("")}</datalist>
    <div class="resultado">Va a quedar: <b id="resStock">—</b></div>
    <p class="error" id="errStock" role="alert"></p>
    <div class="fila-botones"><button type="button" class="btn" data-accion="cerrar-modal">Cancelar</button>
      <button class="btn primario" type="submit" id="btnStock">Guardar movimiento</button></div>
    <input type="hidden" name="producto" value="${p.id}">
  </form>`);
  $("#cantStock").focus();
  actualizarPreviaStock();
}

function previaStock() {
  const f = $("#formStock"); if (!f) return null;
  const p = estado.productos.find(x => x.id === f.producto.value);
  const v = f.variante ? variantesDe(p).find(x => x.id === f.variante.value) : null;
  const actual = v ? v.stock : p.stock;
  const tipo = f.tipo.value, cant = entero(f.cantidad.value);
  const nuevo = cant === null || Number.isNaN(cant) ? null : tipo === "ingreso" ? actual + cant : tipo === "egreso" ? actual - cant : cant;
  return { f, p, v, actual, tipo, cant, nuevo, motivo: f.motivo.value.trim() };
}
function actualizarPreviaStock() {
  const s = previaStock(); if (!s) return;
  $("#actualStock").textContent = s.actual;
  $("#etqCant").textContent = { ingreso: "Unidades que entraron", egreso: "Unidades que salieron", ajuste: "Unidades que hay realmente" }[s.tipo];
  $("#motivoOpc").textContent = s.tipo === "ingreso" ? "(opcional)" : "(obligatorio)";
  const r = $("#resStock");
  r.textContent = s.nuevo === null ? "—" : `${s.nuevo} u.`;
  r.className = s.nuevo !== null && s.nuevo < 0 ? "neg" : "";
}

async function guardarStock() {
  const s = previaStock(); const err = $("#errStock"); err.textContent = "";
  if (s.cant === null || Number.isNaN(s.cant) || s.cant < 0) return err.textContent = "Ingresá una cantidad entera (0 o más).";
  if (s.tipo !== "ajuste" && s.cant === 0) return err.textContent = "La cantidad tiene que ser mayor a 0.";
  if (s.nuevo < 0) return err.textContent = `No alcanza el stock: hay ${s.actual}.`;
  if (s.tipo !== "ingreso" && !s.motivo) return err.textContent = "Indicá el motivo.";
  const btn = $("#btnStock"); cargando(btn, true);
  try {
    // En un ajuste se manda el stock que se veía: si otro lo cambió mientras tanto, la base lo rechaza.
    const quedo = await api.moverStock(s.p.id, s.tipo, s.cant, s.motivo, s.tipo === "ajuste" ? s.actual : null, s.v?.id || null);
    if (s.v) { s.v.stock = quedo; s.p.stock = s.p.variantes.reduce((t, v) => t + v.stock, 0); }
    else s.p.stock = quedo;
    cerrarModal();
    toast(`Stock de "${s.p.nombre}${s.v ? " (" + s.v.nombre + ")" : ""}": ${quedo} u.`);
    stockCambio(s.p);
  } catch (e) {
    err.textContent = e instanceof ErrorApp ? e.message : "Algo salió mal. Intentá de nuevo.";
    if (!(e instanceof ErrorApp)) console.error(e);
    await recargarProductos().catch(() => {});
    cargando(btn, false);
  }
}

// En la ficha del producto solo se redibuja el stock, para no perder lo que se esté editando
function stockCambio(p) {
  const cont = location.hash.startsWith("#producto/") && $("#stockActual");
  if (cont) cont.innerHTML = htmlStock(p); else enrutar();
}

function abrirSeparar(id) {
  const p = estado.productos.find(x => x.id === id); if (!p) return;
  const opc = listaOpciones(p.opciones);
  abrirModal(`<form class="modal-caja" id="formSeparar" novalidate>
    <h2>Separar stock por talle o color</h2>
    <p class="sub">${esc(p.nombre)} · hoy hay <b>${p.stock}</b> u. en total</p>
    <p>Contá cuántas unidades hay de cada uno. Desde ahora cada talle o color lleva su propio stock y la web no deja elegir los que estén en 0.</p>
    <input type="hidden" name="producto" value="${p.id}">
    <div class="talles-stock">${opc.map(o => `<label class="talle-fila"><span>${esc(o)}</span>
      <input name="cant" type="number" inputmode="numeric" min="0" step="1" value="0" aria-label="Unidades de ${esc(o)}"></label>`).join("")}</div>
    <div class="resultado">Total: <b id="totalSeparar">0</b> u.</div>
    <p class="error" id="errSeparar" role="alert"></p>
    <div class="fila-botones"><button type="button" class="btn" data-accion="cerrar-modal">Cancelar</button>
      <button class="btn primario" type="submit">Separar</button></div>
  </form>`);
  $("#formSeparar input[name=cant]")?.focus();
}
async function guardarSeparar(f) {
  const cants = [...f.querySelectorAll("input[name=cant]")].map(i => entero(i.value) ?? 0);
  if (cants.some(n => !(n >= 0 && n <= 1000000))) return $("#errSeparar").textContent = "Usá números enteros, 0 o más.";
  const btn = f.querySelector("button[type=submit]"); cargando(btn, true);
  try {
    await api.separarStock(f.producto.value, cants);
    await recargarProductos();
    cerrarModal();
    toast("Listo: el stock quedó separado por talle o color.");
    stockCambio(estado.productos.find(x => x.id === f.producto.value));
  } catch (e) {
    $("#errSeparar").textContent = e instanceof ErrorApp ? e.message : "Algo salió mal. Intentá de nuevo.";
    cargando(btn, false);
  }
}

async function vistaHistorial(v, params) {
  const pid = params.get("p") || "";
  v.innerHTML = `<div class="cabecera"><h1 class="titulo">Movimientos de stock</h1></div>
    <div class="filtros"><select id="fhist" aria-label="Producto"><option value="">Todos los productos</option>
      ${estado.productos.map(p => `<option value="${p.id}" ${p.id === pid ? "selected" : ""}>${esc(p.nombre)}</option>`).join("")}</select></div>
    <div id="listaHist" class="cargando">Cargando…</div>`;
  const sigue = vigente();
  const movs = await api.movimientos({ productoId: pid || null });
  const cont = $("#listaHist"); if (!cont || !sigue()) return;
  cont.className = "";
  cont.innerHTML = movs.length ? `<div class="tabla-hist">
    <div class="th"><span>Fecha</span><span>Producto</span><span>Movimiento</span><span>Cambio</span><span>Quedó</span><span>Motivo</span><span>Quién</span></div>
    ${movs.map(m => `<div class="tr">
      <span data-l="Fecha">${fecha(m.creado_en)}</span>
      <span data-l="Producto">${esc(m.producto?.nombre || "—")}${m.variante ? ` <span class="sub">(${esc(m.variante)})</span>` : ""}</span>
      <span data-l="Movimiento">${TIPOS_MOV[m.tipo] || esc(m.tipo)}</span>
      <span data-l="Cambio" class="${m.cantidad > 0 ? "pos" : m.cantidad < 0 ? "neg" : ""}">${m.cantidad > 0 ? "+" : ""}${m.cantidad}</span>
      <span data-l="Quedó">${m.stock_anterior} → <b>${m.stock_resultante}</b></span>
      <span data-l="Motivo">${esc(m.motivo || "—")}</span>
      <span data-l="Quién">${esc(m.usuario_email || "—")}</span></div>`).join("")}</div>`
    : `<div class="vacio">Todavía no hay movimientos${pid ? " para este producto" : ""}.</div>`;
}

/* ---------- Pedidos ---------- */
let pedidosCache = [];
const LIMITE_PEDIDOS = 300, LIMITE_VENTAS = 5000;
function whatsappDe(tel) {
  let d = String(tel || "").replace(/\D/g, "").replace(/^00/, "");
  if (!d) return "";
  // Con o sin +54 / 9 adelante: se arma siempre como 549 + característica + número
  if (d.startsWith("54") && d.length >= 12) d = d.slice(2).replace(/^9/, "");
  d = d.replace(/^0/, "");
  // Número local con «15» (ej. 2324 15 555123): WhatsApp lo necesita sin el 15
  if (d.length === 12) for (const i of [4, 3, 2]) if (d.substr(i, 2) === "15") { d = d.slice(0, i) + d.slice(i + 2); break; }
  return "549" + d;
}

async function vistaPedidos(v, params) {
  const f = { estado: params.get("estado") || "", desde: params.get("desde") || "", hasta: params.get("hasta") || "", q: params.get("q") || "" };
  const enlace = cambios => "#pedidos?" + new URLSearchParams(Object.entries({ ...f, ...cambios }).filter(([, x]) => x)).toString();
  v.innerHTML = `<div class="cabecera"><h1 class="titulo">Pedidos</h1></div>
    <div class="chips">${["", ...ESTADOS_PEDIDO].map(e => `<a class="chip ${e === f.estado ? "on" : ""}" href="${enlace({ estado: e })}">${e || "Todos"}</a>`).join("")}</div>
    <form class="filtros" id="filtrosPedidos">
      <input type="search" name="q" placeholder="Buscar cliente, teléfono o N°" value="${esc(f.q)}" aria-label="Buscar">
      <label class="fecha-f">Desde <input type="date" name="desde" value="${esc(f.desde)}"></label>
      <label class="fecha-f">Hasta <input type="date" name="hasta" value="${esc(f.hasta)}"></label>
      <input type="hidden" name="estado" value="${esc(f.estado)}">
      <button class="btn" type="submit">Filtrar</button>
    </form>
    <div id="listaPed" class="cargando">Cargando pedidos…</div>`;
  const [desde, hasta] = rangoPeriodo("rango", f.desde, f.hasta);
  const sigue = vigente();
  const recibidos = await api.pedidos({ estado: ESTADOS_PEDIDO.includes(f.estado) ? f.estado : null, desde, hasta, limite: LIMITE_PEDIDOS });
  const cont = $("#listaPed"); if (!cont || !sigue()) return;
  pedidosCache = recibidos;
  const q = f.q.trim().toLowerCase();
  const lista = pedidosCache.filter(p => !q || [p.cliente, p.telefono, p.numero].some(x => String(x || "").toLowerCase().includes(q)));
  cont.className = "";
  const tope = pedidosCache.length >= LIMITE_PEDIDOS ? `<p class="aviso">Se muestran los ${LIMITE_PEDIDOS} pedidos más recientes. Usá las fechas para ver los anteriores.</p>` : "";
  cont.innerHTML = tope + (lista.length ? lista.map(pintarPedido).join("")
    : `<div class="vacio">${pedidosCache.length ? "Ningún pedido coincide con la búsqueda." : "No hay pedidos" + (f.estado ? ` en estado «${esc(f.estado)}»` : "") + "."}</div>`);
}

function pintarPedido(p) {
  const wa = whatsappDe(p.telefono);
  const msj = `¡Hola ${p.cliente || ""}! Te escribimos de Fresca por tu pedido ${p.numero || ""}.`;
  return `<article class="pedido e-${p.estado.toLowerCase()}" id="ped-${p.id}">
    <header>
      <div><b>${esc(p.numero || "#" + p.id)}</b> <span class="sub">${fecha(p.fecha)}</span></div>
      <select data-cambio="estado-pedido" data-id="${p.id}" aria-label="Estado del pedido">
        ${ESTADOS_PEDIDO.map(e => `<option ${e === p.estado ? "selected" : ""}>${e}</option>`).join("")}</select>
    </header>
    <div class="cliente"><b>${esc(p.cliente || "Sin nombre")}</b>${!p.telefono ? "" : wa
      ? ` · <a href="tel:${esc(p.telefono.replace(/[^\d+]/g, ""))}">${esc(p.telefono)}</a>`
      : ` · <span class="sub">${esc(p.telefono)}</span>`}</div>
    <pre class="detalle">${esc(p.detalle)}</pre>
    <div class="meta"><span>Total <b>${esc(p.total_texto || pesos(p.total))}</b></span><span>${esc(p.entrega)}${p.direccion ? ": " + esc(p.direccion) : ""}</span><span>${esc(p.pago)}</span></div>
    ${p.comentarios ? `<p class="coment">«${esc(p.comentarios)}»</p>` : ""}
    <div class="nota"><textarea data-nota="${p.id}" maxlength="500" rows="1" placeholder="Nota interna (solo la ven los administradores)" aria-label="Nota interna">${esc(p.nota_interna)}</textarea>
      <button class="btn chico" data-accion="guardar-nota" data-id="${p.id}">Guardar nota</button></div>
    <div class="acciones-ped">
      ${wa ? `<a class="btn whatsapp" href="https://wa.me/${wa}?text=${encodeURIComponent(msj)}" target="_blank" rel="noopener">Escribir por WhatsApp</a>` : ""}
      ${p.stock_descontado ? `<span class="badge ok">✓ Stock descontado</span>`
        : p.estado !== "Cancelado" ? `<button class="btn" data-accion="descontar" data-id="${p.id}">Descontar del stock</button>` : ""}
    </div>
  </article>`;
}

async function actualizarPedido(id, cambios, control) {
  const p = pedidosCache.find(x => x.id === id); if (!p) return;
  if (control) control.disabled = true;
  try {
    Object.assign(p, await api.actualizarPedido(id, cambios, p.version));
    $("#ped-" + id).outerHTML = pintarPedido(p);
    toast(cambios.estado ? `Pedido ${p.numero || "#" + p.id}: ${p.estado}.` : "Nota guardada.");
    if (cambios.estado === "Entregado" && !p.stock_descontado) abrirDescontar(id); // al entregar, se ofrece descontar
  } catch (e) {
    mostrarError(e);
    if (e instanceof Conflicto) enrutar();
    else $("#ped-" + id).outerHTML = pintarPedido(p); // vuelve a mostrar lo que hay guardado
  }
}

/* ---------- Pedidos: descontar del stock ---------- */
// Lee el detalle del pedido y busca cada artículo en el catálogo, con su talle o color.
function articulosDelPedido(ped) {
  const porNombre = new Map(estado.productos.map((p, i) => [normalizar(p.nombre), { p, i }]));
  return String(ped.detalle || "").split("\n").map(l => LINEA_PEDIDO.exec(l)).filter(Boolean).map(m => {
    const texto = m[2].trim(), { prod, nombre } = buscarProducto(texto, porNombre);
    const p = prod?.p || null;
    const opcion = texto.slice(nombre.length).trim().replace(/^\((.*)\)$/, "$1").trim();
    const v = p ? variantesDe(p).find(x => normalizar(x.nombre) === normalizar(opcion)) || null : null;
    return { texto, cant: Number(m[1]), p, v };
  });
}
const conTalles = a => a.p && variantesDe(a.p).length > 0;
const stockDe = a => a.v ? a.v.stock : a.p.stock;
const listoParaDescontar = a => a.p && a.cant > 0 && (!conTalles(a) || a.v) && stockDe(a) >= a.cant;
function estadoArticulo(a) {
  if (conTalles(a) && !a.v) return ["neg", "Elegí el talle o color."];
  const hay = stockDe(a);
  return hay >= a.cant ? ["", `Hay ${hay} → quedan ${hay - a.cant}.`] : ["neg", `No alcanza: hay ${hay}.`];
}

let descontando = null; // { ped, arts } mientras está abierta la ventana
function abrirDescontar(id) {
  const ped = pedidosCache.find(x => x.id === id); if (!ped || ped.stock_descontado) return;
  const arts = articulosDelPedido(ped);
  descontando = { ped, arts };
  const fila = (a, i) => {
    if (!a.p) return `<div class="desc-fila off"><span><b>${a.cant} ×</b> ${esc(a.texto)}</span>
      <small>No está en el catálogo (¿cambió de nombre o se borró?). Si hace falta, descontalo con «Mover stock».</small></div>`;
    const [clase, txt] = estadoArticulo(a);
    return `<div class="desc-fila">
      <label class="check"><input type="checkbox" name="art" value="${i}" ${listoParaDescontar(a) ? "checked" : ""}> <span><b>${a.cant} ×</b> ${esc(a.p.nombre)}</span></label>
      ${conTalles(a) ? `<select data-art="${i}" aria-label="Talle o color de ${esc(a.p.nombre)}"><option value="">Talle o color…</option>
        ${variantesDe(a.p).map(v => `<option value="${v.id}" ${v === a.v ? "selected" : ""}>${esc(v.nombre)} (${v.stock} u.)</option>`).join("")}</select>` : ""}
      <small id="estArt${i}" class="${clase}">${txt}</small></div>`;
  };
  const hayAlgo = arts.some(a => a.p);
  abrirModal(`<form class="modal-caja" id="formDescontar" novalidate>
    <h2>Descontar del stock</h2>
    <p class="sub">Pedido ${esc(ped.numero || "#" + ped.id)}${ped.cliente ? " · " + esc(ped.cliente) : ""}</p>
    ${arts.length ? `<p>Se registra una salida por cada artículo marcado, con el número de pedido como motivo. Lo que no marques no se descuenta.</p>
      <div class="desc-lista">${arts.map(fila).join("")}</div>` : `<p>No se encontraron artículos en el detalle de este pedido.</p>`}
    <p class="error" id="errDescontar" role="alert"></p>
    <div class="fila-botones"><button type="button" class="btn" data-accion="cerrar-modal">${hayAlgo ? "Ahora no" : "Cerrar"}</button>
      ${hayAlgo ? `<button class="btn primario" type="submit">Descontar</button>` : ""}</div>
  </form>`);
}
function cambiarTalleArticulo(select) {
  const a = descontando?.arts[Number(select.dataset.art)]; if (!a) return;
  a.v = variantesDe(a.p).find(v => v.id === select.value) || null;
  const [clase, txt] = estadoArticulo(a), el = $("#estArt" + select.dataset.art);
  el.className = clase; el.textContent = txt;
  select.closest(".desc-fila").querySelector("input[name=art]").checked = listoParaDescontar(a);
}
async function guardarDescontar(f) {
  const { ped, arts } = descontando, err = $("#errDescontar"); err.textContent = "";
  const elegidos = [...f.querySelectorAll("input[name=art]:checked")].map(i => arts[Number(i.value)]);
  if (!elegidos.length) return err.textContent = "Marcá al menos un artículo, o tocá «Ahora no».";
  const sinTalle = elegidos.find(a => conTalles(a) && !a.v);
  if (sinTalle) return err.textContent = `Elegí el talle o color de ${sinTalle.p.nombre}.`;
  const btn = f.querySelector("button[type=submit]"); cargando(btn, true, "Descontando…");
  try {
    Object.assign(ped, await api.descontarPedido(ped.id, elegidos.map(a => ({ producto: a.p.id, variante: a.v?.id || null, cantidad: a.cant }))));
    cerrarModal();
    $("#ped-" + ped.id) && ($("#ped-" + ped.id).outerHTML = pintarPedido(ped));
    toast(`Stock descontado: ${elegidos.reduce((s, a) => s + a.cant, 0)} u. del pedido ${ped.numero || "#" + ped.id}.`);
  } catch (e) {
    err.textContent = e instanceof ErrorApp ? e.message : "Algo salió mal. Intentá de nuevo.";
    if (!(e instanceof ErrorApp)) console.error(e);
    cargando(btn, false);
  }
  await recargarProductos().catch(() => {});
}

/* ---------- Ventas ---------- */
// Se calculan con el texto del pedido que arma la tienda, una línea por artículo:
// "2 x Gorro de lana Fresca (Bordó) — $36.000" o "… — a consultar".
const LINEA_PEDIDO = /^\s*(\d+)\s*x\s+(.+?)(?:\s+—\s+(.*?))?\s*$/;
// "Remera Pulpo (M)" → la remera; "Kit (x2)" → el kit, si así se llama en el catálogo.
// Se prueba primero el texto entero y después cortando en cada " (" de izquierda a derecha.
function buscarProducto(texto, porNombre) {
  const entero = porNombre.get(normalizar(texto));
  if (entero) return { prod: entero, nombre: texto };
  for (let i = texto.indexOf(" ("); i > 0; i = texto.indexOf(" (", i + 1)) {
    const prod = porNombre.get(normalizar(texto.slice(0, i)));
    if (prod) return { prod, nombre: texto.slice(0, i) };
  }
  const corte = texto.lastIndexOf(" (");
  return { prod: null, nombre: corte > 0 && texto.endsWith(")") ? texto.slice(0, corte) : texto };
}
const PERIODOS = [["mes", "Este mes"], ["mesant", "Mes pasado"], ["30", "Últimos 30 días"], ["anio", "Este año"], ["todo", "Todo"], ["rango", "Elegir fechas"]];
const CUENTAN = {
  pagados: { txt: "Pagados y entregados", estados: ["Pagado", "Entregado"] },
  confirmados: { txt: "Confirmados, pagados y entregados", estados: ["Confirmado", "Pagado", "Entregado"] },
  todos: { txt: "Todos menos cancelados", estados: ["Nuevo", "Confirmado", "Pagado", "Entregado"] }
};
// Colores probados para el fondo oscuro del panel (se distinguen también con daltonismo).
const COLORES_TORTA = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9"];
const COLOR_OTROS = "#77707f";
const normalizar = s => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const montoDe = s => { const d = String(s || "").replace(/[^\d,]/g, "").replace(",", "."); return d ? Number(d) : null; };

function rangoPeriodo(p, desde, hasta) {
  const hoy = new Date(), d = (a, m, dia = 1) => new Date(a, m, dia);
  const sig = s => { const x = new Date(s + "T00:00:00"); x.setDate(x.getDate() + 1); return x; };
  const r = {
    mes: [d(hoy.getFullYear(), hoy.getMonth()), null],
    mesant: [d(hoy.getFullYear(), hoy.getMonth() - 1), d(hoy.getFullYear(), hoy.getMonth())],
    "30": [new Date(Date.now() - 30 * 864e5), null],
    anio: [d(hoy.getFullYear(), 0), null],
    todo: [null, null],
    rango: [desde ? new Date(desde + "T00:00:00") : null, hasta ? sig(hasta) : null]
  }[p] || [null, null];
  return r.map(x => x ? x.toISOString() : null);
}

function resumirVentas(pedidos, ver) {
  const porNombre = new Map(estado.productos.map((p, i) => [normalizar(p.nombre), { p, i }]));
  const cats = [...new Set(estado.productos.map(p => p.categoria || "Sin categoría"))];
  const grupos = new Map();
  for (const ped of pedidos) for (const linea of String(ped.detalle || "").split("\n")) {
    const m = LINEA_PEDIDO.exec(linea); if (!m) continue;
    const { prod, nombre: escrito } = buscarProducto(m[2].trim(), porNombre);
    const nombre = ver === "producto" ? (prod?.p.nombre || escrito) : (prod?.p.categoria || "Otros productos");
    // Orden fijo (el del catálogo) para que cada cosa conserve su color al cambiar de período
    const orden = ver === "producto" ? (prod ? prod.i : 1e4) : (prod ? cats.indexOf(prod.p.categoria || "Sin categoría") : 1e4);
    const g = grupos.get(nombre) || { nombre, orden, unidades: 0, pesos: 0 };
    g.unidades += Number(m[1]); g.pesos += montoDe(m[3]) || 0;
    grupos.set(nombre, g);
  }
  // Hasta 7 porciones con color; las más chicas se juntan en "Otros"
  let lista = [...grupos.values()].sort((a, b) => b.unidades - a.unidades);
  if (lista.length > COLORES_TORTA.length) {
    const resto = lista.slice(COLORES_TORTA.length - 1);
    lista = [...lista.slice(0, COLORES_TORTA.length - 1), { nombre: `Otros (${resto.length})`, orden: 2e4, otros: true,
      unidades: resto.reduce((s, g) => s + g.unidades, 0), pesos: resto.reduce((s, g) => s + g.pesos, 0) }];
  }
  lista.sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
  let c = 0;
  return lista.map(g => ({ ...g, color: g.otros ? COLOR_OTROS : COLORES_TORTA[c++] }));
}

function svgTorta(grupos) {
  const total = grupos.reduce((s, g) => s + g.unidades, 0);
  const R = 96, r = 64, punto = (rad, a) => [100 + rad * Math.sin(a), 100 - rad * Math.cos(a)];
  if (grupos.length === 1) {
    return `<path data-i="0" fill="${grupos[0].color}" fill-rule="evenodd" d="M100 4a96 96 0 1 0 .01 0zM100 36a64 64 0 1 0 .01 0z"/>`;
  }
  let a0 = 0;
  return grupos.map((g, i) => {
    const a1 = a0 + g.unidades / total * 2 * Math.PI, grande = a1 - a0 > Math.PI ? 1 : 0;
    const [x1, y1] = punto(R, a0), [x2, y2] = punto(R, a1), [x3, y3] = punto(r, a1), [x4, y4] = punto(r, a0);
    a0 = a1;
    const f = n => n.toFixed(2);
    return `<path data-i="${i}" fill="${g.color}" d="M${f(x1)} ${f(y1)}A${R} ${R} 0 ${grande} 1 ${f(x2)} ${f(y2)}L${f(x3)} ${f(y3)}A${r} ${r} 0 ${grande} 0 ${f(x4)} ${f(y4)}Z"/>`;
  }).join("");
}

let ventasActual = null; // { grupos, total, unidades } para el resaltado al pasar el mouse

async function vistaVentas(v, params) {
  const f = { p: params.get("p") || "mes", cuenta: params.get("cuenta") || "pagados", ver: params.get("ver") || "categoria", desde: params.get("desde") || "", hasta: params.get("hasta") || "" };
  if (!CUENTAN[f.cuenta]) f.cuenta = "pagados";
  const enlace = cambios => "#ventas?" + new URLSearchParams(Object.entries({ ...f, ...cambios }).filter(([, x]) => x)).toString();
  v.innerHTML = `<div class="cabecera"><h1 class="titulo">Ventas</h1></div>
    <div class="chips">${PERIODOS.map(([k, t]) => `<a class="chip ${k === f.p ? "on" : ""}" href="${enlace({ p: k })}">${t}</a>`).join("")}</div>
    <form class="filtros" id="filtrosVentas">
      ${f.p === "rango" ? `<label class="fecha-f">Desde <input type="date" name="desde" value="${esc(f.desde)}"></label>
      <label class="fecha-f">Hasta <input type="date" name="hasta" value="${esc(f.hasta)}"></label>
      <button class="btn" type="submit">Ver</button>` : ""}
      <label class="fecha-f">Cuentan como venta
        <select id="vCuenta">${Object.entries(CUENTAN).map(([k, c]) => `<option value="${k}" ${k === f.cuenta ? "selected" : ""}>${c.txt}</option>`).join("")}</select></label>
      <label class="fecha-f">Agrupar por
        <select id="vVer"><option value="categoria">Categoría</option><option value="producto" ${f.ver === "producto" ? "selected" : ""}>Producto</option></select></label>
    </form>
    <div id="resVentas" class="cargando">Calculando ventas…</div>`;
  v.dataset.enlace = enlace({}); // lo usan los selects para armar la nueva dirección
  const [desde, hasta] = rangoPeriodo(f.p, f.desde, f.hasta);
  const sigue = vigente();
  const todos = await api.ventas({ desde, hasta, limite: LIMITE_VENTAS });
  const cont = $("#resVentas"); if (!cont || !sigue()) return;
  const estados = CUENTAN[f.cuenta].estados;
  const cuentan = todos.filter(p => estados.includes(p.estado));
  const pendientes = todos.filter(p => p.estado !== "Cancelado" && !estados.includes(p.estado)).length;
  const total = cuentan.reduce((s, p) => s + Number(p.total || 0), 0);
  const grupos = resumirVentas(cuentan, f.ver);
  const unidades = grupos.reduce((s, g) => s + g.unidades, 0);
  ventasActual = { grupos, total, unidades };
  cont.className = "";
  const aviso = (pendientes ? `<p class="aviso">${pendientes === 1 ? "Hay 1 pedido" : `Hay ${pendientes} pedidos`} de este período que todavía no cuenta${pendientes === 1 ? "" : "n"} como venta (están nuevos o sin pagar). <a href="#pedidos">Ver pedidos</a></p>` : "")
    + (todos.length >= LIMITE_VENTAS ? `<p class="aviso">Hay demasiados pedidos en este período: se cuentan los ${LIMITE_VENTAS} más recientes. Elegí un período más corto.</p>` : "");
  if (!cuentan.length) {
    cont.innerHTML = aviso + `<div class="vacio">No hay ventas en este período.</div>`;
    return;
  }
  const pct = g => unidades ? Math.round(g.unidades / unidades * 1000) / 10 : 0;
  cont.innerHTML = `${aviso}
    <div class="tarjetas">
      <div class="tarjeta"><span class="valor">${cuentan.length}</span><span class="etq">Pedidos</span></div>
      <div class="tarjeta"><span class="valor">${unidades}</span><span class="etq">Unidades vendidas</span></div>
      <div class="tarjeta"><span class="valor">${pesos(Math.round(total / cuentan.length))}</span><span class="etq">Promedio por pedido</span></div>
    </div>
    <section class="panel ventas">
      <div class="torta">
        <svg viewBox="0 0 200 200" role="img" aria-label="Unidades vendidas por ${f.ver === "producto" ? "producto" : "categoría"}. Total ${esc(pesos(total))}.">${svgTorta(grupos)}</svg>
        <div class="torta-centro" aria-hidden="true"><span class="valor" id="tcValor"></span><span class="etq" id="tcEtq"></span></div>
      </div>
      <table class="leyenda">
        <thead><tr><th>${f.ver === "producto" ? "Producto" : "Categoría"}</th><th>Unidades</th><th>%</th><th>Pesos</th></tr></thead>
        <tbody>${grupos.map((g, i) => `<tr data-i="${i}">
          <td><svg class="muestra" viewBox="0 0 12 12" aria-hidden="true"><rect width="12" height="12" rx="3" fill="${g.color}"/></svg>${esc(g.nombre)}</td>
          <td>${g.unidades}</td><td>${pct(g).toLocaleString("es-AR")}%</td><td>${g.pesos ? pesos(g.pesos) : "—"}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td>Total</td><td>${unidades}</td><td>100%</td><td>${pesos(grupos.reduce((s, g) => s + g.pesos, 0))}</td></tr></tfoot>
      </table>
    </section>
    <p class="sub">Se cuentan los pedidos hechos en la web. Las ventas en el local no están acá. Los artículos sin precio ("a consultar") suman unidades pero no pesos.</p>`;
  resaltarVenta(null);
}

function resaltarVenta(i) {
  if (!ventasActual || !$("#tcValor")) return;
  const g = i === null ? null : ventasActual.grupos[i];
  $("#tcValor").textContent = g ? `${g.unidades} u.` : pesos(ventasActual.total);
  $("#tcEtq").textContent = g ? `${g.nombre} · ${(Math.round(g.unidades / ventasActual.unidades * 1000) / 10).toLocaleString("es-AR")}%` : "Total vendido";
  document.querySelectorAll(".ventas [data-i]").forEach(el => el.classList.toggle("apagado", g !== null && el.dataset.i !== String(i)));
}
document.addEventListener("pointerover", e => {
  const el = e.target.closest?.(".ventas [data-i]");
  if (el) resaltarVenta(Number(el.dataset.i));
});
document.addEventListener("pointerout", e => {
  if (e.target.closest?.(".ventas [data-i]") && !e.relatedTarget?.closest?.(".ventas [data-i]")) resaltarVenta(null);
});

/* ---------- Local: horarios y estado ---------- */
const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0];
const ESTADOS_LOCAL = { auto: "Según los horarios", abierto: "Abierto", cerrado: "Cerrado" };
const aMinutos = s => { const [h, m] = String(s).split(":").map(Number); return h * 60 + m; };
// La misma cuenta que hace la web, con la hora de Argentina. Si la hora de cierre es
// menor que la de apertura, cierra después de medianoche (cuenta para el día siguiente).
function abiertoSegunHorarios(horarios, fecha = new Date()) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Argentina/Buenos_Aires", weekday: "short", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(fecha);
  const g = t => p.find(x => x.type === t).value;
  const dia = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday"));
  const min = (Number(g("hour")) % 24) * 60 + Number(g("minute"));
  const hoy = horarios[dia], ayer = horarios[(dia + 6) % 7];
  if (hoy) { const a = aMinutos(hoy[0]), c = aMinutos(hoy[1]); if (c > a ? min >= a && min < c : min >= a) return true; }
  return Boolean(ayer) && aMinutos(ayer[1]) < aMinutos(ayer[0]) && min < aMinutos(ayer[1]);
}

function vistaLocal(v) {
  const a = estado.ajustes, h = a.horarios || {};
  v.innerHTML = `
    <div class="cabecera"><h1 class="titulo">Local</h1></div>
    <form id="formLocal" novalidate>
      <section class="panel">
        <h2>¿Está abierto?</h2>
        <p class="sub">Arriba de todo, la web muestra «Abierto ahora» o «Cerrado ahora». Normalmente sale de los horarios; si un día abrís o cerrás distinto, fijalo acá.</p>
        <fieldset class="segmentado"><legend class="oculto-visual">Estado del local</legend>
          ${Object.entries(ESTADOS_LOCAL).map(([k, t]) => `<label><input type="radio" name="estado_local" value="${k}" ${(a.estado_local || "auto") === k ? "checked" : ""}> ${t}</label>`).join("")}
        </fieldset>
        <p id="estadoAhora"></p>
        ${campo("aviso_local", "Aviso en la web (opcional)", `<input id="aviso_local" name="aviso_local" maxlength="160" value="${esc(a.aviso_local || "")}" placeholder="Ej: Cerrado por vacaciones hasta el 5 de enero">`, "", "Se ve arriba de los horarios. Vacío = sin aviso.")}
      </section>
      <section class="panel">
        <h2>Horarios de atención</h2>
        <div class="horarios-ed">${ORDEN_DIAS.map(d => `<div class="dia-fila">
          <label class="check"><input type="checkbox" name="abre_${d}" data-dia="${d}" ${h[d] ? "checked" : ""}> ${DIAS[d]}</label>
          <input type="time" name="desde_${d}" value="${esc(h[d]?.[0] || "")}" aria-label="${DIAS[d]}: abre a las" ${h[d] ? "" : "disabled"}>
          <span>a</span>
          <input type="time" name="hasta_${d}" value="${esc(h[d]?.[1] || "")}" aria-label="${DIAS[d]}: cierra a las" ${h[d] ? "" : "disabled"}>
        </div>`).join("")}</div>
        <p class="sub">Los días sin marcar figuran como «Cerrado». Si cierra después de medianoche, poné la hora real (ej.: 20:00 a 02:00).</p>
        <p class="error" id="errLocal" role="alert"></p>
      </section>
      <div class="barra-guardar"><span class="espacio"></span><button class="btn primario" type="submit" id="btnLocal">Guardar cambios</button></div>
    </form>`;
  pintarEstadoAhora();
}
function leerLocal(f) {
  const horarios = {};
  for (const d of ORDEN_DIAS) horarios[d] = f["abre_" + d].checked ? [f["desde_" + d].value.slice(0, 5), f["hasta_" + d].value.slice(0, 5)] : null;
  return { horarios, estado_local: f.estado_local.value, aviso_local: f.aviso_local.value.trim() };
}
function pintarEstadoAhora() {
  const f = $("#formLocal"); if (!f) return;
  const l = leerLocal(f), completos = Object.values(l.horarios).every(h => !h || (h[0] && h[1]));
  const abierto = l.estado_local === "abierto" || (l.estado_local === "auto" && completos && abiertoSegunHorarios(l.horarios));
  $("#estadoAhora").innerHTML = `Con esto, ahora la web muestra: <span class="badge ${abierto ? "ok" : "agotado"}">${abierto ? "Abierto" : "Cerrado"}</span>`;
}
function alternarDia(check) {
  const f = check.form, d = check.dataset.dia;
  for (const [n, def] of [["desde_", "12:00"], ["hasta_", "23:00"]]) {
    const i = f[n + d]; i.disabled = !check.checked;
    if (check.checked && !i.value) i.value = def;
  }
}
async function guardarLocal(f) {
  const err = $("#errLocal"); err.textContent = "";
  const datos = leerLocal(f);
  for (const d of ORDEN_DIAS) {
    const h = datos.horarios[d]; if (!h) continue;
    if (!h[0] || !h[1]) return err.textContent = `Completá a qué hora abre y cierra el ${DIAS[d].toLowerCase()}.`;
    // Sin selector de hora (navegadores viejos) se escribe a mano: tiene que ser 09:30, no 9.30
    if (!h.every(x => /^([01]\d|2[0-3]):[0-5]\d$/.test(x))) return err.textContent = `Revisá las horas del ${DIAS[d].toLowerCase()}: escribilas así, 09:30.`;
    if (h[0] === h[1]) return err.textContent = `El ${DIAS[d].toLowerCase()} abre y cierra a la misma hora.`;
  }
  const btn = $("#btnLocal"); cargando(btn, true);
  try {
    Object.assign(estado.ajustes, await api.guardarLocal(datos));
    formSucio = false;
    toast("Guardado. Recargá la web para verlo.");
  } catch (e) { mostrarError(e); }
  cargando(btn, false);
}

/* ---------- Eventos ---------- */
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-accion]"); if (!b) return;
  const a = b.dataset.accion;
  if (a === "salir") { cerrarSesionUI(); await api.salir(); }
  if (a === "ver-clave") alternarClave(b);
  if (a === "olvide") pantallaOlvide($("#email")?.value.trim());
  if (a === "ir-login") pantallaLogin();
  if (a === "cambiar-clave") abrirCambiarClave();
  if (a === "stock") abrirStock(b.dataset.id, b.dataset.variante);
  if (a === "separar") abrirSeparar(b.dataset.id);
  if (a === "descontar") abrirDescontar(Number(b.dataset.id));
  if (a === "eliminar") eliminar(b.dataset.id);
  if (a === "cerrar-modal") cerrarModal();
  if (a.startsWith("foto-")) accionFoto(a, Number(b.dataset.i), Number(b.dataset.d));
  if (a === "guardar-nota") {
    const id = Number(b.dataset.id);
    actualizarPedido(id, { nota_interna: document.querySelector(`[data-nota="${id}"]`).value.trim() }, b);
  }
});

document.addEventListener("submit", async e => {
  const f = e.target; e.preventDefault();
  const id = f.getAttribute("id");
  if (id === "formLogin") {
    const btn = f.querySelector("button[type=submit]"); $("#errLogin").textContent = "";
    if (!f.email.value.trim() || !f.clave.value) { $("#errLogin").textContent = "Completá el correo y la contraseña."; return; }
    cargando(btn, true, "Ingresando…");
    try { await alIngresar(await api.entrar(f.email.value.trim(), f.clave.value)); }
    catch (err) { $("#errLogin") && ($("#errLogin").textContent = err instanceof ErrorApp ? err.message : "No se pudo ingresar."); cargando(btn, false); }
  }
  if (id === "formOlvide") {
    const btn = f.querySelector("button[type=submit]"), email = f.email.value.trim(); $("#errOlvide").textContent = "";
    if (!/^\S+@\S+\.\S+$/.test(email)) { $("#errOlvide").textContent = "Escribí un correo válido."; return; }
    cargando(btn, true, "Enviando…");
    try {
      await api.pedirRecuperacion(email);
      pantallaLogin(`Si ${email} es una cuenta del panel, te llegó un mail con el enlace (revisá también correo no deseado). El enlace dura 1 hora.`);
    } catch (err) { $("#errOlvide").textContent = err instanceof ErrorApp ? err.message : "No se pudo enviar el mail. Intentá de nuevo."; cargando(btn, false); }
  }
  if (id === "formClave") guardarClave(f);
  if (id === "formProducto") guardarProducto(f);
  if (id === "formStock") guardarStock();
  if (id === "formSeparar") guardarSeparar(f);
  if (id === "formDescontar") guardarDescontar(f);
  if (id === "formLocal") guardarLocal(f);
  if (id === "formAjustes") {
    const n = entero(f.min.value);
    if (n === null || !(n >= 0 && n <= 100000)) return toast("Usá un número entero, 0 o más.", "error");
    try { await api.guardarAjustes(n); estado.ajustes.stock_minimo_general = n; toast("Alerta de stock bajo actualizada."); enrutar(); }
    catch (err) { mostrarError(err); }
  }
  if (id === "filtrosVentas") {
    const p = new URLSearchParams($("#vista").dataset.enlace.split("?")[1]);
    for (const k of ["desde", "hasta"]) { if (f[k]?.value) p.set(k, f[k].value); else p.delete(k); }
    location.hash = "#ventas?" + p.toString();
  }
  if (id === "filtrosPedidos") {
    const fd = new FormData(f);
    location.hash = "#pedidos?" + new URLSearchParams([...fd.entries()].filter(([, x]) => x)).toString();
  }
});

document.addEventListener("input", e => {
  const t = e.target;
  if (t.id === "fq") { filtrosProd.q = t.value; pintarListaProductos(); }
  if (t.closest("#formStock")) actualizarPreviaStock();
  if (t.closest("#formSeparar")) $("#totalSeparar").textContent =
    [...document.querySelectorAll("#formSeparar input[name=cant]")].reduce((s, i) => s + (Math.max(0, entero(i.value)) || 0), 0);
  if (t.closest("#formProducto, #formLocal")) formSucio = true;
  if (t.id === "opciones") {
    redibujarStockInicial();
    if ($("#fotos")?.dataset.opciones !== listaOpciones(t.value).join("|")) pintarFotos();
  }
});

document.addEventListener("change", e => {
  const t = e.target;
  if (t.id === "fcat") { filtrosProd.cat = t.value; pintarListaProductos(); }
  if (t.id === "ff") { filtrosProd.f = t.value; pintarListaProductos(); }
  if (t.id === "vCuenta" || t.id === "vVer") {
    const p = new URLSearchParams($("#vista").dataset.enlace.split("?")[1]);
    p.set(t.id === "vCuenta" ? "cuenta" : "ver", t.value);
    location.hash = "#ventas?" + p.toString();
  }
  if (t.id === "fhist") location.hash = "#historial" + (t.value ? "?p=" + t.value : "");
  if (t.id === "archivos") agregarFotos(t);
  if (t.dataset.fotoOpcion !== undefined && edicion) { edicion.fotos[Number(t.dataset.fotoOpcion)].opcion = t.value || null; formSucio = true; }
  if (t.dataset.cambio === "activo") cambiarActivo(t);
  if (t.dataset.cambio === "estado-pedido") actualizarPedido(Number(t.dataset.id), { estado: t.value }, t);
  if (t.closest("#formStock")) actualizarPreviaStock();
  if (t.dataset.art !== undefined) cambiarTalleArticulo(t);
  if (t.dataset.dia !== undefined) alternarDia(t);
  if (t.closest("#formLocal")) pintarEstadoAhora();
});

let hashAnterior = location.hash;
window.addEventListener("hashchange", () => {
  if (formSucio && !confirm("Hay cambios sin guardar. ¿Salir igual?")) {
    history.replaceState(null, "", hashAnterior);
    return;
  }
  hashAnterior = location.hash;
  if ($("#modal").open) cerrarModal();
  enrutar();
});
window.addEventListener("beforeunload", e => { if (formSucio) { e.preventDefault(); e.returnValue = ""; } });

iniciar();
