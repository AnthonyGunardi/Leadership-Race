import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(currentDir, '../..');
const defaultEnvPath = path.resolve(backendDir, '.env');

/**
 * Loads environment variables from backend/.env into process.env if present.
 *
 * Why:
 * - Centralizes backend environment loading from backend/.env so execution from any directory finds config.
 * - Preserves existing environment overrides and shields test mode from unsafe development database targets.
 *
 * @param {string} [envPath=defaultEnvPath] Absolute or relative path to environment file.
 * @returns {void}
 */
export function loadBackendEnv(envPath = defaultEnvPath) {
  if (typeof process.loadEnvFile === 'function' && fs.existsSync(envPath)) {
    try {
      const prevDbName = process.env.DB_NAME;
      const isTest = process.env.NODE_ENV === 'test';
      process.loadEnvFile(envPath);
      if (isTest) {
        if (prevDbName !== undefined) {
          process.env.DB_NAME = prevDbName;
        } else if (!process.env.DB_NAME?.startsWith('lr_test_')) {
          delete process.env.DB_NAME;
        }
      }
    } catch {
      // Gracefully ignore load errors to allow fallback to defaults or existing environment
    }
  }
}

const rawSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  DB_HOST: z.string().min(1).default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().max(65535).default(3306),
  DB_NAME: z.string().min(1).default('lr_development'),
  DB_USER: z.string().min(1).default('root'),
  DB_PASSWORD: z.string().default(''),
  CONTROLLER_RECEIPT_KEY_ID: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).default('v1'),
  CONTROLLER_RECEIPT_KEYS: z.string().transform((value, ctx) => {
    try {
      return JSON.parse(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Must be a JSON key map' });
      return z.NEVER;
    }
  }).pipe(z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), z.string().regex(/^[a-fA-F0-9]{64}$/))).optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SERVER_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  SERVER_HEADERS_TIMEOUT_MS: z.coerce.number().int().positive().default(65000),
  SERVER_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  SERVER_KEEPALIVE_TIMEOUT_MS: z.coerce.number().int().positive().default(61000)
}).superRefine((data, ctx) => {
  if (data.CONTROLLER_RECEIPT_KEYS && Object.keys(data.CONTROLLER_RECEIPT_KEYS).length > 0
    && !data.CONTROLLER_RECEIPT_KEYS[data.CONTROLLER_RECEIPT_KEY_ID]) {
    ctx.addIssue({ code: 'custom', path: ['CONTROLLER_RECEIPT_KEYS'], message: 'Active key ID is missing' });
  }
  if (data.NODE_ENV === 'test') {
    if (data.DB_NAME === 'lr_development' || data.DB_NAME === 'lr_production') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DB_NAME'],
        message: 'Test environment must not use development or production database name'
      });
    }
  }
});

const environmentSchema = z.preprocess((raw) => {
  const input = typeof raw === 'object' && raw !== null ? { ...raw } : {};
  if (input.NODE_ENV === 'test' && !input.DB_NAME) {
    input.DB_NAME = 'lr_test';
  }
  return input;
}, rawSchema);

/**
 * Validates and normalizes runtime environment configuration fail-fast at entry boundary.
 *
 * Constraints:
 * - Redacts sensitive values on validation failure to prevent credential exposure in logs or terminal.
 * - Prevents test execution against development or production databases by enforcing isolated DB name rules.
 *
 * @param {Record<string, unknown>} [envSource=process.env] Raw environment dictionary to validate.
 * @returns {z.infer<typeof rawSchema>} Validated and normalized environment settings.
 * @throws {Error} When configuration is invalid or missing required constraints.
 */
export function validateEnvironment(envSource = process.env) {
  if (envSource === process.env) {
    loadBackendEnv();
  }
  const result = environmentSchema.safeParse(envSource);
  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ');
    throw new Error(`Invalid environment configuration: ${errorDetails}`);
  }
  return result.data;
}

let cachedEnv = null;

/**
 * Returns the cached validated environment or validates process.env on initial call.
 *
 * @returns {z.infer<typeof rawSchema>}
 */
export function getEnv() {
  if (!cachedEnv) {
    cachedEnv = validateEnvironment(process.env);
  }
  return cachedEnv;
}

/**
 * Resets the cached environment for testing purposes.
 *
 * @returns {void}
 */
export function resetCachedEnv() {
  cachedEnv = null;
}
