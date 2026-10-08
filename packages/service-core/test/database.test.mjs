import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

test('Postgres: tenant isolation, price authority, duplicate webhook, reservation and device lifecycle', async()=>{
 const db=new PGlite({extensions:{pgcrypto}});
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema extensions;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.user_id',true),'')::uuid$$;`);
 const migration=await readFile(new URL('../../../apps/web/supabase/migrations/20261008020000_service_hub.sql',import.meta.url),'utf8');await db.exec(migration);
 const user='00000000-0000-0000-0000-000000000001';const other='00000000-0000-0000-0000-000000000002';
 await db.query('insert into auth.users values($1),($2)',[user,other]);
 const one=(await db.query('select * from public.sh_create_tenant($1,$2)',[user,'Tiệm một'])).rows[0];
 const two=(await db.query('select * from public.sh_create_tenant($1,$2)',[other,'Tiệm hai'])).rows[0];
 const service=(await db.query("select * from public.sh_services where tenant_id=$1 and code='self-wash'",[one.id])).rows[0];
 const device=(await db.query("insert into public.sh_devices(tenant_id,name,kind,last_seen_at) values($1,'Máy 1','wash-bay',now()) returning *",[one.id])).rows[0];
 await db.query("insert into public.sh_device_credentials values($1,encode(extensions.digest('device-secret','sha256'),'hex'))",[device.id]);
 const request='00000000-0000-0000-0000-000000000011';
 const args=[one.id,user,service.id,device.id,null,request];
 const create='select * from public.sh_create_order($1,$2,$3,$4,$5,$6)';
 const order=(await db.query(create,args)).rows[0];assert.equal(order.amount,service.price);
 const again=(await db.query(create,args)).rows[0];assert.equal(again.id,order.id);
 await assert.rejects(db.query(create,[one.id,other,service.id,device.id,null,'00000000-0000-0000-0000-000000000012']));
 await assert.rejects(db.query(create,[one.id,user,service.id,device.id,null,'00000000-0000-0000-0000-000000000013']));
 await assert.rejects(db.query('select public.sh_accept_payment($1,$2,$3)',[order.order_code,1,'wrong-amount']));
 await db.query('select public.sh_accept_payment($1,$2,$3)',[order.order_code,order.amount,'txn-1']);
 await db.query('select public.sh_accept_payment($1,$2,$3)',[order.order_code,order.amount,'txn-1']);
 assert.equal((await db.query('select count(*)::int as n from public.sh_sessions')).rows[0].n,1);
 await assert.rejects(db.query('select public.sh_device_poll($1,$2)',[device.id,'bad-secret']));
 const session=(await db.query('select * from public.sh_device_poll($1,$2)',[device.id,'device-secret'])).rows[0];assert.equal(session.order_id,order.id);
 await db.query('select public.sh_device_poll($1,$2,$3)',[device.id,'device-secret',session.id]);
 assert.equal((await db.query('select status from public.sh_devices where id=$1',[device.id])).rows[0].status,'running');
 await db.query('select public.sh_device_poll($1,$2,null,$3)',[device.id,'device-secret',session.id]);
 assert.equal((await db.query('select status from public.sh_orders where id=$1',[order.id])).rows[0].status,'completed');
 // RLS as a browser user excludes the other tenant and hides device credentials.
 await db.query("select set_config('test.user_id',$1,false)",[user]);await db.exec('set role authenticated');
 assert.equal((await db.query('select count(*)::int as n from public.sh_tenants')).rows[0].n,1);
 await assert.rejects(db.query('select * from public.sh_device_credentials'));
 await assert.rejects(db.query('select public.sh_accept_payment($1,$2,$3)',[order.order_code,order.amount,'browser']));
 await db.exec('reset role');
 // A foreign customer's tenant cannot be smuggled into an order.
 const customer=(await db.query("insert into public.sh_customers(tenant_id,name) values($1,'Khách khác') returning id",[two.id])).rows[0];
 await assert.rejects(db.query(create,[one.id,user,service.id,device.id,customer.id,'00000000-0000-0000-0000-000000000014']));
 const late=(await db.query(create,[one.id,user,service.id,device.id,null,'00000000-0000-0000-0000-000000000015'])).rows[0];
 await db.query("update public.sh_orders set expires_at=now()-interval '1 second' where id=$1",[late.id]);
 await db.query('select public.sh_accept_payment($1,$2,$3)',[late.order_code,late.amount,'txn-late']);
 assert.equal((await db.query('select status from public.sh_orders where id=$1',[late.id])).rows[0].status,'paid_review');
 await db.query("update public.sh_devices set status='idle',reserved_until=null where id=$1",[device.id]);
 const expired=(await db.query(create,[one.id,user,service.id,device.id,null,'00000000-0000-0000-0000-000000000016'])).rows[0];
 await db.query('select public.sh_accept_payment($1,$2,$3)',[expired.order_code,expired.amount,'txn-expired-command']);
 await db.query("update public.sh_sessions set command_expires_at=now()-interval '1 second' where order_id=$1",[expired.id]);
 await db.query('select public.sh_device_poll($1,$2)',[device.id,'device-secret']);
 assert.equal((await db.query('select status from public.sh_sessions where order_id=$1',[expired.id])).rows[0].status,'review');
 }finally{await db.close();}
});
