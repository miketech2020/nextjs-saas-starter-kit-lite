# Kế hoạch Service Hub — SaaS rửa xe, giặt ủi và dịch vụ mở rộng

Ngày: 08/10/2026. Mục tiêu: một mã nguồn phục vụ nhiều doanh nghiệp; bật/tắt module theo từng tenant, không fork một app cho mỗi khách hàng.

## 1. Quyết định kiến trúc

Dùng **modular monolith** ở giai đoạn đầu: một core nghiệp vụ, một PostgreSQL và các module có ranh giới rõ. Không chia thành nhiều microservice ngay. Web Makerkit và tiến trình API IoT tách runtime để dễ vận hành, nhưng cùng sản phẩm và dữ liệu.

- Nền web: fork mã Makerkit Lite; giữ Next.js, React, TypeScript, Tailwind, shadcn và Supabase Auth.
- Backend dữ liệu: Supabase PostgreSQL, RLS và RPC cho giao dịch nguyên tử.
- Thanh toán: tái sử dụng luồng IoT Laundry bằng SDK payOS, sửa lưu RAM thành dữ liệu bền vững.
- Thiết bị MVP: HTTPS polling có bí mật riêng từng thiết bị; sau này thêm adapter MQTT/Blynk nếu cần.
- Phần cứng rửa xe: ESP32-C3 Super Mini, R307, EC11, ST7789 SPI 1.54 inch; chưa chốt pin mapping trong bản này.
- Giặt/sấy: firmware adapter riêng theo bộ điều khiển máy. Firmware STM32 + ESP32 của repo Laundry không được coi là chạy trực tiếp trên ESP32-C3.
- Chọn tenant trong cùng ứng dụng. Mỗi tenant có khách hàng, đơn, máy và cấu hình riêng.

Makerkit Lite cung cấp auth và nền giao diện; không giả định Lite có sẵn multi-tenancy, gói SaaS hay quản lý team hoàn chỉnh. Các phần này thuộc core Service Hub.

## 2. Core chung và module

| Thành phần | Trách nhiệm |
|---|---|
| Tenant / Membership | Doanh nghiệp, thành viên, owner/manager/staff, tách dữ liệu |
| Branch / Station | Chi nhánh và điểm phục vụ; mở rộng sau tenant MVP |
| Customer / Asset | Khách hàng; tài sản như xe, túi đồ hoặc vật dụng |
| Service Catalog | Dịch vụ, đơn vị tính, giá, thời lượng, loại thiết bị |
| Order / Order Item | Đơn hàng chung và ảnh chụp giá tại lúc mua |
| Payment | Tạo checkout, kiểm chữ ký, đối soát, hoàn tiền |
| Device / Session | Thiết bị, heartbeat, giữ chỗ, phiên và lệnh chống trùng |
| Entitlement | Quyền sử dụng theo lượt, số dư, ngày hiệu lực hoặc hạn mức |
| Workflow | Quy trình riêng mỗi module; lưu lịch sử người thực hiện |
| Notification / Audit | Thông báo, nhật ký quyền và tác vụ |
| Reporting | Doanh thu, sử dụng máy và hiệu quả dịch vụ |

Module không tự tạo tài khoản hay xử lý tiền riêng. Module đăng ký `key`, catalog, capability, workflow và cấu hình; core xử lý đơn, thanh toán và quyền sử dụng.

Hợp đồng module trong mã hiện tại: `packages/service-core/src/index.mjs`. Các thuộc tính gồm `key`, `name`, `unit`, `steps`, `capabilities`, `services`. Bản mở rộng cần validator, phiên bản hợp đồng, hooks `validateOrder`, `quote`, `planFulfillment` và đăng ký màn hình quản trị. Không cho tenant chạy JavaScript tùy ý.

## 3. Module rửa xe

- Tự rửa xe theo lượt/thời lượng, hút bụi, rửa có nhân viên.
- Mở rộng catalog: vệ sinh ghế, nội thất, tổng thể và dịch vụ xử lý nôn ói.
- Xe của khách: biển số, loại xe, lịch sử dịch vụ.
- Workflow có nhân viên: tiếp nhận → rửa → kiểm tra → hoàn thành.
- Workflow tự phục vụ: tạo đơn → thanh toán → quyền kích hoạt → máy xác nhận chạy → hoàn tất phiên.
- Gói theo lượt hoặc 7 ngày, 1/3/6/12 tháng. Mỗi gói phải khai báo số lượt, hạn mức/ngày, dịch vụ áp dụng, thời hạn và cơ sở áp dụng; không suy diễn gói tháng là không giới hạn.
- Vân tay R307: mẫu nằm trong cảm biến/thiết bị; backend lưu liên kết khách với template ID theo thiết bị. Không coi template ID là định danh toàn hệ thống.
- EC11 chọn dịch vụ; TFT hiển thị giá, thời gian, trạng thái. GPIO theo sơ đồ phần cứng được duyệt.

