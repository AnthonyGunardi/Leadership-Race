# PRD TEKNIS — F1 LEADERSHIP RACE

**Klien:** PT Prakarsa Alam Segar (PT PAS)  
**Versi dokumen:** **1.1**  
**Tanggal revisi:** 11 November 2026  
**Status dokumen:** Kontrak produk aktif: satu game operasional, board publik dan admin satu halaman  
**Platform:** Web application, online, untuk event tatap muka dan tayangan LED/proyektor  
**Stack:** React + JavaScript/JSX + Vite · Node.js · Express.js · Sequelize · MySQL · Socket.IO

> **Prinsip produk:** Aplikasi mengelola giliran, perpindahan tim, penalti Indisipliner, pencatatan poin oleh Super Admin, leaderboard, dan hasil akhir. Seluruh pelaksanaan **challenge** dan **Reward** berlangsung di luar aplikasi dan menjadi tanggung jawab panitia. Narasi/petunjuk aktivitas bukan prasyarat teknis untuk menjalankan game.

## Daftar Isi

1. [Gambaran produk](#1-gambaran-produk)
2. [Ruang lingkup dan target keberhasilan](#2-ruang-lingkup-dan-target-keberhasilan)
3. [Data board dan aturan permainan](#3-data-board-dan-aturan-permainan)
4. [Pengguna, peran, dan perangkat](#4-pengguna-peran-dan-perangkat)
5. [Alur operasional dan state machine](#5-alur-operasional-dan-state-machine)
6. [Kebutuhan fungsional](#6-kebutuhan-fungsional)
7. [Spesifikasi antarmuka dan big-screen](#7-spesifikasi-antarmuka-dan-big-screen)
8. [Arsitektur dan struktur kode](#8-arsitektur-dan-struktur-kode)
9. [Model data dan integritas](#9-model-data-dan-integritas)
10. [Kontrak REST API](#10-kontrak-rest-api)
11. [Kontrak realtime Socket.IO](#11-kontrak-realtime-socketio)
12. [Concurrency, transaksi, dan idempotency](#12-concurrency-transaksi-dan-idempotency)
13. [Autentikasi dan keamanan](#13-autentikasi-dan-keamanan)
14. [Reliability dan deployment](#14-reliability-dan-deployment)
15. [Acceptance criteria dan pengujian](#15-acceptance-criteria-dan-pengujian)
16. [Tahapan implementasi](#16-tahapan-implementasi)
17. [Dokumen sumber dan standar](#17-dokumen-sumber-dan-standar)
18. [Lampiran A: Konfigurasi 50 kotak](#lampiran-a--konfigurasi-50-kotak)
19. [Lampiran B: Referensi aktivitas offline](#lampiran-b--referensi-aktivitas-offline)
20. [Lampiran C: Referensi implementasi visual](#lampiran-c--referensi-implementasi-visual)

## 1. Gambaran produk

**F1 Leadership Race** adalah aplikasi web untuk membantu panitia menjalankan board game tim dalam acara tatap muka. Papan terdiri dari **50 kotak** (5 × 10) berurutan zigzag, diikuti oleh **2–10 tim**. Dadu dilempar secara fisik; Super Admin memasukkan hasil 1–6 ke aplikasi. Backend menghitung lintasan, menyimpan posisi akhir, lalu menyinkronkan animasi langkah demi langkah pada seluruh browser admin dan layar publik.

Jika tim berhenti pada kategori Action, Reward, Race Strength, atau Pit Stop, panitia mengelola aktivitas di lapangan dan Super Admin hanya memasukkan **hasil poin** melalui salah satu dari dua metode: **Sukses/Gagal** atau **Input Poin Manual**. Kotak Indisipliner menjalankan hukuman langkah mundur otomatis tanpa form poin. Game berakhir ketika Super Admin menjalankan **Finish Game**, dan pemenang ditentukan dari akumulasi skor tertinggi, bukan posisi kotak terjauh.

**Sumber kebenaran data** adalah MySQL. Browser tidak boleh menentukan hasil gerakan atau skor secara mandiri; Socket.IO hanya mendistribusikan perubahan yang sudah tersimpan. Posisi tiap tim merupakan field individual walau beberapa tim berada pada kotak yang sama.

### 1.1 Fakta dasar board

| Aspek | Ketentuan |
|---|---|
| Jumlah kotak | 50 (5 baris × 10 kolom) |
| Jumlah tim | 2–10 |
| Kategori | 15 Action, 10 Reward, 9 Race Strength, 8 Pit Stop, 8 Indisipliner |
| Dadu | Fisik; hasil 1–6 dimasukkan admin |
| Giliran | Round-robin berdasarkan urutan tim |
| Start | Posisi 0 di luar kotak 1 |
| Finish | Manual, tidak terikat waktu atau posisi |
| Penentuan pemenang | Skor final tertinggi; poin seri tertinggi = pemenang bersama |
| Sumber data kotak | `F1_Leadership_Race_PAS_50_Kotak.xlsx`, sheet `50 Kotak Games`, baris 5–54 |

Nama kotak dan nilai default pada dokumen ini mengacu pada sumber workbook yang dinyatakan dalam PRD asal. Referensi visual berupa `Board Game.png`; file identitas/logo final tetap harus menggunakan aset resmi panitia.

## 2. Ruang lingkup dan target keberhasilan

### 2.1 Termasuk dalam aplikasi

- Login dan session Super Admin; satu game operasional dengan 2–10 tim, warna/urutan, poin per kotak dan reset.
  `/admin/games` menyatukan pengaturan, dadu dan penilaian; editor 50 kotak lengkap hanya pada URL kompatibilitas.
- Kontrol input dadu fisik, movement server-side, pantulan di kotak 50, dan penalti otomatis kotak Indisipliner.
- Input poin Super Admin melalui **BUTTON (Sukses/Gagal)** atau **MANUAL (angka poin)** untuk semua kategori selain Indisipliner.
- Display publik minimal: judul game, board 2.5D dengan chip T1–T10/clustering/animasi, dan leaderboard di sampingnya; final result tetap tersedia.
- Sinkronisasi realtime, snapshot/reconnect, histori transaksi, audit, koreksi skor, dan ekspor CSV.
- Kontrol game oleh satu Active Controller untuk input dadu, sementara akun Super Admin lain dapat mencatat poin pada giliran yang menunggu hasil.

### 2.2 Di luar aplikasi

| Aktivitas | Tanggung jawab panitia/offline | Konsekuensi bagi aplikasi |
|---|---|---|
| Melempar dadu | Panitia/peserta | Admin hanya memasukkan angka hasil |
| Menjelaskan dan menjalankan challenge | Panitia dan peserta | Aplikasi tidak punya timer kegiatan, soal, form jawaban, atau unggah bukti |
| Menentukan hasil challenge | Panitia | Aplikasi menerima hasil poin, bukan memverifikasi kualitas kegiatan |
| Reward / apresiasi / hadiah | Panitia | Tidak ada klaim Reward, pengiriman hadiah, atau verifikasi penyerahan |
| Instruksi dan durasi kegiatan | Referensi pelaksanaan | Field materi kegiatan bersifat opsional dan tidak memblokir preflight |

Tidak termasuk dalam produk: dadu digital, verifikasi otomatis performa, pengumpulan foto/video/QR, pembayaran, registrasi peserta publik, chat antaradmin, sistem offline-first, billing multi-tenant, atau auto-finish berdasarkan durasi/putaran.

### 2.3 Target keberhasilan

- Setiap mutasi bisnis hanya terjadi **sekali** untuk satu command/idempotency key, termasuk saat dua admin bertindak bersamaan.
- Posisi, poin, dan giliran tetap konsisten setelah browser refresh, reconnect, atau restart server.
- Target P95 write API kurang dari **1.000 ms** pada jaringan uji stabil (di luar durasi animasi); target realtime terlihat kurang dari **1.500 ms** sejak commit, bergantung jaringan.
- Rehearsal minimum **10 tim, 5 akun Super Admin, 3 display selama 60 menit**, tanpa double transaction.
- Uji keterbacaan tampilan LED 1920 × 1080 dan jarak pandang penonton yang nyata, bukan hanya preview di laptop.

## 3. Data board dan aturan permainan

### 3.1 Susunan board dan kategori

Board memiliki **5 baris × 10 kolom** dengan arah berikut:

| Baris visual (atas → bawah) | Urutan kiri → kanan |
|---|---|
| 1 | 1 → 10 |
| 2 | 20 → 11 |
| 3 | 21 → 30 |
| 4 | 40 → 31 |
| 5 | 41 → 50 |

Urutan logis permainan selalu **1 sampai 50**, tidak ditentukan oleh DOM order. Tiap kotak memuat nomor, kategori, nama kotak, ikon, dan warna kategori: **Action hijau; Reward ungu; Race Strength kuning-oranye; Pit Stop biru; Indisipliner merah**. Konfigurasi lengkap ada pada Lampiran A; referensi kegiatan lapangan ada pada Lampiran B.

### 3.2 Posisi awal, giliran, dan landing

- Semua tim mulai di **posisi 0** (`START`), bukan pada kotak 1. Kotak 1 hanya aktif jika tim benar-benar mendarat di sana.
- Tim berjalan sesuai `sort_order` secara **round-robin**.
- Hanya **landing cell setelah semua langkah dadu** yang memicu scoring atau penalti; kotak yang sekadar dilewati tidak memicu efek.
- Perubahan konfigurasi board/tim tidak diizinkan saat game `RUNNING`.

### 3.3 Movement, bounce, dan penalti

**Movement normal:** hasil dadu 1–6 membentuk `dice_path` per kotak. Jika melampaui kotak 50, bidak memantul dan sisa langkah dihitung mundur. Contoh posisi 48, dadu 4 menghasilkan `[49,50,49,48]`; posisi 50, dadu 3 menghasilkan `[49,48,47]`.

**Indisipliner:** jika landing setelah dadu berada pada kotak Indisipliner, server menambahkan `penalty_path` mundur satu per satu. Penalti hanya dievaluasi **sekali per roll**; kotak yang dilewati saat mundur tidak menyebabkan penalti berantai.

| Kotak penalti | Langkah mundur |
|---:|---:|
| 5 | 2 |
| 11 | 4 |
| 17 | 5 |
| 23 | 3 |
| 30 | 5 |
| 35 | 5 |
| 41 | 4 |
| 46 | 6 |

Contoh posisi 14, dadu 3: `dice_path=[15,16,17]`, landing 17 dengan penalti −5, `penalty_path=[16,15,14,13,12]`, final **12**. Kotak 35 yang mundur ke kotak 30 tidak memicu penalti kedua.

```js
/** Menolak input di luar aturan dadu fisik dan menghitung lintasan server-side, termasuk pantulan. */
function dicePath(from, dice, last = 50) {
  if (!Number.isInteger(from) || from < 0 || from > last) throw Error('invalid position');
  if (!Number.isInteger(dice) || dice < 1 || dice > 6) throw Error('invalid dice');
  let current = from;
  let direction = +1;
  const path = [];
  for (let step = 0; step < dice; step++) {
    if (current + direction > last) direction = -1;
    if (current + direction < 1) direction = +1;
    current += direction;
    path.push(current);
  }
  return path;
}
```

### 3.4 Scoring: dua metode yang saling eksklusif

Untuk **Action, Reward, Race Strength, Pit Stop**, server membuka state `AWAITING_RESULT` setelah animasi. Form poin sama untuk keempat kategori. Aktivitas lapangan telah dikelola panitia secara terpisah; aplikasi **tidak memeriksa** instruksi, durasi, bukti, atau keberhasilan faktual aktivitas.

| Metode | Input Super Admin | Poin diberikan | Kolom hasil |
|---|---|---|---|
| `BUTTON` / `SUCCESS` | Tekan **Sukses** | `board_cells.success_points` dari server | `scoring_method=BUTTON`, `outcome=SUCCESS` |
| `BUTTON` / `FAIL` | Tekan **Gagal** | `0` | `scoring_method=BUTTON`, `outcome=FAIL` |
| `MANUAL` | Isi poin bulat lalu **Simpan Poin** | Persis angka yang dimasukkan (termasuk 0) | `scoring_method=MANUAL`, `outcome=NULL`, `manual_points=nilai` |

Ketentuan wajib:

1. Hanya **satu hasil untuk setiap `turn_id`**. BUTTON tidak bisa digabung dengan MANUAL; jika hasil salah, gunakan koreksi yang diaudit.
2. Poin MANUAL adalah **total poin pada giliran itu**, bukan tambahan di atas `success_points`. Contoh cell 44: BUTTON/SUCCESS = 50; MANUAL 35 = **35**, bukan 85.
3. `points` MANUAL wajib integer aman **0–200** (`MAX_MANUAL_POINTS_PER_RESULT=200` pada validator server).
   String/pecahan/negatif/nilai melewati batas ditolak. UI meminta konfirmasi untuk nilai **0** atau **>50**.
4. `outcome` hanya untuk BUTTON. MANUAL tidak boleh disimpulkan SUCCESS/FAIL dari jumlah poin.
5. Semua Reward dan kategori non-Indisipliner memperoleh metode scoring yang sama; Reward tidak otomatis menambah skor hanya karena dilalui atau diinjak.
6. Kotak Indisipliner **tidak membuka form poin** dan hanya menjalankan langkah mundur.

**Aturan khusus kotak 26 (Origami):** referensi sumber `1 origami = 5 poin`. Pilihan default UI adalah MANUAL; bila ada 4 origami hasilnya **20 poin**, admin mengetik `20` (bukan jumlah origami `4`). BUTTON/SUCCESS tetap memberi 5 poin dan BUTTON/FAIL memberi 0. Poin bukan kelipatan 5 memunculkan peringatan **non-blocking**, tanpa kalkulasi atau perubahan otomatis oleh backend.

### 3.5 Ledger, leaderboard, dan pemenang

- `challenge_results` disimpan untuk hasil BUTTON/MANUAL termasuk nilai **0**. Untuk `awarded_points > 0`, tulis satu record `score_ledger` (`CHALLENGE_BUTTON` atau `CHALLENGE_MANUAL`). Untuk nilai 0 tidak perlu entri ledger nol.
- `score_ledger` tidak boleh diedit atau dihapus sebagai operasi bisnis; koreksi menggunakan **entry kompensasi**, dengan alasan dan audit lengkap.
- `teams.total_score` diperbarui **atomik** dan harus sama dengan `SUM(score_ledger.delta_points)`.
- Leaderboard mengurutkan skor **DESC**, lalu `sort_order ASC` untuk tampilan stabil; `sort_order` **bukan tie-break pemenang**.
- Peringkat final hanya dibuat saat **Finish Game**. Tim dengan skor tertinggi menang; seri nilai tertinggi menghasilkan **pemenang bersama**.

## 4. Pengguna, peran, dan perangkat

### 4.1 Otorisasi

Satu role operasional terautentikasi: **`SUPER_ADMIN`**. Dapat dibuat beberapa akun. Layar publik langsung
membaca satu game operasional tanpa login, pairing, atau cookie display. Server membatasi snapshot, replay,
dan socket publik ke game operasional saat ini; data controller, actor, audit, dan credential tidak dipublikasikan.

Hanya **satu Super Admin menjadi Active Controller untuk input dadu dan movement** pada satu waktu. Lease controller berlaku **30 detik** dan diperpanjang dengan heartbeat. Super Admin lain tetap dapat memantau dan memberi hasil poin saat state `AWAITING_RESULT`, tanpa harus memegang lease movement. Tombol **Take Over** harus memerlukan konfirmasi eksplisit dan dicatat pada audit. Database transaction wajib tetap melindungi semua mutasi walau lease sudah ada.

| Tindakan | Super Admin | Display read-only |
|---|---|---|
| Setup tim/poin; editor 50 kotak melalui URL kompatibilitas | Ya | Tidak |
| Input dadu dan memulai movement | Hanya Active Controller | Tidak |
| Input poin BUTTON/MANUAL | Ya, saat giliran menunggu hasil | Tidak |
| Pause, resume, finish, koreksi skor | Ya, dengan validasi dan audit | Tidak |
| Menampilkan board dan leaderboard game operasional | Ya | Ya |
| Membaca histori, audit, arsip, dan ekspor CSV | Ya | Tidak |
| Inisialisasi/reset game operasional | Ya, reset dengan konfirmasi | Tidak |

Akun awal dibuat melalui CLI lokal `admin:bootstrap`; aplikasi tidak menyediakan menu pengelolaan akun.

### 4.2 Perangkat

- **Admin:** laptop/tablet, antarmuka responsif dan state yang jelas saat disconnect.
- **Display papan:** browser fullscreen `/` pada komputer yang terhubung LED/proyektor, tanpa kode.
- **Display leaderboard/final:** `/leaderboard` dan `/final` di layar yang sama atau berbeda.
- Sinkronisasi melalui Socket.IO room `game:{gameId}` dengan otorisasi per game.

## 5. Alur operasional dan state machine

### 5.1 Alur operator

1. Board 50 kotak langsung tersedia di `/`, termasuk sebelum game disiapkan. Super Admin login dan membuka
   `/admin/games`, menginisialisasi satu game melalui **Atur tim**, lalu menyimpan 2–10 tim serta poin per kotak.
2. **Mulai bermain** menjalankan preflight lalu Start dengan versi respons server. Browser mengambil lease
   controller yang kosong otomatis; pengambilalihan browser lain tetap memerlukan konfirmasi eksplisit.
3. Active Controller memasukkan hasil dadu fisik (1–6). Backend mengunci giliran, menghitung `dice_path`, dan bila perlu `penalty_path`.
4. Display menayangkan animasi **satu langkah per kotak** secara serempak. Penonton mengikuti token aktif, highlight lintasan di dalam board, dan leaderboard.
5. Jika landing Indisipliner, penalti berlangsung otomatis dan game lanjut ke giliran berikutnya tanpa form poin.
6. Jika landing non-Indisipliner, panitia melaksanakan/menentukan hasil aktivitas **di luar aplikasi**, lalu Super Admin memilih BUTTON atau MANUAL dan menyimpan satu hasil poin.
7. Backend menyimpan hasil, mengubah skor dan leaderboard, melengkapi audit, lalu memindahkan giliran ke tim berikutnya.
8. Di akhir acara, Super Admin menjalankan **Finish Game** setelah tidak ada movement/input poin tertunda; sistem menyimpan hasil final dan menayangkan pemenang.

Langkah Finish/Pause, editor board lengkap, histori/koreksi dan ekspor tetap tersedia melalui URL admin lama,
di luar empat tugas halaman utama. Tim/poin hanya dapat diedit sebelum mulai; saat bermain pengaturan terkunci
dan dapat dilipat. Posisi diubah melalui dadu fisik 1–6, tanpa pemindahan bebas ke kotak tertentu.

**Reset game** pada halaman utama admin memerlukan konfirmasi dan versi state terbaru, serta menunggu animasi
selesai. Reset menyalin nama, tim/warna/urutan dan konfigurasi/provenance board tersimpan ke sesi DRAFT baru:
skor, posisi dan nomor giliran kembali 0, tanpa turn/controller aktif. Sesi lama menjadi arsip hanya baca;
turn, hasil, ledger, audit dan final result tetap utuh, termasuk hasil yang masih pending. Pointer game,
arsip, salinan konfigurasi, receipt idempotency, audit dan outbox disimpan atomik. Board berpindah ke sesi
baru tanpa reload. Reset tidak memfinalisasi pemenang. Detail: [kontrak satu game](single-game.md).

### 5.2 Lifecycle game

`DRAFT → READY → RUNNING ↔ PAUSED → FINISHED`

| Status | Perilaku |
|---|---|
| `DRAFT` | Tim, board, dan aturan dapat diubah |
| `READY` | Konfigurasi lolos preflight; menunggu Start Game |
| `RUNNING` | Perintah roll dan scoring tersedia sesuai turn state |
| `PAUSED` | Roll dan scoring dibekukan; pause hanya diizinkan ketika tidak ada active movement |
| `FINISHED` | Hasil final dibekukan; tidak ada lagi roll/scoring; reopen pasca-final tidak termasuk scope |

### 5.3 Lifecycle giliran

`READY_FOR_ROLL → ANIMATING → (AWAITING_RESULT | RESOLVING_PENALTY) → COMPLETED → READY_FOR_ROLL (next team)`

- `READY_FOR_ROLL`: hanya Active Controller boleh menginput dadu.
- `ANIMATING`: movement sudah dihitung dan disimpan; roll berikutnya ditolak (`409`).
- `AWAITING_RESULT`: hanya kategori non-Indisipliner; menunggu **input poin admin**, bukan status pengerjaan challenge.
- `RESOLVING_PENALTY`: Indisipliner; menunggu batas waktu animasi penalti, tanpa input poin.
- `COMPLETED`: satu giliran selesai, tim aktif beralih sesuai urutan dengan wrap-around.

Backend menjalankan job idempotent untuk memproses transisi berdasarkan `movement_ends_at`. Pada permintaan state/command, backend juga dapat menyelesaikan transisi tertunda untuk mencegah giliran tertahan setelah restart Node.js.

### 5.4 Kontrak animasi movement

- Satu command roll menghasilkan event `game:movement_started` dengan `dicePath`, `penaltyPath`, `fullPath`,
  `from`, `landingCell`, `finalPosition`, `startAt`, `endAt`, `stepDurationMs` dan sequence pada envelope.
- Durasi awal **450 ms per langkah** (dapat disetel, misalnya 300–700 ms). `startAt` dijadwalkan **300–500 ms setelah commit**, dengan koreksi offset waktu server. Client menggerakkan satu token overlay tiap langkah; **tidak mengirim event Socket.IO per kotak**.
- Backend dapat langsung menyimpan posisi final, tetapi tampilan memakai **`visualPositions`** dan active movement sampai waktu selesai. Ini mencegah teleport dan lompatan hitungan occupancy selama animasi.
- Display yang baru bergabung/terkoneksi ulang memakai snapshot dan metadata movement untuk melanjutkan dari progress terkini atau langsung menampilkan posisi akhir jika animasi sudah selesai.
- Reduced motion mengikuti OS/browser dan meminimalkan transisi tanpa mengubah skor, urutan atau posisi akhir.

### 5.5 Finish manual

**Finish Game** tersedia pada `/admin/games/:id/control` dan memerlukan konfirmasi eksplisit
(`confirmed:true` serta `expectedStateVersion`). Finish tidak dipicu timer, jumlah putaran atau kotak 50.
Movement atau hasil poin pending memblokir finalisasi. Server menyimpan `final_results`, `finished_at/finished_by`
dan event `game:finished`. Reset pada halaman utama adalah tindakan berbeda dan tidak menentukan pemenang.

## 6. Kebutuhan fungsional

**Prioritas:** `P0` wajib untuk pelaksanaan inti; `P1` fitur pelengkap yang tercakup dalam target produk. ID pada bagian ini merupakan nomor requirement baseline, bukan daftar perubahan versi.

| ID | Domain | Requirement | Prioritas | Kriteria penerimaan |
|---|---|---|---|---|
| FR-01 | Auth | Login/logout/refresh, session dan RBAC Super Admin | P0 | Endpoint write tidak dapat dipakai tanpa auth yang sah |
| FR-02 | Setup | Satu game; 2–10 tim, warna/urutan, poin challenge per kotak; Mulai bermain | P0 | Preflight/Start tetap divalidasi server; pengaturan terkunci setelah mulai; editor/impor board tersedia pada URL lama |
| FR-03 | Movement | Input dadu fisik 1–6; round-robin | P0 | Tidak ada random roll digital dan giliran tidak melompat |
| FR-04 | Movement | Langkah 1–50, bounce, penalti Indisipliner | P0 | Path dihitung server; animasi kotak per kotak tanpa chain penalty |
| FR-05 | Scoring | BUTTON/SUCCESS atau FAIL untuk seluruh non-Indisipliner | P0 | Poin default / 0, persis satu hasil per turn |
| FR-06 | Scoring | MANUAL integer non-negatif dan limit backend | P0 | Poin yang masuk persis input; tidak menjumlahkan poin otomatis |
| FR-07 | Scoring | Aktivitas Action/Reward/Race Strength/Pit Stop eksternal | P0 | Tidak ada form jawaban/bukti, timer kegiatan, atau validasi narasi Reward |
| FR-08 | Scoring | Penanganan khusus Origami kotak 26 | P0 | Default manual, 5 poin/unit sebagai panduan, BUTTON tetap tersedia |
| FR-09 | Leaderboard | Skor dan ranking realtime dari authoritative server | P0 | Ranking mengikuti total poin, seri juara tetap diperbolehkan |
| FR-10 | Lifecycle | Start/pause/resume/finish manual | P0 | Tidak auto-finish; tidak finish saat hasil poin pending |
| FR-11 | Concurrent admin | Active Controller, lease, takeover, scoring multi-admin | P0 | Hanya satu roll sah; satu hasil poin/turn; takeover diaudit |
| FR-12 | Consistency | Row locks, idempotency, immutable ledger, event outbox | P0 | Retry/concurrent request tidak menyebabkan efek ganda |
| FR-13 | Sync | Socket.IO, snapshot, sequence recovery dan reconnect | P0 | Posisi/turn/score tetap benar setelah network interruption |
| FR-14 | Display | Grid 5×10 zigzag warna kategori; tampilan 2.5D | P0 | Semua 50 kotak terlihat pada resolusi venue tanpa pemilih mode |
| FR-15 | Display | Racing chip T1–T10, dark base, outline putih | P0 | Identitas dapat dibaca tanpa mengandalkan warna |
| FR-16 | Display | Token clustering ≤3 chip + indikator `+N` | P0 | 1–10 tim/kotak tidak menutupi nomor/label; total akurat |
| FR-17 | Display | Overlay token dan highlight lintasan di dalam board | P0 | Animasi langkah, bounce dan penalti tanpa teleport, crop atau perubahan geometri grid; tidak memakai HUD/breadcrumb eksternal |
| FR-18 | Display | Leaderboard di samping board | P0 | Kode, nama, posisi dan poin seluruh 2–10 tim tersedia; pembagian lebar konten board 70–75%, leaderboard 25–30% |
| FR-19 | Display | Komposisi publik minimal | P0 | Hanya judul, board dan leaderboard; tanpa HUD, tracker, occupancy panel, toolbar, legenda atau footer |
| FR-20 | Operasional display | Fullscreen/kiosk melalui browser/OS; reduced motion mengikuti OS | P1 | Panduan operator terpisah dari board; tidak ada toolbar atau audio otomatis pada board |
| FR-21 | Operasional | Corrections dengan alasan, history, audit dan ekspor CSV | P1 | Koreksi berupa ledger kompensasi dan dapat ditelusuri |
| FR-22 | Operasional | Board publik satu game, reset admin, isolasi sesi dan arsip | P1 | Tanpa pairing; publik hanya membaca game operasional; reset atomik/idempotent; arsip tidak dapat dimutasi |
| FR-23 | QA | Validasi LED venue nyata 1920×1080 dan jarak tonton | P0 | Nomor/kategori kotak, kode token dan leaderboard terbaca tanpa zoom; tiga permukaan visual tetap terjaga |

## 7. Spesifikasi antarmuka dan big-screen

### 7.1 Tata letak layar LED

Board publik `/` memuat tepat tiga permukaan: judul game, boardgame dan leaderboard.

- Pada LED 1920×1080 dan 1366×768, board memakai **70–75% lebar area konten**, leaderboard **25–30%**
  di sebelah kanan, di luar gap dan judul. Implementasi acuan 75:25.
- Board terdiri dari tepat 50 tile zigzag dan START=0 yang menyatu dengan canvas board. START bukan tile ke-51,
  bukan panel tambahan, dan tim pada posisi 0 tidak boleh digambar sebagai penghuni kotak 1.
- Tidak ada HUD, Team Position Tracker, Occupancy Panel, toolbar, legenda, breadcrumbs lintasan, maupun footer.
- Animasi token dan highlight lintasan tetap di dalam grid; semua 50 kotak terlihat, tanpa zoom/crop,
  perubahan ukuran/urutan tile, teleport, atau double marker.
- Acuan 16:9 memakai scale-to-fit tanpa horizontal scroll. Pada layar kecil di bawah 768 CSS px,
  leaderboard boleh berada di bawah board agar tetap terbaca; isi tetap hanya tiga permukaan tersebut.
- Saat loading/error sebelum snapshot pertama, grid 50 kotak tetap terlihat dengan preview template tanpa
  tim atau poin rekaan. Status koneksi disisipkan pada judul/ARIA; snapshot terakhir dipertahankan saat reconnect.

```text
┌────────────────────── JUDUL GAME ─────────────────────────────┐
├────────────────────────────────────────────┬───────────────────┤
│ BOARD 5×10 + START terintegrasi             │ LEADERBOARD       │
│ 70–75% · chip + animasi lintasan            │ 25–30%            │
└────────────────────────────────────────────┴───────────────────┘
```

### 7.2 Racing Token dan Adaptive Token Clustering

**Token utama adalah chip bundar 2.5D, bukan pion catur kecil.** Setiap tim memiliki kode **T1–T10** berdasarkan urutan tim tersimpan. Gunakan alas charcoal mendekati `#101827`, label kode putih tebal, outline putih, pinggiran gelap tipis, shadow terarah, dan rim warna tim sebagai aksen sekunder. Hanya token aktif yang diperbesar dengan halo/ring keemasan dan animasi terbatas.

| Penghuni satu kotak | Penampilan di tile | Informasi lengkap |
|---:|---|---|
| 0 | Tidak ada chip | — |
| 1 | 1 chip Tn | Leaderboard |
| 2–3 | 2–3 chip Tn dengan jarak teratur | Leaderboard |
| 4–10 | **Maksimal 3 chip Tn + `+N`**, dengan `N=total−3` | `N TIM` total + identitas seluruh tim di leaderboard |

- **`+N` adalah jumlah tim yang disembunyikan**, sedangkan `N TIM` adalah total penghuni. Contoh 10 tim → 3 chip + `+7` + label `10 TIM` (bukan 17 tim).
- Tiga chip ditentukan stabil menurut `sort_order`, lalu `id`, dengan prioritas chip active team bila berada di kotak tersebut.
- Nomor, kategori, dan nama kotak tidak boleh tertutup dock atau badge. Kategori selalu ditulis lengkap,
  termasuk di layar kecil, saat cluster dan saat gerakan. Jika sempit, tampilkan chip prioritas + total tim;
  jangan mengganti kategori dengan singkatan atau mengecilkan kode Tn menjadi tidak terbaca.
- Semua tim tetap menyimpan posisi masing-masing di database. **Cluster dan occupancy hanya representasi visual di React**, bukan objek game baru.
- Saat movement, token aktif dikeluarkan sementara dari cluster statis menuju **overlay**, bergerak satu kotak tiap langkah dan kembali ke cluster tujuan setelah landing. Occupancy animasi dihitung dari `visualPositions`, bukan lompat ke posisi akhir DB.

### 7.3 Informasi tim dan animasi pada komposisi minimal

- Leaderboard bersumber dari server, menampilkan kode/nama, posisi dan poin seluruh tim dengan tinggi baris stabil.
  Posisi 0 ditulis START. Nama panjang memakai pemotongan konsisten dan nama lengkap tetap dapat diakses
  melalui judul elemen serta halaman admin/scoreboard.
- Token aktif dibedakan dengan kode Tn, ukuran dan ring emas; lintasan normal, pantulan dan penalti ditandai
  langsung pada tile. Tidak ada panel atau teks lintasan di luar board.
- Nomor/kategori dan kode chip tidak tertutup token atau badge; jika sempit tampilkan chip aktif + total.
- Board memakai latar hitam/charcoal, strip kategori, bevel/shadow CSS dan chip logam tanpa memiringkan grid.
  Barlow Condensed lokal dipakai untuk judul/angka. Pada lebar ≥1600 CSS px: nomor 36 px, kategori 18 px,
  kode leaderboard 22 px, nama tim 20 px dan skor 32 px.
  Target baseline LED: nomor ≥22 px; kategori 16–18 px; kode chip pasif 18–20 px, token aktif lebih besar.
  Target kontras teks ≥4.5:1 dan grafis penting ≥3:1 tetap harus diuji pada perangkat/jarak venue.
- Input dadu, status rinci giliran dan penilaian tetap berada pada halaman kontrol admin.

### 7.4 Routes dan layar

| Route | Tujuan dan elemen wajib |
|---|---|
| `/login` | Email, password, error handling, logout |
| `/admin/games` | Satu halaman: tim, posisi/dadu, poin challenge, reset; Mulai bermain menjalankan preflight/Start |
| `/` | Board publik 50 kotak dan START; hanya judul, board 70–75% dan leaderboard 25–30% |
| `/leaderboard` | Ranking/poin game operasional, publik |
| `/final` | Pemenang/final ranking game operasional setelah FINISHED, publik |
| `/admin/games/:id/setup` | URL kompatibilitas: editor board/tim, impor/template dan preflight |
| `/admin/games/:id/control` | URL kompatibilitas: controller, dadu, skor, lifecycle dan void terakhir |
| `/admin/games/:id/scoreboard` | URL kompatibilitas: leaderboard dan ringkasan hasil |
| `/admin/games/:id/history` | URL kompatibilitas: histori/filter, audit, koreksi dan CSV; arsip hanya baca |
| `/admin/games/:id/displays`, `/admin/games/:id/duplicate` | Redirect ke `/admin/games` |
| `/display/:id/*` | Redirect ke `/`, tanpa pairing atau pemilihan game |

Halaman utama admin memiliki empat bagian dengan tautan jangkar: tim, posisi pion, poin challenge, reset.
Setelan Sukses/default BUTTON atau MANUAL berbeda per kotak; Gagal tetap 0 dan input manual 0–200 saat penilaian.
Sidebar, katalog/arsip, pairing, controller teknis, editor seluruh board dan pause/finish/histori tidak menjadi
menu utama. Refresh sesi dipulihkan otomatis saat reload. Draft tidak ditimpa polling; konflik simpan meminta
muat ulang eksplisit. Field invalid pada kelompok terlipat dibuka sebelum fokus dipindahkan.
Retry hasil tidak pasti memakai key perintah yang sama. Kontrol write nonaktif saat offline, request berlangsung
atau hasil belum pasti. Rincian: [admin satu halaman](simple-admin.md). Navigasi per game dan disclosure audit
tetap digunakan pada URL kompatibilitas; mobile tidak boleh overflow halaman.

### 7.5 Perilaku animasi dan frontend

- `authoritativePositions` = state final dari server; `visualPositions` = representasi saat animasi dari `fullPath`, `startAt`, `stepDurationMs`.
  Selama fase STARTING sebelum `startAt`, pion tetap di `from`; contoh dadu 3 dari kotak 2 tampil 2 → 3 → 4 → 5,
  tanpa terlebih dahulu menggambar posisi akhir DB dan tanpa double marker.
- `occupancyVisual` dihitung murni dari `visualPositions`, deterministic berdasarkan snapshot/event. Tidak perlu tabel DB atau Socket.IO event khusus `occupancy_changed`.
- Gunakan `React.memo`/selector per cell dan scheduler timeline/CSS untuk menggerakkan overlay saja,
  bukan re-render 50 tile setiap frame; tidak menambahkan dependency animasi baru.
- Reconnect saat movement memulihkan posisi visual sesuai waktu server. Ketika offline, seluruh tombol write admin nonaktif; display mengumumkan penggunaan last confirmed state.
- Board tidak memutar audio otomatis dan tidak menampilkan pengaturan. Fullscreen/kiosk dan pencegahan screen sleep diatur melalui browser/OS mengikuti panduan operator; reduced motion mengikuti preferensi OS.
- Aset gambar atau mockup merupakan referensi artistik. Logo resmi diambil dari file panitia; angka demo dan tim dalam mockup bukan kebenaran game.

### 7.6 Component contract

| Component React | Input utama | Perilaku |
|---|---|---|
| `RaceBoard` | `view` dari `buildBoardView` | Grid 5×10, START, cluster dan overlay |
| `BoardCell` | `cell` berisi occupancy/highlight, `activeTeamId` | Nomor/kategori lengkap terlihat; dock tidak overflow |
| `RacingToken` / `RacingChip` | Tim dan status aktif | Chip Tn 2.5D; varian aktif lebih besar |
| `TokenCluster` | `occupants`, `chips`, `hidden`, `count`, `activeTeamId`, `cellNumber` | Maks 3 chip dan `+N` sesuai occupancy |
| `MovementOverlay` | `timeline`, `team`, `cells` | Satu langkah/kotak dengan bounce dan penalti |
| `LeaderboardPanel` | `leaderboard`, `activeTeamId` | Ranking backend, kode/nama/posisi/poin |

## 8. Arsitektur dan struktur kode

```text
[Super Admin A / Super Admin B / Super Admin C]    [Display board / leaderboard]
             | HTTPS REST + WSS                               |
             +----------------------+-------------------------+
                                    |
                            [Reverse Proxy/TLS]
                                    |
                       [Node.js + Express + Socket.IO]
                                    |
         +--------------------------+------------------------+
         |                          |                        |
     [Auth/RBAC]              [Game Engine]           [Realtime Gateway]
         |                          |                        |
         +---------------[Sequelize ORM]---------------------+
                                    |
                              [MySQL/InnoDB]
                         (state, ledger, event log,
                           command log, outbox)
```

**Deployment awal:** satu instance API Node.js yang persisten dengan HTTP Upgrade/WebSocket didukung, dan satu database MySQL terkelola/persisten. **Jangan** mengasumsikan serverless function biasa dapat mempertahankan Socket.IO connections jangka panjang.

**Scaling multi-instance:** jika Node.js berjalan dalam beberapa instance, gunakan Socket.IO adapter lintas instance (mis. Redis adapter) dan konfigurasi sticky session bila HTTP long-polling diaktifkan. MySQL tetap authoritative. Redis **tidak wajib** dalam deployment satu instance. Referensi resmi: [Socket.IO Rooms](https://socket.io/docs/v4/rooms/), [Adapters](https://socket.io/docs/v4/adapter), [Redis adapter](https://socket.io/docs/v4/redis-adapter).

### 8.1 Frontend stack

React + JavaScript/JSX + Vite; React Router; Zustand untuk state transien UI, TanStack Query untuk server state,
Socket.IO Client untuk notifikasi, CSS transitions dan scheduler timeline untuk animasi langkah.
Board 2.5D memakai CSS Grid dan overlay pada tile langkah aktif. Tidak ada dependency Motion atau TypeScript.
Zustand dan Socket.IO message tidak menggantikan snapshot server. Pin runtime/library mengikuti manifest dan ADR-001.

- Gunakan functional components, satu komponen per file dengan nama file `PascalCase`.
- Komponen menangani rendering dan state UI lokal. Business logic, transformasi data, API calls, dan side effects
  berada di custom hooks `useXxx`, service functions, atau API layer; tidak di komponen/JSX.
- Fetching melalui hooks/API layer dengan TanStack Query harus menangani loading, error, success, dan deduplikasi
  request konkuren. Lifecycle Socket.IO, buffer/dedup event, recovery, dan cleanup berada di hooks/service.
- Hindari prop drilling lebih dari tiga level. Context hanya untuk state global (mis. auth/theme) yang dibagikan
  ke tiga atau lebih komponen; state UI lokal tetap lokal dan server state tetap dikelola TanStack Query.

### 8.2 Backend stack

Node.js LTS (pin versi yang diuji), Express, Sequelize (pin major version dan migration strategy), MySQL 8.x InnoDB,
Socket.IO, library validation schema (mis. Zod), job runner ringan untuk outbox/turn expiry, dan Winston untuk logging.
Service-layer bersifat domain-scoped: auth, game, turn, challenge, score, dan audit; `MovementEngine` adalah fungsi
domain murni di server. Realtime publisher menangani distribusi event setelah commit.

- Validasi external input di boundary (HTTP, Socket.IO, konfigurasi environment, import file) sebelum operasi bisnis.
  Invariant domain tetap ditegakkan service untuk pemanggil HTTP, jobs, dan command lain.
- Controller hanya menangani request/response, menerima input tervalidasi, dan mendelegasikan ke service.
  Controller tidak mengakses model atau menjalankan transformasi/business branching; gunakan `try/catch` dengan
  `next(error)` kecuali sudah memakai centralized async wrapper.
- Service memuat business logic, authorization decisions, transformasi, dan transaksi; tidak bergantung pada
  Express `req/res/next` atau mengirim response HTTP. Service boleh mengakses Sequelize models langsung;
  repository opsional untuk query/scoping, tanpa business workflow. Service tidak memanggil service domain
  yang tidak terkait; hindari dependensi melingkar dan tempatkan workflow atomik pada service penanggung jawabnya.
- Model hanya mendefinisikan schema, associations, indeks, dan persistence constraints; tanpa kalkulasi atau
  business branching, termasuk melalui hooks. Seluruh multi-step write yang melibatkan dua atau lebih tabel
  wajib memakai transaksi.
- Sequelize ORM adalah default. Raw SQL hanya jika ORM tidak mengekspresikan query secara efisien, wajib
  parameterized dan disertai alasan melalui JSDoc/komentar. Gunakan `camelCase` untuk variabel, fungsi, dan
  resource files; `PascalCase` untuk classes; `snake_case` untuk kolom DB.

### 8.3 Struktur repositori

Struktur source yang digunakan aplikasi (bukan scaffold baru yang perlu dibuat):

```text
repo/
├── frontend/                       # React + JavaScript/JSX + Vite
│   ├── public/fonts/               # font lokal dan lisensi
│   └── src/
│       ├── App.jsx                 # public routes dan AdminAccess
│       ├── pages/
│       ├── components/             # SimpleGameAdmin, RaceBoard, scoring
│       ├── hooks/
│       ├── services/
│       ├── stores/
│       └── __tests__/
├── backend/                        # Node.js + Express + Socket.IO
│   ├── migrations/                 # migrations additive; bukan src/migrations
│   └── src/
│       ├── app.js
│       ├── server.js
│       ├── cli/                    # bootstrap akun admin
│       ├── config/
│       ├── data/                   # transkripsi template PRD 50 kotak
│       ├── models/                 # schema, associations, persistence constraints
│       ├── routes/
│       ├── controllers/            # HTTP request/response only
│       ├── middleware/             # auth, RBAC, validation, idempotency, centralized errors
│       ├── services/               # workflow, transaksi, movementWorker dan outboxPublisher
│       ├── domain/                 # movement.js, scoring.js, csvExport.js
│       ├── realtime/               # Socket.IO rooms, publisher
│       ├── validation/
│       ├── logs/                   # Winston daily rotation; runtime output, tidak di-commit
│       └── tests/
├── scripts/                        # dev, seed demo, smoke, backup/restore
├── e2e/
├── deploy/
├── tasks/
└── docs/
```

Source JavaScript/JSX memakai indentasi 2 spasi, statement semicolons, panjang baris maksimal 120 karakter,
dan ESLint tanpa local override kecuali diwajibkan secara eksplisit. JSDoc mengikuti kriteria pada general rules.

## 9. Model data dan integritas

UUID memakai `CHAR(36)` ASCII/ascii_bin sesuai ADR-003. Timestamp relevan memakai UTC `DATETIME(3)`,
ditampilkan WIB. Engine InnoDB, foreign key aktif dan migration additive;
tidak menggunakan `sequelize.sync({ alter: true })` di production.

Setiap model wajib mendefinisikan data types dan `allowNull` secara eksplisit, serta default yang diperlukan.
Semua foreign key wajib diindeks; field business-unique memakai `unique: true`, kecuali memakai composite unique
constraint yang dinyatakan pada tabel berikut.

| Table | Primary fields | Constraints/indeks penting |
|---|---|---|
| `users` | `id`, `email`, `password_hash`, `role=SUPER_ADMIN`, `is_active`, `last_login_at` | `UNIQUE(email)` |
| `games` | `id`, `name`, `status`, `current_team_id`, `active_turn_id`, `turn_number`, `state_version`, `event_sequence`, `started_at`, `finished_at`, `finished_by` | index `status`; optimistic `state_version` |
| `teams` | `id`, `game_id`, `name`, `sort_order`, `color`, `position` default 0, `total_score` default 0 | `UNIQUE(game_id,sort_order)`, `UNIQUE(game_id,name)`, CHECK position 0–50 app validation |
| `board_cells` | `id`, `game_id`, `number`, `category`, `title`, `instruction` nullable, `backup_text` nullable, `duration_text` nullable, `success_points`, `allow_manual_points`, `default_scoring_method`, `points_per_unit` nullable, `penalty_steps` | `UNIQUE(game_id,number)`; `default_scoring_method ∈ {BUTTON,MANUAL}`; manual tersedia untuk semua non-Indisipliner; field referensi aktivitas tidak menjadi syarat scoring |
| `turns` | `id`, `game_id`, `turn_number`, `team_id`, `dice_value`, `from_position`, `landing_cell`, `final_position`, `status`, `movement_started_at`, `movement_ends_at`, `resolved_at` | `UNIQUE(game_id,turn_number)` |
| `challenge_results` | `id`, `game_id`, `turn_id`, `board_cell_id`, `team_id`, `scoring_method`, `outcome` nullable, `manual_points` nullable, `awarded_points`, `note` nullable, `judged_by`, `judged_at` | `UNIQUE(turn_id)`; `scoring_method ∈ {BUTTON,MANUAL}`; field sesuai mode |
| `score_ledger` | `id`, `game_id`, `team_id`, `turn_id` nullable, `delta_points`, `source`, `reason`, `actor_user_id`, `compensates_entry_id` nullable | index `(game_id,team_id,created_at)`; `source ∈ {CHALLENGE_BUTTON,CHALLENGE_MANUAL,CORRECTION}` |
| `game_events` | `id`, `game_id`, `sequence`, `type`, `payload_json`, `actor_user_id`, `occurred_at` | `UNIQUE(game_id,sequence)`; source for gap recovery |
| `command_log` | `id`, `game_id`, `idempotency_key`, `actor_user_id`, `command_type`, `request_hash`, `status`, `response_json` | `UNIQUE(game_id,idempotency_key)` |
| `outbox_events` | `id`, `game_id`, `game_event_id`, `published_at`, `attempt_count`, `next_attempt_at` | `UNIQUE(game_event_id)` |
| `controller_leases` | `game_id` PK, `holder_user_id`, `lease_token_hash`, `expires_at`, `version` | satu controller/game, CAS atau row lock |
| `display_tokens` | `id`, `game_id`, `token_hash`, `expires_at`, `revoked_at`, `label` | kompatibilitas session lama; read-only satu game, arsip ditolak; bukan syarat board publik |
| `final_results` | `id`, `game_id`, `team_id`, `score`, `position`, `rank`, `is_winner` | `UNIQUE(game_id,team_id)` |
| `single_game` | singleton `id=1`, `game_id` | satu pointer game operasional; FK/unique game |
| `game_archives` | `game_id`, `next_game_id`, `archived_by`, `archived_at` | sesi lama hanya baca; FK ke game pengganti dan admin; unique next_game_id |

### 9.1 Invariant dan indeks

- `board_cells` harus seed **tepat 50 per game**, tidak boleh ada celah/duplikasi pada status READY. **Field instruksi, cadangan, dan durasi boleh null/teks naratif** untuk kategori non-Indisipliner; preflight **tidak memeriksa actionable-ness** isi aktivitas.
- `turns` dan `game_events` selalu query dengan `game_id` untuk isolasi antar-game.
- `BUTTON/FAIL` dan `MANUAL/points=0` tetap menghasilkan satu `challenge_results` dengan `awarded_points=0`, tetapi tidak menambah entri `score_ledger`.
- `BUTTON` mewajibkan `outcome ∈ {SUCCESS,FAIL}` dan `manual_points IS NULL`; `MANUAL` mewajibkan `outcome IS NULL` dan `manual_points = awarded_points` integer ≥ 0. `success_points` sumber diambil server hanya untuk BUTTON/SUCCESS.
- `board_cells.default_scoring_method` hanya pilihan default UI, **bukan** pembatas jenis penilaian; pada cell 26 default `MANUAL`, `points_per_unit=5`, dan `success_points=5` (interpretasi satu origami untuk tombol Sukses).
- `game_events.sequence` bertambah monoton **per game** di dalam transaction lock baris game.
- `total_score` selalu diselaraskan dengan SUM(`score_ledger.delta_points`) melalui invariant test dan audit.

### 9.2 Checklist invariant backend

- `game.state_version` increases after every committed business mutation.
- `game.event_sequence` is strictly increasing and unique per game.
- `teams.position` stays inside `[0,50]`.
- `teams.total_score` equals sum of approved `score_ledger.delta_points`.
- One `challenge_results` record maximum per turn; `BUTTON/FAIL` awards 0, `MANUAL` awards precisely submitted valid points; both methods cannot coexist on one turn.
- `BUTTON` requires outcome SUCCESS/FAIL and rejects `points`; `MANUAL` requires `points` and rejects outcome; manual `outcome` stored NULL.
- Kotak 26 uses MANUAL by default with 5-point-per-origami guidance, while BUTTON remains an available alternative. Semua penentuan jumlah origami/hasil dilakukan panitia di luar aplikasi.
- All score-changing results and any correction use audited ledger entries; no automatic success_points is added to manual points.
- All game-effect commands require server authorization, input validation, idempotency, and transaction.
- Publish event only after transaction commit; clients never assume Socket.IO broadcast is authoritative.
- Roll dice input must be an integer 1–6; dice remains physical.
- `FINISHED` cannot be reached automatically; only confirmed Super Admin action.
- Winner(s) decided exclusively by highest finalized score; track position independently.

## 10. Kontrak REST API

API admin membutuhkan bearer access token; auth mengikuti kontrak login/refresh/logout. Endpoint GET
`/api/v1/public/*` tidak membutuhkan login/pairing dan hanya membaca game operasional. Command domain game
membutuhkan header `Idempotency-Key: <uuid>`. Login/refresh/logout dan exchange/sync session lama memakai
lifecycle credential sendiri tanpa generic command receipt. Response JSON sukses memakai `{success:true,data,meta?}`;
metadata seperti `serverTime`,
`stateVersion`, `eventSequence`, dan `requestId` berada di `meta` bila relevan, bukan field top-level.
`X-Request-Id` dikirim sebagai header response untuk pelacakan, termasuk pada error. Parameter `gameId` divalidasi
di setiap request. Ekspor CSV tetap memakai content type CSV; envelope ini berlaku untuk response JSON.

| Method / Endpoint | Aksi | Validasi utama |
|---|---|---|
| `POST /api/v1/auth/login` | Autentikasi Super Admin | rate-limit, password hash |
| `POST /api/v1/auth/refresh` | Rotasi refresh token | invalid/reused token ditolak |
| `POST /api/v1/auth/logout` | Logout/revoke | revoke session |
| `GET /api/v1/auth/me` | Identitas/sesi admin terkini | bearer sah; read-only, tidak memperpanjang expiry |
| `GET /api/v1/public/game` | Snapshot game operasional atau preview template | tanpa credential; tanpa data privat |
| `GET /api/v1/public/games/:id/snapshot` | Snapshot publik | hanya game operasional; ID lain 404 |
| `GET /api/v1/public/games/:id/events?afterSequence=N` | Replay invalidasi publik | hanya game operasional; payload kosong |
| `POST /api/v1/games/current` | Inisialisasi/klaim satu game | SUPER_ADMIN; `{name}`; UUID key; concurrent request memakai game yang sama |
| `POST /api/v1/games/:id/reset` | Arsipkan dan buka sesi DRAFT pengganti | SUPER_ADMIN; `{expectedStateVersion,confirmed:true}`; tanpa animasi aktif |
| `GET /api/v1/games/archives?page=1&limit=20` | Metadata arsip terpagina | SUPER_ADMIN; arsip hanya baca |
| `GET /api/v1/games` | Katalog API kompatibilitas; bukan UI pemilihan game | SUPER_ADMIN |
| `POST /api/v1/games` | Buat DRAFT melalui API kompatibilitas; tidak mengganti game publik | SUPER_ADMIN |
| `GET /api/v1/games/templates/prd-appendix-a-v1` | Template PRD 50 kotak | SUPER_ADMIN; belum direkonsiliasi workbook |
| `POST /api/v1/games/:id/board-template` | Terapkan template pada URL setup kompatibilitas | DRAFT/READY; versi terkini |
| `POST /api/v1/games/:id/board-import` | Impor JSON board versi 1 | DRAFT/READY; atomik, tanpa ID/progres |
| `POST /api/v1/games/:id/duplicate` | API duplikasi kompatibilitas | konfigurasi saja ke DRAFT baru; tidak mengganti pointer publik |
| `GET /api/v1/games/:id/snapshot` | Posisi, skor, turn, active movement, version | admin atau scoped display token |
| `PUT /api/v1/games/:id/setup` | Upsert tim/config cells | hanya DRAFT/READY; optimistic concurrency |
| `POST /api/v1/games/:id/validate` | Preflight 50 cells, 2–10 teams, kategori, poin/punishment, turn order | tidak meminta instruksi/aktivitas Reward; hanya data yang diperlukan engine/scoring menjadi blocking |
| `POST /api/v1/games/:id/start` | Start game | READY, valid configuration |
| `POST /api/v1/games/:id/pause` | Pause | RUNNING, no active movement |
| `POST /api/v1/games/:id/resume` | Resume | PAUSED |
| `POST /api/v1/games/:id/controller/acquire` | Claim controller | lease free/expired |
| `POST /api/v1/games/:id/controller/heartbeat` | Perpanjang lease | valid lease token |
| `POST /api/v1/games/:id/controller/take-over` | Paksa ambil alih | explicit confirmation + audit |
| `POST /api/v1/games/:id/turns/roll` | Input dadu 1–6 | current turn READY, active controller, idempotency |
| `POST /api/v1/games/:id/turns/:turnId/result` | Submit hasil `BUTTON` **atau** `MANUAL` | validasi mode, poin, AWAITING_RESULT; once only |
| `POST /api/v1/games/:id/turns/:turnId/void` | Batalkan roll terakhir yang eligible pada URL kontrol kompatibilitas | reason, confirmed:true, versi terkini; tanpa animasi; kompensasi diaudit; SPEC §4.6 |
| `GET /api/v1/games/:id/leaderboard` | Sort score | server computed |
| `GET /api/v1/games/:id/events?afterSequence=N` | Replay events/gap | paginated and authorized |
| `GET /api/v1/games/:id/history` | Histori giliran/ledger/audit | SUPER_ADMIN; filter type/teamId, limit/offset; arsip hanya baca |
| `POST /api/v1/games/:id/corrections` | Koreksi audited | RUNNING/PAUSED non-arsip; tanpa animasi; delta integer bukan nol −1000…1000, total ≥0; alasan/konfirmasi/versi |
| `POST /api/v1/games/:id/finish` | Finish manual | tanpa turn pending; confirmed:true dan expectedStateVersion |
| `GET /api/v1/games/:id/results` | Hasil final | FINISHED |
| `GET /api/v1/games/:id/export.csv` | Export result | SUPER_ADMIN |
| `POST /api/v1/games/:id/display-tokens` | Kompatibilitas API pairing lama; bukan alur UI | SUPER_ADMIN; scope/expiry/revocation tetap wajib |

API katalog, duplikasi dan session display lama dipertahankan untuk kompatibilitas; tidak memilih atau
mengganti pointer game publik. Cookie display lama ditolak untuk arsip. Histori/CSV arsip hanya untuk admin;
mutasi arsip ditolak. Daftar endpoint pairing lengkap tetap dicatat di SPEC §8.3 dan ADR-002.

### 10.1 Contoh `POST turns/roll`

```json
{
  "diceValue": 3,
  "expectedTurnNumber": 12,
  "expectedStateVersion": 58,
  "controllerLeaseToken": "opaque-lease-token"
}
```

Response contoh (simulasi, bukan data live):

```json
{
  "success": true,
  "data": {
    "turnId": "turn-uuid",
    "teamId": "team-a",
    "diceValue": 3,
    "from": 14,
    "dicePath": [15, 16, 17],
    "penaltyPath": [16, 15, 14, 13, 12],
    "fullPath": [15, 16, 17, 16, 15, 14, 13, 12],
    "landingCell": 17,
    "finalPosition": 12,
    "requiresChallenge": false,
    "movementStartsAt": "2026-11-09T08:00:00.400Z",
    "movementEndsAt": "2026-11-09T08:00:04.000Z"
  },
  "meta": {
    "stateVersion": 59,
    "eventSequence": 105,
    "serverTime": "2026-11-09T08:00:00.000Z",
    "requestId": "request-uuid"
  }
}
```

### 10.2 `POST turns/:turnId/result` — kontrak dua metode

Endpoint ini **hanya mencatat poin yang diberikan panitia di luar aplikasi**. Tidak menerima `answer`, `evidence`, `challengeStatus`, `taskCompletedAt`, atau `rewardClaim` sebagai input; backend tidak mengecek performa peserta maupun teks instruksi Reward. Hanya `BUTTON` atau `MANUAL` pada `AWAITING_RESULT` yang valid.

**Metode BUTTON — Sukses:**

```json
{
  "scoringMethod": "BUTTON",
  "outcome": "SUCCESS",
  "expectedStateVersion": 60
}
```

**Metode BUTTON — Gagal:** `{"scoringMethod":"BUTTON","outcome":"FAIL","expectedStateVersion":60}`. Backend menetapkan `awardedPoints=0`.

**Metode MANUAL — Input Poin (contoh kotak 26, empat origami):**

```json
{
  "scoringMethod": "MANUAL",
  "points": 20,
  "note": "4 origami berhasil x 5 poin",
  "expectedStateVersion": 60
}
```

**Validasi mutually exclusive:** Untuk `BUTTON`, `outcome` wajib `SUCCESS|FAIL` dan field `points` **tidak boleh dikirim**. Untuk `MANUAL`, `points` wajib angka bulat valid (0 diperbolehkan), sedangkan `outcome` **tidak boleh dikirim**. Kombinasi/mode invalid menghasilkan `400 VALIDATION_ERROR`. Header `Idempotency-Key` wajib untuk kedua metode. Response memakai `success:true`, dengan `turnId, scoringMethod, outcome|null, awardedPoints, newTotalScore` di `data` dan `stateVersion, eventSequence, serverTime, requestId` di `meta`. Server menghitung poin BUTTON dari konfigurasi kotak; MANUAL menggunakan tepat angka `points` setelah validasi, tanpa bonus poin otomatis.

**Contoh nilai:** Kotak 44 mempunyai `success_points=50`: BUTTON/SUCCESS memberi 50; BUTTON/FAIL memberi 0; MANUAL/points=35 memberi **35**, tidak 85. Setelah salah satu metode disimpan, method lain ditolak untuk turn yang sama (`409 ALREADY_RESOLVED`) dan harus menggunakan workflow koreksi.

### 10.3 Format error API

`400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 STALE_STATE | TURN_NOT_READY | DUPLICATE_ACTION | ALREADY_RESOLVED | CONTROLLER_NOT_HELD | PENDING_RESULT`, `423 GAME_PAUSED`, `429 RATE_LIMITED`, `500 INTERNAL_ERROR`.

Semua error HTTP ditangani centralized error middleware dengan body:

```json
{
  "success": false,
  "error": {
    "code": "STALE_STATE",
    "message": "State game telah berubah. Muat ulang snapshot."
  }
}
```

Stack trace dan contextual metadata hanya untuk log internal; jangan diekspos ke client. Request ID tersedia
melalui header `X-Request-Id`. Admin client pada 409 harus re-fetch snapshot untuk state dan version terbaru,
**bukan** mencoba menerapkan posisi lokal. Envelope Socket.IO tetap mengikuti Bagian 11.

## 11. Kontrak realtime Socket.IO

### 11.1 Koneksi, room, dan otorisasi

- Socket admin menggunakan access token terverifikasi. Socket publik memakai `{gameId,public:true}` tanpa
  pairing, dibatasi ke game operasional pada handshake, join, scan berkala dan setiap emit. Event publik
  hanya invalidasi dengan payload kosong; client mengambil snapshot publik. Session display lama tetap
  diverifikasi server pada jalur kompatibilitas.
- Client `game:join` dengan `gameId`, server melakukan cek izin sebelum `socket.join('game:' + gameId)`.
- Setelah join berhasil, client fetch snapshot via REST dan `GET /events?afterSequence=...` agar tidak ada gap di antara subscribe dan initial load. Client melakukan buffer event yang datang sampai snapshot terpasang, lalu sort/deduplikasi berdasar `sequence`.
- Client otomatis reconnect; sesudah reconnect, ulangi authorization + snapshot/gap recovery.

### 11.2 Server → Client

Tabel payload lengkap berikut untuk admin/session kompatibilitas yang sah. Pada socket/replay publik,
jenis dan envelope event tetap sama tetapi `payload={}`; board mengambil snapshot publik aman.

| Event | Isi minimal | Trigger |
|---|---|---|
| `game:state_changed` | `gameId,sequence,stateVersion,status,currentTeamId,turnStatus` | start, pause, resume, next turn |
| `game:movement_started` | `sequence,turnId,teamId,from,dicePath,penaltyPath,fullPath,finalPosition,startAt,endAt,stepDurationMs` | roll committed |
| `game:challenge_pending` | `sequence,turnId,cellNumber,category,title,successPoints,allowedMethods:[BUTTON,MANUAL],defaultMethod,pointsPerUnit?,instruction?` | movement selesai non-Indisipliner; **artinya input poin admin pending**, bukan challenge dijalankan di app; `instruction` opsional |
| `game:challenge_resolved` | `sequence,turnId,teamId,scoringMethod,outcome|null,awardedPoints,newTotalScore` | score committed |
| `game:leaderboard_updated` | `sequence,teams[],version` | score change/correction |
| `game:controller_changed` | `sequence,holderUserId,expiresAt` | controller claim/expire/takeover |
| `game:finished` | `sequence,finishedAt,winners[],results[]` | manual finish |
| `game:correction_applied` | `sequence,reason,affectedTeamId,newStateVersion` | corrected |

Semua event mempunyai envelope `{eventId,gameId,sequence,stateVersion,occurredAt,payload}`. Client mengabaikan event dengan sequence sudah diterapkan dan meminta recovery jika sequence melompat. Tidak boleh ada client-to-client event yang langsung mengubah game state.

### 11.3 Jaminan pengiriman

Socket.IO melakukan reconnect, namun realtime message **bukan transactional event store**. Karena itu game event ditulis ke MySQL dan melalui `outbox_events` dipublikasi **setelah commit**; publisher boleh retry. Duplicate broadcast ditoleransi dengan dedup `eventId/sequence`. Tidak menjanjikan exactly-once network delivery; yang dijamin adalah **exactly-once business effect** melalui idempotent command + database transaction.

## 12. Concurrency, transaksi, dan idempotency

### 12.1 Transaksi kritis: roll

1. Parse dan validasi input; auth role dan scoped game.
2. Buka Sequelize managed transaction; konsisten lock ordering: `games` row `FOR UPDATE`, lalu `turns`/`teams`.
3. Cek command log `idempotency_key`; jika sukses sebelumnya, return hasil tersimpan tanpa mutasi.
4. Periksa game RUNNING; active controller valid; expected turn dan stateVersion cocok; tidak ada animasi/challenge pending.
5. Hitung `dicePath`, landing cell, penaltyPath, final position di **MovementEngine server-side**, bukan di browser.
6. Insert `turns`/update turn, update `teams.position`, increment `games.state_version` dan `games.event_sequence`.
7. Insert `game_events`, `outbox_events`, dan `command_log` dalam transaksi sama.
8. Commit; publisher memancarkan event ke Socket.IO room.
9. Return payload sudah tersimpan, sehingga refresh tidak menggandakan roll.

### 12.2 Transaksi kritis: input hasil poin

1. Lock game row dan turn aktif.
2. Validasi status `AWAITING_RESULT`, turn ID, idempotency, dan pastikan `challenge_results.turn_id` belum ada; lock game+turn+team.
3. Validasi satu `scoringMethod`: `BUTTON` (hanya outcome SUCCESS/FAIL; skor dari `success_points` atau 0) atau `MANUAL` (hanya `points` integer ≥ 0 dan ≤ batas server; skor persis input). Tolak kedua metode digabungkan. **Tidak memeriksa bukti, jawaban, instruksi, durasi, atau kualitas aktivitas di luar aplikasi.**
4. Simpan `challenge_results` dengan `scoring_method`, `outcome` nullable, `manual_points` nullable, `awarded_points`, dan actor. Jika poin > 0 insert satu `score_ledger` dengan `source` sesuai metode dan update `teams.total_score` atomik; poin 0 tanpa delta ledger.
5. Mark turn complete; otomatis maju ke tim berikutnya; write `game_events` + `outbox` + `command_log`.
6. Commit; publish challenge result (`scoringMethod` dan `awardedPoints`), leaderboard, next turn state.

### 12.3 Perlindungan transaksi

- `UNIQUE(turn_id)` pada challenge result mencegah submit BUTTON dan MANUAL pada satu turn; `UNIQUE(game_id,idempotency_key)` pada command log mencegah retry ganda; `UNIQUE(game_id,turn_number)` pada turn.
- Pengecekan hanya di frontend tidak cukup; semua perintah penting diverifikasi ulang di server.
- Deadlock/lock timeout MySQL perlu retry terbatas untuk transaksi idempotent, dengan jitter, lalu respons error transparan.
- Gunakan Sequelize **managed transactions** dan row lock. Referensi: [Sequelize Transactions](https://sequelize.org/docs/v6/other-topics/transactions/) dan [MySQL InnoDB Locking Reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html).
- Jangan emit Socket.IO sebelum commit. Pakai outbox durable supaya crash di antara commit dan emit tetap dapat dipulihkan.

## 13. Autentikasi dan keamanan

- Password menggunakan Argon2id atau bcrypt cost memadai; tidak pernah plaintext.
- HTTPS/WSS wajib; cookie refresh token `HttpOnly`, `Secure`, `SameSite` disetel sesuai domain; access token short-lived, refresh rotasi dan revocation.
- CORS allowlist spesifik domain; CSRF protection bila memakai cookie authentication untuk write API.
- Input poin manual divalidasi **ulang di backend** dengan angka integer aman ≥ 0 dan batas server, tidak boleh dibaca dari UI semata. Poin besar memerlukan konfirmasi eksplisit di frontend; setiap aksi manual tercatat actor, timestamp, metode, nilai, dan note.
- Express security middleware: `helmet`, rate limit login/pairing dan write-sensitive endpoints, schema validation untuk semua body/query, limit payload, `requestId` untuk trace.
- Sequelize parameter binding, jangan raw SQL concatenation; least privilege DB user.
- Semua endpoint admin harus memeriksa `SUPER_ADMIN` di server; akses publik hanya GET dan socket game
  operasional dengan DTO aman. Token display lama tetap read-only, scoped, memiliki expiry/revocation;
  penerbitannya hanya melalui API kompatibilitas, tanpa UI pairing.
- Credential controller/admin tidak dikirim ke publik. **Token sensitif jangan dicetak pada layar LED**,
  disimpan permanen dalam URL publik/analytics log, atau dimasukkan ke snapshot/replay publik.
- Audit entries menyimpan `actor_id`, IP secara terbatas, action, before/after ringkas, reason koreksi, request ID, timestamp.
- Aplikasi tidak boleh menampilkan password/token rahasia pada audit logs atau Socket event payload.

## 14. Reliability dan deployment

### 14.1 Pemulihan dari disconnect

- Display mempertahankan snapshot terakhir dan mengumumkan koneksi terputus pada judul/ARIA, tanpa banner tambahan; display tetap read-only.
- Admin write buttons disabled saat disconnected. **Jangan** melakukan optimistic movement secara offline.
- Setelah koneksi pulih, subscribe room, ambil snapshot dengan `stateVersion/eventSequence`, fetch event gap, reconcile active motion dan leaderboard.
- Jika server restart pada animasi, persisted `movementEndsAt` menentukan apakah harus catch-up atau finalize. Scheduled expiry bersifat idempotent.

### 14.2 Kesiapan operasional produksi

- Infrastruktur berisi Node server persistent, MySQL persistent, TLS reverse proxy, backup otomatis, environment variables rahasia, dan log/metrics.
- Winston menulis JSON logs berisi `level`, `message`, `timestamp` ke `backend/src/logs/` (direktori `/src/logs/`
  pada aplikasi backend), dengan daily rotation. Catat semua error pada level `error`, external API calls beserta
  endpoint/latency, awal/akhir/kegagalan transaksi, dan critical flows pada level `info`; rahasia tetap direduksi.
  `console.log` dilarang kecuali untuk diagnostik startup server.
- Healthcheck `/health/live` dan `/health/ready` (DB connectivity + event publisher readiness).
- Rolling deploy jangan mengubah schema/event contract tanpa versi dan compatibility test.
- Deployment awal single-node cukup untuk skala 2–10 tim; gunakan Redis adapter jika backend instance >1. Untuk Socket.IO multi-server, sticky sessions dibutuhkan saat long-polling aktif.
- Lakukan backup sebelum event, rehearsal dengan 10 tim, 5 admin, 3 display, internet utama & cadangan, serta uji reconnect.
- Untuk perubahan aturan saat RUNNING, v1 disarankan **read-only**; perubahan hanya lewat prosedur koreksi dengan audit.

## 15. Acceptance criteria dan pengujian

| ID | Scenario | Expected result |
|---|---|---|
| AT-01 | Setup hanya 1 atau 11 tim | Ditolak; 2–10 wajib |
| AT-02 | Duplicate nomor cell / hanya 49 cell | Preflight gagal; start disabled |
| AT-03 | 10 tim mulai dari START (posisi 0) | Semua token tampil, giliran tim pertama |
| AT-04 | Dari posisi 0 roll 3 | Path `[1,2,3]`, animasi step-by-step |
| AT-05 | Dari posisi 48 roll 4 | Path `[49,50,49,48]`, final 48 |
| AT-06 | Dari posisi 50 roll 3 | Path `[49,48,47]`, final 47 |
| AT-07 | Dari posisi 14 roll 3 (land 17) | Path `[15,16,17,16,15,14,13,12]`; minus 5 |
| AT-08 | Kotak 35 penalti −5 berakhir di 30 | Tidak memicu penalti kedua di kotak 30 |
| AT-09 | Metode BUTTON/SUCCESS (contoh cell 44) | +50 sesuai konfigurasi server/transkripsi Lampiran A; ledger 1 entry |
| AT-10 | Metode BUTTON/FAIL | +0, tetap 1 challenge result |
| AT-11 | Dua admin submit roll pada turn yang sama | Tepat satu business movement, response kedua 409 atau idempotent replay |
| AT-12 | Dua admin submit challenge result berbeda | Satu berhasil, yang lain 409; skor tidak double |
| AT-13 | Retry request dengan idempotency key sama | Hasil identik, tidak memutasi state baru |
| AT-14 | Board display reconnect selama animasi | Snapshot+active motion, lanjut atau sinkron ke final |
| AT-15 | Socket event duplikat atau out-of-order | Client dedup dan minta event gap |
| AT-16 | Admin klik roll saat animasi | 409 TURN_NOT_READY |
| AT-17 | Finish saat **input poin admin** pending | 409 PENDING_RESULT; tidak meminta menyelesaikan aktivitas melalui aplikasi |
| AT-18 | Finish setelah semua resolve | Final leaderboard snapshot, tidak bisa scoring lagi |
| AT-19 | Tim dengan posisi paling jauh punya skor lebih rendah | Pemenang tetap tim poin tertinggi |
| AT-20 | Seri poin tertinggi | Dua pemenang berbagi rank 1 (tidak tie-break diam-diam) |
| AT-21 | Publik tanpa bearer atau cookie display lama mencoba POST roll | Ditolak authorization; tidak ada mutasi; token display tidak memberi hak tulis |
| AT-22 | Roll tanpa controller lease | 409 CONTROLLER_NOT_HELD |
| AT-23 | Server mati setelah DB commit sebelum socket emit | Outbox retry; display pulih dari event log |
| AT-24 | Kotak 26 Origami, MANUAL 20 poin | +20; 1 challenge result dan 1 ledger `CHALLENGE_MANUAL` |
| AT-25 | Kotak 26 BUTTON/SUCCESS lalu BUTTON/FAIL (giliran berbeda) | +5 untuk SUCCESS, +0 untuk FAIL; sumber `1 origami = 5 poin` |
| AT-26 | Kotak 44 MANUAL 35 poin | Hanya +35, **bukan** 35+50; ledger `CHALLENGE_MANUAL` |
| AT-27 | MANUAL memasukkan pecahan, negatif, string, atau melebihi batas | 400 VALIDATION_ERROR, state/score tidak berubah |
| AT-28 | Submit MANUAL dengan `outcome` atau BUTTON dengan `points` | 400 VALIDATION_ERROR; tidak ada poin masuk |
| AT-29 | Dua Super Admin hampir bersamaan submit BUTTON dan MANUAL untuk turn sama | Hanya satu hasil; lainnya 409 ALREADY_RESOLVED; tidak double-score |
| AT-30 | MANUAL poin 0, dengan konfirmasi | Outcome null, awarded 0, turn selesai, tanpa ledger poin |
| AT-31 | Submit MANUAL berulang dengan key sama | Return response awal; tetap satu hasil dan satu ledger |
| AT-32 | Koreksi setelah nilai manual keliru | Buat entri kompensasi audit; tidak boleh submit hasil kedua |
| AT-33 | 10 tim berada di cell 26 | Cell 26 maksimal 3 chip + `+7`, total `10 TIM`; identitas seluruh tim tersedia di leaderboard |
| AT-34 | 10 tim di cell 26, 1 tim move keluar | Occupancy total 10→9 pada saat motion mulai; `+N` dihitung ulang secara benar, satu token aktif dianimasikan per langkah |
| AT-35 | 9 tim di tujuan, 1 tim masuk | Total di tujuan menjadi `10 TIM` dan maksimal 3 chip + `+7` setelah landing; nomor/kategori kotak tidak tertutup |
| AT-36 | 2, 3, 5, 6 tim pada sel sama | Tier: 1–3 chip bernomor; 4–10 maksimal 3 chip + `+N`, tidak overflow |
| AT-37 | Board dengan 10 tim dan 50 cell pada LED 1920×1080 | Nomor, kategori lengkap, ikon, label tetap terbaca; leaderboard tidak menutup tile |
| AT-38 | Reconnect saat token keluar dari cluster | Snapshot+active motion menyinkronkan visual occupancy; tidak ada teleport mendadak |
| AT-39 | Preferensi OS Reduced Motion aktif | Skor, urutan, posisi akhir dan total cluster sama; efek non-esensial berkurang tanpa toolbar |
| AT-40 | 10 tim berkumpul pada satu kotak | Leaderboard memuat kode/nama, posisi dan poin seluruh tim tanpa bergantung pada warna |
| AT-41 | Display board pada LED acuan | Hanya judul, board 70–75% dan leaderboard samping 25–30%; tanpa HUD, tracker, panel, toolbar, legenda atau footer |

| AT-42 | Warna tile merah/hijau/kuning/biru/ungu dengan token pasif | Kode Tn tetap terbaca dari dark base, bukan hanya dibedakan warna |
| AT-43 | Kotak 26 berisi 4, 6, 10 tim | Maksimum 3 chip + `+1`, `+3`, `+7`; total akurat, tidak ada desimal/angka palsu |
| AT-44 | 10 tim di kotak 26, tim aktif tidak termasuk 3 chip awal | Active team diprioritaskan secara visual/diangkat ke overlay; total tidak berlipat |
| AT-45 | Movement T7 dari 18 ke 22, dadu 4 | Satu token T7 bergerak melalui 19,20,21,22; path di-highlight di dalam board tanpa HUD |
| AT-46 | Gerak memantul 48 +4 | Token mengikuti 49,50,49,48 dan tile pantulan disorot; tidak teleport atau menambah panel |
| AT-47 | Punishment dari kotak 17 | Token bergerak mundur per kotak ke 12, dengan aksen penalti pada tile |
| AT-48 | Tim aktif bergerak pada board minimal | Tile tidak berubah urutan/skala; token aktif jelas, path disorot, nomor dan kategori tetap terlihat tanpa kontrol Focus Mode |
| AT-49 | 10 tim pada satu cell, LED 1920×1080 | Nomor/kategori tidak tertutup, maksimal 3 chip dan total akurat; identitas tersedia di leaderboard |
| AT-50 | Uji venue pada jarak penonton terjauh | Kode token, nomor/kategori kotak dan leaderboard terbaca tanpa zoom; perangkat dan jarak dicatat |
| AT-51 | Simulasi grayscale/proyektor rendah kontras | Kode Tn, nomor/kategori dan leaderboard tetap terbaca tanpa warna |
| AT-52 | Reduced Motion mengikuti OS | Posisi akhir, urutan dan skor sama; tidak membutuhkan kontrol tambahan di layar board |
| AT-53 | Reconnect di tengah gerakan | Token dan highlight pulih dari snapshot/waktu server tanpa double marker atau teleport; judul mengumumkan status koneksi |
| AT-54 | 10 tim dengan nama panjang | Kode, posisi dan poin terbaca di leaderboard; nama dipotong konsisten dan lengkap melalui judul elemen/admin |
| AT-55 | Kotak Reward dengan narasi apresiasi tanpa langkah challenge | Game dapat dimulai, admin bisa BUTTON/SUCCESS dan poin sesuai konfigurasi tanpa langkah tambahan |
| AT-56 | `instruction`, `backup_text`, `duration_text` kosong/null pada Reward | Preflight lolos jika kategori dan nilai skor valid; input poin normal |
| AT-57 | Admin memilih MANUAL pada Reward dan memasukkan 35 poin | Poin bertambah tepat 35, tanpa bukti/verifikasi atau auto-bonus |
| AT-58 | Admin memilih BUTTON/FAIL pada Reward | +0, giliran selesai, tidak harus mencatat alasan atau bukti |
| AT-59 | Challenge Action, Race Strength, Pit Stop dengan kegiatan di luar aplikasi | Tidak muncul form jawaban, unggah bukti, timer challenge, atau penilaian otomatis; hanya form poin |
| AT-60 | Event `game:challenge_pending` tanpa field `instruction` | Admin tetap dapat input poin; board/leaderboard publik tetap tampil tanpa panel status tambahan atau error |
| AT-61 | Finish dengan Reward sudah diberi poin namun narasi tidak dilengkapi | Finish berhasil bila tidak ada turn/poin pending; tidak ada validasi konten Reward |
| AT-62 | Buka `/` sebelum setup, saat loading atau gagal mengambil snapshot awal | 50 kotak terlihat tanpa login/kode/cookie display; preview tanpa tim/poin rekaan |
| AT-63 | Publik meminta sesi lain/arsip melalui snapshot, replay atau socket | Ditolak; tidak bocor actor, audit, lease token atau credential |
| AT-64 | Admin menyimpan tim/poin lalu Mulai bermain | Nilai per kotak tetap; preflight/Start memakai versi terbaru; lease kosong diambil otomatis; takeover perlu konfirmasi |
| AT-65 | Reset terkonfirmasi; request bersamaan/retry memakai key sama | Satu sesi DRAFT pengganti; skor/posisi/giliran 0; tim/board/provenance sama; arsip utuh dan tidak dapat dimutasi |
| AT-66 | Reset saat animasi atau versi stale; cancel konfirmasi | Ditolak/tanpa perubahan; hasil pending boleh diarsipkan tanpa skor; reset bukan Finish |
| AT-67 | Board terbuka ketika admin reset | Pindah ke game operasional baru tanpa reload; snapshot lama tidak menimpa sequence baru |
| AT-68 | Dadu 3 dari posisi 2 sebelum jadwal animasi mulai | Pion tetap 2 saat STARTING, lalu 3 → 4 → 5; tepat satu pion per tim |
| AT-69 | Board pada enam viewport, cluster padat dan saat bergerak | Nama kategori lengkap tetap terlihat tanpa singkatan/overlap; mobile menambah tinggi sesuai konten |

### 15.1 Standar kualitas pengujian

- Setiap fungsi yang diuji harus mencakup kasus sukses, kegagalan, dan edge case bila relevan; assertions
  memeriksa output atau side effects nyata, bukan implementation details atau perbandingan konstanta.
- Coverage minimum: statements/lines **90%**, functions **90%**, branches **85%**.
- Coverage ignore hanya untuk startup/bootstrap, external library behavior, atau non-deterministic logic,
  dengan alasan eksplisit dan syntax tool yang didukung: Istanbul untuk backend, c8 untuk frontend.
- Verifikasi kontrak JSON sukses/error, posisi metadata, dan centralized error handling pada integration test API.

## 16. Tahapan implementasi

| Fase | Fokus | Hasil yang wajib tersedia |
|---|---|---|
| **1. Foundation** | Monorepo, autentikasi, migrations, seed 50 kotak, setup game/tim, basic board dan display | Data model dan preflight valid; board 50 kotak tampil |
| **2. Engine dan movement** | Round-robin, dadu fisik, bounce, punishment, transaksi roll, timeline animasi dan highlight lintasan dalam board | Pergerakan deterministik tanpa teleport dan tanpa double-roll |
| **3. Scoring dan operasi** | BUTTON/MANUAL, ledger, leaderboard, Active Controller, histori, audit, pause/finish, ekspor | Tepat satu hasil poin/turn; Reward/challenge tetap offline |
| **4. Stabilitas dan venue QA** | Idempotency, row lock, outbox, reconnect, koreksi, keamanan, uji 10 tim, uji LED | Acceptance test dan rehearsal end-to-end lulus |

Prioritaskan **game engine + data invariants** sebelum animasi kosmetik. Nilai kotak dan penalti tersimpan
di server; template saat ini adalah transkripsi Lampiran A yang belum direkonsiliasi workbook asli.
Preview frontend tidak menentukan poin atau gerakan. Status implementasi dan bukti gate ada di
[task list](../tasks/todo.md); tabel fase ini bukan perintah mengulang implementasi yang sudah tersedia.

## 17. Dokumen sumber dan standar

**Materi acuan produk:**

- `F1_Leadership_Race_PAS_50_Kotak.xlsx`, sheet `50 Kotak Games`, baris 5–54 — kategori, nama kotak, Poin Bonus, penalti, narasi/cadangan/durasi referensi lapangan.
- `Board Game.png` — urutan dan gaya visual board zigzag. Detail implementasi tetap mengikuti kontrak UI pada Bagian 7.

**Standar implementasi repository:**

- Jika PRD bertentangan dengan rules yang berlaku di [`.agents/rules/`](../.agents/rules/), **rules menang**.
- [General standards](../.agents/rules/10-fullstack-general-standards.md) berlaku lintas stack;
  [backend Node/Express/Sequelize](../.agents/rules/20-backend-node-express-sequelize.md) dan
  [frontend React](../.agents/rules/30-frontend-react.md) berlaku untuk stack PRD ini.
- [Testing standards](../.agents/rules/40-testing-standards.md) mengatur kualitas test dan coverage.
  Rules Laravel (`21` dan `31`) hanya berlaku pada aplikasi Laravel, sehingga tidak diterapkan pada stack ini.

**Dokumentasi teknis resmi:**

- [Socket.IO Rooms](https://socket.io/docs/v4/rooms/)
- [Socket.IO Adapters](https://socket.io/docs/v4/adapter)
- [Socket.IO Redis Adapter](https://socket.io/docs/v4/redis-adapter)
- [Sequelize Transactions](https://sequelize.org/docs/v6/other-topics/transactions/)
- [MySQL InnoDB Locking Reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html)

Dokumen ini adalah kontrak produk aktif bersama [SPEC](../SPEC.md). [Admin satu halaman](simple-admin.md)
dan [satu game/reset](single-game.md) merinci alur yang sama. Referensi kegiatan offline adalah konteks panitia. Payload contoh bersifat ilustratif;
data game aktual selalu berasal dari server. Bukti historis pada task list bukan kontrak untuk mengembalikan UI lama.

## Lampiran A — Konfigurasi 50 kotak

Tabel berikut merupakan transkripsi field utama dari seluruh 50 kotak. **Poin Sukses** mengikuti kolom Poin Bonus. `−n` menunjukkan jumlah langkah mundur otomatis (bukan pengurangan skor). Kotak 26 tetap ditulis sesuai sumber (`1 origami 5 point`); untuk input manual admin memasukkan **total poin** (mis. empat origami = 20). Tombol Sukses pada kotak 26 bernilai dasar **5 poin**.

| No. | Kategori | Nama kotak | Poin Sukses | Penalti langkah |
|---:|---|---|---:|---:|
| 1 | Action | Team Battle | 20 | 0 |
| 2 | Reward | Perfect Start | 20 | 0 |
| 3 | Race Strength | Power Push | 30 | 0 |
| 4 | Pit Stop | Dance Together | 30 | 0 |
| 5 | Indisipliner | Late for Briefing | 0 | -2 |
| 6 | Action | Mie Sedaap Racing Ads | 20 | 0 |
| 7 | Race Strength | Jumping Jack Challenge | 30 | 0 |
| 8 | Reward | Zero Defect Achievement | 30 | 0 |
| 9 | Action | Scrambled Words | 20 | 0 |
| 10 | Pit Stop | The 3D Vision | 30 | 0 |
| 11 | Indisipliner | Safety Violation | 0 | -4 |
| 12 | Action | Guess My Action | 20 | 0 |
| 13 | Reward | Kaizen Champion | 40 | 0 |
| 14 | Race Strength | Human Tower | 30 | 0 |
| 15 | Action | PAS Knowledge Sprint | 20 | 0 |
| 16 | Pit Stop | Formation Improvement | 30 | 0 |
| 17 | Indisipliner | Quality Check Skipped | 0 | -5 |
| 18 | Reward | Best Team Collaboration | 30 | 0 |
| 19 | Action | One Vocal Challenge | 20 | 0 |
| 20 | Race Strength | Plank Endurance | 30 | 0 |
| 21 | Action | Balloon Pit Crew | 20 | 0 |
| 22 | Pit Stop | Silent Leadership | 30 | 0 |
| 23 | Indisipliner | Poor Communication | 0 | -3 |
| 24 | Reward | OEE Improvement | 40 | 0 |
| 25 | Race Strength | One Leg Survival | 30 | 0 |
| 26 | Action | Origami | 1 origami 5 point | 0 |
| 27 | Reward | Customer Satisfaction | 30 | 0 |
| 28 | Pit Stop | Dance Together | 30 | 0 |
| 29 | Action | The Code | 20 | 0 |
| 30 | Indisipliner | Breakdown Negligence | 0 | -5 |
| 31 | Race Strength | Power Push | 30 | 0 |
| 32 | Reward | Waste Reduction | 40 | 0 |
| 33 | Action | My Gombal | 20 | 0 |
| 34 | Pit Stop | Formation Improvement | 30 | 0 |
| 35 | Indisipliner | Ignoring SOP | 0 | -5 |
| 36 | Action | My Pantun | 20 | 0 |
| 37 | Race Strength | Human Tower | 30 | 0 |
| 38 | Reward | Safety Excellence | 30 | 0 |
| 39 | Pit Stop | The Quality Inspector | 30 | 0 |
| 40 | Action | The Code | 20 | 0 |
| 41 | Indisipliner | Blame Culture | 0 | -4 |
| 42 | Race Strength | Team Squat Challenge | 30 | 0 |
| 43 | Action | Unlock The Chain | 20 | 0 |
| 44 | Reward | Best Productivity | 50 | 0 |
| 45 | Pit Stop | The 3D Vision | 30 | 0 |
| 46 | Indisipliner | Data Manipulation | 0 | -6 |
| 47 | Action | One Vocal Challenge | 20 | 0 |
| 48 | Race Strength | Final Endurance | 30 | 0 |
| 49 | Reward | Excellent Operation | 60 | 0 |
| 50 | Action | The Champion Commitment | 20 | 0 |

## Lampiran B — Referensi aktivitas offline

Kolom durasi bersumber langsung dari spreadsheet: nilai angka dinyatakan dalam detik; teks `sampai berhasil` dipertahankan tanpa interpretasi otomatis. Cadangan tetap ada sebagai bahan panitia. **Seluruh baris lampiran ini adalah referensi pelaksanaan di luar aplikasi, bukan kewajiban implementasi frontend/backend. Ketiadaan instruksi Reward yang spesifik tidak memengaruhi alur permainan atau pemberian poin oleh admin.**

| Kotak | Petunjuk / skenario asli | Cadangan | Durasi sumber |
|---:|---|---|---|
| 1 | Ciptakan yel-yel F1 20 detik; wajib menyebut Mie Sedaap dan Excellent Operation. | — | sampai berhasil |
| 2 | Apresiasi atas kesiapan dan koordinasi tim sejak start. | — | 0 |
| 3 | Selesaikan total 30 push-up bersama dalam waktu 2 menit, jika gagal ulang lagi sampai waktu masuk | sama | 120 |
| 4 | Mengajak seluruh Team untuk Bergoyang tik tok | sama | 120 |
| 5 | Terlambat briefing sehingga koordinasi produksi terganggu. | — | 0 |
| 6 | Buat iklan F1 30 detik; wajib menyebut Accelerate Beyond Excellent. | iklan core value wings | sampai berhasil |
| 7 | Jumping jack dalam 2 menit | sama | 120 |
| 8 | Apresiasi atas penjagaan mutu produksi tanpa defect. | — | 0 |
| 9 | Cari 10 Negara dari acak huruf berikut ini (soal dari panitia) | 10 kata dunia kerja | 60 |
| 10 | Temukan objek tersembunyi dalam gambar 3D | 2 soal | sampai berhasil |
| 11 | Mengabaikan prosedur APD di area produksi. | — | 0 |
| 12 | Tebak 2 Gambar berikut dengan benar | 3 soal | sampai berhasil |
| 13 | Ide improvement menekan pemborosan proses. | — | 0 |
| 14 | Bangun menara manusia dengan ketinggian 4 level | sama | sampai berhasil |
| 15 | Jawab 3 pertanyaan yang disiapkan panitia terkait PT PAS dan produk. | soal cad | 45 |
| 16 | Bentuk formasi tulisan PAS dan foto sebagai bukti | formasi Love | sampai berhasil |
| 17 | Melewatkan quality checking demi mengejar target. | — | 0 |
| 18 | Kolaborasi lintas fungsi mempercepat penyelesaian gangguan. | — | 0 |
| 19 | Nyanyikan Balonku Ada Lima dengan semua vokal diganti O. | vocal A | sampai berhasil |
| 20 | tim melakukan plank hingga 60 detik; opsi bertumpu lutut. Jika Gagal nilai 0 | — | 60 |
| 21 | Tiup sampai pecah 30 balon | 30 balon | sampai berhasil |
| 22 | Mengarahkan anggota team berbaris berdasarkan tanggal lahir tanpa berbicara. Bukti Identitas | Berdasarkan abjad | sampai berhasil |
| 23 | Perubahan jadwal tidak diinformasikan kepada shift selanjutnya. | — | 0 |
| 24 | Mengurangi downtime dan gangguan minor sehingga OEE membaik. | — | 0 |
| 25 | Peserta berdiri dengan satu kaki. Tim dinyatakan berhasil jika minimal 10 orang mampu bertahan 45 detik. | bertahan 1 menit | 45 |
| 26 | Produksi Origami yang ditentukan panitia dalam 5 menit | sama | 300 |
| 27 | Pesanan terpenuhi tepat waktu dengan mutu terjaga. | — | 0 |
| 28 | Mengajak seluruh Team untuk Bergoyang Tabola Bale | goyang asik | 120 |
| 29 | Pecahkan sandi berikut ini | 2 soal | sampai berhasil |
| 30 | Pengecekan kondisi mesin terlewat dan memicu gangguan. | — | 0 |
| 31 | Selesaikan total 30 push-up bersama dalam waktu 2 menit, jika gagal ulang lagi sampai waktu masuk | sama | 120 |
| 32 | Perbaikan proses menurunkan pemborosan bahan baku. | — | 0 |
| 33 | Buat Gombalan untuk Pimpinan PT.PAS | sama | sampai berhasil |
| 34 | Bentuk formasi Bunga dan foto sebagai bukti | formasi star | 60 |
| 35 | Melewati tahapan SOP sehingga risiko mutu meningkat. | — | 0 |
| 36 | Buat Pantun seru dan unik untuk PT.PAS dan Mie Sedaap | sama | sampai berhasil |
| 37 | Bangun menara manusia dengan ketinggian 4 level | sama | sampai berhasil |
| 38 | Budaya pelaporan bahaya dan tindakan pencegahan konsisten. | — | 0 |
| 39 | Temukan 5 perbedaan gambar berikut ini | 3 soal | sampai berhasil |
| 40 | Pecahkan sandi berikut ini | 3 soal | sampai berhasil |
| 41 | Menyalahkan anggota tanpa evaluasi akar masalah. | — | 0 |
| 42 | Lakukan 30 squat dalam 2 menit | sama | 120 |
| 43 | lepaskan simpul besi | 2 | sampai berhasil |
| 44 | Produktivitas meningkat tanpa mengorbankan mutu dan keselamatan. | — | 0 |
| 45 | Temukan objek tersembunyi dalam gambar 3D | 1 soal | sampai berhasil |
| 46 | Memanipulasi laporan pencapaian target. | — | 0 |
| 47 | Nyanyikan Balonku Ada Lima dengan semua vokal diganti I. | Vocal E | sampai berhasil |
| 48 | 20 tepuk tangan, 20 Jumping Jack, 10 squat dalam waktu 2 menit | sama | 120 |
| 49 | Prestasi seimbang pada safety, quality, delivery, cost dan people. | — | 0 |
| 50 | Ungkap satu komitmen nyata dan teriakkan Accelerate Beyond Excellent! | sama | sampai berhasil |

## Lampiran C — Referensi implementasi visual

Kedua contoh berikut adalah **pure client functions** untuk rendering token/occupancy. Letakkan transformasi ini
di hook/service frontend di luar file komponen/JSX; komponen menerima hasilnya untuk rendering. Fungsi ini tidak
mengubah `teams.position`, tidak memengaruhi scoring, dan bukan kontrak database baru.

### C.1 Mengelompokkan tim berdasarkan posisi visual

```js
/** Memakai posisi visual agar occupancy mengikuti animasi tanpa mengubah posisi authoritative. */
function groupByVisualCell(teams, visualPositionByTeam) {
  const occupancy = new Map();
  for (const team of teams) {
    const cell = visualPositionByTeam[team.id] ?? team.position;
    const list = occupancy.get(cell) ?? [];
    list.push(team);
    occupancy.set(cell, list);
  }
  for (const list of occupancy.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  return occupancy;
}

// Render tiers per cell:
// 0 => none; 1–3 => individual numbered chips Tn; 4–10 => up to 3 chips + `+N`.
// Example 10 => 3 visible chips + `+7`; total is 10, not 17.
// visualPositionByTeam is derived from movement path + server-scheduled startAt.
```

### C.2 Memilih chip yang tampil per kotak

```js
/** Memprioritaskan identitas tim aktif dalam batas tiga chip tanpa mengubah skor atau posisi server. */
function createTokenCluster(sortedOccupants, activeTeamId) {
  const occupants = [...sortedOccupants].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  const prioritized = occupants.find(t => t.id === activeTeamId);
  const visible = occupants.slice(0, 3);
  if (prioritized && !visible.some(t => t.id === prioritized.id)) {
    visible[2] = prioritized; // keep active team identifiable if within this cell
  }
  return {
    total: occupants.length,
    visible,
    hiddenCount: Math.max(0, occupants.length - visible.length),
  };
}
// UI: 10 total, 3 visible => +7; never display ten tiny tokens.
// When the active token is animated separately, remove it from static marker
// rendering for that step and derive counts from visual occupancy.
```

**Server contract tetap sama:** `teamId`, `from`, `fullPath`, `startAt`, `finalPosition`, `sequence`, `stateVersion`.
Kode `T1`–`T10` berasal dari urutan tim tersimpan; tidak memerlukan tabel/event khusus token.
Cluster, overlay dan highlight memakai snapshot/timeline yang sama; contoh ini tidak menggantikan `boardView.js`.

### C.3 Aturan konsistensi render

1. Satu tim mempunyai satu posisi authoritative dan hanya satu representasi visual aktif pada setiap momen (chip statis **atau** token overlay bergerak).
2. Jumlah penghuni statis seluruh kotak termasuk START ditambah token overlay bergerak sama dengan jumlah tim.
3. Dock/cluster tidak pernah memutasi state di MySQL.
4. Badge `+N` = jumlah penghuni tersembunyi; `N TIM` = total penghuni.
5. Setelah reconnect, progress visual dihitung dari `activeMovement`, `startAt`, dan waktu server; event lama tidak diputar ulang jika sudah selesai.
6. Mockup tidak boleh dipakai sebagai sumber angka poin, urutan kotak, nama tim atau aset brand.
