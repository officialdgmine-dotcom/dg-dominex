/**
 * DG Domain Core - Naming Convention Tests
 * Copyright (c) 2026 Deep Group
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateDomainName,
  normalizeDomain,
  validateRecordValue,
  RESERVED_DOMAINS,
  PROTOTYPE_TLD,
} from '../src/core/naming.ts';

describe('Naming Conventions & Policy Rules', () => {
  test('normalizes casing, whitespace, and trailing dots', () => {
    assert.equal(normalizeDomain('  DeepGroup.DG.  '), 'deepgroup.dg');
    assert.equal(normalizeDomain('AI.dg'), 'ai.dg');
    assert.equal(normalizeDomain('mail.dg.'), 'mail.dg');
  });

  test('accepts valid prototype domains', () => {
    const validNames = [
      'deepgroup.dg',
      'ai.dg',
      'mail.dg',
      'a.dg',
      'infra-123.dg',
      'cloud.deepgroup.dg',
      'alpha-beta.dg',
    ];

    for (const name of validNames) {
      const res = validateDomainName(name);
      assert.equal(res.valid, true, `Expected '${name}' to be valid`);
      if (res.valid) {
        assert.equal(res.normalizedName, name.toLowerCase());
      }
    }
  });

  test('rejects non-.dg top-level domains', () => {
    const invalidTlds = ['deepgroup.com', 'ai.org', 'mail.net', 'deepgroup', 'test.io'];
    for (const name of invalidTlds) {
      const res = validateDomainName(name);
      assert.equal(res.valid, false, `Expected '${name}' to fail TLD validation`);
      if (!res.valid) {
        assert.equal(res.code, 'INVALID_TLD');
      }
    }
  });

  test('rejects syntax violations (hyphens at boundary, special chars, empty labels)', () => {
    const invalidSyntax = [
      '-deepgroup.dg',
      'deepgroup-.dg',
      'deep_group.dg',
      'deep@group.dg',
      'deep group.dg',
      '..dg',
      'deep..dg',
    ];

    for (const name of invalidSyntax) {
      const res = validateDomainName(name);
      assert.equal(res.valid, false, `Expected '${name}' to be rejected for syntax`);
    }
  });

  test('protects reserved domain names from registration', () => {
    for (const reserved of Array.from(RESERVED_DOMAINS)) {
      const res = validateDomainName(reserved);
      assert.equal(res.valid, false, `Expected reserved name '${reserved}' to be blocked`);
      if (!res.valid) {
        assert.equal(res.code, 'RESERVED_NAME');
      }
    }
  });

  test('enforces label length and total length boundaries', () => {
    const longLabel = `${'a'.repeat(64)}.dg`;
    const resLongLabel = validateDomainName(longLabel);
    assert.equal(resLongLabel.valid, false);

    const valid63 = `${'a'.repeat(63)}.dg`;
    const resValid63 = validateDomainName(valid63);
    assert.equal(resValid63.valid, true);
  });

  test('validates resource record values according to record type', () => {
    // IPv4 (A)
    assert.equal(validateRecordValue('A', '192.168.1.1').valid, true);
    assert.equal(validateRecordValue('A', '256.1.1.1').valid, false);
    assert.equal(validateRecordValue('A', 'invalid-ip').valid, false);

    // IPv6 (AAAA)
    assert.equal(validateRecordValue('AAAA', '2001:0db8:85a3:0000:0000:8a2e:0370:7334').valid, true);
    assert.equal(validateRecordValue('AAAA', '::1').valid, true);
    assert.equal(validateRecordValue('AAAA', '192.168.1.1').valid, false);

    // CNAME host
    assert.equal(validateRecordValue('CNAME', 'deepgroup.dg').valid, true);
    assert.equal(validateRecordValue('CNAME', 'invalid host with spaces').valid, false);

    // MX mail host
    assert.equal(validateRecordValue('MX', 'mail.deepgroup.dg').valid, true);
  });
});
