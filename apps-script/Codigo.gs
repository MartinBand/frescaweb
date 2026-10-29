/**
 * FRESCA · Planilla de productos y pedidos
 * ------------------------------------------------------------
 * - Pestaña "Productos": lo que muestra la web (precios, stock, talles).
 * - Pestaña "Pedidos": cada pedido que se manda desde la web queda anotado acá.
 * - Pestaña "Configuración": link de Mercado Pago, texto de envío y dirección.
 *
 * Primera vez: elegir la función "configurar" arriba y tocar ▶ Ejecutar.
 * Las columnas se leen por su TÍTULO: se pueden reordenar o agregar columnas
 * nuevas al final sin romper nada. Lo que NO hay que cambiar son los títulos
 * ni los nombres de las pestañas.
 */

const HOJA_PRODUCTOS = 'Productos';
const HOJA_PEDIDOS = 'Pedidos';
const HOJA_CONFIG = 'Configuración';

const COLS_PRODUCTOS = ['Categoría', 'Producto', 'Descripción', 'Presentación', 'Precio', 'Opciones', 'Foto', 'Disponible'];
const COLS_PEDIDOS = ['Fecha', 'N° pedido', 'Cliente', 'Teléfono', 'Entrega', 'Dirección', 'Pago', 'Detalle', 'Total', 'Comentarios', 'Estado'];

const EJEMPLOS = [
  ['Gorros', 'Gorro de lana Fresca', 'Gorro tejido con Fresca bordado. Viene en frasco de vidrio, ideal para regalar.', 'En frasco', '', 'Bordó, Negro, Mostaza, Amarillo, Beige', 'gorro.jpg', 'SI'],
  ['Vasos', 'Vaso Fresca', 'Vaso de vidrio con el logo Fresca est. 2023.', 'Unidad', '', '', 'vaso.jpg', 'SI'],
  ['Remeras', 'Remera Fresca Pulpo', 'Remera negra. Logo chico adelante, ilustración del pulpo en la espalda.', 'Algodón negro', '', 'S, M, L, XL, XXL', 'remera.jpg', 'SI'],
  ['Remeras', 'Remera La cerveza artesanal es mercedina', 'Remera negra con frase en la espalda. Corte hombre y mujer.', 'Algodón negro', '', 'Hombre S, Hombre M, Hombre L, Hombre XL, Mujer S, Mujer M, Mujer L', 'remera-mercedina.jpg', 'SI']
];

/** Ejecutar UNA sola vez: crea las pestañas con títulos y ejemplos. */
function configurar() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let prod = ss.getSheetByName(HOJA_PRODUCTOS);
  if (!prod) {
    prod = ss.getSheets()[0].getName().match(/^(Hoja|Sheet)\s?1$/) && ss.getSheets()[0].getLastRow() === 0
      ? ss.getSheets()[0].setName(HOJA_PRODUCTOS)
      : ss.insertSheet(HOJA_PRODUCTOS);
  }
  if (prod.getLastRow() === 0) {
    prod.getRange(1, 1, 1, COLS_PRODUCTOS.length).setValues([COLS_PRODUCTOS]);
    prod.getRange(2, 1, EJEMPLOS.length, COLS_PRODUCTOS.length).setValues(EJEMPLOS);
  }
  formatearEncabezado(prod, COLS_PRODUCTOS.length);
  prod.setColumnWidths(1, COLS_PRODUCTOS.length, 160);
  prod.setColumnWidth(3, 340);
  prod.setColumnWidth(6, 280);
  prod.getRange('E2:E').setNumberFormat('$ #,##0');
  const reglaDisp = SpreadsheetApp.newDataValidation().requireValueInList(['SI', 'NO', 'OCULTAR'], true).build();
  prod.getRange('H2:H').setDataValidation(reglaDisp);

  let ped = ss.getSheetByName(HOJA_PEDIDOS);
  if (!ped) ped = ss.insertSheet(HOJA_PEDIDOS);
  if (ped.getLastRow() === 0) ped.getRange(1, 1, 1, COLS_PEDIDOS.length).setValues([COLS_PEDIDOS]);
  formatearEncabezado(ped, COLS_PEDIDOS.length);
  ped.setColumnWidths(1, COLS_PEDIDOS.length, 130);
  ped.setColumnWidth(8, 360);
  ped.getRange('I2:I').setNumberFormat('$ #,##0');
  const reglaEstado = SpreadsheetApp.newDataValidation().requireValueInList(['Nuevo', 'Confirmado', 'Pagado', 'Entregado', 'Cancelado'], true).build();
  ped.getRange('K2:K').setDataValidation(reglaEstado);

  let conf = ss.getSheetByName(HOJA_CONFIG);
  if (!conf) conf = ss.insertSheet(HOJA_CONFIG);
  if (conf.getLastRow() === 0) {
    conf.getRange(1, 1, 4, 3).setValues([
      ['Dato', 'Valor', 'Ayuda'],
      ['Link Mercado Pago', '', 'Pegar acá el link de pago (link.mercadopago.com.ar/...). Vacío = no se muestra el botón.'],
      ['Texto envío', 'El costo de envío se confirma por WhatsApp según la zona.', 'Lo que ve el cliente sobre el envío.'],
      ['Dirección', 'Calle 26 esquina 31, Mercedes', 'Dirección para retiro.']
    ]);
  }
  formatearEncabezado(conf, 3);
  conf.setColumnWidth(1, 170); conf.setColumnWidth(2, 380); conf.setColumnWidth(3, 420);

  ss.setActiveSheet(prod);
  borrarCache();
}

