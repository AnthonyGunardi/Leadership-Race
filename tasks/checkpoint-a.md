# Bukti integrasi — Checkpoint A

**Tanggal:** 11 November 2026. **Hasil:** fondasi I02/I03 dan pemeriksaan Checkpoint A lulus secara lokal.
I01 masih parsial: versi/runtime, jumlah instance, proxy/domain serta kondisi deployment production belum
dikonfirmasi pengguna. Catatan ini tidak mengklaim kesiapan rilis atau seluruh tahap I01 telah selesai.

## Implementasi

- [app.js production](../../be-poin-peserta/app.js) mendapat import `leadershipRaceRoutes` dan satu mount
  `/leadership-race`, setelah CORS dan sebelum parser global. Tidak ada perubahan pada middleware, server,
  listen, Socket.IO atau urutan baris lama. Audit menghapus hanya dua statement tambahan dari salinan in-memory
  lalu mencocokkan hash dengan baseline, termasuk line endings asli.
- [Modul LR](../../be-poin-peserta/apps/leadership-race/README.md) berisi bridge CommonJS–ESM, factory sub-app,
  config/DB adapter, JSON/error/request-ID boundary, logger dan lifecycle resource lokal. Default disabled;
  disabled tidak memuat DB host. Tidak ada endpoint bisnis, worker, publisher atau gateway socket yang diaktifkan.
- Tujuh factory model sumber diadaptasi, ditambah index registrasi lokal: 18 nama global `LeadershipRace*`,
  21 tabel berprefix `leadership_race_`. Model User/Team/Cubicle host tidak dipakai sebagai alias model LR.
- Sebelas migrasi additive tersedia di modul, beserta config/runner dengan metadata
  `leadership_race_sequelize_meta`. Runner hanya menerima up/status, env eksplisit dan path modul tetap.
  Test mode menolak DB non-`lr_test_*` serta host non-loopback. Semua down memiliki guard DB disposable.
- [package.json production](../../be-poin-peserta/package.json) menambah tiga script LR: test, coverage,
  dan migrate. Tidak ada dependency baru atau perubahan package-lock/config bersama.
- [Test LR](../../be-poin-peserta/tests/leadership-race/) mencakup HTTP boundary, config/log redaction,
  bootstrap/disposal, registry model, schema/constraints dan coexistence middleware.

## Baseline

| Item | Bukti lokal |
|---|---|
| Source revision | `7f0639e25d87a8b90b8fcbfe41254ab7b421e170` |
| Host revision | `142108d28db18d1c9b56776840b3ef0febdbfd61` |
| Node/npm | 26.13.0 / 11.3.0 |
| Database test | MariaDB 10.4.32, loopback 3306, lower_case_table_names=1 |
| Library host | Express 4.22.1, Sequelize 6.29.2, mysql2 3.14.1, sequelize-cli 6.6.0 |
| Provenance | 18 fingerprint source: tujuh file model dan sebelas migrasi |
| Proteksi scope | 207 fingerprint file aplikasi lain/common/config/lockfile dan perubahan pengguna awal |

Baseline lengkap berada pada
[integration-baseline.json](../../be-poin-peserta/apps/leadership-race/integration-baseline.json).
Kredensial dan isi `.env` tidak disalin. Fingerprint scope dipakai oleh audit sekali, terpisah dari suite CI,
agar perubahan aplikasi lain yang sah setelah checkpoint tidak diblokir oleh snapshot lama.

## Pemeriksaan yang benar-benar dijalankan

Seluruh command target dijalankan dari root `be-poin-peserta`.

