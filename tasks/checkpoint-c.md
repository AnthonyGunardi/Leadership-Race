# Bukti integrasi — Checkpoint C

**Tanggal:** 11 November 2026. **Hasil:** I06/I07 selesai dan Checkpoint C terverifikasi lokal.
Kelanjutan [Checkpoint B](checkpoint-b.md), dikerjakan tanpa skill/workflow tambahan.
Status ini memisahkan implementasi lokal dari kesiapan rilis production.

## Implementasi I06

- [Modul LR](../../be-poin-peserta/apps/leadership-race/README.md) mengintegrasikan controller lease 30 detik:
  acquire, heartbeat, takeover terkonfirmasi, rotasi hash token, dan replay receipt AES-GCM memakai config modul.
  Lease hanya mengatur input dadu; Super Admin lain tetap dapat memberi hasil poin.
- Roll menerima dadu fisik 1–6, expected version/turn serta token controller. Engine server menghitung normal/bounce
  dan satu penalti; paths/timeline UTC, posisi, turn, audit/event/outbox dan receipt disimpan atomik.
  Step 450 ms dan offset awal nominal 400 ms mengikuti source. Target timing produksi tetap perlu rehearsal I11.
- Settlement mengunci game→turn→team, memakai UTC database dan transaksi sistem tersendiri. Challenge berubah menjadi
  AWAITING_RESULT; penalti selesai otomatis dan berpindah tim tanpa hasil poin. Pemicu konkuren menjadi no-op setelah
  transisi pertama. Settlement tetap committed jika command berikutnya gagal STALE_STATE.
- Snapshot admin/publik, reset dan command movement/lifecycle menjalankan recovery in-band setelah auth/scope.
  Arsip tidak disettle ulang. Pemeriksaan public current-game tetap di dalam transaksi pembacaan final/replay.
- Worker dimiliki runtime LR, dibuat sesudah flag aktif dan schema siap. Startup scan tidak menunggu HTTP;
  sweep periodik 500 ms memproses maksimal 50 record, satu sweep aktif dan satu owner per pool/proses.
  Timer per game hanya percepatan. Stop membatalkan timer dan menunggu sweep/callback aktif sebelum melepas owner.
- Command dan settlement memakai helper session lock timeout dua detik yang dipulihkan sebelum koneksi kembali ke
  pool. Error worker menurunkan readiness; kegagalan factory worker tidak dilaporkan sebagai kegagalan database.
  Runtime tidak menambah signal handler, server, pool, atau lifecycle aplikasi lain.

## Implementasi I07

- BUTTON SUCCESS memakai poin cell server; FAIL=0. MANUAL integer 0–200 adalah total poin, tanpa bonus atau
  penilaian aktivitas. Payload strict menolak campuran metode, evidence dan field milik browser.
  Satu challenge result per turn; hasil nol tersimpan tanpa ledger nol. Retry receipt tidak mengulangi efek.
- Pause/resume mempertahankan turn dan pending result. Roll/scoring saat PAUSED ditolak 423. Finish manual
  terkonfirmasi menolak movement/pending, menyimpan final results, serta memakai competition ranking dan co-winners.
  FINISHED menolak mutasi baru; receipt sukses tetap dapat di-replay.
- Void mengikuti SPEC §4.6/R-05–R-07/R-12: hanya roll committed terakhir yang eligible, termasuk pemeriksaan
  successor VOIDED; tanpa active movement/koreksi terkait. Posisi dan tim dipulihkan, nomor turn tidak mundur,
  dan hasil berpoin dikompensasi sekali lewat ledger negatif yang menunjuk entry asli. Record lama tetap tersimpan.
- Koreksi memvalidasi game/team/turn/result/entry yang dirujuk, menolak total negatif/overflow dan menulis delta,
  audit serta outbox atomik. Entry ledger asli tidak diedit/dihapus. History/CSV admin tetap dapat membaca arsip.
- History, leaderboard, final results dan CSV memakai snapshot transaksi REPEATABLE READ. Filter audit dilakukan
  sebelum pagination. CSV mendukung all/standings/results/turns/ledger, filter tim, UTF-8 BOM, escaping RFC4180,
  formula sanitization dan delta negatif tanpa mengubah data tersimpan.

## Adaptasi yang diperlukan

- Semua service memakai model berprefix, DB/config/logger yang diinjeksi; tidak mengimpor bootstrap sumber,
  logger/config global, JWT bersama atau Socket.IO. Route sumber dipertahankan di bawah `/leadership-race/api/v1`.
- Ekspor ledger sumber memakai converter non-negatif untuk delta signed; diadaptasi agar koreksi/kompensasi negatif
  tetap dapat diekspor. Filter standings CSV juga diterapkan ke tim yang diminta.
- Audit void menyimpan status sebelum perubahan. Alasan lengkap tetap di turn/audit; reason ringkas ledger dibatasi
  kapasitas kolom. Ledger hasil yang hilang/tidak konsisten menolak void dan membatalkan transaksi.
- Query JSON audit memakai atribut JSON ORM yang cocok dengan Sequelize host 6.29.2, bukan fungsi JSON yang membuat
  path ter-escape ganda. Pagination tim dibuktikan dengan SQL nyata.
- Dua script test LR membatasi concurrency ke empat proses. Suite serentak sebelumnya membuat CLI migrasi isolated
  melewati timeout 30 detik. Timeout, assertions, cakupan source dan threshold tidak diturunkan.
- Test reset B kini memeriksa kedua urutan pemenang yang sah untuk key A/A/B: A menang memberi 200/200/409,
  B menang memberi 409/409/200. Keduanya wajib satu pengganti/arsip dan replay key pemenang yang sama.

