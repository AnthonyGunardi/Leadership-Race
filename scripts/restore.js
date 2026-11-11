import fs from 'node:fs/promises';
import path from 'node:path';
import { getSequelize, closeSequelize } from '../backend/src/config/database.js';
import { validateEnvironment } from '../backend/src/config/environment.js';
import { restoreBackup } from '../backend/src/services/backupRestore.js';

async function main() {
  const args = process.argv.slice(2);
  const inputArg = args[0];

  if (!inputArg || inputArg.startsWith('--')) {
    console.error('Usage: node scripts/restore.js <path-to-backup.json>');
    process.exit(1);
  }

  const filePath = path.resolve(inputArg);
  const rawData = await fs.readFile(filePath, 'utf8');
  const backupPayload = JSON.parse(rawData);

  validateEnvironment();
  const sequelize = getSequelize();
  await sequelize.authenticate();

  console.log(`Initiating database restoration from ${filePath}...`);
  console.log(`Backup created at: ${backupPayload.metadata?.createdAt}`);
  console.log(`Backup record count: ${backupPayload.metadata?.recordCount}`);

  const result = await restoreBackup({ sequelize, backupPayload });

  console.log('Restoration completed successfully!');
  console.log(`Restored Tables: ${result.restoredTables.join(', ')}`);
  console.log(`Total Records Restored: ${result.totalRestored}`);

  await closeSequelize();
}

main().catch(async (err) => {
  console.error('Restoration failed:', err);
  await closeSequelize().catch(() => {});
  process.exit(1);
});

