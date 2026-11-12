# Implementation plan — integrasi backend Leadership Race

**Tanggal:** 11 November 2026. **Status:** I02–I08, I10 dan Checkpoint A/B/C/D terverifikasi lokal.
I01 memiliki baseline lokal; detail runtime/deployment production masih belum dikonfirmasi. I09 dan I11–I12 belum dimulai.
**Source:** `Leadership-Race/backend`. **Target:** `be-poin-peserta/apps/leadership-race`.
Checklist eksekusi: [todo.md](todo.md). Dasar inspeksi: [struktur production](../docs/backend-production-structure.md).
Bukti terbaru: [Checkpoint D](checkpoint-d.md). Controller/roll/worker, scoring, void, lifecycle, ledger,
history, CSV, realtime gateway/outbox, CLI bootstrap/backup/restore, readiness dan metrics sudah terintegrasi.

## 1. Tujuan dan batas perubahan

Integrasikan backend yang sudah tersedia sebagai modul production tanpa mengubah aturan game atau kontrak
aplikasi lain. Pertahankan satu game operasional, board publik, admin session, controller lease, dadu fisik,
movement, BUTTON/MANUAL, ledger koreksi, reset/arsip, finish manual, history/CSV dan transactional outbox.

Batas pengguna yang telah dicatat di [AGENTS.md](../AGENTS.md) tetap mengikat:

- `app.js`/`server.js` production hanya boleh diubah untuk penambahan route Leadership Race.
  Tidak mengubah middleware/CORS global, HTTP server, listen, timeout atau shutdown bersama.
- Tidak mengubah isi folder aplikasi lain dalam `be-poin-peserta/apps/`.
- Setiap penyesuaian Socket.IO memerlukan persetujuan eksplisit terlebih dahulu, termasuk namespace baru
  yang diinisialisasi dari modul Leadership Race. Persetujuan implementasi umum tidak menggantikan izin tersebut.
- Tidak menjalankan migrasi, seed, restart atau deploy production sebagai bagian penyusunan plan ini.

## 2. Keputusan arsitektur yang diusulkan

### Modul dan ownership

Pertahankan ESM pada source Leadership Race melalui `package.json` lokal dengan `type: module`.
Sediakan bridge `index.cjs` yang mengekspor sub-aplikasi Express untuk host CommonJS. Bridge memakai dynamic
`import()` untuk memuat factory ESM; tidak bergantung pada synchronous `require(ESM)`.
Gunakan Express 4 milik host dan uji seluruh route/async handler terhadap versi tersebut.

```text
be-poin-peserta/
  app.js                            # hanya import dan mount route baru
  apps/leadership-race/
    package.json                    # private; type: module
    index.cjs                       # bridge dan sub-app HTTP
    module.js                       # perakitan router dan dependency injection
    runtime.js                      # resource worker/gateway/publisher milik modul
    sequelize.config.cjs            # konfigurasi migrasi khusus modul
    migrations/                     # adaptasi 11 migrasi yang sudah tersedia
    src/
      config/ controllers/ routes/ middleware/ validation/
      models/ services/ domain/ data/ realtime/ cli/ logs/
  tests/leadership-race/             # test fitur dan coexistence
```

Pin revision source sebelum transfer. Salin library/domain/service yang diperlukan; jangan memakai import
ke sibling repository saat production berjalan. Jangan menyalin bootstrap standalone `src/app.js`,
`src/server.js` atau `services/serverLifecycle.js` sebagai bootstrap production.
Backend lama dipertahankan selama transisi. Setelah cutover diterima, backend dalam `be-poin-peserta` menjadi
acuan perubahan backend; jangan mengembangkan dua salinan bisnis secara terpisah.

### Integrasi HTTP

Perubahan entry point dibatasi pada import dan mount berikut; contoh ini belum diterapkan:

```js
const leadershipRaceRoutes = require('./apps/leadership-race/index.cjs');
app.use('/leadership-race', leadershipRaceRoutes);
```

Letakkan mount **setelah CORS/preflight, sebelum parser global** `express.urlencoded`/`express.json` dan
`personalityTestRoutes.reportBoundary`. Tidak memindahkan atau mengubah baris middleware lama.
Sub-app menangani JSON limit 1 MB, request ID, router, 404 dan centralized error middleware sendiri.
Posisi ini memungkinkan malformed JSON ditangani dengan envelope LR sebelum parser global menolaknya.
Middleware global yang mendahului mount tetap harus diuji pada staging.

