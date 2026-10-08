begin;
do $$begin if not exists(select 1 from pg_roles where rolname='sh_rpc') then create role sh_rpc nologin nosuperuser nobypassrls noinherit; end if;end$$;
create schema if not exists internal;
revoke all on schema internal from public,anon,authenticated;
grant usage,create on schema public,internal to sh_rpc;
grant usage on schema auth,extensions to sh_rpc;
grant execute on function auth.uid(),auth.role() to sh_rpc;
grant execute on function extensions.digest(text,text) to sh_rpc;
grant usage on schema kit to sh_rpc;
grant select,insert,update on public.accounts to sh_rpc;
create policy sh_auth_profile_writer on public.accounts to sh_rpc using(true) with check(true);
alter function kit.handle_update_user_email() owner to sh_rpc;
alter function kit.new_user_created_setup() owner to sh_rpc;
create or replace function kit.protect_account_fields() returns trigger language plpgsql set search_path='' as $$begin
 if current_user in('authenticated','anon') and (new.id is distinct from old.id or new.email is distinct from old.email) then raise exception 'FORBIDDEN';end if;return new;
end$$;
create table public.sh_branches(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.sh_tenants(id),name text not null,active boolean not null default true,is_default boolean not null default false,unique(tenant_id,id));
create unique index sh_default_branch on public.sh_branches(tenant_id) where is_default;
insert into public.sh_branches(tenant_id,name,is_default) select id,'Chi nhánh chính',true from public.sh_tenants;
alter table public.sh_tenants add column active boolean not null default true;
alter table public.sh_memberships add column branch_id uuid,add column is_active boolean not null default true;
update public.sh_memberships m set branch_id=b.id from public.sh_branches b where b.tenant_id=m.tenant_id and b.is_default and m.role<>'owner';
alter table public.sh_memberships add foreign key(tenant_id,branch_id) references public.sh_branches(tenant_id,id),add check((role='owner' and branch_id is null) or (role in('manager','staff') and branch_id is not null));
do $$declare n text;begin foreach n in array array['customers','devices','orders','sessions'] loop
 execute format('alter table public.sh_%I add column branch_id uuid',n);
 execute format('update public.sh_%I x set branch_id=b.id from public.sh_branches b where b.tenant_id=x.tenant_id and b.is_default',n);
 execute format('alter table public.sh_%I alter column branch_id set not null',n);
 execute format('alter table public.sh_%I add foreign key(tenant_id,branch_id) references public.sh_branches(tenant_id,id)',n);
 execute format('alter table public.sh_%I add unique(tenant_id,branch_id,id)',n);
end loop;end$$;
alter table public.sh_orders add column created_by uuid references auth.users(id);
alter table public.sh_orders add foreign key(tenant_id,branch_id,customer_id) references public.sh_customers(tenant_id,branch_id,id),add foreign key(tenant_id,branch_id,device_id) references public.sh_devices(tenant_id,branch_id,id);
alter table public.sh_sessions add foreign key(tenant_id,branch_id,order_id) references public.sh_orders(tenant_id,branch_id,id),add foreign key(tenant_id,branch_id,device_id) references public.sh_devices(tenant_id,branch_id,id);
alter table public.sh_devices add column reserved_order_id uuid,add column enabled boolean not null default false,add column execution_mode text not null default 'simulation' check(execution_mode='simulation');
update public.sh_devices d set reserved_order_id=o.id from public.sh_orders o where o.device_id=d.id and o.status='pending' and d.status='reserved' and o.expires_at>now();
alter table public.sh_devices add foreign key(tenant_id,branch_id,reserved_order_id) references public.sh_orders(tenant_id,branch_id,id);
alter table public.sh_device_credentials set schema internal;
alter table public.sh_payment_events set schema internal;
create index sh_order_feed on public.sh_orders(tenant_id,branch_id,created_at desc,id);
create index sh_customer_scope on public.sh_customers(tenant_id,branch_id,id);
create table internal.sh_audit(id uuid primary key default gen_random_uuid(),tenant_id uuid references public.sh_tenants(id),actor_id uuid,action text not null,resource_id uuid,created_at timestamptz not null default now());

