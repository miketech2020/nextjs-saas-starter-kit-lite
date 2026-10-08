import {test,expect} from '@playwright/test';
test('S0 demo keeps payment simulated and responsive',async({page})=>{
 await page.goto('/service-demo');await expect(page.getByRole('heading',{name:'Điều hành dịch vụ'})).toBeVisible();
 await page.getByRole('combobox',{name:/^Dịch vụ/}).selectOption('cw2');await page.getByRole('button',{name:'Tạo đơn',exact:true}).click();
 await expect(page.getByText('Đã tạo đơn thử.',{exact:false})).toBeVisible();await page.getByRole('button',{name:'Xác nhận thử'}).click();
 await expect(page.getByRole('cell',{name:'Đã thanh toán',exact:true})).toBeVisible();
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('S0 callback stays on configured app and is not publicly cached',async({request})=>{
 for(const next of ['https://evil.invalid','//evil.invalid','/%2f%2fevil.invalid']){
  const r=await request.get('/auth/callback?next='+encodeURIComponent(next),{maxRedirects:0});expect([303,307]).toContain(r.status());const target=new URL(r.headers().location);expect(target.hostname).not.toBe('evil.invalid');expect(target.pathname).toBe('/auth/callback/error');expect(r.headers()['cache-control']).toContain('private');expect(r.headers()['cache-control']).toContain('no-store');
 }
});