## Verifikasi yang dijalankan

| Pemeriksaan | Hasil |
|---|---|
| Suite LR melalui helper coverage C | 87/87 lulus, tidak ada skip/todo |
| Native Node coverage, seluruh runtime LR | Lines 99.27%, functions 99.49%, branches 93.68%; gate 90/90/85 lulus |
| AST/Istanbul dari V8, 61 file runtime LR | Statements 98.40%, lines 98.59%, functions 99.49%, branches 89.58%; gate 90/90/90/85 lulus |
| `rtk npm run test:reports` | 89/89 lulus |
| Audit C | 208 file host/perubahan awal + 26 file fondasi LR + 16 input source; changed=[] |
| Lint/syntax | 88 file JS/CJS modul/test: 0 error; helper coverage C lolos syntax check |
| Whitespace/referensi | Diff check kedua repository dan seluruh tautan lokal laporan/checklist lulus |
| Cleanup | Tidak ada schema `lr_test_checkpoint_a_*` tersisa |

Database test adalah MariaDB 10.4.32 loopback, Node 26.13.0/npm 11.3.0, dengan dependency host aktual.
Tidak ada dependency baru, perubahan lockfile, model/schema/migrasi baru pada C. Test memakai sebelas migrasi LR
dan database disposable yang dibersihkan; tidak menjalankan migrasi root atau koneksi production.

Pengujian meliputi lease concurrent/takeover/expiry/replay/key hilang, dadu invalid dan paths bounce/penalti,
roll race, settlement request/worker/timer, stale command sesudah settlement, autonomous startup/periodic recovery,
batch 50/52, double worker/disposal saat callback/factory berjalan, serta fault scan/audit/deadlock.

I07 diuji melalui route Express host: BUTTON vs MANUAL, Origami 20/7/5/0, cell 44 manual 35, manual nol/batas 200,
pause vs result, void paid/zero/pending/penalty, successor VOIDED, koreksi silang ID, score below zero, final ties,
race void vs result/roll/finish, dan rollback audit sesudah writes. Assertions membandingkan total tim dengan jumlah
ledger, event sequence contiguous, jumlah outbox, record asli, arsip serta error/log tanpa credential.
Fault injection hanya dipakai untuk jalur kegagalan; transaksi dan concurrency utama memakai database nyata.

## File dan bukti

- Production: `apps/leadership-race/module.js`, `runtime.js`, routes/controllers/validation, services controller,
  turn/settlement/worker, lifecycle, correction/history/CSV, domain movement/CSV dan helper transaksi.
- Harness: `tests/leadership-race/` beserta fixture runtime, serta dua script LR dalam root `package.json`.
- [Baseline C](../../be-poin-peserta/apps/leadership-race/checkpoint-c-baseline.json),
  [audit C](../../be-poin-peserta/apps/leadership-race/checkpoint-c-audit.json),
  [coverage C](../../be-poin-peserta/apps/leadership-race/checkpoint-c-coverage.json).
- [Helper coverage](verify-checkpoint-c.mjs) memakai tooling sumber yang sudah terpasang dan memeriksa semua file
  runtime. Tidak ada ignore/suppression baru atau runtime import production ke sibling repository.

Audit C membandingkan hash app.js, lockfile, semua file host terlindungi dan fondasi LR. Pada package.json hanya
dua string script LR yang dinormalisasi di memori untuk membolehkan flag concurrency. Dependency, script host lain
dan line endings asli tetap sama. Baseline/audit A/B tetap historis dan tidak diubah untuk meloloskan C.

Dari root `be-poin-peserta`:

```powershell
rtk npm run test:leadership-race:coverage
rtk npm run test:reports
rtk proxy node tests/leadership-race/checkpointCAudit.cjs
```

Dari root `Leadership-Race`, dengan tooling sumber terpasang dan raw directory `.coverage-v8-c/` modul kosong:
`rtk proxy node tasks/verify-checkpoint-c.mjs`. Raw coverage adalah artefak lokal yang diabaikan Git.

## Batas rilis dan tahap berikutnya

- Modul tetap default disabled. Tidak ada akun/seed/migrasi database bersama, restart, merge, deploy atau aktivasi.
- `app.js` tidak berubah sejak A; server/middleware global/common/socket dan folder aplikasi lain tetap utuh.
  Event baru hanya masuk tabel event/outbox; publisher/gateway/socket belum dipasang dan readiness masih 503.
- I08 memerlukan persetujuan Socket.IO eksplisit. Frontend/proxy I09, CLI/backup I10, rehearsal/SLO bersama I11,
  dan cutover I12 tetap terbuka. Tidak mengklaim realtime atau kompatibilitas semua workflow production sudah diuji.
- Topologi satu pool/proses dipakai untuk ownership worker lokal. Jumlah instance, runtime/MySQL deployed,
  domain/HTTPS, kapasitas pool dan dampak beban bersama harus dikonfirmasi sebelum aktivasi production.
  Hasil MariaDB lokal tidak menggantikan staging MySQL/venue atau target latensi produksi.

Acuan: [plan I06/I07](plan.md), [PRD](../docs/PRD.md) §3.2–3.5/4.1/5/9–10/13–15,
[SPEC](../SPEC.md) §4.2–4.6/7–8/12, rules
[10](../.agents/rules/10-fullstack-general-standards.md),
[20](../.agents/rules/20-backend-node-express-sequelize.md),
[40](../.agents/rules/40-testing-standards.md).
