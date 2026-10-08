import http from 'node:http';
import {randomUUID} from 'node:crypto';
const {SUPABASE_URL,APP_ORIGIN='http://localhost:3000'}=process.env;
const KEY=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY;
// Public exposure needs the shared limiter/merchant/device adapters from S2/S3.
if(process.env.NODE_ENV==='production')throw new Error('S0 service-api is local-only; public deployment is disabled');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=(status,code)=>Object.assign(new Error(code),{status});
async function db(route,token,options={}){
 if(!SUPABASE_URL||!KEY)throw fail(503,'NOT_CONFIGURED');
 const r=await fetch(`${SUPABASE_URL}/rest/v1/${route}`,{...options,headers:{apikey:KEY,Authorization:token,'Content-Type':'application/json',Prefer:'return=representation'},signal:AbortSignal.timeout(10000)});
 if(!r.ok){const e=await r.json().catch(()=>({}));const codes=['FORBIDDEN','DEVICE_BUSY','DEVICE_UNAVAILABLE','CUSTOMER_NOT_ALLOWED','IDEMPOTENCY_CONFLICT','TENANT_QUOTA'];throw fail(e.message==='FORBIDDEN'?403:codes.includes(e.message)?409:503,codes.includes(e.message)?e.message:'DATA_UNAVAILABLE');}
 return r.status===204?null:r.json();
}
const rpc=(name,args,token)=>db(`rpc/${name}`,token,{method:'POST',body:JSON.stringify(args)});
async function user(req){
 const token=req.headers.authorization;if(!token?.startsWith('Bearer ')||token.length>8192)throw fail(401,'UNAUTHENTICATED');
 if(!SUPABASE_URL||!KEY)throw fail(503,'NOT_CONFIGURED');
 const r=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{apikey:KEY,Authorization:token},signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw fail(401,'UNAUTHENTICATED');const actor=await r.json();if(!UUID.test(actor.id??''))throw fail(401,'UNAUTHENTICATED');return{actor,token};
}
async function body(req){
 if(!req.headers['content-type']?.startsWith('application/json'))throw fail(415,'JSON_REQUIRED');
 let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>16384)throw fail(413,'BODY_TOO_LARGE');chunks.push(chunk);}
 try{const v=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!v||typeof v!=='object'||Array.isArray(v))throw Error();return v;}catch{throw fail(400,'INVALID_BODY');}
}
function validate(v,schema){if(Object.keys(v).some(k=>!Object.hasOwn(schema,k)))throw fail(400,'INVALID_BODY');for(const[k,test]of Object.entries(schema))if(!test(v[k]))throw fail(400,'INVALID_BODY');return v;}
const id=x=>typeof x==='string'&&UUID.test(x),optionalId=x=>x==null||id(x),name=x=>typeof x==='string'&&x.trim().length>=2&&x.trim().length<=120;
function send(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
const server=http.createServer(async(req,res)=>{
 const requestId=randomUUID();res.setHeader('X-Request-ID',requestId);
 if(req.headers.origin===APP_ORIGIN){res.setHeader('Access-Control-Allow-Origin',APP_ORIGIN);res.setHeader('Vary','Origin');}
 if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.writeHead(204);return res.end();}
 try{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/health')return send(res,200,{status:'ok',payments:'disabled',devices:'disabled'});
  // No global merchant or physical START adapter is allowed by this S0 starter.
  if(['/webhooks/payos','/devices/poll'].includes(url.pathname))return send(res,503,{error:'ADAPTER_DISABLED'});
  const{actor,token}=await user(req);
  if(req.method==='POST'&&url.pathname==='/tenants'){const v=validate(await body(req),{name});return send(res,201,await rpc('sh_create_tenant',{p_user_id:actor.id,p_name:v.name.trim()},token));}
  if(req.method==='GET'&&url.pathname==='/tenants')return send(res,200,await db(`sh_memberships?user_id=eq.${actor.id}&is_active=eq.true&select=tenant_id,branch_id,role,sh_tenants(id,name)&limit=50`,token));
  const v=req.method==='POST'?await body(req):{};const tenant=v.tenantId??url.searchParams.get('tenantId');if(!id(tenant))throw fail(400,'INVALID_SCOPE');
  if(req.method==='GET'&&url.pathname==='/branches')return send(res,200,await db(`sh_branches?tenant_id=eq.${tenant}&active=eq.true&select=id,name&order=name&limit=50`,token));
  const branch=v.branchId??url.searchParams.get('branchId');if(!id(branch))throw fail(400,'INVALID_SCOPE');
  const memberships=await db(`sh_memberships?tenant_id=eq.${tenant}&user_id=eq.${actor.id}&is_active=eq.true&select=role,branch_id`,token);
  const member=memberships.find(m=>m.branch_id===null||m.branch_id===branch);if(!member)throw fail(403,'FORBIDDEN');
  const branches=await db(`sh_branches?tenant_id=eq.${tenant}&id=eq.${branch}&active=eq.true&select=id&limit=1`,token);if(!branches.length)throw fail(403,'FORBIDDEN');
  const manage=['owner','manager'].includes(member.role);
  if(req.method==='GET'&&url.pathname==='/overview'){
   const read=(t,fields,scoped=true)=>db(`sh_${t}?tenant_id=eq.${tenant}${scoped?`&branch_id=eq.${branch}`:''}&select=${fields}&limit=50`,token);
   const[services,orders,devices,sessions,customers]=await Promise.all([read('services','id,module_key,name,price,device_kind,duration_seconds',false),manage?read('orders','id,service_name,module_key,amount,status,checkout_url,created_at'):[],read('devices','id,name,kind,status,last_seen_at'),read('sessions','id,status'),manage?read('customers','id,name,phone'):[]]);return send(res,200,{services,orders,devices,sessions,customers,role:member.role});
  }
  if(req.method==='POST'&&url.pathname==='/customers'){if(!manage)throw fail(403,'FORBIDDEN');validate(v,{tenantId:id,branchId:id,name,phone:x=>x==null||(typeof x==='string'&&x.length<=32)});return send(res,201,await rpc('sh_create_customer',{p_tenant_id:tenant,p_branch_id:branch,p_name:v.name,p_phone:v.phone??null},token));}
  if(req.method==='POST'&&url.pathname==='/orders'){
   if(!manage)throw fail(403,'FORBIDDEN');validate(v,{tenantId:id,branchId:id,serviceId:id,deviceId:optionalId,customerId:optionalId,requestId:id});
   const order=await rpc('sh_create_order',{p_tenant_id:tenant,p_branch_id:branch,p_user_id:actor.id,p_service_id:v.serviceId,p_device_id:v.deviceId??null,p_customer_id:v.customerId??null,p_request_id:v.requestId},token);
   return send(res,201,{...order,checkout_url:null,payment_mode:'disabled'});
  }
  send(res,404,{error:'NOT_FOUND'});
 }catch(e){console.error(JSON.stringify({requestId,code:e.status?e.message:'INTERNAL_ERROR'}));send(res,e.status??503,{error:e.status?e.message:'SERVICE_UNAVAILABLE'});}
});
server.requestTimeout=15000;server.headersTimeout=10000;server.maxHeadersCount=40;
server.listen(Number(process.env.PORT??3100),'127.0.0.1');
