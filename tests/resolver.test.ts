/**
 * DG Domain Core - Resolution Engine Tests
 * Copyright (c) 2026 Deep Group
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ResolutionEngine } from '../src/resolver/resolver.ts';
import { RegistryService } from '../src/registry/registryService.ts';
import { createInMemoryDatabase } from '../src/db/database.ts';

describe('Resolution Engine', () => {
  let db: any;
  let registry: RegistryService;
  let resolver: ResolutionEngine;

  beforeEach(() => {
    db = createInMemoryDatabase();
    registry = new RegistryService(db);
    resolver = new ResolutionEngine(db);

    // Seed test domain
    registry.registerDomain({
      name: 'deepgroup.dg',
      registrantId: 'dg-core',
      records: [
        { name: '@', type: 'A', value: '10.0.0.1', ttl: 300 },
        { name: 'api', type: 'A', value: '10.0.0.2', ttl: 300 },
        { name: 'www', type: 'CNAME', value: 'deepgroup.dg', ttl: 300 },
        { name: '@', type: 'TXT', value: 'v=spf1 include:_spf.deepgroup.dg ~all', ttl: 300 },
        { name: '@', type: 'MX', value: 'mail.deepgroup.dg', priority: 10, ttl: 300 },
      ],
    });
  });

  test('resolves apex A record', async () => {
    const res = await resolver.resolve('deepgroup.dg', 'A');
    assert.equal(res.status, 'NOERROR');
    assert.equal(res.statusCode, 0);
    assert.equal(res.answers.length, 1);
    assert.equal(res.answers[0].data, '10.0.0.1');
    assert.equal(res.authoritative, true);
    assert.match(res.disclaimer, /PROTOTYPE NAMESPACE NOTICE/);
  });

  test('resolves subdomain record', async () => {
    const res = await resolver.resolve('api.deepgroup.dg', 'A');
    assert.equal(res.status, 'NOERROR');
    assert.equal(res.answers.length, 1);
    assert.equal(res.answers[0].data, '10.0.0.2');
  });

  test('performs CNAME canonical name recursion', async () => {
    const res = await resolver.resolve('www.deepgroup.dg', 'A');
    assert.equal(res.status, 'NOERROR');
    // Should have both CNAME and chased A record
    assert.ok(res.answers.length >= 2);
    const cnameAns = res.answers.find((a) => a.type === 'CNAME');
    const aAns = res.answers.find((a) => a.type === 'A');
    assert.equal(cnameAns?.data, 'deepgroup.dg');
    assert.equal(aAns?.data, '10.0.0.1');
  });

  test('resolves MX and TXT records', async () => {
    const mxRes = await resolver.resolve('deepgroup.dg', 'MX');
    assert.equal(mxRes.status, 'NOERROR');
    assert.equal(mxRes.answers[0].data, 'mail.deepgroup.dg');
    assert.equal(mxRes.answers[0].priority, 10);

    const txtRes = await resolver.resolve('deepgroup.dg', 'TXT');
    assert.equal(txtRes.status, 'NOERROR');
    assert.match(txtRes.answers[0].data, /v=spf1/);
  });

  test('returns NXDOMAIN for unregistered .dg domain', async () => {
    const res = await resolver.resolve('nonexistent-domain.dg', 'A');
    assert.equal(res.status, 'NXDOMAIN');
    assert.equal(res.statusCode, 3);
    assert.equal(res.answers.length, 0);
  });

  test('refuses queries outside prototype .dg namespace', async () => {
    const res = await resolver.resolve('google.com', 'A');
    assert.equal(res.status, 'REFUSED');
    assert.equal(res.statusCode, 5);
    assert.equal(res.answers.length, 0);
    assert.match(res.disclaimer, /outside \.dg private namespace/);
  });

  test('handles resolution TTL caching correctly', async () => {
    resolver.clearCache();
    const first = await resolver.resolve('deepgroup.dg', 'A');
    assert.equal(first.cached, false);

    const second = await resolver.resolve('deepgroup.dg', 'A');
    assert.equal(second.cached, true);
    assert.equal(second.answers[0].data, '10.0.0.1');
  });

  test('produces RFC 8484 compliant DoH JSON payload', async () => {
    const doh = await resolver.resolveDoH('deepgroup.dg', 1); // 1 = A record
    assert.equal(doh.Status, 0);
    assert.equal(doh.TC, false);
    assert.equal(doh.RD, true);
    assert.equal(doh.Question[0].name, 'deepgroup.dg.');
    assert.equal(doh.Question[0].type, 1);
    assert.ok(doh.Answer && doh.Answer.length > 0);
    assert.equal(doh.Answer[0].data, '10.0.0.1');
    assert.match(doh.Comment || '', /PROTOTYPE NAMESPACE NOTICE/);
  });
});