create function internal.sh_can_scope(t uuid,b uuid,roles text[] default array['owner','manager','staff']) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.sh_memberships m join public.sh_tenants x on x.id=m.tenant_id where m.tenant_id=t and m.user_id=auth.uid() and m.is_active and x.active and m.role=any(roles)
 and (m.branch_id is null or exists(select 1 from public.sh_branches z where z.tenant_id=t and z.id=m.branch_id and z.active))
 and (b is null or (m.branch_id is null or m.branch_id=b) and exists(select 1 from public.sh_branches z where z.tenant_id=t and z.id=b and z.active)))
$$;
create or replace function public.sh_is_member(p_tenant_id uuid) returns boolean language sql stable security definer set search_path='' as $$select internal.sh_can_scope(p_tenant_id,null)$$;
-- Preserve history but make the old mutators inaccessible, even to service_role.
alter function public.sh_create_tenant(uuid,text) rename to sh_create_tenant_legacy;
alter function public.sh_create_order(uuid,uuid,uuid,uuid,uuid,uuid) rename to sh_create_order_legacy;
create function public.sh_create_tenant(p_user_id uuid,p_name text) returns public.sh_tenants language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare t public.sh_tenants;begin
 if auth.uid() is null or auth.uid()<>p_user_id or length(trim(p_name)) not between 2 and 120 then raise exception 'FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
 if (select count(*) from public.sh_memberships where user_id=p_user_id and role='owner')>=3 then raise exception 'TENANT_QUOTA';end if;
 t:=public.sh_create_tenant_legacy(p_user_id,p_name);
 insert into public.sh_branches(tenant_id,name,is_default) values(t.id,'Chi nhánh chính',true);
 update public.sh_modules set enabled=false where tenant_id=t.id and module_key='laundry';
 insert into internal.sh_audit(tenant_id,actor_id,action,resource_id) values(t.id,auth.uid(),'tenant.create',t.id);return t;
end$$;
create function public.sh_create_order(p_tenant_id uuid,p_user_id uuid,p_service_id uuid,p_device_id uuid,p_customer_id uuid,p_request_id uuid,p_branch_id uuid) returns public.sh_orders language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='10s' as $$
declare o public.sh_orders;d public.sh_devices;begin
 if auth.uid() is null or auth.uid()<>p_user_id or not internal.sh_can_scope(p_tenant_id,p_branch_id,array['owner','manager']) or p_branch_id is null or p_request_id is null then raise exception 'FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||p_request_id::text,0));
 select * into o from public.sh_orders where tenant_id=p_tenant_id and request_id=p_request_id;
 if found then
  if o.created_by is distinct from p_user_id or o.branch_id<>p_branch_id or o.service_id<>p_service_id or o.device_id is distinct from p_device_id or o.customer_id is distinct from p_customer_id then raise exception 'IDEMPOTENCY_CONFLICT';end if;return o;
 end if;
 if p_customer_id is not null and not exists(select 1 from public.sh_customers where tenant_id=p_tenant_id and branch_id=p_branch_id and id=p_customer_id) then raise exception 'CUSTOMER_NOT_ALLOWED';end if;
 if p_device_id is not null then
  select * into d from public.sh_devices where tenant_id=p_tenant_id and branch_id=p_branch_id and id=p_device_id and enabled for update;
  if not found then raise exception 'DEVICE_UNAVAILABLE';end if;
  if exists(select 1 from public.sh_sessions where device_id=d.id and status in('queued','running','review')) then raise exception 'DEVICE_BUSY';end if;
 end if;
 -- The legacy insert needs a branch supplied without changing historical SQL.
 perform set_config('sh.branch',p_branch_id::text,true);
 o:=public.sh_create_order_legacy(p_tenant_id,p_user_id,p_service_id,p_device_id,p_customer_id,p_request_id);
 update public.sh_orders set created_by=p_user_id where id=o.id returning * into o;
 if p_device_id is not null then update public.sh_devices set reserved_order_id=o.id where id=p_device_id;end if;
 insert into internal.sh_audit(tenant_id,actor_id,action,resource_id) values(p_tenant_id,auth.uid(),'order.create',o.id);return o;
