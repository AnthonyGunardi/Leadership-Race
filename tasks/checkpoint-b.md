# Bukti integrasi — Checkpoint B

**Tanggal:** 11 November 2026. **Hasil:** I04/I05 dan Checkpoint B selesai serta terverifikasi lokal.
Implementasi dilanjutkan dari [Checkpoint A](checkpoint-a.md), tanpa skill/workflow tambahan.
Hasil ini belum merupakan aktivasi atau persetujuan rilis production.

## Implementasi

- [Modul production](../../be-poin-peserta/apps/leadership-race/README.md) tetap dipasang pada `/leadership-race`.
  `app.js` sama persis dengan hasil A; middleware/CORS global, server, socket dan folder aplikasi lain tidak diubah.
  Database/config/logger diinjeksi ke service; tidak ada pool atau server baru.
- I04: bootstrap service admin lokal dengan audit, bcrypt cost 12/batas UTF-8 72 byte, opaque access token
  15 menit dan refresh tujuh hari. Database menyimpan hash token. Cookie `__Host-lr_admin_refresh` memakai
  HttpOnly, Secure, SameSite=Lax, Path=/ tanpa Domain. JWT aplikasi lain tidak mengotorisasi LR.
- Refresh diputar dengan lock transaksi. Reuse mencabut seluruh keluarga session setelah commit.
  Origin, input strict, rate limit, revocation/expiry dan status akun diperiksa server.
  Limiter/store dibuat per instance modul dan dibersihkan hanya oleh lifecycle modul tersebut.
- I05: current game tunggal, preview publik sebelum initialization, setup 2–10 tim, template PRD 50 kotak,
  import board strict, preflight READY, snapshot admin/publik, replay, reset dan pagination arsip.
  Draft boleh menyimpan board belum lengkap; READY memerlukan 50 kotak dengan komposisi kategori PRD.
- Command mempertahankan game lock, version check, request hash kanonik, actor/scope/key receipt dan transaksi.
  Audit, event, outbox serta receipt commit bersama state. Timeout session dipulihkan sebelum koneksi kembali ke pool.
  Tidak ada publisher atau event Socket.IO yang diaktifkan.
- Reset membuat konfigurasi baru dengan ID baru dan posisi/skor nol, mengarsipkan sesi lama, serta mengganti
  singleton secara atomik. Turn/hasil/final-result/ledger lama tetap tersimpan; arsip menolak mutasi baru.
  Retry reset yang sudah berhasil tetap dapat membaca receipt aslinya.
- DTO publik hanya berisi game, teams, boardCells, turnStatus, activeMovement dan leaderboard. Replay publik
  membawa invalidation dengan payload kosong. Pemeriksaan current-game dan replay berada dalam snapshot transaksi
  yang sama; ID arsip atau game lain ditolak.
- Kontrak URL sumber dipertahankan dengan tambahan mount prefix: `/leadership-race/api/v1/auth/*`,
  `/leadership-race/api/v1/games/*`, `/leadership-race/api/v1/public/*`.

## Adaptasi dan batas tahap

Service sumber dipindahkan hanya untuk kapabilitas B. Start/pause/resume/finish, roll, judging, controller,
settlement dan movement worker belum dipasang. Snapshot memproyeksikan gameplay tersimpan untuk kompatibilitas,
tetapi belum melakukan settlement sebagai efek samping baca; settlement/pemulihan otomatis termasuk I06.
Tidak ada request B yang memulai gerakan baru. Readiness permainan tetap 503 karena worker/publisher belum ada.
Gate persistence tersendiri memungkinkan auth/setup diuji tanpa menyatakan game siap dimainkan.

Config/logger global sumber diganti parameter modul. Error boundary hanya menerima vocabulary publik dari error
lokal dan menyembunyikan detail driver/SQL. Cookie parser hanya mendekode cookie LR; cookie malformed milik aplikasi
lain tidak merusak refresh LR. Transaction log mencatat start/commit/failure tanpa payload atau credential.

Dependency baru hanya Zod **4.6.7**, sesuai versi sumber yang terpasang. Instalasi memakai `--ignore-scripts`,
lockfile v2 dan cache lokal modul; seluruh dependency lama tetap sama. Express 4.22.1, Sequelize 6.29.2,
mysql2 3.14.1, bcrypt 6 dan express-rate-limit 8.6.2 memakai instalasi host.

## Verifikasi

| Pemeriksaan | Hasil |
|---|---|
| Seluruh suite LR + native coverage | 63/63 test lulus; tidak ada skip/todo |
| Native Node coverage | Lines 99.77%, functions 99.65%, branches 96.33%; gate 90/90/85 lulus |
| AST/Istanbul dari V8, seluruh 49 file runtime LR | Statements 99.20%, lines 99.45%, functions 99.64%, branches 92.15%; gate 90/90/90/85 lulus |
| Reports regression sesudah penambahan dependency | 89/89 test lulus |
| Audit scope B | 205 file terlindungi utuh, app.js sama dengan hasil A, dependency lama tidak berubah |
| Syntax dan lint | 65 file JS/CJS modul/test; 0 error, tanpa suppression |
| Cleanup dan whitespace | Tidak ada schema test checkpoint tersisa; diff check kedua repository lulus |

