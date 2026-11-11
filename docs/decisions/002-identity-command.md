# ADR-002 — Identity, pairing, dan receipt command

**Status:** Accepted untuk auth admin, receipt dan kompatibilitas session lama. Kewajiban pairing pada
display utama digantikan [ADR-005](005-single-game-public-admin.md). Auth/receipt/session tersedia di source;
hasil eksekusi dan batas gate mengikuti task list.
**Acuan:** SPEC §4.4/7.1/8/10/14 D-02/D-05; PRD §4/10–13; R-04/R-08–R-10.

## Batas kepercayaan dan keputusan

Browser, HTTP/Socket input, cookie, dan environment adalah boundary tervalidasi Zod. Aset yang dilindungi:
credential admin, akses baca satu game, ledger dan kemampuan mengubah state. Risiko utama adalah token theft,
refresh reuse, tebakan kode pendek, cross-game access, duplicate write dan kebocoran receipt antaradmin.
Semua akun operasional aktif ber-role `SUPER_ADMIN` dapat mengelola game; tidak ada role/tenant baru.

Gunakan bearer access token **opaque** acak 32 byte CSPRNG, base64url; hash SHA-256 disimpan server,
plaintext access token hanya di memory client admin. Session lookup setiap REST/Socket authorization
memeriksa akun aktif, role, expiry dan revocation. Tidak perlu JWT/signing library atau Web Storage.
Refresh juga opaque 32 byte, hanya cookie `__Host-lr_admin_refresh`, `HttpOnly; Secure; SameSite=Lax; Path=/`,
tanpa Domain. Deployment browser/API/Socket same-origin HTTPS; localhost test cookie memakai HTTPS.
Endpoint cookie write memeriksa Origin terhadap origin terkonfigurasi dan menolak cross-origin.
Access token boleh di JSON **auth admin**; token session display tidak boleh di JSON.
Response credential memakai `Cache-Control: no-store`, redaksi body/header/cookie di semua log/audit/APM.

## Admin dan bootstrap

| Store | Field dan constraint tambahan selain UUID/timestamp |
|---|---|
| `users` | email normalized unique, password_hash, role SUPER_ADMIN, is_active; tidak ada credential default |
| `admin_sessions` | user_id FK, expires_at, revoked_at/reason nullable, refresh_generation; index user/expiry |
| `admin_refresh_tokens` | session_id FK, token_hash unique, generation, expires_at, used_at/replaced_by nullable; unique session/generation |
| `admin_access_tokens` | session_id FK, token_hash unique, expires_at, revoked_at nullable; index session/expiry |

Access TTL **15 menit** dari penerbitan. Refresh TTL **7 hari** dari penerbitan tiap token; rotasi memperbarui
session expiry ke expiry refresh baru. Aktivitas biasa tidak memperpanjang expiry. Token yang sudah dipakai
tetap disimpan untuk reuse detection selama family session masih aktif; jangan menghapus hash spent token
saat rotasi. Satu session menjadi satu family; reuse mencabut seluruh family, termasuk access token dan socket.

Login memverifikasi password hash bcrypt dengan cost minimal 12; implementasi mem-pin paket saat G2,
memvalidasi batas input UTF-8 72 byte agar tidak terjadi truncation. Bootstrap adalah CLI lokal terotorisasi,
email dan password melalui prompt tersembunyi + konfirmasi, tanpa argv/log/seed/password default atau route
registrasi publik. CLI menolak email existing; mengubah akun existing memerlukan operasi terpisah.
Login/pairing mempunyai limiter per-IP dan login juga per-account; baseline login 10 gagal/15 menit.
Counter harus shared bila multi-process; tidak menambah Redis untuk single-instance G1/G2.

| Endpoint `/api/v1` | Input / hasil `data` | Semantik retry |
|---|---|---|
| POST `/auth/login` | `{email,password}` → `{accessToken,accessExpiresAt,user:{id,email,role}}` + refresh cookie | Tidak auto-retry setelah unknown; login ulang boleh membuat session baru |
| POST `/auth/refresh` | Body `{}`, refresh cookie → access DTO + cookie baru | Lock session/token, consume lama dan issue baru satu transaksi |
| POST `/auth/logout` | Body `{}`, refresh cookie atau access bearer → `{loggedOut:true}` + clear cookie | Idempotent revoke; cookie invalid juga dihapus; tidak membuka akses lain |

