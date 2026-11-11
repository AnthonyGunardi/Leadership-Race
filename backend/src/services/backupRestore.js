import { createHash } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { defineGameSetup } from '../models/gameSetup.js';
import { defineSingleGame } from '../models/singleGame.js';

/**
 * Ordered list of database tables for backup and restoration.
 * The order ensures proper dependency resolution during restoration.
 */
const BACKUP_TABLES = [
  'users',
  'admin_sessions',
  'admin_refresh_tokens',
  'admin_access_tokens',
  'audit_logs',
  'games',
  'teams',
  'board_cells',
  'command_log',
  'game_events',
  'outbox_events',
  'display_pairing_codes',
  'display_tokens',
  'display_pairing_limits',
  'controller_leases',
  'turns',
  'challenge_results',
  'score_ledger',
  'final_results',
  'single_game',
  'game_archives'
];

/**
 * Normalizes a single row object for database insertion, ensuring nested objects
 * or arrays intended for JSON columns are safely serialized as JSON strings.
 *
 * @param {object} row Raw database row object.
 * @returns {object} Normalized row object.
 */
function normalizeRowForInsert(row) {
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
      normalized[key] = JSON.stringify(value);
    } else {
      normalized[key] = value;
    }
  }
  return normalized;
}

/**
 * Creates a complete structured backup snapshot of the database.
 *
 * @param {object} options
 * @param {import('sequelize').Sequelize} options.sequelize Sequelize database connection.
 * @returns {Promise<{
 *   metadata: {
 *     version: string,
 *     schemaVersion: string,
 *     createdAt: string,
 *     tableCount: number,
 *     recordCount: number,
 *     checksum: string
 *   },
 *   data: Record<string, any[]>
 * }>}
 */
export async function createBackup({ sequelize }) {
  if (!sequelize) {
    throw new Error('Sequelize instance is required for createBackup');
  }

  const data = {};
  let recordCount = 0;

  for (const table of BACKUP_TABLES) {
    try {
      const rows = await sequelize.query(`SELECT * FROM \`${table}\``, {
        type: QueryTypes.SELECT
      });
      data[table] = rows;
      recordCount += rows.length;
    } catch {
      data[table] = [];
    }
  }

  const payloadString = JSON.stringify(data);
  const checksum = createHash('sha256').update(payloadString).digest('hex');

  return {
    metadata: {
      version: '1.0.0',
      schemaVersion: '202611100010',
      createdAt: new Date().toISOString(),
      tableCount: Object.keys(data).length,
      recordCount,
      checksum
    },
    data
  };
}

/**
 * Restores a complete database backup snapshot transactionally with foreign key check guards.
 *
 * @param {object} options
 * @param {import('sequelize').Sequelize} options.sequelize Sequelize database connection.
 * @param {object} options.backupPayload Full backup payload containing metadata and data.
 * @returns {Promise<{
 *   success: boolean,
 *   restoredTables: string[],
 *   totalRestored: number,
 *   timestamp: string
 * }>}
 */
export async function restoreBackup({ sequelize, backupPayload }) {
  if (!sequelize) {
    throw new Error('Sequelize instance is required for restoreBackup');
  }
  if (!backupPayload || typeof backupPayload !== 'object' || !backupPayload.data || !backupPayload.metadata) {
    throw new Error('Invalid backup payload: missing data or metadata');
  }

  const computedChecksum = createHash('sha256').update(JSON.stringify(backupPayload.data)).digest('hex');
  if (computedChecksum !== backupPayload.metadata.checksum) {
    throw new Error('Backup checksum verification failed: data corruption or modification detected');
  }

  const queryInterface = sequelize.getQueryInterface();

  return await sequelize.transaction(async (transaction) => {
    // Disable foreign key checks for the restoration session
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0', { transaction });

    try {
      // Clear target tables in reverse dependency order
      const reverseTables = [...BACKUP_TABLES].reverse();
      for (const table of reverseTables) {
        try {
          await sequelize.query(`DELETE FROM \`${table}\``, { transaction });
        } catch {
          // Table may not exist yet in an unmigrated target schema
        }
      }

      let totalRestored = 0;
      const restoredTables = [];

      // Re-populate tables in dependency order
      for (const table of BACKUP_TABLES) {
        const rows = backupPayload.data[table];
        if (Array.isArray(rows) && rows.length > 0) {
          const sanitizedRows = rows.map(normalizeRowForInsert);
          await queryInterface.bulkInsert(table, sanitizedRows, { transaction });
          totalRestored += rows.length;
          restoredTables.push(table);
        }
      }

      // Backups made before the singleton migration have no pointer; adopt their most recently updated game.
      if (!backupPayload.data.single_game?.length) {
        const game = await defineGameSetup(sequelize).Game.findOne({
          order: [['updatedAt', 'DESC'], ['id', 'ASC']], transaction
        });
        await defineSingleGame(sequelize).SingleGame.create({ id: 1, gameId: game?.id ?? null }, { transaction });
        totalRestored += 1;
        restoredTables.push('single_game');
      }

      return {
        success: true,
        restoredTables,
        totalRestored,
        timestamp: new Date().toISOString()
      };
    } finally {
      // Guarantee re-enabling foreign key checks
      await sequelize.query('SET FOREIGN_KEY_CHECKS = 1', { transaction });
    }
  });
}

