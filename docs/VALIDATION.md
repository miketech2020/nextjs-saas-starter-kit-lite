# Kiểm tra bản nền ngày 08/10/2026

- `pnpm --filter web typecheck`: đạt.
- Next.js production build: đạt với cấu hình kiểm tra, `/home/services` và `/service-demo` được build.
- Ba kiểm tra hợp đồng module: đạt.
- Kiểm tra API với mock backend: đạt; thiếu login bị chặn, chữ ký sai bị chặn, webhook có chữ ký đúng dùng dữ liệu phẳng do SDK trả về.
- Kiểm tra PostgreSQL bằng PGlite + pgcrypto: đạt; chạy migration, quyền tenant, lấy giá từ server, giữ máy, request trùng, webhook trùng, secret sai, ACK/finish, dữ liệu khách khác tenant, thanh toán muộn và lệnh quá hạn.
- Kiểm tra cú pháp SQL bằng parser PostgreSQL: đạt.

Build gốc bị lỗi font Google trên Turbopack. Đã dùng font hệ thống để tránh phụ thuộc mạng và giữ chữ Việt dễ đọc. Lockfile upstream không khớp catalog; đã tái tạo lockfile bằng pnpm và cài dependency thành công.

PGlite kiểm tra giao dịch PostgreSQL nhưng không thay thế thử Supabase Auth/PostgREST/Google OAuth trên project thật. Chưa thử cổng payOS thật, nhiều merchant hoặc firmware/phần cứng.
