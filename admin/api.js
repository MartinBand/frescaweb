// Acceso a Supabase. Cada función devuelve los datos o lanza ErrorApp con un
// mensaje listo para mostrar (sin detalles técnicos ni datos internos).
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY, APPS_SCRIPT_URL } from "./config.js";
import { ErrorApp, Conflicto } from "./errores.js";

const MENSAJES = {
  "23505": "Ya existe un producto con ese código SKU.",
  "23514": "Algún dato no es válido. Revisá el formulario.",
  "22P02": "Algún dato no es válido. Revisá el formulario.",
  "42501": "No tenés permiso para hacer esto.",
  "PGRST301": "Tu sesión venció. Volvé a ingresar."
};

function traducir(error) {
  console.error(error); // el detalle queda solo en la consola del navegador
  if (error.code === "P0001") return new ErrorApp(error.message); // mensajes escritos en la base
  if (MENSAJES[error.code]) return new ErrorApp(MENSAJES[error.code]);
  if (/fetch|network|failed/i.test(error.message || "")) return new ErrorApp("No se pudo conectar. Revisá tu conexión e intentá de nuevo.");
  return new ErrorApp("Algo salió mal. Intentá de nuevo.");
}
const ok = ({ data, error }) => { if (error) throw traducir(error); return data; };

const CAMPOS_PRODUCTO = "*, fotos:producto_fotos(id, ruta, ruta_chica, orden, principal, opcion), variantes:producto_variantes(id, nombre, stock, orden)";
const BUCKET = "productos";

