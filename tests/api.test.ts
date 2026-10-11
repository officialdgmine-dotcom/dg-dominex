/**
 * DG Domain Core - REST API Integration Tests
 * Copyright (c) 2026 Deep Group
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { Server } from 'node:http';
import { apiRouter } from '../src/api/routes.ts';
import { createInMemoryDatabase } from '../src/db/database.ts';
import { RegistryService } from '../src/registry/registryService.ts';
import { ResolutionEngine } from '../src/resolver/resolver.ts';

describe('Backend REST API Endpoints', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1', apiRouter);

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address() as any;
        baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
        resolve();
      });
    });
  });

  after(() => {
    if (server) {
      server.close();
    }
  });

  test('GET /health returns system status and ICANN disclaimer', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'healthy');
    assert.equal(body.namespace, '.dg');
    assert.match(body.disclaimer, /PROTOTYPE NAMESPACE NOTICE/);
  });

  test('GET /system/policy returns naming rules and reserved list', async () => {
    const res = await fetch(`${baseUrl}/system/policy`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.conventions.tld, 'dg');
    assert.ok(Array.isArray(body.reservedDomains));
    assert.ok(body.reservedDomains.includes('nic.dg'));
  });

  test('GET /domains/check reports domain availability', async () => {
    const res = await fetch(`${baseUrl}/domains/check?name=new-startup.dg`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.name, 'new-startup.dg');
    assert.equal(typeof body.available, 'boolean');
  });

  const testDomain = `api-test-${Date.now()}.dg`;

  test('POST /domains/register registers domain and issues auth token', async () => {
    const regPayload = {
      name: testDomain,
      registrantId: 'test-user-corp',
      records: [
        { name: '@', type: 'A', value: '192.168.1.100', ttl: 300 },
        { name: 'v1', type: 'A', value: '192.168.1.101', ttl: 300 },
      ],
    };

    const res = await fetch(`${baseUrl}/domains/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(regPayload),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.name, testDomain);
    assert.ok(body.authToken.startsWith('dg_sec_'));
    assert.equal(body.records.length, 2);

    // Duplicate registration should return 409 Conflict
    const dupRes = await fetch(`${baseUrl}/domains/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(regPayload),
    });
    assert.equal(dupRes.status, 409);
    const dupBody = await dupRes.json();
    assert.match(dupBody.error, /already registered/);

    // Record update with invalid token should fail with 401
    const unauthRes = await fetch(`${baseUrl}/domains/${testDomain}/records`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer invalid-token',
      },
      body: JSON.stringify({
        records: [{ name: '@', type: 'A', value: '10.0.0.99', ttl: 300 }],
      }),
    });
    assert.equal(unauthRes.status, 401);

    // Record update with legitimate token should succeed with 200
    const authRes = await fetch(`${baseUrl}/domains/${testDomain}/records`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${body.authToken}`,
      },
      body: JSON.stringify({
        records: [{ name: '@', type: 'A', value: '10.0.0.99', ttl: 600 }],
      }),
    });
    assert.equal(authRes.status, 200);
  });

  test('GET /resolve resolves prototype domain names', async () => {
    const res = await fetch(`${baseUrl}/resolve?name=${testDomain}&type=A`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'NOERROR');
    assert.ok(body.answers.length > 0);
  });

  test('GET /dns-query returns DoH RFC 8484 format', async () => {
    const res = await fetch(`${baseUrl}/dns-query?name=${testDomain}&type=A`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.Status, 0);
    assert.ok(Array.isArray(body.Answer));
  });

  test('GET /resolve returns REFUSED for foreign non-.dg domain', async () => {
    const res = await fetch(`${baseUrl}/resolve?name=example.org&type=A`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'REFUSED');
    assert.equal(body.statusCode, 5);
  });

  test('POST /domains/:name/hosting connects external hosting and preserves other records', async () => {
    const hostDomain = `host-${Date.now()}.dg`;
    const regRes = await fetch(`${baseUrl}/domains/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: hostDomain,
        registrantId: 'host-tester',
        records: [
          { name: '@', type: 'MX', value: `mail.${hostDomain}`, priority: 10, ttl: 300 },
          { name: '@', type: 'TXT', value: 'heritage=deep-group', ttl: 300 },
        ],
      }),
    });
    const regData = await regRes.json();

    const connectRes = await fetch(`${baseUrl}/domains/${hostDomain}/hosting`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${regData.authToken}`,
      },
      body: JSON.stringify({
        subdomain: '@',
        type: 'A',
        destination: '185.199.108.153',
        provider: 'github_pages',
      }),
    });

    assert.equal(connectRes.status, 200);
    const connectData = await connectRes.json();
    assert.equal(connectData.success, true);
    assert.equal(connectData.destination, '185.199.108.153');

    const hasMx = connectData.activeRecords.some((r: any) => r.type === 'MX');
    assert.equal(hasMx, true);

    const getHostRes = await fetch(`${baseUrl}/domains/${hostDomain}/hosting`);
    assert.equal(getHostRes.status, 200);
    const hostStatus = await getHostRes.json();
    assert.equal(hostStatus.hostingDestinations.length, 1);
    assert.equal(hostStatus.hostingDestinations[0].destination, '185.199.108.153');
  });
});
