import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
function load(source,bindings={}){const exports={};const clean=source.replace(/^import[\s\S]*?;\s*/gm,'').replace(/export function (\w+)/g,'exports.$1 = function $1');vm.runInNewContext(stripTypeScriptTypes(clean,{mode:'transform'}),{exports,...bindings,URL,URLSearchParams,process:{env:{NEXT_PUBLIC_SITE_URL:'http://localhost:3000'}},console:{error(){}}});return exports;}
test('Auth callback rejects external / encoded redirect and missing code',async()=>{
 const paths=load(await readFile(new URL('../src/safe-auth-path.ts',import.meta.url),'utf8'));
 const helper=load(await readFile(new URL('../src/auth-callback.service.ts',import.meta.url),'utf8'),{safeAuthPath:paths.safeAuthPath});
 for(const bad of ['https://evil.invalid','//evil.invalid','/\\evil.invalid','/%2f%2fevil.invalid','/%5c%5cevil.invalid','/home/../../evil','/home?next=https://evil.invalid'])assert.equal(paths.safeAuthPath(bad),'/home');
 assert.equal(paths.safeAuthPath('/home/settings'),'/home/settings');
 const service=helper.createAuthCallbackService({auth:{exchangeCodeForSession:async()=>({error:null}),verifyOtp:async()=>({error:null})}});
 for(const next of ['https://evil.invalid','//evil.invalid','/%2f%2fevil.invalid']){const result=await service.exchangeCodeForSession(new Request('http://localhost:3000/auth/callback?code=test&next='+encodeURIComponent(next)),{redirectPath:'/home'});assert.equal(result.nextPath,'/home');}
 const missing=await service.exchangeCodeForSession(new Request('http://localhost:3000/auth/callback?next=https://evil.invalid'),{redirectPath:'/home'});assert.match(missing.nextPath,/^\/auth\/callback\/error/);
 const confirmed=await service.verifyTokenHash(new Request('http://localhost:3000/auth/confirm?type=recovery&token_hash=test&next='+encodeURIComponent('https://evil.invalid/auth?next=/home/settings'),{headers:{Host:'evil.invalid'}}),{redirectPath:'/update-password'});assert.equal(confirmed.origin,'http://localhost:3000');assert.equal(confirmed.pathname,'/update-password');
});
