import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
export async function s0Contract(db){
 let count=0;const test=async(name,fn)=>{await fn();count++;console.log('S0 PASS '+name);};
 await db.exec(`do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;end$$;
 create schema auth;create schema extensions;create schema storage;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.user_id',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select nullif(current_setting('test.role',true),'')$$;
 create function extensions.uuid_generate_v4() returns uuid language sql as $$select gen_random_uuid()$$;
 create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid,name text,bucket_id text);
 create function storage.filename(text) returns text language sql as $$select $1$$;create function storage.extension(text) returns text language sql as $$select split_part($1,'.',2)$$;
 grant usage on schema public,auth,extensions,storage to anon,authenticated,service_role;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`);
 for(const name of['20241219010757_schema.sql','20261008020000_service_hub.sql','20261008030000_s0_security.sql'])await db.exec(await readFile(new URL('../../../apps/web/supabase/migrations/'+name,import.meta.url),'utf8'));
 const owner=randomUUID(),staff=randomUUID(),manager=randomUUID(),other=randomUUID();
 for(const id of[owner,staff,manager,other])await db.query('insert into auth.users(id,email) values($1,$2)',[id,id+'@test.invalid']);
 async function as(actor,sql,args=[],role='authenticated'){
  await db.exec('begin');try{await db.exec(`set local role ${role}`);await db.query("select set_config('test.user_id',$1,true),set_config('test.role',$2,true)",[actor??'',role]);const result=await db.query(sql,args);await db.exec('commit');return result;}catch(e){await db.exec('rollback');throw e;}
 }
 const tenant=(await as(owner,'select * from public.sh_create_tenant($1,$2)',[owner,'S0 tenant'])).rows[0];
 const t2=(await as(other,'select * from public.sh_create_tenant($1,$2)',[other,'Other tenant'])).rows[0];
 const branch=(await db.query('select id from public.sh_branches where tenant_id=$1',[tenant.id])).rows[0].id;
 const b2=(await db.query("insert into public.sh_branches(tenant_id,name) values($1,'Other branch') returning id",[tenant.id])).rows[0].id;
 await db.query("insert into public.sh_memberships(tenant_id,user_id,role,branch_id) values($1,$2,'staff',$3),($1,$4,'manager',$3)",[tenant.id,staff,branch,manager]);
 const svc=(await db.query("select * from public.sh_services where tenant_id=$1 and code='self-wash'",[tenant.id])).rows[0];
 const device=(await db.query("insert into public.sh_devices(tenant_id,branch_id,name,kind,last_seen_at,enabled) values($1,$2,'S0 simulation','wash-bay',now(),true) returning *",[tenant.id,branch])).rows[0];
 await db.query("insert into internal.sh_device_credentials values($1,encode(extensions.digest('test-only-secret','sha256'),'hex'))",[device.id]);
 const create=(actor=owner,key=randomUUID(),b=branch)=>as(actor,'select * from public.sh_create_order($1,$2,$3,$4,$5,$6,$7)',[tenant.id,actor,svc.id,device.id,null,key,b]).then(r=>r.rows[0]);
 await test('full migration sequence applies and laundry is disabled',async()=>assert.equal((await db.query("select enabled from public.sh_modules where tenant_id=$1 and module_key='laundry'",[tenant.id])).rows[0].enabled,false));
 await test('outsider cannot see tenant rows',async()=>assert.equal((await as(other,'select * from public.sh_customers where tenant_id=$1',[tenant.id])).rows.length,0));
 await as(owner,'select public.sh_create_customer($1,$2,$3,$4)',[tenant.id,branch,'Scoped customer','TEST_ONLY']);
 await as(owner,'select public.sh_create_customer($1,$2,$3,$4)',[tenant.id,b2,'Different branch customer','TEST_ONLY']);
 await test('staff cannot read PII or create orders',async()=>{assert.equal((await as(staff,'select * from public.sh_customers')).rows.length,0);await assert.rejects(()=>create(staff),/FORBIDDEN/);});
 await test('manager sees only assigned branch',async()=>{assert.equal((await as(manager,'select * from public.sh_customers')).rows.length,1);await assert.rejects(()=>create(manager,randomUUID(),b2),/FORBIDDEN/);});
 await test('inactive member cannot read or mutate',async()=>{await db.query('update public.sh_memberships set is_active=false where user_id=$1',[manager]);assert.equal((await as(manager,'select * from public.sh_branches')).rows.length,0);await assert.rejects(()=>create(manager),/FORBIDDEN/);await db.query('update public.sh_memberships set is_active=true where user_id=$1',[manager]);});
 await test('caller cannot forge p_user_id',async()=>await assert.rejects(()=>as(owner,'select public.sh_create_order($1,$2,$3,$4,$5,$6,$7)',[tenant.id,other,svc.id,device.id,null,randomUUID(),branch]),/FORBIDDEN/));
 await test('direct financial, membership and private writes denied',async()=>{for(const table of['public.sh_orders','public.sh_memberships','internal.sh_payment_events','internal.sh_device_credentials'])await assert.rejects(()=>as(owner,`delete from ${table}`),/permission denied/);});
 await test('legacy functions cannot bypass guarded RPC',async()=>await assert.rejects(()=>as(owner,'select public.sh_create_order_legacy($1,$2,$3,$4,$5,$6)',[tenant.id,owner,svc.id,device.id,null,randomUUID()]),/permission denied/));
 await test('cross-tenant composite FK rejects association',async()=>await assert.rejects(()=>db.query("insert into public.sh_devices(tenant_id,branch_id,name,kind) values($1,$2,'Bad','wash-bay')",[t2.id,branch]),/foreign key/));
 const key=randomUUID(),order=await create(owner,key);
 await test('duplicate returns same order; changed branch conflicts',async()=>{assert.equal((await create(owner,key)).id,order.id);await assert.rejects(()=>create(owner,key,b2),/IDEMPOTENCY_CONFLICT/);});
 if(db.parallelAs)await test('20 native connections retry the same order without duplicate reservations',async()=>{const results=await Promise.all(Array.from({length:20},()=>db.parallelAs(owner,'select * from public.sh_create_order($1,$2,$3,$4,$5,$6,$7)',[tenant.id,owner,svc.id,device.id,null,key,branch])));assert.equal(new Set(results.map(r=>r.rows[0].id)).size,1);});
 await test('unverified browser cannot credit payment',async()=>await assert.rejects(()=>as(owner,'select public.sh_accept_payment($1,$2,$3)',[order.order_code,order.amount,'fake']),/permission denied/));
 await as(null,'select public.sh_accept_payment($1,$2,$3)',[order.order_code,order.amount,'first'],'service_role');
 await test('duplicate trusted payment produces one session and event',async()=>{await as(null,'select public.sh_accept_payment($1,$2,$3)',[order.order_code,order.amount,'first'],'service_role');assert.equal((await db.query('select count(*)::int n from public.sh_sessions')).rows[0].n,1);assert.equal((await db.query('select count(*)::int n from internal.sh_payment_events')).rows[0].n,1);});
 await db.query("update public.sh_sessions set command_expires_at=now()-interval '1 second'");
 await as(null,'select public.sh_device_poll($1,$2)',[device.id,'test-only-secret'],'service_role');
 await db.query("update public.sh_devices set reserved_until=now()-interval '1 second'");
 await test('review session blocks new checkout even after lease timeout',async()=>await assert.rejects(()=>create(),/DEVICE_BUSY/));
 await test('received payment persists when fulfillment cannot run',async()=>{
  const late=(await db.query("insert into public.sh_orders(tenant_id,branch_id,service_id,device_id,service_name,module_key,amount,duration_seconds,request_id) values($1,$2,$3,$4,'Late','carwash',$5,600,$6) returning *",[tenant.id,branch,svc.id,device.id,svc.price,randomUUID()])).rows[0];
  await as(null,'select public.sh_accept_payment($1,$2,$3)',[late.order_code,late.amount,'late'],'service_role');assert.equal((await db.query('select status from public.sh_orders where id=$1',[late.id])).rows[0].status,'paid_review');assert.equal((await db.query('select count(*)::int n from internal.sh_payment_events where order_id=$1',[late.id])).rows[0].n,1);
 });
 await test('NOLOGIN owner / empty search path / no PUBLIC EXECUTE',async()=>{const rows=(await db.query("select p.proname,p.proconfig,r.rolname,r.rolcanlogin,r.rolsuper,r.rolbypassrls,exists(select 1 from aclexplode(p.proacl) where grantee=0 and privilege_type='EXECUTE') open from pg_proc p join pg_roles r on r.oid=p.proowner where p.proname like 'sh\\_%' escape '\\' and p.prosecdef")).rows;assert.ok(rows.length>5);for(const r of rows){assert.equal(r.rolname,'sh_rpc');assert.equal(r.rolcanlogin,false);assert.equal(r.rolsuper,false);assert.equal(r.rolbypassrls,false);assert.equal(r.open,false);assert.ok(r.proconfig.includes('search_path=""'));}});
 await test('WITH CHECK branch rename cannot move scope',async()=>{assert.equal((await as(manager,"update public.sh_branches set name='Denied' where id=$1 returning id",[b2])).rows.length,0);await assert.rejects(()=>as(owner,'update public.sh_branches set tenant_id=$1 where id=$2',[t2.id,branch]),/permission denied/);});
 await test('inactive tenant hides own membership and all branches',async()=>{await db.query('update public.sh_tenants set active=false where id=$1',[tenant.id]);assert.equal((await as(owner,'select * from public.sh_memberships where tenant_id=$1',[tenant.id])).rows.length,0);assert.equal((await as(owner,'select * from public.sh_branches where tenant_id=$1',[tenant.id])).rows.length,0);});
 return count;
}
