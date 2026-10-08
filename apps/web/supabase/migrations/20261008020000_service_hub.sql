-- Service Hub: all operational writes use service-api RPCs; browser gets tenant-scoped reads.
create extension if not exists pgcrypto with schema extensions;
create sequence public.sh_order_code_seq start 100000;
create table public.sh_tenants(id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz not null default now());
create table public.sh_memberships(tenant_id uuid references public.sh_tenants not null, user_id uuid references auth.users not null, role text not null check(role in ('owner','manager','staff')), primary key(tenant_id,user_id));
create table public.sh_modules(tenant_id uuid references public.sh_tenants not null, module_key text not null, enabled boolean not null default true, config jsonb not null default '{}', primary key(tenant_id,module_key));
create table public.sh_customers(id uuid primary key default gen_random_uuid(), tenant_id uuid references public.sh_tenants not null, name text not null, phone text, created_at timestamptz not null default now(), unique(tenant_id,id));
create table public.sh_services(id uuid primary key default gen_random_uuid(), tenant_id uuid references public.sh_tenants not null, module_key text not null, code text not null, name text not null, price integer not null check(price>0), duration_seconds integer not null check(duration_seconds>=0), device_kind text, active boolean not null default true, unique(tenant_id,id), unique(tenant_id,module_key,code), foreign key(tenant_id,module_key) references public.sh_modules);
create table public.sh_devices(id uuid primary key default gen_random_uuid(), tenant_id uuid references public.sh_tenants not null, name text not null, kind text not null, status text not null default 'idle' check(status in ('idle','reserved','running','maintenance')), last_seen_at timestamptz, reserved_until timestamptz, unique(tenant_id,id));
-- Secrets are intentionally separate and never readable by browser roles.
create table public.sh_device_credentials(device_id uuid primary key references public.sh_devices, secret_hash text not null);
create table public.sh_orders(id uuid primary key default gen_random_uuid(), tenant_id uuid references public.sh_tenants not null, service_id uuid not null, customer_id uuid, device_id uuid, service_name text not null, module_key text not null, amount integer not null check(amount>0), duration_seconds integer not null, order_code bigint not null unique default nextval('public.sh_order_code_seq'), request_id uuid not null, status text not null default 'pending' check(status in ('pending','paid','paid_review','cancelled','completed')), checkout_url text, payment_link_id text, created_at timestamptz not null default now(), expires_at timestamptz not null default (now()+interval '15 minutes'), unique(tenant_id,id), unique(tenant_id,request_id), foreign key(tenant_id,service_id) references public.sh_services(tenant_id,id), foreign key(tenant_id,customer_id) references public.sh_customers(tenant_id,id), foreign key(tenant_id,device_id) references public.sh_devices(tenant_id,id));
create table public.sh_payment_events(id uuid primary key default gen_random_uuid(), order_id uuid references public.sh_orders not null, reference text not null unique, amount integer not null, received_at timestamptz not null default now());
create table public.sh_sessions(id uuid primary key default gen_random_uuid(), tenant_id uuid references public.sh_tenants not null, order_id uuid not null unique, device_id uuid not null, duration_seconds integer not null check(duration_seconds>0), status text not null default 'queued' check(status in ('queued','running','completed','review')), command_expires_at timestamptz not null default (now()+interval '2 minutes'), started_at timestamptz, finished_at timestamptz, foreign key(tenant_id,order_id) references public.sh_orders(tenant_id,id), foreign key(tenant_id,device_id) references public.sh_devices(tenant_id,id));
create unique index sh_one_active_session on public.sh_sessions(device_id) where status in ('queued','running','review');
create function public.sh_is_member(p_tenant_id uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.sh_memberships where tenant_id=p_tenant_id and user_id=auth.uid())$$;
revoke all on function public.sh_is_member(uuid) from public;
grant execute on function public.sh_is_member(uuid) to authenticated;
do $$declare t text; begin
  foreach t in array array['tenants','memberships','modules','customers','services','devices','orders','sessions'] loop
    execute format('alter table public.sh_%I enable row level security',t);
    execute format('grant select on public.sh_%I to authenticated',t);
    execute format('grant all on public.sh_%I to service_role',t);
    if t='tenants' then
      execute 'create policy tenant_read on public.sh_tenants for select to authenticated using(public.sh_is_member(id))';
    else
      execute format('create policy tenant_read on public.sh_%I for select to authenticated using(public.sh_is_member(tenant_id))',t);
    end if;
  end loop;
end$$;
alter table public.sh_payment_events enable row level security;
alter table public.sh_device_credentials enable row level security;
grant all on public.sh_payment_events,public.sh_device_credentials to service_role;
grant usage,select on sequence public.sh_order_code_seq to service_role;

create function public.sh_create_tenant(p_user_id uuid,p_name text) returns public.sh_tenants language plpgsql security definer set search_path='' as $$
declare t public.sh_tenants; begin
 if p_name is null or length(trim(p_name))<2 then raise exception 'Tên cơ sở không hợp lệ'; end if;
 insert into public.sh_tenants(name) values(trim(p_name)) returning * into t;
 insert into public.sh_memberships values(t.id,p_user_id,'owner');
 insert into public.sh_modules(tenant_id,module_key) values(t.id,'carwash'),(t.id,'laundry');
 insert into public.sh_services(tenant_id,module_key,code,name,price,duration_seconds,device_kind) values
 (t.id,'carwash','self-wash','Tự rửa xe',30000,600,'wash-bay'),(t.id,'carwash','staff-wash','Rửa xe có nhân viên',70000,1800,null),(t.id,'carwash','vacuum','Hút bụi',20000,300,'vacuum'),
 (t.id,'laundry','wash','Giặt tự phục vụ',40000,1800,'washer'),(t.id,'laundry','dry','Sấy tự phục vụ',30000,1200,'dryer'),(t.id,'laundry','wash-fold','Giặt và gấp có nhân viên (giá mẫu/mẻ)',25000,0,null);
 return t;
