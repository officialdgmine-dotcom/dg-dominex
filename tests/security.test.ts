/**
 * DG Domain Core - Security & Rate Limiting Tests
 * Copyright (c) 2026 Deep Group
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateAuthToken,
  hashAuthToken,
  verifyAuthToken,
  verifyAdminKey,
} from '../src/security/auth.ts';
import { RateLimiter } from '../src/security/rateLimiter.ts';

describe('Security & Authentication Mechanics', () => {
  test('generates unique, well-formed authorization tokens', () => {
    const token1 = generateAuthToken();
    const token2 = generateAuthToken();

    assert.ok(token1.startsWith('dg_sec_'));
    assert.ok(token2.startsWith('dg_sec_'));
    assert.notEqual(token1, token2, 'Generated tokens must be distinct');
    assert.ok(token1.length >= 32, 'Token must contain sufficient entropy');
  });

  test('hashes tokens deterministically with SHA-256', () => {
    const token = 'dg_sec_test_token_12345';
    const hash1 = hashAuthToken(token);
    const hash2 = hashAuthToken(token);

    assert.equal(hash1, hash2);
    assert.equal(hash1.length, 64, 'SHA-256 hex string must be 64 characters');
  });

  test('verifies tokens with timing-safe comparison', () => {
    const token = generateAuthToken();
    const hash = hashAuthToken(token);

    // Valid token
    assert.equal(verifyAuthToken(token, hash), true);

    // Tampered token
    assert.equal(verifyAuthToken(`${token}_tampered`, hash), false);

    // Completely wrong token
    assert.equal(verifyAuthToken('dg_sec_wrong', hash), false);

    // Empty or malformed inputs
    assert.equal(verifyAuthToken('', hash), false);
    assert.equal(verifyAuthToken(token, ''), false);
  });

  test('verifies administrator keys correctly', () => {
    const validSecret = process.env.DG_ADMIN_SECRET || 'dg_admin_dev_secret_key_884920';
    assert.equal(verifyAdminKey(validSecret), true);
    assert.equal(verifyAdminKey('wrong-admin-key'), false);
    assert.equal(verifyAdminKey(''), false);
    assert.equal(verifyAdminKey(undefined), false);
  });

  test('strictly refuses default or empty admin secrets in production', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalSecret = process.env.DG_ADMIN_SECRET;

    try {
      process.env.NODE_ENV = 'production';

      // Case 1: Unset secret in production -> must be refused
      delete process.env.DG_ADMIN_SECRET;
      assert.equal(verifyAdminKey('dg_admin_dev_secret_key_884920'), false);

      // Case 2: Empty secret in production -> must be refused
      process.env.DG_ADMIN_SECRET = '   ';
      assert.equal(verifyAdminKey('dg_admin_dev_secret_key_884920'), false);

      // Case 3: Insecure default secret explicitly passed as DG_ADMIN_SECRET -> must be refused
      process.env.DG_ADMIN_SECRET = 'dg_admin_dev_secret_key_884920';
      assert.equal(verifyAdminKey('dg_admin_dev_secret_key_884920'), false);

      // Case 4: Proper dedicated production secret -> accepted
      process.env.DG_ADMIN_SECRET = 'prod_super_secure_vault_token_991823';
      assert.equal(verifyAdminKey('prod_super_secure_vault_token_991823'), true);
      assert.equal(verifyAdminKey('wrong-token'), false);
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalSecret !== undefined) {
        process.env.DG_ADMIN_SECRET = originalSecret;
      } else {
        delete process.env.DG_ADMIN_SECRET;
      }
    }
  });

  test('enforces sliding window rate limits', () => {
    // 5 requests per 1000ms window
    const limiter = new RateLimiter(1000, 5);
    const ip = '192.168.10.42';

    // First 5 requests must pass
    for (let i = 0; i < 5; i++) {
      const check = limiter.check(ip);
      assert.equal(check.allowed, true);
    }

    // 6th request must be rejected
    const blocked = limiter.check(ip);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
    assert.ok(blocked.resetMs > 0);

    limiter.destroy();
  });
});
