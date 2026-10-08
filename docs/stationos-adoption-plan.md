# Kế hoạch tái sử dụng Service Hub cho StationOS

Ngày08/10/2026. Đề xuất: **giữ StationOS P0 làm nguồn dữ liệu/quyền/phiên duy nhất; nhập có chọn lọc module và tiện ích từ Service Hub**. Không thay toàn bộ app bằng starter, không chạy hai bộ tenants/memberships/orders song song.

Fork: https://github.com/miketech2020/nextjs-saas-starter-kit-lite . Local: `references/makerkit-fork`, branch `review/service-hub-starter`; upstream commit c5cba64391a80620309c4178163dc2df42568d1b. ZIP đã được nhập vào branch local để review; chưa push import. LICENSE Makerkit + IoT Laundry NOTICE được giữ. Xem [review bảo mật](service-hub-security-review.md).

## Nên giữ / sửa / bỏ khỏi phạm vi hiện tại

| Phần | Quyết định | Cách dùng cho StationOS |
|---|---|---|
| `packages/service-core` module/capability/workflow declarations | **Giữ ý tưởng, port TypeScript** | Registry versioned, schema strict, hooks developer-owned validateOrder/quote/planFulfillment; mapping carwash→wash tường minh. Không cho tenant chạy JS tùy ý. |
| Catalog rửa/hút bụi và module workflow | **Giữ làm mẫu** | Đồng bộ dịch vụ hiện tại, tên dịch VI/EN/ZH; giá/timing chỉ fixtures, không coi giá starter là giá chốt. |
| React Hook Form + Zod patterns | **Chọn lọc** | Dùng khi P1 CRUD thật: validation client/server, field errors, loading/disable save, focus modal. |
| UI primitives/DataTable/Dialog/Toast | **Chọn component cần dùng** | ZIP dùng **Base UI**, StationOS đang dùng **Radix**; không copy nguyên props render/asChild lẫn nhau. Giữ water/sky theme, tokens, mobile và Hallmark design hiện tại. |
| Supabase browser/server/admin separation, Auth hooks | **Giữ pattern** | P0 server verified session làm chuẩn; sửa callback/cookies/MFA trước port; không thêm auth core thứ hai. |
| next-intl namespaces | **Tham khảo để tổ chức dictionary** | Chưa thay hệ i18n đang chạy. Cần SSR locale cookie + VI/EN/ZH + VN timezone; starter mặc định en/UTC. |
| PayOS verify webhook/create checkout | **Giữ adapter concept, viết lại orchestration** | Tenant merchant trực tiếp; SaaS riêng; durable inbox/outbox, recipient binding, recovery. Không chạy Node API với service_role cho mọi action. |
| Polling START payload/deadline/dedupe | **Giữ contract concept** | command_id riêng session_id; signed protocol/device scope/rotation/runtime/E-stop ở P3. Không kích hardware trong P1. |
| Composite FK, order price snapshot, unique active session | **Giữ nguyên tắc** | Core P0 đã có; bổ sung invariants thiếu qua migrations forward và adversarial tests, không import sh_* tables. |
| Native/domain/mock test scenarios | **Giữ scenario, mở rộng** | Cả2 migrations, ACL defaults, branch/customer/role, 20connection races, provider failures, late payment và review lease. PGlite sequential không thay race realPG. |
| `apps/web/components/service-hub/workspace.tsx` | **Tách để tham khảo, không thay Workspace** | Lấy flow CRUD/onboarding; thêm abort/query keys tenant+branch+user, pagination, canonical selections. UI nguyên khối và revenue<=200rows không dùng báo cáo thật. |
| `apps/service-api` Node HTTP server | **Không nhập nguyên trạng** | Port adapter vào server hiện có. Chỉ tách runtime worker/IoT khi cần vận hành riêng có contract, monitor và budgets. |
| Migration `sh_*` + personal account schema | **Không chạy trong DB StationOS** | Một tenant/membership/customer/order core. Personal profile có thể đưa vào P1 bằng schema riêng sau mapping user_id rõ ràng. |
| Laundry | **Để sau MVP rửa xe** | Registry disabled; nếu cần thêm: laundry_jobs/items/bag tags, grams/price rounding và workflow riêng, không nhét dữ liệu tính tiền vào metadata tùy ý. |
| Module tự bật carwash+laundry khi tạo tenant | **Bỏ default này** | Provision ngành/module rõ ràng; feature/quota theo tenant, server enforce. |
| Landing/FAQ/charts mẫu/legal copy | **Bỏ khỏi runtime trước mắt** | Dashboard vận hành đang có; legal phải theo chính sách thực tế, không sao chép lời cam kết mẫu. |
| `/service-demo`, localStorage thử và mock revenue | **Giữ trong reference/demo** | Không nhập vào đường vận hành thật. StationOS có simulator và báo cáo demo riêng. |
| Template email-password/OTP/password reset | **Chưa port toàn bộ** | Google-first theo yêu cầu; MFA cho staff/owner cần kiểm. Chỉ thêm auth method khác khi có nhu cầu. |
| Supabase Storage avatars | **Không dùng workflow upload này** | Dự án đã chọn R2. Giữ permission/MIME/size/compression/cleanup ideas, dùng R2 adapter server. |
| Turbo/pnpm monorepo/TS7/Cache Components config | **Hoãn** | Có thêm chi phí migration; một Next app + module packages nội bộ là đủ trước pilot. Không copy ignoreBuildErrors, clean -xdf hoặc auto-MCP latest. |
| Firmware laundry STM32/ESP32 | **Không dùng làm firmware C3** | ZIP không có firmware triển khai C3; pinout/R307/EC11/ST7789 chưa xác minh. Chỉ tham khảo workflow. |