Native runner tidak menyediakan metrik statements terpisah.
[verify-checkpoint-b.mjs](verify-checkpoint-b.mjs) menjalankan runner aktual lalu mengonversi data V8 dengan
`ast-v8-to-istanbul`, parser Vite dan library coverage yang sudah terpasang di proyek sumber. Helper menolak file
runtime yang tidak terukur. Tidak ada dependency tooling baru di production, ignore, penurunan threshold atau
runtime import ke sibling repository. Ringkasan:
[checkpoint-b-coverage.json](../../be-poin-peserta/apps/leadership-race/checkpoint-b-coverage.json).

Database test: MariaDB 10.4.32 loopback; Node 26.13.0/npm 11.3.0. Migrasi nyata dijalankan pada database unik
`lr_test_checkpoint_a_*` (nama helper dipertahankan dari A), kemudian database dihapus melalui cleanup.

Kasus utama yang diverifikasi:

- Login→me→refresh→logout, password salah, akun nonaktif, expiry/revocation, Origin, malformed/duplicate cookies,
  rate limit, JWT asing, audit dan log tanpa rahasia. Refresh bersamaan menghasilkan satu rotasi berhasil,
  lalu reuse mencabut access token lama maupun penerus.
- Current/reset concurrent menghasilkan satu game operasional/pengganti. Stale version, key reuse dengan actor/body
  berbeda, foreign ID, duplicate team/order/cell, field score/position tambahan dan komposisi board invalid ditolak.
- Preflight gagal tidak membuat READY; edit READY kembali DRAFT. Template/import memiliki provenance yang tepat.
- Fault audit membatalkan setup/version/receipt/event/outbox bersama; retry key yang sama kemudian berhasil.
- Bounded deadlock/timeout, unique winner replay, AES-GCM receipt terikat actor/game/intent, key rotation dan missing
  key rollback. Failure-path injection tidak menggantikan SQL aktual pada test transaksi dan concurrency utama.
- Snapshot movement/pending/void/finished, co-winners seri, serta reset mempertahankan catatan turn/result/ledger lama.
  Koneksi pool tidak tertinggal dengan lock timeout command dua detik.
- Replay pagination/contiguity, future cursor, retention floor, event kosong/hilang, scope arsip dan DTO publik.
- Regresi fondasi A: migrasi disposable, constraint/registry host asli dan urutan middleware host dalam harness.

## Provenance dan pengulangan

[checkpoint-b-baseline.json](../../be-poin-peserta/apps/leadership-race/checkpoint-b-baseline.json) mencatat 22
fingerprint input sumber, revision sumber/host yang sama dengan A, hash app.js hasil A dan 205 file terlindungi.
Audit membandingkan seluruh manifest/lockfile lama setelah menghapus hanya delta Zod yang diizinkan dari objek
in-memory. Baseline A tetap historis dan tidak diubah untuk meloloskan B.

Dari root `be-poin-peserta`:

```powershell
rtk npm run test:leadership-race:coverage
rtk npm run test:reports
rtk proxy node tests/leadership-race/checkpointBAudit.cjs
```

Dari root `Leadership-Race`, dengan tooling sumber sudah terpasang dan direktori `.coverage-v8/` modul kosong:
`rtk proxy node tasks/verify-checkpoint-b.mjs`. Raw coverage diabaikan Git; ringkasan JSON menjadi bukti checkpoint.
Audit scope terpisah dari CI agar perkembangan sah aplikasi lain kelak tidak diblokir snapshot lama.

## Batas rilis

- Default disabled; tidak ada akun/seed database bersama, migrasi production, restart, merge, deploy atau aktivasi.
  Bootstrap CLI operator dan backup/restore tetap I10. I06/I07 belum dimulai.
- Socket.IO belum diubah; persetujuan eksplisit tetap diperlukan sebelum I08.
- Runtime/MySQL/settings, instance count, HTTPS/domain/proxy deployed serta staging/venue regression masih harus
  dikonfirmasi sebelum rilis. MariaDB lokal tidak membuktikan seluruh kondisi MySQL production.
- Origin harus diterima CORS host dan pemeriksaan LR. Cookie Secure memerlukan HTTPS saat frontend dihubungkan I09.
  Limiter memory lokal belum menjadi store lintas instance; topologi deployment tetap bagian gate rilis.

Acuan: [plan I04/I05](plan.md), [PRD](../docs/PRD.md) §8–9/13–15, [SPEC](../SPEC.md), rules
[10](../.agents/rules/10-fullstack-general-standards.md),
[20](../.agents/rules/20-backend-node-express-sequelize.md),
[40](../.agents/rules/40-testing-standards.md).
