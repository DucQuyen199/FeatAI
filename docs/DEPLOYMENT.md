# Triển khai

## Development

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up --build
```

Chế độ development dùng bind mount và hot reload mặc định:

- `apps/web`: Next.js dev server chạy webpack polling và tự cập nhật khi sửa `app/**`, kể cả bind mount Docker Desktop/Windows.
- `apps/api`, `services/**`: `tsx watch` tự khởi động lại tiến trình khi mã TypeScript thay đổi.
- Trên Docker Desktop/Windows, polling đã được bật qua `WATCHPACK_POLLING` và `CHOKIDAR_USEPOLLING`.
- Cache build Next.js dùng volume Docker riêng tại `/app/.next`, tránh xung đột với thư mục build trên máy host.

Sau lần build đầu tiên, chỉ cần chạy:

```bash
docker compose -f docker-compose.dev.yml up
```

- Web: <http://localhost:3000>
- API docs: <http://localhost:8000/docs>
- MinIO console: <http://localhost:9001>
- Tài khoản bootstrap mặc định: `admin@aicount.example.com` / `ChangeMe123!` (chỉ development).

Giao diện web và mobile mặc định theo theme hệ điều hành. Người dùng có thể chọn rõ
`System`, `Light` hoặc `Dark` trong phần Cài đặt; lựa chọn được lưu cục bộ, không được gửi
lên backend và không chứa dữ liệu nghiệp vụ.

## Production trên VPS/VM

1. Tạo `.env` bằng secret ngẫu nhiên mạnh cho PostgreSQL, MinIO, JWT và internal API key.
2. Đặt `DOMAIN`, `NEXT_PUBLIC_API_URL=https://<domain>/api/v1` và email/mật khẩu bootstrap riêng.
3. Trước khi bật rule production, chạy:

```bash
python scripts/verify_legal_corpus.py
python scripts/check_rule_release.py --production
```

Lệnh thứ hai **cố ý thất bại** cho tới khi chuyên gia điền locator, reviewer, approver,
rollback target và đổi ruleset sang `approved`.

4. Khởi động với TLS tự động qua Caddy:

```bash
docker compose -f docker-compose.dev.yml -f docker-compose.prod.yml up -d --build
```

Production overlay không công khai PostgreSQL, Redis, MinIO, API hay web trực tiếp; chỉ
Caddy mở cổng 80/443. Express API chạy migration SQL tương thích nâng cấp và bootstrap role/admin trước khi lắng nghe request.

Image backend production đóng gói `legal/raw` cùng manifest và index. Khi cập nhật corpus,
phải build lại image; dịch vụ preview chỉ trả PDF sau khi kích thước và SHA-256 khớp
manifest. Có thể kiểm tra nhanh image bằng `docker run --rm --entrypoint node <image> -e`
với một script chỉ đọc để đếm tệp trong `/app/legal/raw`.

`S3_SSE_ENABLED=false` chỉ phù hợp khi MinIO chạy trên volume đã mã hóa. Đặt biến thành
`true` sau khi đã cấu hình KMS/SSE-S3 cho MinIO hoặc S3 tương thích; nếu không, MinIO sẽ
chủ động từ chối upload để tránh tạo cảm giác mã hóa sai.

## Mobile

```bash
cd apps/mobile
npm ci
EXPO_PUBLIC_API_URL=https://<domain>/api/v1 npm start
```

Kiểm tra và xuất bundle Android tĩnh trước khi cấu hình chữ ký store:

```bash
npm run typecheck
npm run export:android
```

Để tạo binary ký cho store, cấu hình Expo Application Services rồi chạy
`npx eas-cli build --platform android` hoặc `--platform ios`. Không nhúng secret vào
`EXPO_PUBLIC_*`; biến này chỉ chứa public API base URL. Token được lưu trong SecureStore.

Web và mobile dùng chung các endpoint `/api/v1/files`. Kho tệp được phân tách theo
`tenant_id` và `owner_id`; nội dung nằm trong MinIO với prefix riêng của tài khoản.
Mặc định mỗi tệp tối đa 25 MB và mỗi tài khoản có 500 MB, có thể cấu hình bằng
`ACCOUNT_FILE_MAX_BYTES` và `ACCOUNT_STORAGE_QUOTA_BYTES`.

## Backup/restore

Sao lưu PostgreSQL và MinIO theo cùng recovery point. Audit hash chain giúp phát hiện thay
đổi nhưng không thay thế WORM storage. Production cần lifecycle/retention, off-site backup,
KMS và bài kiểm thử restore định kỳ.