## 4. Module giặt ủi

Hai hình thức fulfillment:
1. Giặt/sấy tự phục vụ: tính theo mẻ và phiên máy.
2. Nhận giặt có nhân viên: cân kg, ghi loại đồ, yêu cầu riêng, tiếp nhận và trả đồ.

Workflow: tiếp nhận → giặt → sấy → gấp/ủi → sẵn sàng trả → hoàn thành. Quét mã túi đồ để tránh nhầm; ghi ảnh và hẹn trả khi triển khai nghiệp vụ nhận đồ.

Giá mẫu trong mã là theo mẻ. Tính tiền kg, nhiều dòng hàng và giặt+sấy nối tiếp chưa được triển khai; cần bảng order_items và quy tắc giá chính xác, không dùng JSON metadata để che giấu các dữ liệu tính tiền quan trọng.

## 5. Luồng thanh toán và kích hoạt

1. Người dùng đăng nhập và chọn tenant.
2. Chọn dịch vụ, khách và thiết bị phù hợp.
3. API xác thực Supabase token; kiểm tra membership.
4. RPC lấy giá từ catalog, khóa thiết bị và giữ chỗ 15 phút; tạo đơn bền vững với request ID.
5. Backend tạo checkout payOS. Giá không lấy từ client.
6. Webhook được SDK xác minh chữ ký; kiểm order code, tiền và transaction reference.
7. Trong một giao dịch: lưu sự kiện thanh toán, đổi trạng thái đơn và tạo một session duy nhất.
8. Thiết bị polling; RPC xác thực hash bí mật, cập nhật heartbeat và trả START có command ID cố định.
9. Thiết bị phải lưu command ID vào NVS trước khi kích relay và phản hồi ACK; lệnh trùng không khởi động lại bộ đếm.
10. Thiết bị tự dừng theo thời lượng tại chỗ; báo hoàn thành để đóng session.

Thanh toán muộn hoặc máy không sẵn sàng: đơn `paid_review`, không tự kích máy. Lệnh quá hạn: session `review`. Operator xử lý đối soát/hoàn tiền theo quy trình bổ sung. Không dùng return URL của trình duyệt làm bằng chứng đã trả tiền.

Bản API hiện tại dùng một tài khoản payOS cấu hình ở server. Trước khi bán SaaS, phải quyết định thu tiền tập trung hay từng tenant có tài khoản payOS riêng. Với từng tenant: lưu thông tin bí mật trong kho server, ánh xạ webhook về đúng merchant, verify bằng đúng checksum key và namespace order/reference theo merchant. Không đưa checksum key vào bảng có SELECT cho người dùng.

## 6. Dữ liệu và phân quyền

Schema MVP dùng tiền tố `sh_`: tenants, memberships, modules, customers, services, devices, device_credentials, orders, payment_events, sessions.

- Tất cả dữ liệu nghiệp vụ có tenant_id.
- Khóa ngoại ghép tenant_id + id chặn liên kết khách/máy/dịch vụ của tenant khác.
- RLS cho browser chỉ đọc khi thuộc tenant.
- Mutation qua API backend; các RPC ghi tiền/phiên chỉ service_role được gọi.
- device_credentials tách riêng, không cho browser SELECT.
- Unique request ID theo tenant; một order chỉ tạo một session; một máy chỉ có một phiên active.
- Giá và thời lượng được chụp vào order, không thay theo catalog sau khi mua.
- Entitlement cần sổ ledger riêng: cấp, dùng, hoàn, hết hạn; khóa hàng/giao dịch nguyên tử để hai máy không trừ cùng một lượt.

Bản nền có role owner/manager/staff nhưng các thao tác tạo đơn/khách áp dụng cho mọi thành viên. UI quản lý thành viên, quyền chi tiết, nhiều chi nhánh và super-admin chưa triển khai.

## 7. Thêm dịch vụ mới

Ví dụ module bãi đỗ:
- Đăng ký key `parking`; capability vehicle, timed-session và access-control.
- Giá theo giờ/ngày; tài sản là xe; device adapter điều khiển cổng.
- Workflow vào bãi → đang đỗ → thanh toán → ra bãi.
- Dùng lại core khách, tenant, đơn, thanh toán, entitlement và audit.

Ví dụ module trạm sạc:
- Đăng ký key `charging`; capability energy-meter và charging-session.
- Thêm dữ liệu chuẩn kWh, biểu giá, meter start/stop, adapter OCPP nếu thiết bị hỗ trợ.
- Dùng lại core, nhưng phải viết nghiệp vụ năng lượng và adapter; kiến trúc mở rộng không có nghĩa mọi dịch vụ chỉ cần đổi tên.