Login/refresh/logout **tidak** memakai game command_log atau generic Idempotency-Key.
Refresh expired/revoked/used/invalid → 401 UNAUTHENTICATED. Dua refresh konkuren dengan token sama:
satu rotasi, request kedua mendeteksi reuse dan mencabut family. Client single-flight refresh termasuk antar-tab
(Web Locks/BroadcastChannel tanpa menaruh credential di pesan/storage). Bila respons refresh hilang setelah
commit, jangan mengirim ulang token lama: login ulang; tidak ada grace reuse atau replay plaintext.
Logout, reuse, akun nonaktif, atau access expiry memutus socket aktif; refresh sah memerlukan reauth/reconnect.
Revocation akibat reuse harus **commit sebelum** mengembalikan 401; exception auth tidak boleh me-rollback
revocation tersebut. Hal yang sama berlaku pada counter gagal pairing di bawah.

## Akses publik dan kompatibilitas session display

Board utama memakai `/`, `/leaderboard` dan `/final` tanpa credential display. Endpoint snapshot/replay
publik serta socket `{gameId,public:true}` hanya membaca pointer game operasional, tanpa actor/audit/lease.
Reset mengganti pointer; sesi arsip hanya admin read-only. Tidak ada UI issue/exchange/renew kode.
Ketentuan kode/cookie berikut hanya melindungi API/session kompatibilitas yang masih terdaftar.

Kode tepat **6 karakter**, alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (32 simbol, 30 bit), CSPRNG tanpa bias.
Kode TTL **10 menit**, sekali pakai, **5 gagal** per kode aktif. Satu kode belum terpakai aktif per game;
generate baru mencabut kode lama. Ini memungkinkan attempt budget terikat game dari URL, termasuk tebakan
yang tidak cocok hash. Kegagalan scope/format/kode pada exchange memakan budget kode aktif game tersebut;
request yang sudah ditolak limiter tidak memakan budget lagi. Budget tidak reset oleh IP/browser/restart.
Lima gagal mengunci kode; admin harus generate baru. Tambahkan limiter IP 5 gagal/10 menit dan cooldown
generate 1/detik per game; counter persisten/shared, bukan hanya state browser. Budget global per kode dapat
dipakai penyerang untuk denial-of-service; admin regenerasi dan limiter membatasi dampak, bukan menghilangkannya.

Hanya simpan `HMAC-SHA256(pairingPepper, gameId || ':' || code)`; pepper dari secret configuration, bukan DB.
`display_pairing_codes`: id, game_id FK, code_hmac, expires_at, failed_attempts default 0 CHECK 0..5,
consumed_at/revoked_at nullable, issued_by FK, label nullable; index `(game_id,created_at)` dan expiry.
Issue/exchange mengunci game lalu kode sehingga dua exchange hanya satu berhasil dan lima gagal atomik.
Invalid/expired/reused/revoked/wrong-game memberi 401 UNAUTHENTICATED generik, budget/limiter exhausted 429
RATE_LIMITED; tidak membocorkan validitas kode game lain. Jangan decrement budget game lain.
Increment counter gagal/lock kode di-commit sebelum response 401/429; kegagalan exchange tidak boleh membuat
transaction rollback menghapus attempt yang sudah dikonsumsi.

Session `display_tokens` (nama tabel PRD dipertahankan): id, game_id FK, token_hash unique, expires_at,
revoked_at nullable, label nullable, issued_by FK, renewed_by/renewed_at nullable, version default 1.
Token opaque 32 byte; cookie **`__Secure-lr_display_<gameId>`**, host-only, `Path=/`, HttpOnly, Secure,
SameSite=Lax; nama per game mencegah pairing satu game mengganti cookie game lain. Hanya cookie sesuai route
game yang dibaca. Session TTL absolut **24 jam** dari exchange atau renewal Super Admin yang eksplisit.
Activity/heartbeat tidak menggeser deadline. Simpan hash saja, tidak di Web Storage/URL/JSON/socket payload.

| Endpoint `/api/v1/games/:id` | Input / output `data` | Authorization/receipt |
|---|---|---|
| POST `/display-tokens` | `{label?:string,expectedStateVersion}` → `{pairingId,pairingCode,expiresAt,attemptsRemaining:5}` sekali | SUPER_ADMIN dan key; code hanya response admin API kompatibilitas |
| POST `/display-pairings/exchange` | `{code}` → `{sessionId,expiresAt}` + Set-Cookie | Tanpa admin; kode game sah; lifecycle credential, bukan game command generic |
| GET `/display-tokens` | → `{sessions:[{id,label,expiresAt,revokedAt,version}],activePairing:{id,expiresAt,attemptsRemaining}|null}` | SUPER_ADMIN; tanpa hash/kode/token |
| POST `/display-tokens/:sessionId/renew` | `{expectedSessionVersion,expectedStateVersion}` → `{sessionId,expiresAt,version}` | SUPER_ADMIN + generic receipt; hanya session aktif/unexpired; expiry = DB now + 24 jam |
| POST `/display-tokens/:sessionId/revoke` | `{expectedSessionVersion,expectedStateVersion}` → `{sessionId,revokedAt,version}` | SUPER_ADMIN + generic receipt; revoke berulang no-op; session harus scoped |
| POST `/display-session/sync` | `{}` + cookie → `{sessionId,expiresAt,version}` + Set-Cookie nilai sama | Session display masih sah; hanya sinkron cookie expiry yang telah disetujui admin |

