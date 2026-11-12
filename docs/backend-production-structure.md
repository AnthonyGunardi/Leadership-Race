# Struktur dan penamaan backend production

Hasil inspeksi source lokal `../be-poin-peserta` pada 11 November 2026. Ini bukan hasil inspeksi database
atau proses yang sedang berjalan di server production. Batasan pengguna tercatat di [AGENTS.md](../AGENTS.md).
Pemetaan sembilan aplikasi/34 model berikut adalah baseline sebelum modul LR ditambahkan;
perkembangan integrasi dicatat terpisah di [laporan Checkpoint A](../tasks/checkpoint-a.md).

## Entry point dan komponen bersama

- [app.js](../../be-poin-peserta/app.js) memakai CommonJS; memasang sembilan router, middleware global,
  HTTP server, singleton Socket.IO, handler toilet-tracker, lalu `listen()`. Tidak ada root `server.js`.
- [common/db/db.js](../../be-poin-peserta/common/db/db.js) mengekspor satu instance Sequelize dari konfigurasi
  environment di `config/config.json`. Nilai kredensial tidak disalin ke dokumentasi ini.
- [.sequelizerc](../../be-poin-peserta/.sequelizerc) memakai root `migrations/` dan `seeders/`.
  [panduan CLI](../../be-poin-peserta/USING_SEQUELIZE_CLI.md) membolehkan override lokasi per modul;
  file migrasi aktual yang diperiksa berada di root.
- [common/socket/index.js](../../be-poin-peserta/common/socket/index.js) menyediakan `init(server)`/`getIO()`.
  Voting dan toilet-tracker menggunakan namespace `/`. Event voting: `leaderboardUpdate`.
  Event toilet: `state:request`, `state:snapshot`, `cubicle:updated`, `state:reset`, `toilet:updated`.
- Lockfile lokal v2 mencatat Express **4.22.1**, Sequelize **6.29.2**, Socket.IO **4.8.3**, mysql2 **3.14.1**,
  Joi **18.2.5**, express-rate-limit **8.6.2**. Zod belum tercatat. Ini berbeda dari rentang manifest dan
  pin backend Leadership Race; versi terpasang/deployed perlu diverifikasi lagi saat implementasi.
- Manifest production tidak menetapkan `engines`; tidak ditemukan `.nvmrc`/`.node-version` di root.
  Versi Node pada komputer pengembangan tidak membuktikan versi Node server production.

## Pemetaan model seluruh aplikasi

Terdapat **34 model** pada sembilan aplikasi yang diperiksa. Kolom file relatif terhadap `apps/<aplikasi>/`.
Nama tabel dibandingkan dengan definisi model dan migrasi lokal. `Implisit` berarti model tidak menetapkan
`tableName`; pluralisasinya juga dicek dengan utility Sequelize yang terpasang tanpa koneksi database.
Konfigurasi `define` yang diperiksa tidak mengaktifkan `freezeTableName` atau `underscored` secara global.