function formatearEncabezado(hoja, n) {
  hoja.getRange(1, 1, 1, n).setFontWeight('bold').setBackground('#111111').setFontColor('#e4e85c');
  hoja.setFrozenRows(1);
}

/** La web pide la lista de productos. */
function doGet(e) {
  const cache = CacheService.getScriptCache();
  let json = cache.get('productos');
  if (!json) {
    json = JSON.stringify({ productos: leerProductos(), config: leerConfig(), actualizado: new Date().toISOString() });
    try { cache.put('productos', json, 60); } catch (err) {} // se renueva cada 60 segundos (si entra en la caché: 100 KB)
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

/**
 * De dónde salen los productos de la web:
 * - Con la propiedad FUENTE_PRODUCTOS = supabase, del panel de administración.
 * - Si no está, de esta planilla, como siempre.
 * - Si Supabase no responde, se usa la última lista buena del panel (hasta 6 horas)
 *   y solo si no hay ninguna, la planilla (que puede tener stock viejo).
 */
function leerProductos() {
  if (prop('FUENTE_PRODUCTOS') === 'supabase' && supabaseConfigurado()) {
    const cache = CacheService.getScriptCache();
    try {
      const lista = leerProductosSupabase();
      try { cache.put('productos_ultimo_panel', JSON.stringify(lista), 21600); } catch (err) {}
      return lista;
    } catch (err) {
      console.error('Supabase no respondió: ' + err);
      const ultima = cache.get('productos_ultimo_panel');
      if (ultima) return JSON.parse(ultima);
    }
  }
  return leerProductosPlanilla();
}

function leerProductosPlanilla() {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_PRODUCTOS);
  if (!hoja || hoja.getLastRow() < 2) return [];
  const datos = hoja.getDataRange().getValues();
  const tit = datos[0].map(t => clave(t));
  const idx = nombre => tit.indexOf(clave(nombre));
  return datos.slice(1)
    .filter(f => String(f[idx('Producto')] || '').trim() !== '')
    .map(f => ({
      categoria: f[idx('Categoría')],
      producto: f[idx('Producto')],
      descripcion: f[idx('Descripción')],
      presentacion: f[idx('Presentación')],
      precio: f[idx('Precio')],
      opciones: f[idx('Opciones')],
      foto: f[idx('Foto')],
      disponible: f[idx('Disponible')]
    }));
}

function leerConfig() {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_CONFIG);
  const out = {};
  if (hoja && hoja.getLastRow() >= 2) {
    hoja.getRange(2, 1, hoja.getLastRow() - 1, 2).getValues().forEach(f => {
      const k = clave(f[0]);
      if (k === 'link mercado pago') out.mercadoPago = String(f[1] || '').trim();
      if (k === 'texto envio') out.textoEnvio = String(f[1] || '').trim();
      if (k === 'direccion') out.direccion = String(f[1] || '').trim();
    });
  }
  // Horarios y estado del local, del panel. Si no responde, la web usa los que trae escritos.
  if (prop('FUENTE_PRODUCTOS') === 'supabase' && supabaseConfigurado()) {
    try {
      const a = supa('ajustes?select=horarios,estado_local,aviso_local&id=eq.1')[0];
      if (a) { out.horarios = a.horarios; out.estadoLocal = a.estado_local; out.avisoLocal = a.aviso_local; }
    } catch (err) {
      console.error('No se pudieron leer los horarios: ' + err);
    }
  }
  return out;
}

