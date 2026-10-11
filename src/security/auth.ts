/**
 * DG Domain Core - Security & Authentication Utilities
 * Copyright (c) 2026 Deep Group
 *
 * Implements cryptographically secure token generation, SHA-256 hashing,
 * constant-time comparison to prevent timing attacks, and admin authorization.
 */

import crypto from 'node:crypto';

const SALT = process.env.DG_TOKEN_SALT || 'dg_domain_core_salt_2026_prototype';
export const DEV_DEFAULT_ADMIN_SECRET = 'dg_admin_dev_secret_key_884920';

/**
 * Resolves the effective admin secret.
 * In production (NODE_ENV=production), rejects missing, empty, or default secrets.
 */
export function getEffectiveAdminSecret(): string | null {
  const isProd = process.env.NODE_ENV === 'production';
  const configured = process.env.DG_ADMIN_SECRET?.trim();

  if (isProd) {
    if (!configured || configured === '' || configured === DEV_DEFAULT_ADMIN_SECRET) {
      console.error(
        '[SECURITY ERROR] Production mode requires a dedicated, non-default DG_ADMIN_SECRET. Default dev secret is strictly refused.'
      );
      return null;
    }
    return configured;
  }

  return configured && configured !== '' ? configured : DEV_DEFAULT_ADMIN_SECRET;
}

/**
 * Generates an unguessable registrant authorization token.
 * Format: dg_sec_<random-base64url>
 */
export function generateAuthToken(): string {
  const bytes = crypto.randomBytes(24);
  return `dg_sec_${bytes.toString('base64url')}`;
}

/**
 * Computes a secure SHA-256 hash for storage in the registry database.
 * Never stores raw authorization tokens in plaintext.
 */
export function hashAuthToken(token: string): string {
  return crypto
    .createHmac('sha256', SALT)
    .update(token.trim())
    .digest('hex');
}

/**
 * Constant-time comparison to prevent timing attack side-channels.
 */
export function verifyAuthToken(rawToken: string, storedHash: string): boolean {
  if (!rawToken || !storedHash) return false;
  const computedHash = hashAuthToken(rawToken);

  try {
    const computedBuf = Buffer.from(computedHash, 'hex');
    const storedBuf = Buffer.from(storedHash, 'hex');

    if (computedBuf.length !== storedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(computedBuf, storedBuf);
  } catch {
    return false;
  }
}

/**
 * Verifies master registry administrator credentials.
 * Refuses authorization if running in production without a valid, non-default secret.
 */
export function verifyAdminKey(candidateKey?: string): boolean {
  if (!candidateKey) return false;
  const adminSecret = getEffectiveAdminSecret();
  if (!adminSecret) return false;

  const candidate = candidateKey.trim();

  try {
    const a = Buffer.from(candidate);
    const b = Buffer.from(adminSecret);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
