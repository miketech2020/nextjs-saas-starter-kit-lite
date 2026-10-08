# S0 local — 08/10/2026

S0 code/hardening đã triển khai trên fork `miketech2020/nextjs-saas-starter-kit-lite`, branch `review/service-hub-starter`. StationOS hiện tại không import schema hoặc runtime của starter này.

## Đã thay đổi

- Next16.4.0; patch dependencies cùng major, bỏ next-sitemap/shadcn CLI không cần thiết, bỏ cấu hình auto-MCP latest. Audit all/prod tại lần kiểm cuối không có advisory registry báo.
- Safe internal Auth paths, không nhận external next hoặc Host tùy ý; missing code về error route; Auth response private/no-store, refresh cookie/header được forward tới server request và giữ khi redirect. requireUser xác minh getUser và subject khớp claims.
- Migration forward `20261008030000_s0_security.sql`: default branch backfill, active tenant/membership, role+branch RLS, composite branch FKs, private credential/payment-event/audit tables, NOLOGIN owner, minimal grants. Không sửa migration lịch sử.
- Wrapper mutators kiểm auth.uid, không cho client giả p_user_id; staff không tạo order/đọc PII; manager chỉ branch được cấp. Function legacy không còn EXECUTE cho browser/service role. Branch rename chỉ grant name, có USING/WITH CHECK.
- Device lease có reserved_order_id; active/review session chặn order mới. Trusted payment event vẫn được lưu và order về paid_review nếu fulfillment không khả dụng, thay vì rollback mất dấu vết.
- API forwarding dùng user bearer + publishable/anon key + RLS, không dùng service role. Strict DTO, body16KiB, timeout và query50rows. Checkout payOS/device HTTP adapters đóng; service-api không khởi động ở NODE_ENV=production. Đây là starter local, chưa có shared limiter/merchant/signed device adapter cho public.
- UI có branch selector, reset selections và chống response cũ ghi đè tenant/branch mới. Demo vẫn mô phỏng. Laundry mặc định chưa bật; profile deletion mặc định tắt.
- CI S0 luôn chạy audit/typecheck/security tests/nativePG/build/browser smoke, độc lập ENABLE_E2E_JOB. Branch protection/remote CI là bước kiểm trên GitHub; không tự merge.

## Bằng chứng local

| Kiểm tra | Kết quả |
|---|---|
| All/prod pnpm audit | 0 advisory reported trong snapshot08/10/2026 |
| Full monorepo typecheck | 8 package tasks đạt |
| Web build, test env, ignoreBuildErrors=false | Đạt Next16.4.0 |
| `pnpm run test:s0` | 42 test cases đạt: core/SQL5, Auth1, API1, UI utilities35 |
| Native PostgreSQL17.10 security contract | 18 checks đạt, gồm20 connections retry một order |
| Browser Chromium, desktop/mobile + HTTP callback | 7 checks đạt, không pageerror/viewport overflow |
| StationOS gốc | typecheck/build và17 unit tests đạt |

PGlite S0 suite còn có17 assertions trong một test case; native suite thêm race qua18 checks. Auth/API mocks kiểm boundary/orchestration; fixture auth.uid/auth.role không thay JWT/GoTrue thực.

## Chạy lại

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm audit
pnpm run typecheck
pnpm run test:s0
pnpm --filter web build:test
```

Native CI đặt SH_TEST_DATABASE_URL tới **DB test trống** tên service_hub_s0_test trên loopback PostgreSQL17. Runner từ chối host ngoài loopback hoặc tên DB không có prefix này. SQL test bootstrap không chạy trên DB đang dùng.

Nếu áp dụng lên Supabase local đã có dữ liệu: backup trước, đọc backfill, chạy migrations theo thứ tự. Existing tenant có một default branch; existing manager/staff chuyển về default branch. Mỗi manager/staff membership hiện có một branch; nhiều grants/người và customer-facing membership sẽ theo core StationOS/P1. Device bị disabled mặc định; chỉ operator bật simulation trong test. Không bật relay.

## Cổng còn mở

- Docker/GoTrue/PostgREST/Supabase role defaults + Google OAuth thực chưa kiểm do chưa có Docker/credentials. Cookie refresh/revocation/MFA end-to-end phải kiểm tại cổng này.
- Chưa có per-merchant payment verification/recipient/currency adapter, refund/reconcile worker/shared limiter/signed device receiver. S2/S3 xử lý; không dùng RPC trusted payment từ browser.
- Không có cloud deploy/paid services/real payment/physical hardware; audit zero không chứng nhận không còn lỗi.
- Legal/marketing/English-only starter UI còn nguyên làm reference; port UI/module vào StationOS thuộc S1.
