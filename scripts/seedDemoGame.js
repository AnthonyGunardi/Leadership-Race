import { randomUUID } from 'node:crypto';
import { validateEnvironment } from '../backend/src/config/environment.js';
import { getSequelize } from '../backend/src/config/database.js';
import { bootstrapAdminUser } from '../backend/src/services/adminBootstrap.js';
import { defineAdminIdentity } from '../backend/src/models/adminIdentity.js';
import {
  saveGameSetup,
  validateGame,
  startGame
} from '../backend/src/services/gameSetup.js';
import { ensureCurrentGame } from '../backend/src/services/singleGame.js';
import { getPrdBoardTemplate } from '../backend/src/data/boardTemplate.js';

async function seed() {
  validateEnvironment();
  const sequelize = getSequelize();
  await sequelize.authenticate();
  console.log('Database connected.');

  const { User } = defineAdminIdentity(sequelize);

  // 1. Ensure Super Admin user exists
  const adminEmail = 'admin@f1race.com';
  const adminPassword = 'AdminPassword123!';
  let admin = await User.findOne({ where: { email: adminEmail } });
  if (!admin) {
    admin = await bootstrapAdminUser({
      sequelize,
      email: adminEmail,
      password: adminPassword
    });
    console.log(`Created Super Admin user: ${adminEmail}`);
  } else {
    console.log(`Super Admin user already exists: ${adminEmail} (${admin.id})`);
  }

  // 2. Create Demo Game
  const gameName = 'F1 Leadership Race — Demo';
  const createResult = await ensureCurrentGame({
    sequelize,
    actorUserId: admin.id,
    idempotencyKey: randomUUID(),
    requestId: randomUUID(),
    input: { name: gameName }
  });
  const gameId = createResult.body.data.game.id;
  if (createResult.body.data.teams.length || createResult.body.data.game.status !== 'DRAFT') {
    console.log('Game operasional yang sudah dikonfigurasi dipertahankan. Board: http://localhost:5173/');
    await sequelize.close();
    return;
  }
  let stateVersion = createResult.body.meta.stateVersion;
  console.log(`Created demo game: ${gameName} [ID: ${gameId}] (Version: ${stateVersion})`);

  // 3. Configure 5 Teams and 50 Board Cells (Official PRD template)
  const template = getPrdBoardTemplate();
  const demoTeams = [
    { name: 'Red Bull Racing', color: '#1e41ff', sortOrder: 1 },
    { name: 'Scuderia Ferrari', color: '#e10600', sortOrder: 2 },
    { name: 'Mercedes-AMG', color: '#00d2be', sortOrder: 3 },
    { name: 'McLaren F1', color: '#ff8700', sortOrder: 4 },
    { name: 'Aston Martin', color: '#006f62', sortOrder: 5 }
  ];

  const saveResult = await saveGameSetup({
    sequelize,
    gameId,
    actorUserId: admin.id,
    idempotencyKey: randomUUID(),
    requestId: randomUUID(),
    input: {
      name: gameName,
      expectedStateVersion: stateVersion,
      teams: demoTeams,
      boardCells: template.boardCells
    }
  });
  stateVersion = saveResult.body.meta.stateVersion;
  console.log(`Saved setup with 5 teams and ${template.boardCells.length} board cells. (Version: ${stateVersion})`);

  // 4. Validate Game Preflight (DRAFT -> READY)
  const validateResult = await validateGame({
    sequelize,
    gameId,
    actorUserId: admin.id,
    idempotencyKey: randomUUID(),
    requestId: randomUUID(),
    input: {
      expectedStateVersion: stateVersion
    }
  });
  stateVersion = validateResult.body.meta.stateVersion;
  console.log(`Game validated successfully. Status: READY. (Version: ${stateVersion})`);

  // 5. Start Game (READY -> RUNNING)
  const startResult = await startGame({
    sequelize,
    gameId,
    actorUserId: admin.id,
    idempotencyKey: randomUUID(),
    requestId: randomUUID(),
    input: {
      expectedStateVersion: stateVersion
    }
  });
  stateVersion = startResult.body.meta.stateVersion;
  console.log(`Game started! Status: RUNNING. (Version: ${stateVersion})`);

  console.log('\n================ DEMO GAME READY ================');
  console.log(`Game ID: ${gameId}`);
  console.log(`Game Name: ${gameName}`);
  console.log('\n--- Link untuk melihat Board Game ---');
  console.log('Halaman Display Board: http://localhost:5173/');
  console.log('\n--- Akses Admin (Super Admin) ---');
  console.log('URL Login:     http://localhost:5173/login');
  console.log(`Email:         ${adminEmail}`);
  console.log(`Setup Game:    http://localhost:5173/admin/games/${gameId}/setup`);
  console.log(`Kontrol Game:  http://localhost:5173/admin/games/${gameId}/control`);
  console.log('Reset & arsip: http://localhost:5173/admin/games');
  console.log('=================================================\n');

  await sequelize.close();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
