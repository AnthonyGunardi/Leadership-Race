import bcrypt from 'bcrypt';

export const DEFAULT_HASH_COST = 12;
export const MAX_PASSWORD_BYTES = 72;
export const MIN_PASSWORD_LENGTH = 8;

const EMAIL_REGEX = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

/**
 * Normalizes and validates an admin email address.
 * Trims whitespace, converts to lowercase, and asserts compliant email structure.
 *
 * @param {unknown} email
 * @returns {string} Normalized lowercase email
 * @throws {Error} If email is non-string or structurally invalid
 */
export function normalizeEmail(email) {
  if (typeof email !== 'string') {
    throw new Error('Invalid email: email must be a string');
  }
  const normalized = email.trim().toLowerCase();
  if (!normalized || !EMAIL_REGEX.test(normalized)) {
    throw new Error('Invalid email: email format is invalid');
  }
  return normalized;
}

/**
 * Validates password length and UTF-8 byte boundary.
 * Enforces a strict maximum of 72 bytes to prevent bcrypt silent truncation.
 *
 * @param {unknown} password
 * @returns {string} Validated password string
 * @throws {Error} If password is not a string, <8 chars, or >72 UTF-8 bytes
 */
export function validatePassword(password) {
  if (typeof password !== 'string') {
    throw new Error('Invalid password: password must be a string');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Invalid password: password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
  }
  const byteLength = Buffer.byteLength(password, 'utf8');
  if (byteLength > MAX_PASSWORD_BYTES) {
    throw new Error(`Invalid password: password cannot exceed ${MAX_PASSWORD_BYTES} bytes in UTF-8`);
  }
  return password;
}

/**
 * Validates and normalizes both email and password credentials.
 *
 * @param {unknown} credentials
 * @returns {{ email: string, password: string }}
 */
export function validateCredentials(credentials) {
  if (!credentials || typeof credentials !== 'object') {
    throw new Error('Credentials object is required');
  }
  const email = normalizeEmail(credentials.email);
  const password = validatePassword(credentials.password);
  return { email, password };
}

/**
 * Securely hashes a password using bcrypt with minimum cost 12.
 * Validates password byte limits prior to hashing.
 *
 * @param {string} password
 * @param {number} [cost=DEFAULT_HASH_COST]
 * @returns {Promise<string>}
 */
export async function hashPassword(password, cost = DEFAULT_HASH_COST) {
  if (cost < DEFAULT_HASH_COST) {
    throw new Error(`Bcrypt cost must be at least ${DEFAULT_HASH_COST}`);
  }
  validatePassword(password);
  return bcrypt.hash(password, cost);
}

/**
 * Verifies a plaintext password against a bcrypt hash.
 * Returns false if password exceeds 72 bytes, is invalid, or if verification fails.
 * Never throws or leaks credential material.
 *
 * @param {unknown} password
 * @param {unknown} hash
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, hash) {
  if (typeof password !== 'string' || typeof hash !== 'string' || !password || !hash) {
    return false;
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    return false;
  }
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

