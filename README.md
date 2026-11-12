# F1 Leadership Race

Aplikasi web interaktif untuk mengelola giliran, posisi tim, skor, dan menampilkan papan permainan **F1 Leadership Race** pada acara team gathering.

Sistem dirancang dengan arsitektur **single operational game**, sinkronisasi *real-time* berbasis Socket.IO, jaminan integritas data ACID melalui MySQL/MariaDB InnoDB, dan antarmuka display tanpa gesekan (*zero-friction public display* tanpa login atau kode pairing).

---

## Daftar Isi

1. [Gambaran Sistem & Prinsip Utama](#gambaran-sistem--prinsip-utama)
2. [Arsitektur & Topologi](#arsitektur--topologi)
3. [Fitur Utama & Rute Aplikasi](#fitur-utama--rute-aplikasi)
4. [Persyaratan Sistem](#persyaratan-sistem)
5. [Panduan Instalasi & Quick Start](#panduan-instalasi--quick-start)
6. [Daftar Perintah (NPM Scripts)](#daftar-perintah-npm-scripts)
7. [Variabel Lingkungan (.env)](#variabel-lingkungan-env)
8. [Aturan Permainan & Mekanika Teknis](#aturan-permainan--mekanika-teknis)
9. [Operasional: Backup, Restore & Rehearsal](#operasional-backup-restore--rehearsal)
10. [Health Probes & Graceful Shutdown](#health-probes--graceful-shutdown)
11. [Keamanan & Standar Pengujian](#keamanan--standar-pengujian)
12. [Indeks Dokumentasi Proyek](#indeks-dokumentasi-proyek)

---

## Gambaran Sistem & Prinsip Utama

F1 Leadership Race mengelola kompetisi papan 50 kotak untuk **2–15 tim**. Dadu fisik dilempar secara manual di lapangan oleh peserta/fasilitator, lalu Super Admin memasukkan angka 1–6 ke aplikasi. Sistem menghitung lintasan langkah demi langkah secara aman di sisi server, menangani sirkuit wrap-around (*loop*) di kotak 50, mengeksekusi penalti kotak Indisipliner, dan menyiarkan animasi gerakan ke seluruh layar display dan konsol admin secara *real-time*.

> [!IMPORTANT]
> **Prinsip Utama Produk (Invariants):**
> 1. **MySQL adalah Single Source of Truth:** Browser tidak boleh menghitung gerakan atau skor secara independen. Semua mutasi diverifikasi, dikunci (*row lock*), dan dicatat dalam transaksi atomik sebelum event diterbitkan.
> 2. **Dadu & Aktivitas Fisik:** Dadu bersifat fisik (1–6). Aktivitas Challenge dan Reward berlangsung di dunia nyata oleh panitia. Aplikasi mencatat hasil poin, bukan mengelola kuis atau timer fisik.
> 3. **Single Operational Game:** Display publik (`/`) langsung menampilkan board game aktif tanpa login, token, atau pairing code. Seluruh konsol admin (`/admin/games`) dan display mengacu pada sesi operasional yang sama.
> 4. **Idempotensi & Concurrency Control:** Setiap perintah mutasi (roll dadu, scoring, void, reset) dilindungi UUID `Idempotency-Key` dan version guard (`expectedStateVersion`). Kontrol dadu diamankan dengan mekanisme *lease* (Active Controller).
> 5. **Pemenang Berdasarkan Skor:** Game selesai saat Super Admin menekan **Finish Game**. Pemenang ditentukan dari akumulasi skor tertinggi (bukan kotak terjauh). Seri poin tertinggi menghasilkan pemenang bersama (*co-winners*).

---

## Arsitektur & Topologi

Sistem mengadopsi monorepo berbasis NPM Workspaces dengan arsitektur *event-driven* transactional outbox:

```
[ Layar Display LED / Proyektor ]       [ Konsol Super Admin (Tablet/Laptop) ]
             │                                              │
             │ HTTP / WebSocket                             │ HTTPS / WebSocket
             ▼                                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Nginx Reverse Proxy                              │
│                    (TLS Termination, WSS Upgrade, CSP)                      │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ HTTP / WS (Port 3000)
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                             Backend Node.js                                 │
│  - Express 5.x ESM (REST API & Rate Limiting)                               │
│  - Socket.IO 4.x (Real-time Broadcast & Recovery Sequence)                  │
│  - Movement Worker & Transactional Outbox Dispatcher                        │
│  - Winston Daily Rotating JSON Logger                                       │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ TCP Pool (Port 3306)
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                           MySQL 8.0 / MariaDB                               │
│  - Engine: InnoDB (Row-level Locking, Strict ACID)                          │
│  - Single Operational Pointer (`single_game`) & Historic Archive             │
│  - Double-Entry Compensation Score Ledger & Audit Trail                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Struktur Monorepo

```
Leadership-Race/
├── backend/                # Layanan Backend Express, Sequelize, Socket.IO
│   ├── migrations/         # Migrasi skema database Sequelize
│   ├── src/
│   │   ├── cli/            # CLI internal (bootstrap super admin)
│   │   ├── config/         # Konfigurasi database & environment
│   │   ├── controllers/    # Handler HTTP Express
│   │   ├── domain/         # Kalkulasi pergerakan & scoring murni
│   │   ├── models/         # Definisi model Sequelize (Identity, Turn, Game, Ledger)
│   │   ├── realtime/       # Gateway Socket.IO & payload sanitizer
│   │   ├── routes/         # Definisi rute REST API
│   │   ├── services/       # Orkestrasi bisnis, transaksi, & idempotensi
│   │   └── validation/     # Schema validasi Zod
│   └── vitest.config.js    # Konfigurasi testing Vitest backend
├── frontend/               # Klien SPA React 19 + Vite
│   ├── src/
│   │   ├── components/     # Komponen UI (RaceBoard, Leaderboard, Token, SimpleAdmin)
│   │   ├── hooks/          # Custom hooks (useDisplayBoard, useSimpleAdmin, dll.)
│   │   ├── pages/          # Halaman (Display, Leaderboard, Final, Admin, Login)
│   │   └── services/       # Koneksi REST API & Socket.IO client
│   └── vite.config.js      # Konfigurasi build Vite & dev proxy
├── docs/                   # Spesifikasi teknis, PRD, dan ADR
│   ├── PRD.md              # Product Requirement Document v1.1
│   ├── single-game.md      # Spesifikasi arsitektur single operational game
│   ├── simple-admin.md     # Spesifikasi antarmuka admin satu halaman
│   └── staging-and-operations-runbook.md # Runbook operasional & deployment
├── scripts/                # Otomasi dev, backup/restore, seed, dan smoke testing
└── SPEC.md                 # Technical Specification & Acceptance Mapping
```

---

## Fitur Utama & Rute Aplikasi

### 1. Jalur Publik (Tanpa Autentikasi)

| Rute | Deskripsi |
|---|---|
| `/` | **Main Display Board**: Visual 2.5D papan 50 kotak, animasi chip token (T1–T10), kluster pion, dan mini leaderboard samping (rasio 70:30). Dirancang untuk layar proyektor/LED 1920×1080. |
| `/leaderboard` | **Full Leaderboard**: Peringkat seluruh tim lengkap dengan rincian poin dan status posisi. |
| `/final` | **Podium & Final Results**: Tampilan selebrasi pemenang saat game berstatus `FINISHED`, mendukung pengumuman pemenang bersama (*co-winners*). |

### 2. Jalur Super Admin (Perlu Autentikasi)

| Rute | Deskripsi |
|---|---|
| `/login` | Autentikasi Super Admin berbasis email dan password dengan perlindungan brute-force (*rate-limiting* dan *secure session cookies*). |
| `/admin/games` | **Single-Page Game Workspace**: Konsol terpadu 4-in-1 untuk: <br>1. Pengaturan tim (nama, warna, urutan).<br>2. Kontrol dadu (1–6) & Active Controller lease.<br>3. Setelan poin & eksekusi challenge (BUTTON Sukses/Gagal atau MANUAL 0–200).<br>4. Reset game transaksional & arsip otomatis. |

---

## Persyaratan Sistem

- **Node.js**: `26.13.0 LTS`
- **NPM**: `11.3.0`
- **Database**: MySQL 8.0+ atau MariaDB 10.5+ (Wajib mendukung InnoDB)

---

## Panduan Instalasi & Quick Start

Ikuti langkah-langkah berikut untuk menjalankan F1 Leadership Race di lingkungan lokal:

### 1. Clone & Pasang Dependensi

Jalankan instalasi dependensi dengan opsi keamanan *fail-closed*:

```bash
git clone https://github.com/PT-PAS/Leadership-Race.git
cd Leadership-Race

# Instalasi dependensi monorepo tanpa mengeksekusi skrip pihak ketiga yang tidak diaudit
npm ci --ignore-scripts
```

> [!TIP]
> Di lingkungan dengan CLI Antigravity, gunakan awalan `rtk` (contoh: `rtk npm ci --ignore-scripts`) untuk efisiensi token.

### 2. Konfigurasi Database & Environment

Salin berkas konfigurasi template ke backend:

```bash
cp backend/.env.example backend/.env
```

Buka `backend/.env` dan sesuaikan parameter koneksi MySQL Anda:

```dotenv
NODE_ENV=development
PORT=3000
CORS_ORIGIN=http://localhost:5173
LOG_LEVEL=info

# Kredensial Database
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=lr_development
DB_USER=root
DB_PASSWORD=your_password

# Kunci Enkripsi Tanda Terima Lease Controller
CONTROLLER_RECEIPT_KEYS={"v1":"9baca3651cb39aa6221a0af1272784a5c07c4fc81c400f6c9768b8724347874e"}
```

Pastikan database `lr_development` sudah dibuat di MySQL Anda:

```sql
CREATE DATABASE IF NOT EXISTS lr_development CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 3. Eksekusi Migrasi Database

Jalankan migrasi skema tabel (users, turns, scoring, single_game, dll.):

```bash
npm run db:migrate
```

### 4. Bootstrap Super Admin Awal

Buat akun Super Admin pertama secara interaktif melalui CLI aman:

```bash
npm run admin:bootstrap --workspace backend
```

*CLI akan meminta Email, Password, dan Konfirmasi Password (input disembunyikan untuk mencegah pencatatan di history shell).*

### 5. (Opsional) Mengisi Data Demo Otomatis

Jika Anda ingin langsung menguji aplikasi dengan 5 tim F1 dan board resmi PRD:

```bash
npm run seed:demo
```

*Skrip ini akan membuat game demo, mengonfigurasi 5 tim (Red Bull, Ferrari, Mercedes, McLaren, Aston Martin), memvalidasi preflight, dan mengubah status game menjadi RUNNING.*

### 6. Menjalankan Server Pengembangan

Jalankan backend (port 3000) dan frontend (port 5173) secara bersamaan:

```bash
npm run dev
```

Buka peramban:
- **Layar Display Utama:** [http://localhost:5173/](http://localhost:5173/)
- **Konsol Login Admin:** [http://localhost:5173/login](http://localhost:5173/login)
- **Konsol Kontrol Admin:** [http://localhost:5173/admin/games](http://localhost:5173/admin/games)

---

## Daftar Perintah (NPM Scripts)

Semua perintah dapat dijalankan dari *root directory*:

| Perintah | Kategori | Deskripsi |
|---|---|---|
| `npm run dev` | Development | Menjalankan dev server backend dan frontend Vite secara konkuren |
| `npm run build` | Build | Memvalidasi sintaks backend (`node --check`) dan mem-bundle frontend (`vite build`) |
| `npm run lint` | Quality | Menjalankan linting kode via ESLint untuk seluruh workspace |
| `npm test` | Testing | Menjalankan seluruh unit & component tests (Vitest) |
| `npm run test:coverage` | Testing | Menguji test coverage dengan ambang batas ketat (90% statements/lines, 85% branch) |
| `npm run test:integration`| Testing | Menjalankan integrasi backend pada database terisolasi disposable (`lr_test_*`) |
| `npm run db:migrate` | Database | Menerapkan migrasi Sequelize ke database aktif |
| `npm run db:migrate:test`| Database | Memverifikasi target schema database pengujian |
| `npm run seed:demo` | Seed / Demo | Menyiapkan data demo lengkap (tim, konfigurasi board, akun admin) |
| `npm run test:display:browser` | Smoke / QA | Menjalankan automated smoke browser test untuk display board |
| `npm run test:launch:browser`  | Smoke / QA | Menguji peluncuran game melalui headless browser |
| `npm run test:controller:browser` | Smoke / QA | Menguji perpindahan kontrol admin dan roll dadu di browser |

---

## Variabel Lingkungan (.env)

Konfigurasi dibaca oleh [`backend/src/config/environment.js`](backend/src/config/environment.js):

| Variabel | Tipe | Default | Keterangan |
|---|---|---|---|
| `NODE_ENV` | String | `development` | Mode aplikasi: `development`, `production`, atau `test` |
| `PORT` | Integer | `3000` | Port listen server backend |
| `CORS_ORIGIN` | String | `http://localhost:5173` | Daftar origin browser yang diizinkan (pisahkan koma jika jamak) |
| `LOG_LEVEL` | String | `info` | Level log Winston (`debug`, `info`, `warn`, `error`) |
| `DB_HOST` | String | `127.0.0.1` | Host server MySQL / MariaDB |
| `DB_PORT` | Integer | `3306` | Port server MySQL |
| `DB_NAME` | String | `lr_development` | Nama database operasional |
| `DB_USER` | String | `root` | Username koneksi database |
| `DB_PASSWORD` | String | *(kosong)* | Password koneksi database |
| `CONTROLLER_RECEIPT_KEYS` | JSON String | *wajib* | JSON map kunci hex 64-karakter untuk verifikasi tanda terima *lease* controller |
| `SERVER_SHUTDOWN_TIMEOUT_MS` | Integer | `10000` | Batas toleransi shutdown aman sebelum socket dipaksa putus (ms) |
| `SERVER_HEADERS_TIMEOUT_MS`  | Integer | `65000` | Timeout parsing header HTTP (ms) |
| `SERVER_REQUEST_TIMEOUT_MS`  | Integer | `60000` | Timeout pemrosesan satu request HTTP (ms) |
| `SERVER_KEEPALIVE_TIMEOUT_MS`| Integer | `61000` | Keep-alive timeout untuk koneksi HTTP (ms) |

---

## Aturan Permainan & Mekanika Teknis

```
[Start: Kotak 0] ──▶ [Kotak 1..10] ──(Zigzag)──▶ [Kotak 41..50]
                           ▲                            │
                           │   Circuit Wrap-Around      │
                           └────────────────────────────┘
```

1. **Tata Letak Board (5 × 10):**
   - 50 kotak disusun zigzag: Baris 1 (1–10 ke kanan), Baris 2 (20–11 ke kiri), Baris 3 (21–30 ke kanan), Baris 4 (40–31 ke kiri), Baris 5 (41–50 ke kanan).
   - Kategori kotak: **Action** (15), **Reward** (10), **Race Strength** (9), **Pit Stop** (8), dan **Indisipliner** (8).

2. **Aturan Pergerakan & Sirkuit Wrap-Around (Loop):**
   - Posisi awal seluruh tim adalah Kotak 0.
   - Jika lemparan dadu melebihi Kotak 50, pergerakan melanjutkan putaran sirkuit baru (*circuit wrap-around*) mulai dari kotak 1. Contoh: Berada di kotak 48 + dadu 6 → maju ke kotak 49, 50, lalu lanjut ke kotak 1, 2, 3, 4 (landing di kotak 4).

3. **Penalti Kotak Indisipliner:**
   - Kotak Indisipliner langsung mengeksekusi penalti mundur otomatis sesuai konfigurasi kotak (misal: mundur 3 langkah).
   - Penalti tidak menghasilkan form input poin dan diselesaikan otomatis oleh backend.

4. **Penilaian Challenge (BUTTON vs MANUAL):**
   - **BUTTON**: Pilihan biner Sukses (mendapatkan poin penuh sesuai setelan kotak) atau Gagal (0 poin).
   - **MANUAL**: Super Admin dapat memasukkan nilai angka bebas antara 0 hingga 200 poin.
   - Poin dicatat dalam *Double-Entry Compensation Ledger*; setiap koreksi poin mempertahankan audit trail tanpa menghapus baris histori transaksi awal.

5. **Reset & Archiving Transaksional:**
   - Tindakan **Reset Game** di konsol admin menyalin nama sesi, konfigurasi tim, dan setelan 50 kotak ke sesi DRAFT baru.
   - Seluruh histori giliran, ledger skor, dan rekaman audit sesi lama tetap diarsipkan secara aman di database.

---

## Operasional: Backup, Restore & Rehearsal

Aplikasi menyediakan utilitas CLI untuk menjamin keandalan saat acara berlangsung (*venue operations*):

### 1. Pencadangan Data (Backup)

Eksekusi backup database secara transaksional dengan checksum SHA-256:

```bash
# Otomatis membuat file di folder backups/backup-YYYY-MM-DDTHH-mm-ss.json
node scripts/backup.js

# Atau tentukan path output spesifik
node scripts/backup.js --output /var/backups/f1_race_snapshot.json
```

### 2. Pemulihan Data (Restore)

Pulihkan kondisi database dari berkas backup:

```bash
node scripts/restore.js backups/backup-2026-11-11T16-00-00.json
```

### 3. Simulasi Rehearsal Skala Penuh

Jalankan simulasi beban event (10 tim, 5 operator admin konkuren, 3 layar display publik) untuk memverifikasi P95 latency (< 1.000 ms) dan integritas transaksi:

```bash
node -e "import('./scripts/rehearsalSimulation.js').then(m => console.log('Rehearsal runner loaded'));"
```

---

## Health Probes & Graceful Shutdown

Layanan backend mengimplementasikan standar observabilitas produksi:

- **Liveness Probe (`GET /health/live`)**:
  - Mengembalikan HTTP 200 dan uptime proses Node.js selama loop event berjalan normal.
- **Readiness Probe (`GET /health/ready`)**:
  - Mengembalikan HTTP 200 hanya jika pool koneksi MySQL berhasil terautentikasi (`sequelize.authenticate()`).
  - Mengembalikan HTTP 503 (`SERVICE_UNAVAILABLE`) jika koneksi database putus atau aplikasi sedang dalam proses terminasi (*graceful shutdown*).

### Alur Graceful Shutdown

Saat server menerima sinyal `SIGTERM`, `SIGINT`, atau perintah shutdown:
1. Status `/health/ready` segera dialihkan menjadi HTTP 503 untuk memberi sinyal pada load balancer / Nginx.
2. Header `Connection: close` diinjeksikan pada setiap request masuk baru.
3. Server berhenti menerima koneksi baru dan menyelesaikan request yang sedang berjalan (*in-flight*).
4. Pool koneksi database ditutup secara bersih via `closeSequelize()`.
5. Socket yang menggantung diputus secara bertahap dalam batas `SERVER_SHUTDOWN_TIMEOUT_MS`.

---

## Keamanan & Standar Pengujian

- **Isolasi Database Pengujian (`assertSafeTestSchema`)**:
  Suite pengujian otomatis hanya diizinkan berjalan pada skema database acak dengan awalan `lr_test_*`. Operasi pada database pengembangan (`lr_development`) atau produksi akan langsung dibatalkan secara *fail-safe*.
- **Redaksi Data Sensitif**:
  Logger Winston secara otomatis menyaring token akses, refresh token hash, password, dan kredensial database sebelum ditulis ke log harian.
- **Payload Publik Sanitized**:
  Endpoint snapshot dan event WebSocket publik hanya mendistribusikan data tampilan (posisi tim, papan, status giliran, leaderboard). Kunci rahasia, audit trail, token controller lease, dan identitas admin tidak pernah dibocorkan ke klien publik.

---

## Indeks Dokumentasi Proyek

Untuk rincian teknis lebih mendalam, pelajari berkas dokumentasi berikut:

- [**docs/PRD.md**](docs/PRD.md): Product Requirement Document v1.1 (kontrak resmi produk, aturan 50 kotak, dan tata kelola event).
- [**SPEC.md**](SPEC.md): Technical Specification lengkap mencakup pemetaan capability, transisi state machine, dan acceptance criteria.
- [**docs/staging-and-operations-runbook.md**](docs/staging-and-operations-runbook.md): Panduan instalasi server staging, konfigurasi Nginx reverse proxy, dan SOP mitigasi gangguan saat acara.
- [**docs/single-game.md**](docs/single-game.md): Spesifikasi arsitektur pointer single-game, public board, dan mekanisme reset.
- [**docs/simple-admin.md**](docs/simple-admin.md): Spesifikasi fungsional dan desain interaksi antarmuka admin satu halaman.
- [**AGENTS.md**](AGENTS.md): Pedoman pengembangan AI agent, aturan invariant, dan standar kontribusi kode.