| Endpoint sekarang | Endpoint production langsung |
|---|---|
| `/api/v1/auth/*` | `/leadership-race/api/v1/auth/*` |
| `/api/v1/games/*` | `/leadership-race/api/v1/games/*` |
| `/api/v1/public/*` | `/leadership-race/api/v1/public/*` |
| `/health/live` dan `/health/ready` | `/leadership-race/health/live` dan `/leadership-race/health/ready` |
| `/health/metrics` | `/leadership-race/health/metrics`, dibatasi admin/monitoring |

Jangan mendaftarkan alias global `/api/v1/*`. Pertahankan DTO, status/error code, idempotency key, version
guard dan semantik receipt. Jaga identitas target command tetap konsisten untuk replay jika data lama diimpor.
Gunakan `req.app.locals` sub-app untuk dependency LR, bukan `app.locals` host.
Pertahankan `try/catch(next)` atau async wrapper lokal untuk kompatibilitas Express 4.

### Database dan penamaan

Gunakan instance Sequelize bersama dari `common/db/db.js` melalui adapter/injection. Tidak membuat pool API
kedua, memanggil sync/alter, atau menutup koneksi bersama dari lifecycle LR.
Nama registry model memakai `LeadershipRace*`; nama tabel ditetapkan eksplisit dengan prefix `leadership_race_`.
Alias pendek hanya dipakai di object lokal yang dikembalikan factory, bukan di registry Sequelize global.

| Alias lokal | Registrasi Sequelize | Tabel |
|---|---|---|
| User | LeadershipRaceUser | leadership_race_users |
| AdminSession | LeadershipRaceAdminSession | leadership_race_admin_sessions |
| AdminRefreshToken | LeadershipRaceAdminRefreshToken | leadership_race_admin_refresh_tokens |
| AdminAccessToken | LeadershipRaceAdminAccessToken | leadership_race_admin_access_tokens |
| AuditLog | LeadershipRaceAuditLog | leadership_race_audit_logs |
| Game | LeadershipRaceGame | leadership_race_games |
| Team | LeadershipRaceTeam | leadership_race_teams |
| BoardCell | LeadershipRaceBoardCell | leadership_race_board_cells |
| CommandLog | LeadershipRaceCommandLog | leadership_race_command_log |
| GameEvent | LeadershipRaceGameEvent | leadership_race_game_events |
| OutboxEvent | LeadershipRaceOutboxEvent | leadership_race_outbox_events |
| ControllerLease | LeadershipRaceControllerLease | leadership_race_controller_leases |
| Turn | LeadershipRaceTurn | leadership_race_turns |
| ChallengeResult | LeadershipRaceChallengeResult | leadership_race_challenge_results |
| ScoreLedger | LeadershipRaceScoreLedger | leadership_race_score_ledger |
| FinalResult | LeadershipRaceFinalResult | leadership_race_final_results |
| SingleGame | LeadershipRaceSingleGame | leadership_race_single_game |
| GameArchive | LeadershipRaceGameArchive | leadership_race_game_archives |

Tabel kompatibilitas `display_pairing_codes`, `display_tokens` dan `display_pairing_limits` juga mendapat
prefix `leadership_race_`; keberadaannya tidak mengembalikan UI pairing. Total target: 21 tabel aplikasi.
Perbarui semua guard/lookup `sequelize.models`, map hasil factory, associations, FK, index/constraint,
raw SQL dan daftar backup/restore. Jangan mengandalkan beda huruf `users`/`Users` untuk isolasi.

Migrasi diintegrasikan di root `migrations/` host dengan prefix `202611...-*-leadership-race-*.js` dan
metadata standar `SequelizeMeta` sehingga otomatis berjalan saat host mengeksekusi `npm run migrate`.
Untuk pengujian lokal dan eksekusi terisolasi, runner `apps/leadership-race/cli/migrate.cjs` secara aman
memfilter hanya migrasi LR agar tidak terganggu oleh migrasi historis modul lain yang rusak pada database bersih.
DDL harus additive dan direhearsal untuk kegagalan parsial; transaksi MySQL bukan rollback otomatis untuk DDL.
Pertahankan UUID ASCII/ascii_bin, UTC DATETIME(3), InnoDB, unique constraints dan FK komposit yang ada.

