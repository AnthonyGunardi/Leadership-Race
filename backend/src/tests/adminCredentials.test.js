import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_HASH_COST,
  MAX_PASSWORD_BYTES,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  validatePassword,
  validateCredentials,
  hashPassword,
  verifyPassword
} from '../services/adminCredentials.js';

describe('Admin credentials validation and hashing service', () => {
  describe('Constants', () => {
    it('enforces secure defaults compliant with ADR-002', () => {
      expect(DEFAULT_HASH_COST).toBeGreaterThanOrEqual(12);
      expect(MAX_PASSWORD_BYTES).toBe(72);
      expect(MIN_PASSWORD_LENGTH).toBeGreaterThanOrEqual(8);
    });
  });

  describe('normalizeEmail', () => {
    it('normalizes valid emails to trimmed lowercase', () => {
      expect(normalizeEmail('  Admin@Example.COM  ')).toBe('admin@example.com');
      expect(normalizeEmail('super.admin+race@sub.domain.test')).toBe('super.admin+race@sub.domain.test');
    });

    it.each([
      '',
      '   ',
      'not-an-email',
      'missing@domain',
      '@nodomain.com',
      null,
      undefined,
      123
    ])('rejects invalid email: %s', (invalid) => {
      expect(() => normalizeEmail(invalid)).toThrow(/Invalid email/i);
    });
  });

  describe('validatePassword', () => {
    it('accepts passwords within UTF-8 byte boundary (8 to 72 bytes)', () => {
      expect(validatePassword('correct-horse-battery-staple')).toBe('correct-horse-battery-staple');
      expect(validatePassword('a'.repeat(72))).toBe('a'.repeat(72));
      // Exactly 72 bytes UTF-8 (70 ascii + 2 byte char 'ü')
      const exact72Bytes = Buffer.from('a'.repeat(70) + 'ü', 'utf8').toString('utf8');
      expect(Buffer.byteLength(exact72Bytes, 'utf8')).toBe(72);
      expect(validatePassword(exact72Bytes)).toBe(exact72Bytes);
    });

    it('rejects passwords shorter than MIN_PASSWORD_LENGTH', () => {
      expect(() => validatePassword('short')).toThrow(/at least 8 characters/i);
      expect(() => validatePassword('')).toThrow(/at least 8 characters/i);
    });

    it('rejects passwords exceeding 72 UTF-8 bytes to prevent bcrypt silent truncation', () => {
      const ascii73 = 'a'.repeat(73);
      expect(() => validatePassword(ascii73)).toThrow(/cannot exceed 72 bytes/i);

      // Multi-byte string that is <72 characters but >72 bytes
      // 'é' is 2 bytes in UTF-8. 37 * 2 = 74 bytes.
      const multiByte74 = 'é'.repeat(37);
      expect(multiByte74.length).toBe(37); // Only 37 characters
      expect(Buffer.byteLength(multiByte74, 'utf8')).toBe(74); // 74 bytes!
      expect(() => validatePassword(multiByte74)).toThrow(/cannot exceed 72 bytes/i);
    });

    it('rejects non-string password inputs', () => {
      expect(() => validatePassword(null)).toThrow(/must be a string/i);
      expect(() => validatePassword(undefined)).toThrow(/must be a string/i);
      expect(() => validatePassword(12345678)).toThrow(/must be a string/i);
    });
  });

  describe('validateCredentials', () => {
    it('validates and normalizes credential pairs', () => {
      const result = validateCredentials({
        email: ' Admin@Domain.Test ',
        password: 'ValidPassword123!'
      });
      expect(result).toEqual({
        email: 'admin@domain.test',
        password: 'ValidPassword123!'
      });
    });

    it('fails if either email or password is missing or invalid', () => {
      expect(() => validateCredentials({ email: 'bad', password: 'validPassword123' })).toThrow();
      expect(() => validateCredentials({ email: 'good@test.com', password: 'short' })).toThrow();
      expect(() => validateCredentials(null)).toThrow();
    });
  });

  describe('hashPassword and verifyPassword', () => {
    it('hashes passwords with cost >= 12 and verifies correct password', async () => {
      const password = 'SuperSecretAdminPassword2026!';
      const hash = await hashPassword(password);

      expect(hash).toMatch(/^\$2[aby]\$(1[2-9]|2\d|3[01])\$[./A-Za-z0-9]{53}$/);
      expect(hash).toContain('$12$');

      const isValid = await verifyPassword(password, hash);
      expect(isValid).toBe(true);

      const isMismatch = await verifyPassword('WrongPassword123!', hash);
      expect(isMismatch).toBe(false);
    });

    it('rejects cost parameter below 12', async () => {
      await expect(hashPassword('ValidPassword123!', 10)).rejects.toThrow(/cost must be at least 12/i);
    });

    it('rejects hashing passwords that exceed 72 bytes', async () => {
      const tooLong = 'b'.repeat(73);
      await expect(hashPassword(tooLong)).rejects.toThrow(/cannot exceed 72 bytes/i);
    });

    it('returns false on password verification when password exceeds 72 bytes or is invalid', async () => {
      const hash = await hashPassword('ValidPassword123!');
      expect(await verifyPassword('c'.repeat(73), hash)).toBe(false);
      expect(await verifyPassword('', hash)).toBe(false);
      expect(await verifyPassword(null, hash)).toBe(false);
      expect(await verifyPassword('ValidPassword123!', 'invalid-hash')).toBe(false);
    });

    it('returns false if bcrypt throws an internal unexpected error', async () => {
      const bcrypt = (await import('bcrypt')).default;
      const spy = vi.spyOn(bcrypt, 'compare').mockRejectedValueOnce(new Error('Unexpected bcrypt crash'));
      const result = await verifyPassword('ValidPassword123!', `$2b$12$${'a'.repeat(53)}`);
      expect(result).toBe(false);
      spy.mockRestore();
    });
  });
});
