# Staging & Operational Runbook — F1 Leadership Race

Dokumen operasional dan panduan pemeliharaan sistem F1 Leadership Race untuk staging dan venue operasional sesuai PRD Bagian 13–14 dan SPEC Bagian 10.

Flow venue: buka `/` pada browser display tanpa login/kode/pairing. Admin login di `/login` lalu memakai
`/admin/games` untuk tim, dadu, poin dan reset. `/leaderboard` dan `/final` membaca game operasional yang sama.
Reset mempertahankan konfigurasi tersimpan dan mengarsipkan sesi lama; board berpindah otomatis.
Gunakan fullscreen/kiosk dan pengaturan sleep browser/OS, reduced motion melalui preferensi OS.
Tidak ada toolbar kiosk atau menu pairing pada aplikasi.

---

## 1. Topologi Arsitektur Staging

Sistem dirancang sebagai **single-node persistent stack** yang tangguh untuk menangani event 2–10 tim, 5 admin concurrent, dan multi-display:

```
[ Klien / Browser Display & Admin ]
               │
               ▼ HTTPS (443) / WSS (WebSocket)
    ┌─────────────────────────────┐
    │     Nginx Reverse Proxy     │  - TLS 1.2/1.3 termination
    │   (Rate limit, CSP, WSS)    │  - WebSocket upgrade
    └──────────────┬──────────────┘  - Max body 1MB, timeout 60s
                   │ HTTP (127.0.0.1:3000)
    ┌──────────────▼──────────────┐
    │     Node.js Express App     │  - REST API & Socket.IO
    │  (Movement & Outbox Worker) │  - In-memory event dispatcher
    └──────────────┬──────────────┘  - Winston JSON daily rotation
                   │ TCP (127.0.0.1:3306)
    ┌──────────────▼──────────────┐
    │   MariaDB / MySQL 8.0 DB    │  - Single source of truth
    │    (Persistent Storage)     │  - InnoDB transactions & row locks
    └─────────────────────────────┘
```

---

## 2. Kredensial & Database Least-Privilege

Dalam lingkungan staging/produksi, aplikasi tidak boleh menggunakan akun `root`. Buat user aplikasi khusus dengan hak akses terbatas:

```sql
CREATE DATABASE `leadership_race_staging` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER 'lr_app_user'@'localhost' IDENTIFIED BY 'STRONG_RANDOM_STAGING_PASSWORD';

-- Berikan hak akses hanya untuk manipulasi data tabel aplikasi
GRANT SELECT, INSERT, UPDATE, DELETE ON `leadership_race_staging`.* TO 'lr_app_user'@'localhost';

-- Berikan hak ALTER dan CREATE INDEX hanya jika menjalankan migrasi database
GRANT CREATE, DROP, ALTER, INDEX ON `leadership_race_staging`.* TO 'lr_app_user'@'localhost';

FLUSH PRIVILEGES;
```

---

## 3. Konfigurasi Lingkungan (Environment Variables)

Gunakan field yang benar-benar dibaca [environment.js](../backend/src/config/environment.js) dan
[backend/.env.example](../backend/.env.example). Loader default membaca `backend/.env`; file
`.env.staging` tidak dimuat otomatis. Environment proses dapat disuplai deployment.

| Variabel | Tipe / Format | Keterangan |
|---|---|---|
| `NODE_ENV` | `production` | Mengaktifkan optimasi Express dan pematian stack trace publik |
| `PORT` | `3000` | Port listen aplikasi backend |
| `DB_HOST` | `127.0.0.1` | Host database MySQL / MariaDB |
| `DB_PORT` | `3306` | Port database |
| `DB_NAME` | `leadership_race_staging` | Nama database staging |
| `DB_USER` | `lr_app_user` | Akun database terisolasi |
| `DB_PASSWORD` | string | Password aman database |
| `PAIRING_PEPPER` | opsional, 64 karakter hex | HMAC API pairing kompatibilitas; bukan prasyarat board publik |
| `CONTROLLER_RECEIPT_KEY_ID` | ID key, default `v1` | Harus ada pada map key bila ring dipakai |
| `CONTROLLER_RECEIPT_KEYS` | JSON hex key (64 hex) | Kunci enkripsi tanda terima controller lease |
| `CORS_ORIGIN` | URL (comma separated) | Origin yang diizinkan untuk browser |
| `LOG_LEVEL` | debug/info/warn/error | Default info |

