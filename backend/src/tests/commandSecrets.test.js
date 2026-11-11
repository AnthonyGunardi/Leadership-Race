import { randomBytes, randomUUID } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { getEnv } from '../config/environment.js';
import { sealCommandSecret, openCommandSecret } from '../services/commandSecrets.js';

vi.mock('../config/environment.js', () => ({ getEnv: vi.fn() }));
let environment;
const receipt = { id: randomUUID(), gameId: randomUUID(), actorUserId: randomUUID(), requestHash: 'a'.repeat(64) };

beforeEach(() => {
  environment = { CONTROLLER_RECEIPT_KEY_ID: 'v1', CONTROLLER_RECEIPT_KEYS: { v1: randomBytes(32).toString('hex') } };
  getEnv.mockImplementation(() => environment);
});

it('round-trips the exact credential with fresh nonces and retains old keys across rotation', () => {
  const secret = { controllerLeaseToken: randomBytes(32).toString('hex') };
  const sealed = sealCommandSecret(secret, receipt);
  const another = sealCommandSecret(secret, receipt);
  expect(JSON.stringify(sealed)).not.toContain(secret.controllerLeaseToken);
  expect(sealed.responseSecretNonce).not.toBe(another.responseSecretNonce);
  environment.CONTROLLER_RECEIPT_KEY_ID = 'v2';
  environment.CONTROLLER_RECEIPT_KEYS.v2 = randomBytes(32).toString('hex');
  expect(openCommandSecret({ ...receipt, ...sealed })).toEqual(secret);
  expect(sealCommandSecret(secret, receipt).responseSecretKeyId).toBe('v2');
});

it('rejects altered ciphertext and ciphertext copied to another actor, game or intent', () => {
  const sealed = sealCommandSecret({ controllerLeaseToken: randomBytes(32).toString('hex') }, receipt);
  const encrypted = Buffer.from(sealed.responseSecretCiphertext, 'base64');
  encrypted[0] ^= 1;
  expect(() => openCommandSecret({ ...receipt, ...sealed, responseSecretCiphertext: encrypted.toString('base64') }))
    .toThrow();
  for (const field of ['id', 'gameId', 'actorUserId', 'requestHash']) {
    expect(() => openCommandSecret({ ...receipt, ...sealed, [field]: randomUUID() })).toThrow();
  }
});

it('fails closed if the active or retained receipt key is unavailable', () => {
  const secret = { controllerLeaseToken: randomBytes(32).toString('hex') };
  const sealed = sealCommandSecret(secret, receipt);
  environment.CONTROLLER_RECEIPT_KEYS = {};
  expect(() => sealCommandSecret(secret, receipt)).toThrow('Kunci receipt controller belum tersedia');
  expect(() => openCommandSecret({ ...receipt, ...sealed })).toThrow('Kunci receipt controller belum tersedia');
});
