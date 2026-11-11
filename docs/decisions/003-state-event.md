# ADR-003 — State durable, DTO, dan recovery

**Status:** Accepted; schema/service/test tersedia. DTO/event display utama memakai proyeksi publik
[ADR-005](005-single-game-public-admin.md); DTO admin dan session kompatibilitas dijelaskan di bawah.
**Acuan:** SPEC §4.5–4.6/7–9/12/14 D-06; PRD §9–12/14; ADR-002; R-01–R-03/R-05–R-07/R-12–R-14.

## Storage dan ownership

Seluruh UUID PK/FK, termasuk actor, session, event, receipt, request ID internal dan referensi kompensasi,
memakai **CHAR(36) ASCII/ascii_bin** dengan format UUID canonical lowercase. Kolom FK dan target harus identik.
`Idempotency-Key` adalah UUID CHAR(36); hash/ciphertext bukan UUID. Tidak menggunakan BINARY(16) atau
mengasumsikan `DataTypes.UUID` otomatis menghasilkan DDL yang diminta: migration menentukan CHAR(36) eksplisit.
Timestamp persisted memakai DATETIME(3) UTC, JSON wire memakai ISO-8601 UTC millisecond. Semua model menetapkan
type/allowNull/default secara eksplisit; foreign key diindeks, InnoDB dan constraint database diaktifkan.
Counters memakai BIGINT UNSIGNED dengan batas aplikasi Number.MAX_SAFE_INTEGER, default 0; DTO angka integer
aman. Jangan coercion BIGINT yang kehilangan presisi; tolak overflow sebelum commit.

| Store / kelompok pertama | Constraint dan data yang diperlukan alur |
|---|---|
| Identity G2 | users/admin_sessions/admin_refresh_tokens/admin_access_tokens sesuai ADR-002; FK/index session/user/expiry |
| games G3 | PK id, status DRAFT default, current_team_id/active_turn_id nullable, turn_number/state_version/event_sequence/event_retention_floor default 0; index status |
| games G5 | board_source NOT NULL default CUSTOM; enum CUSTOM/PRD_APPENDIX_A/JSON_IMPORT mencatat provenance tanpa klaim pengesahan workbook |
| teams, board_cells G3 | FK game; unique game/order, game/name, game/cell-number; posisi CHECK 0..50; seluruh field board PRD termasuk instruction/backup/duration nullable |
| command_log G3 | game_id NOT NULL; unique game/key dan scope/key; actor FK, method/target hash, command_type, status, http_status, response_json; encrypted secret fields ADR-002 nullable |
| game_events G3 | unique game/sequence; id, game_id, sequence, state_version, type, payload_json, actor_type, actor_user_id nullable, occurred_at, request_id |
| outbox_events G3 | unique game_event_id FK; game_id FK, published_at nullable, attempt_count default 0, next_attempt_at; index next_attempt_at/id |
| audit_logs G2/G3 | G2 auth audit game_id nullable; G3 game audit wajib game_id; actor_type USER/SYSTEM, actor_user_id nullable, action, before_json/after_json ringkas, reason nullable, request_id, occurred_at |
| display_pairing_codes/display_tokens G4 | Schema/attempt/expiry/revoke/renewal ADR-002; token hash unique; FK game/issuer; index game/expiry |
| controller_leases G6 | game_id PK/FK; holder_user_id FK, lease_token_hash, expires_at, version; satu lease/game, token secret tidak di event |
| turns G7 | unique game/turn_number, unique game/id; FK game/team, dice 1..6, from/landing/final, status; dice_path/penalty_path/full_path JSON, step_duration_ms, movement_started_at/movement_ends_at DATETIME(3), resolved_at nullable |
| challenge_results G9 | unique turn_id; FK game/turn/team/cell/actor; BUTTON XOR MANUAL CHECK, awarded integer >=0, note nullable; hasil 0 tetap tersimpan |
| score_ledger G9 | FK game/team/turn/result/actor; delta immutable, source, reason; unique challenge_result_id nullable untuk ledger hasil >0; compensates_entry_id nullable FK; index game/team/created_at/id |
| final_results G11 | unique game/team; score/position/rank/is_winner snapshot immutable, finished_at/by pada games |
| Void G18 | turns tambah voided_at/voided_by/void_reason nullable; status VOIDED terminal; ledger tambah correction_type dan voided_turn_id nullable unique untuk tepat satu kompensasi void |
| Satu game | single_game id=1, game_id FK/unique; game_archives menghubungkan sesi lama ke next_game_id, actor dan waktu reset |

