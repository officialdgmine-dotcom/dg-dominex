/**
 * DG Domain Core - Registry Service Tests
 * Copyright (c) 2026 Deep Group
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { RegistryService } from '../src/registry/registryService.ts';
import { createInMemoryDatabase } from '../src/db/database.ts';

describe('Domain Registry Service', () => {
  let registry: RegistryService;

  beforeEach(() => {
    // Isolated in-memory database for each test
    const testDb = createInMemoryDatabase();
    registry = new RegistryService(testDb);
  });

  test('checks availability correctly', () => {
    const availBefore = registry.checkAvailability('deepgroup.dg');
    assert.equal(availBefore.available, true);
    assert.equal(availBefore.name, 'deepgroup.dg');

    // Reserved domain check
    const reservedCheck = registry.checkAvailability('whois.dg');
    assert.equal(reservedCheck.available, false);
    assert.match(reservedCheck.reason || '', /reserved/i);

    // Register domain
    registry.registerDomain({
      name: 'deepgroup.dg',
      registrantId: 'dg-org-001',
    });

    // Check availability after registration
    const availAfter = registry.checkAvailability('deepgroup.dg');
    assert.equal(availAfter.available, false);
    assert.match(availAfter.reason || '', /already registered/i);

    // Case-insensitive availability check
    const availUpper = registry.checkAvailability('DeepGroup.DG');
    assert.equal(availUpper.available, false);
  });

  test('registers domain with unguessable auth token and default records', () => {
    const regResult = registry.registerDomain({
      name: 'ai.dg',
      registrantId: 'deep-group-ai',
    });

    assert.equal(regResult.name, 'ai.dg');
    assert.equal(regResult.registrantId, 'deep-group-ai');
    assert.equal(regResult.status, 'active');
    assert.ok(regResult.authToken.startsWith('dg_sec_'), 'Token should match format dg_sec_*');
    assert.ok(regResult.records.length >= 1, 'Default records should be created');

    const profile = registry.getDomain('ai.dg');
    assert.ok(profile !== null);
    assert.equal(profile?.name, 'ai.dg');
    assert.equal(profile?.registrantId, 'deep-group-ai');
    // Ensure auth token hash is never leaked in public profile
    assert.equal((profile as any).authTokenHash, undefined);
    assert.equal((profile as any).authToken, undefined);
  });

  test('prevents duplicate domain registration', () => {
    registry.registerDomain({
      name: 'mail.dg',
      registrantId: 'user-1',
    });

    // Exact duplicate attempt
    assert.throws(
      () => {
        registry.registerDomain({
          name: 'mail.dg',
          registrantId: 'user-2',
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 409);
        assert.match(err.message, /already registered/);
        return true;
      }
    );

    // Casing variation duplicate attempt
    assert.throws(
      () => {
        registry.registerDomain({
          name: 'MAIL.DG',
          registrantId: 'user-3',
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 409);
        return true;
      }
    );
  });

  test('enforces authorization for record updates', () => {
    const reg = registry.registerDomain({
      name: 'cloud.dg',
      registrantId: 'cloud-team',
      records: [{ name: '@', type: 'A', value: '1.2.3.4', ttl: 300 }],
    });

    // Unauthorized attempt with wrong token
    assert.throws(
      () => {
        registry.updateRecords('cloud.dg', 'invalid-token-123', [
          { name: '@', type: 'A', value: '5.6.7.8', ttl: 300 },
        ]);
      },
      (err: any) => {
        assert.equal(err.statusCode, 401);
        assert.match(err.message, /Invalid authorization token/);
        return true;
      }
    );

    // Authorized update with legitimate token
    const updateRes = registry.updateRecords('cloud.dg', reg.authToken, [
      { name: '@', type: 'A', value: '5.6.7.8', ttl: 600 },
      { name: 'api', type: 'A', value: '5.6.7.9', ttl: 600 },
    ]);

    assert.equal(updateRes.success, true);
    assert.equal(updateRes.records.length, 2);

    const updatedProfile = registry.getDomain('cloud.dg');
    const aRecord = updatedProfile?.records.find((r) => r.name === '@' && r.type === 'A');
    assert.equal(aRecord?.value, '5.6.7.8');
    assert.equal(aRecord?.ttl, 600);
  });

  test('enforces administrative status lock and prevents modification', () => {
    const adminKey = process.env.DG_ADMIN_SECRET || 'dg_admin_dev_secret_key_884920';
    const reg = registry.registerDomain({
      name: 'secure.dg',
      registrantId: 'security-team',
    });

    // Admin locks domain
    const lockRes = registry.updateStatus('secure.dg', adminKey, 'locked');
    assert.equal(lockRes.status, 'locked');

    // Attempting record update on locked domain must fail with 403
    assert.throws(
      () => {
        registry.updateRecords('secure.dg', reg.authToken, [
          { name: '@', type: 'A', value: '9.9.9.9', ttl: 300 },
        ]);
      },
      (err: any) => {
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /locked/);
        return true;
      }
    );
  });
});
