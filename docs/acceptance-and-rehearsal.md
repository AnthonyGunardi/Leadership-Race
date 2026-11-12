# Acceptance, rehearsal dan verifikasi venue

Dokumen ini memetakan kontrak aktif PRD §15 (FR-01–FR-23, AT-01–AT-69) dan SPEC §12 (R-01–R-14)
ke source/test yang tersedia. Ketersediaan test bukan bukti seluruh skenario lulus pada baseline terbaru.
Hasil eksekusi terdahulu dan kegagalan dipertahankan di [task list](../tasks/todo.md).

## Alur yang harus diverifikasi

1. Buka `/` tanpa login/pairing: 50 kotak/START terlihat, termasuk sebelum inisialisasi dan saat request awal gagal.
2. Login → `/admin/games` → Atur tim bila belum ada → simpan 2–10 tim dan poin tiap kotak.
3. Mulai bermain → preflight/Start berurutan → lease kosong otomatis → input dadu fisik 1–6.
4. Gerak per kotak/penalti mengikuti server, STARTING tetap di asal, satu pion per tim.
5. Hasil non-Indisipliner BUTTON XOR MANUAL → satu hasil/ledger valid → giliran berikutnya.
6. Reset batal tanpa mutasi; reset terkonfirmasi menyalin konfigurasi tersimpan ke DRAFT baru, mengarsipkan
   histori utuh dan memindahkan board/subscription tanpa reload. Arsip menolak mutasi baru dan baca publik.
7. URL kompatibilitas menguji pause/resume, void terakhir, koreksi, histori/CSV dan Finish/final/co-winner.
   Menu tersebut tidak harus muncul pada halaman utama. Pairing hanya regression API/session lama.

## Batas bukti rehearsal yang tersedia

[scripts/rehearsalSimulation.js](../scripts/rehearsalSimulation.js) dan
[rehearsalAndAcceptance.test.js](../backend/src/tests/integration/rehearsalAndAcceptance.test.js)
menjalankan simulasi dipercepat melalui API kompatibilitas create/template dan pairing. Itu bukan flow utama
satu game/admin/public dan bukan rehearsal panggung 60 menit.

| Klaim | Yang benar-benar dilakukan harness | Implikasi bukti |
| --- | --- | --- |
| 10 tim, 5 admin, 3 display | Membuat akun/tim dan mencoba exchange session; angka displaysCount berasal dari parameter | Tidak membuktikan tiga browser publik aktif/tersinkron atau lima operator bersamaan |
| P95 write <1.000 ms | Mengukur request HTTP write sukses dengan performance.now | Gunakan output run aktual beserta lingkungan/build; angka lama <35 ms bukan baseline yang dapat disimpulkan dari source |
| Realtime <1.500 ms | Memakai Math.min(150, waktu sejak request roll), tanpa observasi socket/render | Angka <150 ms bukan pengukuran propagasi; target commit→browser publik belum terbukti oleh harness ini |
| Settlement worker mandiri | Memajukan movementEndsAt di DB lalu memanggil settlement langsung | Membuktikan jalur settlement fixture; bukan worker/timing produksi mandiri |
| Tidak ada transaksi ganda | zeroDoubleTransactions diisi true pada summary | Flag bukan pengukuran; perlu concurrency/receipt/ledger assertions di test terkait |
| Co-winner | Mengecek array winners tersedia dan rank pertama 1 | Belum membuktikan skenario seri aktual; gunakan scoring/lifecycle regression |
| Origami | Cabang khusus harness memeriksa kotak 16 | Origami yang benar kotak 26; bukti aturan di turnResult/challengeScoring, bukan cabang harness itu |

Harness tidak diubah pada audit dokumentasi. Temuan ini menjadi pekerjaan verifikasi/perbaikan terpisah;
jangan menandai seluruh AT/R, perangkat venue atau target latensi lulus berdasarkan summary tersebut.
Jalankan persistence test hanya pada schema disposable `lr_test_*` di MariaDB lokal 3306.

## Matriks kebutuhan aktif

Kolom terakhir menunjuk test yang perlu dilihat/dijalankan, bukan status lulus terbaru.

