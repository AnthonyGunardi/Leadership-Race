import mysql from 'mysql2/promise';
import { getEnv } from '../../config/environment.js';
import { assertSafeTestSchema, createSequelizeInstance } from '../../config/database.js';

/**
 * Creates an isolated disposable MySQL test database for an integration test run.
 *
 * Constraints:
 * - Uses unique schema name starting with 'lr_test_' to avoid concurrency collisions.
 * - Enforces safety assertions before creation and deletion.
 *
 * @returns {Promise<{
 *   schemaName: string,
 *   sequelize: import('sequelize').Sequelize,
 *   cleanup: () => Promise<void>
 * }>}
 */
export async function setupIsolatedTestDatabase() {
  const env = getEnv();
  const uniqueSuffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const schemaName = `lr_test_${uniqueSuffix}`;

  assertSafeTestSchema(schemaName);

  const adminConn = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD
  });

  try {
    await adminConn.query(`CREATE DATABASE \`${schemaName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
  } finally {
    await adminConn.end();
  }

  const sequelize = createSequelizeInstance({
    database: schemaName
  });

  const cleanup = async () => {
    assertSafeTestSchema(schemaName);

    try {
      await sequelize.close();
    } catch {
      // Ignore if already closed
    }

    const dropConn = await mysql.createConnection({
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD
    });

    try {
      await dropConn.query(`DROP DATABASE IF EXISTS \`${schemaName}\`;`);
    } finally {
      await dropConn.end();
    }
  };

  return {
    schemaName,
    sequelize,
    cleanup
  };
}