Ledger umum tidak memberi unique global pada compensates_entry_id; koreksi G12 mempertahankan referensi
scoped tanpa batas satu koreksi per entri. Keunikan kompensasi void memakai voided_turn_id;
guard histori/status tetap wajib. Turn/result/ledger/event lama tidak dihapus atau ditimpa saat void.
Compound scoped FK memakai parent unique `(game_id,id)` bila relasi lintas game harus dicegah; service tetap
memvalidasi scope. Score total atomik sama dengan SUM ledger, termasuk void; 0 tidak menghasilkan ledger nol.

Audit indexes: `(game_id,occurred_at,id)`, `(actor_user_id,occurred_at,id)`, `(request_id)`,
`(game_id,action,occurred_at,id)`; actor_type SYSTEM mewajibkan actor_user_id NULL, USER mewajibkan user FK.
Audit auth tanpa game tetap terindeks actor/request. Payload audit allowlist tanpa token, code, hash credential,
password, cookie atau encryption material; score correction menyimpan turn/result reference meski tanpa ledger.
Event indexes: `(game_id,sequence)` unique dan `(game_id,type,sequence)`; worker turns `(status,movement_ends_at,game_id)`.

Controller hanya HTTP; service workflow memiliki transaksi, model hanya persistence. Workflow domain terkait
menulis state/audit/event/receipt/outbox dalam satu transaksi, tidak memanggil service domain tak terkait.
Shared transaction/event helpers dan settlement coordinator tidak berisi workflow fitur lain.
Settlement: `settleExpiredMovementIfDue(gameId)` memiliki transaksi sistem sendiri, lock **game → turn → team**,
waktu `UTC_TIMESTAMP(3)` DB setelah lock. Timer/sweeper/request memakai fungsi yang sama; VOIDED/completed
menjadi no-op. Event settlement actor SYSTEM/user NULL. Commit settlement sebelum gate command berikutnya;
STALE_STATE/PAUSED/lease error berikutnya tidak rollback settlement. Snapshot dibaca konsisten setelah settlement.
Worker melakukan scan saat startup dan periodik, bahkan tanpa HTTP/client; timer hanya percepatan best effort.
Interval/lag diukur pada G7 terhadap target realtime, bukan jaminan timing Node. Readiness melaporkan worker
ketika perannya benar-benar tersedia; publisher hanya emit sesudah commit, retry via outbox dengan eventId sama.

## Urutan migration additive

1. G2 membuat identity dan audit auth; G3 membuat games dengan **active_turn_id CHAR(36) NULL DEFAULT NULL**
   tanpa FK ke turns yang belum ada. Tetap NULL pada G3–G6. Buat teams/board_cells, kemudian tambah FK
   current_team setelah target tersedia. Audit game_id/FK ditambahkan setelah games ada; auth audit tetap nullable.
2. G3 membuat receipt/event/outbox hanya untuk setup. G4 menambah pairing/session, G6 lease. Jangan membuat
   seluruh schema turn/result/final di foundation. `games.active_turn_id` diindeks sejak G3.
3. G7 migration baru membuat turns dengan FK ke games dan teams serta unique `(game_id,id)`; migration
   berikutnya memeriksa seluruh pointer existing (harus NULL atau valid) lalu menambah composite FK
   `games(id,active_turn_id) → turns(game_id,id)`. Baru setelah kedua migration selesai, kode roll menulis pointer.
   Ini menghindari circular create-order tanpa menonaktifkan foreign_key_checks atau memakai sync/alter.
4. G9/G11/G18 menambah result/ledger/final/void secara incremental. Upgrade kompatibel dengan pembaca sebelumnya;
   migration DDL MySQL tidak diasumsikan rollback bersama transaction bisnis. Verifikasi tiap langkah dan
   migration tracking pada schema test baru serta schema G3 yang sudah berisi DRAFT/READY sebelum upgrade G7.
5. Rollback aplikasi ke kode kompatibel, hentikan jalur write baru bila perlu; jangan drop turns/kolom/pointer
   committed atau menurunkan nomor/sequence. Down migration destruktif hanya disposable test, bukan event aktif.