### Config, dependency, auth dan lifecycle

- Config modul memakai prefix `LEADERSHIP_RACE_`, termasuk enable flag, origin, key receipt dan log level.
  Jangan memuat `.env` standalone atau menimpa `process.env`, `PORT`, `SECRET_KEY` maupun DB config host.
- Pertahankan opaque admin sessions, token hashing/rotation/revocation, role SUPER_ADMIN dan cookie
  `__Host-lr_admin_refresh` Secure/HttpOnly/SameSite=Lax/Path=/. JWT aplikasi lain tidak memberi akses LR.
- Pertahankan validator Zod. Versi source 4.6.7 menjadi kandidat tambahan exact setelah compatibility check;
  Zod belum ada pada lockfile production. Jangan meng-upgrade library bersama secara massal.
- Lockfile production lokal berisi Express 4.22.1, Sequelize 6.29.2, Socket.IO 4.8.3 dan mysql2 3.14.1.
  Ini bukan bukti versi deployed. Uji pada versi host; jika tidak kompatibel, ajukan perubahan spesifik.
- Bridge mengekspor sub-app sinkron. Inisialisasi asynchronous dimulai satu kali setelah mount, setelah singleton
  Socket.IO host tersedia; urutan ini harus dibuktikan dengan test bootstrap yang mengikuti `app.js` aktual.
  Worker harus mulai tanpa menunggu request HTTP pertama.
- Enable flag default mati selama pemasangan. Saat aktif, validasi config/schema dahulu; readiness 503 sampai
  DB, worker dan publisher benar-benar siap. Gagal bootstrap hanya menonaktifkan layanan LR dengan log aman.
- Worker memakai scan startup dan periodic expiry. Outbox hanya menerbitkan sesudah commit. Dispose idempotent
  hanya menghentikan timer/listener/publisher LR; tidak memanggil process.exit atau signal handler host.
- Graceful drain server bersama setara standalone belum dapat dijamin dengan batas entry point yang ada.
  Buktikan crash/restart recovery melalui transaksi/outbox dan catat keterbatasan ini dalam runbook.

## 3. Rancangan Socket.IO untuk persetujuan terpisah

Usulan: gunakan singleton yang ada melalui `getIO()`, lalu namespace `/leadership-race`; path transport tetap
`/socket.io/`. Tidak membutuhkan perubahan `common/socket/index.js` pada desain utama.
Namespace baru dan adaptasi gateway tetap menunggu persetujuan eksplisit sebelum dikerjakan.

Ketentuan usulan:

1. Gateway menerima namespace; tidak membuat `new Server(server)`. Middleware auth, connection handler,
   revocation scan, rooms `game:{id}` dan publisher hanya berjalan pada namespace LR.
2. Origin/schema/scope dicek pada namespace handshake dan join, lalu session/scope diperiksa lagi pada scan
   dan setiap outbound event. Payload publik tetap invalidasi kosong untuk game operasional saja.
3. Jangan memakai middleware/broadcast/scan global `io.use`, `io.emit` atau namespace `/` untuk LR.
   Jangan mengubah path, CORS, transports, adapter atau timeout Engine.IO bersama.
4. Ganti semantik cleanup gateway standalone: tidak memakai `disconnect(true)` atau `io.engine.close()`.
   Putuskan namespace LR tanpa menutup transport bersama; hapus hanya listener/timer milik LR.
5. `allowRequest`, `maxHttpBufferSize` dan `serveClient` adalah opsi server pada gateway lama. Origin dan batas
   payload modul perlu diterapkan pada boundary namespace; jangan mengklaim proteksi transport identik.
   Jika opsi transport khusus ternyata wajib, ajukan desain/perizinan tambahan sebelum mengubah config shared.

Bukti tidak mengganggu aplikasi lain harus mencakup voting `leaderboardUpdate` dan toilet-tracker
`state:request`, `state:snapshot`, `cubicle:updated`, `state:reset`, `toilet:updated`, sebelum/sesudah LR aktif.
Uji dua namespace pada satu koneksi transport ketika auth LR ditolak, session dicabut dan modul di-dispose.
Tidak boleh ada event LR bocor ke aplikasi lain atau koneksi aplikasi lain terputus akibat cleanup LR.
Namespace mengisolasi kontrak, tetapi CPU/memori/pool masih bersama; ukur dampak beban terhadap baseline host.