Quy trình thêm module: khai báo hợp đồng → migration bảng chuyên ngành → validator/hook → catalog → adapter fulfillment → màn hình cần thiết → bật ở tenant → test cô lập và thanh toán. Không sửa lại core Auth/Payment.

## 8. Phạm vi mã nguồn đã bàn giao

| Hạng mục | Trạng thái |
|---|---|
| Checkout Makerkit Lite, giữ license và ghi commit upstream | Có |
| Hai khai báo module rửa xe/giặt ủi | Có |
| Màn hình quản lý dịch vụ, đơn, khách, máy và chọn cơ sở | Có bản nền |
| Trang thử `/service-demo` | Có; localStorage, không thu tiền/chạy máy |
| Trang thật `/home/services` | Có; cần Supabase và service-api được cấu hình |
| Supabase migration + RLS + RPC | Có; chưa triển khai vào tài khoản thật |
| API tạo tenant, khách, đơn, checkout, webhook, device polling | Có |
| Firmware ESP32-C3 + R307/EC11/TFT | Chưa; cần pin mapping và thử máy |
| Gói lượt/tháng, ledger, vân tay | Kế hoạch; chưa có implementation |
| Giặt theo kg, nhiều dòng đơn, giao nhận, workflow UI | Kế hoạch |
| Refund, operator review, audit đầy đủ, role admin | Kế hoạch |
| SaaS billing, merchant riêng, nhiều chi nhánh | Kế hoạch |
| MQTT/Blynk adapter production | Kế hoạch; MVP hiện dùng polling HTTPS |

## 9. Lộ trình triển khai

### Chặng 1 — Nền MVP
Cấu hình Supabase; chạy migration; đăng nhập; tạo tenant; tạo khách/đơn; thử payOS; phân quyền cô lập. Nghiệm thu: hai tenant không đọc/chọn được dữ liệu nhau; restart API không mất đơn; webhook lặp không sinh thêm phiên.

### Chặng 2 — Một máy rửa và một máy giặt/sấy
Chốt pin mapping; firmware polling/ACK/finish; NVS chống trùng; mất mạng, mất điện, timeout. Máy phải tự dừng tại chỗ theo chính sách, không phụ thuộc lệnh STOP từ cloud. Nghiệm thu trên thiết bị thật trước khi kích tải.

### Chặng 3 — Nghiệp vụ tiệm
Quản lý xe; giặt theo kg/order items; tiếp nhận/trả đồ; thanh toán tiền mặt có quyền và audit; trạng thái công việc; báo cáo theo ngày/múi giờ Asia/Ho_Chi_Minh.

### Chặng 4 — Gói và nhận dạng
Entitlement ledger, gói 7 ngày/1/3/6/12 tháng, R307, hạn mức theo dịch vụ. Nghiệm thu cạnh tranh hai máy dùng cùng lượt, hết hạn và hoàn lượt khi máy lỗi.

### Chặng 5 — SaaS nhiều doanh nghiệp
Mời thành viên, quyền owner/manager/staff, chi nhánh, billing SaaS riêng với tiền dịch vụ của khách, merchant payOS, cấu hình module và giới hạn máy.

### Chặng 6 — Mở rộng
Thêm bãi đỗ hoặc tiện ích trạm sạc bằng module và adapter; giữ nguyên core chung. Chỉ tách worker/service khi tải hoặc vận hành thực tế yêu cầu.

## 10. Các điều kiện trước vận hành

- API public sau TLS reverse proxy, không đưa Supabase service role vào web.
- Rate limit API/payment/device, giới hạn tạo tenant, xác minh ACL mọi mutation mới.
- Cấu hình payOS webhook URL thật; xử lý webhook kiểm tra của provider trước go-live.
- Thêm reconciliation job, retry checkout khi provider đã tạo link nhưng server chưa lưu; không coi request ID là giải quyết xong mọi lỗi mạng phía provider.
- Phân trang danh sách: UI MVP lấy tối đa 200 bản ghi; số doanh thu hiển thị chỉ là tổng trong danh sách, không phải báo cáo toàn bộ cơ sở.
- Provision secret riêng từng thiết bị qua kênh kiểm soát; có thu hồi/đổi secret.
- Không ghi mật khẩu/API key/bí mật thiết bị vào log.
- Sao lưu, migrations review, quan sát lỗi, kiểm thử quyền theo tenant và vai trò.
- Firmware phải chống command trùng, quá hạn và khởi động bất ngờ; chưa có firmware thì chưa kết nối relay thật.

## 11. Tiêu chí kiến trúc hoàn thành

Một bản triển khai duy nhất phục vụ nhiều tenant. Một khách có thể dùng nhiều module trong cùng tenant. Module mới không yêu cầu viết lại auth, customer, payment hay membership. Các bảng tính tiền có schema/constraint rõ; các thao tác tiền/quyền/máy có audit, idempotency và giao dịch nguyên tử. Dữ liệu không được lẫn giữa doanh nghiệp.
