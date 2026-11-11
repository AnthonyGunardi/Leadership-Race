import { Sequelize } from 'sequelize';
import { getEnv } from './environment.js';
import { logger } from './logger.js';

/**
 * Ensures a database schema name conforms to isolated test schema naming rules.
 *
 * Constraints:
 * - Prevents destructive drop/cleanup operations against development or production databases.
 * - Enforces that disposable test databases must strictly start with 'lr_test_'.
 *
 * @param {string} schemaName The database name to validate.
 * @throws {Error} If the schema name does not start with 'lr_test_'.
 */
export function assertSafeTestSchema(schemaName) {
  if (typeof schemaName !== 'string' || !/^lr_test_[a-zA-Z0-9_]+$/.test(schemaName)) {
    throw new Error(
      `Unsafe test schema operation: '${schemaName}' is not a valid disposable test schema (must match ^lr_test_)`
    );
  }
}

/**
 * Creates and configures a Sequelize ORM instance.
 *
 * @param {object} [overrides={}] Database configuration overrides.
 * @returns {Sequelize} Configured Sequelize instance.
 */
export function createSequelizeInstance(overrides = {}) {
  const env = getEnv();

  const host = overrides.host || env.DB_HOST;
  const port = overrides.port || env.DB_PORT;
  const database = overrides.database || env.DB_NAME;
  const username = overrides.username || env.DB_USER;
  const password = overrides.password !== undefined ? overrides.password : env.DB_PASSWORD;

  const isTest = (overrides.NODE_ENV || env.NODE_ENV) === 'test';

  return new Sequelize(database, username, password, {
    host,
    port,
    dialect: 'mysql',
    logging: isTest
      ? false
      : (msg) => logger.debug(msg),
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000
    },
    define: {
      timestamps: true,
      underscored: true
    }
  });
}

let defaultSequelize = null;

/**
 * Returns the shared Sequelize instance, initializing it lazily on first access.
 *
 * @returns {Sequelize}
 */
export function getSequelize() {
  if (!defaultSequelize) {
    defaultSequelize = createSequelizeInstance();
  }
  return defaultSequelize;
}

/**
 * Closes the shared Sequelize connection pool cleanly and resets cached instance.
 *
 * @returns {Promise<void>}
 */
export async function closeSequelize() {
  if (defaultSequelize) {
    await defaultSequelize.close();
    defaultSequelize = null;
  }
}