## 4. Urutan implementasi

Path `src/` dan `migrations/` pada I02–I10 di bawah relatif terhadap modul target, kecuali disebut lain.
Setiap tahap menghasilkan diff terpisah dan bukti verifikasi. Pengembangan dilakukan di lingkungan terisolasi;
aktivasi production hanya melalui tahap rilis yang diotorisasi.

### I01 — Baseline dan compatibility check

- **Pekerjaan:** pin revision kedua repo; inventaris runtime deployed, database, domain/proxy, process manager,
  jumlah instance dan status migrasi. Buktikan kompatibilitas ESM bridge/Express 4 pada harness, tanpa listener/DB production.
- **Output:** matriks baseline dan manifest source; dependency tambahan terbatas; rancangan socket siap direview.
- **Selesai jika:** versi aktual terdokumentasi, kegagalan lama dipisahkan, tidak ada asumsi single-instance tersembunyi.
- **Verifikasi:** manifest/lock/runtime, suite sumber yang relevan, test bootstrap prototype, baseline routes/socket host.
- **Dependensi:** tidak ada. **Risiko/rollback:** tidak mengubah server production; prototype dibuang jika tidak kompatibel.

### I02 — Packaging modul dan boundary HTTP

- **Pekerjaan:** siapkan bridge/factory/runtime, adapter config/DB/logger, error/request-ID lokal dan test harness.
  Transfer source yang diperlukan dari revision terpilih tanpa bootstrap standalone; pisahkan adaptasi dari salinan baseline.
  Tambahkan dependency/script test khusus seperlunya, lalu import+mount route dengan flag LR mati.
- **File utama:** `index.cjs`, `module.js`, `runtime.js`, `src/config/`, `src/middleware/`, package/lockfile;
  root `app.js` hanya import+route. Test di `tests/leadership-race/`.
- **Selesai jika:** module disabled/failed menghasilkan respons lokal yang aman; host dan error aplikasi lama tetap sama.
- **Verifikasi:** ESM load/failure, start berulang, req.app.locals isolation, JSON invalid/413, scoped 404 dan async failure.
- **Dependensi:** I01. **Risiko/rollback:** kegagalan startup menyebar ke host; mitigasi promise tertangani dan flag mati;
  rollback mengembalikan penambahan route/module pada release, bukan mengubah bootstrap host.

### I03 — Persistence berprefix dan runner migrasi

- **Pekerjaan:** adaptasi tujuh file model dan 11 migrasi, semua references/raw SQL/registry alias serta metadata CLI.
  Siapkan seluruh schema yang diperlukan snapshot/command sebelum menguji flow yang membaca turn, skor dan arsip.
- **File utama:** `src/models/`, `migrations/`, `sequelize.config.cjs`, test model/migration isolation.
- **Selesai jika:** 18 model dan 21 tabel LR terisolasi; factory tidak mengambil User/Team aplikasi lain;
  migrasi LR tidak menjalankan migrasi pending modul lain.
- **Verifikasi:** DB disposable `lr_test_*`, collision User/Team/Cubicle, sentinel data host, FK/unique/UTC/JSON/BIGINT,
  migrasi ulang dan pemulihan DDL parsial. Tidak menggunakan SQLite sebagai bukti locking MySQL.
- **Dependensi:** I02. **Risiko/rollback:** collision/DDL parsial; hentikan aktivasi LR, pulihkan lewat prosedur teruji;
  tidak melakukan drop otomatis atau down migration pada database bersama.

### I04 — Login, session dan audit admin

- **Pekerjaan:** integrasikan adminAuth/adminSessions/adminCredentials/adminBootstrap, middleware/validator,
  route/controller auth, audit dan request ID memakai DB adapter modul.
- **Selesai jika:** login→me→refresh→logout bekerja; revocation dan role server terjaga; JWT aplikasi lain ditolak.
- **Verifikasi:** success/failure/edge, refresh race/reuse, expiry, rate limit, cookie aman, Origin, audit dan redaksi log.
- **Dependensi:** I03. **Risiko/rollback:** salah menghubungkan identitas bersama; pertahankan auth lokal dan nonaktifkan
  route LR bila gagal; jangan mengubah auth/helper common.

### I05 — Setup dan satu game publik

