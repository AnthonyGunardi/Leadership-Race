import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getEnv } from '../config/environment.js';

/** Missing keys fail closed; key IDs allow rotation while retaining old receipts for the game's lifetime. */
function receiptKey(keyId) {
  const value = getEnv().CONTROLLER_RECEIPT_KEYS?.[keyId];
  if (!value) {
    throw Object.assign(new Error('Kunci receipt controller belum tersedia. Hubungi operator server.'), {
      status: 503, code: 'CONTROLLER_UNAVAILABLE'
    });
  }
  return Buffer.from(value, 'hex');
}

/** Binds authenticated ciphertext to its receipt so copying it to another actor/game/intent cannot disclose tokens. */
function receiptContext(receipt) {
  return Buffer.from(JSON.stringify([receipt.id, receipt.gameId, receipt.actorUserId, receipt.requestHash]));
}

/** Fresh 96-bit nonces and a full GCM tag keep replay credentials confidential and authenticated at rest. */
export function sealCommandSecret(secret, receipt) {
  const keyId = getEnv().CONTROLLER_RECEIPT_KEY_ID;
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', receiptKey(keyId), nonce);
  cipher.setAAD(receiptContext(receipt));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(secret), 'utf8'), cipher.final()]);
  return { responseSecretCiphertext: encrypted.toString('base64'), responseSecretNonce: nonce.toString('base64'),
    responseSecretTag: cipher.getAuthTag().toString('base64'), responseSecretKeyId: keyId };
}

/** After scope/actor/hash validation, replay returns the token without renewing or reviving its lease. */
export function openCommandSecret(receipt) {
  const decipher = createDecipheriv('aes-256-gcm', receiptKey(receipt.responseSecretKeyId),
    Buffer.from(receipt.responseSecretNonce, 'base64'));
  decipher.setAAD(receiptContext(receipt));
  decipher.setAuthTag(Buffer.from(receipt.responseSecretTag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(receipt.responseSecretCiphertext, 'base64')),
    decipher.final()]).toString('utf8'));
}
