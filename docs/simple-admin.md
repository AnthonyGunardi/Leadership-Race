# Admin satu halaman

Halaman utama `/admin/games` menyediakan empat tugas pada satu halaman:

1. **Tim:** nama, warna, jumlah 2–10 tim, dan urutan giliran.
2. **Posisi pion:** posisi serta poin setiap tim, tim aktif, dan enam tombol input dadu fisik 1–6.
3. **Setelan poin challenge:** pilih kotak, ubah poin Sukses dan metode awal BUTTON/MANUAL.
   Nilai tiap kotak dipertahankan; Gagal tetap 0, input manual tetap 0–200 saat penilaian.
4. **Reset game:** konfirmasi sebelum skor, posisi dan giliran diulang; tim dan board tersimpan disalin,
   sedangkan histori sesi lama tetap diarsipkan.

Tidak ada pemindahan pion bebas ke nomor kotak. Server tetap menghitung lintasan dan penalti dari dadu.
Saat hasil menunggu, tombol Sukses/Gagal atau input manual tampil pada bagian Posisi pion.
Satu giliran tetap hanya menerima satu hasil; skor berasal dari ledger server.

Tim dan poin disimpan bersama melalui endpoint setup yang sudah ada, sebelum game dimulai.
Pemilih challenge hanya mengubah field poin/metode kotak tersebut; kategori, instruksi, penalti,
nilai kotak lain, dan provenance board mengikuti kontrak setup. Form tidak memuat editor seluruh 50 kotak.
Draft pengaturan tidak diganti oleh polling posisi; konflik simpan meminta muat ulang secara eksplisit.
Sesudah simpan, snapshot kontrol diperbarui agar mulai game memakai versi terbaru.

**Mulai bermain** menjalankan preflight lalu Start menggunakan versi respons server untuk langkah berikutnya.
Kedua langkah mempertahankan validasi, authorization, transaksi, audit/outbox dan idempotency masing-masing.
Jika respons tidak diketahui, retry menggunakan key langkah yang sama sebelum alur dilanjutkan.
Tim dan poin terkunci setelah mulai dan dapat dilipat untuk memberi ruang pada input dadu.

Browser mengambil controller yang kosong secara otomatis. Lease/heartbeat tetap memakai token dalam memori.
Controller browser lain tidak diambil otomatis: **Gunakan kontrol di sini** membutuhkan konfirmasi dan
tetap memakai version guard server. Konflik acquire tidak memicu loop retry. Kontrol tulis dinonaktifkan
ketika offline, request berlangsung, respons belum pasti, atau status server belum tersedia.
Game lama yang PAUSED menyediakan tombol lanjut; game FINISHED menyediakan reset.

Sidebar, panel controller teknis, katalog/arsip, pause/finish, histori/koreksi, dan editor board tidak
ditampilkan sebagai menu pada halaman utama admin. URL admin lama tetap tersedia untuk kompatibilitas
operasional dan akses histori; data/API-nya tetap dilindungi. Refresh sesi dipulihkan saat reload halaman,
tanpa tombol pembaruan sesi pada alur utama. Reset tetap berada di `/admin/games` setelah pointer game berganti.

Implementasi mengikuti PRD §3/5/7/9/12/13 dan rules 00/01/02/10/30/40. PRD §7, SPEC §9 dan
[single-game](single-game.md) mendeskripsikan komposisi yang sama.
Kontrak [satu game dan reset](single-game.md) tetap berlaku.

File utama: `AdminSessionPage`, `SimpleGameAdmin`, `SimpleGameWorkspace`, `AdminTeamSettings`,
`AdminPointSettings`, `useSimpleAdmin`, `useSingleGame`, `useControllerLease`, `useGameSetup`, `useGames`,
dan `simpleAdmin.css`. Tidak ada perubahan schema atau API backend.
Test baru berada di `frontend/src/__tests__/simpleAdmin.test.jsx` dan `scripts/smokeSimpleAdmin.js`.
Test login dan smoke display terkait diselaraskan dengan penghapusan tombol refresh dan navigasi arsip;
assertion rotasi/revokasi sesi dan arsip hanya baca dipertahankan.

Verifikasi: `npm run lint`, `npm run build`, `npm test`, serta `node scripts/smokeSimpleAdmin.js`.
Smoke menggunakan MariaDB lokal dan schema disposable `lr_test_*`, HTTPS, Chromium, serta viewport
320/768/1024/1440. Bukti visual berada di `test-results/simple-admin/`.
Status hasil aktual dicatat di [tasks/todo.md](../tasks/todo.md).

Runtime yang diperiksa mencakup draft/simpan, konflik, koneksi terputus, retry dengan key sama,
takeover terkonfirmasi, validasi field dalam kelompok terlipat, giliran/animasi, serta reset/cancel.
Screenshot desktop/ponsel diperiksa; resize teks 200% tidak menimbulkan overflow pada 320 px.
Warna teks `#202938`, muted `#505c6d`, dan tautan `#b90500` terhadap `#f8f9fb` dihitung memiliki
rasio 13,88:1 / 6,45:1 / 6,46:1; putih terhadap tombol merah 6,81:1 dan border input terhadap putih 3,22:1.
Interaksi keyboard/fokus diperiksa; pengujian screen reader langsung belum dilakukan.