Admin menggunakan opaque access/refresh, bukan JWT. TTL access 15 menit dan refresh 7 hari ditetapkan
pada auth service/ADR-002, bukan `SESSION_TIMEOUT_HOURS`. `JWT_SECRET` dan `SESSION_TIMEOUT_HOURS` dalam
contoh staging lama tidak dibaca aplikasi; jangan mengandalkannya. Ring key controller harus terkonfigurasi
untuk penerbitan/replay lease; simpan key lama selama receipt masih dibutuhkan.
Runtime: Node 26.13.0 dan npm 11.3.0 sesuai pin manifest. Development/integrasi lokal memakai MariaDB 3306;
kompatibilitas MySQL produksi dan konfigurasi proxy/TLS nyata tetap harus diverifikasi sebelum rilis.

---

## 4. Logging & Kebijakan Rotasi Winston

Winston dikonfigurasi untuk menulis log berformat JSON terstruktur di direktori `backend/src/logs/`:

- **Application Log**: `application-YYYY-MM-DD.log` (level `info`, `warn`)
- **Error Log**: `error-YYYY-MM-DD.log` (level `error`)
- **Retensi**: Rotasi harian otomatis dengan retensi maksimal 14 hari.
- **Redaksi Rahasia**: Password, secret JWT, access token, dan hash tidak pernah dicatat dalam log (`sanitizedError` dan redaksi otomatis).
- **Audit Entries**: Mutasi sensitif dicatat pada tabel `audit_logs`; log operasional dan audit database
  memiliki fungsi berbeda. Jangan mengasumsikan setiap before/after audit disalin ke log file.

---

## 5. Health Checks & Pemantauan (Monitoring)

Tersedia tiga endpoint probe tanpa autentikasi:

### 5.1 Liveness Probe: `GET /health/live`
- **Tujuan**: Memastikan proses Node.js hidup dan responsif.
- **Respons HTTP 200**:
  ```json
  {
    "success": true,
    "data": {
      "status": "ok",
      "uptime": 1420.5,
      "timestamp": "2026-11-11T02:00:00.000Z"
    }
  }
  ```

### 5.2 Readiness Probe: `GET /health/ready`
- **Tujuan**: Memeriksa kesiapan aplikasi melayani traffic bisnis.
- **Pemeriksaan Komponen**:
  1. Konektivitas database (`sequelize.authenticate()`).
  2. Status Outbox Publisher (pemindaian event realtime aktif).
  3. Status Movement Worker (pemindaian pergerakan jatuh tempo aktif).
  4. Status graceful shutdown (menolak traffic baru jika sedang shutdown).
- **Respons HTTP 200 (Ready)**:
  ```json
  {
    "success": true,
    "data": {
      "status": "ready",
      "database": { "status": "connected" },
      "publisher": { "status": "ready" },
      "worker": { "status": "ready" },
      "timestamp": "2026-11-11T02:00:00.000Z"
    }
  }
  ```
- **Respons HTTP 503 (Not Ready)**:
  Jika salah satu komponen (DB, publisher, worker) gagal, endpoint mengembalikan HTTP 503 `status: "not_ready"`.

### 5.3 System Metrics: `GET /health/metrics`
- **Tujuan**: Mengambil telemetri sistem (memori heap, RSS, uptime, koneksi DB).
- **Respons HTTP 200**:
  ```json
  {
    "success": true,
    "data": {
      "uptimeSeconds": 1420,
      "timestamp": "2026-11-11T02:00:00.000Z",
      "memory": {
        "heapUsedBytes": 68420120,
        "heapTotalBytes": 98566144,
        "rssBytes": 134217728
      },
      "database": { "status": "connected" }
    }
  }
  ```

