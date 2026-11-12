# Checklist Implementasi: Asynchronous Multi-Team Turn & Scoring

Berdasarkan keputusan pengguna:
- Keputusan 1: Opsi 1A (Maksimal 1 pending challenge per tim; tim lain bebas lempar dadu).
- Keputusan 2: Poin challenge hanya untuk tim yang sudah lempar dadu dan belum dinilai (non-indisipliner).
- Keputusan 3: Opsi 3A (Sequential Movement Queue pada layar LED display).

## Task List

- [x] **Task 1: Backend Domain & Turn Validation Refactoring**
  - [x] Update `backend/src/validation/turn.js`: Tambahkan `teamId: z.string().uuid().optional()` pada `rollDiceSchema`.
  - [x] Update `backend/src/services/turnCommands.js`:
    - [x] `rollDice`: Ambil team berdasarkan `input.teamId`. Validasi bahwa tim tersebut tidak sedang `ANIMATING` atau `AWAITING_RESULT` (Rule 1A). Lepas kuncian `game.activeTurnId !== null` untuk tim lain.
    - [x] `recordChallengeResult`: Lepas syarat `game.activeTurnId === turn.id`. Validasi `turn.status === 'AWAITING_RESULT'`.
    - [x] `voidTurn`: Pertahankan invariant R-12 (hanya roll terakhir keseluruhan game yang dapat dibatalkan).
  - [x] Update `backend/src/services/turnSettlement.js`: Settle semua turn `ANIMATING` yang telah melewati `movementEndsAt`.
  - [x] Verifikasi: `backend/src/tests/turnValidation.test.js` & `movementWorker.test.js`.

- [x] **Task 2: Backend Snapshot, Realtime & Integration Tests**
  - [x] Update `backend/src/services/gameSetup.js`:
    - [x] Snapshot menyertakan `pendingResults: [...]` (array seluruh turn `AWAITING_RESULT`).
    - [x] Pertahankan `pendingResult` (item pertama) untuk backward compatibility.
    - [x] Sertakan `activeMovements: [...]` untuk sinkronisasi display antrian.
  - [x] Integration tests:
    - [x] `asynchronousTurns.test.js` (uji multi-team roll, 409 rule 1A per tim, out-of-order scoring).
    - [x] `turnRoll.test.js`, `turnResult.test.js`, `turnVoid.test.js` lulus 100%.

- [x] **Task 3: Frontend Display Sequential Animation Queue**
  - [x] Authoritative sequential movement timestamps di backend (`now + delay` atau `lastMovementEndsAt + 300ms`).
  - [x] `useMovementTimeline`: Mendukung multi-movement playback berurutan.
  - [x] Verifikasi: 19 test suite frontend lulus 100%.

- [x] **Task 4: Frontend Admin Workspace Refactoring**
  - [x] Update `frontend/src/hooks/useControllerLease.js`:
    - [x] `roll(diceValue, targetTeamId)` dan `roll({ diceValue, teamId })`.
    - [x] `submitResult({ turnId, scoringMethod, outcome, points, note })`.
    - [x] Izinkan `canRoll` selama tim yang dipilih tidak memiliki pending challenge.
  - [x] Update `frontend/src/components/SimpleGameWorkspace.jsx`:
    - [x] Selector tim / klik baris tim untuk input dadu bebas per-tim.
    - [x] Indikator status per-tim (Ready / Waiting Score).
    - [x] Komponen multi-tantangan pending dengan navigasi tab dan scoring mandiri.
  - [x] Sinkronisasi ke `Leadership-Race-frontend`.

- [x] **Task 5: Sinkronisasi ke `be-poin-peserta`**
  - [x] Porting perubahan domain & service ke `be-poin-peserta/apps/leadership-race/src/`:
    - [x] `src/validation/turn.js`
    - [x] `src/services/turnCommands.js`
    - [x] `src/services/turnSettlement.js`
    - [x] `src/services/gameSetup.js`

- [x] **Task 6: Verifikasi End-to-End & Acceptance**
  - [x] Unit test backend: 21 test files (253 tests) PASSED.
  - [x] Integration test backend: `asynchronousTurns.test.js`, `turnRoll.test.js`, `turnResult.test.js`, `turnVoid.test.js` PASSED.
  - [x] Test suite frontend: 19 test files (137 tests) PASSED.
