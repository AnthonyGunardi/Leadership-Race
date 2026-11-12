# SPEC — F1 Leadership Race

**Tanggal revisi:** 11 November 2026  
**Sumber produk:** [PRD v1.1](docs/PRD.md)  
**Status:** Kontrak aktif mencakup simplifikasi satu game, board publik dan admin satu halaman.
Status implementasi/verifikasi mengikuti [task list](tasks/todo.md); gate rilis belum seluruhnya terpenuhi.
**Lingkup perubahan:** Kontrak produk/implementasi; tidak menjadi otorisasi merge/deploy.
Pembatalan giliran terakhir melalui URL kontrol kompatibilitas mengikuti batas Bagian 4.6.

## 1. Dasar spesifikasi dan kondisi aktual

Dokumen ini mengubah kebutuhan PRD menjadi kontrak kerja, batas implementasi, dan kriteria verifikasi.
Ketentuan produk yang tidak diulang di sini tetap mengikuti PRD, termasuk konfigurasi lengkap 50 kotak dan
seluruh acceptance test. Jika ada pertentangan, ikuti instruksi pengguna dan [AGENTS.md](AGENTS.md);
rules yang berlaku mengungguli PRD. Konflik antar-rules harus diklarifikasi, bukan diurutkan berdasarkan nomor file.

Acuan implementasi:

- [Skill routing](.agents/rules/00-skill-routing.md),
  [safety guardrails](.agents/rules/01-safety-guardrails.md), dan
  [RTK](.agents/rules/02-antigravity-rtk-rules.md).
- [General standards](.agents/rules/10-fullstack-general-standards.md),
  [backend standards](.agents/rules/20-backend-node-express-sequelize.md), dan
  [React standards](.agents/rules/30-frontend-react.md).
- [Testing standards](.agents/rules/40-testing-standards.md) dan
  [Definition of Done](.agents/references/definition-of-done.md), dengan verifikasi sesuai jenis perubahan.
- [Workflow spec](.agents/workflows/spec.md) dan
  [spec-driven-development](.agents/skills/spec-driven-development/SKILL.md).

Kondisi source yang menjadi dasar coding berikutnya:

| Area | Kondisi aktual |
|---|---|
| Produk dan panduan | `AGENTS.md`, `docs/PRD.md`, `.agents/`, dan dokumen pendukung tersedia |
| Referensi visual lokal | `docs/UI_Design.png` tersedia; bukan bukti bahwa aset brand final sudah disetujui |
| Source aplikasi | `frontend/` React JSX dan `backend/` Express ESM tersedia; G1–G18 serta simplifikasi sudah terimplementasi |
| Tooling aplikasi | npm workspaces, lockfile, pin Node/npm, ESLint, Vite, Vitest, Playwright, migrations dan smoke scripts tersedia |
| Entry publik | `/`, `/leaderboard`, `/final`; satu game operasional, tanpa login atau pairing |
| Entry admin | `/login` → `/admin/games`; tim, posisi/dadu, poin per kotak dan reset pada satu halaman |
| Quality bar | Rules dan Definition of Done; hasil check per baseline ada di task list, bukan jaminan semua gate rilis lulus |
| Data sumber asli | Workbook dan `Board Game.png` yang disebut PRD belum tersedia di workspace |

PRD dan SPEC memuat kontrak aktif pada bagian terkait. Implementasi yang sudah tersedia digunakan kembali;
jangan membuat ulang scaffold, katalog multi-game, pairing UI, HUD/tracker/panel atau toolbar yang telah dihapus.
API/URL kompatibilitas yang masih terdaftar tetap dilindungi dan tidak menjadi alur utama operator.

## 2. Objective, pengguna, dan ruang lingkup

Membangun aplikasi web online untuk panitia PT Prakarsa Alam Segar menjalankan F1 Leadership Race pada event
tatap muka. Aplikasi mengelola 2–15 tim, board 50 kotak, giliran, perpindahan, penalti, poin, dan tampilan publik.
Keberhasilan ditentukan oleh konsistensi transaksi dan keterbacaan operasional, bukan banyaknya efek visual.

| Pengguna | Kebutuhan | Batas akses |
|---|---|---|
| Super Admin | Setup, kontrol game, input dadu/poin, koreksi, histori, ekspor | Login dan otorisasi server |
| Active Controller | Menginput dadu dan memulai movement | Satu pemegang lease per game |
| Super Admin lain | Memantau dan memberi satu hasil poin saat menunggu hasil | Tidak perlu lease movement untuk scoring |
| Penonton/display | Melihat board, leaderboard, posisi tim, dan hasil final | Publik read-only, hanya game operasional saat ini |

### 2.1 Termasuk

- Login/logout/refresh, session, beberapa akun dengan role `SUPER_ADMIN`.
- Satu game operasional; admin satu halaman untuk tim, posisi/dadu, poin per kotak dan reset.
  Mulai bermain merangkum preflight/Start; editor board lengkap dan lifecycle tetap tersedia pada URL lama.
- Input angka dadu fisik 1–6; round-robin; sirkuit wrap-around di 50; penalti Indisipliner otomatis.
- Hasil poin BUTTON atau MANUAL, ledger, leaderboard, koreksi dengan audit, dan final result manual.
- Display minimal: judul game, board 2.5D 70–75% dan leaderboard samping 25–30%; chip/clustering/animasi tetap di dalam board.
- Active Controller, idempotency, transaksi, outbox, snapshot, reconnect, histori, dan ekspor CSV.
- Isolasi game/arsip, snapshot dan socket publik tanpa pairing, reset terkonfirmasi dengan histori tetap utuh.
  API session display lama tetap memiliki scope, expiry dan revocation untuk kompatibilitas.
- Pemulihan salah input dadu melalui void giliran terakhir secara terbatas, dengan audit dan kompensasi skor.

P0 dan P1 mengikuti PRD Bagian 6. P1 tetap bagian target produk; bukan fitur yang boleh dihapus diam-diam.

### 2.2 Di luar lingkup

Dadu digital, timer kegiatan, soal/form jawaban, penilaian otomatis, unggah foto/video/QR, bukti kegiatan,
klaim/pengiriman Reward, pembayaran, registrasi publik, chat antaradmin, offline-first, billing multi-tenant,
auto-finish, dan reopen setelah final tidak termasuk produk. Challenge dan Reward dilaksanakan panitia offline.
`instruction`, `backup_text`, dan `duration_text` hanya referensi opsional; tidak memblokir preflight atau scoring.

## 3. Peta kapabilitas dan dependensi

ID berikut mengindeks kebutuhan yang sudah ada di PRD Bagian 6, 8, dan 16. Dependensi berarti kontrak upstream
yang diperlukan untuk verifikasi alur lengkap, bukan izin untuk memanggil service domain sembarangan.
Peta ini mengindeks tanggung jawab source yang sudah ada, bukan permintaan membuat paket/modul baru.
Satu `SPEC.md` dipertahankan; status pekerjaan dan bukti ada pada task list.

| ID stabil | Tanggung jawab dan requirement | Bergantung pada |
|---|---|---|
| `identity-access` | Auth/session, role, akses per game/arsip, scope baca publik; FR-01, FR-22 | — |
| `game-setup` | Game, 2–15 tim, 50 kotak, urutan, preflight; FR-02 | `identity-access` |
| `turn-movement` | Lease/takeover, dadu, round-robin, sirkuit wrap-around, penalti, void terakhir; FR-03, FR-04, FR-11 dan Bagian 4.6 | `game-setup` |
| `scoring-results` | BUTTON/MANUAL, Origami, leaderboard, lifecycle, final, koreksi/ekspor; FR-05–FR-10, FR-21 | `turn-movement` |
| `realtime-recovery` | Kontrak end-to-end outbox, event sequence, snapshot, reconnect; FR-12, FR-13 | `scoring-results` |
| `race-display` | Board minimal, token, highlight lintasan, leaderboard, venue QA; FR-14–FR-20, FR-23 | `realtime-recovery` |

Urutan dependensi: `identity-access` → `game-setup` → `turn-movement` → `scoring-results` →
`realtime-recovery` → `race-display`.

Urutan fase tetap PRD Bagian 16: foundation dan basic display → engine/movement → scoring/operasi →
stabilitas/venue QA. UI statis dapat diverifikasi sebelum alur realtime lengkap. Auth, row lock, idempotency,
audit, dan outbox adalah invariant lintas kapabilitas: wajib sejak mutasi terkait dibuat, bukan ditunda ke fase QA.
Lease controller harus tersedia sebelum roll dipakai beberapa admin, walaupun operasinya dirangkum pada fase 3 PRD.

Keputusan D-01–D-07 sudah ditetapkan pada §14. Bukti implementasi dan pekerjaan rilis tersisa mengikuti
[task list](tasks/todo.md); alur utama satu game/admin dijelaskan langsung pada §4/8/9.

## 4. Kontrak domain dan invariant bersama

### 4.1 Board, start, dan giliran

- Tepat 50 kotak unik bernomor 1–50; 15 Action, 10 Reward, 9 Race Strength, 8 Pit Stop, 8 Indisipliner.
- Semua tim mulai pada posisi 0 (`START`), di luar kotak 1; skor awal 0.
- Giliran mengikuti `sort_order`, round-robin dengan wrap-around; browser tidak memilih tim berikutnya.
- Landing setelah seluruh langkah dadu memicu efek. Kotak yang dilewati tidak memberi skor/penalti.
- Konfigurasi board/tim tidak diubah saat `RUNNING`; endpoint setup hanya menerima `DRAFT`/`READY`.
- Perubahan setup saat `READY` mengembalikan game ke `DRAFT` dalam transaksi yang sama. Start kembali memerlukan
  preflight atas konfigurasi terbaru; hasil validasi konfigurasi lama tidak boleh digunakan.
