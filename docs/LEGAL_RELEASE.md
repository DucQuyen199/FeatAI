# Cổng phát hành rule pháp lý

`config/rules/invoice_rules.example.yaml` hiện là bản kỹ thuật `draft`. Locator theo trang
được máy liên kết với PDF đã khóa checksum nhưng vẫn có trạng thái `pending`. Một release chỉ được chuyển sang `approved` sau khi hoàn tất
`LEGAL_REVIEW_CHECKLIST.md` và đáp ứng:

- author, reviewer, approver là ba định danh khác nhau;
- mọi `document_id` có trong manifest và checksum corpus hợp lệ;
- mỗi nguồn có điều/khoản/điểm đã xác nhận, không còn `TODO_LEGAL_REVIEW`;
- có test dương, âm, biên, trước/sau hiệu lực và amendment regression trong bộ fixture khóa;
- có changelog, legal snapshot và rollback target;
- người có thẩm quyền ký duyệt ngoài quy trình code review.

CI/production gate:

```bash
python scripts/verify_legal_corpus.py
python scripts/check_rule_release.py --production
```

Ứng dụng không biến cảnh báo duplicate, anomaly hoặc reconciliation variance thành nhãn
“gian lận”/“vi phạm”. Legal retrieval trả `INSUFFICIENT_LEGAL_EVIDENCE` khi văn bản chưa
hiệu lực và `OCR_OR_INDEX_REQUIRED` khi mới có metadata hoặc PDF scan chưa đủ text. Chỉ
chunk có `VERIFIED_PDF_TEXT`, SHA-256 khớp manifest và locator theo trang mới được hiển
thị làm bằng chứng; mọi chunk máy trích xuất vẫn phải qua legal review trước khi phát hành
rule production.

Rule engine chỉ trả `PASS_TECHNICAL_CHECKS` khi ruleset đã được phê duyệt, dữ liệu trích
xuất đủ tin cậy, không còn cảnh báo và căn cứ đã được duyệt. Mọi trường hợp khác phải trả
`REVIEW_REQUIRED`; đây không phải kết luận pháp lý hay kết luận gian lận.
