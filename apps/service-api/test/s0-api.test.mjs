import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
const tenant='11111111-1111-4111-8111-111111111111',branch='22222222-2222-4222-8222-222222222222',owner='33333333-3333-4333-8333-333333333333',staff='44444444-4444-4444-8444-444444444444';
test('S0 API verified actor, RLS forwarding, branch guards, strict DTO and disabled adapters',async()=>{
 const calls=[];let actorRole='owner';
 const mock=createServer(async(req,res)=>{
  let text='';for await(const chunk of req)text+=chunk;const url=new URL(req.url,'http://localhost');calls.push({path:url.pathname,query:url.search,token:req.headers.authorization,key:req.headers.apikey,body:text?JSON.parse(text):null});res.setHeader('Content-Type','application/json');
  if(url.pathname==='/auth/v1/user')return res.end(JSON.stringify({id:actorRole==='staff'?staff:owner}));
  if(url.pathname.endsWith('/sh_memberships'))return res.end(JSON.stringify([{role:actorRole,branch_id:actorRole==='staff'?branch:null}]));
  if(url.pathname.endsWith('/sh_branches'))return res.end(JSON.stringify([{id:branch,name:'Test branch'}]));
  if(url.pathname.endsWith('/rpc/sh_create_customer'))return res.end(JSON.stringify({id:tenant,name:'Test customer'}));
  res.end('[]');
 });
 await new Promise(r=>mock.listen(0,'127.0.0.1',r));const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const child=spawn(process.execPath,['src/server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),SUPABASE_URL:`http://127.0.0.1:${mock.address().port}`,SUPABASE_ANON_KEY:'test-public-key',SUPABASE_SERVICE_ROLE_KEY:'MUST_NOT_BE_USED'},windowsHide:true,stdio:'pipe'});
 const base=`http://127.0.0.1:${port}`;
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,30));}assert.ok(ready);
  const post=(path,data,authenticated=true)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(authenticated?{Authorization:'Bearer test-user-token'}:{})},body:JSON.stringify(data)});
  assert.equal((await post('/orders',{},false)).status,401);
  assert.equal((await post('/webhooks/payos',{data:{},signature:'untrusted'})).status,503);assert.equal((await post('/devices/poll',{secret:'test'})).status,503);
  assert.equal((await post('/customers',{tenantId:tenant,branchId:branch,name:'Test customer',role:'owner'})).status,400);
  assert.equal((await post('/customers',{tenantId:tenant,branchId:branch,name:'x'.repeat(17000)})).status,413);
  assert.equal((await post('/customers',{tenantId:tenant,branchId:branch,name:'Test customer'})).status,201);
  assert.ok(calls.filter(c=>c.path.startsWith('/rest/')).every(c=>c.key==='test-public-key'&&c.token==='Bearer test-user-token'));
  actorRole='staff';calls.length=0;
  assert.equal((await post('/orders',{tenantId:tenant,branchId:branch})).status,403);
  const response=await fetch(base+`/overview?tenantId=${tenant}&branchId=${branch}`,{headers:{Authorization:'Bearer test-user-token'}});
  assert.equal(response.status,200);const data=await response.json();assert.deepEqual(data.customers,[]);assert.deepEqual(data.orders,[]);assert.equal(data.role,'staff');assert.ok(!calls.some(c=>c.path.endsWith('/sh_customers')||c.path.endsWith('/sh_orders')));assert.match(response.headers.get('cache-control'),/private.*no-store/);
  const other='55555555-5555-4555-8555-555555555555';assert.equal((await fetch(base+`/overview?tenantId=${tenant}&branchId=${other}`,{headers:{Authorization:'Bearer test-user-token'}})).status,403);
 }finally{child.kill();await once(child,'exit');await new Promise(r=>mock.close(r));}
});