## Kontrak DTO lengkap untuk snapshot dan event

Nama wire camelCase; schema Zod JavaScript menjadi kontrak implementasi. UUID string canonical; posisi 0..50,
cell 1..50, dice 1..6, points/counters safe integer; nullable disebut eksplisit. Semua list ditentukan server.
Envelope REST `{success:true,data,meta:{stateVersion,eventSequence,serverTime,requestId}}`.
Error `{success:false,error:{code,message}}`, header X-Request-Id termasuk error. Tidak ada secrets di public DTO.

`GET /api/v1/games/:id/snapshot` mempunyai data berikut pada satu snapshot consistent-read:

| Field | Shape / semantik |
|---|---|
| game | `{id,name,status,boardSource:CUSTOM|PRD_APPENDIX_A|JSON_IMPORT,currentTeamId:null|UUID,activeTurnId:null|UUID,turnNumber,startedAt:null|UTC,finishedAt:null|UTC}` |
| boardCells | Array 50 saat READY+, `{id,number,category,title,instruction:null|string,backupText:null|string,durationText:null|string,successPoints,allowManualPoints,defaultScoringMethod,pointsPerUnit:null|integer,penaltySteps}`; DRAFT boleh belum lengkap |
| teams | `{id,name,sortOrder,code,color,position,totalScore}[]`, code T1..T10 dari order tersimpan |
| turn | null atau `{id,turnNumber,teamId,diceValue,from,landingCell,finalPosition,status,requiresChallenge,resolvedAt:null|UTC,voidedAt:null|UTC,voidedBy:null|UUID,voidReason:null|string}` |
| turnStatus | READY_FOR_ROLL jika activeTurnId null, selain itu status turn persisted; PAUSED tidak mengubah status turn |
| activeMovement | null atau `{turnId,teamId,from,dicePath,penaltyPath,fullPath,landingCell,finalPosition,movementStartsAt,movementEndsAt,stepDurationMs}`; hanya movement yang belum selesai |
| pendingResult | null atau `{turnId,teamId,cellNumber,category,title,successPoints,allowedMethods:[BUTTON,MANUAL],defaultMethod,pointsPerUnit:null|integer,instruction?:string,backupText?:string,durationText?:string}` |
| leaderboard | `{teamId,name,code,sortOrder,position,totalScore,rank}[]`, score DESC/order ASC; competition rank, belum final sebelum Finish |
| controller | `{holderUserId:null|UUID,expiresAt:null|UTC,version}`; tanpa lease token/hash; tidak ada pada DTO publik |
| finalResults | null sebelum FINISHED; admin mendapat `{finishedAt,finishedBy,winners:leaderboard[],results:[{teamId,name,code,color,score,position,rank,isWinner}]}`; publik memakai leaderboard/status FINISHED |

Default optional instruction boleh tidak dikirim bila NULL; UI tidak memblokir hasil karena field hilang.
`turn` bukan target command bila terminal; histori termasuk VOIDED tetap disimpan terpisah. Snapshot setelah
void tanpa movement baru memuat activeTurnId null dan posisi/tim pulih; snapshot setelah roll baru memuat
movement baru. Tidak perlu menghidupkan kembali objek turn void sebagai active turn agar recovery bekerja.

Mapping timeline **satu sumber committed**: turns.movement_started_at → REST `movementStartsAt` → event
`startAt`; movement_ends_at → `movementEndsAt` → `endAt`; step_duration_ms → `stepDurationMs` pada keduanya.
Path JSON dipakai apa adanya, tidak dihitung ulang dari board yang mungkin berbeda. `fullPath=dicePath+penaltyPath`;
`endAt=startAt+fullPath.length*stepDurationMs`; `from` bukan langkah pertama. Roll response juga berisi
`stepDurationMs`; start/end scheduling di G7 mengikuti PRD §5.4 dan waktu DB, bukan jam browser.