## Thứ tự triển khai và tiêu chí hoàn thành

### S0 — Khóa bản nguồn và cổng bảo mật

- [x] Fork/clone, giữ upstream history/LICENSE/NOTICE, import ZIP vào branch review local.
- [x] SHA/inventory, static review, dependency audit all/prod, adversarial PostgreSQL probes.
- [x] Vá dependency, callback, cookie headers, role+branch+active guards và lease review mismatch trong fork. Payment/device HTTP adapters đóng.
- [x] CI S0 audit/typecheck/test/build/browser luôn chạy; explicit grants và isolated owner đã kiểm local. Remote CI/branch protection theo PR.
- [ ] Chạy full Supabase local + Google Auth khi có Docker/credentials. Không bỏ qua cổng này vì native test pass.

**Nghiệm thu:** no unauthorized branch/PII reads; no direct protected writes; external callback không thoát app; máy review không nhận đơn cần máy; money received không mất dấu vết khi fulfillment fail; dependency gates đã phân loại reachability. Không tuyên bố hết mọi CVE chỉ vì audit zero.

### S1 — Core module contract và CRUD P1 rửa xe

- [ ] Tách Workspace thành feature views; shared form/table/modal/toast dùng design hiện tại. Server repository/Auth P0 giữ nguyên.
- [ ] Port module declarations thành registry typed, version/config validators; seeded catalog idempotent, feature flags enforce server. Wash là module bật đầu tiên; laundry chưa bật.
- [ ] CRUD khách/xe/dịch vụ/bảng giá/gói: DTO strict, scope server, audit, paging25–50, search bỏ dấu/Esc, read cache key tenant+branch+actor và mutation invalidation.
- [ ] Tạo purchase snapshot giá/quyền lợi bất biến và service_values; gói7ngày/1/3/6/12tháng theo chính sách lịch; service/vehicle/branch/daily/concurrency như P0.
- [ ] Staff assignment/accept/start/complete, QR mapping thật tenant/branch/station. Không coi fingerprint là authorization.
- [ ] Nối UI P1 tới API/repository thật khi cấu hình; demo có entry/mode rõ, không gửi dữ liệu sessionStorage vào DB.

**Nghiệm thu:** hai tenants, hai branches, đủ role/customer trên DB; response tenant cũ về muộn không ghi đè tenant mới; price không do client quyết; snapshot không thay khi catalog sửa; staff service chỉ work ticket, không command; VI/EN/ZH và mobile giữ đầy đủ.

### S2 — Payment sandbox, recovery và báo cáo

- [ ] Adapter tenant PayOS accounts/secret vault + SaaS merchant riêng. Không dùng env chung nhận tiền rửa xe mọi tenant.
- [ ] Durable inbox/outbox, verification binding order/amount/VND/recipient/merchant; grant once; checkout retry lease, reconciliation, paid_review/refund/revoke, operator audit.
- [ ] get_revenue_summary server query đủ dữ liệu/timezone, tách tiền bán gói, giá trị dịch vụ thực hiện, refunds và SaaS; không tính tổng từ50/200rows UI.
- [ ] Shared rate/quota, typed device polling route, log redaction; worker expiry/retry schedule và monitoring. Chọn hạ tầng theo yêu cầu, chưa tự thêm dịch vụ trả phí.

**Nghiệm thu:** webhook repeated/out-of-order, wrong merchant/recipient/currency, late payment, DB fail sau provider success, restart process không mất event/order; không thu thật khi chưa qua sandbox.

### S3 — Device bench, pilot rồi mở rộng

- [ ] Xác minh pinout/revision/nguồn; firmware đúng C3 + R307/EC11/ST7789; protocol command/nonce/deadline, dedupe NVS, ACK đáng tin, timer dừng local, default-off và E-stop độc lập.
- [ ] Revoke/rotate credential, mất mạng/mất điện/expired/replay tests; không tự resume lệnh cũ.
- [ ] Load100/300 bằng benchmark thực, backup/restore, monitoring, Safari/iOS thật.
- [ ] Sau nghiệm thu rửa xe mới thêm laundry/parking/charging theo feature flags, một core chung.

**Nghiệm thu:** bench an toàn rồi pilot có audit/reconcile/recovery; không dùng kết quả unit/PGlite/native test làm chứng nhận điện hoặc tải.

## Bước phát triển tiếp theo nên chọn

Làm **S0 fixes cần port + S1 CRUD khách/xe/dịch vụ/bảng giá** trên StationOS trước. Giữ fork làm nguồn cập nhật và review riêng; ghi module/component nào đã lấy cùng commit/license. Chưa chuyển app sang monorepo, chưa push nguyên ZIP có lỗi vào nhánh phát hành, chưa deploy provider/hardware thật.

Trong đợt này đã chuẩn bị fork/review/plan và runner kiểm chứng; **chưa triển khai các mục S0/S1 chưa đánh dấu**. App hiện tại chỉ thêm exclude references trong tsconfig để bản nguồn review không bị compiler nhập nhầm.