Pada issue, `expectedStateVersion` juga field body wajib di samping label. UUID/header divalidasi; label
trim 1..100 karakter jika dikirim, unknown fields ditolak. Renew/revoke tidak menghidupkan session revoked
atau expired; renew ditolak 409 STALE_STATE jika session version berbeda. Session expired harus re-pair.
Exchange unknown setelah commit tidak me-replay cookie: jika cookie sudah diterima, sync membuktikan session;
jika tidak ada cookie sah, admin generate kode baru. Dua session bersaing atas kode sama tidak keduanya sukses.

Renewal mengubah deadline di DB, bukan mengirim cookie display ke browser admin. Display sync saat online
(poll maksimal 20 detik dan sebelum deadline) membaca expiry baru dan memperbarui Max-Age ke sisa waktu.
Jika offline sampai cookie lama hilang, harus re-pair meskipun DB sempat di-renew; UI admin menjelaskan batas ini.
Revoke/expiry menolak REST dan emission Socket berikutnya, menghapus room/memutus koneksi aktif.
Timer deadline dan scan security startup/periodik membantu cleanup; sebelum setiap outbound event cek session
terkini agar socket yang belum sempat disconnect tidak menerima event pasca-revoke. Tidak broadcast langsung
ke room tanpa filter authorization. Kegagalan DB bersifat fail-closed. Ini juga berlaku pada admin session.
Board aktif mempertahankan last confirmed state dan status koneksi pada judul/ARIA, tanpa banner/panel tambahan.
Write publik/session display ditolak authorization; cookie lama tidak membaca arsip.
Uji PC/Smart TV venue membuka `/` tanpa input kode. Regression kode lama bukan prasyarat operasional display.

## Receipt, credential, dan prioritas error

Retain command_log **selama umur game**, termasuk FINISHED; Finish bukan cleanup. Tidak ada TTL deletion
receipt otomatis. Penghapusan game/arsip tidak diimplementasikan oleh G0 dan memerlukan task/otorisasi sendiri.
Unique `(game_id,idempotency_key)` dan `(scope_key,idempotency_key)`, game_id NOT NULL, tetap mengikat.
`scope_key=game:<gameId>` atau `create-game:<actorUserId>` dibentuk server. Hash SHA-256 atas method uppercase,
target route termasuk UUID, dan body tervalidasi canonical JSON (object keys sorted, array order dipertahankan).
Hash mencakup expected version dan input lease; nilai rahasia tidak dicatat pada canonical body/log.

Receipt sukses menyimpan status HTTP, data/meta non-rahasia dan hash request. PairingCode dikeluarkan dari
response_json: retry key sama → receipt metadata `{pairingId,expiresAt,credentialUnavailable:true}` tanpa kode,
tanpa generate ulang; UI meminta intent/key **baru** untuk generate kode baru dan mencabut kode lama.
Pengecualian response credential ini eksplisit; response awal saja memuat pairingCode ke admin terotorisasi.
Controller acquire/takeover juga mengeluarkan credential: agar replay token lease sah tetap tersedia tanpa
plaintext receipt, pisahkan bagian secret terenkripsi AES-256-GCM (`response_secret_ciphertext`, nonce, tag,
key_id) dari response_json. Decrypt hanya setelah auth + actor/hash/scope match; encryption key di secret
configuration, dipertahankan selama receipt membutuhkannya. Tidak ada token di audit/events/log.
Replay lease lama tidak memperpanjang atau mengaktifkan lease expired/revoked. Pairing code **tidak** disimpan
dalam ciphertext replay; exchange/sync/auth tidak memakai generic receipt.

Claim memakai unique constraint, lock wait maksimum 2 detik per attempt; maksimum 3 attempt total untuk
deadlock dengan jitter, lalu DUPLICATE_ACTION untuk intent in-flight (bukan menjalankan efek kedua).
Kegagalan DB lain tidak disamarkan sebagai duplicate. Setelah unique conflict, rollback transaksi kalah
sebelum membaca pemenang di transaksi baru. Create menyisipkan game+receipt+audit/event/outbox satu transaksi.
Auth dan validasi scope selalu mendahului replay; settlement sistem tetap transaksi terpisah sesuai ADR-003.