Setiap game event REST/Socket adalah
`{eventId,gameId,sequence,stateVersion,occurredAt,payload}`; `type` tersedia pada item replay REST untuk memilih
handler, sedangkan Socket menggunakan nama event. EventId sama dengan game_events.id, occurredAt UTC DB,
sequence contiguous per game; beberapa event satu transaksi berbagi stateVersion, masing-masing sequence baru.
Menaikkan stateVersion satu kali per mutasi bisnis; client tidak membuang event sequence baru hanya karena
stateVersion sama. RequestId/actor ada di audit/internal event store, tidak diperlukan pada public envelope.

| Type Socket / replay | Payload lengkap |
|---|---|
| game:state_changed | `{status,currentTeamId:null|UUID,activeTurnId:null|UUID,turnNumber,turnStatus}` |
| game:movement_started | `{turnId,teamId,diceValue,from,dicePath,penaltyPath,fullPath,landingCell,finalPosition,requiresChallenge,startAt,endAt,stepDurationMs}` |
| game:challenge_pending | Shape pendingResult di atas; optional instruction/backupText/durationText |
| game:challenge_resolved | `{turnId,teamId,scoringMethod,outcome:null|SUCCESS|FAIL,awardedPoints,newTotalScore}` |
| game:leaderboard_updated | `{teams:leaderboard[],version}`; version sama dengan envelope stateVersion |
| game:controller_changed | `{holderUserId:null|UUID,expiresAt:null|UTC}` |
| game:finished | `{finishedAt,winners:leaderboard[],results:finalResults.results}` pada jalur admin; publik payload kosong |
| game:correction_applied, TURN_VOID | `{correctionType:TURN_VOID,voidedTurnId,affectedTeamId,restoredPosition,compensatedPoints,newTotalScore,reason,newStateVersion}` |
| game:correction_applied, SCORE_CORRECTION | `{correctionType:SCORE_CORRECTION,affectedTeamId,deltaPoints,newTotalScore,reason,turnId,compensatesEntryId,newStateVersion}` |

`newStateVersion` kompatibel dengan payload PRD dan sama dengan envelope stateVersion; void REST memakai
`teamId` sesuai SPEC §4.6, event memakai `affectedTeamId` sesuai PRD. D-04 sudah menetapkan koreksi umum:
delta integer bukan nol −1000…1000 dan total ≥0. D-07 memakai competition rank, termasuk seri non-tertinggi.
Payload session/credential tidak dipublish ke room; security lifecycle memakai kanal sesi internal.

## Pagination, retention, dan recovery

Kontrak payload lengkap di atas berlaku untuk jalur admin/session kompatibilitas non-arsip. Publik memakai
`/api/v1/public/game` atau `/public/games/:id/snapshot` dengan proyeksi aman (game/tim/kotak/leaderboard/
movement/turnStatus/meta), dan `/public/games/:id/events` dengan payload invalidasi kosong.
Pointer game diperiksa pada REST/socket publik; tidak ada controller/actor/audit/credential atau akses arsip.
Reset menyalin konfigurasi ke DRAFT baru dan mengganti pointer atomik; client mengganti stream setelah
polling 2 detik. Versi/sequence sesi lama tidak dibandingkan dengan counter sesi baru. Detail ADR-005.

`GET /api/v1/games/:id/events?afterSequence=N&limit=L` memerlukan auth/scope sama dengan snapshot.
afterSequence wajib integer >=0, limit default **100**, maksimum **500**, minimum 1; string digit query diparse
secara ketat, nilai pecahan/negatif/nonangka/>500 → 400 VALIDATION_ERROR. Urutan **sequence ASC**, eksklusif >N.
Item `data.events` adalah envelope + type; `meta` menambah `{afterSequence,nextAfterSequence,hasMore,
earliestAvailableSequence,latestSequence}`. nextAfterSequence adalah sequence item terakhir atau N bila kosong.
latestSequence adalah high-water game pada pembacaan halaman konsisten; bukan jaminan tidak ada commit sesudahnya.
Client mengikuti hasMore lalu merangkai buffer; tidak menunggu antrean kosong jika publisher terus aktif.

