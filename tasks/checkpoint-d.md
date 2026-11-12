# Bukti integrasi — Checkpoint D

**Tanggal:** 11 November 2026. **Hasil:** Gate Socket.IO disetujui, I08 selesai dan Checkpoint D terverifikasi lokal.
Kelanjutan [Checkpoint C](checkpoint-c.md), dikerjakan sesuai [proposal adaptasi Socket.IO Plan §3](plan.md).
Status ini memisahkan implementasi lokal dari kesiapan rilis production.

## Persetujuan Gate Socket.IO & Implementasi I08

- Persetujuan eksplisit pengguna atas proposal adaptasi Socket.IO dicatat sebelum penyesuaian Socket.IO dikerjakan.
- [Modul LR](../../be-poin-peserta/apps/leadership-race/README.md) mengintegrasikan gateway realtime pada namespace terisolasi `/leadership-race` melalui singleton `common/socket/index.js` (`getIO()`). Modul tidak membuat instance server Socket.IO baru (`new Server`), tidak mendaftarkan middleware global (`io.use`) pada root server, dan tidak mengubah opsi server transport Engine.IO bersama.
- Handshake namespace memvalidasi origin (`assertValidOrigin` terhadap `LEADERSHIP_RACE_CORS_ORIGIN` atau localhost), memvalidasi skema auth (`socketAuthSchema`), dan melakukan otorisasi ganda:
  - Token REST admin: diverifikasi melalui `authorizeAdminAccess` terhadap sesi aktif yang belum dicabut dan role `SUPER_ADMIN`.
  - Display publik: diverifikasi melalui `assertPublicGame` terhadap game operasional saat ini.
- Subscription `game:join` memvalidasi UUID game, mencocokkan scope game dengan identitas handshake, memverifikasi snapshot game, dan memasukkan socket ke room `game:{gameId}`. Event `game:leave` mengeluarkan socket dari room game. Mismatch game scope ditolak seketika dengan `FORBIDDEN`.
- Scan keamanan periodik berjalan di dalam namespace LR (`nsp.sockets.values()`). Sesi admin yang dicabut (`revokedAt !== null`) atau kedaluwarsa secara otomatis memicu pengiriman event `session:invalidated` dengan kode `UNAUTHENTICATED` dan memutuskan koneksi socket dari namespace LR.
- [Outbox Publisher](../../be-poin-peserta/apps/leadership-race/src/services/outboxPublisher.js) mengelola penerbitan event committed dari tabel `leadership_race_outbox_events` secara durable:
  - Polling periodik dengan interval adaptif, `databaseNow(sequelize)`, dan batasan 100 record per batch.
  - Pengiriman gagal secara otomatis mencatat audit kegagalan dan menjadwalkan ulang dengan exponential backoff (`nextAttemptAt`).
  - Pengiriman sukses menandai `publishedAt` dengan waktu database dan menambah `attemptCount`.
  - Payload outbound untuk layar publik secara konsisten disanitasi menjadi payload kosong (`{ ...event, payload: {} }`), berfungsi sebagai sinyal invalidasi yang memaksa layar publik memuat ulang snapshot publik yang aman.
- Surgical Cleanup & Disposal:
  - `gateway.stop()` membatalkan timer interval scan dan outbox publisher, menghapus event listener koneksi LR, dan memutus socket pada namespace LR (`nsp.disconnectSockets(false)`).
  - Dilarang keras memanggil `disconnect(true)` pada level transport atau `io.engine.close()`, sehingga koneksi transport klien lain tidak pernah diputus paksa oleh LR.
- Readiness probe (`/leadership-race/health/ready`) kini melaporkan status `ready` (200 OK) saat persistensi DB, skema berprefix, worker pergerakan, dan outbox publisher aktif dan sehat.

## Koeksistensi & Negative Testing (Checkpoint D)

- Pengujian koeksistensi menyeluruh pada satu server HTTP host membuktikan:
  - Klien `toilet-tracker` pada namespace default (`/`) terhubung normal, dapat merequest snapshot (`state:request` → `state:snapshot`), serta menerima broadcast cubicle (`cubicle:updated`), reset (`state:reset`), dan toilet (`toilet:updated`).
  - Klien `voting` pada namespace default (`/`) dapat menerima broadcast `leaderboardUpdate` secara real-time.
  - Klien Leadership Race pada namespace `/leadership-race` terhubung normal dan menerima event game dari transactional outbox.