- **Pekerjaan:** integrasikan gameCommands, gameSetup/preflight, singleGame, board template, snapshot dan event replay.
  Pertahankan setup 2–10 tim/50 cell, initialization atomik, reset/arsip dan DTO publik.
- **Selesai jika:** preview tanpa game aman; semua layar menunjuk sesi sama; reset bersamaan membuat satu pengganti;
  arsip tidak dapat dimutasi dan credential tidak masuk jalur publik.
- **Verifikasi:** setup/preflight/current/reset concurrent, stale version, idempotency/replay, archive scope,
  constraint game-team, raw SQL singleton berprefix, request hash dan key receipt.
- **Dependensi:** I04. **Risiko/rollback:** reset/receipt salah scope; pertahankan transaksi dan histori;
  nonaktifkan akses LR tanpa menghapus data bila acceptance gagal.

### I06 — Controller, roll dan movement worker

- **Pekerjaan:** integrasikan controllerLeases, turnCommands/settlement, movement engine/worker, validasi dan routes.
  Jalankan expiry scan saat startup serta periodik tanpa traffic; batasi batch dan cegah worker ganda dalam satu proses.
- **Selesai jika:** lease/versi/input dadu 1–6 ditegakkan; concurrent roll menghasilkan satu efek;
  restart/expiry menyelesaikan movement secara idempotent.
- **Verifikasi:** bounce 48+4 dan 50+3, penalti tanpa chaining, race/retry/deadlock/timeout, startup tanpa request,
  serta `innodb_lock_wait_timeout` dipulihkan sebelum koneksi pool dipakai aplikasi lain.
- **Dependensi:** I05. **Risiko/rollback:** job ganda/pool terganggu; hentikan worker LR dan mutasi modul,
  biarkan persisted movement pulih setelah release diperbaiki; jangan menutup pool host.

### I07 — Poin, lifecycle, koreksi dan history

- **Pekerjaan:** integrasikan scoring, result/void, pause/resume/finish, correction ledger, history dan CSV.
- **Selesai jika:** satu hasil/turn; BUTTON/MANUAL eksklusif; total sama dengan ledger; koreksi kompensasi diaudit;
  void mengikuti SPEC §4.6; finish manual dan seri poin menghasilkan pemenang bersama.
- **Verifikasi:** race BUTTON vs MANUAL, manual 0/batas/invalid, no bonus otomatis, double void/roll sesudah void,
  finish pending ditolak, archive read-only, pagination, saldo dan CSV formula injection.
- **Dependensi:** I06. **Risiko/rollback:** saldo/urutan histori berubah; jangan edit/hapus ledger;
  hentikan mutasi LR dan gunakan jalur koreksi diaudit setelah penyebab diperbaiki.

### I08 — Realtime namespace dan outbox

- **Prasyarat khusus:** persetujuan eksplisit pengguna atas rancangan §3, sebelum perubahan Socket.IO apa pun.
- **Pekerjaan:** adaptasi `src/realtime/gameGateway.js`, outboxPublisher dan runtime ke singleton/namespace LR.
  Jangan menyalin constructor dan shutdown server Socket.IO standalone.
- **Selesai jika:** emit hanya pascacommit, retry durable, auth per emit dan public payload aman;
  aplikasi voting/toilet tetap berfungsi saat LR aktif, ditolak, gagal dan di-dispose.
- **Verifikasi:** real client/server, multiplexed transport disconnect, revoked session, cross-game isolation,
  outbox crash/retry, duplicate/out-of-order/replay dan negative assertions event lintas aplikasi.
- **Dependensi:** I07 dan persetujuan socket. **Risiko/rollback:** cleanup memutus transport host;
  dispose hanya namespace/resource LR, tanpa engine.close, disconnect transport atau penghapusan listener global.
  Tanpa persetujuan, tahap ini tetap pending; jangan mengganti realtime menjadi polling-only diam-diam.

### I09 — Caller frontend dan konfigurasi URL

- **Pekerjaan:** satukan base API untuk auth/public/games/CSV, namespace socket, Vite proxy dan smoke scripts.
  Jika UI di subpath, sesuaikan Vite base/Router basename dan deep links tanpa redesign.
- **File utama di Leadership-Race:** `frontend/src/services/{adminAuth,games,displayConnection}.js`,
  helper API config baru, `frontend/vite.config.js`, router dan tests terkait sesuai kebutuhan subpath.
