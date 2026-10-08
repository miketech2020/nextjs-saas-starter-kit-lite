import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {unaccent} from '@electric-sql/pglite/contrib/unaccent';
import {s0Contract} from './s0-contract.mjs';
test('S0 migration, authorization, payment and lease contract',async()=>{
 let db;
 if(process.env.SH_TEST_DATABASE_URL){
  const url=new URL(process.env.SH_TEST_DATABASE_URL);
  if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.startsWith('/service_hub_s0_test'))throw Error('Only disposable local test DB allowed');
  const{Client}=await import('pg');const client=new Client({connectionString:url.href});await client.connect();db={query:(...args)=>client.query(...args),exec:sql=>client.query(sql),close:()=>client.end(),parallelAs:async(actor,sql,args)=>{const c=new Client({connectionString:url.href});await c.connect();try{await c.query('begin');await c.query('set local role authenticated');await c.query("select set_config('test.user_id',$1,true),set_config('test.role','authenticated',true)",[actor]);const r=await c.query(sql,args);await c.query('commit');return r;}finally{await c.end();}}};
 }else db=new PGlite({extensions:{pgcrypto,unaccent}});
 try{await s0Contract(db);}finally{await db.close();}
});