end$$;
create function internal.sh_order_branch() returns trigger language plpgsql set search_path='' as $$begin if new.branch_id is null then new.branch_id:=nullif(current_setting('sh.branch',true),'')::uuid;end if;return new;end$$;
create trigger sh_order_branch before insert on public.sh_orders for each row execute function internal.sh_order_branch();
create function public.sh_create_customer(p_tenant_id uuid,p_branch_id uuid,p_name text,p_phone text) returns public.sh_customers language plpgsql security definer set search_path='' as $$
declare c public.sh_customers;begin
 if p_branch_id is null or not internal.sh_can_scope(p_tenant_id,p_branch_id,array['owner','manager']) then raise exception 'FORBIDDEN';end if;
 if p_name is null or length(trim(p_name)) not between 1 and 120 or length(coalesce(p_phone,''))>32 then raise exception 'INVALID_BODY';end if;
 insert into public.sh_customers(tenant_id,branch_id,name,phone) values(p_tenant_id,p_branch_id,trim(p_name),p_phone) returning * into c;
 insert into internal.sh_audit(tenant_id,actor_id,action,resource_id) values(p_tenant_id,auth.uid(),'customer.create',c.id);return c;
end$$;
create or replace function public.sh_accept_payment(p_order_code bigint,p_amount integer,p_reference text) returns void language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare o public.sh_orders;d public.sh_devices;prior internal.sh_payment_events;begin
 if auth.role() is distinct from 'service_role' then raise exception 'FORBIDDEN';end if;
 select * into o from public.sh_orders where order_code=p_order_code for update;
 if not found or o.amount<>p_amount or p_reference is null or length(p_reference) not between 1 and 200 then raise exception 'PAYMENT_MISMATCH';end if;
 select * into prior from internal.sh_payment_events where reference=p_reference;
 if found then if prior.order_id<>o.id or prior.amount<>p_amount then raise exception 'EVENT_CONFLICT';end if;return;end if;
 insert into internal.sh_payment_events(order_id,reference,amount) values(o.id,p_reference,p_amount);
 if o.status<>'pending' then return;end if;
 if o.device_id is not null then
  select * into d from public.sh_devices where id=o.device_id for update;
  if not d.enabled or now()>=o.expires_at or d.status<>'reserved' or d.reserved_order_id is distinct from o.id or d.last_seen_at is null or d.last_seen_at<now()-interval '90 seconds' or exists(select 1 from public.sh_sessions where device_id=d.id and status in('queued','running','review')) then
   update public.sh_orders set status='paid_review' where id=o.id;return;
  end if;
  insert into public.sh_sessions(tenant_id,branch_id,order_id,device_id,duration_seconds) values(o.tenant_id,o.branch_id,o.id,o.device_id,o.duration_seconds);
 end if;
 update public.sh_orders set status='paid' where id=o.id;
end$$;
create or replace function public.sh_device_poll(p_device_id uuid,p_secret text,p_ack uuid default null,p_finished uuid default null) returns public.sh_sessions language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare s public.sh_sessions;begin
 if auth.role() is distinct from 'service_role' or not exists(select 1 from internal.sh_device_credentials k join public.sh_devices d on d.id=k.device_id where k.device_id=p_device_id and d.enabled and d.execution_mode='simulation' and k.secret_hash=encode(extensions.digest(p_secret,'sha256'),'hex')) then raise exception 'FORBIDDEN';end if;
 perform 1 from public.sh_devices where id=p_device_id for update;
 update public.sh_devices set last_seen_at=now() where id=p_device_id;
 if p_ack is not null then update public.sh_sessions set status='running',started_at=coalesce(started_at,now()) where id=p_ack and device_id=p_device_id and status='queued' and command_expires_at>now();if found then update public.sh_devices set status='running',reserved_until=null where id=p_device_id;end if;end if;
 if p_finished is not null then
  update public.sh_sessions set status='completed',finished_at=now() where id=p_finished and device_id=p_device_id and status='running' returning * into s;
  if found then update public.sh_devices set status='idle',reserved_until=null,reserved_order_id=null where id=p_device_id;update public.sh_orders set status='completed' where id=s.order_id;end if;
 end if;
 update public.sh_sessions set status='review' where device_id=p_device_id and status='queued' and command_expires_at<=now();
 select * into s from public.sh_sessions where device_id=p_device_id and status='queued' and command_expires_at>now();return s;
