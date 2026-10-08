# Review bảo mật service-hub-starter.zip

Ngày 08/10/2026. Kết luận: **có thể dùng làm nguồn tham khảo và nền module; chưa phù hợp đưa nguyên trạng vào pilot/production**. Chưa xác nhận được lỗi vượt tenant từ các luồng đã thử; có lỗi quyền trong tenant, open redirect và lỗi checkout/thiết bị cần sửa.

## Nguồn và phạm vi

- Archive SHA256: `E02BE164BDEFB5A1624E16CFF24A418EE59C8398A52FEDF8A63554F5A66F6DA0`.
- 410 file; kiểm đường dẫn thoát thư mục/symlink trước khi giải nén.
- Makerkit Lite MIT; base commit `c5cba64391a80620309c4178163dc2df42568d1b`, ghi ở `third-party/NOTICE.md`, đã đối chiếu với checkout upstream.
- 388 file giống upstream sau chuẩn hóa newline, 17 file thêm, 5 file sửa, không có file upstream bị bỏ. Một số vấn đề nằm trong baseline Makerkit, không chỉ phần Service Hub bổ sung.
- Fork đã tạo: https://github.com/miketech2020/nextjs-saas-starter-kit-lite . Clone ở `references/makerkit-fork`, remote upstream giữ nguyên Makerkit. Nhánh local `review/service-hub-starter` chứa import ZIP; chưa push bản bổ sung.
- Không chạy install/preinstall/postinstall của ZIP. Chạy 3 test core không cần dependency; chạy migration trên PostgreSQL17.10 tạm riêng, có cả migration nền Makerkit + migration Service Hub. Auth/storage compatibility fixture không thay Supabase managed stack.
- Audit lockfile bằng pnpm registry audit, tách all/prod. Không pentest dịch vụ public, không dùng tiền/thông tin khách thật, không thử relay.

## Các phát hiện và mức ưu tiên

### SH-01 — Dependency có advisory cần xử lý trước triển khai

**Ưu tiên S0.** Lockfile chốt Next16.3.0. Audit toàn bộ báo **6 critical, 17 high, 28 moderate, 5 low**; production dependency báo **3 critical, 11 high, 5 moderate, 1 low**. Đây là số báo cáo registry theo dependency, không phải số đường khai thác đã chứng minh.

Đối chiếu nguồn maintainer:

