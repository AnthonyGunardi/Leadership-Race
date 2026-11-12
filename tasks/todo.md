# Checklist implementasi backend Leadership Race

Detail pekerjaan, acceptance, dependency, verifikasi dan rollback setiap ID ada di [plan.md](plan.md).
Status berikut didasarkan pada [bukti A](checkpoint-a.md), [B](checkpoint-b.md), [C](checkpoint-c.md), dan [D](checkpoint-d.md).

- [x] I01 — Baseline/revision dan bridge lokal terverifikasi.
- [x] I02 — Modul, config/DB adapter, test harness dan boundary HTTP yang default disabled tersedia.
- [x] I03 — 18 model/21 tabel terisolasi; 11 migrasi dan metadata LR teruji pada schema disposable.
- [x] Checkpoint A — Registry, tabel dan lifecycle aplikasi lain utuh dalam verifikasi lokal.
- [x] I04 — Login/session/revocation, audit dan request ID terintegrasi dan diuji.
- [x] I05 — Setup, satu game publik, reset/arsip dan replay terintegrasi dan diuji.
- [x] Checkpoint B — Auth/setup/public/reset memenuhi scope dan transaksi pada database test lokal.
- [x] I06 — Controller, roll, settlement dan movement worker tanpa traffic terintegrasi dan diuji.
- [x] I07 — Scoring, void, finish, koreksi, history dan CSV terintegrasi dan diuji.
- [x] Checkpoint C — Idempotency/race, ledger, posisi dan histori terverifikasi pada database test lokal.
- [x] Gate Socket.IO — Persetujuan eksplisit untuk proposal §3 sudah tercatat.
- [x] I08 — Adaptasi namespace/gateway/outbox setelah gate Socket.IO terpenuhi.
- [x] Checkpoint D — Voting/toilet dan shared transport tidak terganggu aktivasi/dispose LR.
- [ ] I09 — Sesuaikan base API, socket, proxy/frontend path dan smoke tests.
- [x] I10 — Lengkapi CLI, readiness, metrics dan backup/restore terisolasi.
- [ ] Checkpoint E — Frontend dan alat operasi bekerja pada staging.
- [ ] I11 — Jalankan regresi, coverage, crash/recovery dan rehearsal beban bersama.
- [ ] Checkpoint F — Bukti acceptance dan batas rilis tercatat tanpa melemahkan quality bar.
- [ ] I12 — Siapkan cutover/rollback dan laksanakan hanya setelah otorisasi operasional tersedia.

## Bukti yang dicatat saat implementasi

Untuk setiap tahap, tambahkan revision, file berubah, command yang benar-benar dijalankan, hasil,
risiko yang belum selesai dan keputusan yang memengaruhi tahap berikutnya. Jangan menandai checkbox selesai
hanya karena source telah dipindahkan atau test belum dapat dijalankan.

## Batas tetap

- `app.js`/`server.js` production: hanya penambahan route LR.
- Folder aplikasi lain di `apps/`: tidak diubah.
- Socket.IO: izin eksplisit sebelum penyesuaian, meskipun common/socket tidak perlu diedit.
- Migrasi/test/seed: tidak menyentuh database bersama/production tanpa otorisasi operasi yang sesuai.
- Implementasi lokal mencapai Checkpoint D. Migrasi/test hanya pada schema disposable;
  tidak ada aktivasi production, seed, restart atau deploy.