Retain game_events dan audit sepanjang umur game, termasuk FINISHED, sama dengan receipt; outbox tidak boleh
dibersihkan sebelum publish terkonfirmasi. Tidak ada job prune game aktif pada scope ini. Recovery tetap
menangani retensi/restore/import historis: simpan watermark `games.event_retention_floor` default 0 (sequence
terbesar yang sudah tidak dapat di-replay). N < floor atau hole pada rentang yang seharusnya tersedia →
**409 EVENT_HISTORY_UNAVAILABLE** dengan error envelope biasa; client **wajib refetch snapshot penuh**,
bukan menganggap halaman kosong sebagai sukses atau menebak event hilang. N > latestSequence juga memerlukan
snapshot ulang (409 STALE_STATE). Floor/sequence tidak dimundurkan saat restore/void; pemeliharaan yang kelak
menaikkan floor harus atomik dengan pruning dan bukan otorisasi untuk membuat job itu di G0.
Halaman harus mulai dari N+1 dan contiguous; halaman kosong ketika N < latestSequence adalah hole,
bukan akhir replay yang sah. `hasMore` membandingkan cursor dengan high-water yang dibaca pada halaman itu.

Urutan client:

1. Authorize lalu join room dan mulai buffer **sebelum** fetch snapshot; ACK join harus sudah memasang listener.
2. Install snapshot pada eventSequence S/stateVersion V, buang buffer <=S, fetch halaman >S, urutkan/dedup
   berdasarkan sequence/eventId. Terapkan hanya sequence berurutan; satu sequence berbeda eventId → recovery.
3. Gap, unknown schema, atau HISTORY_UNAVAILABLE memicu snapshot penuh sambil terus buffer. Jangan memaksakan
   event dengan stateVersion lebih lama; bandingkan dengan snapshot boundary, bukan membuang event dalam versi sama.
4. Reconnect mengulang authorization/join/snapshot/gap. Movement progress memakai waktu server dan path snapshot;
   deadline settlement hanya DB. Satu representasi tim di cluster atau overlay; occupancy dari visualPositions.
5. TURN_VOID menaikkan minimum snapshot boundary ke sequence/stateVersion event; batalkan animation frame,
   timeout, subscription/form draft turn lama dan invalidasi async callback dengan generation/turn ID.
   Snapshot terlambat yang di bawah boundary tidak dipasang; version/sequence tidak boleh mundur.
6. Snapshot yang mencakup void tanpa roll baru memasang posisi pulih langsung, tanpa animasi mundur. Jika sudah
   ada roll pengganti, lanjutkan movement tersebut dari waktu server; jangan reset ke finalPosition secara buta.
   Event void duplikat <= boundary diabaikan, lalu lanjutkan buffered event > snapshot sequence.

## Walkthrough review desain

| Kasus | Konsekuensi kontrak yang diperiksa |
|---|---|
| R-01–R-03 tanpa HTTP/restart/clock client salah | Path/deadline persisted, startup sweep, satu settlement; request gagal STALE_STATE tidak membatalkan commit settlement |
| Crash commit sebelum emit | State/event/outbox sudah committed; retry publish dengan eventId sama, efek client didedup |
| R-05–R-07 void berpoin/0/penalti dan race | Lock game; kompensasi tepat sekali; no ledger nol; posisi/tim pulih, FINISHED/movement/koreksi terkait menolak |
| R-12 roll 10, void 11, pengganti 12 | Cari roll lebih baru termasuk VOIDED; 10 ditolak, 11 terminal, 12 ID/nomor baru dapat eligible |
| R-13/R-14 callback/snapshot/void terlambat | Minimum boundary dan callback generation mencegah state lama menimpa; movement pengganti tetap berjalan |
| Pagination 100/500/retensi/hole | ASC exclusive cursor; max+1 gagal; floor/hole memaksa snapshot, tanpa kehilangan event diam-diam |

Review ini adalah walkthrough desain, bukan simulasi aplikasi yang dijalankan. Runtime R-* tetap wajib pada
kelompok implementasi. Alternatif BINARY(16) tidak dipakai sesuai keputusan pengguna; schema sekaligus ditolak
karena menambah ketergantungan sebelum fitur. Rollback mempertahankan committed history dan memakai schema additive.

Sumber resmi: [MySQL FK dan indexed referenced keys](https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html),
[Sequelize constraints/circularities](https://sequelize.org/docs/v6/other-topics/constraints-and-circularities/),
[Sequelize transactions](https://sequelize.org/docs/v6/other-topics/transactions/),
[Socket.IO delivery](https://socket.io/docs/v4/delivery-guarantees/),
[Node timers](https://nodejs.org/api/timers.html#settimeoutcallback-delay-args).