/** La web manda un pedido nuevo (o el panel avisa que cambió algo, ver refrescarDesdePanel). */
function doPost(e) {
  const responder = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  let d;
  try {
    const cuerpo = JSON.parse(e.postData.contents);
    if (cuerpo && cuerpo.accion === 'refrescar') return responder(refrescarDesdePanel(cuerpo.token));
    d = limpiarPedido(cuerpo);
  } catch (err) {
    return responder({ ok: false, error: 'Pedido inválido' });
  }
  if (demasiadosPedidos()) return responder({ ok: false, error: 'Demasiados pedidos seguidos' });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return responder({ ok: false, error: 'Ocupado, intentá de nuevo' });
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let hoja = ss.getSheetByName(HOJA_PEDIDOS);
    if (!hoja) { configurar(); hoja = ss.getSheetByName(HOJA_PEDIDOS); }
    const tit = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(t => clave(t));
    // Lo que escribe el visitante va como texto: así nada se interpreta como fórmula.
    const texto = v => (/^[=+\-@]/.test(v) ? "'" + v : v);
    const valores = {
      'fecha': new Date(),
      'n° pedido': texto(d.pedido),
      'cliente': texto(d.cliente),
      'telefono': "'" + d.telefono,
      'entrega': texto(d.entrega),
      'direccion': texto(d.direccion),
      'pago': texto(d.pago),
      'detalle': texto(d.detalle),
      'total': d.total,
      'comentarios': texto(d.comentarios),
      'estado': 'Nuevo'
    };
    hoja.appendRow(tit.map(t => (t in valores ? valores[t] : '')));
    SpreadsheetApp.flush();
  } catch (err) {
    return responder({ ok: false, error: 'No se pudo guardar el pedido' });
  } finally {
    lock.releaseLock();
  }
  guardarPedidoSupabase(d); // fuera del bloqueo: si Supabase tarda, no frena otros pedidos
  return responder({ ok: true });
}

/** Deja solo los campos esperados, como texto y con largo máximo. */
function limpiarPedido(o) {
  if (!o || typeof o !== 'object') throw new Error('sin datos');
  const txt = (v, max) => String(v === undefined || v === null ? '' : v).slice(0, max);
  const total = Number(o.total);
  const d = {
    pedido: txt(o.pedido, 40), cliente: txt(o.cliente, 120), telefono: txt(o.telefono, 40),
    entrega: txt(o.entrega, 60), direccion: txt(o.direccion, 200), pago: txt(o.pago, 40),
    detalle: txt(o.detalle, 4000), total: isFinite(total) && total >= 0 && total < 1e9 ? Math.round(total) : 0,
    totalTexto: txt(o.totalTexto, 60), comentarios: txt(o.comentarios, 1000)
  };
  if (!d.cliente.trim() || !d.detalle.trim()) throw new Error('faltan datos');
  return d;
}

/** Freno simple: como máximo 20 pedidos por minuto en total. */
function demasiadosPedidos() {
  const cache = CacheService.getScriptCache();
  const llave = 'pedidos_' + Math.floor(Date.now() / 60000);
  const n = Number(cache.get(llave) || 0) + 1;
  cache.put(llave, String(n), 120);
  return n > 20;
}

/** Cuando se edita Productos o Configuración, la web lo toma al instante. */
function onEdit(e) {
  try {
    const n = e && e.range && e.range.getSheet().getName();
    if (n === HOJA_PRODUCTOS || n === HOJA_CONFIG) borrarCache();
  } catch (err) {}
}

function borrarCache() { CacheService.getScriptCache().remove('productos'); }

/**
 * El panel avisa que guardó un cambio: se borra la copia temporal para que la web
 * lo muestre al recargarla, sin esperar el minuto. Solo vale si quien avisa es un
 * admin con la sesión iniciada: se comprueba su sesión con Supabase.
 */