export function crearApi() {
  // "implicit": el enlace del mail funciona aunque se abra en otro navegador o celular.
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { flowType: "implicit" } });
  // Devuelve la ruta o null si no se pudo subir
  async function subirArchivo(productoId, blob) {
    const ruta = `${productoId}/${crypto.randomUUID()}.${blob.type === "image/webp" ? "webp" : "jpg"}`;
    const { error } = await sb.storage.from(BUCKET).upload(ruta, blob, { contentType: blob.type, cacheControl: "31536000", upsert: false });
    if (error) { console.error(error); return null; }
    return ruta;
  }
  // Avisa al Apps Script que algo cambió, así la web lo muestra al recargarla en vez de
  // esperar su copia de 1 minuto. Varios cambios seguidos mandan un solo aviso.
  let avisoPendiente = null;
  function avisarWeb() {
    if (!APPS_SCRIPT_URL) return;
    clearTimeout(avisoPendiente);
    avisoPendiente = setTimeout(async () => {
      const token = (await sb.auth.getSession()).data.session?.access_token;
      if (!token) return;
      fetch(APPS_SCRIPT_URL, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ accion: "refrescar", token }) }).catch(e => console.warn("No se pudo avisar a la web", e));
    }, 1500);
  }

  const api = {
    modo: "real",

    async sesion() { const { data } = await sb.auth.getSession(); return data.session?.user || null; },
    // Manda el mail con el enlace para elegir otra contraseña. Si el correo no
    // existe Supabase no avisa, así nadie puede averiguar qué cuentas hay.
    async pedirRecuperacion(email) {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      if (error) {
        console.error(error);
        throw new ErrorApp(error.status === 429 ? "Se pidieron demasiados mails seguidos. Esperá un rato y volvé a intentar." : "No se pudo enviar el mail. Intentá de nuevo.");
      }
    },
    async cambiarClave(clave) {
      const { error } = await sb.auth.updateUser({ password: clave });
      if (!error) return;
      console.error(error);
      if (error.code === "same_password") throw new ErrorApp("La contraseña nueva tiene que ser distinta de la anterior.");
      if (error.code === "weak_password") throw new ErrorApp("La contraseña es muy débil. Usá una más larga, con letras y números.");
      if (error.status === 401 || error.code === "session_not_found") throw new ErrorApp("El enlace venció. Pedí uno nuevo desde «¿Olvidaste tu contraseña?».");
      throw new ErrorApp("No se pudo cambiar la contraseña. Intentá de nuevo.");
    },
    alCambiarSesion(fn) { sb.auth.onAuthStateChange((_evento, s) => fn(s?.user || null)); },
    async entrar(email, clave) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password: clave });
      if (error) throw new ErrorApp(error.status === 400 ? "Correo o contraseña incorrectos." : "No se pudo ingresar. Intentá de nuevo.");
      return data.user;
    },
    async salir() { await sb.auth.signOut({ scope: "local" }); }, // solo este navegador: no cierra el celular
    async esAdmin() { return ok(await sb.rpc("es_admin")) === true; },

    async ajustes() { return ok(await sb.from("ajustes").select("stock_minimo_general, horarios, estado_local, aviso_local").eq("id", 1).single()); },
    // Horarios, estado (auto / abierto / cerrado) y aviso del local. Devuelve cómo quedaron.
    async guardarLocal(datos) {
      return ok(await sb.from("ajustes").update(datos).eq("id", 1).select("horarios, estado_local, aviso_local").single());
    },
    async guardarAjustes(stockMinimo) { ok(await sb.from("ajustes").update({ stock_minimo_general: stockMinimo }).eq("id", 1)); },

    async productos() {
      return ok(await sb.from("productos").select(CAMPOS_PRODUCTO).is("eliminado_en", null)
        .order("orden").order("creado_en"));
    },
    async crearProducto(datos) { return ok(await sb.from("productos").insert(datos).select(CAMPOS_PRODUCTO).single()); },
    async actualizarProducto(id, datos, version) {
      const fila = ok(await sb.from("productos").update(datos).eq("id", id).eq("version", version)
        .select(CAMPOS_PRODUCTO).maybeSingle());
      if (!fila) throw new Conflicto("Otra persona modificó este producto mientras lo editabas. Recargá la página para ver los cambios.");
      return fila;
    },
    async producto(id) { return ok(await sb.from("productos").select(CAMPOS_PRODUCTO).eq("id", id).maybeSingle()); },
    async eliminarProducto(id) {
      const r = ok(await sb.rpc("eliminar_producto", { p_producto: id }));
      if (r.rutas?.length) await sb.storage.from(BUCKET).remove(r.rutas);
      return r.resultado;
    },

    // Con varianteId mueve el stock de ese talle/color; devuelve cómo quedó (el del talle si hay)
    async moverStock(id, tipo, cantidad, motivo, stockEsperado = null, varianteId = null) {
      return ok(await sb.rpc("mover_stock", {
        p_producto: id, p_tipo: tipo, p_cantidad: cantidad, p_motivo: motivo, p_stock_esperado: stockEsperado, p_variante: varianteId
      }));
    },
    async separarStock(id, stocks) { ok(await sb.rpc("separar_stock", { p_producto: id, p_stocks: stocks })); },
    async movimientos({ productoId, limite = 200 } = {}) {
      let q = sb.from("movimientos_stock").select("*, producto:productos(nombre)")
        .order("creado_en", { ascending: false }).limit(limite);
      if (productoId) q = q.eq("producto_id", productoId);
      return ok(await q);
    },

    // Sube la foto y su copia chica (para las tarjetas de la web). Si la chica
    // falla, la foto queda igual: la web usa la grande.
    async subirFoto(productoId, blob, orden, opcion = null, chica = null) {
      const ruta = await subirArchivo(productoId, blob);
      if (!ruta) throw new ErrorApp("No se pudo subir una foto. Probá con otra imagen o intentá de nuevo.");
      const rutaChica = chica ? await subirArchivo(productoId, chica) : null;
      try {
        return ok(await sb.from("producto_fotos").insert({ producto_id: productoId, ruta, ruta_chica: rutaChica, orden, opcion }).select().single());
      } catch (e) {
        await sb.storage.from(BUCKET).remove([ruta, rutaChica].filter(Boolean));
        throw e;
      }
    },
    // Para fotos subidas antes de que existieran las copias chicas. Devuelve la ruta o null.
    async agregarFotoChica(foto, chica) {
      const ruta = await subirArchivo(foto.ruta.split("/")[0], chica);
      if (!ruta) return null;
      const filas = ok(await sb.from("producto_fotos").update({ ruta_chica: ruta }).eq("id", foto.id).is("ruta_chica", null).select("id"));
      if (filas.length) return ruta;
      await sb.storage.from(BUCKET).remove([ruta]); // la foto ya no está o ya tenía copia chica
      return null;
    },
    async borrarFoto(foto) {
      const filas = ok(await sb.from("producto_fotos").delete().eq("id", foto.id).select("ruta, ruta_chica"));
      const rutas = filas.flatMap(f => [f.ruta, f.ruta_chica]).filter(Boolean);
      if (rutas.length) await sb.storage.from(BUCKET).remove(rutas);
    },
    async opcionFoto(fotoId, opcion) { ok(await sb.from("producto_fotos").update({ opcion: opcion || null }).eq("id", fotoId)); },
    async fotoPrincipal(fotoId) { ok(await sb.rpc("marcar_foto_principal", { p_foto: fotoId })); },
    async ordenarFotos(productoId, ids) { ok(await sb.rpc("ordenar_fotos", { p_producto: productoId, p_ids: ids })); },
    urlFoto(ruta) { return sb.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl; },
    // Descuenta del stock los artículos del pedido, todo junto. Devuelve el pedido actualizado.
    async descontarPedido(id, lineas) { return ok(await sb.rpc("descontar_pedido", { p_pedido: id, p_lineas: lineas })); },

    async pedidos({ estado, desde, hasta, limite = 300 } = {}) {
      let q = sb.from("pedidos").select("*").order("fecha", { ascending: false }).limit(limite);
      if (estado) q = q.eq("estado", estado);
      if (desde) q = q.gte("fecha", desde);
      if (hasta) q = q.lt("fecha", hasta);
      return ok(await q);
    },
    // Para la sección Ventas: solo las columnas que se usan, de todos los estados.
    // Supabase entrega hasta 1000 filas por consulta, así que se piden de a páginas.
    async ventas({ desde, hasta, limite = 5000 } = {}) {
      const filas = [], PAGINA = 1000;
      for (let i = 0; i < limite; i += PAGINA) {
        let q = sb.from("pedidos").select("id, fecha, estado, detalle, total")
          .order("fecha", { ascending: false }).order("id", { ascending: false })
          .range(i, Math.min(i + PAGINA, limite) - 1);
        if (desde) q = q.gte("fecha", desde);
        if (hasta) q = q.lt("fecha", hasta);
        const pagina = ok(await q);
        filas.push(...pagina);
        if (pagina.length < PAGINA) break;
      }
      return filas;
    },
    async contarPedidos(estado) {
      const { count, error } = await sb.from("pedidos").select("id", { count: "exact", head: true }).eq("estado", estado);
      if (error) throw traducir(error);
      return count || 0;
    },
    async actualizarPedido(id, cambios, version) {
      const fila = ok(await sb.from("pedidos").update(cambios).eq("id", id).eq("version", version).select().maybeSingle());
      if (!fila) throw new Conflicto("Este pedido cambió mientras lo mirabas. Se recargó la lista con los datos actuales.");
      return fila;
    }
  };
  // Lo que cambia lo que ve la web
  for (const k of ["crearProducto", "actualizarProducto", "eliminarProducto", "moverStock", "separarStock", "subirFoto",
    "borrarFoto", "opcionFoto", "fotoPrincipal", "ordenarFotos", "descontarPedido", "guardarLocal"]) {
    const original = api[k];
    api[k] = async (...args) => { const r = await original(...args); avisarWeb(); return r; };
  }
  return api;
}