| Pemeriksaan | Hasil |
|---|---|
| `rtk npm run test:leadership-race:coverage` | 32/32 test lulus, tidak ada skip/todo |
| Coverage native Node, seluruh runtime LR | Lines 99.88%, functions 99.29%, branches 96.47%; gate 90/90/85 lulus |
| `rtk npm run test:reports` sebelum integrasi | 89/89 lulus |
| `rtk npm run test:reports` sesudah integrasi | 89/89 lulus |
| `rtk proxy node tests/leadership-race/checkpointAudit.cjs` | 207 file diperiksa; changed=[] |
| ESLint dengan tooling terpasang dari Leadership-Race | 37 file JS/CJS modul/test; 0 error, rules tidak disuppress |
| `node --check` melalui RTK untuk seluruh JS/CJS baru | 37/37 file lolos |
| `rtk git diff --check` | Lulus pada repository target |

Native runner melaporkan lines/functions/branches; tidak menghasilkan metrik statements terpisah.
Tidak ada threshold yang diturunkan atau coverage ignore baru. Tool lint memakai konfigurasi setara rules
proyek, tanpa memasang dependency di production atau membuat runtime import ke sibling repository.

## Bukti isolasi

1. **HTTP/bootstrap:** disabled tanpa DB provider; startup satu kali tanpa request pertama; gagal import hanya 503
   lokal; stop sebelum mount aman; handler async error, JSON invalid, payload 413 dan scoped 404 sesuai envelope.
2. **Middleware host:** source `app.js` aktual dijalankan dalam harness dengan fixture router lama dan stub
   HTTP listen/socket. Sembilan mount lama, CORS/preflight, parser legacy, init socket lama dan signal listeners
   tetap sesuai baseline. Ini bukan pengujian server deployed nyata atau semua workflow sembilan aplikasi.
3. **Registry:** factory User/Team/Cubicle host asli dimuat pada Sequelize test yang sama. Identitas model,
   table names dan associations lama dipertahankan; LR memakai nama berprefix dan alias lokal terbatas.
4. **Persistence:** CLI nyata menjalankan hanya sebelas migrasi LR pada schema `lr_test_checkpoint_a_*`.
   Sentinel Users/Teams/toilet_cubicles/SequelizeMeta tetap utuh. Up kedua tidak mengulang migrasi;
   metadata root tidak mengadopsi atau menjalankan migrasi modul lain.
5. **Integritas:** unique turn/result, range posisi, FK game-team dan game-active-turn menolak write invalid.
   UTC DATETIME(3), JSON dan BIGINT di atas batas integer JavaScript berhasil roundtrip tanpa kehilangan presisi.
6. **Pemulihan:** schema parsial tidak diberi receipt migrasi sukses. Recovery eksplisit dan down lengkap
   direhearsal hanya pada DB disposable. Uji ini menemukan tiga nama constraint down yang tertinggal dari
   source; semua telah diperbaiki dan rollback penuh kemudian lulus.
7. **Resource:** runtime tidak menutup pool host atau memasang signal/socket handler. Probe kegagalan menurunkan
   readiness; cleanup hanya menghentikan resource LR yang dimiliki dan menutup logger miliknya.

## Batas dan tindak lanjut

- Konfirmasi Node/npm, database MySQL/version/settings, jumlah instance dan domain/proxy deployed untuk
  menyelesaikan I01. MariaDB lokal tidak membuktikan kompatibilitas MySQL 8 production.
- Login, setup/game commands, worker, scoring, realtime, frontend dan alat operasi lanjutan tetap tahap I04–I12.
  Readiness belum menjadi ready untuk game karena worker/publisher belum terpasang.
- Socket.IO tidak diubah. Namespace/gateway I08 tetap membutuhkan persetujuan eksplisit sebelum implementasi.
- Tidak ada migrasi database bersama/production, seed, restore production, restart, merge atau deploy.
- Coverage statements terpisah dan regresi staging/venue penuh belum diklaim; gate rilis pada PRD tetap berlaku.

Acuan: [PRD](../docs/PRD.md) §8–9/13–15, [SPEC](../SPEC.md), [plan](plan.md),
rules [10](../.agents/rules/10-fullstack-general-standards.md),
[20](../.agents/rules/20-backend-node-express-sequelize.md),
[40](../.agents/rules/40-testing-standards.md). Scope implementasi berhenti pada Checkpoint A.