end$$;
create function public.sh_create_order(p_tenant_id uuid,p_user_id uuid,p_service_id uuid,p_device_id uuid,p_customer_id uuid,p_request_id uuid) returns public.sh_orders language plpgsql security definer set search_path='' as $$
declare s public.sh_services; d public.sh_devices; o public.sh_orders; begin
 if not exists(select 1 from public.sh_memberships where tenant_id=p_tenant_id and user_id=p_user_id) then raise exception 'Không có quyền'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||p_request_id::text,0));
 select * into o from public.sh_orders where tenant_id=p_tenant_id and request_id=p_request_id;
 if found then
   if o.service_id<>p_service_id or o.device_id is distinct from p_device_id or o.customer_id is distinct from p_customer_id then raise exception 'Request ID đã dùng cho nội dung khác'; end if;
   return o;
 end if;
 select * into s from public.sh_services where id=p_service_id and tenant_id=p_tenant_id and active;
 if not found or not exists(select 1 from public.sh_modules where tenant_id=p_tenant_id and module_key=s.module_key and enabled) then raise exception 'Dịch vụ chưa bật'; end if;
 if s.device_kind is not null then
   select * into d from public.sh_devices where id=p_device_id and tenant_id=p_tenant_id for update;
   if not found or d.kind<>s.device_kind then raise exception 'Sai thiết bị'; end if;
   if d.status='reserved' and d.reserved_until<now() then update public.sh_devices set status='idle',reserved_until=null where id=d.id; d.status:='idle'; end if;
   if d.status<>'idle' or d.last_seen_at is null or d.last_seen_at<now()-interval '90 seconds' then raise exception 'Thiết bị chưa sẵn sàng'; end if;
   update public.sh_devices set status='reserved',reserved_until=now()+interval '15 minutes' where id=d.id;
 elsif p_device_id is not null then raise exception 'Dịch vụ này không dùng máy'; end if;
 insert into public.sh_orders(tenant_id,service_id,customer_id,device_id,service_name,module_key,amount,duration_seconds,request_id) values(p_tenant_id,s.id,p_customer_id,p_device_id,s.name,s.module_key,s.price,s.duration_seconds,p_request_id) returning * into o;
 return o;
end$$;
create function public.sh_accept_payment(p_order_code bigint,p_amount integer,p_reference text) returns void language plpgsql security definer set search_path='' as $$
declare o public.sh_orders; d public.sh_devices; begin
 select * into o from public.sh_orders where order_code=p_order_code for update;
 if not found then raise exception 'Không có đơn hàng'; end if;
 if o.amount<>p_amount or p_reference is null or p_reference='' then raise exception 'Thanh toán không khớp'; end if;
 if o.status<>'pending' then return; end if;
 insert into public.sh_payment_events(order_id,reference,amount) values(o.id,p_reference,p_amount);
 if o.device_id is not null then
   select * into d from public.sh_devices where id=o.device_id for update;
   if now()>o.expires_at or d.status<>'reserved' or d.last_seen_at<now()-interval '90 seconds' or d.last_seen_at is null then
     update public.sh_orders set status='paid_review' where id=o.id; return;
   end if;
   insert into public.sh_sessions(tenant_id,order_id,device_id,duration_seconds) values(o.tenant_id,o.id,o.device_id,o.duration_seconds);
 end if;
 update public.sh_orders set status='paid' where id=o.id;
end$$;
create function public.sh_device_poll(p_device_id uuid,p_secret text,p_ack uuid default null,p_finished uuid default null) returns public.sh_sessions language plpgsql security definer set search_path='' as $$
declare s public.sh_sessions; begin
 if not exists(select 1 from public.sh_device_credentials where device_id=p_device_id and secret_hash=encode(extensions.digest(p_secret,'sha256'),'hex')) then raise exception 'Thiết bị không hợp lệ'; end if;
 perform 1 from public.sh_devices where id=p_device_id for update;
 update public.sh_devices set last_seen_at=now() where id=p_device_id;
 if p_ack is not null then
   update public.sh_sessions set status='running',started_at=coalesce(started_at,now()) where id=p_ack and device_id=p_device_id and status='queued' and command_expires_at>now();
   if found then update public.sh_devices set status='running',reserved_until=null where id=p_device_id; end if;
 end if;
 if p_finished is not null then
   update public.sh_sessions set status='completed',finished_at=now() where id=p_finished and device_id=p_device_id and status='running' returning * into s;
   if found then
     update public.sh_devices set status='idle',reserved_until=null where id=p_device_id;
     update public.sh_orders set status='completed' where id=s.order_id;
   end if;
 end if;
 -- Expired commands require operator review; never silently resend a START.
 update public.sh_sessions set status='review' where device_id=p_device_id and status='queued' and command_expires_at<=now();
 select * into s from public.sh_sessions where device_id=p_device_id and status='queued' and command_expires_at>now();
 return s;
end$$;
revoke all on function public.sh_create_tenant(uuid,text),public.sh_create_order(uuid,uuid,uuid,uuid,uuid,uuid),public.sh_accept_payment(bigint,integer,text),public.sh_device_poll(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.sh_create_tenant(uuid,text),public.sh_create_order(uuid,uuid,uuid,uuid,uuid,uuid),public.sh_accept_payment(bigint,integer,text),public.sh_device_poll(uuid,text,uuid,uuid) to service_role;