end$$;

do $$declare r record;n text;begin
 for r in select schemaname,tablename from pg_tables where (schemaname='public' and tablename like 'sh\_%' escape '\') or (schemaname='internal' and tablename like 'sh\_%' escape '\') loop
  execute format('alter table %I.%I owner to sh_rpc',r.schemaname,r.tablename);
  execute format('alter table %I.%I enable row level security',r.schemaname,r.tablename);
  execute format('revoke all on %I.%I from public,anon,authenticated',r.schemaname,r.tablename);
  execute format('grant select,insert,update,delete on %I.%I to service_role',r.schemaname,r.tablename);
 end loop;
 foreach n in array array['tenants','memberships','modules','customers','services','devices','orders','sessions'] loop execute format('drop policy tenant_read on public.sh_%I',n);end loop;
 for r in select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','internal') and p.proname like 'sh\_%' escape '\' loop
  execute format('alter function %I.%I(%s) owner to sh_rpc',r.nspname,r.proname,r.args);
  execute format('revoke all on function %I.%I(%s) from public,anon,authenticated,service_role',r.nspname,r.proname,r.args);
 end loop;
end$$;
alter sequence public.sh_order_code_seq owner to sh_rpc;
revoke all on sequence public.sh_order_code_seq from public,anon,authenticated;
grant usage on schema internal to authenticated,service_role;
grant select on public.sh_tenants,public.sh_branches,public.sh_memberships,public.sh_modules,public.sh_services,public.sh_customers,public.sh_devices,public.sh_orders,public.sh_sessions to authenticated;
create policy own_member on public.sh_memberships for select to authenticated using(user_id=auth.uid() and is_active and internal.sh_can_scope(tenant_id,branch_id));
create policy tenant_read on public.sh_tenants for select to authenticated using(internal.sh_can_scope(id,null));
create policy branch_read on public.sh_branches for select to authenticated using(internal.sh_can_scope(tenant_id,id));
create policy catalog_read on public.sh_modules for select to authenticated using(internal.sh_can_scope(tenant_id,null));
create policy catalog_read on public.sh_services for select to authenticated using(internal.sh_can_scope(tenant_id,null));
create policy pii_read on public.sh_customers for select to authenticated using(internal.sh_can_scope(tenant_id,branch_id,array['owner','manager']));
create policy financial_read on public.sh_orders for select to authenticated using(internal.sh_can_scope(tenant_id,branch_id,array['owner','manager']));
create policy operational_read on public.sh_devices for select to authenticated using(internal.sh_can_scope(tenant_id,branch_id));
create policy operational_read on public.sh_sessions for select to authenticated using(internal.sh_can_scope(tenant_id,branch_id));
grant update(name) on public.sh_branches to authenticated;
create policy branch_name on public.sh_branches for update to authenticated using(internal.sh_can_scope(tenant_id,id,array['owner','manager'])) with check(internal.sh_can_scope(tenant_id,id,array['owner','manager']));
grant execute on function internal.sh_can_scope(uuid,uuid,text[]),public.sh_is_member(uuid),public.sh_create_tenant(uuid,text),public.sh_create_order(uuid,uuid,uuid,uuid,uuid,uuid,uuid),public.sh_create_customer(uuid,uuid,text,text) to authenticated;
grant execute on function public.sh_accept_payment(bigint,integer,text),public.sh_device_poll(uuid,text,uuid,uuid) to service_role;
revoke create on schema public,internal from sh_rpc;
commit;
