# Legal Review Checklist – AICount Guard

Dùng checklist này trước khi chuyển một rule từ `draft` sang `approved`.

## 1. Xác định phạm vi

- [ ] Đã xác định loại hóa đơn/chứng từ và đối tượng áp dụng.
- [ ] Đã xác định ngày giao dịch/ngày hóa đơn/kỳ kế toán.
- [ ] Đã xác định loại doanh nghiệp và chế độ kế toán áp dụng.
- [ ] Đã phân biệt quy định pháp luật với chính sách nội bộ.

## 2. Kiểm tra nguồn

- [ ] Văn bản lấy từ nguồn chính thức.
- [ ] Checksum khớp `legal/manifest.json`.
- [ ] Đã kiểm tra ngày ban hành, ngày hiệu lực và quy định chuyển tiếp.
- [ ] Đã kiểm tra văn bản sửa đổi, bổ sung, thay thế hoặc bãi bỏ.
- [ ] Đã ưu tiên văn bản hợp nhất khi có nguồn chính thức phù hợp.

## 3. Ánh xạ rule

- [ ] Rule có `document_id` và vị trí điều/khoản/điểm cụ thể.
- [ ] Nội dung rule không mở rộng hơn phạm vi điều khoản.
- [ ] Đã mô tả ngoại lệ và điều kiện áp dụng.
- [ ] Đã quy định sai số làm tròn/đơn vị tiền tệ nếu có.
- [ ] Failure code không tự động gắn nhãn “gian lận” hoặc “vi phạm”.

## 4. Kiểm thử

- [ ] Test dương.
- [ ] Test âm.
- [ ] Test biên.
- [ ] Test trước/sau ngày hiệu lực.
- [ ] Test với văn bản sửa đổi.
- [ ] Test dữ liệu thiếu hoặc OCR không chắc chắn.

## 5. Phê duyệt và phát hành

- [ ] Người soạn rule và người review là hai vai trò tách biệt.
- [ ] Có người phê duyệt nghiệp vụ/pháp lý.
- [ ] Có changelog và rollback target.
- [ ] Có audit event khi phát hành.
- [ ] Corpus, rule engine và test fixture dùng cùng snapshot pháp lý.