| Advisory | Điều kiện ảnh hưởng và đánh giá tại ZIP |
|---|---|
| [Windows RCE GHSA-p293-qw3h-jr36](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36) | Next16.3.0 nằm trong khoảng ảnh hưởng; advisory cần Windows và app **không dùng Cache Components**. ZIP bật cacheComponents=true nên **không kết luận đường này exploitable với config hiện tại**. |
| [AVIF optimizer RCE GHSA-2xp9-vwfh-vxw4](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4) | Điều kiện tối ưu ảnh AVIF. ZIP có image optimization và avatar Storage; cần kiểm đường upload/optimizer và native decoder trong deployment. Không gửi exploit AVIF. |
| [next/og RCE GHSA-vcvr-r3jv-pc5j](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j) | Cần Node ImageResponse đưa dữ liệu attacker vào SVG. Không tìm thấy import ImageResponse/next/og trong app ZIP; **chưa thấy đường gọi tương ứng**. |
| [Image SSRF GHSA-cjq9-62q9-8jv4](https://github.com/vercel/next.js/security/advisories/GHSA-cjq9-62q9-8jv4) | Cần allowlisted remote URL attacker kiểm soát. ZIP allowlist hostname Supabase; chưa chứng minh kiểm soát DNS/redirect. Trang maintainer ghi patch `16.3.?`, registry ghi `>=16.3.8`; ưu tiên release đã kiểm audit, không đoán patch từ dấu hỏi. |

Các advisory còn lại có sharp, fast-uri, nanoid, braces/source-map-js và tooling như Hono/MCP/Vitest/Tinypool. Xem JSON để biết version/path/dev flag. Không áp overrides đồng loạt chỉ để làm audit xanh: nâng trực tiếp framework/tooling, rà dependency graph, kiểm API và rerun tests. StationOS hiện có Next16.4.0, nhưng chỉ dùng package/version đã audit và kiểm trên app thực tế.

### SH-02 — Callback Auth cho redirect ra ngoài

**Mức medium; sửa ở S0 trước mở login public.** `packages/supabase/src/auth-callback.service.ts:136–139,181` lấy next từ URL, trả nguyên nextPath; `apps/web/app/auth/callback/route.ts:16` gọi redirect(nextPath).

Đã compile và chạy helper gốc với mock Auth: request `/auth/callback?next=https://review-attacker.invalid` không có auth code vẫn trả external nextPath. Điều này tạo open redirect/phishing. **Không có bằng chứng lộ session token** từ thử nghiệm này.

Sửa: allowlist đường nội bộ, chặn scheme/`//`/backslash/encoded variants; bind origin vào config, không tin Host tùy ý. Callback phải xử lý code/error theo PKCE. Test external next, missing code và proxy Host. StationOS đã dùng đích callback cố định `/secure`.

### SH-03 — Role chưa quyết định quyền action, không có branch scope

**Ưu tiên S0 khi dùng cho StationOS; mức high theo phạm vi dữ liệu hiện cần bảo vệ.** `apps/service-api/src/server.mjs:58–66` đọc role nhưng chỉ kiểm có membership. `/overview` trả toàn bộ khách/đơn/máy của tenant. `sh_create_order` chỉ kiểm membership; schema không có branch/is_active trong membership.

Đã tái hiện staff tạo đơn trả tiền và đọc tên/số điện thoại tất cả khách trong tenant. Đây là **khoảng thiếu chính sách so với StationOS**, không phải vượt chính sách được tài liệu ZIP mô tả: ZIP cố ý cho mọi member tạo đơn/khách. Nếu staff chỉ được một chi nhánh thì quyền hiện tại rộng hơn yêu cầu.

Sửa: dùng membership tenant+branch+active của P0 StationOS, map quyền từng action, DTO riêng role, RLS phản ánh cùng phạm vi. Customer chỉ đọc bản ghi của mình. Platform owner không mặc định có quyền tenant. Kiểm MFA/step-up cho thao tác owner nhạy cảm qua API, không chỉ UI.

### SH-04 — Nhận checkout mới khi máy còn session review

**Mức high về tính đúng của tiền/fulfillment; ưu tiên S0 trước thanh toán pilot.** `20261008020000_service_hub.sql:61` tự đổi reserved hết hạn về idle mà không đối chiếu active/review session; index `sh_one_active_session` ở dòng15 vẫn coi review là active.

Đã tái hiện trên PG17: thanh toán đơn A → command hết hạn → poll chuyển session A sang review → reservation máy hết hạn → tạo đơn B thành công → accept payment B lỗi23505/index sh_one_active_session → transaction rollback, đơn B còn pending. Không có thanh toán thật trong thử nghiệm; nếu provider đã thu tiền, luồng hiện không phản ánh đúng kết quả đó.

Sửa: lease phải có reservation/session owner; máy review không nhận checkout mới. Nhận và lưu sự kiện thanh toán bền vững trước fulfillment; paid_review/reconcile khi không thể chạy máy. Không để lỗi cấp session xóa dấu vết tiền đã nhận. Kiểm race/retry/expiry và operator resolution.

### SH-05 — Một merchant toàn hệ thống, thiếu recipient/currency binding

**Blocker kiến trúc thanh toán; ưu tiên S0 thiết kế, S2 triển khai sandbox.** `server.mjs:5–7,33–40,71` có một PayOS instance từ env; webhook truyền orderCode/amount/reference. DB không có merchant_id/recipient_id/currency trong payment event.

Luồng signature verification và amount check là điểm tốt. Tuy nhiên không đáp ứng quyết định **đại lý nhận trực tiếp, SaaS thu riêng**. Không khẳng định HMAC bị bypass; vấn đề là thiếu binding nghiệp vụ khi hỗ trợ nhiều merchant.

Sửa: merchant account/secret server từng tenant, route webhook theo merchant có mapping tin cậy, kiểm signature + order + amount + VND + recipient, namespace event/order theo merchant. Tách SaaS billing. Không dùng redirect cấp quyền.

### SH-06 — Payment inbox/recovery chưa đủ

**Ưu tiên S2 trước sandbox acceptance.** `sh_accept_payment:73` return khi order không pending, trước insert event; event chỉ có reference/amount, không lưu đầy đủ trạng thái/kết quả verify. Không có inbox/outbox retry worker/reconciliation/refund/revoke.

API còn khoảng lỗi provider đã tạo link nhưng PATCH checkout_url thất bại, hoặc hai request cùng nhìn checkout_url trống. Chưa thử provider nên **không khẳng định tạo hai khoản thu**; cần lease/idempotency của adapter và reconcile theo merchant/orderCode.

Sửa: persist inbox trước ACK, monotonic payment state, grant-once, durable outbox, retry lease, reconciliation và audit quyết định. Kiểm duplicate/out-of-order/unknown order/late payment/DB lỗi sau provider success.

### SH-07 — Definer đặc quyền cao, private data vẫn trong public schema

**Hardening S0; không phát hiện SQL injection để khai thác điều này.** 5 function sh_* là SECURITY DEFINER/search_path rỗng, nhưng không có isolated owner. Chạy native fixture, owner là postgres có superuser/login/BYPASSRLS. Managed Supabase có thể khác; cần query lại role owner thực tế, không giả định giống fixture.

device_credentials và payment_events bật RLS, không có browser read policy. Thử outsider không đọc tenant khác; authenticated không gọi được payment RPC. Vì vậy **không báo credential table đã bị leak**. Tuy nhiên private tables nằm trong exposed public schema và grants dựa default privileges; nên làm quyền tối thiểu tường minh.

Sửa: owner NOLOGIN không superuser/BYPASSRLS, private internal schema, explicit REVOKE/GRANT từng table/function/column, kiểm ACL dưới default privileges Supabase. Không sao chép migration sh_* vào DB StationOS song song với core cũ.

### SH-08 — Public endpoint chưa có rate/quota và validation đầy đủ

**S0 trước public traffic.** Có body cap64KiB và timeout gọi backend; chưa có strict schema/field bounds, shared limiter, tenant/device quotas. Create tenant có thể lặp cho mọi authenticated user; device polling gọi DB bằng service role và chưa có throttle/rotation/revocation lifecycle.

API hiện bind127.0.0.1; cần reverse proxy HTTPS. CORS allowlist không thay ACL, nhưng API dùng bearer token nên **không kết luận thiếu Origin reject là CSRF tự động**. Bổ sung strict validation, timeout/connection budgets và shared rate limit khi mở public; webhook/device không CAPTCHA.

### SH-09 — Cookie refresh/cache headers và release gates

**S0 hardening.** Middleware client setAll chỉ copy cookies, bỏ headers mà @supabase/ssr có thể trả để ngăn cache phiên. Proxy tạo redirect response mới không copy cookie từ response đã refresh. Đây là rủi ro mất refresh/cache sai nếu proxy/CDN cấu hình không đúng, **chưa tái hiện leak session qua CDN**.

`next.config.mjs:75` ignoreBuildErrors=true; CI typecheck tách riêng nhưng chưa thấy build gate bắt buộc trên mọi đường release. Workflow E2E phụ thuộc ENABLE_E2E_JOB. Không coi build pass trong VALIDATION.md là chứng minh bảo mật.

Sửa: private/no-store cho Auth/tenant data, giữ cookie/header khi redirect; bỏ ignoreBuildErrors hoặc làm branch protection enforce typecheck+build+tests. Không bật Next debug fullUrl cho luồng có token/PII; log có redaction.

### SH-10 — Utility và UI có khoảng thiếu khi port

**S1.** validateDevice chấp nhận last_seen_at='INVALID_DATE' vì Date.parse trả NaN; tái hiện trực tiếp utility. Function này không được server.mjs dùng làm authorization nên không báo nó là bypass backend hiện tại. Thêm finite/date/skew checks khi dùng lại.

Workspace chưa chống response tenant A về muộn ghi đè tenant B; selection/customerId không reset khi đổi tenant. Composite FK chặn ghi khách khác tenant ở DB, nhưng UI có thể hiển thị dữ liệu tenant trước. Request ID theo ref không bền qua reload. Locale server mặc định English/UTC; Service Hub UI hardcode Việt; chưa đạt VI/EN/ZH, VN day semantics của app hiện tại.

## Điểm tốt đã kiểm và giới hạn

- Giá/thời lượng lấy từ catalog server, chụp vào order; composite FK ngăn sai tenant.
- Auth API gọi Supabase /auth/v1/user, không chỉ decode JWT. getSession ở browser dùng lấy bearer, **không tự nó là lỗi xác thực** vì server xác minh lại.
- RPC thao tác order lock/advisory dedupe; browser không gọi payment/device mutation RPC.
- Device secret hash tách bảng; command có deadline/ID; không có unauthenticated manual START endpoint trong ZIP.
- 3 core tests pass. 5 probe DB (bao gồm negative control tenant isolation), callback và invalid-date probe tái lập; không phải full audit certification.
- Pattern secret scan không thấy private-key/provider-token marker; có JWT **supabase-demo local** và config/example entries. Không xem demo JWT là cloud secret bị lộ; không dùng các key local này cho hosted production. Scanner không verify credentials hay quét lịch sử Git ZIP vốn không có.
- Chưa chạy web ZIP build/e2e, toàn bộ PGlite/API mock suite phụ thuộc monorepo; không cài dependency để né lifecycle scripts trong đợt review. Không thử real OAuth/PostgREST/payOS/device/CDN/load.

## Bằng chứng tái lập

`node scripts/review-service-hub-static.mjs` và `node scripts/review-service-hub-db.mjs` (Windows PG17 runtime đã cài trong app). Windows sandbox có thể cần chạy dưới user có quyền đọc fork/khởi động process. Không sửa safe.directory toàn cục.

Artifacts: `artifacts/service-hub-review/{upstream-comparison,static-reproductions,db-reproductions,dependency-audit,dependency-audit-production}.json`. Scan/audit outputs không chứa giá trị secret. Audit snapshot tại08/10/2026; cần chạy lại khi dependency hoặc advisory đổi.