| FR | Kontrak PRD | Source/test utama |
| --- | --- | --- |
| FR-01 | Login/logout/refresh, session, role | adminSessions/adminAuth; adminIdentity integration; E2E auth |
| FR-02 | Satu game, tim/poin, Mulai bermain | singleGame/gameSetup/gamePreflight; singleGame/simpleAdmin/gameLaunch tests |
| FR-03 | Dadu fisik 1–6, round-robin | movement/turnCommands; movement/turnRoll tests |
| FR-04 | Path/sirkuit wrap-around/penalti tunggal server | movement; movement/turnRoll/displayBoardMotion tests |
| FR-05 | BUTTON SUCCESS/FAIL | turnCommands; turnResult/challengeScoring tests |
| FR-06 | MANUAL integer 0–200 | validation/turn; turnValidation/turnResult/challengeScoring tests |
| FR-07 | Challenge/Reward di luar aplikasi | gamePreflight/turnCommands; preflight/result tests tanpa narasi wajib |
| FR-08 | Origami kotak 26, default MANUAL dan panduan 5 poin/unit | boardTemplate; turnResult/challengeScoring tests |
| FR-09 | Leaderboard dari skor server | domain/scoring; scoring/gameLifecycle tests |
| FR-10 | Start/pause/resume/Finish manual | gameSetup; gameLifecycle tests; URL control kompatibilitas |
| FR-11 | Lease/takeover dan scoring multi-admin | controllerLeases; controllerLease/turnResult integration |
| FR-12 | Authorization, transaksi/idempotency, ledger/audit/outbox | gameCommands/turnCommands; gameSetup/turnRoll/turnResult/crossFlowRecoveryAndMultiGame |
| FR-13 | Snapshot/socket/replay/reconnect | gateway/displayConnection; display/singleGame/displayConnection tests |
| FR-14 | Grid zigzag 50 kotak, 2.5D | RaceBoard/boardSimple.css; boardView/displayBoardG15/smokeDisplay |
| FR-15 | Chip T1–T10 | RacingToken/RacingChip/TokenCluster; component/smokeDisplay |
| FR-16 | Maksimal tiga chip + N dan total akurat | boardView/TokenCluster; boardView/displayBoardG15 |
| FR-17 | Overlay/highlight dalam board | MovementOverlay/movementTimeline; displayBoardMotion/useMovementTimeline; smoke --movement |
| FR-18 | Leaderboard samping, board 70–75% | LeaderboardPanel/boardSimple.css; smokeUiPolish |
| FR-19 | Hanya judul, board dan leaderboard | DisplayBoardPage; displayBoardG15/smokeUiPolish |
| FR-20 | Reduced motion OS; fullscreen/kiosk browser/OS | CSS/timeline; reduced-motion tests dan manual venue |
| FR-21 | Histori/koreksi/CSV | gameHistory/scoreCorrections; domain/csvExport; history/correction/csvExport tests |
| FR-22 | Satu game publik, reset/arsip dan isolasi sesi | singleGame; singleGame integration/component/smokeDisplay/smokeSimpleAdmin |
| FR-23 | Keterbacaan LED fisik/jarak venue | Protokol venue di bawah; belum disahkan oleh headless |

AT-62–AT-67 menguji akses publik/reset/admin; AT-68 menguji STARTING tanpa teleport; AT-69 menguji kategori
lengkap pada viewport/cluster/gerakan. R-01–R-03: worker/settlement; R-04: pause pending; R-05–R-07/R-12:
void/kompensasi; R-08: session display kompatibilitas; R-09–R-11: create/replay/READY invalidation;
R-13–R-14: rekonsiliasi visual void dan snapshot terlambat. Expected result individual tetap di PRD/SPEC.

## Protokol venue dan gate tersisa

- Buka board publik pada LED 1920×1080 dan 1366×768; hanya judul, board dan leaderboard, seluruh grid terlihat.
  Periksa nomor/kategori lengkap, kode/nama/posisi/poin, sepuluh tim satu kotak dan gerakan tanpa overlap.
- Catat perangkat, browser, jarak penonton terjauh, jaringan, build dan hasil tiap skenario. Uji grayscale,
  kontras rendah, keyboard, teks 200%, reduced motion OS, fullscreen dan sleep browser/OS.
  Rasio target teks ≥4.5:1/grafis penting ≥3:1 tetap memerlukan pemeriksaan; screenshot tidak membuktikan jarak venue.
- Jalankan rehearsal **60 menit**, 10 tim, 5 akun admin dan **3 browser publik tanpa pairing**, dengan
  reconnect/restart, takeover, hasil, reset serta backup/restore terisolasi. Ukur commit→render termasuk refetch publik.
- Lengkapi coverage dan regression wajib, investigasi kegagalan refresh sesi/deadlock pada smoke gabungan,
  compatibility MySQL produksi, rekonsiliasi workbook, aset resmi dan uji screen reader.

G1–G18 dan simplifikasi terimplementasi, tetapi seluruh quality gate rilis belum dapat dinyatakan terpenuhi.
Hasil lint/build/unit/smoke terdahulu tidak otomatis mengesahkan produksi atau venue. Merge/deploy tetap
memerlukan otorisasi tersendiri; audit dokumentasi tidak menjalankan atau mengklaim gate runtime baru.
