import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSequelize, closeSequelize } from '../backend/src/config/database.js';
import { validateEnvironment } from '../backend/src/config/environment.js';
import { createBackup } from '../backend/src/services/backupRestore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  validateEnvironment();
  const sequelize = getSequelize();
  await sequelize.authenticate();

  const args = process.argv.slice(2);
  let outputPath;
  const outIndex = args.indexOf('--output');
  if (outIndex !== -1 && args[outIndex + 1]) {
    outputPath = path.resolve(args[outIndex + 1]);
  } else {
    const backupDir = path.resolve(__dirname, '../backups');
    await fs.mkdir(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    outputPath = path.join(backupDir, `backup-${timestamp}.json`);
  }

  console.log('Initiating database backup...');
  const backup = await createBackup({ sequelize });

  await fs.writeFile(outputPath, JSON.stringify(backup, null, 2), 'utf8');

  console.log('Backup completed successfully!');
  console.log(`File: ${outputPath}`);
  console.log(`Tables: ${backup.metadata.tableCount}`);
  console.log(`Total Records: ${backup.metadata.recordCount}`);
  console.log(`SHA-256 Checksum: ${backup.metadata.checksum}`);

  await closeSequelize();
}

main().catch(async (err) => {
  console.error('Backup failed:', err);
  await closeSequelize().catch(() => {});
  process.exit(1);
});