### 5.4 Aturan Alerting yang Direkomendasikan
1. **DB Down Alert**: `GET /health/ready` menghasilkan HTTP 503 selama > 30 detik berturut-turut.
2. **Worker Lag Alert**: `worker.status === 'not_ready'` menandakan interval pemindaian terhenti > 15 detik.
3. **Publisher Lag Alert**: `publisher.status === 'not_ready'` menandakan pemindaian outbox terhenti > 10 detik.
4. **Memory High Alert**: `memory.heapUsedBytes > 500MB` (potensi memory leak).
5. **HTTP 5xx Rate Alert**: Error rate HTTP > 1% dari total traffic dalam 5 menit.

---

## 6. Prosedur Backup & Restore

### 6.1 Membuat Backup Database
Jalankan script backup resmi sebelum event atau sebelum deploy rilis baru:

```bash
# Output default ke backups/backup-<timestamp>.json
rtk proxy node scripts/backup.js

# Atau tentukan path tujuan kustom
rtk proxy node scripts/backup.js --output /var/backups/f1race/pre-event-2026-11-11.json
```

Backup menyertakan metadata tabel, total record dan SHA-256 checksum data. Tabel `single_game` serta
`game_archives` termasuk daftar backup, bersama seluruh histori/ledger/credential hash.
Checksum mendeteksi perubahan payload, bukan bukti kelengkapan atau snapshot konsisten lintas tabel:
implementasi membaca tabel satu per satu dan query tabel yang gagal menjadi array kosong.
Jadwalkan backup saat write dihentikan dan cocokkan jumlah record/tabel penting sebelum dipakai untuk pemulihan.

### 6.2 Memulihkan Database (Restore)
Restore menimpa isi tabel pada database target, bukan Reset game aplikasi. Jalankan hanya pada target yang
telah diverifikasi dan diotorisasi; rehearsal/test memakai `lr_test_*`, tanpa reset data development/event.
Target harus sudah dimigrasikan. Restore memakai transaksi DML dengan foreign key checks dinonaktifkan sementara:

```bash
rtk proxy node scripts/restore.js backups/backup-2026-11-11T02-00-00-000Z.json
```

Script akan:
1. Memverifikasi integritas file backup terhadap SHA-256 Checksum.
2. Mengosongkan isi tabel dengan DELETE dalam urutan terbalik; schema tabel tidak dihapus.
3. Memasukkan data backup; jika backup lama belum memiliki pointer, adopsi game updated_at terbaru,
   ID menaik sebagai pemecah seri, atau pointer kosong jika belum ada game.
4. Mengaktifkan kembali pemeriksaan FK dalam finally dan commit jika workflow berhasil.

Mengaktifkan FK kembali tidak membuktikan semua relasi restored valid. Verifikasi pointer/arsip, jumlah
record, ledger=skor, histori dan snapshot setelah restore. Jangan menyebut backup/restore siap produksi
hanya karena test fixture lulus; batas implementasi harus diperhitungkan dalam gate operasional.

---

## 7. Prosedur Rollback & Tanggap Darurat

Jika rilis baru staging mengalami kegagalan regresi:

1. **Hentikan Traffic Masuk**:
   Buka halaman maintenance Nginx atau alihkan upstream.
2. **Rollback Aplikasi**:
   Ganti binary/source code aplikasi ke versi tag rilis sebelumnya yang stabil.
3. **Rollback Data (Jika Ada Kerusakan Data)**:
   Setelah target dan otorisasi pemulihan diverifikasi, jalankan `rtk proxy node scripts/restore.js <file-backup-sebelum-deploy>`.
4. **Jalankan Verifikasi Health**:
   Pastikan `curl -f http://127.0.0.1:3000/health/ready` menghasilkan HTTP 200.
5. **Kembalikan Traffic**:
   Nginx kembali mengarahkan traffic ke aplikasi yang telah pulih.

Panduan ini tidak menyatakan staging/produksi sudah dideploy atau semua gate selesai. Status sumber/test,
kegagalan refresh sesi, coverage dan bukti venue mengikuti [task list](../tasks/todo.md) serta
[acceptance/rehearsal](acceptance-and-rehearsal.md). Rehearsal acara memakai tiga browser publik tanpa pairing.

