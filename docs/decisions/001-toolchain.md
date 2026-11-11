# ADR-001 — Toolchain dan quality gates

**Status:** Accepted; tooling terpasang pada G1. Pin aktual mengikuti manifest/lockfile; command aktif dan
bukti run ada pada README/task list. Uraian evaluasi G0 di bawah adalah alasan keputusan, bukan inventaris source.
**Acuan:** SPEC §5/11/12/14 D-01; PRD §8/15; rules 10/20/30/40.

## Keputusan dan alasan

Gunakan npm workspaces dengan root private dan workspace `backend` serta `frontend`; JavaScript ES modules,
backend Node.js `.js` dan frontend React `.jsx`, tanpa TypeScript.
Satu `package-lock.json` v3 di root, dependency direct memakai versi exact tanpa `^`/`~`, `save-exact=true`,
dan `engine-strict=true`. Root `packageManager=npm@11.3.0`; root/workspace `engines.node=26.13.0` dan
`engines.npm=11.3.0`; `.node-version` berisi `26.13.0`. Tidak ada lockfile nested atau manager kedua.

Ketetapan terbaru pengguna adalah **Node v26.13.0** dan **JavaScript tanpa TypeScript**.
Inspeksi PATH setelah update menghasilkan Node v26.13.0 dan npm 11.3.0. Rilis resmi 26.13.0 berstatus LTS.
G1 wajib membuktikan install dan runtime aktual; kesesuaian engine paket bukan bukti bahwa test sudah lulus.
Pergantian runtime selanjutnya mengubah pin melalui task tersendiri dan mengulang checks yang terdampak.

Pin dipilih dari metadata resmi npm pada 10 November 2026. Tidak memasang `typescript`, `tsx`,
`typescript-eslint`, compiler TypeScript, atau dependency direct `@types/*`. React/Vite tetap dipakai
dengan JavaScript/JSX. Ini penyesuaian eksplisit atas TypeScript pada baseline PRD.
Deklarasi tipe transitive/peer milik library (misalnya peer `@types/node` mysql2) boleh tercatat dalam lockfile;
hal itu tidak membuat source TypeScript atau menambahkan compiler/type-check ke proyek.
Jangan memakai `--force` atau `--legacy-peer-deps`.

| Paket/runtime | Versi exact | Kompatibilitas/tujuan |
|---|---|---|
| Node.js / npm | 26.13.0 / 11.3.0 | Runtime LTS disetujui; npm engine `^20.17.0 \|\| >=22.9.0` |
| vite / @vitejs/plugin-react | 8.3.7 / 6.3.0 | Node `^20.19.0 \|\| >=22.12.0`; plugin menerima Vite 8 |
| vitest | 5.1.0 | Node `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0`; peer Vite 8 |
| @vitest/coverage-istanbul / @vitest/coverage-v8 | 5.1.0 / 5.1.0 | Versi sama persis dengan Vitest |
| @playwright/test | 1.65.0 | Node engine `>=20`; browser binary mengikuti versi paket |
| react / react-dom | 19.3.1 / 19.3.1 | Peer react-dom `^19.3.1` |
| react-router | 8.5.1 | Node `>=22.22.0`; React/DOM `>=19.2.7`; pakai library mode |
| @tanstack/react-query / zustand | 5.107.1 / 5.1.0 | Peer React 19 diterima |
| motion | 14.11.1 | Peer React/DOM 19 diterima; baru ditambahkan saat animasi diperlukan |
| express / sequelize / mysql2 | 5.3.0 / 6.37.8 / 3.24.6 | Express 5, Sequelize 6 stabil, driver MySQL resmi yang didukung Sequelize |
| sequelize-cli | 6.6.5 | Migration incremental; migration JS `.cjs` bila diperlukan oleh CLI ESM boundary |
| socket.io / socket.io-client | 4.8.4 / 4.8.4 | Server/client satu seri; baru dipasang pada alur realtime |
| zod | 4.6.7 | Schema boundary runtime, digunakan langsung dari JavaScript |
| winston / winston-daily-rotate-file | 3.19.0 / 5.0.0 | JSON dan rotasi harian di `backend/src/logs/` |
| helmet / cors / express-rate-limit | 8.3.0 / 2.8.6 / 8.7.4 | Hardening HTTP dan throttling; tidak mengubah role |
| eslint / @eslint/js | 10.14.0 / 10.0.1 | Node `^20.19.0 \|\| ^22.13.0 \|\| >=24` |
| eslint-plugin-react-hooks / eslint-plugin-react-refresh | 7.1.1 / 0.5.7 | Peer ESLint 10 diterima |
| jsdom | 31.0.0 | Environment component test; Node engine menerima `>=26` |
| @testing-library/react / @testing-library/dom | 16.3.3 / 10.4.2 | Peer React 19 dan DOM 10 |
| @testing-library/user-event / @testing-library/jest-dom | 14.6.8 / 7.0.1 | Interaksi pengguna dan matcher Vitest |

MySQL tetap 8.x/InnoDB sesuai PRD. Patch server/image yang benar-benar tersedia dipin saat menyiapkan database
test G1 dan dicatat di README; G0 tidak mengklaim MySQL lokal tersedia atau membuat database.
Paket dipasang hanya saat diperlukan task, bukan seluruh roadmap sekaligus. Pin downstream yang berubah
karena advisory/kompatibilitas harus memperbarui ADR/lockfile beserta bukti, tanpa mengubah keputusan produk.

## Test, coverage, dan isolasi

