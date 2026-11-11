const fs = require('node:fs');
const path = require('node:path');
const { env } = require('process');

const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(envPath);
  } catch {
    // Gracefully ignore load errors
  }
}

module.exports = {
  development: {
    username: env.DB_USER || 'root',
    password: env.DB_PASSWORD !== undefined ? env.DB_PASSWORD : null,
    database: env.DB_NAME || 'lr_development',
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT) || 3306,
    dialect: 'mysql'
  },
  test: {
    username: env.DB_USER || 'root',
    password: env.DB_PASSWORD !== undefined ? env.DB_PASSWORD : null,
    database: env.DB_NAME || 'lr_test',
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT) || 3306,
    dialect: 'mysql'
  },
  production: {
    username: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    host: env.DB_HOST,
    port: Number(env.DB_PORT) || 3306,
    dialect: 'mysql'
  }
};
