# Panel de administración de Fresca

Panel privado en `/admin` para manejar productos, fotos, stock y pedidos sin tocar código.

## Cómo funciona

```
Visitante → index.html (sin cambios) → Apps Script /exec → Supabase (productos)
                                             └→ planilla + Supabase (pedidos)
Dueño     → /admin (usuario y contraseña) → Supabase (base de datos + fotos)
```

- **Netlify** publica la página y el panel. Son archivos fijos y no hay funciones de servidor.
- **Supabase**, en el plan gratis, guarda los productos, el stock, el historial, los pedidos y las fotos, y maneja el inicio de sesión.
- **El Apps Script** sigue siendo la dirección que usa la página. Ahora lee los productos de Supabase y responde con el mismo formato de siempre, así que el `index.html` no cambia.
  - Si Supabase no responde, vuelve a leer la planilla.
  - Cada pedido se sigue anotando en la planilla y además se copia a Supabase.
- **Los cambios del panel** se ven en la web apenas la recargás: al guardar, el panel le avisa al script que borre su copia temporal. Si ese aviso no llega (por ejemplo, sin internet en ese momento), igual se actualiza sola en hasta 1 minuto. Una página que ya estaba abierta no cambia hasta que se recarga, salvo el cartel de abierto/cerrado, que se recalcula cada minuto con los horarios que tenía.

## Archivos

| Archivo | Qué es | ¿Se sube a Netlify? |
|---|---|---|
| `index.html`, `robots.txt`, `sitemap.xml`, `preview.jpg`, `fotos/` | La tienda | Sí |
| `admin/` | El panel | Sí |
| `_headers` | Reglas de seguridad del panel | Sí |
| `supabase/schema.sql` | Estructura de la base de datos (se ejecuta en Supabase) | No |
| `apps-script/Codigo.gs` | Código del Apps Script (se pega en Google) | No |
| `fotos-nuevas/` | Fotos originales | No |
| `LEEME-panel.md` | Esta guía | No |

---

## Puesta en marcha (una sola vez)

