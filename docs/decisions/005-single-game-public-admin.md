# ADR-005 — Satu game operasional, board publik dan admin satu halaman

**Status:** Accepted; merekam keputusan simplifikasi yang sudah diterapkan.  
**Tanggal:** 11 November 2026.  
**Acuan:** PRD §2/4–7/9–15, SPEC §4/7–10/12, single-game dan simple-admin.

## Konteks dan keputusan

Operator acara memerlukan satu sesi bermain dengan setup/input dadu/poin/reset yang mudah ditemukan.
Display venue harus langsung menampilkan board tanpa proses pairing atau pemilihan game.

- Pointer `single_game` menentukan satu game operasional. `/`, `/leaderboard` dan `/final` terbuka read-only.
  Snapshot/replay/socket publik hanya untuk game tersebut; actor, controller, audit dan credential tetap privat.
- `/admin/games` menyatukan tim, posisi melalui dadu fisik 1–6, setelan poin per kotak dan reset.
  Mulai bermain menjalankan preflight/Start; lease kosong otomatis dan takeover browser lain dikonfirmasi.
- Reset terkonfirmasi/berversi/idempotent menyalin konfigurasi tersimpan ke DRAFT baru. Posisi/skor/giliran
  mulai 0 tanpa turn/controller aktif; sesi lama tetap utuh sebagai arsip hanya baca. Reset berbeda dari Finish.
- Board memuat hanya judul, board dan leaderboard 75:25, START terintegrasi, cluster/animasi di dalam grid.
  Kategori selalu lengkap. Tidak ada HUD/tracker/occupancy panel, toolbar, audio atau dialog kiosk.
- Editor board lengkap, control/lifecycle/void, scoreboard, histori/koreksi/CSV tetap di URL kompatibilitas
  admin per ID. Katalog, duplikasi dan pairing tidak memiliki UI; API lama tetap tersedia dan dilindungi.

## Hubungan dengan keputusan sebelumnya

Menggantikan **kewajiban pairing untuk akses display** pada ADR-002 dan penggunaan DTO/event admin untuk
display utama pada ADR-003. Kontrak auth admin, keamanan session lama, receipt terenkripsi, transaksi,
ledger, sequence dan outbox pada ADR-002/003 tetap berlaku. Detail pairing disimpan sebagai kompatibilitas,
bukan langkah operator. ADR-001 (toolchain) dan ADR-004 (batas/scoring) tetap berlaku.

API katalog/duplikasi tidak mengganti pointer publik. Arsip menolak mutasi baru dan cookie display lama;
receipt sukses lama tetap dapat di-replay. Tidak ada penghapusan ledger/histori atau migrasi destruktif.

## Konsekuensi dan verifikasi

Polling pointer 2 detik melengkapi Socket.IO dan memindahkan display setelah reset tanpa reload. Event/replay
publik berisi invalidasi kosong; snapshot publik menyediakan state aman, termasuk timeline movement.
Rilis perlu mengukur commit→render beserta refetch, bukan menganggap durasi request sebagai latensi realtime.

Invariant authorization, validasi server, transaksi/idempotency, audit/outbox dan isolasi sesi tetap wajib.
Test yang relevan: singleGame integration/component, simpleAdmin, displayConnection, movement timeline,
smokeDisplay dan smokeSimpleAdmin. Hasil run/batas rilis ada pada task list dan acceptance-and-rehearsal.
Keputusan ini tidak mengotorisasi merge/deploy atau reset data bersama.
