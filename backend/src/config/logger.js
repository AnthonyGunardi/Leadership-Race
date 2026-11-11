import path from 'path';
import { fileURLToPath } from 'url';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { getEnv } from './environment.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SENSITIVE_KEY_PATTERN =
  /(password|token|secret|ciphertext|credential|cookie|authorization|code)/i;

const SAFE_EXCEPTIONS = /^(statusCode|status_code|errorCode|error_code)$/i;

function isSensitiveKey(key) {
  if (SAFE_EXCEPTIONS.test(key)) {
    return false;
  }
  return SENSITIVE_KEY_PATTERN.test(key);
}

/**
 * Recursively scrubs sensitive credentials, keys, and tokens from metadata or errors.
 *
 * @param {unknown} data The object, array, or primitive to sanitize.
 * @returns {unknown} Sanitized clone of the input data.
 */
export function redactSensitiveData(data) {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveData(item));
  }

  if (data instanceof Error) {
    const errorCopy = {
      name: data.name,
      message: data.message,
      stack: data.stack
    };
    for (const [key, value] of Object.entries(data)) {
      if (isSensitiveKey(key)) {
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          errorCopy[key] = redactSensitiveData(value);
        } else {
          errorCopy[key] = '[REDACTED]';
        }
      } else {
        errorCopy[key] = redactSensitiveData(value);
      }
    }
    for (const sym of Object.getOwnPropertySymbols(data)) {
      errorCopy[sym] = data[sym];
    }
    return errorCopy;
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(data)) {
    if (isSensitiveKey(key)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        sanitized[key] = redactSensitiveData(value);
      } else {
        sanitized[key] = '[REDACTED]';
      }
    } else {
      sanitized[key] = redactSensitiveData(value);
    }
  }
  for (const sym of Object.getOwnPropertySymbols(data)) {
    sanitized[sym] = data[sym];
  }
  return sanitized;
}

const redactFormat = winston.format((info) => {
  return redactSensitiveData(info);
});

/**
 * Creates and configures a Winston logger instance adhering to project standards.
 *
 * Constraints:
 * - Emits structured JSON logs containing timestamp, level, and message.
 * - Redacts passwords, tokens, cookies, pairing codes, and secrets from all metadata.
 * - In production/development, rotates logs daily under backend/src/logs/.
 * - In test environment, avoids writing to production logs.
 *
 * @param {object} [options={}] Configuration overrides.
 * @param {string} [options.level] Log level override.
 * @param {winston.transport[]} [options.transports] Transports override for isolated testing.
 * @returns {winston.Logger} Configured Winston logger.
 */
export function createLogger(options = {}) {
  const env = options.env || getEnv();
  const logLevel = options.level || env.LOG_LEVEL || 'info';

  if (options.transports && options.transports.length > 0) {
    return winston.createLogger({
      level: logLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        redactFormat(),
        winston.format.json()
      ),
      transports: options.transports
    });
  }

  const logDir = path.resolve(__dirname, '../logs');

  const fileRotateTransport = new DailyRotateFile({
    dirname: logDir,
    filename: 'application-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
    level: logLevel
  });

  const errorFileRotateTransport = new DailyRotateFile({
    dirname: logDir,
    filename: 'error-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
    level: 'error'
  });

  const defaultTransports = env.NODE_ENV === 'test'
    ? [new winston.transports.Console({ silent: true })]
    : [
      new winston.transports.Console(),
      fileRotateTransport,
      errorFileRotateTransport
    ];

  return winston.createLogger({
    level: logLevel,
    format: winston.format.combine(
      winston.format.timestamp(),
      redactFormat(),
      winston.format.json()
    ),
    transports: defaultTransports
  });
}

export const logger = createLogger();