- **Zero Event Leakage**:
  - Negative assertion memverifikasi klien toilet-tracker dan voting **tidak pernah** menerima event Leadership Race (`race:notification`, `turn:started`, dll.).
  - Klien Leadership Race **tidak pernah** menerima event toilet-tracker (`cubicle:updated`, `state:snapshot`) maupun event voting (`leaderboardUpdate`).
- **Transport Survival & Fault Isolation**:
  - Penolakan handshake klien LR (kredensial invalid atau origin dilarang) tidak mempengaruhi koneksi klien toilet-tracker pada shared transport.
  - Revokasi sesi admin LR dan invalidasi paksa socket LR tidak mempengaruhi koneksi klien toilet-tracker.
  - Pemanggilan `bridge.locals.stop()` / `runtime.dispose()` hanya membersihkan namespace LR; transport Engine.IO, server HTTP host, dan klien toilet-tracker tetap hidup dan dapat terus menerima broadcast.

## Verifikasi yang Dijalankan

| Pemeriksaan | Hasil |
|---|---|
| Suite LR lengkap (`npm run test:leadership-race`) | 92/92 lulus (termasuk `realtime.test.cjs` dan `socketCoexistence.test.cjs`), tidak ada skip/todo |
| Native Node coverage, seluruh runtime LR | Lines 99.07%, functions 99.05%, branches 92.91%; gate 90/90/85 lulus |
| Host reports suite (`npm run test:reports`) | 89/89 lulus |
| Audit D (`tests/leadership-race/checkpointDAudit.cjs`) | 208 host files terlindungi + 26 foundation files + 16 source manifest files; changed=[] |
| Isolasi app.js & lockfile | `appUnchangedSinceA: true`, `lockfileUnchangedSinceB: true` |
| Syntax / lint check | 90 file JS/CJS modul/test: 0 error |

Database test adalah MariaDB 10.4.32 loopback, Node 26.13.0/npm 11.3.0, dengan dependency host aktual.
Tidak ada dependency baru pada package production; `socket.io-client` diakses melalui harness pengujian tanpa mengubah lockfile host.

## File dan Bukti

- Realtime modul: `apps/leadership-race/src/realtime/gameGateway.js`, `src/services/outboxPublisher.js`.
- Boundary & validation: `src/validation/gameRead.js` (`socketAuthSchema`, `socketJoinSchema`), `src/middleware/adminAuth.js` (`assertValidOrigin`).
- Lifecycle: `apps/leadership-race/runtime.js`, `apps/leadership-race/module.js`.
- Test harness: `tests/leadership-race/realtime.test.cjs`, `tests/leadership-race/socketCoexistence.test.cjs`.
- Baseline & Audit: `apps/leadership-race/checkpoint-d-baseline.json`, `tests/leadership-race/checkpointDAudit.cjs`.

Dari root `be-poin-peserta`:

```powershell
rtk npm run test:leadership-race:coverage
rtk npm run test:reports
rtk proxy node tests/leadership-race/checkpointDAudit.cjs
```

## Batas Rilis dan Tahap Berikutnya

- Modul tetap default disabled (`LEADERSHIP_RACE_ENABLED=false`).
- Tidak ada akun/seed/migrasi database bersama, restart, merge, deploy atau aktivasi production yang dijalankan.
- `app.js` tidak berubah sejak Checkpoint A; `common/socket/index.js` dan seluruh folder `apps/` lain tetap utuh.
- Tahap berikutnya adalah **I09**: penyesuaian base API frontend, konfigurasi namespace socket di UI display/admin, proxy Vite, dan smoke testing browser.

Acuan: [plan I08](plan.md), [PRD](../docs/PRD.md) §7/8.1/10/14, [SPEC](../SPEC.md) §4.7/8/12, rules [10](../.agents/rules/10-fullstack-general-standards.md), [20](../.agents/rules/20-backend-node-express-sequelize.md), [40](../.agents/rules/40-testing-standards.md).