function refrescarDesdePanel(token) {
  if (prop('FUENTE_PRODUCTOS') !== 'supabase' || !supabaseConfigurado()) return { ok: false };
  if (typeof token !== 'string' || token.length < 20 || token.length > 4000) return { ok: false };
  const r = UrlFetchApp.fetch(prop('SUPABASE_URL').replace(/\/$/, '') + '/auth/v1/user', {
    headers: { apikey: prop('SUPABASE_SECRET_KEY'), Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  if (r.getResponseCode() !== 200) return { ok: false };
  const id = String(JSON.parse(r.getContentText()).id || '');
  if (!/^[0-9a-f-]{36}$/.test(id) || !supa('admins?select=user_id&user_id=eq.' + id).length) return { ok: false };
  borrarCache();
  return { ok: true };
}

function clave(t) {
  return String(t).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/* =====================================================================
 * CONEXIÓN CON EL PANEL DE ADMINISTRACIÓN (Supabase)
 * ---------------------------------------------------------------------
 * Configuración (una sola vez): en este editor, ⚙ Configuración del
 * proyecto → Propiedades del script → agregar:
 *   SUPABASE_URL          https://xxxxxxxx.supabase.co
 *   SUPABASE_SECRET_KEY   la clave "secret" (o "service_role") de Supabase.
 *                         Es SECRETA: va solo acá, nunca en la web ni en el panel.
 *   FUENTE_PRODUCTOS      supabase   ← agregarla recién cuando el stock esté
 *                                      cargado en el panel (antes, la web sigue
 *                                      leyendo esta planilla).
 * Después: ejecutar una vez migrarProductosASupabase, migrarPedidosASupabase
 * e instalarMantenimiento (ver LEEME-panel.md).
 * ===================================================================== */

function prop(nombre) { return PropertiesService.getScriptProperties().getProperty(nombre) || ''; }
function supabaseConfigurado() { return Boolean(prop('SUPABASE_URL') && prop('SUPABASE_SECRET_KEY')); }

function supa(ruta, opciones) {
  const o = opciones || {};
  const secreta = prop('SUPABASE_SECRET_KEY');
  const headers = { apikey: secreta };
  if (secreta.indexOf('sb_') !== 0) headers.Authorization = 'Bearer ' + secreta; // claves viejas (JWT)
  if (o.prefer) headers.Prefer = o.prefer;
  const r = UrlFetchApp.fetch(prop('SUPABASE_URL').replace(/\/$/, '') + '/rest/v1/' + ruta, {
    method: o.method || 'get',
    contentType: 'application/json',
    payload: o.payload ? JSON.stringify(o.payload) : undefined,
    headers: headers,
    muteHttpExceptions: true
  });
  const codigo = r.getResponseCode(), texto = r.getContentText();
  if (codigo >= 300) throw new Error('Supabase respondió ' + codigo + ': ' + texto.slice(0, 300));
  return texto ? JSON.parse(texto) : null;
}

/** Productos del panel, con el mismo formato que la planilla (la web no nota la diferencia). */
function leerProductosSupabase() {
  const filas = supa('productos?select=nombre,descripcion,presentacion,categoria,precio,precio_promo,opciones,stock,activo,foto_sitio,' +
    'producto_fotos(ruta,ruta_chica,orden,principal,opcion),producto_variantes(nombre,stock,orden)&eliminado_en=is.null&order=orden.asc,creado_en.asc');
  const baseFotos = prop('SUPABASE_URL').replace(/\/$/, '') + '/storage/v1/object/public/productos/';
  return filas.map(p => {
    const fotos = (p.producto_fotos || []).sort((a, b) => (b.principal - a.principal) || (a.orden - b.orden));
    // Con stock por talle/color, las opciones salen de ahí y se avisa cuáles no tienen unidades
    const variantes = (p.producto_variantes || []).sort((a, b) => a.orden - b.orden);
    return {
      opciones_agotadas: variantes.filter(v => v.stock <= 0).map(v => v.nombre).join(', '),
      categoria: p.categoria,
      producto: p.nombre,
      descripcion: p.descripcion,
      presentacion: p.presentacion,
      precio: p.precio_promo !== null ? p.precio_promo : (p.precio !== null ? p.precio : ''),
      precio_antes: p.precio_promo !== null && p.precio !== null ? p.precio : '', // con promo, la web lo muestra tachado
      opciones: variantes.length ? variantes.map(v => v.nombre).join(', ') : p.opciones,
      foto: fotos.length ? baseFotos + fotos[0].ruta : (p.foto_sitio || ''),
      // Todas las fotos, la principal primero; "opcion" = color o talle que muestra (vacío = general)
      // y "chica" = copia liviana para las tarjetas (vacío = no tiene, se usa la grande)
      fotos: fotos.map(f => ({ url: baseFotos + f.ruta, chica: f.ruta_chica ? baseFotos + f.ruta_chica : '', opcion: f.opcion || '' })),
      disponible: !p.activo ? 'OCULTAR' : (p.stock > 0 ? 'SI' : 'NO')
    };
  });
}

/** Copia el pedido (ya limpio, ver limpiarPedido) al panel. Si falla, igual quedó en la planilla. */
function guardarPedidoSupabase(d) {
  if (!supabaseConfigurado()) return;
  try {
    supa('pedidos', {
      method: 'post', prefer: 'return=minimal',
      payload: {
        numero: d.pedido, cliente: d.cliente, telefono: d.telefono, entrega: d.entrega, direccion: d.direccion,
        pago: d.pago, detalle: d.detalle, total: d.total, total_texto: d.totalTexto, comentarios: d.comentarios
      }
    });
  } catch (err) {
    console.error('No se pudo copiar el pedido a Supabase: ' + err);
  }
}

/** Ejecutar UNA vez: pasa los productos de la planilla al panel (con stock 0, para cargarlo después). */
function migrarProductosASupabase() {
  if (!supabaseConfigurado()) throw new Error('Faltan SUPABASE_URL y SUPABASE_SECRET_KEY en las propiedades del script.');
  if (supa('productos?select=id&limit=1').length) throw new Error('El panel ya tiene productos: no se migra de nuevo para no duplicarlos.');
  const filas = leerProductosPlanilla().map((p, i) => {
    const precio = typeof p.precio === 'number' ? p.precio : parseFloat(String(p.precio || '').replace(/[^\d,]/g, '').replace(',', '.'));
    const foto = String(p.foto || '').trim();
    return {
      nombre: String(p.producto).trim().slice(0, 120),
      categoria: (String(p.categoria || '').trim() || 'Otros').slice(0, 40),
      descripcion: String(p.descripcion || '').trim().slice(0, 1000),
      presentacion: String(p.presentacion || '').trim().slice(0, 80),
      precio: isNaN(precio) || precio <= 0 ? null : precio,
      opciones: String(p.opciones || '').trim().slice(0, 500),
      activo: !String(p.disponible || '').toUpperCase().startsWith('OCULT'),
      foto_sitio: /^[A-Za-z0-9._-]{1,100}$/.test(foto) ? foto : null,
      orden: i + 1
    };
  });
  if (filas.length) supa('productos', { method: 'post', payload: filas, prefer: 'return=minimal' });
  console.log('Productos migrados: ' + filas.length + '. Ahora cargá el stock de cada uno en el panel.');
}

/** Ejecutar UNA vez: copia al panel los pedidos que ya están en la planilla. */
function migrarPedidosASupabase() {
  if (!supabaseConfigurado()) throw new Error('Faltan SUPABASE_URL y SUPABASE_SECRET_KEY en las propiedades del script.');
  if (supa('pedidos?select=id&limit=1').length) throw new Error('El panel ya tiene pedidos: no se migra de nuevo para no duplicarlos.');
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_PEDIDOS);
  if (!hoja || hoja.getLastRow() < 2) { console.log('No hay pedidos para migrar.'); return; }
  const datos = hoja.getDataRange().getValues();
  const tit = datos[0].map(t => clave(t));
  const v = (f, nombre) => f[tit.indexOf(nombre)];
  const estados = ['Nuevo', 'Confirmado', 'Pagado', 'Entregado', 'Cancelado'];
  const filas = datos.slice(1).filter(f => v(f, 'n° pedido') || v(f, 'cliente')).map(f => {
    const fecha = v(f, 'fecha');
    return {
      fecha: fecha instanceof Date ? fecha.toISOString() : new Date().toISOString(),
      numero: String(v(f, 'n° pedido') || ''), cliente: String(v(f, 'cliente') || ''),
      telefono: String(v(f, 'telefono') || ''), entrega: String(v(f, 'entrega') || ''),
      direccion: String(v(f, 'direccion') || ''), pago: String(v(f, 'pago') || ''),
      detalle: String(v(f, 'detalle') || ''), total: Number(v(f, 'total')) || 0,
      comentarios: String(v(f, 'comentarios') || ''),
      estado: estados.indexOf(String(v(f, 'estado'))) >= 0 ? String(v(f, 'estado')) : 'Nuevo'
    };
  });
  for (let i = 0; i < filas.length; i += 200) {
    supa('pedidos', { method: 'post', payload: filas.slice(i, i + 200), prefer: 'return=minimal' });
  }
  console.log('Pedidos migrados: ' + filas.length);
}

/** Consulta mínima diaria para que el plan gratis de Supabase no pause el proyecto por inactividad. */
function mantenerActivo() {
  if (supabaseConfigurado()) supa('ajustes?select=id&limit=1');
}

/** Ejecutar UNA vez: programa mantenerActivo todos los días. */
function instalarMantenimiento() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'mantenerActivo').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('mantenerActivo').timeBased().everyDays(1).atHour(6).create();
  mantenerActivo();
  console.log('Listo: Supabase se consulta una vez por día.');
}
