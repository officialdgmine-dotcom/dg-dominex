/**
 * DG Domain Core - Hosting Connection Tests
 * Copyright (c) 2026 Deep Group
 *
 * Verifies external hosting provider connection readiness:
 * - A record configuration (real provider IPs)
 * - CNAME record configuration (external host targets)
 * - CNAME exclusivity and record conflict handling
 * - Preservation of non-conflicting MX and TXT records
 * - Authorization enforcement and invalid destination rejection
 * - Resolution engine behavior for external hosting targets
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { RegistryService } from '../src/registry/registryService.ts';
import { ResolutionEngine } from '../src/resolver/resolver.ts';
import { RegistryDatabase, createInMemoryDatabase } from '../src/db/database.ts';

describe('Hosting Connection Readiness', () => {
  let db: any;
  let registry: RegistryService;
  let resolver: ResolutionEngine;
  let registeredDomain: any;

  beforeEach(() => {
    db = createInMemoryDatabase();
    registry = new RegistryService(db);
    resolver = new ResolutionEngine(db);

    // Register a test domain with initial records (A, MX, TXT)
    registeredDomain = registry.registerDomain({
      name: 'hosting-test.dg',
      registrantId: 'customer-entity-01',
      records: [
        { name: '@', type: 'A', value: '10.0.0.1', ttl: 300 },
        { name: '@', type: 'MX', value: 'mail.hosting-test.dg', priority: 10, ttl: 300 },
        { name: '@', type: 'TXT', value: 'v=spf1 include:_spf.hosting-test.dg ~all', ttl: 300 },
      ],
    });
  });

  test('configures external hosting IPv4 destination and preserves MX & TXT records', async () => {
    // Connect apex @ to GitHub Pages real IP
    const githubPagesIp = '185.199.108.153';
    const result = registry.connectHosting(
      'hosting-test.dg',
      registeredDomain.authToken,
      {
        subdomain: '@',
        type: 'A',
        destination: githubPagesIp,
        provider: 'github_pages',
        ttl: 600,
      }
    );

    assert.equal(result.success, true);
    assert.equal(result.domain, 'hosting-test.dg');
    assert.equal(result.subdomain, '@');
    assert.equal(result.type, 'A');
    assert.equal(result.destination, githubPagesIp);

    // Verify apex A record is updated
    const apexA = result.activeRecords.find((r) => r.name === '@' && r.type === 'A');
    assert.equal(apexA?.value, githubPagesIp);
    assert.equal(apexA?.ttl, 600);

    // CRITICAL: Verify MX and TXT records are preserved
    const mxRecord = result.activeRecords.find((r) => r.name === '@' && r.type === 'MX');
    assert.ok(mxRecord !== undefined, 'MX record must be preserved');
    assert.equal(mxRecord?.value, 'mail.hosting-test.dg');

    const txtRecord = result.activeRecords.find((r) => r.name === '@' && r.type === 'TXT');
    assert.ok(txtRecord !== undefined, 'TXT record must be preserved');

    // Test Resolution of new hosting destination
    resolver.clearCache();
    const resolved = await resolver.resolve('hosting-test.dg', 'A');
    assert.equal(resolved.status, 'NOERROR');
    assert.equal(resolved.answers[0].data, githubPagesIp);
  });

  test('configures external hosting CNAME destination for www and resolves authoritatively', async () => {
    // Point www to Vercel external canonical target
    const vercelTarget = 'cname.vercel-dns.com';
    const result = registry.connectHosting(
      'hosting-test.dg',
      registeredDomain.authToken,
      {
        subdomain: 'www',
        type: 'CNAME',
        destination: vercelTarget,
        provider: 'vercel',
      }
    );

    assert.equal(result.success, true);
    assert.equal(result.subdomain, 'www');
    assert.equal(result.destination, vercelTarget);

    // Verify resolver authoritatively returns CNAME with NOERROR
    resolver.clearCache();
    const resolved = await resolver.resolve('www.hosting-test.dg', 'A');
    assert.equal(resolved.status, 'NOERROR');
    assert.equal(resolved.answers.length, 1);
    assert.equal(resolved.answers[0].type, 'CNAME');
    assert.equal(resolved.answers[0].data, vercelTarget);
    assert.match(resolved.disclaimer, /external host/i);
  });

  test('resolves record conflicts: CNAME replaces conflicting A on same label', () => {
    // 1. Add A record on 'app'
    registry.connectHosting('hosting-test.dg', registeredDomain.authToken, {
      subdomain: 'app',
      type: 'A',
      destination: '192.0.2.1',
    });

    // 2. Now connect CNAME on 'app' -> should remove conflicting A on 'app'
    const result = registry.connectHosting('hosting-test.dg', registeredDomain.authToken, {
      subdomain: 'app',
      type: 'CNAME',
      destination: 'd123456.cloudfront.net',
    });

    const appRecords = result.activeRecords.filter((r) => r.name === 'app');
    assert.equal(appRecords.length, 1);
    assert.equal(appRecords[0].type, 'CNAME');
    assert.equal(appRecords[0].value, 'd123456.cloudfront.net');
  });

  test('rejects invalid hosting destinations (0.0.0.0, IP in CNAME, self-loop)', () => {
    // 1. Rejects 0.0.0.0
    assert.throws(
      () => {
        registry.connectHosting('hosting-test.dg', registeredDomain.authToken, {
          subdomain: '@',
          type: 'A',
          destination: '0.0.0.0',
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /0\.0\.0\.0/);
        return true;
      }
    );

    // 2. Rejects IP address in CNAME
    assert.throws(
      () => {
        registry.connectHosting('hosting-test.dg', registeredDomain.authToken, {
          subdomain: 'www',
          type: 'CNAME',
          destination: '185.199.108.153',
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /cannot be an IP address/);
        return true;
      }
    );

    // 3. Rejects self-referencing circular loop
    assert.throws(
      () => {
        registry.connectHosting('hosting-test.dg', registeredDomain.authToken, {
          subdomain: 'www',
          type: 'CNAME',
          destination: 'www.hosting-test.dg',
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Self-referencing loop/);
        return true;
      }
    );
  });

  test('enforces authorization token for hosting connection', () => {
    assert.throws(
      () => {
        registry.connectHosting('hosting-test.dg', 'invalid-auth-token', {
          subdomain: '@',
          type: 'A',
          destination: '185.199.108.153',
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 401);
        assert.match(err.message, /Invalid authorization token/);
        return true;
      }
    );
  });

  test('rejects CNAME conflict in raw batch update (RFC 1034)', () => {
    // Submitting both A and CNAME on same label in updateRecords must fail
    assert.throws(
      () => {
        registry.updateRecords('hosting-test.dg', registeredDomain.authToken, [
          { name: 'web', type: 'A', value: '1.2.3.4' },
          { name: 'web', type: 'CNAME', value: 'target.example.com' },
        ]);
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /exclusivity/);
        return true;
      }
    );
  });

  test('reports hosting status correctly with preserved non-web records', () => {
    registry.connectHosting('hosting-test.dg', registeredDomain.authToken, {
      subdomain: '@',
      type: 'A',
      destination: '198.51.100.50',
      provider: 'custom',
    });

    registry.connectHosting('hosting-test.dg', registeredDomain.authToken, {
      subdomain: 'www',
      type: 'CNAME',
      destination: 'cname.vercel-dns.com',
      provider: 'vercel',
    });

    const status = registry.getHostingStatus('hosting-test.dg');
    assert.ok(status !== null);
    assert.equal(status?.domain, 'hosting-test.dg');
    assert.equal(status?.hostingDestinations.length, 2);

    // Preserved non-A/CNAME records
    assert.ok(status?.preservedRecords.some((r) => r.type === 'MX'));
    assert.ok(status?.preservedRecords.some((r) => r.type === 'TXT'));
  });

  test('configures external hosting IPv6 (AAAA) destination and resolves authoritatively', async () => {
    const cloudflareIpv6 = '2606:4700:3033::6815:1506';
    const result = registry.connectHosting(
      'hosting-test.dg',
      registeredDomain.authToken,
      {
        subdomain: '@',
        type: 'AAAA',
        destination: cloudflareIpv6,
        provider: 'cloudflare',
        ttl: 300,
      }
    );

    assert.equal(result.success, true);
    assert.equal(result.type, 'AAAA');
    assert.equal(result.destination, cloudflareIpv6);
    assert.equal(result.isPublicRoutable, true);

    // Verify resolver authoritatively returns AAAA record
    resolver.clearCache();
    const resolved = await resolver.resolve('hosting-test.dg', 'AAAA');
    assert.equal(resolved.status, 'NOERROR');
    assert.equal(resolved.answers.length, 1);
    assert.equal(resolved.answers[0].type, 'AAAA');
    assert.equal(resolved.answers[0].data, cloudflareIpv6);
  });

  test('resolves record conflicts: A record replaces existing CNAME on same label', () => {
    // 1. Connect CNAME on 'shop'
    registry.connectHosting('hosting-test.dg', registeredDomain.authToken, {
      subdomain: 'shop',
      type: 'CNAME',
      destination: 'shops.myshopify.com',
    });

    // 2. Connect A record on 'shop' -> should replace CNAME
    const result = registry.connectHosting('hosting-test.dg', registeredDomain.authToken, {
      subdomain: 'shop',
      type: 'A',
      destination: '23.227.38.65',
    });

    const shopRecords = result.activeRecords.filter((r) => r.name === 'shop');
    assert.equal(shopRecords.length, 1);
    assert.equal(shopRecords[0].type, 'A');
    assert.equal(shopRecords[0].value, '23.227.38.65');
  });

  test('rejects invalid IP addresses (out-of-range, non-numeric, broadcast, unspecified ::, malformed IPv6)', () => {
    const invalidIps = [
      { type: 'A' as const, ip: '999.999.999.999' },
      { type: 'A' as const, ip: '256.1.2.3' },
      { type: 'A' as const, ip: '255.255.255.255' }, // broadcast
      { type: 'A' as const, ip: 'not-an-ip' },
      { type: 'AAAA' as const, ip: '::' }, // unspecified
      { type: 'AAAA' as const, ip: '2001:xyz::1' }, // invalid hex
      { type: 'AAAA' as const, ip: '12345::1' }, // 5 hex digits in block
    ];

    for (const item of invalidIps) {
      assert.throws(
        () => {
          registry.connectHosting('hosting-test.dg', registeredDomain.authToken, {
            subdomain: '@',
            type: item.type,
            destination: item.ip,
          });
        },
        (err: any) => {
          assert.equal(err.statusCode, 400);
          return true;
        }
      );
    }
  });

  test('rejects invalid CNAME targets (special characters, bad syntax, empty string)', () => {
    const invalidCnames = [
      'invalid..hostname',
      'invalid_target!.com',
      '-leading-hyphen.com',
      'trailing-hyphen-.com',
      '',
    ];

    for (const target of invalidCnames) {
      assert.throws(
        () => {
          registry.connectHosting('hosting-test.dg', registeredDomain.authToken, {
            subdomain: 'www',
            type: 'CNAME',
            destination: target,
          });
        },
        (err: any) => {
          assert.equal(err.statusCode, 400);
          return true;
        }
      );
    }
  });

  test('validates TTL parameter boundaries', () => {
    // Rejects TTL < 30s
    assert.throws(
      () => {
        registry.connectHosting('hosting-test.dg', registeredDomain.authToken, {
          subdomain: '@',
          type: 'A',
          destination: '185.199.108.153',
          ttl: 10,
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /TTL cannot be less than 30/);
        return true;
      }
    );

    // Rejects TTL > 604800s
    assert.throws(
      () => {
        registry.connectHosting('hosting-test.dg', registeredDomain.authToken, {
          subdomain: '@',
          type: 'A',
          destination: '185.199.108.153',
          ttl: 1000000,
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /TTL cannot exceed/);
        return true;
      }
    );
  });

  test('rejects unauthorized updates and cross-domain token reuse', () => {
    // Register another domain to obtain a distinct token
    const domain2 = registry.registerDomain({
      name: 'other-domain.dg',
      registrantId: 'other-user',
      records: [{ name: '@', type: 'A', value: '10.0.0.2' }],
    });

    // Attempt to use domain2's token to update hosting-test.dg
    assert.throws(
      () => {
        registry.connectHosting('hosting-test.dg', domain2.authToken, {
          subdomain: '@',
          type: 'A',
          destination: '185.199.108.153',
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 401);
        assert.match(err.message, /Invalid authorization token/);
        return true;
      }
    );

    // Attempt with empty token
    assert.throws(
      () => {
        registry.connectHosting('hosting-test.dg', '', {
          subdomain: '@',
          type: 'A',
          destination: '185.199.108.153',
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 401);
        return true;
      }
    );
  });

  test('enforces administrative status locks preventing hosting record modification', () => {
    const adminKey = process.env.DG_ADMIN_SECRET || 'dg_admin_dev_secret_key_884920';

    // Lock domain
    registry.updateStatus('hosting-test.dg', adminKey, 'locked');

    assert.throws(
      () => {
        registry.connectHosting('hosting-test.dg', registeredDomain.authToken, {
          subdomain: '@',
          type: 'A',
          destination: '185.199.108.153',
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /locked/);
        return true;
      }
    );

    // Suspend domain
    registry.updateStatus('hosting-test.dg', adminKey, 'suspended');

    assert.throws(
      () => {
        registry.connectHosting('hosting-test.dg', registeredDomain.authToken, {
          subdomain: '@',
          type: 'A',
          destination: '185.199.108.153',
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /suspended/);
        return true;
      }
    );

    // Unlock back to active
    registry.updateStatus('hosting-test.dg', adminKey, 'active');

    const result = registry.connectHosting('hosting-test.dg', registeredDomain.authToken, {
      subdomain: '@',
      type: 'A',
      destination: '185.199.108.153',
    });
    assert.equal(result.success, true);
  });

  test('persists hosting configuration across database close and reopen', async () => {
    const tempDbPath = path.join(
      os.tmpdir(),
      `dg_persist_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`
    );

    try {
      // 1. Initialize disk database
      const diskDb = new RegistryDatabase(tempDbPath);
      const diskRegistry = new RegistryService(diskDb);
      const diskResolver = new ResolutionEngine(diskDb);

      // 2. Register domain and connect external hosting
      const reg = diskRegistry.registerDomain({
        name: 'persist-domain.dg',
        registrantId: 'persistent-registrant',
        records: [
          { name: '@', type: 'MX', value: 'mail.persist-domain.dg', priority: 10, ttl: 300 },
        ],
      });

      diskRegistry.connectHosting('persist-domain.dg', reg.authToken, {
        subdomain: '@',
        type: 'A',
        destination: '185.199.108.153',
        provider: 'github_pages',
        ttl: 600,
      });

      diskRegistry.connectHosting('persist-domain.dg', reg.authToken, {
        subdomain: 'www',
        type: 'CNAME',
        destination: 'cname.vercel-dns.com',
        provider: 'vercel',
        ttl: 600,
      });

      // 3. Close the database
      diskDb.close();

      // 4. Reopen with a fresh database instance pointing to the same file
      const reopenedDb = new RegistryDatabase(tempDbPath);
      const reopenedRegistry = new RegistryService(reopenedDb);
      const reopenedResolver = new ResolutionEngine(reopenedDb);

      // 5. Verify domain and hosting records are intact
      const status = reopenedRegistry.getHostingStatus('persist-domain.dg');
      assert.ok(status !== null);
      assert.equal(status?.domain, 'persist-domain.dg');
      assert.equal(status?.hostingDestinations.length, 2);

      const aRecord = status?.hostingDestinations.find((d) => d.subdomain === '@' && d.type === 'A');
      assert.equal(aRecord?.destination, '185.199.108.153');

      const cnameRecord = status?.hostingDestinations.find((d) => d.subdomain === 'www' && d.type === 'CNAME');
      assert.equal(cnameRecord?.destination, 'cname.vercel-dns.com');

      // Verify MX record was preserved across close/reopen
      assert.ok(
        status?.preservedRecords.some(
          (r) => r.type === 'MX' && r.value === 'mail.persist-domain.dg'
        )
      );

      // 6. Verify resolver functions authoritatively after reopening
      const resolvedA = await reopenedResolver.resolve('persist-domain.dg', 'A');
      assert.equal(resolvedA.status, 'NOERROR');
      assert.equal(resolvedA.answers[0].data, '185.199.108.153');

      const resolvedCname = await reopenedResolver.resolve('www.persist-domain.dg', 'A');
      assert.equal(resolvedCname.status, 'NOERROR');
      assert.equal(resolvedCname.answers[0].data, 'cname.vercel-dns.com');

      reopenedDb.close();
    } finally {
      // Cleanup temporary database file and any WAL/SHM files
      if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
      if (fs.existsSync(`${tempDbPath}-wal`)) fs.unlinkSync(`${tempDbPath}-wal`);
      if (fs.existsSync(`${tempDbPath}-shm`)) fs.unlinkSync(`${tempDbPath}-shm`);
    }
  });
});
