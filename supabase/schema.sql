-- =====================================================================
-- FRESCA · Base de datos del panel de administración (Supabase / Postgres)
-- ---------------------------------------------------------------------
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar todo → Run.
-- Se puede volver a ejecutar sin perder datos (crea solo lo que falta y
-- actualiza funciones y permisos).
--
-- Seguridad, en resumen:
--   * Nadie anónimo puede leer ni escribir nada (la web pública lee los
--     productos a través del Apps Script, con la clave secreta del servidor).
--   * Solo los usuarios cargados en la tabla "admins" pueden operar.
--   * El stock NO se puede modificar directamente: solo con la función
--     mover_stock, que valida, evita negativos y deja historial (también
--     el de cada talle o color, en producto_variantes).
-- =====================================================================

-- ---------- Tablas ----------

create table if not exists public.admins (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  email     text not null,
  creado_en timestamptz not null default now()
);

create table if not exists public.ajustes (
  id                   int primary key default 1 check (id = 1),
  stock_minimo_general int not null default 3 check (stock_minimo_general between 0 and 100000),
  actualizado_en       timestamptz not null default now()
);
insert into public.ajustes (id) values (1) on conflict (id) do nothing;

-- Horarios del local: {"0": ["16:00","22:00"], "1": ["12:00","23:00"], ...} (0 = domingo … 6 = sábado).
-- Un día sin horario (null) está cerrado. Si cierra a una hora menor que la de apertura,
-- cierra después de medianoche. Se pueden cambiar desde el panel; la web los lee por el Apps Script.
create or replace function public.horarios_validos(h jsonb)
returns boolean language sql immutable set search_path = public as $$
  select jsonb_typeof(h) = 'object'
     and not exists (select 1 from jsonb_object_keys(h) k where k not in ('0','1','2','3','4','5','6'))
     and not exists (
       select 1 from jsonb_each(h) e
        where jsonb_typeof(e.value) <> 'null'
          and not (jsonb_typeof(e.value) = 'array' and jsonb_array_length(e.value) = 2
                   and coalesce(e.value->>0 ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$', false)
                   and coalesce(e.value->>1 ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$', false)
                   and e.value->>0 <> e.value->>1));
$$;
alter table public.ajustes add column if not exists horarios jsonb not null default
  '{"1":["12:00","23:00"],"2":["12:00","23:00"],"3":["12:00","23:00"],"4":["12:00","23:00"],"5":["12:00","23:00"],"6":["16:00","23:00"],"0":["16:00","22:00"]}';
-- auto = abierto o cerrado según los horarios; abierto / cerrado = lo fija el dueño a mano
alter table public.ajustes add column if not exists estado_local text not null default 'auto';
-- Aviso que se ve en la web (ej.: "Cerrado por vacaciones hasta el 5 de enero")
alter table public.ajustes add column if not exists aviso_local text not null default '';
alter table public.ajustes drop constraint if exists ajustes_local_valido;
alter table public.ajustes add constraint ajustes_local_valido check (
  public.horarios_validos(horarios) and estado_local in ('auto', 'abierto', 'cerrado') and char_length(aviso_local) <= 160);

create table if not exists public.productos (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null check (char_length(btrim(nombre)) between 2 and 120),
  descripcion    text not null default '' check (char_length(descripcion) <= 1000),
  presentacion   text not null default '' check (char_length(presentacion) <= 80),
  categoria      text not null check (char_length(btrim(categoria)) between 2 and 40),
  precio         numeric(12,2) check (precio is null or precio between 0 and 100000000),
  precio_promo   numeric(12,2) check (precio_promo is null or (precio is not null and precio_promo >= 0 and precio_promo < precio)),
  sku            text unique check (sku is null or char_length(btrim(sku)) between 1 and 40),
  opciones       text not null default '' check (char_length(opciones) <= 500),
  stock          int not null default 0 check (stock between 0 and 1000000),
  stock_minimo   int check (stock_minimo is null or stock_minimo between 0 and 100000),
  activo         boolean not null default true,
  orden          int not null default 0,
  -- Foto que ya estaba en la carpeta fotos/ del sitio (productos migrados de la planilla)
  foto_sitio     text check (foto_sitio is null or foto_sitio ~ '^[A-Za-z0-9._-]{1,100}$'),
  eliminado_en   timestamptz,
  version        int not null default 1,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table if not exists public.producto_fotos (
  id          uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos(id) on delete cascade,
  ruta        text not null unique check (ruta ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg)$'),
  orden       int not null default 0,
  principal   boolean not null default false,
  creado_en   timestamptz not null default now()
);
create unique index if not exists producto_fotos_una_principal on public.producto_fotos (producto_id) where principal;
create index if not exists producto_fotos_producto on public.producto_fotos (producto_id, orden);

create table if not exists public.movimientos_stock (
  id               bigint generated always as identity primary key,
  producto_id      uuid not null references public.productos(id) on delete cascade,
  tipo             text not null check (tipo in ('inicial', 'ingreso', 'egreso', 'ajuste')),
  cantidad         int not null,            -- diferencia aplicada (+ suma, - resta)
  stock_anterior   int not null,
  stock_resultante int not null check (stock_resultante >= 0),
  motivo           text not null default '' check (char_length(motivo) <= 300),
  usuario_id       uuid,
  usuario_email    text,
  creado_en        timestamptz not null default now()
);
create index if not exists movimientos_stock_producto on public.movimientos_stock (producto_id, creado_en desc);
create index if not exists movimientos_stock_fecha on public.movimientos_stock (creado_en desc);

-- Stock por talle o color. Si un producto tiene variantes, su "stock" es la
-- suma de ellas (lo mantiene la base). Los nombres salen de "opciones".
create table if not exists public.producto_variantes (
  id          uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos(id) on delete cascade,
  nombre      text not null check (char_length(btrim(nombre)) between 1 and 60),
  stock       int not null default 0 check (stock between 0 and 1000000),
  orden       int not null default 0,
  unique (producto_id, nombre)
);
alter table public.movimientos_stock add column if not exists
  variante_id uuid references public.producto_variantes(id) on delete set null;
alter table public.movimientos_stock add column if not exists
  variante text not null default '';          -- nombre del talle/color (queda aunque se borre)

-- Foto de un color o talle en particular: la web la muestra al elegirlo. Vacío = foto general.
alter table public.producto_fotos add column if not exists
  opcion text check (opcion is null or char_length(btrim(opcion)) between 1 and 60);
-- Copia chica de la foto (para las tarjetas de la web, carga más rápido). Vacío = no tiene.
alter table public.producto_fotos add column if not exists
  ruta_chica text check (ruta_chica is null or ruta_chica ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg)$');

create table if not exists public.pedidos (
  id             bigint generated always as identity primary key,
  numero         text not null default '',
  fecha          timestamptz not null default now(),
  cliente        text not null default '',
  telefono       text not null default '',
  entrega        text not null default '',
  direccion      text not null default '',
  pago           text not null default '',
  detalle        text not null default '',
  total          numeric(12,2) not null default 0,
  total_texto    text not null default '',
  comentarios    text not null default '',
  estado         text not null default 'Nuevo' check (estado in ('Nuevo', 'Confirmado', 'Pagado', 'Entregado', 'Cancelado')),
  nota_interna   text not null default '' check (char_length(nota_interna) <= 500),
  version        int not null default 1,
  actualizado_en timestamptz not null default now()
);
-- true cuando ya se descontó del stock lo que lleva el pedido (para no descontarlo dos veces)
alter table public.pedidos add column if not exists stock_descontado boolean not null default false;
create index if not exists pedidos_fecha on public.pedidos (fecha desc);
create index if not exists pedidos_estado on public.pedidos (estado, fecha desc);

-- ---------- Funciones auxiliares ----------

create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- Versión + fecha de modificación en cada cambio (sirve para detectar
-- que otra persona editó lo mismo y no pisar sus cambios en silencio).
-- Los movimientos de stock no cambian la versión, para no trabar a quien
-- está editando la descripción del mismo producto al mismo tiempo.
create or replace function public.tocar_registro()
returns trigger language plpgsql set search_path = public as $$
begin
  new.actualizado_en := now();
  if coalesce(current_setting('fresca.solo_stock', true), '') <> '1' then
    new.version := old.version + 1;
  end if;
  return new;
end $$;

drop trigger if exists productos_tocar on public.productos;
create trigger productos_tocar before update on public.productos
  for each row execute function public.tocar_registro();
drop trigger if exists pedidos_tocar on public.pedidos;
create trigger pedidos_tocar before update on public.pedidos
  for each row execute function public.tocar_registro();

-- La primera foto de un producto queda como principal; si se borra la
-- principal, pasa a serlo la siguiente.
create or replace function public.fotos_principal()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_prod uuid := coalesce(new.producto_id, old.producto_id);
begin
  if not exists (select 1 from public.producto_fotos where producto_id = v_prod and principal) then
    update public.producto_fotos set principal = true
     where id = (select id from public.producto_fotos where producto_id = v_prod order by orden, creado_en limit 1);
  end if;
  return null;
end $$;
drop trigger if exists producto_fotos_principal on public.producto_fotos;
create trigger producto_fotos_principal after insert or delete on public.producto_fotos
  for each row execute function public.fotos_principal();

-- "S, M, , L, M" → {S, M, L} (sin vacíos ni repetidos, en el orden escrito)
create or replace function public.lista_opciones(p text)
returns text[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(x order by o), '{}') from (
    select btrim(x) x, min(o) o from unnest(string_to_array(coalesce(p, ''), ',')) with ordinality t(x, o)
     where btrim(x) <> '' group by btrim(x)) s;
$$;

-- Los productos nuevos con opciones nacen con una variante por opción (stock 0).
-- Si un producto ya tiene variantes y se cambian sus opciones, se agregan las
-- nuevas y se borran las que se sacaron (solo si no tienen unidades).
create or replace function public.sincronizar_variantes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_nombres text[] := public.lista_opciones(new.opciones);
  v_resto   record;
begin
  if tg_op = 'UPDATE' and not exists (select 1 from public.producto_variantes where producto_id = new.id) then
    return null;                                   -- producto con stock único: no se toca
  end if;
  select nombre, stock into v_resto from public.producto_variantes
   where producto_id = new.id and stock > 0 and not (nombre = any(v_nombres)) limit 1;
  if found then
    raise exception 'La opción «%» todavía tiene % unidades. Pasala a 0 con «Mover stock» antes de sacarla.', v_resto.nombre, v_resto.stock;
  end if;
  delete from public.producto_variantes where producto_id = new.id and not (nombre = any(v_nombres));
  insert into public.producto_variantes (producto_id, nombre, orden)
  select new.id, n, o from unnest(v_nombres) with ordinality t(n, o)
  on conflict (producto_id, nombre) do update set orden = excluded.orden;
  return null;
end $$;
drop trigger if exists productos_variantes on public.productos;
create trigger productos_variantes after insert or update of opciones on public.productos
  for each row execute function public.sincronizar_variantes();

-- ---------- Operaciones del panel ----------

-- Con p_variante mueve el stock de un talle/color; el del producto pasa a ser la suma.
drop function if exists public.mover_stock(uuid, text, int, text, int);
create or replace function public.mover_stock(
  p_producto uuid, p_tipo text, p_cantidad int, p_motivo text default '', p_stock_esperado int default null,
  p_variante uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_actual int;
  v_nuevo  int;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_nombre text := '';
begin
  if not public.es_admin() then
    raise exception 'No tenés permiso para hacer esto.' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('inicial', 'ingreso', 'egreso', 'ajuste') then
    raise exception 'Tipo de movimiento inválido.';
  end if;
  if p_cantidad is null or p_cantidad < 0 or p_cantidad > 1000000 then
    raise exception 'La cantidad no es válida.';
  end if;
  if p_tipo in ('ingreso', 'egreso') and p_cantidad = 0 then
    raise exception 'La cantidad tiene que ser mayor a 0.';
  end if;
  if p_tipo in ('egreso', 'ajuste') and v_motivo = '' then
    raise exception 'Indicá el motivo del movimiento.';
  end if;
  if char_length(v_motivo) > 300 then
    raise exception 'El motivo es demasiado largo (máximo 300 caracteres).';
  end if;

  select stock into v_actual from public.productos
   where id = p_producto and eliminado_en is null
   for update;                                   -- bloquea la fila: dos cambios a la vez se hacen en fila
  if not found then
    raise exception 'El producto no existe o fue eliminado.';
  end if;
  if p_variante is not null then
    select stock, nombre into v_actual, v_nombre from public.producto_variantes
     where id = p_variante and producto_id = p_producto for update;
    if not found then
      raise exception 'Ese talle o color ya no existe. Recargá la página.';
    end if;
  elsif exists (select 1 from public.producto_variantes where producto_id = p_producto) then
    raise exception 'Elegí el talle o color.';
  end if;
  if p_stock_esperado is not null and p_stock_esperado <> v_actual then
    raise exception 'El stock cambió mientras lo editabas (ahora hay %). Revisalo y volvé a intentar.', v_actual;
  end if;
  if p_tipo = 'inicial' and exists (select 1 from public.movimientos_stock where producto_id = p_producto
       and variante_id is not distinct from p_variante) then
    raise exception 'Este producto ya tiene stock cargado. Usá un ingreso o un ajuste.';
  end if;

  v_nuevo := case p_tipo
               when 'ingreso' then v_actual + p_cantidad
               when 'egreso'  then v_actual - p_cantidad
               else p_cantidad                       -- inicial y ajuste fijan el total
             end;
  if v_nuevo < 0 then
    raise exception 'No alcanza el stock: hay % y querés sacar %.', v_actual, p_cantidad;
  end if;
  if v_nuevo > 1000000 then
    raise exception 'La cantidad no es válida.';
  end if;

  perform set_config('fresca.solo_stock', '1', true);
  if p_variante is not null then
    update public.producto_variantes set stock = v_nuevo where id = p_variante;
    update public.productos set stock = (select sum(stock) from public.producto_variantes where producto_id = p_producto)
     where id = p_producto;
  else
    update public.productos set stock = v_nuevo where id = p_producto;
  end if;
  perform set_config('fresca.solo_stock', '', true);

  insert into public.movimientos_stock
    (producto_id, variante_id, variante, tipo, cantidad, stock_anterior, stock_resultante, motivo, usuario_id, usuario_email)
  values
    (p_producto, p_variante, v_nombre, p_tipo, v_nuevo - v_actual, v_actual, v_nuevo, v_motivo, auth.uid(),
     (select email from auth.users where id = auth.uid()));
  return v_nuevo;
end $$;

-- Pasa un producto de stock único a stock por talle/color: crea una variante
-- por opción con las unidades indicadas (en el mismo orden) y deja historial.
create or replace function public.separar_stock(p_producto uuid, p_stocks int[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_nombres text[];
  v_anterior int;
  v_var record;
  v_email text := (select email from auth.users where id = auth.uid());
begin
  if not public.es_admin() then
    raise exception 'No tenés permiso para hacer esto.' using errcode = '42501';
  end if;
  select public.lista_opciones(opciones), stock into v_nombres, v_anterior from public.productos
   where id = p_producto and eliminado_en is null for update;
  if not found then raise exception 'El producto no existe o fue eliminado.'; end if;
  if exists (select 1 from public.producto_variantes where producto_id = p_producto) then
    raise exception 'Este producto ya tiene el stock separado por talle o color.';
  end if;
  if cardinality(v_nombres) = 0 then raise exception 'El producto no tiene talles ni colores cargados.'; end if;
  if p_stocks is null or cardinality(p_stocks) <> cardinality(v_nombres)
     or exists (select 1 from unnest(p_stocks) s where s is null or s < 0 or s > 1000000) then
    raise exception 'Revisá las cantidades: tienen que ser números enteros, 0 o más.';
  end if;
  insert into public.producto_variantes (producto_id, nombre, orden, stock)
  select p_producto, n, o, p_stocks[o] from unnest(v_nombres) with ordinality t(n, o);
  perform set_config('fresca.solo_stock', '1', true);
  update public.productos set stock = (select sum(s) from unnest(p_stocks) s) where id = p_producto;
  perform set_config('fresca.solo_stock', '', true);
  for v_var in select id, nombre, stock from public.producto_variantes where producto_id = p_producto order by orden loop
    insert into public.movimientos_stock
      (producto_id, variante_id, variante, tipo, cantidad, stock_anterior, stock_resultante, motivo, usuario_id, usuario_email)
    values (p_producto, v_var.id, v_var.nombre, 'ajuste', v_var.stock, 0, v_var.stock,
            'Separado por talle o color (antes: ' || v_anterior || ' u. en total)', auth.uid(), v_email);
  end loop;
end $$;

-- Si el producto tiene historial de stock se archiva (no se pierde el
-- historial); si no, se borra. En los dos casos se borran sus fotos (el
-- archivado libera también el código SKU). Devuelve las rutas de fotos a borrar.
create or replace function public.eliminar_producto(p_producto uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_rutas text[];
begin
  if not public.es_admin() then
    raise exception 'No tenés permiso para hacer esto.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.productos where id = p_producto and eliminado_en is null) then
    raise exception 'El producto no existe o ya fue eliminado.';
  end if;
  select coalesce(array_agg(r), '{}') into v_rutas from public.producto_fotos, unnest(array[ruta, ruta_chica]) r
   where producto_id = p_producto and r is not null;
  if exists (select 1 from public.movimientos_stock where producto_id = p_producto) then
    delete from public.producto_fotos where producto_id = p_producto;
    update public.productos set eliminado_en = now(), activo = false, sku = null where id = p_producto;
    return json_build_object('resultado', 'archivado', 'rutas', to_json(v_rutas));
  end if;
  delete from public.productos where id = p_producto;
  return json_build_object('resultado', 'eliminado', 'rutas', to_json(v_rutas));
end $$;

create or replace function public.marcar_foto_principal(p_foto uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_prod uuid;
begin
  if not public.es_admin() then
    raise exception 'No tenés permiso para hacer esto.' using errcode = '42501';
  end if;
  select producto_id into v_prod from public.producto_fotos where id = p_foto;
  if not found then raise exception 'La foto no existe.'; end if;
  update public.producto_fotos set principal = false where producto_id = v_prod and principal and id <> p_foto;
  update public.producto_fotos set principal = true where id = p_foto;
end $$;

create or replace function public.ordenar_fotos(p_producto uuid, p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es_admin() then
    raise exception 'No tenés permiso para hacer esto.' using errcode = '42501';
  end if;
  update public.producto_fotos set orden = array_position(p_ids, id)
   where producto_id = p_producto and id = any(p_ids);
end $$;

-- Descuenta del stock lo que lleva un pedido (una salida por artículo, con el
-- número de pedido como motivo). Todo o nada: si a un artículo no le alcanza
-- el stock no se descuenta ninguno. Un pedido se descuenta una sola vez.
-- p_lineas: [{"producto": uuid, "variante": uuid o null, "cantidad": n}, ...]
create or replace function public.descontar_pedido(p_pedido bigint, p_lineas jsonb)
returns public.pedidos language plpgsql security definer set search_path = public as $$
declare
  v_ped    public.pedidos;
  v_linea  jsonb;
  v_nombre text;
  v_motivo text;
begin
  if not public.es_admin() then
    raise exception 'No tenés permiso para hacer esto.' using errcode = '42501';
  end if;
  select * into v_ped from public.pedidos where id = p_pedido for update;
  if not found then raise exception 'El pedido no existe.'; end if;
  if v_ped.stock_descontado then raise exception 'El stock de este pedido ya se descontó.'; end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) not between 1 and 50 then
    raise exception 'No hay artículos para descontar.';
  end if;
  v_motivo := 'Pedido ' || coalesce(nullif(btrim(v_ped.numero), ''), '#' || v_ped.id);
  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    select nombre into v_nombre from public.productos where id = (v_linea->>'producto')::uuid;
    begin
      perform public.mover_stock((v_linea->>'producto')::uuid, 'egreso', (v_linea->>'cantidad')::int, v_motivo,
                                 null, nullif(v_linea->>'variante', '')::uuid);
    exception when others then
      raise exception using message = coalesce(v_nombre, 'Un producto') || ': ' || sqlerrm, errcode = sqlstate;
    end;
  end loop;
  update public.pedidos set stock_descontado = true where id = p_pedido returning * into v_ped;
  return v_ped;
end $$;

-- ---------- Permisos ----------

alter table public.admins            enable row level security;
alter table public.ajustes           enable row level security;
alter table public.productos         enable row level security;
alter table public.producto_fotos    enable row level security;
alter table public.movimientos_stock enable row level security;
alter table public.pedidos           enable row level security;
alter table public.producto_variantes enable row level security;

revoke all on public.admins, public.ajustes, public.productos, public.producto_fotos,
              public.movimientos_stock, public.pedidos, public.producto_variantes from anon, authenticated;
-- Las variantes se crean y cambian solo con las opciones del producto y con mover_stock / separar_stock
grant select on public.producto_variantes to authenticated;

grant select on public.admins to authenticated;
grant select, update (stock_minimo_general, horarios, estado_local, aviso_local) on public.ajustes to authenticated;
grant select on public.productos to authenticated;
grant insert (nombre, descripcion, presentacion, categoria, precio, precio_promo, sku, opciones,
              stock_minimo, activo, orden) on public.productos to authenticated;
grant update (nombre, descripcion, presentacion, categoria, precio, precio_promo, sku, opciones,
              stock_minimo, activo, orden) on public.productos to authenticated;
grant select, delete on public.producto_fotos to authenticated;
grant insert (producto_id, ruta, ruta_chica, orden, opcion), update (opcion, ruta_chica) on public.producto_fotos to authenticated;
grant select on public.movimientos_stock to authenticated;
grant select, update (estado, nota_interna) on public.pedidos to authenticated;

drop policy if exists admins_propio on public.admins;
create policy admins_propio on public.admins for select to authenticated using (user_id = auth.uid());

drop policy if exists ajustes_admin on public.ajustes;
create policy ajustes_admin on public.ajustes for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

drop policy if exists productos_admin on public.productos;
create policy productos_admin on public.productos for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

drop policy if exists producto_fotos_admin on public.producto_fotos;
create policy producto_fotos_admin on public.producto_fotos for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

drop policy if exists movimientos_admin on public.movimientos_stock;
create policy movimientos_admin on public.movimientos_stock for select to authenticated
  using (public.es_admin());

drop policy if exists variantes_admin on public.producto_variantes;
create policy variantes_admin on public.producto_variantes for select to authenticated
  using (public.es_admin());

drop policy if exists pedidos_admin on public.pedidos;
create policy pedidos_admin on public.pedidos for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

revoke execute on function public.es_admin(), public.mover_stock(uuid, text, int, text, int, uuid),
  public.separar_stock(uuid, int[]),
  public.eliminar_producto(uuid), public.marcar_foto_principal(uuid), public.ordenar_fotos(uuid, uuid[]),
  public.descontar_pedido(bigint, jsonb)
  from public, anon;
grant execute on function public.es_admin(), public.mover_stock(uuid, text, int, text, int, uuid),
  public.separar_stock(uuid, int[]),
  public.eliminar_producto(uuid), public.marcar_foto_principal(uuid), public.ordenar_fotos(uuid, uuid[]),
  public.descontar_pedido(bigint, jsonb)
  to authenticated;
revoke execute on function public.tocar_registro(), public.fotos_principal(), public.sincronizar_variantes()
  from public, anon, authenticated;

-- ---------- Fotos (Supabase Storage) ----------
-- Carpeta pública de solo lectura (la web muestra las fotos); subir, cambiar
-- o borrar solo pueden los admins. Máximo 2 MB por archivo, solo WebP o JPG
-- (el panel achica y convierte cada foto antes de subirla).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('productos', 'productos', true, 2097152, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists fotos_admin_select on storage.objects;
create policy fotos_admin_select on storage.objects for select to authenticated
  using (bucket_id = 'productos' and public.es_admin());
drop policy if exists fotos_admin_insert on storage.objects;
create policy fotos_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'productos' and public.es_admin());
drop policy if exists fotos_admin_update on storage.objects;
create policy fotos_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'productos' and public.es_admin());
drop policy if exists fotos_admin_delete on storage.objects;
create policy fotos_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'productos' and public.es_admin());
