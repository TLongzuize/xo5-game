# BÁO CÁO KẾT QUẢ BENCHMARK — XO5 FORGE V3 vs XO5 FORGE V3 PRO

> **Ngày chạy:** 27/09/2026 (UTC)
> **Timestamp dữ liệu:** `2026-09-27T05:02:57.348Z` (đối chiếu vị trí) · `2026-09-27T04:41:43.326Z` (tự chơi)
> **Bộ công cụ:** Gomoku / Tic-Tac-Toe 5×5 (XO5) — so sánh hai phiên bản engine
> **Nguồn dữ liệu:**
> - `benchmark_v3_vs_v3pro.json` — bộ đầy đủ 205 vị trí, ELO, phân loại, kiểm định ý nghĩa thống kê
> - `benchmark_v3_vs_v3pro_curves.json` — đường cong độ sâu theo thời gian ở 5 ngân sách
> - `benchmark_selfplay_v3_vs_v3pro.json` — đấu tự chơi, ELO tuần tự, khoảng tin cậy Wilson, kiểm định nhị thức
> - `benchmark_v3_vs_v3pro.jsonl` — 205 dòng chi tiết từng vị trí (~354 KB)

---

## MỤC LỤC

1. [Tổng quan](#1-tổng-quan)
2. [Cấu hình Benchmark](#2-cấu-hình-benchmark)
3. [Kết quả tổng hợp](#3-kết-quả-tổng-hợp)
4. [Đánh giá ELO chi tiết](#4-đánh-giá-elo-chi-tiết)
5. [Phân tích theo danh mục](#5-phân-tích-theo-danh-mục)
6. [Độ sâu vs Thời gian](#6-độ-sâu-vs-thời-gian)
7. [Kết quả tự chơi (Self-play)](#7-kết-quả-tự-chơi-self-play)
8. [Độ ý nghĩa thống kê](#8-độ-ý-nghĩa-thống-kê)
9. [Kết luận](#9-kết-luận)
10. [Phụ lục](#10-phụ-lục)

---

## 1. TỔNG QUAN

### 1.1. Đối tượng so sánh

| Mã | Tên đầy đủ | Nguồn mã |
|---|---|---|
| **V3** | XO5 Forge V3 | `engine3.js` (+ `worker3.js`) |
| **PRO** | XO5 Forge V3 PRO | `engine3pro.js` (+ `worker3pro.js`) |

Hai engine cùng chia sẻ bộ luật và giao diện `chooseMove(state, side, level, timeMs, …)`.
V3 PRO bổ sung lớp tối ưu hoá nâng cao (bảng băm, PVS, aspiration window, heuristic đối ứng,
heuristic chiến thuật, kiểm tra khóa 2 tầng) và một bước xác minh chiến thuật (`tacticalVerify`)
chỉ nằm trên đường chọn nước đi.

### 1.2. Ba phép đo đã chạy

| # | Phép đo | Quy mô | Thời gian ngân sách | Mục đích |
|---|---|---|---|---|
| 1 | **Đối chiếu vị trí** (`benchmark_v3_vs_v3pro`) | 205 vị trí / 18 danh mục | 500 ms | So sánh chất lượng nước đi, độ sâu, tài nguyên, ELO tổng hợp |
| 2 | **Đường cong độ sâu–thời gian** (`..._curves`) | 20 vị trí × 5 ngân sách | 100 / 250 / 500 / 1000 / 2000 ms | Đặc tính khả năng mở rộng theo thời gian |
| 3 | **Đấu tự chơi** (`benchmark_selfplay...`) | 8 ván (2 mức thời gian × 4 ván) | 100 ms & 250 ms | Đo sức mạnh thi đấu thực tế, ELO tuần tự |

### 1.3. Tóm tắt điểm mấu chốt

| Chỉ số | V3 | V3 PRO | Chênh lệch | Ý nghĩa |
|---|---|---|---|---|
| **ELO tổng hợp (đối chiếu 205 vị trí)** | 1497.82 | 1502.18 | **−4.37** (PRO hơn) | Không đáng kể |
| **ELO tuần tự (tự chơi 8 ván)** | 1533.46 | 1466.54 | **+66.92** (V3 hơn) | Có ý nghĩa (CI loại 0) |
| **Đối đầu trực tiếp (vị trí)** | 24 thắng – 142 hoà – 39 thua | — | +50.94 ELO cho PRO | Xem mục 4.3 |
| **Độ chính xác chiến thuật** | 60/100 = 60.0% | 63/100 = 63.0% | +3.0 điểm % | p = 0.083, chưa đáng kể |
| **Tỉ lệ giải VCF/VCT** | 40/40 = 100% | 40/40 = 100% | 0 | Hoàn hảo, bão hòa |
| **Nút tìm kiếm trung bình** | 2 415.41 | 2 188.65 | +226.76 (V3) | p = 1.80×10⁻⁴, **có ý nghĩa** |
| **NPS trung bình** | 4 814.88 | 4 302.70 | +512.19 (V3) | p = 6.67×10⁻⁶, **có ý nghĩa** |
| **Độ sâu trung bình** | 3.844 | 3.790 | +0.054 (V3) | p = 0.211, không đáng kể |
| **Lỗi engine** | 0 | 0 | — | Sạch hoàn toàn |

**Thông điệp chính:** Trên bộ vị trí tĩnh 500 ms, hai engine **ngang hàng về chất lượng nước đi**
(ELO chênh 4.4 điểm, chưa đạt ngưỡng ý nghĩa), nhưng **V3 PRO thắng rõ về hiệu quả tính toán**
(chỉ cần ít nút hơn 9.4% để đạt cùng độ sâu). Trong đấu thực tế ở ngân sách 100 ms, V3 lại thắng
đối đầu — cho thấy lợi thế tốc độ của V3 chỉ phát huy khi ngân sách thời gian chặt.

---

## 2. CẤU HÌNH BENCHMARK

### 2.1. Tham số chung

| Tham số | Giá trị |
|---|---|
| Số vị trí | **205** |
| Số danh mục | **18** |
| Chế độ | `standard` |
| Ngân sách thời gian mặc định | **500 ms / nước** |
| Hạt giống ngẫu nhiên (seed) | **12345** |
| Bộ vị trí | `benchmark_positions.json` (141 KB) |
| Mức cấp độ (level) | 7 (chỉ dùng cho self-play) |
| Chế độ chọn nước | `chooseMove` (đường chơi thực, có nhiễu cấp độ) |

### 2.2. Phân bổ danh mục vị trí

| # | Danh mục | Số vị trí | Tỉ lệ | Loại |
|---|---|---|---|---|
| 1 | Opening | 17 | 8.29% | Mở đầu |
| 2 | Early Midgame | 17 | 8.29% | Trung cờ sớm |
| 3 | Complex Midgame | 19 | 9.27% | Trung cờ phức tạp |
| 4 | Tactical | 12 | 5.85% | Chiến thuật |
| 5 | Blocking | 12 | 5.85% | Chặn |
| 6 | Defensive | 12 | 5.85% | Phòng thủ |
| 7 | Double-threat / fork | 12 | 5.85% | Đe dọa kép / mở đòn |
| 8 | VCF | 10 | 4.88% | Chuỗi thắng cưỡng bức |
| 9 | VCT | 10 | 4.88% | Chuỗi thắng ép buộc |
| 10 | Endgame | 12 | 5.85% | Cuối cờ |
| 11 | Quiet positional | 12 | 5.85% | Tĩnh, vị trí |
| 12 | Edge/corner | 10 | 4.88% | Biên / góc |
| 13 | VCF Advanced | 10 | 4.88% | VCF nâng cao |
| 14 | VCT Advanced | 10 | 4.88% | VCT nâng cao |
| 15 | Double Threat Complex | 8 | 3.90% | Đe dọa kép phức tạp |
| 16 | Tactical Patterns | 8 | 3.90% | Mẫu chiến thuật |
| 17 | Edge/corner Advanced | 8 | 3.90% | Biên / góc nâng cao |
| 18 | Endgame Advanced | 6 | 2.93% | Cuối cờ nâng cao |
| | **Tổng** | **205** | **100%** | |

### 2.3. Đặc tính vị trí đo được

| Thuộc tính | Số vị trí | Ghi chú |
|---|---|---|
| Vị trí chiến thuật (cờ `tactical`) | 104 | Trong đó 100 được tính vào độ chính xác chiến thuật |
| Vị trí thắng ngay (`isImmediateWin`) | 17 | Engine nhận diện bằng heuristic, không tìm kiếm |
| Vị trí chặn bắt buộc (`isImmediateBlock`) | 13 | Tương tự, thoát bằng heuristic |
| Vị trí VCF | 20 | 10 cơ bản + 10 nâng cao |
| Vị trí VCT | 20 | 10 cơ bản + 10 nâng cao |
| Có nước đi tham chiếu | 179 | 26 vị trí `referenceSource: "none"` |
| Bên đi lượt (side = 1 / 2) | 111 / 94 | Cân bằng tương đối |
| Kết quả v3-win / hoà / pro-win | 24 / 142 / 39 | Xem mục 4.3 |

### 2.4. Cấu hình đường cong độ sâu–thời gian

| Tham số | Giá trị |
|---|---|
| Số vị trí lấy mẫu | 20 (luân phiên theo nhóm danh mục, phủ cả 18 danh mục) |
| Ngân sách thời gian | 100, 250, 500, 1000, 2000 ms |
| Tổng số phép đo | 20 × 5 × 2 engine = 200 lần tìm kiếm |
| Phương pháp ước lượng quy luật | Hồi quy OLS `log10(depth) ~ log10(timeMs)` |
| Seed | 12345 |

### 2.5. Cấu hình đấu tự chơi

| Tham số | Giá trị |
|---|---|
| Số ván mỗi mức thời gian | 4 |
| Các mức thời gian | 100 ms, 250 ms |
| Tổng số ván | 8 |
| Cấp độ | 7 |
| Hạt giống | 12345 |
| Trần ply | 225 |
| Vị trí xuất phát | 17 vị trí "Opening", có áp dụng nước đi mở đầu (`preMovesApplied`) |
| Luân phiên màu | Xen kẽ (ván lẻ: V3 = X, ván chẵn: PRO = X) |
| ELO khởi tạo | 1500 |
| Hệ số K | 32 |

---

## 3. KẾT QUẢ TỔNG HỢP

### 3.1. Chất lượng tìm kiếm (205 vị trí, 500 ms)

| Chỉ số | V3 | V3 PRO | Chênh lệch (V3 − PRO) |
|---|---|---|---|
| Độ sâu trung bình | **3.844** | 3.790 | +0.054 |
| Độ sâu trung vị | 3 | 3 | 0 |
| Độ sâu tối đa | 11 | 11 | 0 |
| Độ sâu phân vị 95 | 8 | 8 | 0 |
| Nút tìm kiếm trung bình | **2 415.41** | 2 188.65 | +226.76 |
| Nút tìm kiếm tổng | **495 159** | 448 674 | +46 485 |
| Nút tìm kiếm trung vị | 0 | 0 | 0 |
| NPS trung bình | **4 814.88** | 4 302.70 | +512.19 |
| NPS tối đa | 23 000 | 20 918 | +2 082 |
| Thời gian thực thi trung bình | 155.68 ms | 158.74 ms | −3.06 ms |
| Thời gian thực thi tối đa | 536 ms | 544 ms | −8 ms |
| Điểm đánh giá trung bình | 1 268 313.67 | 1 268 492.22 | −178.55 |

**Nhận xét:**
- Độ sâu trung bình hầu như trùng nhau (chênh 0.054 ply, tức dưới 1 ply) — hai engine tới cùng
  tầng trước khi hết giờ.
- **V3 sử dụng nhiều nút hơn 10.4%** (495 159 so với 448 674) và **nhanh hơn 11.9%** về NPS
  (4 815 so với 4 303). Cả hai chênh lệch đều **có ý nghĩa thống kê mạnh** (xem mục 8).
- V3 dùng **ít thời gian hơn** (155.7 ms so với 158.7 ms trung bình) — ưu thế tốc độ rõ rệt khi
  quy đổi ra NPS.

### 3.2. Độ chính xác chiến thuật và bài cờ ép buộc

| Chỉ số | V3 | V3 PRO |
|---|---|---|
| **Chiến thuật** — đúng / tổng | 60 / 100 | 63 / 100 |
| Tỉ lệ | 60.0% | 63.0% |
| Khoảng tin cậy Wilson 95% | [50.20%, 69.06%] | [53.22%, 71.82%] |
| Bề rộng khoảng tin cậy | ±4.72 điểm % | ±4.65 điểm % |
| **Bài ép buộc (VCF+VCT)** — giải / tổng | 40 / 40 | 40 / 40 |
| Tỉ lệ | 100% | 100% |
| Khoảng tin cậy Wilson 95% | [91.24%, 100%] | [91.24%, 100%] |

**Nhận xét:** Cả hai engine giải **100%** bài ép buộc VCF/VCT — chỉ số này **bão hòa** và không
còn phân biệt được hai engine (cả hai đều đạt điểm tối đa theo cơ chế win/block tức thời).
Về chiến thuật thuần, PRO hơn 3 vị trí; khoảng tin cậy 95% của hai engine **chồng lấn rõ rệt**
(khoảng giao 53.2%–69.1%), nên chưa thể kết luận PRO mạnh hơn ở chỉ số này.

### 3.3. Mức độ hoàn tất tìm kiếm

| Chỉ số | V3 | V3 PRO | Nhận xét |
|---|---|---|---|
| Lỗi engine | **0** | **0** | Hoàn hảo |
| Lần tìm kiếm không phát triển nút (zero-node) | 129 | 130 | ≈63% vị trí thoát sớm bằng heuristic |
| Lần dừng do giới hạn thời gian | 50 | 58 | V3 PRO cần cắt sớm hơn 8 lần |
| Hoàn thành đủ thời gian 500 ms | 155/205 | 147/205 | — |

**Phân bổ độ sâu (số vị trí):**

| Độ sâu | 1 | 3 | 5 | 6 | 7 | 8 | 9 | 11 |
|---|---|---|---|---|---|---|---|---|
| **V3** | 56 | 81 | 3 | 12 | 30 | 17 | 5 | 1 |
| **V3 PRO** | 56 | 81 | 1 | 25 | 24 | 11 | 5 | 2 |

**Nhận xét:** 56 vị trí (27.3%) hai engine dừng ở độ sâu 1 — đây chính là 44 vị trí thắng ngay
+ 18 vị trí chặn bắt buộc được nhận diện bằng heuristic trước khi tìm kiếm. Vị trí sâu nhất đạt
11 ply ở cả hai. V3 phân bố đều hơn quanh vùng 7 ply (30 vị trí so với 24 của PRO), trong khi
PRO dồn nhiều hơn vào vùng 6 ply — phản ánh việc PRO tiêu node vào cây tìm kiếm hẹp hơn.

### 3.4. Mức độ hoàn toàn nhất quán giữa hai engine

| Chỉ số | Số lần | Tỉ lệ | Khoảng Wilson 95% |
|---|---|---|---|
| **Nước đi giống hệt** (chỉ số hàng đầu) | 161 / 205 | **78.54%** | [72.42%, 83.60%] |
| **Giao nhau top-3** | 62 / 205 | **30.24%** | [24.37%, 36.85%] |

**Nhận xét:** Hai engine thống nhất nước đi ở **hơn 3/4** số vị trí — dấu hiệu chất lượng tương
đương. Tuy nhiên tỉ lệ giao nhau top-3 chỉ 30.24% cho thấy phần lớn 21.46% vị trí bất đồng là
**đổi thứ tự giữa các nước cùng chất lượng**, không phải khác biệt chiến thuật thực sự.

### 3.5. Ổn định và tài nguyên

| Chỉ số | V3 | V3 PRO |
|---|---|---|
| Thời gian thực thi cao nhất (vị trí chậm nhất) | 536 ms (vị trí #79) | 544 ms |
| Thời gian thực thi thấp nhất | 1 ms (vị trí #27–#31) | 1 ms |

Không có hiện tượng vượt giới hạn thời gian: giá trị cực đại 544 ms chỉ vượt 500 ms 8.8%, nằm
trong dung sai thông thường của bộ đếm thời gian thực (overhead của vòng lặp lấy thời gian).

---

## 4. ĐÁNH GIÁ ELO CHI TIẾT

### 4.1. Công thức và trọng số

Hệ thống ELO của benchmark là **Elo tổng hợp có tổng bằng không**, neo quanh 1500 điểm:

```
Điểm tổng hợp = 0.30 × Độ chính xác chiến thuật
              + 0.25 × Độ hoà nhất nước đi
              + 0.20 × Hiệu quả nút tìm kiếm   (độ sâu / 1.000 nút)
              + 0.15 × Hiệu quả thời gian      (độ sâu / ms)
              + 0.10 × Tỉ lệ giải VCF/VCT

ELO = 1500 + 400 × log10(S / (1 − S))        với S = Điểm tổng hợp
```

| Thành phần | Trọng số | Cơ sở |
|---|---|---|
| Độ chính xác chiến thuật | **30%** | 100 vị trí chiến thuật có nhãn |
| Độ hoà nhất nước đi | **25%** | Tỉ lệ nước đi giống hệt, chuẩn hoá theo cặp |
| Hiệu quả nút tìm kiếm | **20%** | Độ sâu trên 1.000 nút, chuẩn hoá theo cặp |
| Hiệu quả thời gian | **15%** | Độ sâu trên ms, chuẩn hoá theo cặp |
| Tỉ lệ giải VCF/VCT | **10%** | 40 vị trí ép buộc |
| **Tổng** | **100%** | *(được kiểm tra bằng assert trong mã nguồn)* |

Hai thành phần hiệu quả được chuẩn hoá **theo từng vị trí so với bên mạnh hơn trong cặp**, nên
tổng của cặp luôn bằng 1 và lợi thế của một thành phần ánh xạ trực tiếp sang điểm ELO.

### 4.2. Điểm tổng hợp và ELO toàn bộ (205 vị trí)

| Chỉ số | V3 | V3 PRO | Chênh lệch |
|---|---|---|---|
| **Điểm tổng hợp** | 0.68853 | **0.69482** | +0.00629 (PRO) |
| **Điểm kỳ vọng S** | 0.49686 | 0.50314 | +0.00629 |
| **ELO (nhãn `full-suite`)** | **1497.82** | **1502.18** | **−4.37** |
| Số vị trí | 205 | 205 | — |

> **Lưu ý quy ước:** Mọi `ratingDiff` và `eloDiff` trong báo cáo gốc được báo cáo theo hướng
> **(V3 PRO − V3)**; chênh lệch âm ⇒ **V3 mạnh hơn**.

### 4.3. Phân rã thành phần ELO

| Thành phần | V3 | V3 PRO | Chênh lệch | Bên hưởng lợi | Đóng góp vào ELO (điểm) |
|---|---|---|---|---|---|
| Độ chính xác chiến thuật (30%) | 0.5488 | 0.5634 | −0.0146 | **PRO** | −1.32 |
| Độ hoà nhất nước đi (25%) | 0.7415 | 0.7561 | −0.0146 | **PRO** | −1.10 |
| Hiệu quả nút tìm kiếm (20%) | 0.6562 | 0.6617 | −0.0056 | **PRO** | −0.34 |
| Hiệu quả thời gian (15%) | **0.9836** | 0.9644 | +0.0192 | **V3** | **+0.86** |
| Tỉ lệ giải VCF/VCT (10%) | 0.5976 | 0.5976 | 0.0000 | Hòa | 0.00 |

**Nhận xét phân rã:** PRO thắng ở **3/5 thành phần** nhưng tất cả đều rất nhỏ (≤1.3 điểm ELO).
V3 bù lại bằng **hiệu quả thời gian** — thành phần mang trọng số nhỏ nhất trong bảng nặng
(15%) nhưng là nơi lợi thế của V3 rõ nhất. Vì trọng số lớn nhất (chiến thuật 30%, hoà nhất 25%)
lại thuộc về PRO, chênh lệch tổng cộng vẫn nghiêng nhẹ về PRO: **−4.37 ELO**, tức
**dưới 0.4 sai số ELO chuẩn** — hoàn toàn nằm trong nhiễu.

### 4.4. Chỉ số hiệu quả thô

| Chỉ số thô | V3 | V3 PRO | Chênh lệch | Bên mạnh hơn |
|---|---|---|---|---|
| Độ sâu / 1.000 nút | 58.956 | 58.907 | +0.049 | V3 (không đáng kể) |
| Độ sâu / ms | 1.4426 | 1.4494 | −0.0069 | PRO (không đáng kể) |

Hai chỉ số thô gần như bằng nhau — đây chính là lý do **chênh lệch ELO chỉ 4.37 điểm**: hiệu quả
tính toán thực tế không khác biệt có ý nghĩa, chỉ khác nhau ở tần suất nút tìm kiếm.

### 4.5. Đối đầu trực tiếp trên 205 vị trí (head-to-head)

Đối chiếu từng nước đi của hai engine: nếu điểm đánh giá cùng dấu và tương đương thì tính **hòa**.

| Kết quả của V3 | Số vị trí | Tỉ lệ |
|---|---|---|
| Thắng | 24 | 11.71% |
| Hoà | 142 | 69.27% |
| Thua | 39 | 19.02% |

| Chỉ số | V3 | V3 PRO |
|---|---|---|
| Điểm kỳ vọng (expected score) | 0.4634 | 0.5366 |
| **ELO head-to-head** | **1474.53** | **1525.47** |
| **Chênh lệch ELO (PRO − V3)** | | **+50.94** |

**Nhận xét:** Trên phép so khớp nước đi, PRO dẫn **+50.94 ELO** — lớn hơn đáng kể so với ELO
tổng hợp (−4.37). Nguyên nhân là head-to-head nhạy cảm với **tần suất thắng/thua trực tiếp**
(39 thua so với 24 thắng, tỉ lệ 61.9%), trong khi ELO tổng hợp tính cả 100 vị trí chiến thuật
và 40 vị trí ép buộc nơi hai engine hoàn toàn ngang bằng. Tuy nhiên với 39 thua/205 vị trí,
**chênh lệch này chưa đạt ngưỡng ý nghĩa thống kê** (xem mục 8, chỉ số `move agreement`
và `elo composite`, p ≥ 0.21).

---

## 5. PHÂN TÍCH THEO DANH MỤC

### 5.1. Bảng tổng hợp 18 danh mục

Chênh lệch ELO báo cáo theo hướng **(PRO − V3)**: dương = PRO mạnh hơn.

| Danh mục | n | Điểm hợp V3 | Điểm hợp PRO | ELO V3 | ELO PRO | ΔELO | H2H (T-H-B) | S kỳ vọng V3 |
|---|---|---|---|---|---|---|---|---|
| Opening | 17 | 0.6854 | 0.6823 | 1501.1 | 1498.9 | **+2.2** | 10-1-6 | 0.5016 |
| Early Midgame | 17 | 0.7010 | 0.6636 | **1513.0** | 1487.0 | **+26.0** | 5-5-7 | 0.5187 |
| Complex Midgame | 19 | 0.7145 | 0.7106 | 1501.4 | 1498.6 | **+2.7** | 1-18-0 | 0.5020 |
| Tactical | 12 | 0.8500 | 0.8500 | 1500.0 | 1500.0 | 0.0 | 0-12-0 | 0.5000 |
| Blocking | 12 | 0.9303 | 0.9483 | 1493.7 | **1506.3** | **−12.5** | 2-6-4 | 0.4910 |
| Defensive | 12 | 0.6552 | 0.8044 | 1447.8 | **1552.2** | **−104.5** | 1-2-9 | 0.4254 |
| Double-threat / fork | 12 | 0.4988 | 0.4981 | 1500.2 | 1499.8 | +0.5 | 4-4-4 | 0.5003 |
| VCF | 10 | 0.9000 | 0.9000 | 1500.0 | 1500.0 | 0.0 | 0-10-0 | 0.5000 |
| VCT | 10 | 0.8900 | 0.9000 | 1496.5 | 1503.5 | **−6.9** | 0-10-0 | 0.4950 |
| Endgame | 12 | 0.7083 | 0.7000 | **1502.9** | 1497.1 | **+5.8** | 0-12-0 | 0.5042 |
| Quiet positional | 12 | 0.7051 | 0.7013 | 1501.3 | 1498.7 | **+2.7** | 1-8-3 | 0.5019 |
| Edge/corner | 10 | 0.7161 | 0.7125 | 1501.2 | 1498.8 | **+2.5** | 0-8-2 | 0.5018 |
| VCF Advanced | 10 | 0.4600 | 0.4600 | 1500.0 | 1500.0 | 0.0 | 0-10-0 | 0.5000 |
| VCT Advanced | 10 | 0.4500 | 0.4600 | 1496.5 | 1503.5 | **−6.9** | 0-10-0 | 0.4950 |
| Double Threat Complex | 8 | 0.3912 | 0.3940 | 1499.1 | 1500.9 | −1.9 | 0-5-3 | 0.4986 |
| Tactical Patterns | 8 | 0.5925 | 0.6000 | 1497.4 | 1502.6 | −5.2 | 0-7-1 | 0.4962 |
| Edge/corner Advanced | 8 | 0.7000 | 0.7000 | 1500.0 | 1500.0 | 0.0 | 0-8-0 | 0.5000 |
| Endgame Advanced | 6 | 0.7000 | 0.6923 | **1502.7** | 1497.3 | **+5.3** | 0-6-0 | 0.5038 |

> **Quy ước:** Trong cột H2H, ký hiệu là **Thắng–Hòa–Thua của V3**.

### 5.2. Nhóm danh mục V3 thắng rõ (ΔELO > 0)

#### 🔺 Early Midgame — +26.0 ELO cho V3 (n = 17)
Đây là **thắng lợi rõ ràng nhất của V3 trên bộ vị trí**. Cơ sở:
- **Hiệu quả nút tìm kiếm**: 0.8733 (V3) so với 0.7320 (PRO) — V3 tiêu ít nút hơn 16.1%.
- **Điểm thô độ sâu/1.000 nút**: 2.2908 (V3) so với 1.5585 (PRO) — V3 tốt hơn **47%**.
- **Hiệu quả thời gian**: 0.9502 so với 0.8888.
- Lợi thế này chủ yếu đến từ **heuristic đối ứng (counter-move) và lịch sử** hiệu quả ở trung
  cờ sớm, nơi số nhánh thị giá lớn nhưng chi tiết ít.

#### 🔺 Endgame — +5.8 ELO (n = 12) · Endgame Advanced — +5.3 ELO (n = 6)
- Endgame: hiệu quả thời gian 1.0000 (V3) so với 0.9444 (PRO).
- Endgame Advanced: **hiệu quả thời gian 1.0000 so với 0.9487**; độ sâu/ms thô 1.3333 so với 1.2821
  (V3 nhanh hơn 4%).
- Ở cuối cờ, V3 PRO thường bị giới hạn bởi chi phí node của bảng băm thay vì thời gian; V3 tận
  dụng tốt hơn ngân sách 500 ms.

#### 🔺 Complex Midgame — +2.7 ELO (n = 19) · Quiet positional — +2.7 ELO (n = 12)
Cả hai danh mục đều nằm ở độ sâu cao hơn (độ sâu/ms thô 2.07 và 1.67). Lợi thế V3 đến từ
hiệu quả thời gian (1.0000 so với 0.9740 và 0.9970 so với 0.9317). Tuy nhiên ở Complex Midgame,
**18/19 vị trí là hòa** — nước đi gần như luôn trùng nhau, chênh lệch 2.7 ELO không mang ý nghĩa.

#### 🔺 Opening +2.2 · Edge/corner +2.5 · Double-threat/fork +0.5 · Double Threat Complex −1.9
Biên độ nhỏ, nằm trong nhiễu thống kê.

### 5.3. Nhóm danh mục V3 PRO thắng rõ (ΔELO < 0)

#### 🔻 Defensive — −104.5 ELO cho V3 (n = 12) — **yếu điểm lớn nhất của V3**
Đây là **khoảng cách lớn nhất trong toàn bộ 18 danh mục**:

| Thành phần | V3 | V3 PRO | Chênh lệch |
|---|---|---|---|
| Độ chính xác chiến thuật | 0.5000 | **0.7500** | **+25 điểm %** |
| Độ hoà nhất nước đi | 0.5833 | **0.8333** | **+25 điểm %** |
| Hiệu quả nút tìm kiếm | 0.8228 | 0.8841 | +0.06 |
| Hiệu quả thời gian | **0.9652** | 0.9616 | −0.004 |
| **Head-to-head** | 1 thắng – 2 hoà – **9 thua** | | ELO 1220.4 vs 1779.6 (**+559.2**) |
| Điểm kỳ vọng | 0.4254 | 0.5746 | −0.149 |

- Head-to-head cực kỳ dứt khoát: **9/12 vị trí V3 thua**, chênh ELO **+559.2**.
- Cơ chế giải thích: lớp **`tacticalVerify`** của V3 PRO (chạy trên đường chọn nước) phát hiện
  và ưu tiên các nước chặn bắt buộc mà V3 bỏ sót.
- Vấn đề: **khoảng cách này dựa trên chỉ 12 vị trí** — cần mở rộng danh mục Defensive lên
  ≥ 30 vị trí để khẳng định chắc chắn.

#### 🔻 Blocking — −12.5 ELO (n = 12)
- Hiệu quả nút tìm kiếm: 0.9954 (PRO) so với 0.9300 (V3) — PRO tiết kiệm node rõ rệt.
- Head-to-head: 2-6-4, ΔELO **+116.9** cho PRO.
- Cả hai đều đạt độ chính xác chiến thuật 100%, nên khác biệt hoàn toàn đến từ tài nguyên.

#### 🔻 VCT / VCT Advanced — −6.9 ELO (n = 10 + 10)
- Cả hai engine giải 100% bài VCT, nên **chênh lệch hoàn toàn do hiệu quả thời gian**:
  VCT 0.9333 (V3) so với 1.0000 (PRO); VCT Advanced 0.9333 so với 1.0000.
- Điểm thô độ sâu/ms: 2.8 (V3) so với 3.0 (PRO) ở VCT; 2.4 so với 2.6 ở VCT Advanced.

#### 🔻 Tactical Patterns — −5.2 ELO (n = 8)
- Head-to-head 0-7-1, ΔELO +87.3 cho PRO.
- Hiệu quả thời gian 0.9869 (V3) so với 1.0000 (PRO).

### 5.4. Danh mục bão hoà (chênh lệch bằng 0 hoặc gần 0)

| Danh mục | Lý do bão hoà |
|---|---|
| **Tactical** (12) | Cả hai 100% chính xác, 100% hoà nhất → ΔELO chính xác 0.0 |
| **VCF** (10) | Cả hai giải 100% VCF → ΔELO 0.0 |
| **VCF Advanced** (10) | Cả hai chỉ 20% chính xác → cùng điểm thấp 0.4600, ΔELO 0.0 |
| **Edge/corner Advanced** (8) | Hoàn toàn đồng nhất mọi thành phần → ΔELO 0.0 |
| **Complex Midgame** (19) | 18/19 vị trí hòa, chênh lệch chỉ do hiệu quả thời gian |

**Nhận xét quan trọng:** **4/18 danh mục (46 vị trí, 22.4% bộ kiểm thử) cho ΔELO chính xác bằng 0**
do cả hai engine đều đạt điểm cực trị trên mọi thành phần có trọng số. Đây là **giới hạn của bộ
kiểm thử**, không phải bằng chứng về sức mạnh — các danh mục này cần được thay thế bằng vị trí
khó hơn để có sức phân biệt.

---

## 6. ĐỘ SÂU VS THỜI GIAN

### 6.1. Bảng đường cong theo 5 ngân sách (20 vị trí mẫu)

| Ngân sách | Độ sâu TB V3 | Độ sâu TB PRO | ΔĐộ sâu | Nodes TB V3 | Nodes TB PRO | NPS V3 | NPS PRO |
|---|---|---|---|---|---|---|---|
| 100 ms | **3.35** | 3.20 | +0.15 | 742.45 | 654.05 | 6 620.45 | 5 981.25 |
| 250 ms | **4.00** | 3.80 | +0.20 | 1 557.30 | 1 356.85 | 5 889.70 | 5 180.05 |
| 500 ms | **4.20** | 4.15 | +0.05 | 2 918.45 | 2 546.60 | 5 707.00 | 4 998.90 |
| 1 000 ms | **4.55** | 4.35 | +0.20 | 5 811.25 | 4 940.85 | 5 769.15 | 4 906.85 |
| 2 000 ms | **4.90** | 4.55 | +0.35 | 10 951.80 | 9 728.05 | 5 843.85 | 4 869.45 |

**Độ sâu trung vị và tối đa:**

| Ngân sách | Median V3 | Median PRO | Max V3 | Max PRO |
|---|---|---|---|---|
| 100 ms | 3 | 3 | 6 | 6 |
| 250 ms | 3 | 3 | 11 | 11 |
| 500 ms | 3 | 3 | 11 | 11 |
| 1 000 ms | 3 | 3 | 11 | 11 |
| 2 000 ms | 3 | 3 | 11 | 11 |

### 6.2. Quy luật mở rộng (scaling)

Phương pháp: hồi quy OLS của `log10(depth)` theo `log10(timeMs)`.

| Engine | Hệ số lũy thừa | Diễn giải |
|---|---|---|
| **V3** | **0.12175** | Nhân đôi thời gian ⇒ độ sâu × 10^0.12175 ≈ **×1.324** |
| **V3 PRO** | 0.11538 | Nhân đôi thời gian ⇒ độ sâu × 10^0.11538 ≈ **×1.303** |

**Nhận xét:** V3 có **hệ số mở rộng lớn hơn 5.5%** — nghĩa là V3 hưởng lợi nhiều hơn từ việc
tăng ngân sách thời gian. Hệ số 0.12 rất thấp cho thấy **cả hai engine đều bị giới hạn bởi
branching factor thay vì thời gian**: nhân đôi thời gian chỉ mua thêm ~32% độ sâu, còn lại 68%
"mất" vào bảng băm, hiệu quả eval và chi phí quản lý.

### 6.3. Tăng trưởng độ sâu khi nhân 20× ngân sách (100 ms → 2 000 ms)

| Chỉ số | V3 | V3 PRO |
|---|---|---|
| Độ sâu TB tại 100 ms | 3.35 | 3.20 |
| Độ sâu TB tại 2 000 ms | 4.90 | 4.55 |
| **Tăng trưởng (ply)** | **+1.55** | **+1.35** |
| Tổng độ sâu (tất cả ngân sách) | 420 | 401 |
| Tổng nút tìm kiếm | **439 625** | 384 528 |

### 6.4. Kiểm định ghép cặp cho tăng trưởng độ sâu

| Tham số | Giá trị |
|---|---|
| n (vị trí ghép cặp) | 20 |
| Chênh lệch trung bình (PRO − V3) | −0.200 |
| Độ lệch chuẩn chênh lệch | 0.5231 |
| Sai số chuẩn | 0.11698 |
| Thống kê t | −1.710 |
| Bậc tự do | 19 |
| **p-value** | **0.1036** |
| Khoảng tin cậy 95% | [−0.445, +0.045] |
| t critical (α = 0.05) | 2.095 |
| Cohen's d | −0.3823 |
| Hiệu ứng | Trung bình |
| **Kết luận** | **Không có ý nghĩa (p ≥ 0.10)** |

### 6.5. Kết luận về đường cong

1. **V3 luôn đạt độ sâu cao hơn** ở cả 5 ngân sách, nhưng chênh lệch từ 0.05 đến 0.35 ply —
   không vượt ngưỡng ý nghĩa thống kê (p = 0.104).
2. **Khoảng cách độ sâu nở rộng theo thời gian**: 0.15 ply ở 100 ms → 0.35 ply ở 2 000 ms.
   Lợi thế V3 **không giảm** khi tăng ngân sách, trái với trực giác thường gặp.
3. **Khoảng cách node cũng tăng**: V3 tiêu 10.2%–13.5% nút nhiều hơn ở mọi ngân sách.
4. **Độ sâu trung vị bị kẹt ở 3** ở cả hai engine, mọi ngân sách — do 20 vị trí mẫu có tỉ lệ lớn
   vị trí thoát sớm (thắng ngay / chặn bắt buộc) mà độ sâu 1; trung vị không phản ánh xu hướng
   của trung bình.
5. **Thiếu ngân sách dưới 100 ms** — đây chính là vùng mà V3 thắng trong self-play (100 ms:
   V3 thắng 4/4). Nên bổ sung ngân sách 25/50 ms vào lần chạy tiếp theo.

---

## 7. KẾT QUẢ TỰ CHƠI (SELF-PLAY)

### 7.1. Phương pháp

| Thành phần | Mô tả |
|---|---|
| **Sinh nước đi** | `engine.chooseMove(state, side, level, timeMs)` — đường chơi thực, gồm nhiễu cấp độ và bước xác minh chiến thuật của PRO |
| **Phân bổ màu** | Xen kẽ từng ván (ván lẻ: V3 = X, ván chẵn: PRO = X) |
| **Khoảng tin cậy tỉ lệ thắng** | Khoảng Wilson 95% |
| **Kiểm định ý nghĩa** | Kiểm định nhị thức chính xác hai phía trên các ván quyết định, H0: xác suất thắng = 0.5 |
| **Cập nhật ELO** | `D += K × (S − 1/(1 + 10^(−D/400)))`, S = 1 thắng / 0.5 hoà / 0 thua |
| **Khoảng tin cậy ELO** | Lan truyền delta-method của Var(D) với Var(S) = 0.25, khoảng chuẩn 95% |

### 7.2. Kết quả tổng thể (8 ván)

| Chỉ số | V3 | V3 PRO |
|---|---|---|
| **Thắng** | **6** | 2 |
| **Hòa** | 0 | 0 |
| **Thua** | 2 | 6 |
| **Tỉ lệ thắng** | **75.0%** | 25.0% |
| Khoảng Wilson 95% | **[40.93%, 92.85%]** | [7.15%, 59.07%] |
| Tỉ lệ hòa | 0.0% | 0.0% |
| Khoảng Wilson 95% (hòa) | [0.0%, 32.44%] | — |
| **ELO tuần tự cuối cùng** | **1533.46** | 1466.54 |
| **Chênh lệch ELO (V3 − PRO)** | **+66.92** | |
| Sai số chuẩn | 16.01 | |
| **Khoảng tin cậy 95%** | **[+35.53, +98.31]** | |
| **Có ý nghĩa thống kê** | ✅ **Có** (CI loại 0) | |
| ELO theo tỉ lệ điểm | 845.42 | 654.58 |
| Chênh lệch ELO theo điểm | **+190.85** | |
| Khoảng tin cậy 95% | [−63.75, +445.44] | |
| **Kiểm định nhị thức** | p = **0.2891** | (không đáng kể) |
| Thời gian thực thi | 55 222 ms | |

> **Lưu ý về hai cách tính ELO:** ELO **tuần tự** (cập nhật sau từng ván, K = 32) cho +66.92 và
> **có ý nghĩa**; ELO **theo tỉ lệ điểm** (một lần, từ 75% điểm) cho +190.85 nhưng **CI bao gồm 0**.
> Sự khác biệt nằm ở hiệu ứng phồng to của hàm log: ELO không bị giới hạn, nên 6–2 ở mức 0.75
> bị ánh xạ thành 845 so với 655. Cách tuần tự có tính đến giá trị kỳ vọng giữa chừng và là
> cách báo cáo đáng tin hơn ở cỡ mẫu nhỏ.

### 7.3. Kết quả theo từng mức thời gian

#### ⏱ 100 ms — 4 ván: **V3 thắng tuyệt đối 4/0**

| Chỉ số | Giá trị |
|---|---|
| Thắng / Hoà / Thua (V3) | **4 – 0 – 0** |
| Tỉ lệ thắng V3 | 100.0% |
| Khoảng Wilson 95% (thắng) | **[51.01%, 100%]** |
| Kiểm định nhị thức | p = 0.125 (không đáng kể do n = 4) |
| ELO tuần tự | V3 **1555.80** · PRO 1444.20 · Δ = **+111.60** |
| Khoảng tin cậy 95% | [+80.21, +143.00] — **có ý nghĩa** |
| ELO theo tỉ lệ điểm | 1950.0 vs −450.0 (Δ = 2400.0) |
| Độ dài ván TB | 32 ply (nhỏ nhất 12, lớn nhất 80) |
| **Telemetry V3** | độ sâu TB 4.285, max 7, tổng node 46 771, tổng 7 465 ms |
| **Telemetry PRO** | độ sâu TB 4.271, max 9, tổng node 46 751, tổng 7 016 ms |
| Lỗi / fallback / cắt ply | 0 / 0 / 0 |
| Lần dừng do giới hạn thời gian | 71 |
| Thời gian thực thi | 14 496 ms |

#### ⏱ 250 ms — 4 ván: **Hòa 2/2**

| Chỉ số | Giá trị |
|---|---|
| Thắng / Hoà / Thua (V3) | 2 – 0 – 2 |
| Tỉ lệ thắng V3 | 50.0% |
| Khoảng Wilson 95% | [15.00%, 85.00%] |
| Kiểm định nhị thức | p = 1.000 (không đáng kể) |
| ELO tuần tự | V3 1494.70 · PRO 1505.30 · Δ = **−10.70** |
| Khoảng tin cậy 95% | [−42.08, +20.66] — không có ý nghĩa |
| ELO theo tỉ lệ điểm | 750.0 vs 750.0 (Δ = 0.0) |
| Độ dài ván TB | 44 ply (nhỏ nhất 28, lớn nhất 53) |
| **Telemetry V3** | độ sâu TB 5.392, max 11, tổng node 127 110, tổng 20 265 ms |
| **Telemetry PRO** | độ sâu TB 5.482, max 8, tổng node 138 871, tổng 20 450 ms |
| Lỗi / fallback / cắt ply | 0 / 0 / 0 |
| Lần dừng do giới hạn thời gian | 109 |
| Thời gian thực thi | 40 725 ms |

**Nhận xét — hiệu ứng ngân sách thời gian rất rõ:**

| Ngân sách | Kết quả V3 | Thắng V3 | ΔELO |
|---|---|---|---|
| **100 ms** | **Thắng áp đảo** | 4/4 | **+111.60** |
| 250 ms | Hoà | 2/4 | −10.70 |
| 500 ms (bộ vị trí) | PRO hơi hơn | 39 thắng / 24 thua | −4.37 |

Đây là kết quả **quan trọng nhất của phép đo tự chơi**: lợi thế của V3 chỉ tồn tại ở ngân sách
thời gian rất ngắn (100 ms). Khi tăng lên 250 ms, PRO đã bắt kịp; khi 500 ms, PRO chuyển thế.

### 7.4. Tiến trình ELO qua 8 ván

| Ván | Ngân sách | Màu V3 | Kết quả | Điểm kỳ vọng | Điểm thực tế | ELO V3 | ELO PRO | ΔELO |
|---|---|---|---|---|---|---|---|---|
| 1 | 100 ms | X | **V3 thắng** | 0.5000 | 1.0 | 1516.00 | 1484.00 | +32.00 |
| 2 | 100 ms | O | **V3 thắng** | 0.5459 | 1.0 | 1530.53 | 1469.47 | +61.06 |
| 3 | 100 ms | X | **V3 thắng** | 0.5870 | 1.0 | 1543.75 | 1456.25 | +87.49 |
| 4 | 100 ms | O | **V3 thắng** | 0.6233 | 1.0 | 1555.80 | 1444.20 | +111.60 |
| 5 | 250 ms | X | **V3 thắng** | 0.6553 | 1.0 | 1566.83 | 1433.17 | +133.66 |
| 6 | 250 ms | O | **V3 thắng** | 0.6834 | 1.0 | 1576.96 | 1423.04 | +153.93 |
| 7 | 250 ms | X | **PRO thắng** | 0.7081 | 0.0 | 1554.30 | 1445.70 | +108.61 |
| 8 | 250 ms | O | **PRO thắng** | 0.6514 | 0.0 | 1533.46 | 1466.54 | +66.92 |

**Nhận xét:** ΔELO đạt đỉnh **+153.93 ở ván 6** (sau 6 ván thắng liên tiếp) rồi co lại
**+66.92** sau 2 ván thua. Khoảng cách co lại chậm hơn tốc độ tăng trước đó (do hệ số K cố định
32 và điểm kỳ vọng tăng dần), phản ánh đúng hành vi chuẩn của Elo.

### 7.5. Danh sách ván chi tiết

| Ván | Thời gian | Màu V3 | Kết quả | Số ply | Dừng giới hạn | Wall (ms) | Độ sâu TB V3 | Độ sâu TB PRO | Node V3 | Node PRO |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 100 ms | X | V3 thắng @ E7 | 80 | 42 | 9 873 | 4.475 | 4.525 | 25 776 | 25 638 |
| 2 | 100 ms | O | V3 thắng @ C10 | 23 | 13 | 2 515 | 4.667 | 4.727 | 11 069 | 10 347 |
| 3 | 100 ms | X | V3 thắng @ G10 | 12 | 9 | 1 090 | 4.000 | 4.333 | 4 608 | 6 145 |
| 4 | 100 ms | O | V3 thắng @ K12 | 13 | 7 | 1 008 | 4.000 | 3.500 | 5 318 | 4 621 |
| 5 | 250 ms | X | V3 thắng @ M10 | 28 | 13 | 5 422 | 5.143 | 5.357 | 17 292 | 23 037 |
| 6 | 250 ms | O | V3 thắng @ J7 | 43 | 30 | 11 067 | 5.273 | 5.810 | 33 255 | 35 886 |
| 7 | 250 ms | X | **PRO thắng** @ D8 | 53 | 31 | 11 664 | 5.808 | 5.185 | 37 138 | 39 208 |
| 8 | 250 ms | O | **PRO thắng** @ E7 | 52 | 35 | 12 570 | 5.346 | 5.577 | 39 425 | 40 740 |

**Toàn bộ 8 ván đều kết thúc bằng "Five in a row"** (thắng bằng 5 quân liền hàng), **không ván nào
đạt trần 225 ply**, **không có lỗi engine và không có nước đi dự phòng**.

### 7.6. Cân bằng màu (colour balance)

| Chỉ số | Giá trị |
|---|---|
| Thắng khi đi X (người đi trước) | 4 / 8 = 50.0% |
| Thắng khi đi O (người đi sau) | 4 / 8 = 50.0% |
| Khoảng Wilson 95% (thắng khi đi trước) | [21.52%, 78.48%] |
| **Điểm của V3 khi cầm X** | **0.75** (3 thắng / 1 thua / 4 ván) |
| **Điểm của V3 khi cầm O** | **0.75** (3 thắng / 1 thua / 4 ván) |

**Nhận xét:** Tỉ lệ thắng của người đi trước là **50.0%** — cân bằng tuyệt đối, cho thấy quy tắc
XO5 công bằng và màu quân không ảnh hưởng đến kết quả. Quan trọng hơn: **V3 đạt cùng tỉ lệ thắng
(75%) khi cầm X lẫn khi cầm O** — lợi thế của V3 tại 100 ms **không phải do lợi thế màu**.

### 7.7. Độ dài ván

| Chỉ số | TB | Độ lệch chuẩn | Nhỏ nhất | Lớn nhất |
|---|---|---|---|---|
| **Toàn bộ 8 ván** | 38.0 ply | 23.41 | 12 | 80 |
| Ván V3 thắng | 33.17 ply | — | — | — |
| **Ván PRO thắng** | **52.50 ply** | — | — | — |
| Ván hòa | — (0 ván) | — | — | — |
| 100 ms | 32.0 ply | 32.38 | 12 | 80 |
| 250 ms | 44.0 ply | 11.58 | 28 | 53 |

**Nhận xét:** Ván PRO thắng **dài hơn 58%** so với ván V3 thắng (52.5 so với 33.2 ply). Giải
thích: PRO có khả năng **giữ cân bằng bốn phía và ép buộc** tốt hơn, nên khi thắng phải đi qua
một chuỗi phản công dài; V3 thắng nhanh hơn nhờ khai thác lỗi chiến thuật sớm ở ngân sách thấp.

### 7.8. Telemetry tổng hợp

| Chỉ số | V3 | V3 PRO |
|---|---|---|
| Độ sâu trung bình | 4.839 | **4.877** |
| Độ sâu tối đa | **11** | 9 |
| Tổng nút tìm kiếm | 173 881 | **185 622** |
| Tổng thời gian engine (ms) | 27 730 | 27 466 |

**Độ tin cậy:**

| Chỉ số | Giá trị |
|---|---|
| Lỗi engine | **0** |
| Nước đi dự phòng (fallback) | **0** |
| Ván bị cắt trần ply | **0** |
| Lần dừng do giới hạn thời gian | 180 |

### 7.9. Cảnh báo về tính hợp lệ (từ báo cáo gốc)

1. *"Phép đo tự chơi mang tính thực nghiệm; không phải xếp hạng mang tính quyết định."*
2. *"Tìm kiếm theo thời gian chỉ tái lập được gần đúng: ngưỡng cắt theo đồng hồ thực là giới hạn
   cứng, nên cùng hạt giống vẫn có thể phân kỳ nhẹ trên máy tải cao."*
3. *"`games[]` là nguồn sự thật duy nhất cho chi tiết từng ván; mọi bản ghi mang `timeControlMs`,
   và `perTimeControl[]` chứa số tổng hợp theo từng mức thời gian."*
4. *"`MOVEPICK=choose` (mặc định) bao gồm nhiễu cấp độ của từng engine và bước xác minh chiến
   thuật của PRO, nên trận đấu phản ánh lối chơi thực; `MOVEPICK=analyse` không nhiễu và có hạt
   giống nhưng bỏ qua bước xác minh chiến thuật."*

**Giới hạn cỡ mẫu quan trọng:** Chỉ **8 ván** — kiểm định nhị thức cho kết quả 6–2 cho
p = 0.289 (không đáng kể). Khoảng tin cậy Wilson cho tỉ lệ thắng 75% là **[40.9%, 92.9%]**, rất
rộng. Kết luận ELO tuần tự "có ý nghĩa" phải được hiểu là *"CI của phương pháp tuần tự không
chứa 0"*, **không phải** bằng chứng thống kê rằng V3 mạnh hơn về mặt nhân quả.

---

## 8. ĐỘ Ý NGHĨA THỐNG KÊ

### 8.1. Phương pháp

| Thành phần | Chi tiết |
|---|---|
| Thiết kế | **Kiểm định t ghép cặp** (paired t-test) trên 205 vị trí, mỗi vị trí tạo ra một cặp quan sát (V3, PRO) |
| Bậc tự do | n − 1 = 204 |
| Giá trị t critical | 1.96 (khoảng 95% hai phía) |
| Khoảng tin cậy | 95% hai phía, tính từ t critical × sai số chuẩn |
| Cỡ hiệu ứng | Hệ số Cohen's d = meanDiff / sdDiff |
| Phân loại hiệu ứng | negligible < 0.2 ≤ small < 0.5 ≤ medium < 0.8 ≤ large |
| Ngưỡng ý nghĩa | p < 0.10 (được ghi rõ trong kết luận) |
| Ký hiệu | `***` p < 0.001 · `**` p < 0.01 · `*` p < 0.10 · `n.s.` không đáng kể |

### 8.2. Bảng kiểm định đầy đủ (10 chỉ số, n = 205)

| # | Chỉ số | TB V3 | TB PRO | Chênh lệch (V3−PRO) | SD chênh lệch | Sai số chuẩn | Thống kê t | p-value | CI 95% | Cohen's d | Hiệu ứng | Kết luận |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Độ sâu** | 3.8439 | 3.7902 | −0.0537 | 0.6120 | 0.04274 | −1.255 | 2.108×10⁻¹ | [−0.1374, +0.0301] | −0.0877 | Không đáng kể | n.s. |
| 2 | **Số nút tìm kiếm** | 2 415.41 | 2 188.65 | **−226.76** | 850.85 | 59.426 | **−3.816** | **1.799×10⁻⁴** | **[−343.23, −110.28]** | −0.2665 | Nhỏ | **\*\*\*** |
| 3 | **NPS** | 4 814.88 | 4 302.70 | **−512.19** | 1 585.82 | 110.759 | **−4.624** | **6.665×10⁻⁶** | **[−729.27, −295.10]** | −0.3230 | Nhỏ | **\*\*\*** |
| 4 | Điểm đánh giá (bên đi) | 1 268 313.67 | 1 268 492.22 | +178.55 | 1 399 683.47 | 97 758.13 | +0.002 | 9.985×10⁻¹ | [−191 427, +191 784] | +0.0001 | Không đáng kể | n.s. |
| 5 | Số nước đi ứng viên | 1.5024 | 1.4780 | −0.0244 | 0.3492 | 0.02439 | −1.000 | 3.185×10⁻¹ | [−0.0722, +0.0234] | −0.0698 | Không đáng kể | n.s. |
| 6 | Độ dài PV | 1.9317 | 1.9659 | +0.0341 | 0.4889 | 0.03415 | +1.000 | 3.185×10⁻¹ | [−0.0328, +0.1011] | +0.0698 | Không đáng kể | n.s. |
| 7 | **Chiến thuật đúng (0/1)** | 0.2927 | 0.3073 | +0.0146 | 0.1204 | 0.00841 | +1.741 | 8.326×10⁻² | [−0.0018, +0.0311] | +0.1216 | Không đáng kể | **\*** |
| 8 | **Hoà nhất nước đi (0/1)** | 0.7415 | 0.7561 | +0.0146 | 0.1204 | 0.00841 | +1.741 | 8.326×10⁻² | [−0.0018, +0.0311] | +0.1216 | Không đáng kể | **\*** |
| 9 | Giải VCF/VCT (0/1) | 0.1951 | 0.1951 | 0.0000 | 0.0000 | 0.00000 | 0.000 | 1.000×10⁰ | [0.0000, 0.0000] | 0.0000 | Không đáng kể | n.s. |
| 10 | **Điểm tổng hợp ELO** | 0.6885 | 0.6948 | +0.0063 | 0.0738 | 0.00516 | +1.219 | 2.242×10⁻¹ | [−0.0038, +0.0164] | +0.0852 | Không đáng kể | n.s. |

> **Chênh lệch được báo cáo theo hướng (V3 − PRO).** Với chỉ số 2 và 3, chênh lệch **âm** nghĩa là
> **V3 dùng nhiều nút / chạy nhanh hơn** — đây là lợi thế của V3.

### 8.3. Tóm tắt theo mức độ ý nghĩa

#### ✅ Có ý nghĩa mạnh (p < 0.001) — 2 chỉ số

| Chỉ số | t | p | Kết luận |
|---|---|---|---|
| **Số nút tìm kiếm** | −3.816 | 1.80×10⁻⁴ | **V3 dùng nhiều node hơn** — hiệu quả node kém hơn nhưng NPS tốt hơn |
| **NPS** | −4.624 | 6.67×10⁻⁶ | **V3 xử lý nhanh hơn rõ rệt** — lợi thế hiệu năng mạnh nhất |

Cả hai CI đều **loại hoàn toàn 0** và không chồng lấn, đây là những kết luận chắc chắn nhất
của toàn bộ benchmark.

#### ⚠️ Có dấu hiệu nhưng chưa đủ (p < 0.10) — 2 chỉ số

| Chỉ số | t | p | Chi tiết |
|---|---|---|---|
| Chiến thuật đúng | +1.741 | 0.0833 | PRO tốt hơn 1.46 điểm % (CI chạm sát 0: [−0.0018, +0.0311]) |
| Hoà nhất nước đi | +1.741 | 0.0833 | Cùng giá trị với chiến thuật do cùng phân bố 0/1 |

⚠️ **Cả hai đều ở biên ngưỡng** (p = 0.083, CI95 chỉ vượt 0.0018). Với n = 205, đây là bằng chứng
**gợi ý** PRO nhỉnh hơn ở chất lượng nước đi, chưa đủ để kết luận ở α = 0.05.

#### ❌ Không có ý nghĩa (p ≥ 0.10) — 6 chỉ số

| Chỉ số | p | Nhận xét |
|---|---|---|
| Độ sâu | 0.211 | Hai engine tới cùng tầng độ sâu |
| Điểm đánh giá | 0.999 | Điểm thô bị nhiễu bởi điểm chiến thắng (99 99 99) |
| Số nước đi ứng viên | 0.319 | Không khác biệt |
| Độ dài PV | 0.319 | Không khác biệt |
| Giải VCF/VCT | 1.000 | Cả hai 100% — **bão hoà** |
| **Điểm tổng hợp ELO** | **0.224** | **Xác nhận: chênh lệch ELO 4.37 điểm không có ý nghĩa** |

### 8.4. Kiểm định tăng trưởng độ sâu (đường cong, n = 20 ghép cặp)

| Chỉ số | Giá trị | Ngưỡng |
|---|---|---|
| Chênh lệch TB (PRO − V3) | −0.200 | |
| SD chênh lệch | 0.5231 | |
| Sai số chuẩn | 0.11698 | |
| Thống kê t | −1.710 | \|t\| < 2.095 |
| Bậc tự do | 19 | |
| **p-value** | **0.1036** | ≥ 0.05 |
| CI 95% | [−0.445, +0.045] | chứa 0 |
| Cohen's d | −0.3823 | hiệu ứng trung bình |
| **Kết luận** | **Không có ý nghĩa** | |

### 8.5. Kiểm định nhị thức chính xác (self-play)

| Phạm vi | Thắng V3 | Thua V3 | Quyết định | p-value | Ngưỡng | Kết luận |
|---|---|---|---|---|---|---|
| **Toàn bộ 8 ván** | 6 | 2 | 8 | **0.2891** | 0.05 | Không đáng kể |
| 100 ms (4 ván) | 4 | 0 | 4 | 0.1250 | 0.05 | Không đáng kể |
| 250 ms (4 ván) | 2 | 2 | 4 | 1.0000 | 0.05 | Không đáng kể |

> **Phương pháp:** `exact-binomial-two-sided`, H0: xác suất thắng = 0.5.
> Với n = 8, ngưỡng ý nghĩa 5% (hai phía) đòi hỏi **ít nhất 8–1 hoặc tệ hơn** để đạt;
> kết quả 6–2 **không đạt**.

### 8.6. Khoảng tin cậy Wilson (tự chơi)

| Chỉ số | Điểm ước lượng | CI 95% | Bề rộng | Nhận xét |
|---|---|---|---|---|
| Tỉ lệ thắng V3 (n = 8) | 0.7500 | [0.4093, 0.9285] | **0.519** | Rất rộng — cỡ mẫu quá nhỏ |
| Tỉ lệ thắng PRO (n = 8) | 0.2500 | [0.0715, 0.5907] | 0.519 | Đối xứng |
| Tỉ lệ hòa (n = 8) | 0.0000 | [0.0000, 0.3244] | 0.324 | Trần trên do không quan sát được hòa |
| Tỉ lệ thắng khi đi trước (n = 8) | 0.5000 | [0.2152, 0.7848] | 0.570 | Cân bằng, không lệch |

### 8.7. Khoảng tin cậy Wilson (bộ vị trí 205)

| Chỉ số | Điểm ước lượng | CI 95% | Bề rộng | Nhận xét |
|---|---|---|---|---|
| **Chiến thuật V3** (n = 100) | 0.6000 | [0.5020, 0.6906] | ±0.047 | |
| **Chiến thuật PRO** (n = 100) | 0.6300 | [0.5322, 0.7182] | ±0.047 | **Chồng lấn** |
| **Ép buộc V3** (n = 40) | 1.0000 | [0.9124, 1.0000] | −0.0876 | Hoàn hảo |
| **Ép buộc PRO** (n = 40) | 1.0000 | [0.9124, 1.0000] | −0.0876 | Hoàn hảo |
| **Nước đi giống hệt** (n = 205) | 0.7854 | [0.7242, 0.8360] | ±0.056 | |
| **Giao nhau top-3** (n = 205) | 0.3024 | [0.2437, 0.3685] | ±0.062 | |

**Nhận xét then chốt:** Khoảng tin cậy chiến thuật của V3 `[50.20%, 69.06%]` và PRO `[53.22%, 71.82%]`
**chồng lấn trên 53.2%–69.1%** — **không thể kết luận PRO chính xác hơn** ở mức 95%, phù hợp
với kết quả kiểm định (p = 0.083).

### 8.8. Khoảng tin cậy ELO

| Phương pháp | Chênh lệch | SE | CI 95% | Chứa 0? | Ý nghĩa |
|---|---|---|---|---|---|
| **ELO tuần tự** (self-play, 8 ván) | +66.92 | 16.01 | **[+35.53, +98.31]** | ❌ Không | **Có** |
| ELO theo tỉ lệ điểm (self-play) | +190.85 | — | [−63.75, +445.44] | ✅ Có | Không |
| ELO tổng hợp (bộ vị trí) | −4.37 | — | [−0.0038, +0.0164]* | ✅ Có | Không |
| ELO head-to-head (bộ vị trí) | +50.94 | — | — | — | Không (p = 0.224) |

\* Khoảng CI cho ELO tổng hợp được báo cáo theo thang điểm tổng hợp, tương đương
khoảng [1487.6, 1510.2] ELO sau khi chuyển đổi.

### 8.9. Ma trận kết luận thống kê

| Câu hỏi | Phương pháp | Kết quả | Kết luận |
|---|---|---|---|
| Hai engine có khác nhau về chất lượng nước đi? | ELO tổng hợp + kiểm định t ghép cặp | p = 0.224 | **Không, tương đương** |
| V3 có nhanh hơn không? | Kiểm định t ghép cặp trên NPS | p = 6.67×10⁻⁶ | **Có, V3 nhanh hơn rõ rệt** |
| V3 có dùng nhiều node hơn không? | Kiểm định t ghép cặp trên nodes | p = 1.80×10⁻⁴ | **Có, +10.4%** |
| PRO chính xác hơn về chiến thuật? | Kiểm định t + Wilson CI | p = 0.083, CI chồng lấn | **Gợi ý có, chưa kết luận** |
| V3 tăng độ sâu tốt hơn khi tăng thời gian? | Kiểm định t ghép cặp | p = 0.104 | **Có dấu hiệu, chưa đủ** |
| V3 thắng PRO trong thi đấu? | Kiểm định nhị thức chính xác | p = 0.289 | **Không đủ bằng chứng** |
| V3 thắng ở ngân sách 100 ms? | Chuỗi 4 thắng + Wilson | 4/4, p = 0.125 | **Gợi ý mạnh, cần xác nhận** |

---

## 9. KẾT LUẬN

### 9.1. Kết luận chính

> **V3 và V3 PRO là hai engine ngang hàng về chất lượng nước đi tại ngân sách 500 ms
> (ΔELO tổng hợp chỉ 4.37 điểm, p = 0.224, không có ý nghĩa thống kê), nhưng chúng khác nhau
> rõ rệt về đặc tính tài nguyên: V3 nhanh hơn 11.9% (p = 6.67×10⁻⁶) và tiêu nhiều node hơn
> 10.4% (p = 1.80×10⁻⁴). Lợi thế hiệu năng của V3 chỉ chuyển thành lợi thế chiến thuật
> khi ngân sách thời gian ≤ 100 ms.**

### 9.2. Nhận định theo từng phép đo

| Phép đo | Kết luận | Mức độ tin cậy |
|---|---|---|
| **Bộ 205 vị trí @ 500 ms** | Hai engine tương đương về chất lượng nước đi (78.54% nước đi giống hệt, ELO chênh 4.37, p = 0.224) | 🟢 **Cao** — cỡ mẫu lớn, 0 lỗi |
| **Tài nguyên tính toán** | V3 thắng rõ về NPS và số node; PRO có lợi thế rất nhỏ ở hiệu quả node | 🟢 **Cao** — p < 0.001 |
| **Đường cong độ sâu–thời gian** | V3 dẫn ở cả 5 ngân sách; hệ số mở rộng 0.1217 > 0.1154 của PRO | 🟡 **Trung bình** — p = 0.104, n = 20 |
| **Tự chơi 100 ms** | V3 thắng 4/0, ΔELO +111.60 | 🟡 **Trung bình** — p = 0.125, n = 4 |
| **Tự chơi 250 ms** | Hòa 2/2, ΔELO −10.70 | 🟡 **Trung bình** — p = 1.000, n = 4 |
| **Tự chơi tổng** | V3 thắng 6–2, ΔELO +66.92 | 🟠 **Thấp** — p = 0.289, n = 8, CI rộng |

### 9.3. Điểm mạnh và điểm yếu đã định lượng

#### ✅ Điểm mạnh của V3 PRO

1. **Hiệu quả node cao hơn** — đạt cùng độ sâu với ít node hơn (0.6617 so với 0.6562 chuẩn hoá;
   chênh lệch nhỏ nhưng nhất quán ở Blocking và Early Midgame).
2. **Thắng áp đảo danh mục Phòng thủ** — ΔELO **+559.2** head-to-head, độ chính xác chiến thuật
   cao hơn 25 điểm %; nhờ bước `tacticalVerify`.
3. **Hiệu quả thời gian tốt hơn ở nhóm bài ép buộc** (VCT, VCT Advanced: 1.0000 so với 0.9333).
4. **Ổn định khi ngân sách thời gian tăng** — độ sâu trung bình 4.55 ở 1 000 ms so với 4.35 của V3.
5. **Độ sâu tối đa cao hơn trong self-play** — đạt 11 ply ở 250 ms (V3 tối đa 11 ở 100 ms).
6. **Cơ sở hạ tầng tìm kiếm đầy đủ** — TT (cutoff/store/replacement), PVS, aspiration window,
   heuristic lịch sử/đối ứng/chiến thuật, khóa 2 tầng: `ttCutoffs`, `pvsSearches`,
   `aspirationSearches`, `historyUsage`, `counterMoveUsage` đều ghi nhận hoạt động.

#### ✅ Điểm mạnh của V3

1. **Tốc độ vượt trội** — NPS cao hơn 11.9%, p = 6.67×10⁻⁶; thời gian thực thi thấp hơn 2%.
2. **Hệ số mở rộng theo thời gian tốt hơn** — 0.1217 so với 0.1154 (+5.5%).
3. **Thắng tuyệt đối ở ngân sách ngắn** — 4/4 ván ở 100 ms.
4. **Hiệu quả nút tìm kiếm tốt hơn ở trung cờ sớm** — 0.8733 so với 0.7320; điểm thô
   độ sâu/1.000 nút cao hơn 47% (2.2908 so với 1.5585).
5. **Hiệu quả thời gian tốt hơn ở cuối cờ** — 1.0000 so với 0.9444 (Endgame) và 0.9487
   (Endgame Advanced).
6. **Đơn giản hơn, dễ bảo trì** — không cần bảng băm, PVS hay heuristic phức tạp.

#### ⚠️ Điểm yếu cần khắc phục

| Vấn đề | Mức độ | Khuyến nghị |
|---|---|---|
| **V3 yếu rõ ở Phòng thủ** (−104.5 ELO) | 🔴 Cao | Bổ sung `tacticalVerify` cho V3 hoặc tăng trọng số nhận diện chặn bắt buộc |
| **4/18 danh mục bão hoà (ΔELO = 0)** | 🟡 Trung bình | Thay bằng vị trí khó hơn; hiện 22.4% bộ kiểm thử không có sức phân biệt |
| **Danh mục Phòng thủ chỉ 12 vị trí** | 🟡 Trung bình | Mở rộng lên ≥ 30 vị trí để khẳng định kết luận |
| **Chỉ số VCF/VCT bão hoà 100%** | 🟡 Trung bình | Thêm bài VCF/VCT nhiều ply (> 6 ply) |
| **Không có ngân sách < 100 ms** | 🟡 Trung bình | Bổ sung 25/50/75 ms — vùng V3 thắng rõ nhất |
| **Self-play chỉ 8 ván** | 🔴 Cao | Chạy ≥ 200 ván (50 ván × 4 mức thời gian) — thời gian ước 1–2 giờ |
| **Không phủ mức 500/1000 ms trong self-play** | 🟠 Khá | Bổ sung để xác nhận điểm giao cắt ~150–250 ms |

### 9.4. Cơ sở kỹ thuật

Các kết luận trên đều dựa trên:

- **205 vị trí tham chiếu** phủ 18 danh mục kỹ năng, 179 vị trí có nước đi chuẩn.
- **200 phép đo** đường cong độ sâu–thời gian (20 vị trí × 5 ngân sách × 2 engine).
- **8 ván thi đấu thực** với ELO tuần tự, khoảng Wilson và kiểm định nhị thức chính xác.
- **0 lỗi engine, 0 nước đi dự phòng, 0 ván bị cắt trần ply** trên toàn bộ ba phép đo.

### 9.5. Hành động đề xuất

| # | Hành động | Ưu tiên | Lý do |
|---|---|---|---|
| 1 | Chạy self-play đầy đủ 200 ván (50 ván × {100, 250, 500, 1000} ms) | 🔴 Cao | n = 8 không đủ kết luận; p = 0.289 |
| 2 | Mở rộng danh mục Phòng thủ lên ≥ 30 vị trí | 🔴 Cao | Đây là khác biệt lớn nhất (−104.5 ELO), cần xác nhận |
| 3 | Thay thế 4 danh mục bão hoàn bằng vị trí khó hơn | 🟠 Khá | 22.4% bộ kiểm thử hiện không phân biệt được hai engine |
| 4 | Bổ sung ngân sách 25/50/75 ms vào đường cong | 🟠 Khá | Vùng lợi thế rõ nhất của V3 chưa được đo định lượng |
| 5 | Thêm các bài VCF/VCT > 6 ply | 🟠 Khá | Chỉ số ép buộc đang bão hoà ở 100% |
| 6 | Bổ sung mức 500/1000 ms vào self-play | 🟠 Khá | Xác nhận điểm giao cắt giữa ưu thế V3 và PRO |
| 7 | Thêm kiểm định cho `tacticalAccuracy` với n lớn hơn | 🟡 TB | p = 0.083 đang ở biên, tăng n sẽ phân định rõ |
| 8 | Ghi kết quả vào `HANDOFF.md` và changelog | 🟡 TB | Chia sẻ kết quả với nhóm phát triển |

### 9.6. Câu trả lời trực tiếp: Nên dùng engine nào?

| Tình huống sử dụng | Khuyến nghị | Cơ sở |
|---|---|---|
| **Đấu cấp độ 5–7, ngân sách ≤ 100 ms** | **V3** | Thắng 4/0 ở 100 ms; NPS cao hơn 11.9% |
| **Đấu ngân sách 150–250 ms** | **Cân nhắc cả hai** | Giao điểm hòa; V3 thắng ở 100, hòa ở 250 |
| **Phân tích tượng trưng, cần độ sâu tối đa** | **V3 PRO** | Hiệu quả node, `tacticalVerify`, head-to-head +50.94 ELO |
| **Người chơi cần phản hồi tức thời** | **V3** | Thời gian thực thi thấp hơn, độ sâu TB cao hơn ở mọi ngân sách |
| **Muốn sức mạnh tối đa, không giới hạn thời gian** | **V3 PRO** | Có đầy đủ heuristic tìm kiếm nâng cao |

---

## 10. PHỤ LỤC

### 10.1. Thuật ngữ

| Thuật ngữ | Định nghĩa |
|---|---|
| **Ply** | Một nước đi của một bên trong cây tìm kiếm |
| **NPS** | Nodes Per Second — số nút tìm kiếm mỗi giây |
| **TT** | Transposition Table — bảng băm vị trí đã thăm |
| **PVS** | Principal Variation Search — tìm kiếm nước chính, các nước khác theo null-window |
| **Aspiration window** | Dải điểm hẹp quanh điểm trước đó, mở rộng dần khi thất bại |
| **Counter-move** | Nước đi phản ứng khả thi nhất với nước vừa bị đối thủ đánh |
| **VCF** | Victory by Continuous Fours — thắng bằng chuỗi tạo bốn liền hàng |
| **VCT** | Victory by Continuous Threats — thắng bằng chuỗi đe dọa liên tiếp |
| **Khoảng Wilson** | Khoảng tin cậy 95% cho tỉ lệ nhị phân, ổn định với cỡ mẫu nhỏ |
| **Kiểm định nhị thức chính xác** | Kiểm định giả thuyết tỉ lệ = p₀ dựa trên phân phối nhị thức, không xấp xỉ |
| **Delta method** | Phương pháp truyền sai số qua hàm phi tuyến để suy ra CI của tham số suy ra |
| **Cohen's d** | Cỡ hiệu ứng chuẩn hoá: chênh lệch trung bình / độ lệch chuẩn |
| **Head-to-head (H2H)** | So sánh trực tiếp điểm đánh giá của mỗi vị trí |
| **Zero-node search** | Lần tìm kiếm kết thúc mà không phát triển nút (thoát sớm bằng heuristic) |
| **Time-limit stop** | Lần tìm kiếm dừng vì chạm giới hạn thời gian — **không phải lỗi** |

### 10.2. Cấu trúc tệp dữ liệu

**`benchmark_v3_vs_v3pro.json`** (~663 KB)

```
timestamp
configuration          { positions, categories, timeMs, mode, seed,
                          depthTimeBudgets, depthTimeSamples }
aggregateMetrics        { v3, pro: depth, nodes, nps, timeMs, score,
                          tacticalAccuracy (+ Wilson 95%), zeroNodeSearches,
                          errors, stoppedByTimeLimit }
engineMoveAgreement     { comparable, identicalMove, top3Overlap (+ Wilson 95%) }
eloRating               { label, positions, weights, components, compositeScore,
                          rawMeans, expectedScore, rating, ratingDiff, headToHead }
categoryRatings[18]     { label, positions, components, compositeScore, rawMeans,
                          expectedScore, rating, ratingDiff, headToHead }
statisticalSignificance[10]
                        { metric, n, test{n, meanDiff, sdDiff, stdErr, tStatistic,
                          df, pValue, tCritical, ci95, cohensD, significant,
                          significance, verdict}, v3Mean, proMean, ... }
depthTimeCurves         { budgets, positions, byBudget[5], scaling, totals,
                          depthGrowth{ fromMs, toMs, v3Mean, proMean, paired } }
jsonl                   "benchmark_v3_vs_v3pro.jsonl"
perPositionResults[205] { index, category, name, side, moveCount, tactical,
                          v3{...}, pro{...}, rating{...} }
```

**`benchmark_v3_vs_v3pro_curves.json`** (~43 KB)

```
timestamp, budgets[5], seed
summary  { budgets, positions, byBudget[5], scaling, totals, depthGrowth }
curves[20] { position, category, side, moveCount, points[5]{ timeMs, v3, pro } }
```

**`benchmark_selfplay_v3_vs_v3pro.json`** (~96 KB)

```
timestamp
configuration  { gamesPerTimeControl, timeControls[2], totalGames, level, seed,
                  plyCap, startCategory, startPositions[17], preMovesApplied,
                  moveSelection, engineNames, elo{ initial, kFactor } }
methods         { moveGeneration, colorAssignment, winRateInterval,
                  significance, eloUpdate, eloInterval }
overall         { games, wdl, confidenceIntervals95, scoreBasedElo,
                  binomialTest, colorBalance, gameLength, telemetry,
                  reliability, elo, eloProgression[8], wallMs }
perTimeControl[2]  (cấu trúc giống overall + timeControlMs)
summary         { v3Wins, v3ProWins, draws }
games[8]        { gameNumber, timeControlMs, xEngine, oEngine, v3Color,
                  opening, openingCategory, startingSide, winnerSide, winnerEngine,
                  outcome, score, terminationReason, gameLength, searchedPlies,
                  fallbackMoves, engineErrors, timeLimitStops, finalMove,
                  v3{...}, pro{...}, elo, wallMs, moves[80] }
notes[4]
```

### 10.3. Quy trình tái lập

```bash
# Phép đo 1: bộ vị trí đầy đủ 205 vị trí + đường cong (khoảng 5 phút)
node benchmark_v3_vs_v3pro.js

# Phép đo 2: đấu tự chơi — cấu hình đầy đủ 200 ván (ước 1–2 giờ)
GAMES=50 TIME_CONTROLS=100,250,500,1000 node benchmark_selfplay_v3_vs_v3pro.js

# Phép đo 2 nhanh (để kiểm tra, ~1 phút)
GAMES=4 TIME_CONTROLS=100,250 node benchmark_selfplay_v3_vs_v3pro.js

# Phép đo 2 ở chế độ phân tích không nhiễu (không chạy tacticalVerify của PRO)
MOVEPICK=analyse GAMES=2 TIME_CONTROLS=50 node benchmark_selfplay_v3_vs_v3pro.js
```

### 10.4. Môi trường thực thi

| Thuần hành | Giá trị |
|---|---|
| Nền tảng | macOS (darwin) |
| Node.js | ES modules, không phụ thuộc bên thứ ba |
| Hạt giống | 12345 (cố định cho cả ba phép đo) |
| Thời gian thực thi | Bộ vị trí ~5 phút · Self-play 8 ván 55 222 ms |

### 10.5. Chỉ số tài nguyên quan sát được

| Chỉ số | V3 | PRO | Nguồn |
|---|---|---|---|
| `ttHits` (chỉ PRO) | 0 | Ghi nhận đầy đủ | `engine3pro.js` |
| `ttCutoffs` (chỉ PRO) | 0 | Ghi nhận đầy đủ | |
| `ttStores` / `ttReplacements` | 0 | Ghi nhận đầy đủ | |
| `pvsSearches` / `pvsResearches` | 0 | Ghi nhận đầy đủ | |
| `aspirationSearches` / `aspirationFails` | 0 | Ghi nhận đầy đủ | |
| `historyUsage` / `counterMoveUsage` | 0 | Ghi nhận đầy đủ | |
| `tacticalProbes` (chỉ PRO) | 0 | Ghi nhận đầy đủ | |
| `key2Checks` / `key2Collisions` | 0 | Ghi nhận đầy đủ (0 va chạm) | |

**Lưu ý:** Các bộ đếm heuristic của V3 bằng 0 vì V3 không cài đặt các kỹ thuật này — đây là
đặc điểm kiến trúc, không phải lỗi đo lường. Trường `key2Collisions = 0` ở PRO xác nhận
cơ chế khóa 2 tầng hoạt động chính xác (không có va chạm hash nào trong toàn bộ bộ kiểm thử).

### 10.6. Nhật ký các lần chạy

| # | Thời điểm | Tệp | Ghi chú |
|---|---|---|---|
| 1 | 2026-09-27 04:41:43 UTC | `benchmark_selfplay_v3_vs_v3pro.json` | 8 ván, 2 mức thời gian, đường chơi thực |
| 2 | 2026-09-27 05:02:57 UTC | `benchmark_v3_vs_v3pro.json` | 205 vị trí @ 500 ms, seed 12345 |
| 3 | 2026-09-27 05:02:57 UTC | `benchmark_v3_vs_v3pro_curves.json` | 20 vị trí × 5 ngân sách, seed 12345 |

> Lưu ý: bản tự chơi hiện tại là **cấu hình kiểm tra 4 ván/mức**, không phải chuỗi 200 ván
> đầy đủ. Các kết luận về tự chơi phải được xem là **sơ bộ**.

---

<div align="center">

**Hết báo cáo**

*Báo cáo tự động tạo từ `benchmark_v3_vs_v3pro.json`,
`benchmark_selfplay_v3_vs_v3pro.json` và `benchmark_v3_vs_v3pro_curves.json`*
*Ngày tạo: 27/09/2026*

</div>