| Aplikasi | File | Registrasi Sequelize | Tabel SQL | Penetapan |
|---|---|---|---|---|
| point-system | `models/user.js` | `User` | `Users` | Implisit |
| point-system | `models/team.js` | `Team` | `Teams` | Implisit |
| point-system | `models/event.js` | `Event` | `Events` | Implisit |
| point-system | `models/point.js` | `Point` | `Points` | Implisit |
| point-system | `models/gift.js` | `Gift` | `Gifts` | Implisit |
| point-system | `models/log_point.js` | `Log_point` | `Log_points` | Implisit |
| point-system | `models/pos_step.js` | `Pos_step` | `Pos_steps` | Implisit |
| point-system | `models/team_member.js` | `Team_member` | `Team_members` | Implisit |
| point-system | `models/user_gift.js` | `User_Gift` | `User_Gifts` | Implisit |
| joining-instruction | `models/ji_event.js` | `JI_Event` | `JI_Events` | Eksplisit |
| joining-instruction | `models/ji_ctbc_bus.js` | `JI_CTBC_Bus` | `JI_CTBC_Buses` | Eksplisit |
| joining-instruction | `models/ji_departure_bus.js` | `JI_Departure_Bus` | `JI_Departure_Buses` | Eksplisit |
| joining-instruction | `models/ji_return_bus.js` | `JI_Return_Bus` | `JI_Return_Buses` | Eksplisit |
| joining-instruction | `models/ji_room_occupant.js` | `JI_Room_Occupant` | `JI_Room_Occupants` | Eksplisit |
| joining-instruction | `models/ji_team_placement.js` | `JI_Team_Placement` | `JI_Team_Placements` | Eksplisit |
| personality-test | `models/personality.js` | `Personality` | `Personalities` | Implisit |
| personality-test | `models/reportRecord.js` | `PersonalityReportRecord` | `PersonalityReportRecords` | Eksplisit |
| compass-of-life | `models/compass_of_life.js` | `Compass_Of_Life` | `Compass_Of_Lifes` | Eksplisit |
| core-value | `models/cv_candidate.js` | `CV_Candidate` | `CV_Candidates` | Implisit |
| core-value | `models/cv_vote.js` | `CV_Vote` | `CV_Votes` | Implisit |
| voting | `models/Voting.js` | `Voting` | `voting_votings` | Eksplisit |
| voting | `models/VotingAdmin.js` | `VotingAdmin` | `voting_admins` | Eksplisit |
| voting | `models/VotingCategory.js` | `VotingCategory` | `voting_categories` | Eksplisit |
| voting | `models/VotingCandidate.js` | `VotingCandidate` | `voting_candidates` | Eksplisit |
| voting | `models/VotingSubmission.js` | `VotingSubmission` | `voting_submissions` | Eksplisit |
| voting | `models/VotingVote.js` | `VotingVote` | `voting_votes` | Eksplisit |
| pre-training-test | `models/pre_training_assessment.js` | `Pre_Training_Assessment` | `Pre_Training_Assessments` | Eksplisit |
| toilet-tracker | `models/ToiletLocation.js` | `ToiletLocation` | `toilet_locations` | Eksplisit |
| toilet-tracker | `models/ToiletRoom.js` | `ToiletRoom` | `toilet_rooms` | Eksplisit |
| toilet-tracker | `models/Cubicle.js` | `Cubicle` | `toilet_cubicles` | Eksplisit |
| activity-wallet | `models/User.js` | `ActivityWalletUser` | `activity_wallet_users` | Eksplisit |
| activity-wallet | `models/Participant.js` | `ActivityWalletParticipant` | `activity_wallet_participants` | Eksplisit |
| activity-wallet | `models/Activity.js` | `ActivityWalletActivity` | `activity_wallet_activities` | Eksplisit |
| activity-wallet | `models/Transaction.js` | `ActivityWalletTransaction` | `activity_wallet_transactions` | Eksplisit |

## Arti perbedaan nama

1. **File dan class bukan batas isolasi.** Activity Wallet memiliki file `User.js` dan class `User`, tetapi
   `modelName` adalah `ActivityWalletUser`. Point System memakai class dan `modelName` `User`.
2. **Registry Sequelize bersifat bersama.** Mayoritas index model mengimpor `common/db/db.js`, memanggil factory,
   menyimpan `db[model.name]`, lalu mendaftarkan associations. Memakai nama `User` lagi dapat mengubah registrasi
   atau menyebabkan guard seperti `if (sequelize.models.User)` memilih model aplikasi lain.
3. **Alias lokal boleh pendek.** Activity Wallet mengembalikan `{User, Participant, Activity, Transaction}`
   dari `setupModels()`, meski nama global berprefix. Alias ini hanya aman selama tidak menjadi lookup global.
4. **Prefix tabel saja belum cukup.** Toilet Tracker memakai `toilet_cubicles` tetapi model global `Cubicle`.
   Pola itu ada pada source, tetapi tidak perlu ditiru untuk modul baru.
5. **Tidak ada standar kapitalisasi tunggal.** Ada `JI_*`, `CV_*`, PascalCase, snake_case, dan tabel lowercase.
   Hindari mengandalkan beda huruf `users`/`Users`; perilaku server MySQL perlu diperiksa, bukan diasumsikan.
6. **Factory report berada di luar folder models.** `models/reportRecord.js` meneruskan
   [defineReportRecords.js](../../be-poin-peserta/apps/personality-test/persistence/defineReportRecords.js),
   yang mendaftarkan `PersonalityReportRecord`. Memeriksa `modelName:` saja akan melewatkan model ini.

## Implikasi untuk Leadership Race

Usulan penamaan mengikuti pola isolasi Activity Wallet: registrasi `LeadershipRaceUser`, `LeadershipRaceTeam`,
`LeadershipRaceGame`, dan seterusnya; tabel eksplisit `leadership_race_users`, `leadership_race_teams`,
`leadership_race_games`, dan seterusnya. File baru mengikuti rules proyek: `camelCase.js`.
Factory boleh mengembalikan alias lokal `{User, Team, Game}` untuk menjaga caller, tetapi lookup registry,
associations, FK, indeks, raw SQL dan backup/restore harus menunjuk nama Leadership Race secara konsisten.
Ini usulan untuk rencana integrasi; belum ada model production yang diubah atau didaftarkan.

Sumber utama: seluruh `apps/*/models/*.js`, `apps/personality-test/persistence/defineReportRecords.js`,
root `migrations/*.js`, `common/db/db.js`, `config/config.json` (hanya opsi penamaan), dan lockfile production.
Migrasi dan source membuktikan nama yang dimaksud kode; keberadaan serta bentuk tabel deployed belum diperiksa.
