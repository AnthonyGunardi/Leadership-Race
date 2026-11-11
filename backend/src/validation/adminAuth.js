import { z } from 'zod';

const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Invalid email address')
    .max(254, 'Email must not exceed 254 characters'),
  password: z
    .string({ required_error: 'Password is required' })
    .min(8, 'Password must be at least 8 characters long')
    .refine(
      (val) => Buffer.byteLength(val, 'utf8') <= 72,
      { message: 'Password cannot exceed 72 bytes in UTF-8' }
    )
}).strict({ message: 'Unrecognized fields in login request' });

/**
 * Validates external login request payloads strictly.
 *
 * @param {unknown} payload
 * @returns {{ email: string, password: string }}
 * @throws {z.ZodError} If payload fails validation
 */
export function validateLoginPayload(payload) {
  return loginSchema.parse(payload);
}