- Backend: Vitest environment `node`, tests `backend/src/tests/**/*.test.js`, provider `istanbul`.
- Frontend: Vitest environment `jsdom`, tests `frontend/src/__tests__/**/*.test.{js,jsx}`, provider `v8`.
- E2E: Playwright di `e2e/**/*.spec.js`, config root; Chromium untuk smoke G1. Matriks browser/perangkat
  venue tetap D-08. Browser test tidak menggantikan Chrome DevTools MCP bila skill/runtime review mewajibkannya.
- Kontrak yang dipakai bersama diuji pada folder `contracts/` dalam kedua lokasi test tersebut. Belum perlu
  workspace shared atau runner tambahan; domain authoritative tetap hanya di backend.
- Kedua workspace menerapkan `statements=90`, `lines=90`, `functions=90`, `branches=85` secara terpisah,
  mencakup seluruh source runtime melalui `coverage.include`, termasuk file yang belum di-import test.
  Test/config/generated output bukan source runtime. Tidak ada `passWithNoTests`, skip atau
  blanket exclusion; gate baru dijalankan setelah source/test yang bermakna tersedia pada task terkait.
- Ignore hanya startup/bootstrap, perilaku library eksternal, atau nondeterministic logic dengan alasan
  spesifik, sesuai rules 40. Backend: `/* istanbul ignore next -- @preserve Bootstrap: alasan spesifik */`.
  Frontend: `/* v8 ignore next -- @preserve Bootstrap: alasan spesifik */` atau pasangan `v8 ignore start/stop`.
  Vitest V8 memakai `v8`, bukan asumsi bahwa contoh `c8` dalam rules berlaku pada semua provider.
  Buktikan hint tersisa sesudah transformasi JSX; mulai tanpa pengecualian.
- Integration persistence memakai MySQL nyata, schema unik per run/worker, nama prefix `lr_test_`,
  account yang hanya berizin pada schema test, environment `test`, dan pemeriksaan target sebelum cleanup.
  Jangan fallback ke DB development/produksi, SQLite, `sync({alter:true})`, atau reset DB bersama.
  Uji concurrency memakai koneksi/transaction terpisah dan migration yang sama dengan aplikasi.

## Strategi install dan scripts terpasang

Command berikut tersedia pada manifest. Working directory root kecuali disebut lain; ketersediaan script
berbeda dari bukti run. Shell memakai `rtk`; npm run memakai bin lokal lockfile, bukan unduhan npx implisit.

| Command | Tujuan / lokasi |
|---|---|
| `rtk proxy npm ci --ignore-scripts` | Fresh install root dari lockfile; dependency scripts fail-closed |
| `rtk proxy npm run dev --workspace backend` | `node --watch src/server.js`; cwd backend |
| `rtk proxy npm run dev --workspace frontend` | Vite; cwd frontend; proxy `/api` dan Socket.IO same-origin |
| `rtk proxy npm run lint` | ESLint root terhadap kedua workspace/E2E, zero warnings |
| Static checks | ESLint JS/JSX dan test kontrak Zod; tidak ada script `type-check`/`tsc` |
| `rtk proxy npm run build` | Validasi sintaks Node backend dan frontend `vite build` |
| `rtk proxy npm test` | `vitest run` pada kedua workspace; non-watch |
| `rtk proxy npm run test:coverage` | Vitest run coverage kedua workspace, threshold di atas |
| `rtk proxy npm run test:integration --workspace backend` | Hanya suite MySQL terisolasi; tidak disamarkan sebagai unit |
| `rtk proxy npm run db:migrate:test --workspace backend` | Hanya memvalidasi guard nama schema; integration benar-benar menerapkan migration |
| `rtk proxy npm run test:e2e` | Playwright root, webServer menjalankan runtime yang sesungguhnya |
| `rtk proxy npm run test:e2e:install` | Install Chromium versi Playwright yang dipin secara eksplisit |

Saat menghasilkan lockfile pertama: resolve dengan scripts disabled, review sumber install scripts,
integrity/provenance dan native artifacts; dokumentasikan hanya langkah rebuild/binary install yang diperlukan.
`npm ci --ignore-scripts` lalu langkah terpilih harus reproducible; jangan `npm rebuild` seluruh graph.
Rolldown/Playwright dan paket native yang kelak diperlukan diuji tanpa blanket approval.
`npm audit`/signature review tidak membuktikan seluruh dependency aman; temuan relevan ditriase sebelum gate rilis.
Command aktual mengikuti manifest/README; bukti eksekusi mengikuti task list, bukan tabel ini.

## Sumber resmi dan batas bukti

- [Node releases](https://nodejs.org/en/about/previous-releases) dan
  [npm 11.3.0 metadata](https://registry.npmjs.org/npm/11.3.0).
- Pin tabel diperiksa pada registry resmi `https://registry.npmjs.org/<package>/<version>`;
  contoh [Vite 8.3.7](https://registry.npmjs.org/vite/8.3.7),
  [Vitest 5.1.0](https://registry.npmjs.org/vitest/5.1.0),
  [ESLint 10.14.0](https://registry.npmjs.org/eslint/10.14.0).
- [Node 26.13.0 LTS](https://nodejs.org/en/blog/release/v26.13.0),
  [Vite](https://vite.dev/guide/), [Vitest coverage](https://vitest.dev/guide/coverage.html),
  [Sequelize 6 / MySQL driver](https://sequelize.org/docs/v6/getting-started/),
  [Playwright installation](https://playwright.dev/docs/intro),
  [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/).

Review metadata engine/peer pada G0 adalah bukti desain. Bukti install/lint/build/test/runtime selanjutnya
ada di task list; source/tooling sudah tersedia. Upgrade berikutnya memakai lockfile yang direview,
tanpa menurunkan quality gates. Database lokal mengikuti AGENTS: MariaDB 3306 dan test `lr_test_*`;
compatibility MySQL produksi tetap gate rilis.