### 1. Crear la base de datos en Supabase
1. Entrá a [supabase.com](https://supabase.com), creá una cuenta y un proyecto llamado **fresca**, en la región **South America (São Paulo)**.
   - Guardá la contraseña de la base en un lugar seguro.
2. Abrí **SQL Editor → New query**, pegá todo el contenido de `supabase/schema.sql` y tocá **Run**.
3. En **Authentication → Sign In / Providers → Email**, desactivá **Allow new users to sign up**. Así nadie puede crearse una cuenta por su cuenta.
4. En **Authentication → Users → Add user → Create new user**:
   - Cargá tu correo y una contraseña larga.
   - Usá **el mismo correo con el que creaste la cuenta de Supabase**. El servicio de mails gratis de Supabase solo manda mails a las personas del equipo del proyecto, y sin eso no te llegaría el mail para recuperar la contraseña.
   - Marcá **Auto Confirm User**.
5. Volvé a **SQL Editor** y ejecutá esto, con tu correo, para darle permiso de administrador a esa cuenta:
   ```sql
   insert into public.admins (user_id, email)
   select id, email from auth.users where email = 'TU_CORREO@ejemplo.com';
   ```
6. En **Authentication → URL Configuration**, para que funcione "¿Olvidaste tu contraseña?":
   - **Site URL:** `https://fresca-merch.netlify.app/admin/`
   - **Redirect URLs → Add URL:** `https://fresca-merch.netlify.app/admin/`
   - Opcional: en **Authentication → Emails → Reset Password** podés traducir el mail al castellano. Tiene que seguir incluyendo `{{ .ConfirmationURL }}`, que es el enlace.

### 2. Conectar el panel
En Supabase: **Project Settings → API Keys**.
- Copiá la **Project URL** y la clave **publishable** (empieza con `sb_publishable_`).
  - Si tu proyecto muestra claves "legacy", usá la clave `anon`.
- Pegalas en `admin/config.js`:
  ```js
  export const SUPABASE_URL = "https://xxxxxxxx.supabase.co";
  export const SUPABASE_KEY = "sb_publishable_...";
  ```
- **Nunca** pongas en ese archivo la clave **secret** ni la `service_role`.

### 3. Actualizar el Apps Script
1. Abrí la planilla y entrá a **Extensiones → Apps Script**.
2. Reemplazá todo el código por el de `apps-script/Codigo.gs` y guardá.
3. En **⚙ Configuración del proyecto → Propiedades del script**, agregá:
   - `SUPABASE_URL`: la Project URL.
   - `SUPABASE_SECRET_KEY`: la clave **secret** (`sb_secret_...`), o la `service_role` si usás claves legacy. Es secreta y solo va acá.
   - Todavía **no** agregues `FUENTE_PRODUCTOS`.
4. Arriba, elegí la función y tocá **▶ Ejecutar**, una por vez. Google va a pedir permiso la primera vez.
   - `migrarProductosASupabase`: copia los productos de la planilla al panel. Quedan con stock 0.
   - `migrarPedidosASupabase`: copia los pedidos que ya tenés.
   - `instalarMantenimiento`: hace una consulta diaria para que Supabase no pause el proyecto.
5. **Implementar → Administrar implementaciones → ✏ Editar → Versión: Nueva versión → Implementar.**
   - Así se mantiene la misma dirección `/exec` que usa la página. No crees una implementación nueva, porque cambiaría la dirección.

### 4. Publicar en Netlify
1. Usá la carpeta `publicar/`, que tiene solo lo que va a la web: `index.html`, `robots.txt`, `sitemap.xml`, `preview.jpg`, `_headers`, `favicon.ico`, `fotos/` y `admin/`.
   - Si cambiás algún archivo después, volvé a copiarlo a `publicar/` antes de subir.
   - Netlify reemplaza el sitio entero con lo que arrastrás: lo que no esté en la carpeta desaparece de la web.
2. En [app.netlify.com](https://app.netlify.com), entrá al sitio, abrí **Deploys** y arrastrá esa carpeta.
3. Entrá a `https://fresca-merch.netlify.app/admin/` e iniciá sesión.

### 5. Cargar el stock y pasar la web al panel
1. En el panel, cargá el stock de cada producto con **Stock → Conté y hay**.
2. Recién después, en las propiedades del script, agregá `FUENTE_PRODUCTOS` con el valor `supabase`.
   - Desde ese momento la web toma los productos del panel.
   - Para volver atrás, borrá esa propiedad y la web vuelve a leer la planilla.

---

## Uso diario

- **Contraseña:**
  - Si te la olvidás: en la pantalla de ingreso tocá **¿Olvidaste tu contraseña?**, escribí tu correo y abrí el enlace del mail (dura 1 hora y sirve una sola vez). Ahí elegís una nueva, de 10 caracteres o más.
  - Se pueden pedir pocos mails por hora. Si no llega, revisá correo no deseado y esperá antes de pedir otro.
  - Si no llega nunca, entrá a Supabase → **Authentication → Users**, elegí tu usuario y usá **Send password recovery**.
  - Para cambiarla estando adentro: botón **Contraseña**, arriba a la derecha.
  - Si no usás el panel durante 30 minutos, la sesión se cierra sola y pide la contraseña de nuevo. **Salir** cierra solo ese navegador; si tenés el panel abierto en el celular, sigue abierto.

- **Inicio:** pedidos nuevos, productos sin stock o con stock bajo, y accesos rápidos.
  - Ahí también se cambia el aviso de stock bajo general (cuántas unidades).
- **Productos:**
  - Buscar por nombre o código, y filtrar por categoría o disponibilidad.
  - El interruptor **En la web** muestra u oculta un producto al instante.
  - **Editar** cambia los datos, el precio, el precio promocional y las fotos.
  - En las fotos, ★ marca la principal y ◀ ▶ cambian el orden. Las fotos se achican solas y se guardan en dos tamaños: una chica para las tarjetas de la web (carga más rápido) y la grande para la vista ampliada. Las fotos subidas antes de esto reciben su copia chica sola al entrar al panel. Se pueden subir hasta 8 por producto (por ejemplo, frente y espalda).
  - Si el producto tiene talles o colores, debajo de cada foto se elige qué color muestra (o "Todos los colores"). En la web, al elegir ese color se ve su foto.
  - **Eliminar** borra el producto. Si ya tenía movimientos de stock, se archiva para no perder el historial.
- **Stock por talle o color:**
  - Un producto nuevo con talles o colores ("S, M, L") lleva un stock para cada uno; al crearlo se carga el stock inicial de cada talle.
  - Los productos que ya tenían un solo stock muestran el botón **Separar por talle o color**: contás cuántas hay de cada uno y desde ahí se manejan por separado.
  - En la web, un talle en 0 aparece como "sin stock" y no se puede elegir. Si todos están en 0, el producto entero dice "Sin stock".
  - Para sacar un talle de la lista, primero dejalo en 0 con **Mover stock**.
  - En **Inicio → Para reponer** aparecen también los talles que se quedaron sin stock.
  - Los pedidos de la web descuentan stock cuando vos lo confirmás (ver **Pedidos → Descontar del stock**).
- **Stock:** cada movimiento queda registrado con fecha, motivo, quién lo hizo y el talle o color.
  - *Entraron* suma unidades.
  - *Salieron* resta, pide un motivo y nunca deja el stock negativo.
  - *Conté y hay* fija el total después de contar y también pide un motivo.
- **Pedidos:**
  - Cambiar el estado: Nuevo → Confirmado → Pagado → Entregado, o Cancelado.
  - Agregar una nota interna.
  - Escribirle al cliente por WhatsApp con un toque.
  - **Descontar del stock:** al pasar un pedido a **Entregado** se abre una ventana con sus artículos, el talle o color y cuánto stock queda. Confirmás y se registra una salida por cada uno, con el número de pedido como motivo. También está el botón **Descontar del stock** en cada pedido (por ejemplo, si lo querés descontar al confirmarlo).
    - Es todo o nada: si a un artículo no le alcanza el stock no se descuenta ninguno; desmarcalo o corregí el stock primero.
    - Si un artículo no aparece en el catálogo (porque el producto cambió de nombre o se borró), se avisa y no se descuenta.
    - Un pedido se descuenta una sola vez; después muestra **✓ Stock descontado**. Si lo cancelás después, devolvé las unidades con **Mover stock → Entraron**.
  - Filtrar por estado y por fechas.
- **Ventas:**
  - Muestra el total vendido en pesos (en el centro del gráfico), la cantidad de pedidos, las unidades y el promedio por pedido.
  - El gráfico de torta reparte las unidades vendidas por categoría o por producto. La tabla de al lado muestra unidades, porcentaje y pesos de cada uno. Al pasar el dedo o el mouse por una porción se ve su detalle.
  - Se elige el período: este mes, mes pasado, últimos 30 días, este año, todo o fechas a elección.
  - Por defecto cuentan como venta los pedidos **Pagados** y **Entregados**. Se puede cambiar para incluir los confirmados o todos menos los cancelados. Por eso conviene ir actualizando el estado de los pedidos.
  - Solo cuenta los pedidos de la web. Las ventas en el local no aparecen.
  - Las unidades se leen del detalle del pedido. Si un producto cambió de nombre, sus ventas viejas aparecen con el nombre anterior, en "Otros productos" cuando se agrupa por categoría.
- **En la web:**
  - Si un producto tiene precio promocional, se ve el precio normal tachado arriba del de la promo.
  - El botón **Pagá por Mercado Pago** aparece recién después de mandar un pedido eligiendo Mercado Pago (no antes, para que nadie pague sin saber el total).
  - Después de mandar el pedido aparece "¿No se abrió WhatsApp? Abrir de nuevo el pedido": vuelve a abrir el mismo mensaje sin registrar un pedido nuevo.
  - Tocando la foto o el nombre de un producto se abre su vista grande, con todas las fotos: se pasan deslizando con el dedo, con las flechas o con las miniaturas.
  - Si un producto tiene más de una foto, la tarjeta lo indica ("3 fotos").
  - Al elegir un color, la tarjeta y la vista grande muestran la foto de ese color. Desde la vista grande también se puede agregar al pedido.
  - Cada producto tiene su propio enlace para compartir, por ejemplo `fresca-merch.netlify.app/#producto/gorro-de-lana-fresca`.
- **Local:**
  - **¿Está abierto?:** el cartel «Abierto ahora / Cerrado ahora» de la web sale de los horarios (*Según los horarios*). Si un día abrís o cerrás distinto, elegí **Abierto** o **Cerrado** y queda fijo hasta que vuelvas a *Según los horarios*; mientras tanto, Inicio te lo recuerda.
  - **Aviso en la web:** un texto opcional que se ve arriba de los horarios (ej.: «Cerrado por vacaciones hasta el 5 de enero»).
  - **Horarios de atención:** marcá los días que abre y a qué hora. Si cierra después de medianoche, poné la hora real (20:00 a 02:00). Los días sin marcar figuran como «Cerrado».
  - Los cambios se ven al recargar la web. Cuando está cerrado, el cartel de arriba se pone rojo (en el celular dice solo «Abierto» o «Cerrado»). Los horarios que figuran para Google (en el código de la página) y los de tu ficha de Google Maps no cambian solos: actualizalos ahí también si cambian para siempre.
- **Mapa:** la sección «Retiro o envío» muestra un mapa de Google con la esquina del local y un enlace «Cómo llegar». Se arma con la dirección de la planilla (pestaña Configuración); es gratis y no necesita clave.
- **Cuando un producto llega a 0 unidades,** la web lo muestra como "Sin stock". Si está oculto, no aparece.

**Probar el panel sin internet ni Supabase:** abrilo en `localhost` (con un servidor local) y entra en *modo demo*, con datos de ejemplo que no se guardan.

## Seguridad

- El panel pide correo y contraseña de Supabase, y solo funciona con cuentas cargadas en la tabla `admins`.
  - Ocultar la ruta `/admin` no es la protección: la protección son los permisos de la base de datos.
- **La base de datos rechaza** cualquier lectura o escritura de visitantes anónimos o de cuentas que no son admin. Esto está probado con 102 pruebas automáticas.
- **El stock** no se puede editar directamente: solo con movimientos, que validan los datos y quedan en el historial.
- **Si dos personas editan lo mismo a la vez,** el segundo cambio se rechaza con un aviso en lugar de pisar el primero.
- **Fotos:**
  - Solo los admins pueden subir o borrar.
  - Se aceptan WebP o JPG de hasta 2 MB; el control lo hace Supabase, no el navegador.
  - El panel vuelve a dibujar cada foto antes de subirla, lo que descarta cualquier contenido que no sea imagen.
- **La clave secreta** está solo en las propiedades del Apps Script. En los archivos publicados solo está la clave publishable, que es pública por diseño.
- **El panel** no se indexa en Google y no se puede incrustar en otras páginas (ver `_headers`).

## Costos (planes gratis, a octubre de 2026; verificar antes en las páginas oficiales)

- **Supabase Free:** 500 MB de base de datos, entre 500 MB y 1 GB de archivos según la fuente, y 5 GB de transferencia por mes.
  - Pausa el proyecto tras 7 días sin actividad; la consulta diaria que programa `instalarMantenimiento` está pensada para evitarlo.
  - El plan Pro cuesta 25 USD por mes.
- **Netlify Free:** 300 créditos por mes. El panel suma muy poco.
- Ninguno de los dos cobra solo: el plan gratis no pide tarjeta.
