# Satu game, board publik, dan reset

Aplikasi menggunakan satu game operasional yang ditunjuk oleh pointer server. Board publik, halaman admin
dan reset memakai sesi yang sama sesuai PRD §4–7/10–15 dan SPEC §4/7–9.

- `/` langsung menampilkan 50 kotak dan leaderboard tanpa login, kode, atau cookie display.
  Sebelum game disiapkan, server memberikan preview template PRD tanpa tim/poin rekaan.
  Saat request pertama masih berlangsung atau gagal, grid 50 slot tetap terlihat.
- `/admin/games` mengelola satu game operasional. Tindakan **Atur tim** menyiapkan game sebelum
  inisialisasi pertama pada [admin satu halaman](simple-admin.md).
  Inisialisasi bersamaan mengembalikan game yang sama.
- Admin tetap login sebagai Super Admin. Setup, controller, dadu, skor, pause, finish, histori dan CSV
  memakai authorization serta validasi yang sama. Display hanya memiliki endpoint GET publik.
- Tombol **Reset game** ada pada halaman utama admin, dengan konfirmasi browser. Reset menyalin
  nama event, tim/urutan/warna, seluruh konfigurasi kotak dan provenance board ke sesi DRAFT baru.
  Skor/posisi mulai 0, nomor giliran 0, tanpa turn/controller aktif; **Mulai bermain** menjalankan preflight dan Start.
- Turn, hasil, ledger, audit, dan final result sesi lama tidak dihapus atau dikompensasi. Tautan sesi
  lama masuk arsip; arsip hanya dapat dibaca dan diekspor oleh admin melalui API/URL histori lama.
  Daftar arsip tidak ditampilkan pada halaman utama admin. Koreksi arsip ditolak.
- Reset menunggu animasi selesai. Hasil challenge yang masih pending dapat diarsipkan tanpa diberi skor.
  Version guard mencegah reset terhadap state yang sudah berubah. Receipt dengan key yang sama tetap
  dapat diputar ulang sesudah pengarsipan; key berbeda tidak membuat reset kedua pada sesi lama.
- Pointer `single_game` dan tautan `game_archives` diperbarui bersama salinan konfigurasi, audit,
  command receipt, event dan outbox dalam satu transaksi. Event diterbitkan setelah commit.
- Board memeriksa sesi operasional setiap 2 detik dan memakai Socket.IO untuk perubahan realtime.
  Setelah reset, board berpindah ke sesi baru tanpa reload/pairing. Snapshot polling yang lebih lama
  tidak menimpa sequence yang lebih baru dari koneksi realtime.
- `/final` dan `/leaderboard` tetap tersedia tanpa pairing. URL `/display/:id/*` lama menuju board `/`.

Kontrak publik tidak mengubah hak akses admin. Histori, koreksi, Finish/Pause dan editor board lengkap
berada pada URL kompatibilitas per ID; empat tugas halaman utama mengikuti [admin satu halaman](simple-admin.md).

## API

| Endpoint | Kontrak |
| --- | --- |
| `GET /api/v1/public/game` | Snapshot board game operasional, atau preview jika belum ada game |
| `GET /api/v1/public/games/:id/snapshot` | Hanya ID game operasional saat ini; ID lain 404 |
| `GET /api/v1/public/games/:id/events?afterSequence=N` | Replay berurutan dengan payload invalidasi kosong |
| `POST /api/v1/games/current` | Super Admin, `{name}`, UUID `Idempotency-Key`; klaim/inisialisasi satu game |
| `POST /api/v1/games/:id/reset` | Super Admin, `{expectedStateVersion,confirmed:true}`, UUID key |
| `GET /api/v1/games/archives?page=1&limit=20` | Metadata arsip terpagina, Super Admin |

Handshake socket publik memakai `{gameId,public:true}` dan hanya dapat join game operasional.
Server memeriksa scope pada handshake, join, scan berkala dan setiap emit. Payload publik merupakan
invalidasi kosong; snapshot publik hanya memuat game, tim, kotak, leaderboard, movement dan status turn.
Identitas controller, lease token, actor, audit dan credential tidak dikirim ke jalur publik.

API domain lama untuk admin/isolasi game dan sesi display lama dipertahankan untuk kompatibilitas data
dan pengujian. UI pairing, pengelolaan kode, pemilihan game dan duplikasi tidak lagi menjadi alur aplikasi.
Endpoint lama tidak dapat mengganti pointer game operasional; game lain tidak menjadi publik.
Cookie display lama juga ditolak pada sesi yang sudah diarsipkan; akses histori tetap milik admin.

## Migration dan verifikasi

Migration additive `202611110001-createSingleGame.cjs` tidak menghapus/mengubah ledger atau histori.
Pada database yang sudah berisi game, pointer mengadopsi game dengan `updated_at` terbaru, lalu ID menaik
sebagai pemecah seri. Semua game lama tetap tersimpan dan bisa dibaca admin melalui API domain lama.
Backup/restore mencakup kedua tabel baru. Restore backup lama mengadopsi game terbaru untuk pointer
operasional jika backup belum memiliki `single_game`. Rollback kode tidak memerlukan penghapusan arsip.

Uji persistence menggunakan schema disposable `lr_test_*` pada MariaDB lokal 3306.
Perintah verifikasi dan hasil akhir dicatat ringkas di `tasks/todo.md`.
Kompatibilitas MySQL produksi, coverage penuh dan verifikasi venue/screen reader tetap menjadi gate rilis.

Implementasi utama: migration `202611110001-createSingleGame.cjs`, model/service/controller/router
`singleGame`/`publicGame`, command guard dan history/backup backend; `App`, `useDisplayBoard`,
`displayConnection`, `useSingleGame`, `SimpleGameAdmin` serta navigasi/admin/public pages frontend.
Test terkait: integrasi `singleGame.test.js`, komponen `singleGame.test.jsx`, recovery connection,
root/health dan `smokeDisplay.js`. Seed demo serta smoke UI memakai alur publik yang sama.
