# Chạy mã nguồn Service Hub

> **S0 update:** đọc [S0-DELIVERY](S0-DELIVERY.md) trước. Áp dụng cả migration `20261008030000_s0_security.sql` sau hai migration cũ. API S0 dùng `SUPABASE_ANON_KEY`/publishable key và user bearer; không cần payOS hoặc service role. Payment/device HTTP adapters bị khóa và API chỉ chạy local. Các đoạn hướng dẫn payOS/provision máy bên dưới là thiết kế lịch sử, chưa được bật lại trong S0.

Đây là bản nền có web/API/schema, chưa phải hệ thống rửa xe production. Xem `service-hub-plan.md` để biết phạm vi và các bước còn lại.

## Môi trường
Node >=22.13, pnpm theo packageManager của repo, Docker nếu chạy Supabase local. Không cần Docker nếu dùng Supabase hosted và triển khai migration qua Supabase CLI/SQL Editor.

```bash
pnpm install --frozen-lockfile
```

## Web thử giao diện

```bash
pnpm --filter web dev
```

Mở `http://localhost:3000/service-demo`. Không cần payOS hay máy thật. Tạo khách, chuyển module, tạo đơn và xác nhận thử. Dữ liệu lưu localStorage, tách hoàn toàn khỏi backend. Xóa key `service-hub-demo-v1` để reset.

## Backend thật

1. Tạo Supabase project và bật Google hoặc email auth.
2. Áp dụng migration gốc Makerkit trước, sau đó `20261008020000_service_hub.sql`.
3. Cấu hình `apps/web/.env.local` (không commit):

```dotenv
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
NEXT_PUBLIC_SERVICE_API_URL=http://localhost:3100
```

4. Copy `apps/service-api/.env.example` thành `.env` và điền Supabase service role, payOS và APP_ORIGIN. Không gửi secret trong chat hoặc frontend.
5. Chạy API:

```bash
pnpm --filter service-api start
```

6. Chạy web, đăng nhập, mở `/home/services`, tạo tenant đầu tiên. Dùng dịch vụ có nhân viên để thử tạo đơn trước khi có máy.
7. Đặt webhook payOS tới URL public HTTPS `/webhooks/payos`; backend chỉ bind localhost nên cần reverse proxy/tunnel khi thử.

## Provision máy

Dùng SQL Editor/admin tin cậy tạo sh_devices, lấy id. Tạo secret bằng CSPRNG đủ dài; lưu hash SHA256 vào sh_device_credentials, còn secret gốc chỉ ở thiết bị. Không gắn secret vào URL.

```sql
insert into public.sh_devices(tenant_id,name,kind)
values ('TENANT_UUID','Khoang rửa 01','wash-bay') returning id;
-- Thực hiện qua công cụ quản trị tin cậy, thay placeholder bằng giá trị riêng.
insert into public.sh_device_credentials(device_id,secret_hash)
values ('DEVICE_UUID',encode(extensions.digest('LONG_RANDOM_DEVICE_SECRET','sha256'),'hex'));
```

`kind`: wash-bay, vacuum, washer hoặc dryer. Thiết bị POST `/devices/poll` với `{deviceId,secret}` để heartbeat; chỉ chọn máy có heartbeat dưới 90 giây. START trả `{version,commandId,sessionId,action,durationSeconds,expiresAt}`. Thiết bị lưu ID chống trùng; poll tiếp kèm `ack: sessionId` sau khi bắt đầu và `finished: sessionId` sau khi kết thúc. ACK quá hạn không được chấp nhận. Firmware phải bảo đảm không chạy lệnh quá hạn hoặc lặp.

## Kiểm tra

```bash
pnpm --filter web typecheck
pnpm --filter @kit/service-core test
pnpm --filter service-api test
pnpm --filter web build
```

Build production cần NEXT_PUBLIC_SITE_URL HTTPS và Supabase env thật. Không dùng `NEXT_PUBLIC_CI=true` trên deployment để né cấu hình sai; cờ này chỉ dành cho kiểm tra build.

## Fork lên tài khoản GitHub của bạn

Bản này được clone và sửa ở workspace; chưa tạo remote fork trong tài khoản GitHub của bạn. Giữ lịch sử upstream và LICENSE.

1. Fork Makerkit Lite ở GitHub về tài khoản của bạn.
2. Giải nén bộ mã vào checkout của fork, giữ `.git` hiện có của checkout.
3. Review diff, commit và push vào nhánh riêng.
4. Giữ remote upstream Makerkit để lấy cập nhật; không merge tự động khi có thay đổi schema/auth.

Web Next.js có thể triển khai trên Vercel. Tiến trình Node service-api cần host Node riêng và reverse proxy TLS; không chạy như tiến trình nền trên Vercel serverless. Supabase giữ dữ liệu dùng chung. Chưa publish URL hoặc kết nối tài khoản thật trong bản bàn giao.
