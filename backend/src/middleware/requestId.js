import crypto from 'crypto';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates whether the given candidate string is a standard, safe UUID format.
 *
 * @param {unknown} value The string candidate to check.
 * @returns {boolean} True if string strictly matches the standard UUID pattern.
 */
export function isValidUuid(value) {
  if (typeof value !== 'string') {
    return false;
  }
  return UUID_V4_REGEX.test(value);
}

/**
 * Express middleware that assigns and propagates a unique X-Request-Id.
 *
 * Constraints:
 * - If client provides an existing, strictly valid UUID, it is preserved.
 * - If header is missing, malformed, or contains invalid characters, a new UUID v4 is generated.
 * - Attaches id to req.id and sets X-Request-Id response header.
 *
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @param {import('express').NextFunction} next Express next callback.
 */
export function requestIdMiddleware(req, res, next) {
  const incomingId = req.headers ? req.headers['x-request-id'] : null;
  const requestId = isValidUuid(incomingId) ? incomingId : crypto.randomUUID();

  req.id = requestId;
  if (res && typeof res.setHeader === 'function') {
    res.setHeader('X-Request-Id', requestId);
  }

  next();
}