- Nilai seed mengikuti [PRD Lampiran A](docs/PRD.md#lampiran-a--konfigurasi-50-kotak).
  Field aktivitas pada Lampiran B tidak menambah kebutuhan aplikasi.

Alur utama: **Atur tim** menginisialisasi satu game dengan template 50 kotak; admin menyimpan tim/poin lalu
**Mulai bermain** menjalankan preflight/Start. Tidak ada katalog/pemilih game atau langkah pairing.
Impor/editor lengkap tersedia pada URL setup kompatibilitas; duplikasi hanya API kompatibilitas, tanpa UI.
Impor memakai JSON board versi 1 tanpa ID record; duplikasi membuat DRAFT/ID baru tanpa progres/credential
dan tidak mengganti pointer publik. Detail: [admin satu halaman](docs/simple-admin.md).
`game.boardSource` mencatat CUSTOM/PRD_APPENDIX_A/JSON_IMPORT, bukan pengesahan workbook.
Template PRD tetap ditandai belum direkonsiliasi sampai gate D-08a ditutup.

### 4.2 Movement server-side

`MovementEngine` adalah fungsi domain murni di server. Input posisi integer 0–50 dan dadu integer 1–6.
Output mencakup asal, `dicePath`, landing setelah dadu, `penaltyPath`, `fullPath`, dan posisi akhir.

| Kasus | Path wajib | Hasil |
|---|---|---|
| START, dadu 3 | `[1,2,3]` | Landing/final 3 |
| Posisi 48, dadu 4 | `[49,50,49,48]` | Memantul; final 48 |
| Posisi 50, dadu 3 | `[49,48,47]` | Bergerak mundur; final 47 |
| Posisi 14, dadu 3 | `[15,16,17,16,15,14,13,12]` | Landing 17, penalti 5 langkah, final 12 |
| Landing 35 | Penalti `[34,33,32,31,30]` | Final 30 tanpa penalti kedua |

Penalti: kotak 5 → mundur 2; 11 → 4; 17 → 5; 23 → 3; 30 → 5; 35 → 5; 41 → 4; 46 → 6.
Penalti mengubah posisi, bukan mengurangi poin. Evaluasi penalti tepat sekali per roll; setelah penalti,
giliran selesai tanpa membuka form poin pada kotak tujuan mundur.

### 4.3 Scoring dan ledger

Form yang sama tersedia untuk Action, Reward, Race Strength, dan Pit Stop saat `AWAITING_RESULT`.

| Metode | Input API | Penyimpanan dan efek |
|---|---|---|
| BUTTON/SUCCESS | `scoringMethod=BUTTON`, `outcome=SUCCESS`; tanpa `points` | Poin dari `success_points` server; `manual_points=NULL` |
| BUTTON/FAIL | `scoringMethod=BUTTON`, `outcome=FAIL`; tanpa `points` | `awarded_points=0`; `manual_points=NULL` |
| MANUAL | `scoringMethod=MANUAL`, `points`; tanpa `outcome` | Poin persis input; `outcome=NULL`, `manual_points=awarded_points` |

- MANUAL wajib `Number.isSafeInteger(points)` dan berada pada **0–200**; batas server
  `MAX_MANUAL_POINTS_PER_RESULT=200` ditetapkan pada [ADR-004](docs/decisions/004-manual-scoring.md).
  String, pecahan, negatif, dan nilai melewati batas menghasilkan `400 VALIDATION_ERROR`, tanpa perubahan state.
- MANUAL adalah total poin giliran, tidak ditambah `success_points`. Kotak 44: SUCCESS = 50, MANUAL 35 = 35.
- Poin manual **0** dan **>50** memerlukan konfirmasi eksplisit browser. Pembatalan tidak mengirim request.
- Tepat satu `challenge_results` per turn, termasuk hasil 0; metode lain setelah resolve ditolak
  `409 ALREADY_RESOLVED`. Retry command yang sama mengembalikan hasil tersimpan.
- Hasil >0 menulis satu ledger `CHALLENGE_BUTTON`/`CHALLENGE_MANUAL`; hasil 0 tidak membuat ledger nol.
- `teams.total_score` diperbarui atomik dan sama dengan `SUM(score_ledger.delta_points)` untuk tim/game itu.
- Ledger tidak diedit/dihapus sebagai operasi bisnis. Koreksi membuat delta kompensasi, alasan, actor,
  timestamp, dan audit; tidak membuka hasil kedua untuk turn yang sama.
- Indisipliner tidak membuka form hasil poin. Reward tidak otomatis mendapat poin saat dilewati/diinjak.
- Endpoint hasil tidak menerima `answer`, `evidence`, `challengeStatus`, `taskCompletedAt`, atau `rewardClaim`.
  Backend tidak menilai kualitas kegiatan atau kelengkapan narasi Reward.

Kotak 26: default UI MANUAL, `points_per_unit=5`, `success_points=5`. Empat origami berarti admin mengetik
total `20`, bukan `4`. BUTTON tetap tersedia. Nilai bukan kelipatan 5 hanya memunculkan peringatan non-blocking;
server tidak menghitung jumlah origami atau membulatkan poin.

### 4.4 Lifecycle, controller, dan final

```text
Game: DRAFT → READY → RUNNING ↔ PAUSED → FINISHED
Turn: READY_FOR_ROLL → ANIMATING → (AWAITING_RESULT | RESOLVING_PENALTY)
      → COMPLETED → READY_FOR_ROLL (tim berikutnya)
Void: AWAITING_RESULT/COMPLETED → VOIDED → READY_FOR_ROLL (tim yang sama; roll baru)
```

| Operasi/state | Syarat dan efek |
|---|---|
| Preflight/READY | 50 kotak, 2–15 tim, kategori, nilai engine/scoring, dan turn order valid |
| Start | Hanya dari READY dengan konfigurasi valid |
| Roll | RUNNING, READY_FOR_ROLL, lease valid, expected turn/version sesuai |
| ANIMATING | Path sudah disimpan; roll berikutnya ditolak `409 TURN_NOT_READY` |
| AWAITING_RESULT | Menunggu satu input poin admin; bukan status pengerjaan kegiatan offline |
| RESOLVING_PENALTY | Menunggu akhir timeline penalti tanpa form poin |
| Pause | Hanya saat RUNNING dan tidak ada active movement; roll dan scoring dibekukan |
| Resume | Dari PAUSED; melanjutkan state giliran yang tersimpan |
| Finish | `confirmed:true`, expectedStateVersion; tidak ada movement atau hasil poin tertunda; URL kontrol kompatibilitas |
| FINISHED | Snapshot final dibekukan; tidak ada roll/scoring atau reopen |

`PAUSED` hanya mengubah `games.status`; `turns.status`, `active_turn_id`, dan tim aktif tetap utuh.
Pause saat `AWAITING_RESULT` mempertahankan hasil yang masih pending. Resume hanya membuka pembekuan;
tidak membuat turn baru, mengulang roll, atau menyelesaikan hasil poin.

Pause dan submit result mengunci baris game yang sama terlebih dahulu:

- Jika pause commit lebih dulu, result dengan key baru ditolak `423 GAME_PAUSED` sebelum pemeriksaan versi.
  Hasil yang sudah committed sebelumnya tetap boleh di-replay dengan key yang sama tanpa mutasi.
- Jika result commit lebih dulu, poin dan pergantian tim tersimpan. Pause kemudian membekukan tim berikutnya
  jika syarat versinya terpenuhi; expected version yang sudah usang menghasilkan `409 STALE_STATE`.
  Client tidak melakukan retry otomatis terhadap state baru tanpa menampilkan snapshot terbaru.

Lease controller berlangsung 30 detik dan diperpanjang heartbeat. Acquire hanya jika lease bebas/kedaluwarsa;
heartbeat memerlukan lease token sah. Take Over memerlukan konfirmasi eksplisit dan audit.
Scoring oleh Super Admin tidak memerlukan lease movement, tetapi tetap dilindungi transaksi dan unique constraint.

Transisi movement wajib memakai mekanisme settlement pada Bagian 4.5. Finish tidak dipicu timer,
jumlah putaran, atau kotak 50.
Jika masih pending, finalisasi ditolak `409 PENDING_RESULT`/status relevan tanpa snapshot final baru.

Leaderboard memakai `total_score DESC`, lalu `sort_order ASC` untuk urutan tampilan stabil. Saat Finish,
server menyimpan `final_results`, `finished_at`, dan `finished_by`. Skor tertinggi menentukan pemenang;
seri tertinggi berbagi rank 1 dan menjadi pemenang bersama. Posisi board bukan tie-break.

Halaman utama menggabungkan preflight/Start menjadi **Mulai bermain** dengan konfirmasi. DRAFT divalidasi
menjadi READY, lalu Start memakai versi respons READY; bila sudah READY, langsung Start. Setiap langkah
mempertahankan key sendiri untuk retry outcome tidak pasti. Lease kosong diambil otomatis sesudah mulai;
takeover browser lain tetap dikonfirmasi. Tim/poin hanya dapat disimpan pada DRAFT/READY.

**Reset game** terkonfirmasi menyalin konfigurasi tersimpan ke satu sesi DRAFT baru dengan ID baru,
skor/posisi/turnNumber=0 dan tanpa turn/controller aktif. Reset menolak animasi/versi usang, tetapi boleh
mengarsipkan hasil pending tanpa memberinya poin. Sesi lama tetap menyimpan turn/hasil/ledger/audit/final;
seluruh mutasi baru ke arsip ditolak, receipt sukses tetap dapat di-replay. Pointer, arsip, salinan konfigurasi,
audit, receipt, event dan outbox ditulis atomik. Reset tidak menjalankan Finish.
Board dan admin menemukan pointer baru melalui polling 2 detik; socket lama dibersihkan dan subscription
game baru dibuat tanpa reload. Sequence dibandingkan dalam sesi yang sama, bukan lintas game reset.

### 4.5 Settlement movement dan recovery tanpa input operator

Simpan `dice_path`, `penalty_path`, `full_path` sebagai JSON, `step_duration_ms`, serta
`movement_started_at` dan `movement_ends_at` sebagai `DATETIME(3)` UTC pada `turns` dalam transaksi roll.
Nama `movement_started_at` mengikuti PRD; DTO REST/event tetap memakai nama pada Bagian 8 dan 9.3.
Snapshot active movement berasal dari data committed ini, bukan perhitungan ulang atas konfigurasi yang berubah.

- Worker wajib memindai movement jatuh tempo secara periodik, juga saat startup/restart, tanpa bergantung
  pada request browser. Ini tetap berlaku jika seluruh display hanya mendengarkan Socket.IO.
- Semua pemicu memakai `settleExpiredMovementIfDue(gameId)`: lock game → turn → team, baca waktu UTC database,
  dan settle hanya jika status masih aktif serta waktu akhir telah tercapai. Ubah status, versi, event, dan outbox
  secara atomik. Pemanggilan berulang/konkuren menjadi no-op sesudah transisi pertama atau jika turn sudah VOIDED.
- Sebelum mengevaluasi gate state command, heartbeat controller, atau snapshot, request yang sudah lolos
  auth/scope menjalankan settlement dalam transaksi sistem tersendiri. Commit settlement dahulu; penolakan
  command berikutnya, termasuk `STALE_STATE`, tidak boleh me-rollback transisi yang sudah jatuh tempo.
  Settlement dicatat sebagai aksi sistem, bukan pemberian hak write kepada display.
- Timer `setTimeout` setelah commit boleh mempercepat pemicu, tetapi bersifat best effort. Timer tidak
  menggantikan worker/persisted deadline dan tidak menjamin waktu eksekusi tepat atau bertahan sesudah restart.
- Admin tetap memiliki aksi baca/sinkronisasi status dan heartbeat saat turn ANIMATING; jangan menonaktifkan
  seluruh jalur request hanya karena tombol roll/scoring disabled. Tidak ada force-complete sebelum deadline.
- Pantau error worker, umur movement overdue, dan antrean outbox. Jika proses tidak responsif, pulihkan proses
  lalu scan ulang; tidak ada jaminan recovery selama Node/database sendiri tidak dapat melayani permintaan.

Sumber: [Node.js timers](https://nodejs.org/api/timers.html#settimeoutcallback-delay-args).
Pemilihan interval sweep dan target lag harus diuji bersama target realtime PRD, bukan dinyatakan sudah tercapai.

### 4.6 Pemulihan salah dadu: void giliran terakhir

Gunakan `POST /api/v1/games/:id/turns/:turnId/void`, bukan edit posisi bebas. Request memuat
`expectedStateVersion`, `reason` non-kosong, dan `confirmed: true`; wajib Super Admin, game scope, serta
`Idempotency-Key`. UI menjelaskan tim, dadu, posisi yang dipulihkan, dan poin yang akan dikompensasi.

Syarat dalam game lock: status RUNNING/PAUSED, tidak ada active movement setelah settlement, target adalah record
roll committed dengan `turn_number` tertinggi dalam game, belum pernah di-void, dan belum ada koreksi terhadap
hasil/posisi tim itu sesudah roll target. Target boleh AWAITING_RESULT atau COMPLETED, termasuk penalti otomatis. FINISHED,
turn historis, versi usang, dan target tidak memenuhi syarat ditolak tanpa mutasi. Gunakan `TURN_NOT_READY`
untuk target tidak eligible dan `STALE_STATE` untuk versi usang; key yang sama tetap mengikuti aturan replay.

Pemeriksaan roll berikutnya mencakup seluruh status, termasuk VOIDED: cari record roll dengan
`game_id = target.game_id AND turn_number > target.turn_number`, tanpa filter `status != VOIDED`.
Turn yang sudah di-void tetap menjadi bagian urutan histori; status VOIDED hanya menolak turn tersebut sebagai target.
Jika roll tertinggi sudah VOIDED, tidak ada target eligible sampai roll baru dibuat. Contoh: roll 10 selesai,
roll 11 di-void; roll 10 tetap tidak boleh dibatalkan karena roll 11 pernah committed.
Alur void → roll pengganti → void tetap sah untuk record pengganti yang baru dan memenuhi seluruh syarat.
`active_turn_id=NULL` saja bukan guard anti-double-void: status target dan urutan histori wajib diperiksa ulang
di dalam game lock. Retry dengan key sama me-replay hasil; key baru ke target VOIDED ditolak tanpa kompensasi kedua.

Dalam satu transaksi:

1. Pulihkan `teams.position` ke `turns.from_position`; simpan turn sebagai terminal `VOIDED` dengan
   `voided_at`, `voided_by`, dan alasan. Turn, path, hasil poin, event, serta ledger lama tetap tersimpan.
2. Jika hasil turn telah memberi poin >0, tambahkan tepat satu ledger `CORRECTION` sebesar negatif poin itu
   dengan `compensates_entry_id` ke ledger hasil asal, lalu update total atomik. Hasil 0/tanpa hasil tidak
   membuat ledger nol. Jangan mengompensasi ulang hasil yang sudah dikoreksi.
3. Kembalikan `current_team_id` ke tim target dan `active_turn_id=NULL`; snapshot menunjukkan READY_FOR_ROLL.
   Status game tetap RUNNING/PAUSED. Nomor turn, state version, dan event sequence tidak dimundurkan.
   Roll pengganti mendapat UUID dan nomor turn baru, sehingga UNIQUE(turn_id) hasil tetap terjaga.
4. Simpan audit, command receipt, dan event/outbox sebelum commit. Publikasikan `game:correction_applied`
   dengan `correctionType=TURN_VOID`, `voidedTurnId`, posisi pulih, dan total skor; sertakan state/leaderboard
   events yang relevan. Client mengambil snapshot dan membersihkan visual/form turn yang dibatalkan sesuai
   Bagian 9.4, tanpa animasi mundur sebagai kompensasi.

Response `data` berisi `voidedTurnId`, `teamId`, `restoredPosition`, `compensatedPoints` (besar poin yang
dibatalkan), dan `newTotalScore`; versi/sequence/waktu/request ID tetap di `meta`.
Void dan roll/result/finish konkuren diserialisasi oleh game lock. Tidak ada hasil poin baru pada turn VOIDED.
Position override umum dan pembatalan turn setelah roll berikutnya tidak ditambahkan; keduanya membutuhkan
aturan pemulihan histori yang lebih luas daripada kesalahan roll terakhir.

## 5. Stack dan struktur proyek

### 5.1 Stack terpasang

| Layer | Implementasi |
|---|---|
| Frontend | React 19, JavaScript/JSX, Vite 8, React Router 8 |
| State/frontend IO | Zustand untuk state UI transien, TanStack Query untuk server state, Socket.IO Client |
| Rendering | CSS Grid, overlay pada tile langkah aktif, CSS transitions dan scheduler timeline; board 2.5D |
| Backend | Node.js LTS, Express, Sequelize, Socket.IO, schema validation, job runner ringan |
| Persistence | MariaDB lokal 3306 untuk development/integrasi; target MySQL 8.x InnoDB perlu compatibility gate rilis |
| Operasional | Winston JSON/daily rotation, persistent Node server, TLS reverse proxy |
| Scaling | Redis adapter hanya ketika multi-instance; sticky session bila long-polling aktif |

D-01 ditetapkan pada [ADR-001](docs/decisions/001-toolchain.md): Node **26.13.0 LTS**, npm **11.3.0**,
JavaScript ES modules tanpa TypeScript, Zod, Vitest dan Playwright beserta pin exact library.
React/Vite memakai JSX; tidak ada TypeScript, Motion atau Three.js. Manifest dan lockfile menjadi acuan pin;
instalasi/runtime memiliki bukti di task list. Tidak ada script type-check TypeScript.

### 5.2 Struktur source aktual

```text
repo/
├── SPEC.md
├── AGENTS.md
├── frontend/
│   ├── public/fonts/               # Barlow Condensed lokal + lisensi
│   └── src/
│       ├── App.jsx                 # routes/providers
│       ├── pages/                  # satu komponen PascalCase per file
│       ├── components/             # admin satu halaman, board, scoring
│       ├── hooks/
│       ├── services/               # API, board projection, koneksi, timeline
│       ├── stores/
│       └── __tests__/
├── backend/
│   ├── migrations/                 # DDL additive dan guards test schema
│   └── src/
│       ├── app.js
│       ├── server.js
│       ├── cli/                    # bootstrap admin
│       ├── config/
│       ├── data/                   # template PRD belum direkonsiliasi workbook
│       ├── models/                 # schema, associations, persistence constraints
│       ├── routes/
│       ├── controllers/            # HTTP request/response
│       ├── middleware/             # auth, validation, idempotency, errors
│       ├── services/               # workflow/transaksi, movementWorker, outboxPublisher
│       ├── domain/                 # movement.js, scoring.js, csvExport.js
│       ├── realtime/               # room auth dan publisher
│       ├── validation/
│       ├── logs/                   # runtime output; tidak di-commit
│       └── tests/
├── scripts/                        # dev, demo, smoke, rehearsal, backup/restore
├── e2e/
├── deploy/
├── tasks/
├── docs/                           # PRD dan dokumen pendukung
└── .agents/                        # panduan yang sudah tersedia
```

Lokasi test: `backend/src/tests/` (termasuk `integration/`), `frontend/src/__tests__/`, dan `e2e/`,
memakai `.js`/`.jsx`. Gunakan struktur ini; jangan membuat `features/`, `lib/`, `jobs/` atau paket shared
hanya karena pernah disebut dalam scaffold awal.

### 5.3 Batas layer

- Controller menerima input tervalidasi dan mendelegasikan ke service; tidak mengakses model, melakukan
  transformasi, iterasi, atau branching bisnis. Error melalui `next(error)` atau centralized async wrapper.
- Service domain-scoped memuat business logic, otorisasi, transformasi, dan transaksi; bebas `req/res/next`.
  Service boleh memakai Sequelize langsung. Repository opsional, hanya untuk query/scoping, bukan workflow.
  Hindari panggilan service domain tak terkait dan dependensi melingkar; workflow atomik punya satu penanggung jawab.
- Model hanya schema, associations, indexes, dan persistence constraints; tanpa logika bisnis dalam hooks.
- Komponen React hanya rendering dan UI state lokal. API calls, business logic, transformasi occupancy,
  Socket lifecycle, recovery, dan side effects berada di hooks `useXxx`/service/API layer.
- Semua fetching menangani loading/error/success dan deduplikasi request konkuren. Context hanya untuk state
  global yang dipakai minimal tiga komponen; prop drilling lebih dari tiga level dilarang.

## 6. Code style

JavaScript menggunakan indentasi 2 spasi, semicolon, dan maksimal 120 karakter per baris.
ESLint tanpa local override kecuali diwajibkan eksplisit. Variabel, fungsi, dan resource files memakai
`camelCase`; classes dan file komponen memakai `PascalCase`; kolom DB memakai `snake_case`.
Functional components saja, satu komponen per file.

Contoh berikut hanya menunjukkan gaya/validasi domain. Implementasi authoritative yang digunakan adalah
`backend/src/domain/movement.js`; contoh ini bukan alasan membuat engine kedua:

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

JSDoc menjelaskan alasan/constraint/side effects dan hanya ditambahkan untuk fungsi exported, I/O,
mutasi shared state, logika bisnis/branching, atau external API. Tidak ada unused import/variable, debug logging,
commented-out code, atau placeholder logic. Error domain dipetakan oleh centralized error middleware.
Raw SQL hanya bila ORM tidak efisien, wajib parameterized dengan alasan tertulis.

## 7. Persistence, transaksi, dan idempotency

MySQL adalah sumber kebenaran. Seluruh kolom UUID memakai **CHAR(36)** ASCII/ascii_bin, termasuk PK/FK.
Waktu DB UTC dan ditampilkan WIB. Semua model menetapkan data type, `allowNull`, dan default secara eksplisit;
foreign key diindeks, business uniqueness dilindungi unique constraint. Detail field mengikuti PRD Bagian 9.

| Tabel | Tanggung jawab/constraint wajib |
|---|---|
| `users` | Super Admin aktif, hash password; unique email |
| `games` | Status, tim/turn aktif, turn number, `state_version`, `event_sequence`, waktu/actor start-finish |
| `teams` | Posisi 0–50, total skor; unique `(game_id,sort_order)` dan `(game_id,name)` |
| `board_cells` | Unique `(game_id,number)`; konfigurasi poin/penalti; referensi kegiatan nullable |
| `turns` | Unique `(game_id,turn_number)`; dice, asal, landing/final, path JSON, step duration, timeline UTC, resolved/void metadata |
| `challenge_results` | Unique `turn_id`; metode, outcome/manual nullable sesuai mode, awarded points, actor/waktu |
| `score_ledger` | Delta immutable, source, actor, alasan dan referensi kompensasi; index game/team/waktu |
| `game_events` | Unique `(game_id,sequence)`; payload durable untuk gap recovery |
| `command_log` | `game_id` NOT NULL; unique `(game_id,idempotency_key)` dan `(scope_key,idempotency_key)`; actor/type/hash/status/response |
| `outbox_events` | Unique `game_event_id`; status publish dan retry |
| `controller_leases` | Satu baris per game; holder, lease token hash, expiry, version/CAS |
| `display_tokens` | Kompatibilitas session lama: token hash, scope game, expiry, revoked time; read-only, arsip ditolak |
| `single_game` | Singleton `id=1`, FK/unique `game_id`; satu game operasional publik |
| `game_archives` | `game_id`, unique `next_game_id`, `archived_by`, `archived_at`; arsip immutable |
| `final_results` | Unique `(game_id,team_id)`; score, position, rank, winner |
| `audit_logs` | Game, actor user nullable untuk SYSTEM, action, before/after ringkas, reason, request ID, timestamp; tanpa secrets |

`scope_key` pada command log adalah string NOT NULL yang dibentuk server: `game:<gameId>` untuk command
game existing dan `create-game:<actorUserId>` untuk create. Actor tetap diperiksa, tetapi tidak ditambahkan
ke unique key command game: key yang sama pada game yang sama tidak menjadi intent baru hanya karena admin berbeda.
Untuk `POST /games`, buat UUID dan insert game sebelum insert receipt dalam transaksi yang sama; foreign key
tidak perlu nullable. Replay create dicari melalui scope actor, bukan game ID yang belum diketahui client.
Unique scope memilih satu pemenang bila dua create konkuren; kegagalan insert receipt me-rollback game duplikat.
Jangan commit game dahulu baru menulis receipt. Payload berbeda pada key/scope sama mengikuti Bagian 7.1.

Session/refresh dan pairing mengikuti [ADR-002](docs/decisions/002-identity-command.md);
constraints, audit indexes, DTO dan migrasi additive termasuk G3 active_turn_id → G7 turns mengikuti
[ADR-003](docs/decisions/003-state-event.md). Migrations wajib untuk perubahan schema;
`sequelize.sync({ alter: true })` tidak digunakan di production.

Alur command penting:

1. Validasi external input dan auth/scope; jalankan settlement jatuh tempo sesuai Bagian 4.5 sebelum gate command.
   Invariant juga ditegakkan untuk jobs/non-HTTP callers.
2. Gunakan Sequelize managed transaction; lock berurutan `games FOR UPDATE` → turn → team yang terkait.
   Create game memakai alur insert/unique scope di atas karena baris game belum tersedia untuk di-lock.
3. Periksa/claim command log secara atomik dengan unique constraint; replay atau tolak sesuai Bagian 7.1.
4. Untuk key baru, cek game PAUSED, hasil yang sudah resolved, kesiapan turn, expected turn/version,
   serta lease bila roll. Result kedua pada turn resolved menghasilkan ALREADY_RESOLVED sebelum STALE_STATE;
   game PAUSED menghasilkan GAME_PAUSED. Result pada turn VOIDED menghasilkan TURN_NOT_READY.
5. Hitung domain di server; tulis state, hasil/ledger bila relevan, audit, game event, outbox, dan command log
   dalam transaksi yang sesuai. Multi-step write dua atau lebih tabel wajib transaksi.
6. Naikkan `state_version` untuk mutasi bisnis committed dan alokasikan event sequence monoton unik per game.
   Jika satu command menghasilkan beberapa event, setiap event memperoleh sequence sendiri.
7. Commit sebelum publish. Outbox retry memulihkan crash antara commit dan emit; client mengabaikan event
   duplikat dan tidak menganggap pengiriman jaringan exactly-once.

Deadlock/lock timeout mendapat retry terbatas dengan jitter untuk transaksi idempotent, lalu error transparan.
Urutan lock mengurangi risiko deadlock; bukan bukti bahwa seluruh deadlock tidak mungkin terjadi.
Query turn/event dan semua akses data harus scoped per game. Koreksi tidak dilakukan saat active movement.
Lease dan tombol disabled di UI tidak menggantikan row lock, authorization, atau unique constraint.

### 7.1 Payload conflict, replay, dan scope tanpa game ID

- Client membuat satu key per intent dan mempertahankannya selama retry; key tidak diganti otomatis karena timeout.
- `request_hash` mencakup method, route/target, dan body tervalidasi yang dikanonisasi. Periksa actor serta scope
  sebelum replay; jangan membocorkan response actor lain. Scope ditentukan server, bukan field input client.
- Key/scope/actor dan hash yang sama pada command sukses mengembalikan response tersimpan sebelum pemeriksaan
  versi/state terbaru. Tidak ada turn/ledger baru. Hash atau actor berbeda pada key game yang sama ditolak
  `409 DUPLICATE_ACTION`, tanpa menjalankan intent kedua.
  Benturan unique game/key dengan scope command berbeda juga ditolak; rollback dulu sebelum membaca receipt
  pemenang dalam transaksi baru. Jangan me-replay response dari endpoint/intent lain.
- Claim yang masih berjalan harus selesai/rollback atau menghasilkan `409 DUPLICATE_ACTION` setelah bounded wait;
  jangan menjalankan ulang efek yang hasil commit-nya belum diketahui. Duplicate create yang di-rollback dibaca
  ulang dari transaksi baru agar melihat receipt pemenang.
- Key baru untuk turn hasil yang sudah selesai menghasilkan `409 ALREADY_RESOLVED`, termasuk konflik BUTTON/MANUAL
  AT-29; key baru saat movement masih aktif menghasilkan `409 TURN_NOT_READY`.
- Retention receipt adalah **selama umur game**, termasuk FINISHED, tanpa TTL cleanup otomatis. Tidak ada
  plaintext credential di command_log. Issue pairing code hanya mengembalikan code sekali; timeout memerlukan
  intent/key baru untuk generate code baru. Replay key lama hanya metadata non-rahasia. Lease credential
  replay dienkripsi terpisah sesuai ADR-002; auth/exchange/sync memakai lifecycle session, bukan generic receipt.

Auth login/refresh/logout bukan command domain game dan tidak ditulis ke game `command_log`.
Endpoint ini mengikuti rate limit, rotasi, revocation, serta reuse detection session; tidak menjanjikan replay
response credential melalui generic idempotency. Retry refresh setelah hasil tidak diketahui harus mengikuti
kontrak session, bukan menonaktifkan reuse detection. Ini pengecualian eksplisit terhadap kalimat write API
umum pada PRD Bagian 10, bukan perubahan diam-diam pada constraint game. Header generic Idempotency-Key
diwajibkan untuk command domain game, termasuk create; pengecualian auth dicatat kembali pada Bagian 14.

Sumber: [MySQL penanganan deadlock](https://dev.mysql.com/doc/refman/8.4/en/innodb-deadlocks-handling.html).

## 8. Kontrak REST dan realtime

### 8.1 REST

Prefix endpoint bisnis: `/api/v1`. Admin memakai bearer access token; snapshot/read display memakai
endpoint `/public/*` tanpa login, pairing atau cookie display, terbatas pada game operasional saat ini.
`Idempotency-Key: <uuid>` wajib pada command domain game, termasuk create/reset.
Pengecualian auth dan batas replay credential mengikuti Bagian 7.1; session display lama hanya kompatibilitas.
Validasi route/query/body/header/cookie/environment/import di boundary.

| Method | Path setelah `/api/v1` | Syarat/hasil utama |
|---|---|---|
| POST | `/auth/login` | Login Super Admin; rate limit |
| POST | `/auth/refresh` | Rotasi refresh; invalid/reused token ditolak |
| POST | `/auth/logout` | Revoke session |
| GET | `/public/game` | Snapshot publik game operasional, atau preview 50 kotak tanpa tim/poin rekaan |
| GET | `/public/games/:id/snapshot` | Hanya game operasional; ID lain/arsip 404; tanpa data privat |
| GET | `/public/games/:id/events?afterSequence=N` | Replay invalidasi publik berurutan, payload kosong |
| POST | `/games/current` | SUPER_ADMIN; `{name}`; inisialisasi concurrent mengembalikan satu game yang sama |
| POST | `/games/:id/reset` | SUPER_ADMIN; `{expectedStateVersion,confirmed:true}`; tanpa animasi aktif |
| GET | `/games/archives?page=1&limit=20` | Metadata arsip terpagina; SUPER_ADMIN |
| GET | `/games` | List game terotorisasi |
| POST | `/games` | Buat DRAFT |
| GET | `/games/templates/prd-appendix-a-v1` | Template transkripsi PRD; belum direkonsiliasi workbook |
| POST | `/games/:id/board-template` | Terapkan template tersimpan, DRAFT/READY, versi terkini |
| POST | `/games/:id/board-import` | Impor JSON board v1 atomik tanpa ID; DRAFT/READY |
| POST | `/games/:id/duplicate` | Nama baru + expectedSourceStateVersion; konfigurasi saja ke DRAFT baru |
| GET | `/games/:id/snapshot` | Board/tim, posisi/skor, turn, active movement, version/sequence, server time |
| PUT | `/games/:id/setup` | Hanya DRAFT/READY; optimistic concurrency; edit READY kembali ke DRAFT |
| POST | `/games/:id/validate` | Preflight; tidak memeriksa kelengkapan materi kegiatan |
| POST | `/games/:id/start` | READY dan konfigurasi valid |
| POST | `/games/:id/pause` | RUNNING tanpa active movement |
| POST | `/games/:id/resume` | PAUSED |
| POST | `/games/:id/controller/acquire` | Lease bebas/kedaluwarsa |
| POST | `/games/:id/controller/heartbeat` | Lease token sah |
| POST | `/games/:id/controller/take-over` | Konfirmasi eksplisit dan audit |
| POST | `/games/:id/turns/roll` | Active Controller, current turn/version, dice 1–6 |
| POST | `/games/:id/turns/:turnId/result` | AWAITING_RESULT; BUTTON XOR MANUAL; sekali per turn |
| POST | `/games/:id/turns/:turnId/void` | Tambahan Bagian 4.6; void roll terakhir, audit/kompensasi, tanpa active movement |
| GET | `/games/:id/leaderboard` | Ranking dihitung server |
| GET | `/games/:id/events?afterSequence=N` | Replay berhalaman dan terotorisasi |
| POST | `/games/:id/corrections` | Koreksi skor saat RUNNING/PAUSED, alasan wajib, ledger kompensasi, tanpa active movement |
| POST | `/games/:id/finish` | Konfirmasi; tanpa turn/result unresolved |
| GET | `/games/:id/results` | Hanya FINISHED |
| GET | `/games/:id/export.csv` | Hanya Super Admin; content type CSV |
| POST | `/games/:id/display-tokens` | SUPER_ADMIN issue code 6 karakter, TTL 10 menit, budget 5 gagal; ADR-002 |
| GET | `/games/:id/display-tokens` | Metadata session/pairing, tanpa secret; SUPER_ADMIN |
| POST | `/games/:id/display-pairings/exchange` | Tukar code atomik menjadi cookie session read-only 24 jam |
| POST | `/games/:id/display-tokens/:sessionId/renew` | Renewal eksplisit Super Admin; deadline baru 24 jam |
| POST | `/games/:id/display-tokens/:sessionId/revoke` | Revoke REST dan socket aktif |
| POST | `/games/:id/display-session/sync` | Cookie sah menyinkron expiry yang diotorisasi admin |

Endpoint katalog/duplikasi dan pairing/session display pada tabel adalah API kompatibilitas; tidak ada UI
pairing atau pemilihan multi-game. API tersebut tidak mengubah pointer game operasional. Arsip menolak
seluruh mutasi dan cookie display lama; histori/CSV hanya melalui admin. Reset mengarsipkan sesi lama
dan menyalin konfigurasi ke satu sesi DRAFT baru secara atomik, termasuk pointer, arsip, audit, receipt,
event dan outbox. Retry key sama mengembalikan sesi pengganti yang sama. Kontrak: [satu game](docs/single-game.md).

Body roll: `diceValue`, `expectedTurnNumber`, `expectedStateVersion`, `controllerLeaseToken`.
Response data mencakup `turnId`, `teamId`, `diceValue`, `from`, `dicePath`, `penaltyPath`, `fullPath`,
`landingCell`, `finalPosition`, `requiresChallenge`, `movementStartsAt`, `movementEndsAt`, dan `stepDurationMs`.
`requiresChallenge` menunjukkan perlunya hasil poin, bukan kegiatan di aplikasi.

Endpoint `/corrections` mengubah skor melalui ledger, bukan posisi bebas. Hasil 0 yang tidak memiliki ledger
asal tetap dapat dirujuk melalui turn/result pada audit; `compensates_entry_id` hanya menunjuk ledger yang ada.
Delta adalah integer bukan nol **−1000…1000**; total akhir tidak boleh negatif. Body memerlukan `teamId`,
`deltaPoints`, `reason`, `confirmed:true`, `expectedStateVersion`; `turnId`/`compensatesEntryId` opsional
dan harus milik game/tim yang sama. D-04 ditutup pada G12. Koreksi arsip atau FINISHED ditolak.

Contoh MANUAL pada kotak 26 (data ilustratif):

```json
{
  "scoringMethod": "MANUAL",
  "points": 20,
  "note": "4 origami berhasil x 5 poin",
  "expectedStateVersion": 60
}
```

Body BUTTON memakai `scoringMethod`, `outcome=SUCCESS|FAIL`, dan `expectedStateVersion`; `points` dilarang.
Response hasil memuat `turnId`, `scoringMethod`, `outcome|null`, `awardedPoints`, `newTotalScore` di `data`.

Envelope JSON sukses: `{success:true,data,meta?}`. `serverTime`, `stateVersion`, `eventSequence`, dan `requestId`
berada di `meta` bila relevan, bukan top-level. Error: `{success:false,error:{code,message}}` melalui
centralized error middleware. `X-Request-Id` tersedia sebagai header termasuk pada error; stack/context internal
tidak dikirim ke client. CSV tidak dibungkus envelope JSON.

Kode mengikuti PRD Bagian 10.3: 400 `VALIDATION_ERROR`; 401 `UNAUTHENTICATED`; 403 `FORBIDDEN`;
404 `NOT_FOUND`; 409 `STALE_STATE`, `TURN_NOT_READY`, `DUPLICATE_ACTION`, `ALREADY_RESOLVED`,
`CONTROLLER_NOT_HELD`, `PENDING_RESULT`, `EVENT_HISTORY_UNAVAILABLE`; 423 `GAME_PAUSED`; 429 `RATE_LIMITED`; 500 `INTERNAL_ERROR`.
Pada 409, client mengambil snapshot terbaru, tidak menghitung posisi/skor lokal.

### 8.2 Socket.IO dan pemulihan

Handshake admin memverifikasi access token; jalur publik memakai `{gameId,public:true}` tanpa pairing.
Server memeriksa game operasional pada handshake, join, scan berkala dan setiap emit; event/replay publik
hanya invalidasi dengan payload kosong, lalu client mengambil snapshot publik. DTO tidak memuat controller,
lease token, actor, audit atau credential. Session display lama tetap diverifikasi pada jalur kompatibilitas.
`game:join` memerlukan cek izin sebelum join `game:{gameId}`.
Semua event memakai envelope `{eventId,gameId,sequence,stateVersion,occurredAt,payload}`.

Tabel payload lengkap berikut untuk admin/session kompatibilitas yang sah. Jalur publik mempertahankan
jenis/envelope event dengan `payload={}`; client publik membaca perubahan melalui snapshot aman.

| Event server | Kontrak payload utama |
|---|---|
| `game:state_changed` | Status game, current team, turn status |
| `game:movement_started` | Turn/team, from, dice/penalty/full path, final position, startAt/endAt, stepDurationMs |
| `game:challenge_pending` | Turn, cell/category/title, successPoints, allowedMethods, defaultMethod, pointsPerUnit?, instruction? |
| `game:challenge_resolved` | Turn/team, scoringMethod, outcome nullable, awardedPoints, newTotalScore |
| `game:leaderboard_updated` | Teams dan version |
| `game:controller_changed` | Holder user dan expiry |
| `game:finished` | Finished time, winners, results |
| `game:correction_applied` | Reason, affectedTeamId, newStateVersion; untuk void tambah correctionType, voidedTurnId, posisi/skor pulih |

Snapshot, payload event lengkap, alias waktu REST/event, pagination dan retention mengikuti
[ADR-003](docs/decisions/003-state-event.md). Replay default limit=100, maxLimit=500, sequence ASC;
EVENT_HISTORY_UNAVAILABLE wajib refetch snapshot penuh. Field umum sequence/version/game ada di envelope.
Nama event wire adalah `game:movement_started`; istilah `movement.started` pada uraian animasi PRD merujuk
kejadian yang sama. `instruction` pada challenge pending opsional dan bukan prasyarat form poin.

Setelah join berhasil, buffer event sementara mengambil snapshot; ambil gap setelah sequence snapshot,
urutkan/dedup, lalu terapkan. Abaikan event yang sudah diterapkan dan recovery saat sequence melompat.
Reconnect mengulangi authorization, subscription, snapshot, gap recovery, dan rekonsiliasi active movement.
Tidak ada client-to-client mutation atau event per kotak; occupancy tidak membutuhkan tabel/event baru.
Jaminan: exactly-once business effect, bukan exactly-once network delivery.

### 8.3 Kompatibilitas pairing/session display lama

Alur aplikasi saat ini tidak memerlukan pairing: buka `/` untuk board, `/leaderboard` untuk ranking,
dan `/final` untuk hasil. UI penerbitan/exchange/renewal kode sudah digantikan alur publik satu game.
Ketentuan berikut hanya berlaku pada API/session lama yang masih aktif, bukan syarat akses board atau venue QA.

Pisahkan kode pairing sementara dari credential session display. Panitia tidak perlu mengetik bearer token
panjang atau menaruhnya di URL permanen. Kontrak ini melengkapi pairing yang sudah disebut PRD Bagian 10/13;
route/DTO/schema dan kebijakan retry telah ditetapkan pada [ADR-002](docs/decisions/002-identity-command.md).
Access admin TTL 15 menit, refresh TTL 7 hari dengan rotasi/reuse detection; pairing code 6 karakter
alfanumerik uppercase tanpa 0/O/1/I, TTL 10 menit, attempt budget 5 gagal. Display cookie HttpOnly/Secure/
SameSite=Lax mempunyai TTL absolut 24 jam, hanya di-renew/revoke Super Admin.

1. Super Admin membuat kode pairing pendek melalui API kompatibilitas untuk satu game, sekali pakai,
   memiliki expiry server, dan disimpan sebagai hash/HMAC yang sesuai untuk kode berentropi rendah.
2. Endpoint exchange menerima kode, lalu server menukar secara atomik menjadi session read-only.
   Terapkan rate limit/attempt budget, expiry, dan validasi scope; format kode harus diuji bersama mitigasi
   brute force. Kode terpakai/kedaluwarsa/revoked tidak boleh membuat session baru.
3. Simpan credential session opaque dalam cookie HttpOnly, Secure, SameSite dengan scope host yang tepat;
   server menyimpan hash dan metadata expiry/revocation. Jangan gunakan localStorage/sessionStorage atau
   response JSON/log yang dapat mengekspos token. REST dan Socket.IO memverifikasi session server yang sama.
4. Pairing code berumur pendek; session display kompatibilitas mempunyai batas absolut terpisah.
   Metadata expiry/renewal tersedia melalui API admin lama, tanpa UI pengelolaan display. Aktivitas socket
   tidak memperpanjang sesi. Perangkat venue memakai jalur publik, bukan mengandalkan deadline cookie lama.
5. Expiry/revoke menghentikan akses REST/socket lama, bukan hanya handshake berikutnya.
   Tidak ada layar re-pair di frontend aktif; gangguan koneksi board publik mengikuti status judul/ARIA §9.
6. Regression test mempertahankan scope/expiry/revocation jalur lama. Uji perangkat venue memakai `/`
   tanpa kode; pairing dan on-screen keyboard bukan lagi prasyarat operasional.

Sumber keamanan: [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
dan [RFC 8628 Bagian 5.1](https://www.rfc-editor.org/rfc/rfc8628.html#section-5.1).
RFC dipakai sebagai acuan keamanan kode pendek, bukan klaim bahwa aplikasi mengimplementasikan OAuth Device Grant.
Middleware koneksi Socket.IO hanya berjalan sekali per koneksi; enforcement expiry/revoke perlu jalur aktif
sesudah handshake sesuai [Socket.IO middlewares](https://socket.io/docs/v4/middlewares/).

## 9. Kontrak UI dan display

### 9.1 Routes

| Route | Konten/akses |
|---|---|
| `/login` | Email/password, error login, session/logout |
| `/admin/games` | Empat bagian: tim, posisi/dadu, poin challenge per kotak, reset; satu game |
| `/` | Board publik 50 kotak dan START; judul, board 70–75%, leaderboard 25–30% |
| `/leaderboard` | Ranking/poin publik game operasional |
| `/final` | Ranking/pemenang publik setelah FINISHED |
| `/admin/games/:id/setup` | URL kompatibilitas: nama event, tim/warna/order, editor 50 kotak, impor/template, preflight |
| `/admin/games/:id/control` | URL kompatibilitas: controller, lifecycle, dadu/skor, void terakhir |
| `/admin/games/:id/scoreboard` | URL kompatibilitas: leaderboard dan ringkasan |
| `/admin/games/:id/history` | URL kompatibilitas: histori/filter, audit, koreksi, CSV; arsip hanya baca |
| `/admin/games/:id/displays`, `/admin/games/:id/duplicate` | Redirect ke `/admin/games` |
| `/display/:id/*` | Redirect ke `/`, tanpa pairing |

Halaman utama tidak memuat sidebar, katalog/arsip, pairing, controller teknis, editor 50 kotak atau menu
pause/finish/histori. Tim 2–15 dapat diatur nama/warna/urutan; posisi hanya melalui dadu fisik 1–6, tanpa
pemindahan bebas. Poin Sukses/default BUTTON atau MANUAL berbeda per kotak; Gagal 0, manual 0–200.
Pengaturan tersimpan hanya sebelum mulai, terkunci dan dapat dilipat setelah mulai. Draft tidak ditimpa
polling; konflik meminta muat ulang eksplisit; field invalid membuka kelompok terlipat sebelum fokus.
Mulai bermain menjalankan preflight lalu Start memakai versi respons terbaru, dengan retry key yang sama
per langkah jika hasil belum pasti. Lease kosong diambil otomatis, takeover browser lain memerlukan konfirmasi.
Refresh sesi otomatis; write disabled saat offline, pending atau uncertain. Reset terkonfirmasi tetap di
halaman utama setelah pointer berubah. Kontrak lengkap: [admin satu halaman](docs/simple-admin.md).
URL kompatibilitas mempertahankan navigasi game, editor board terlipat dan disclosure audit. Mobile memakai
susunan satu kolom dan scroll lokal tabel tanpa overflow halaman.

### 9.2 Layout dan identitas

Board publik memuat tepat tiga permukaan: **judul game, board dan leaderboard**. Detail: PRD §7.1–7.3.

- LED 1920×1080 dan 1366×768: board 70–75% lebar konten, leaderboard 25–30% di kanan, di luar gap/judul.
  Implementasi acuan 75:25, scale-to-fit tanpa horizontal scroll.
- Board CSS Grid 5×10, baris atas→bawah: 1–10, 20–11, 21–30, 40–31, 41–50.
  START=0 menyatu dengan canvas; bukan tile ke-51 dan bukan penghuni tile 1.
- Tidak ada HUD, tracker, occupancy panel, toolbar, legenda, breadcrumbs lintasan atau footer.
  Layar <768 CSS px boleh menumpuk leaderboard di bawah board; tidak menambah permukaan.
- Semua 50 tile tetap terlihat selama animasi; tidak ada crop, zoom, perubahan ukuran/urutan grid atau double marker.
- Warna kategori: Action hijau; Reward ungu; Race Strength kuning-oranye; Pit Stop biru; Indisipliner merah.
  Nama kategori selalu lengkap pada semua viewport, saat cluster dan saat bergerak; tidak memakai singkatan.
  Latar hitam/charcoal, bevel/strip kategori dan chip logam dibuat dengan CSS tanpa transformasi grid.
  Judul/angka memakai Barlow Condensed lokal; ukuran race-control mengikuti [PRD Bagian 7](docs/PRD.md#7-desain-dan-spesifikasi-layar).
  Chip T1–T10 memakai dark base #101827, kode putih, outline putih, rim warna tim; token aktif memiliki ring emas.
- 1–3 chip individual; 4–10 maksimal 3 chip + `+N` dan total. Prioritas tim aktif dan urutan stabil tetap berlaku.
  Saat sempit, chip aktif + total diperbolehkan. Identitas seluruh tim tersedia melalui leaderboard.
- Baseline LED nomor sekitar ≥22 px, kategori 16–18 px, chip pasif 18–20 px; kontras teks ≥4.5:1 dan
  grafis penting ≥3:1. Nama lengkap dapat diakses melalui judul elemen dan admin/scoreboard.
- Loading/error sebelum snapshot pertama tetap menampilkan grid 50 kotak dari preview template, tanpa
  tim/poin rekaan. Status koneksi diintegrasikan pada judul/ARIA; reconnect mempertahankan snapshot terakhir.

### 9.3 Timeline visual

Durasi awal 450 ms per langkah; penyesuaian misalnya 300–700 ms. Start dijadwalkan 300–500 ms setelah commit.
Client memakai offset waktu server dan metadata path/timeline yang sama, bukan menentukan hasil movement.
REST memakai `movementStartsAt/movementEndsAt`; payload event memakai `startAt/endAt` sesuai PRD.

Backend boleh menyimpan posisi final segera, tetapi rendering menggunakan `visualPositions` sampai timeline selesai.
Selama STARTING sebelum `startAt`, pion tetap di `from`. Dadu 3 dari kotak 2 harus terlihat 2 → 3 → 4 → 5,
tanpa lebih dahulu muncul di kotak 5. Scheduler tidak boleh mereset timeline akibat render pembaruan waktunya sendiri.
Satu tim direpresentasikan chip statis atau overlay aktif pada satu waktu. Saat bergerak keluar, occupancy asal
berkurang pada awal motion; tujuan bertambah setelah landing. Token bergerak per kotak, termasuk wrap-around/penalti,
tanpa teleport atau double marker; total identitas tim termasuk START tetap sama dengan jumlah tim.

Token aktif dan highlight di dalam board menunjukkan lintasan normal, sirkuit wrap-around dan penalti tanpa menutupi nomor/kategori.
Informasi dadu dan status rinci giliran tetap berada pada kontrol admin.
Reconnect melanjutkan progress berdasarkan snapshot active movement dan waktu server; jika selesai, tampilkan final.

Kontrak komponen mengikuti PRD Bagian 7.6: `RaceBoard`, `BoardCell`, `RacingToken`, `TokenCluster`,
`MovementOverlay` dan `LeaderboardPanel`; komponen HUD/tracker/panel/toolbar tidak dimount pada route board.
Transformasi dan perhitungan berada di hooks/services, termasuk contoh occupancy PRD Lampiran C.
Gerakkan overlay dengan scheduler timeline/CSS dan selector/memo seperlunya; jangan render ulang 50 tile
setiap frame. Reduced Motion mengikuti OS dan mempertahankan state, skor, urutan serta occupancy.
Board tidak memutar audio otomatis; fullscreen/kiosk/screen sleep diatur melalui browser/OS dan panduan operator.

### 9.4 Rekonsiliasi visual setelah TURN_VOID

Pada admin dan board `/`, event `game:correction_applied` dengan `correctionType=TURN_VOID`
menggunakan urutan/dedup/recovery Bagian 8.2. Penanganannya berada di hooks/services, bukan business logic JSX.

- Batalkan callback/timeline/overlay, highlight path, dan form poin yang masih terikat `voidedTurnId`.
  Hentikan pemicu lama agar tidak menulis kembali posisi visual sesudah snapshot dipasang.
- Ambil snapshot sambil mem-buffer event lanjutan. Pasang hanya snapshot yang `meta.eventSequence` dan
  `meta.stateVersion` minimal mencakup event void serta tidak lebih lama dari state yang sudah dipasang.
  Response snapshot terlambat/event duplikat tidak boleh mengembalikan visual ke state lama; ulangi recovery jika perlu.
- Bangun ulang `authoritativePositions`, `visualPositions`, cluster dan leaderboard secara konsisten dari
  snapshot. Jika tidak ada movement baru, chip langsung berada di posisi pulih; jangan menyisakan override lokal,
  double marker, atau menjalankan animasi langkah mundur dari posisi sebelum void.
- Jika snapshot sudah mencakup roll pengganti atau movement yang lebih baru, lanjutkan visualnya dari
  `activeMovement` dan waktu server sesuai Bagian 9.3. Jangan reset ke posisi final DB atau membatalkan animasi baru
  hanya karena event void sebelumnya memicu refetch. Terapkan buffered events setelah batas sequence snapshot.

## 10. Keamanan, reliability, dan target nonfungsional

- Password di-hash Argon2id/bcrypt dengan cost memadai. Access token short-lived; refresh token rotasi/revocation,
  cookie HttpOnly/Secure/SameSite sesuai domain. HTTPS/WSS wajib; CORS allowlist dan CSRF bila cookie auth untuk write.
- Helmet, rate limit login/pairing/write sensitif, schema validation, payload limit, parameter binding,
  least privilege DB, dan request ID wajib sesuai PRD. Display token read-only, scoped, expiring, revocable.
- Jalur publik hanya snapshot/replay/socket game operasional; tidak menerima write dan tidak mengungkap
  credential, actor, audit atau lease. Session display lama tidak dapat membaca arsip.
- Pada API kompatibilitas, penerbitan kode pairing hanya oleh Super Admin. Jangan cetak token sensitif di LED, simpan permanen di URL publik/analytics,
  atau paparkan password/token pada source, audit, log, maupun Socket event. Kode pairing sementara dan cookie
  session mengikuti Bagian 8.3; expiry tidak boleh diasumsikan cukup untuk event tanpa verifikasi jadwal.
- Audit memuat actor, action, before/after ringkas, reason koreksi, request ID, timestamp, dan IP terbatas.
  Winston menulis JSON `level/message/timestamp` dengan daily rotation di `backend/src/logs/`.
  Catat error level error, external API endpoint/latency, awal/akhir/gagal transaksi, critical flows level info.
  `console.log` hanya boleh untuk diagnostik startup; secrets direduksi.
- Saat disconnect, tombol write admin disabled; display mempertahankan snapshot terakhir dan status koneksi pada judul/ARIA.
  Tidak ada optimistic movement offline. Restart memakai persisted timeline dan job expiry/outbox idempotent.
- Deployment awal satu Node persistent + MySQL persistent + reverse proxy TLS, backup otomatis, secret environment,
  logs/metrics; health `/health/live` dan `/health/ready` memeriksa DB/publisher/worker settlement sesuai perannya.
- Serverless function biasa tidak diasumsikan mampu mempertahankan Socket.IO. Multi-instance memerlukan adapter
  lintas instance; sticky session bila long-polling aktif. Schema/event rollout memerlukan kompatibilitas dan versi.

| Target dari PRD | Kondisi verifikasi | Status bukti |
|---|---|---|
| P95 write API <1.000 ms | Jaringan uji stabil; tidak termasuk durasi animasi | Harness rehearsal tersedia; angka harus berasal dari output run, bukan estimasi |
| Realtime terlihat <1.500 ms sejak commit | Ukur commit→browser termasuk refetch snapshot publik | Belum dibuktikan pada flow publik saat ini/venue |
| Rehearsal 60 menit tanpa double transaction | 10 tim, 5 akun Super Admin, 3 display publik; termasuk reconnect | Simulasi otomatis singkat tersedia; belum menggantikan rehearsal 60 menit |
| Keterbacaan venue | LED 1920×1080, jarak terjauh rencana penonton, grayscale/kontras rendah | Belum diuji |

Sebelum event: backup, rehearsal, jaringan utama/cadangan dan uji reconnect. Ketersediaan harness/test
tidak membuktikan target rilis sudah tercapai; batas bukti: [acceptance/rehearsal](docs/acceptance-and-rehearsal.md).

## 11. Commands dan keterbatasan eksekusi

Semua perintah shell memakai prefix `rtk`; gunakan `rtk proxy <command>` jika belum didukung langsung.
Jalankan dari root workspace. Perintah inspeksi yang tersedia:

```powershell
rtk --version
rtk rg --files --hidden -g '!.git/**' -g '!node_modules/**'
rtk rg -n '^(#|##|###) ' docs/PRD.md
rtk proxy powershell -NoProfile -Command "Get-Content -Encoding UTF8 -LiteralPath 'SPEC.md'"
```

Periksa `rtk git status --short` sebelum mengubah file dan pertahankan perubahan pengguna. Dokumen/source
untracked diperiksa terhadap baseline sebelum edit; jangan menganggap `git diff` mencakup file untracked.

| Kebutuhan | Perintah aplikasi yang terverifikasi |
|---|---|
| Install/setup dependency | `rtk proxy npm ci --ignore-scripts`; browser `rtk proxy npm run test:e2e:install` |
| Dev frontend/backend | `rtk proxy npm run dev`; terpisah: `rtk proxy npm run dev --workspace frontend` atau `rtk proxy npm run dev --workspace backend` |
| Build | `rtk proxy npm run build` |
| Lint/static checks | `rtk proxy npm run lint`; tidak ada script TypeScript/type-check |
| Unit/component | `rtk proxy npm test` |
| Persistence integration | `rtk proxy npm run test:integration`; schema disposable `lr_test_*` |
| Coverage/E2E | `rtk proxy npm run test:coverage`; `rtk proxy npm run test:e2e` |
| Smoke publik/admin | `rtk proxy npm run test:display:browser`; `rtk proxy node scripts/smokeSimpleAdmin.js` |
| Migration | Sequelize CLI dan konfigurasi aktual; perintah lengkap di README bagian Migration Database |
| Seed demo | `rtk proxy npm run seed:demo`; menulis game development sesuai konfigurasi, bukan preview tanpa data |

Daftar berasal dari manifest root/backend/frontend. `db:migrate:test` hanya memvalidasi guard nama schema;
integration test benar-benar menerapkan migration. Ikuti README untuk konfigurasi dan bootstrap admin;
jangan menjalankan seed/reset/restore pada data event hanya untuk memverifikasi dokumentasi.

## 12. Testing strategy dan success criteria

### 12.1 Strategi

Vitest dengan provider Istanbul/backend dan V8/frontend, serta Playwright E2E ditetapkan pada ADR-001.
Lokasi backend `backend/src/tests/`, frontend `frontend/src/__tests__/`, E2E `e2e/`, JavaScript/JSX.
Hint coverage memakai syntax provider terpilih dengan alasan spesifik; contoh c8 tidak dipakai pada provider V8.
Runner/config sudah tersedia. Hasil run dan keterbatasannya mengikuti baseline pada task list.

| Level | Perilaku yang harus dibuktikan |
|---|---|
| Unit/domain | Dice input, wrap-around sirkuit, penalti tunggal, round-robin, mode scoring, nilai 0/batas, ranking/invariant |
| Integration + MySQL terisolasi | Commit/rollback, lock/concurrency, unique constraints, idempotent replay, ledger/score, outbox |
| API/auth contract | Envelope/meta/header, centralized errors, state/version, role/lease/scope, invalid mode/input |
| Realtime recovery | Join authorization, subscribe/snapshot race, gap/duplicate/out-of-order, crash/restart, token expiry |
| Frontend/component | Form mode/konfirmasi, loading/error/success, disconnected writes, cluster/board minimal, long names |
| E2E browser | Root publik→admin satu halaman→start→roll→hasil/penalti→reset→board pindah sesi; URL kontrol lama untuk pause/finish/void |
| Venue/load/rehearsal | Latency, 60 menit, LED/jarak nyata, grayscale, reduced effects, backup/reconnect |

Setiap fungsi yang diuji mencakup sukses, gagal, dan edge case yang relevan; assertions memeriksa output atau
side effects nyata. Jangan menguji implementation details atau hanya membandingkan konstanta.
Database test wajib terisolasi; jangan menjalankan destructive setup di database bersama/produksi.

Coverage minimum: statements/lines **90%**, functions **90%**, branches **85%**. Ignore hanya untuk
startup/bootstrap, external library behavior, atau nondeterministic logic dengan alasan spesifik dan syntax tool
yang didukung. Tidak boleh skip/delete tests, menurunkan threshold, atau menambah suppression untuk mendapatkan pass.

Fast checks saat edit, affected tests pada task boundary, integration pada feature boundary, full release checks
pada gate rilis. Spec/dokumentasi diverifikasi melalui fakta, referensi, contoh, dan konsistensi kontrak;
test runtime yang belum tersedia tidak dinyatakan lulus.

### 12.2 Matriks penerimaan yang mengikat

Seluruh **FR-01–FR-23** dan **AT-01–AT-69** pada PRD berlaku. Pengelompokan berikut adalah indeks verifikasi,
bukan klaim semua skenario telah lulus. Hasil aktual serta gate tertunda mengikuti task list dan laporan acceptance.

| Acceptance PRD | Kriteria sukses ringkas | Kapabilitas |
|---|---|---|
| AT-01–AT-03 | 1/11 tim ditolak; board tidak lengkap/duplikat gagal; 10 tim mulai START dengan urutan benar | `game-setup`, `race-display` |
| AT-04–AT-08 | Path normal/wrap-around sirkuit/penalti persis Bagian 4.2; tidak ada chain penalty | `turn-movement` |
| AT-09–AT-10 | BUTTON SUCCESS sesuai server; FAIL 0 tetap satu hasil | `scoring-results` |
| AT-11–AT-13 | Concurrent roll/hasil dan retry key sama hanya satu efek bisnis | `turn-movement`, `scoring-results` |
| AT-14–AT-16 | Reconnect/dedup/gap pulih; roll saat animasi ditolak | `realtime-recovery`, `turn-movement` |
| AT-17–AT-20 | Pending menolak finish; final immutable; skor menentukan juara dan seri tertinggi berbagi rank 1 | `scoring-results` |
| AT-21–AT-23 | Write publik/session display ditolak auth; tanpa lease 409; outbox memulihkan commit sebelum emit | `identity-access`, `turn-movement`, `realtime-recovery` |
| AT-24–AT-26 | Origami MANUAL 20/SUCCESS 5/FAIL 0; kotak 44 MANUAL 35 tanpa bonus | `scoring-results` |
| AT-27–AT-32 | Invalid manual/mode ditolak; konflik mode satu hasil; 0 tersimpan tanpa ledger; retry/koreksi diaudit | `scoring-results` |
| AT-33–AT-41 | Cluster 1–10 tim, occupancy saat motion/reconnect, komposisi minimal, reduced motion akurat dan terbaca | `race-display`, `realtime-recovery` |
| AT-42–AT-44 | Chip terbaca di seluruh kategori; 4/6/10 tim → +1/+3/+7; active team terlihat tanpa double-count | `race-display` |
| AT-45–AT-48 | Token/path normal/wrap-around sirkuit/mundur jelas di dalam board; highlight tidak mengubah skala/urutan grid | `race-display` |
| AT-49–AT-54 | LED/venue/grayscale/nama panjang terbaca; reduced motion OS dan reconnect mempertahankan state | `race-display`, `realtime-recovery` |
| AT-62–AT-68 | Root tanpa pairing, DTO publik aman, admin satu halaman, reset atomik/idempotent, arsip immutable, pindah sesi otomatis dan STARTING tanpa teleport | `identity-access`, `game-setup`, `race-display`, `realtime-recovery` |
| AT-69 | Kategori lengkap tetap terlihat pada enam viewport/cluster/gerakan; mobile menambah tinggi tanpa overlap | `race-display` |
| AT-55–AT-58 | Reward tanpa instruksi lolos; BUTTON/MANUAL normal tanpa bukti/bonus/validasi kegiatan | `game-setup`, `scoring-results` |
| AT-59–AT-61 | Challenge tetap offline; instruction opsional; Reward resolved dapat finish tanpa kelengkapan narasi | `scoring-results`, `realtime-recovery` |

Tambahan bukti wajib sesuai PRD/rules: invariant `total_score=SUM(ledger)`, state version/sequence monotonic,
row lock rollback, isolasi multi-game, authorization server, metadata JSON di tempat benar, dan target Bagian 10.
Produk baru siap rilis setelah acceptance, quality bar, runtime, keamanan, operasional, dan venue QA terbukti;
selesainya spesifikasi tidak membuktikan implementasi atau rilis siap.

### 12.3 Acceptance tambahan hasil validasi evaluasi

ID `R-*` melengkapi AT PRD tanpa mengganti atau menomori ulang baseline. Test yang tersedia dan hasil run
terdahulu ada pada task list; tabel ini menetapkan hasil wajib, bukan status eksekusi.

| ID | Skenario dan hasil wajib |
|---|---|
| R-01 | Tanpa HTTP request, worker menyelesaikan movement jatuh tempo; sesudah restart, path/timeline durable yang sama dipakai dan transisi/event bisnis hanya sekali |
| R-02 | Worker terlambat; snapshot/heartbeat/command memicu settlement. Command berikutnya gagal STALE_STATE tetapi settlement tetap committed dan tampil di snapshot |
| R-03 | Timer/sweeper/request konkuren menghasilkan satu transisi; waktu client salah tidak menyelesaikan movement sebelum deadline UTC database |
| R-04 | Pause di AWAITING_RESULT lalu resume mempertahankan turn/tim/pending result; race pause/result mengikuti urutan lock dan expected version pada Bagian 4.4 |
| R-05 | Salah dadu non-Indisipliner/penalti terakhir di-void: posisi kembali ke asal, tim yang sama READY_FOR_ROLL, game tetap RUNNING/PAUSED, turn/event/version tidak mundur |
| R-06 | Void turn berpoin menambah satu kompensasi; hasil 0/tanpa hasil tanpa ledger nol. Retry void tidak menambah kompensasi; roll pengganti memakai turn baru |
| R-07 | Void setelah roll berikutnya, setelah koreksi terkait, saat movement aktif, atau sesudah FINISHED ditolak. Race void/roll/result/finish tidak menghasilkan state campuran |
| R-08 | API pairing kompatibilitas menolak kode expired/reused/revoked atau scope salah; attempt budget berlaku. Expiry/revoke menghentikan REST dan socket lama. Board `/` tetap tanpa pairing dan hanya membaca game operasional |
| R-09 | Dua create game dengan key/scope sama menyimpan tepat satu game/receipt; payload berbeda ditolak; rollback tidak meninggalkan game yatim |
| R-10 | Key game sama oleh admin berbeda tidak menjadi intent kedua; replay yang sah tetap bekerja sesudah state/version berubah; key baru pada turn resolved menghasilkan ALREADY_RESOLVED |
| R-11 | Setup saat READY mengubahnya menjadi DRAFT; Start ditolak sampai konfigurasi baru lolos preflight |
| R-12 | Roll 10 selesai, roll 11 di-void: void roll 10 tetap ditolak. Roll pengganti 12 mendapat ID/nomor baru dan dapat di-void jika eligible; VOIDED tidak pernah menjadi target lagi atau mendapat kompensasi kedua |
| R-13 | TURN_VOID tanpa movement baru mereset posisi visual, cluster dan leaderboard dari snapshot yang mencakup void, tanpa animasi mundur/double marker; callback lama tidak mengubahnya lagi |
| R-14 | TURN_VOID duplikat, snapshot terlambat, atau snapshot sudah memuat roll pengganti: versi/sequence tidak mundur, movement baru dilanjutkan sesuai waktu server dan event lanjutan tetap terpasang |

Strategi replay credential mengikuti ADR-002. Regression session/pairing kompatibilitas dipertahankan;
R-08 tidak menjadikan pairing sebagai langkah akses publik. Gate runtime dibuktikan oleh run, bukan walkthrough desain.

## 13. Boundaries

### Selalu dilakukan

- Baca rules dan kontrak PRD yang terkait; gunakan perubahan terkecil dan pertahankan perubahan pengguna.
- Validasi seluruh external input, authorization/scope dan invariant di server, termasuk jobs.
- Gunakan transaksi, lock, idempotency, immutable ledger, audit, dan publish setelah commit pada mutasi penting.
- Perbarui caller, shared contract, migrations, tests, dan dokumentasi yang benar-benar terdampak.
- Verifikasi sesuai dampak, laporkan command/hasil/batas bukti, dan periksa perubahan akhir.
- Gunakan migrations dan database test terisolasi; simpan secrets di konfigurasi aman.

### Tanyakan dahulu jika keputusan/otorisasi belum tersedia

- Perubahan scope, perilaku publik, aturan permainan, keamanan, atau integritas data yang tidak diputuskan PRD.
- Konflik antar-rules, nilai produk yang belum ditentukan, atau interpretasi material pada Bagian 14.
- Operasi destruktif, akses/mutasi data produksi, merge, atau deploy yang belum diotorisasi.
- Dependency/infrastruktur/kontrak tambahan di luar kebutuhan yang disetujui; pilihan teknis rutin dalam
  scope yang sudah disetujui tidak memerlukan konfirmasi ulang.

### Tidak boleh dilakukan

- Menghitung hasil gerakan/skor authoritative di browser, emit sebelum commit, atau menerima write dari display.
- Menggabungkan BUTTON+MANUAL, memberi bonus otomatis pada MANUAL/Reward, atau membuat hasil kedua per turn.
- Mengedit/menghapus ledger bisnis, memutus seri dengan posisi/order, atau auto-finish/reopen final.
- Menjadikan aktivitas/bukti/instruksi Reward prasyarat operasional aplikasi.
- Menyembunyikan failure, mengekspos secrets/stack, melemahkan tests/rules/coverage, atau mengklaim check belum jalan lulus.
- Menambah fitur, refactor, scaffold, tooling, policy, atau perubahan panduan yang tidak diperlukan tugas.

## 14. Keputusan terbuka dan kesiapan handoff

Gunakan keputusan yang sudah diterapkan berikut; jangan membukanya kembali karena catatan planning awal.
Pengesahan sumber data, perangkat venue dan quality gate rilis tetap memerlukan bukti tersendiri.

| ID | Keputusan yang diperlukan | Kapabilitas terdampak / gate |
|---|---|---|
| D-01 | Tertutup: Node 26.13.0/npm 11.3.0, JavaScript/JSX, Zod/Vitest/Playwright; manifest/lockfile terpasang | ADR-001; implementasi G1 |
| D-02 | Tertutup: admin opaque access 15 menit, refresh rotasi 7 hari; CLI bootstrap. Publik tanpa pairing; session display lama hanya kompatibilitas | ADR-002; §8.2–8.3; single-game |
| D-03 | Tertutup G10: MANUAL integer 0–200; konfirmasi browser untuk 0 atau >50; Origami kotak 26 default MANUAL | ADR-004; validator/form aktif |
| D-04 | Tertutup G12: delta integer bukan nol −1000…1000, total ≥0; RUNNING/PAUSED non-arsip tanpa animasi, alasan/konfirmasi/versi; referensi scoped | score-history-and-correction; §8.1 |
| D-05 | Tertutup G0: retention selama umur game, replay tanpa plaintext credential, matriks create/conflict/error ADR-002 | G3/G4/G6 membuktikan receipt |
| D-06 | Tertutup G0: seluruh UUID CHAR(36), constraints/indexes, DTO, pagination 100/500, snapshot fallback, migration additive ADR-003 | G3/G4/G7/G18 membuktikan storage/recovery |
| D-07 | Tertutup G5/G11/G13: JSON board v1, duplikasi konfigurasi hanya API kompatibilitas; competition ranking 1,1,3 dan 1,2,2,4; format CSV ditetapkan | game-launch; csv-export; ranking server |
| D-08 | Workbook sumber asli, aset logo resmi dan validasi referensi visual; perangkat/browser/jarak venue serta metode ukur latency/rehearsal | `game-setup`, `race-display`; sebelum verifikasi seed final/brand/venue |

PRD dan SPEC sama-sama memuat flow aktif: satu game, board publik, admin empat bagian, reset/arsip,
kontrak void dan batas poin/koreksi. API katalog/duplikasi/pairing masih ada untuk kompatibilitas;
keberadaannya bukan requirement mengembalikan UI lama atau membuka sesi arsip ke publik.

G1–G18 dan simplifikasi tersedia di source. Implementasi tidak sama dengan semua gate rilis terpenuhi:
coverage penuh, regresi auth gabungan yang masih gagal, kompatibilitas MySQL produksi, rekonsiliasi workbook,
aset resmi, screen reader, rehearsal 60 menit dan pembacaan LED/jarak venue mengikuti bukti pada
[task list](tasks/todo.md) dan [laporan acceptance](docs/acceptance-and-rehearsal.md).
Penundaan gate berhenti pada checkpoint G11 sesuai AGENTS.md; threshold/test/assertion tidak boleh dilemahkan.
Merge/deploy dan operasi destruktif data bersama memerlukan otorisasi tersendiri.

Acuan keputusan: [ADR-001](docs/decisions/001-toolchain.md), [ADR-002](docs/decisions/002-identity-command.md),
[ADR-003](docs/decisions/003-state-event.md), [ADR-004](docs/decisions/004-manual-scoring.md).
