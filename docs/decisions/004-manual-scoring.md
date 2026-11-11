# ADR-004 — Scoring MANUAL, Penanganan Origami, dan Batas Poin (Gate D-03)

**Status:** Accepted — G10 Implementation, 10 November 2026.  
**Acuan:** PRD §5/9/10/12 (FR-06–FR-08, AT-24–AT-31, AT-57, AT-59–AT-60); SPEC §4.4; Gate D-03.

## 1. Konteks dan Masalah

Pada giliran bertipe non-Indisipliner, panitia memfasilitasi aktivitas atau tantangan secara offline (di luar aplikasi).
Super Admin memasukkan hasil evaluasi poin ke aplikasi. G9 telah mengimplementasikan penilaian via mode BUTTON (Sukses/Gagal).
G10 menambahkan penilaian mode MANUAL untuk mencatat total poin bulat non-negatif yang ditentukan panitia (misalnya tantangan khusus, reward performa, atau Origami kotak 26).

Keputusan Gate D-03 diperlukan untuk menetapkan:
1. Batas maksimum poin manual di backend (`MAX_MANUAL_POINTS_PER_RESULT`).
2. Ambang batas poin besar yang memerlukan konfirmasi eksplisit di frontend (`LARGE_POINTS_THRESHOLD`).
3. Bentuk dan alur konfirmasi eksplisit untuk poin 0 dan poin besar.
4. Perilaku khusus kotak 26 (Origami) dengan unit guidance dan peringatan non-blocking.

## 2. Keputusan Desain (Gate D-03)

### 2.1 Batas Poin Manual Backend
- Nilai batas: `MAX_MANUAL_POINTS_PER_RESULT = 200`.
- Tipe data: Integer bulat non-negatif (`0 <= points <= 200`).
- Validasi ketat: String, pecahan (float), angka negatif, angka > 200, dan unsafe integer ditolak dengan `400 VALIDATION_ERROR`.
- Nilai yang masuk diperlakukan sebagai **total poin giliran tersebut**, bukan penambahan di atas `success_points` (contoh kotak 44: BUTTON/SUCCESS = 50, tetapi MANUAL 35 menghasilkan total 35 poin, bukan 85).

### 2.2 Mutual Exclusivity Metode Penilaian
- Untuk `BUTTON`: Field `outcome` wajib `'SUCCESS' | 'FAIL'`; pengiriman field `points` dilarang (menghasilkan 400).
- Untuk `MANUAL`: Field `points` wajib integer `0..200`; pengiriman field `outcome` dilarang (menghasilkan 400).
- Setiap giliran hanya dapat diselesaikan satu kali (`UNIQUE(turn_id)` pada `challenge_results`). Percobaan submit ganda menghasilkan `409 ALREADY_RESOLVED`.
- Idempotency-Key menjamin percobaan ulang dengan payload yang sama mengembalikan respon 200 identik tanpa duplikasi skor atau ledger.

### 2.3 Aturan Kotak 26 (Origami)
- Default UI method untuk kotak 26 adalah `MANUAL`.
- Panduan konversi: `1 origami = 5 poin` (`pointsPerUnit = 5`). Admin memasukkan total akumulasi poin (misalnya 4 origami = 20 poin).
- Peringatan non-blocking: Jika angka poin yang dimasukkan bukan kelipatan 5 (dan > 0), UI memunculkan peringatan kontekstual bahwa nilai bukan kelipatan 5, namun **tidak memblokir** tombol simpan dan tidak membulatkan angka secara sepihak.
- Mode `BUTTON` tetap tersedia sebagai alternatif (Sukses = 5 poin, Gagal = 0 poin).

### 2.4 Konfirmasi Eksplisit Frontend
- **Poin 0:** Memerlukan konfirmasi browser:
  *"Poin 0 akan menyelesaikan giliran tanpa menambah skor tim. Lanjutkan?"*
- **Poin Besar (> 50 poin):** Ambang batas besar ditetapkan pada `LARGE_POINTS_THRESHOLD = 50`.
  Memerlukan konfirmasi browser:
  *"Poin yang dimasukkan ({points} poin) cukup besar (>50). Pastikan nilai ini sudah sesuai sebelum menyimpan."*
- Jika admin membatalkan konfirmasi, form tidak mengirim mutasi ke server.

### 2.5 Invariant Ledger dan Zero Delta
- Untuk `awardedPoints > 0`: Dibuat 1 baris `challenge_results` dan 1 baris `score_ledger` (`source = 'CHALLENGE_MANUAL'`), serta `team.totalScore` bertambah sebesar `awardedPoints`.
- Untuk `awardedPoints === 0` (poin manual 0 atau BUTTON FAIL): Dibuat 1 baris `challenge_results` dengan `awardedPoints = 0`, namun **TIDAK ADA baris `score_ledger` baru** (zero delta invariant). `team.totalScore` tidak berubah.
- Invariant total: `team.totalScore == SUM(score_ledger.delta_points)` selalu terpenuhi.

## 3. Konsekuensi dan Verifikasi
- Pengujian unit validasi (`turnValidation.test.js`) memverifikasi batas 0, 200, penolakan 201, negatif, float, dan mutual exclusivity.
- Pengujian integrasi (`turnResult.test.js`) memverifikasi alur kotak 26 Origami 20 poin, kotak 44 35 poin, manual 0 poin, zero-delta ledger, dan replay idempotency.
- Pengujian komponen frontend (`challengeScoring.test.jsx`) memverifikasi toggle tab, default MANUAL kotak 26, warning kelipatan 5, konfirmasi 0 poin, konfirmasi poin besar, dan deaktivasi tombol pada input tidak valid.