- **Selesai jika:** login→setup→roll→score→reset melalui modul berjalan; display reconnect/pindah sesi tanpa reload;
  credentials, abort, retry key, buffer/snapshot/replay/dedup tetap benar.
- **Verifikasi:** component/transport test dan browser smoke melalui URL staging, termasuk CSV dan reconnect saat animasi.
- **Dependensi:** I05–I08 dan domain deployment dipilih. **Risiko/rollback:** hardcoded URL/cookie/CORS;
  rollback konfigurasi frontend/proxy ke backend lama hanya jika writer/data masih konsisten.

Origin baru yang tidak ada pada allowlist host akan ditolak sebelum route, termasuk untuk deployment yang tampak
same-origin dari browser jika request membawa Origin yang ditolak. Pilih origin yang sudah diizinkan.
Jika domain pilihan membutuhkan perubahan CORS `app.js`, hentikan hanya scope tersebut dan ajukan perubahan
batasan pengguna; jangan menghapus atau memalsukan header Origin.

### I10 — CLI, readiness dan backup/restore

- **Pekerjaan:** adaptasi CLI bootstrap/backup/restore, whitelist 21 tabel, format backup dan health probes modul.
  Readiness memeriksa DB, worker dan publisher nyata; metrics dibatasi monitoring/admin.
- **Selesai jika:** backup roundtrip terverifikasi, legacy format dipetakan eksplisit, key receipt terjaga;
  kegagalan dependency menghasilkan 503 dan tidak mengubah kesehatan aplikasi lain.
- **Verifikasi:** corrupted backup, tabel tak dikenal, sentinel aplikasi lain, missing worker/publisher, fault injection.
  Restore hanya CLI/koneksi khusus pada maintenance LR, bukan API atau pool bersama.
- **Dependensi:** I03–I08. **Risiko/rollback:** restore generik menghapus tabel lain; allowlist dan target guard wajib;
  tidak menjalankan restore production atau rollback database secara otomatis.

### I11 — Regresi staging dan rehearsal

- **Pekerjaan:** jalankan seluruh acceptance LR dan baseline aplikasi lain, coverage, uji restart dan beban bersama.
  Tambahkan test coexistence di folder test baru; tidak mengedit folder aplikasi lain untuk memperoleh hasil hijau.
- **Selesai jika:** tidak ada regresi kontrak aplikasi lama, double business effect atau data bocor;
  sumber kegagalan lama dan hasil baru dilaporkan terpisah.
- **Verifikasi:** 10 tim, 5 admin, 3 display selama 60 menit; P95 write <1.000 ms dan commit→render <1.500 ms
  pada jaringan uji stabil; bandingkan CPU/memori/pool/latensi aplikasi lain dengan baseline/SLO host.
- **Dependensi:** I09–I10. **Risiko/rollback:** shared resource contention; batasi beban/scan atau tunda aktivasi LR;
  jangan mengubah threshold/test maupun konfigurasi aplikasi lain agar lolos.

### I12 — Cutover dan rollback release

- **Pekerjaan:** siapkan revision, runbook, backup, aktivasi, proxy/domain, monitoring dan urutan writer tunggal.
  Pelaksanaan migrasi production, restart, merge/deploy memerlukan otorisasi operasional yang berlaku.
- **Selesai jika:** checklist staging lulus, keputusan deployment/data selesai, backup/rollback direhearsal,
  tidak ada dua backend yang menerima write untuk game yang sama.
- **Verifikasi:** rehearsal cutover/rollback pada staging dan pemeriksaan route/socket aplikasi lain setelah aktivasi.
- **Dependensi:** I11. **Risiko/rollback:** restart host memengaruhi semua aplikasi; jadwalkan operasi yang disetujui.
  Nonaktifkan akses/write LR dan kembalikan release bila perlu; tabel LR tetap ada, tanpa drop/down migrasi
  atau restore seluruh database bersama.

Jika ada data standalone yang harus dipertahankan: hentikan writer lama, ambil backup konsisten, map tabel,
pertahankan UUID/ledger/sequence/receipt/arsip dan key, lalu cek checksum/saldo sebelum writer baru dibuka.
Default pemasangan schema baru tidak berarti izin membuang histori; keputusan kebutuhan import harus eksplisit.
Jangan memasukkan seed demo ke startup production.