| Skenario | Hasil wajib, urutan setelah auth/validasi/scope |
|---|---|
| Display memanggil write domain | 403 FORBIDDEN; tidak claim receipt atau menjalankan command |
| Key game sama, actor/target/hash beda | 409 DUPLICATE_ACTION tanpa receipt milik actor lain |
| Actor/hash/key sama, command committed, versi berubah/PAUSED | Replay receipt sebelum gate state/version; tanpa mutasi |
| Dua create sama key/scope | Satu game/receipt; transaksi kalah rollback game lalu baca receipt pemenang |
| Result key baru saat PAUSED | 423 GAME_PAUSED sebelum result state/version |
| Result key baru ke VOIDED | 409 TURN_NOT_READY sebelum versi; PAUSED tetap menang bila berlaku |
| Result key baru sudah resolved | 409 ALREADY_RESOLVED sebelum STALE_STATE, termasuk BUTTON versus MANUAL |
| Movement belum selesai / turn salah | 409 TURN_NOT_READY |
| Turn siap, expected version/turn usang | 409 STALE_STATE |
| Roll siap/version benar tetapi lease tidak sah | 409 CONTROLLER_NOT_HELD |
| Input invalid / scope salah / resource tidak ada | 400 VALIDATION_ERROR / 403 FORBIDDEN / 404 NOT_FOUND |

Envelope sukses `{success:true,data,meta}`; meta game `{stateVersion,eventSequence,serverTime,requestId}`.
Error hanya `{success:false,error:{code,message}}`; request ID pada header `X-Request-Id`, tanpa stack/secret.
Timestamp UTC ISO-8601 millisecond; UUID CHAR(36) sesuai ADR-003. Meta receipt menyimpan version/sequence
command asli; serverTime/requestId response retry adalah request sekarang, bukan request tracing yang lama.

## Walkthrough review desain dan konsekuensi

Review dokumen (bukan test runtime): login→refresh menghasilkan satu token pengganti; reuse/unknown response
memerlukan login ulang, logout menutup family. Pairing salah lima kali mengunci kode; exchange konkuren satu
session, code reuse tidak menerbitkan lagi; renewal tidak sliding dan revoke memutus akses aktif. R-08 terpeta.
R-09/R-10 mempertahankan satu create, actor/hash conflict, replay sebelum stale; R-04 mempertahankan
pause/result ordering. Credential issue tidak memakai penyimpanan plaintext agar retry bisa dipenuhi.

Alternatif JWT stateless menambah revocation plumbing; opaque dipilih karena session lookup tetap diperlukan.
Grace refresh ditolak karena menyembunyikan reuse; plaintext/encrypted pairing replay tidak dipilih karena
pengguna menetapkan regenerasi kode. Konsekuensi: timeout refresh dapat memerlukan login ulang dan timeout
pairing dapat memerlukan kode baru. Rollback: revisi/supersede desain sebelum G2/G4/G6, tanpa menghapus audit.

## Catatan Verifikasi Runtime G2 (LR-028 & CP-G2)

1. **HTTPS Browser & MySQL Terisolasi**: Dibuktikan via Playwright Chromium di `e2e/adminAuth.spec.js`
   terhadap server Express HTTPS dan schema MySQL disposable `lr_test_*`. Seluruh alur login, refresh token rotation,
   logout, invalid credentials, expired session/token, revoked session, dan unknown refresh (500 fail-closed) lulus.
2. **Cookie Security**: Refresh token dikirimkan melalui cookie `__Host-lr_admin_refresh` dengan atribut
   `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, tanpa attribute `Domain`.
3. **Penyimpanan Kredensial**: Access token disimpan strictly in-memory di client React (`useAdminSession`).
   `localStorage` dan `sessionStorage` diverifikasi kosong (0 item). Database hanya menyimpan hash SHA-256 (64 hex)
   untuk access dan refresh token, serta bcrypt hash cost 12 untuk password. Tidak ada plaintext credential
   pada log audit, trace, atau respons JSON.
4. **Batas Bukti**: Runtime disconnect Socket.IO dan pairing display ditunda hingga gateway socket dibuat pada G4.

Sumber resmi: [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html),
[OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html),
[RFC 9700 §4.14.2](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14.2),
[RFC 8628 §5.1](https://www.rfc-editor.org/rfc/rfc8628.html#section-5.1),
[Socket.IO middleware](https://socket.io/docs/v4/middlewares/).
RFC digunakan untuk prinsip keamanan rotasi/kode, bukan klaim implementasi OAuth.
