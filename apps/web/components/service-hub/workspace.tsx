'use client';
import { useEffect, useRef, useState } from 'react';
import { useSupabase } from '@kit/supabase/hooks/use-supabase';
import { Car, WashingMachine, Plus, RefreshCw, Layers, Monitor, Users, ClipboardList } from 'lucide-react';

type Service = { id:string; module_key:string; name:string; price:number; device_kind:string|null; duration_seconds:number };
type Order = {id:string;service_name:string;module_key:string;amount:number;status:string;checkout_url?:string;created_at?:string};
type Device = {id:string;name:string;kind:string;status:string;last_seen_at?:string};
type Customer = {id:string;name:string;phone?:string};
type Overview = {services:Service[];orders:Order[];devices:Device[];sessions:{id:string;status:string}[];customers:Customer[]};
type Tenant = {tenant_id:string;role?:string;sh_tenants:{name:string}};
type Branch = {id:string;name:string};
const initial:Overview = {services:[
 {id:'cw1',module_key:'carwash',name:'Tự rửa xe',price:30000,device_kind:'wash-bay',duration_seconds:600},
 {id:'cw2',module_key:'carwash',name:'Rửa xe có nhân viên',price:70000,device_kind:null,duration_seconds:1800},
 {id:'l1',module_key:'laundry',name:'Giặt tự phục vụ',price:40000,device_kind:'washer',duration_seconds:1800},
 {id:'l2',module_key:'laundry',name:'Sấy tự phục vụ',price:30000,device_kind:'dryer',duration_seconds:1200},
],orders:[],devices:[{id:'d1',name:'Khoang rửa 01',kind:'wash-bay',status:'idle'},{id:'d2',name:'Máy giặt 01',kind:'washer',status:'idle'},{id:'d3',name:'Máy sấy 01',kind:'dryer',status:'idle'}],sessions:[],customers:[]};
const labels:Record<string,string>={pending:'Chờ thanh toán',paid:'Đã thanh toán',paid_review:'Cần đối soát',completed:'Hoàn thành',cancelled:'Đã hủy',idle:'Sẵn sàng',reserved:'Đang giữ chỗ',running:'Đang chạy',maintenance:'Bảo trì',queued:'Chờ máy',review:'Cần kiểm tra'};
const money=(n:number)=>new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND'}).format(n);
export function ServiceWorkspace({demo=false}:{demo?:boolean}) {
 const supabase=useSupabase();
 const request=useRef<{key:string;id:string}|null>(null);
 const [data,setData]=useState<Overview>(demo?initial:{services:[],orders:[],devices:[],sessions:[],customers:[]});
 const [tenants,setTenants]=useState<Tenant[]>([]); const [tenant,setTenant]=useState('');
 const [branches,setBranches]=useState<Branch[]>([]);const [branch,setBranch]=useState('');
 const scope=useRef('');scope.current=`${tenant}/${branch}`;
 const canManage=demo||['owner','manager'].includes(tenants.find(t=>t.tenant_id===tenant)?.role??'');
 const [module,setModule]=useState('all'); const [tab,setTab]=useState('orders');
 const [error,setError]=useState(''); const [busy,setBusy]=useState(false); const [message,setMessage]=useState('');
 const [serviceId,setServiceId]=useState(''); const [customerId,setCustomerId]=useState('');const [deviceId,setDeviceId]=useState('');
 const [tenantName,setTenantName]=useState(''); const [customerName,setCustomerName]=useState('');const [customerPhone,setCustomerPhone]=useState('');
 async function api(path:string,payload?:Record<string,unknown>,signal?:AbortSignal) {
  const base=process.env.NEXT_PUBLIC_SERVICE_API_URL;
  if(!base) throw new Error('Chưa cấu hình kết nối dịch vụ. Dùng trang bản thử để xem các module.');
  const {data:session}=await supabase.auth.getSession();
  if(!session.session) throw new Error('Vui lòng đăng nhập trước.');
  const result=await fetch(base+path,{method:payload?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.session.access_token}`},body:payload?JSON.stringify(payload):undefined,signal});
  const value=await result.json(); if(!result.ok) throw new Error(({FORBIDDEN:'Bạn chưa được cấp quyền thao tác ở chi nhánh này.',INVALID_BODY:'Kiểm tra thông tin đã nhập.',DEVICE_BUSY:'Máy đang bận hoặc cần kiểm tra.',ADAPTER_DISABLED:'Tích hợp đang tạm khóa.'} as Record<string,string>)[value.error]??'Không thể xử lý dữ liệu. Thử lại.'); return value;
 }
 async function load(id=tenant,b=branch,signal?:AbortSignal) { if(!demo&&id&&b){const next=await api(`/overview?tenantId=${encodeURIComponent(id)}&branchId=${encodeURIComponent(b)}`,undefined,signal);if(scope.current===`${id}/${b}`)setData(next);} }
 function resetSelection(){setServiceId('');setCustomerId('');setDeviceId('');request.current=null;setData({services:[],orders:[],devices:[],sessions:[],customers:[]});setError('');setMessage('');}
 function changeTenant(id:string){scope.current=`${id}/`;setTenant(id);setBranch('');setBranches([]);resetSelection();}
 function changeBranch(id:string){scope.current=`${tenant}/${id}`;setBranch(id);resetSelection();}
 async function action(fn:()=>Promise<void>) { setBusy(true);setError('');setMessage('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'Có lỗi xảy ra');}finally{setBusy(false);} }
 useEffect(()=>{ if(demo){ const saved=localStorage.getItem('service-hub-demo-v1'); if(saved){try{setData(JSON.parse(saved));}catch{}} return; } let cancelled=false; api('/tenants').then((items:Tenant[])=>{if(!cancelled){setTenants(items);changeTenant(items[0]?.tenant_id??'');}}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;}; },[]);
 useEffect(()=>{if(demo||!tenant)return;const controller=new AbortController();api(`/branches?tenantId=${encodeURIComponent(tenant)}`,undefined,controller.signal).then((items:Branch[])=>{if(!controller.signal.aborted){setBranches(items);setBranch(items[0]?.id??'');}}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[tenant]);
 useEffect(()=>{if(demo||!tenant||!branch)return;const controller=new AbortController();setBusy(true);load(tenant,branch,controller.signal).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});return()=>controller.abort();},[tenant,branch]);
 function persist(next:Overview){setData(next);localStorage.setItem('service-hub-demo-v1',JSON.stringify(next));}
 const services=data.services.filter(s=>module==='all'||s.module_key===module);
 const service=data.services.find(s=>s.id===serviceId);
 const orders=data.orders.filter(o=>module==='all'||o.module_key===module);
 const revenue=orders.filter(o=>['paid','completed','paid_review'].includes(o.status)).reduce((sum,o)=>sum+o.amount,0);
 async function createOrder() {
  if(!service) throw new Error('Chọn dịch vụ');
  if(service.device_kind&&!deviceId) throw new Error('Chọn máy phù hợp');
  if(demo){const order:Order={id:crypto.randomUUID(),service_name:service.name,module_key:service.module_key,amount:service.price,status:'pending',created_at:new Date().toISOString()};persist({...data,orders:[order,...data.orders]});setMessage('Đã tạo đơn thử. Nút xác nhận bên dưới mô phỏng thanh toán.');}
  else {const key=JSON.stringify([tenant,branch,serviceId,customerId,deviceId]);if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()};await api('/orders',{tenantId:tenant,branchId:branch,serviceId,customerId:customerId||null,deviceId:deviceId||null,requestId:request.current.id});request.current=null;await load();setMessage('Đã tạo đơn. Checkout thật đang khóa trong S0.');}
 }
 const panel='rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900';
 const input='w-full rounded-lg border border-slate-300 bg-transparent p-2.5 text-sm dark:border-slate-600';
 const button='rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50';
 return <main className="mx-auto w-full max-w-7xl space-y-6 p-4 text-slate-900 md:p-8 dark:text-slate-100">
  <header className="flex flex-wrap items-center justify-between gap-4"><div><p className="mb-1 text-sm font-semibold text-blue-600">SERVICE HUB</p><h1 className="text-3xl font-bold">Điều hành dịch vụ</h1></div><div className="flex flex-wrap items-center gap-3">{demo?<span className="rounded-full bg-amber-100 px-3 py-2 text-sm text-amber-900">Bản thử · không thu tiền, không chạy máy</span>:<select aria-label="Cơ sở" className={input} value={tenant} onChange={e=>changeTenant(e.target.value)}>{tenants.map(t=><option key={t.tenant_id} value={t.tenant_id}>{t.sh_tenants.name}</option>)}</select>}{!demo&&<select aria-label="Chi nhánh" className={input} value={branch} onChange={e=>changeBranch(e.target.value)}>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select>}<button aria-label="Làm mới" disabled={busy} className="rounded-lg border p-2.5" onClick={()=>void action(()=>load())}><RefreshCw size={18}/></button></div></header>
  {error&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p>}{message&&<p role="status" className="rounded-xl bg-blue-50 p-4 text-blue-800">{message}</p>}
  {!demo&&!tenant&&<form className={panel} onSubmit={e=>{e.preventDefault();void action(async()=>{const t=await api('/tenants',{name:tenantName});setTenants([...tenants,{tenant_id:t.id,role:'owner',sh_tenants:{name:t.name}}]);changeTenant(t.id);});}}><h2 className="mb-3 text-lg font-semibold">Tạo cơ sở đầu tiên</h2><div className="flex gap-3"><input required minLength={2} aria-label="Tên cơ sở" placeholder="Tên cơ sở" className={input} value={tenantName} onChange={e=>setTenantName(e.target.value)}/><button className={button} disabled={busy}>Tạo</button></div></form>}
  <div className="flex flex-wrap gap-2">{[{id:'all',name:'Tất cả dịch vụ',Icon:Layers},{id:'carwash',name:'Rửa xe',Icon:Car},{id:'laundry',name:'Giặt ủi',Icon:WashingMachine}].map(({id,name,Icon})=><button key={id} onClick={()=>{setModule(id);setServiceId('');setDeviceId('');}} className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${module===id?'bg-slate-900 text-white dark:bg-blue-600':'border bg-white text-slate-700'}`}><Icon size={18}/>{name}</button>)}</div>
  <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[{label:'Đã thu trong danh sách',value:money(revenue)},{label:'Đơn hàng',value:orders.length},{label:'Thiết bị đang chạy',value:data.devices.filter(d=>d.status==='running').length},{label:'Khách hàng',value:data.customers.length}].map(s=><div key={s.label} className={panel}><p className="text-sm text-slate-500">{s.label}</p><p className="mt-3 text-2xl font-bold">{s.value}</p></div>)}</section>
  <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]"><section className={panel}><nav className="mb-5 flex flex-wrap gap-4 border-b pb-3">{[{id:'orders',name:'Đơn hàng',Icon:ClipboardList},{id:'devices',name:'Thiết bị',Icon:Monitor},{id:'customers',name:'Khách hàng',Icon:Users}].map(({id,name,Icon})=><button className={`flex items-center gap-2 text-sm font-semibold ${tab===id?'text-blue-600':'text-slate-500'}`} onClick={()=>setTab(id)} key={id}><Icon size={17}/>{name}</button>)}</nav>
  {tab==='orders'&&<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-slate-500"><th className="pb-3">Dịch vụ</th><th>Số tiền</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{orders.map(o=><tr key={o.id} className="border-b"><td className="py-4 pr-4 font-medium">{o.service_name}<p className="text-xs font-normal text-slate-500">{o.module_key==='carwash'?'Rửa xe':'Giặt ủi'}</p></td><td className="pr-4 whitespace-nowrap">{money(o.amount)}</td><td className="pr-4">{labels[o.status]??o.status}</td><td>{demo&&o.status==='pending'?<button className="text-blue-600" onClick={()=>persist({...data,orders:data.orders.map(x=>x.id===o.id?{...x,status:'paid'}:x)})}>Xác nhận thử</button>:o.checkout_url&&o.status==='pending'?<a className="text-blue-600 underline" target="_blank" rel="noreferrer" href={o.checkout_url}>Thanh toán</a>:null}</td></tr>)}</tbody></table>{!orders.length&&<p className="py-10 text-center text-slate-500">Chưa có đơn hàng. Tạo đơn từ biểu mẫu bên cạnh.</p>}</div>}
  {tab==='devices'&&<div className="space-y-3">{data.devices.map(d=><div key={d.id} className="flex items-center justify-between rounded-xl border p-4"><div><p className="font-semibold">{d.name}</p><p className="text-sm text-slate-500">{d.kind}</p></div><span className="text-sm">{labels[d.status]??d.status}</span></div>)}{!data.devices.length&&<p className="py-6 text-slate-500">Chưa có thiết bị được cấu hình.</p>}</div>}
  {tab==='customers'&&<div className="space-y-4"><form className="space-y-3" onSubmit={e=>{e.preventDefault();void action(async()=>{if(demo)persist({...data,customers:[...data.customers,{id:crypto.randomUUID(),name:customerName,phone:customerPhone}]});else{await api('/customers',{tenantId:tenant,branchId:branch,name:customerName,phone:customerPhone});await load();}setCustomerName('');setCustomerPhone('');});}}><input required className={input} aria-label="Tên khách hàng" placeholder="Tên khách hàng" value={customerName} onChange={e=>setCustomerName(e.target.value)}/><input className={input} aria-label="Số điện thoại" placeholder="Số điện thoại" value={customerPhone} onChange={e=>setCustomerPhone(e.target.value)}/><button className={button} disabled={busy||!canManage}>Thêm khách hàng</button></form>{data.customers.map(c=><div key={c.id} className="border-t pt-3"><p className="font-semibold">{c.name}</p><p className="text-sm text-slate-500">{c.phone}</p></div>)}</div>}
  </section><form className={`${panel} space-y-4`} onSubmit={e=>{e.preventDefault();void action(createOrder);}}><h2 className="flex items-center gap-2 text-lg font-semibold"><Plus size={19}/>Tạo đơn dịch vụ</h2><label className="block space-y-2 text-sm"><span>Dịch vụ</span><select required className={input} value={serviceId} onChange={e=>{setServiceId(e.target.value);setDeviceId('');}}><option value="">Chọn dịch vụ</option>{services.map(s=><option key={s.id} value={s.id}>{s.name} · {money(s.price)}</option>)}</select></label><label className="block space-y-2 text-sm"><span>Khách hàng</span><select className={input} value={customerId} onChange={e=>setCustomerId(e.target.value)}><option value="">Khách vãng lai</option>{data.customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{service?.device_kind&&<label className="block space-y-2 text-sm"><span>Thiết bị</span><select required className={input} value={deviceId} onChange={e=>setDeviceId(e.target.value)}><option value="">Chọn máy sẵn sàng</option>{data.devices.filter(d=>d.kind===service.device_kind&&d.status==='idle').map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}<div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800"><p className="text-sm text-slate-500">Tổng tiền</p><p className="mt-1 text-2xl font-bold">{money(service?.price??0)}</p></div><button disabled={busy||!canManage||!service||(!demo&&(!tenant||!branch))} className={`${button} w-full`}>{busy?'Đang xử lý…':'Tạo đơn'}</button><p className="text-sm text-slate-500">{demo?'Dữ liệu thử được lưu trên trình duyệt này.':'Trạng thái thanh toán được xác nhận bởi cổng thanh toán.'}</p></form></div>
 </main>;
}