## 5. Dependensi dan checkpoint

Urutan utama: **I01 → I02 → I03 → I04 → I05 → I06 → I07 → I08 → I09 → I11 → I12**.
I10 dapat disiapkan setelah I03, tetapi penerimaan akhirnya menunggu I08. Persetujuan socket dapat diminta
sejak proposal I01 konkret; tidak perlu menunggu fitur lain selesai untuk menyiapkan bahan review.

| Checkpoint | Pemeriksaan wajib |
|---|---|
| Setelah I03 | import/config/persistence tidak mengubah registry, tabel atau lifecycle app lain |
| Setelah I05 | login, setup, board publik dan reset memiliki scope/transaksi yang benar |
| Setelah I07 | roll, scoring, void, finish, ledger dan history konsisten |
| Setelah I08 | seluruh regression socket voting/toilet dan multiplexed disconnect lulus |
| Setelah I10 | frontend, readiness, CLI serta backup/restore bekerja pada staging |
| Setelah I11 | bukti integrasi/rehearsal cukup untuk keputusan rilis, bukan hanya unit test hijau |

## 6. Verifikasi dan command

Gunakan test MySQL/MariaDB disposable `lr_test_*`, dengan guard target yang menolak database bersama/production.
Assertions mencakup sukses, gagal dan edge case yang relevan serta side effect nyata. Coverage minimum LR:
statements/lines 90%, functions 90%, branches 85%; jangan memperkecil cakupan source atau menambah ignore tanpa alasan sah.

Command yang saat ini tersedia di Leadership-Race:

```powershell
rtk npm run lint
rtk npm test
rtk npm run test:integration
rtk npm run test:coverage
rtk npm run build
rtk npm run test:display:browser
```

Production memiliki `rtk npm run test:reports`; `npm test` umum masih placeholder.
Script LR `test:leadership-race`, `test:leadership-race:coverage` dan `migrate:leadership-race` sudah tersedia.
Dua script test memakai `--test-concurrency=4`; timeout dan threshold coverage tetap berlaku.
Jangan menyajikan script usulan sebagai command aktif atau memakai root `migrate` sebagai shortcut.
Jalankan regression seluruh route sembilan aplikasi dan socket voting/toilet melalui harness/staging terisolasi.

## 7. Keputusan yang ditunda sampai tahap terkait

| Keputusan/bukti | Dibutuhkan sebelum |
|---|---|
| Runtime deployed dan kompatibilitas dependency | I02 dipakai pada host |
| Jumlah instance/adapter/sticky session | Aktifkan worker/realtime; desain awal mengasumsikan satu instance |
| Persetujuan khusus Socket.IO §3 | Implementasi I08 |
| Domain, lokasi UI dan proxy | Finalisasi I09/staging |
| Kebutuhan import data game standalone | Implementasi cutover data/aktivasi I12 |
| Baseline/SLO aplikasi lama dan jendela restart | Penerimaan I11 dan pelaksanaan I12 |

Jika host ternyata multi-instance, hentikan asumsi worker/publisher lokal tunggal dan ajukan desain koordinasi
serta socket adapter sebelum aktivasi. Jangan menambahkan Redis atau mengubah deployment bersama secara otomatis.

## 8. Acuan dan status bukti

Acuan produk: [PRD](../docs/PRD.md) §2.3, §4–5, §8–15; [SPEC](../SPEC.md) khususnya §4.6/7–12;
[single-game](../docs/single-game.md). Batas production: [AGENTS.md](../AGENTS.md).
Standar: rules [10](../.agents/rules/10-fullstack-general-standards.md),
[20](../.agents/rules/20-backend-node-express-sequelize.md),
[30](../.agents/rules/30-frontend-react.md), [40](../.agents/rules/40-testing-standards.md).

Penyusunan plan memeriksa source entry point, gateway, model, manifest/lockfile dan caller frontend.
Implementasi sampai Checkpoint C kini tersedia dalam folder production lokal; rincian file, hasil test,
coverage dan batas bukti dicatat pada [laporan Checkpoint C](checkpoint-c.md).
Migrasi dan rollback hanya dijalankan pada schema disposable loopback. Tidak ada migrasi database production,
seed, restart, deploy atau penyesuaian Socket.IO. Bukti runtime/deployment production tetap menjadi gate terbuka.
