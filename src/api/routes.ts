/**
 * DG Domain Core - REST API Router
 * Copyright (c) 2026 Deep Group
 *
 * Provides RESTful endpoints for domain registration, availability checks,
 * record lookups, authenticated updates, and DoH/application-level resolution.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { getRegistryService } from '../registry/registryService.ts';
import { getResolutionEngine } from '../resolver/resolver.ts';
import { RecordType, DomainStatus } from '../core/types.ts';
import {
  PROTOTYPE_DISCLAIMER,
  PROTOTYPE_TLD,
  RESERVED_DOMAINS,
  normalizeDomain,
  validateDomainName,
} from '../core/naming.ts';
import { verifyAdminKey } from '../security/auth.ts';
import {
  registrationRateLimiter,
  lookupRateLimiter,
} from '../security/rateLimiter.ts';

export const apiRouter = Router();

// Helper to extract client IP
function getClientIp(req: Request): string {
  // Do not trust client-supplied X-Forwarded-For headers.
  // Use the direct socket address unless a trusted proxy is configured separately.
  return req.socket.remoteAddress || '127.0.0.1';
}

// Helper to extract bearer token
function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const xToken = req.headers['x-auth-token'];
  if (typeof xToken === 'string') {
    return xToken.trim();
  }
  if (req.body && typeof req.body.authToken === 'string') {
    return req.body.authToken.trim();
  }
  return null;
}

// Helper to extract admin key
function extractAdminKey(req: Request): string | null {
  const adminHeader = req.headers['x-admin-key'];
  if (typeof adminHeader === 'string') {
    return adminHeader.trim();
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  if (req.body && typeof req.body.adminKey === 'string') {
    return req.body.adminKey.trim();
  }
  return null;
}

/**
 * GET /api/v1/health
 * System health and service status
 */
apiRouter.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    service: 'DG Domain Core Registry & Resolution Engine',
    version: '1.0.0-prototype',
    namespace: `.${PROTOTYPE_TLD}`,
    disclaimer: PROTOTYPE_DISCLAIMER,
  });
});

/**
 * GET /api/v1/system/policy
 * Naming policy specifications, reserved list, and legal notices
 */
apiRouter.get('/system/policy', (req: Request, res: Response) => {
  res.json({
    namespace: `.${PROTOTYPE_TLD}`,
    conventions: {
      tld: PROTOTYPE_TLD,
      labelAllowedChars: 'a-z, 0-9, hyphen (-)',
      hyphenRule: 'Hyphen cannot be at start or end of any label',
      minTotalLength: 4,
      maxTotalLength: 253,
      maxLabelLength: 63,
      caseSensitivity: 'Case-insensitive (automatically normalized to lowercase)',
      supportedRecordTypes: ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS'],
    },
    reservedDomains: Array.from(RESERVED_DOMAINS),
    disclaimer: PROTOTYPE_DISCLAIMER,
  });
});

/**
 * GET /api/v1/system/stats
 * Registry metrics
 */
apiRouter.get('/system/stats', (req: Request, res: Response) => {
  const registry = getRegistryService();
  const stats = registry.getStats();
  res.json({
    ...stats,
    disclaimer: PROTOTYPE_DISCLAIMER,
  });
});

/**
 * GET /api/v1/system/domains
 * Directory of registered domains for developer inspection
 */
apiRouter.get('/system/domains', (req: Request, res: Response) => {
  const registry = getRegistryService();
  const limit = Math.min(200, parseInt(req.query.limit as string) || 50);
  const offset = parseInt(req.query.offset as string) || 0;
  const domains = registry.listDomains(limit, offset);

  // Redact auth token hashes
  const safeDomains = domains.map((d) => ({
    name: d.name,
    registrantId: d.registrantId,
    status: d.status,
    registeredAt: new Date(d.registeredAt).toISOString(),
    updatedAt: new Date(d.updatedAt).toISOString(),
    expiresAt: new Date(d.expiresAt).toISOString(),
  }));

  res.json({
    count: safeDomains.length,
    domains: safeDomains,
    disclaimer: PROTOTYPE_DISCLAIMER,
  });
});

/**
 * GET /api/v1/domains/check?name=...
 * Domain availability check
 */
apiRouter.get('/domains/check', (req: Request, res: Response) => {
  const clientIp = getClientIp(req);
  const rate = lookupRateLimiter.check(clientIp);
  if (!rate.allowed) {
    res.status(429).json({
      error: 'Rate limit exceeded for domain availability lookups. Please retry in a few moments.',
      resetMs: rate.resetMs,
    });
    return;
  }

  const name = req.query.name;
  if (!name || typeof name !== 'string') {
    res.status(400).json({
      error: "Query parameter 'name' is required (e.g. /api/v1/domains/check?name=deepgroup.dg)",
    });
    return;
  }

  const registry = getRegistryService();
  const result = registry.checkAvailability(name);
  res.json(result);
});

/**
 * POST /api/v1/domains/register
 * Register domain in prototype namespace
 */
apiRouter.post('/domains/register', (req: Request, res: Response) => {
  const clientIp = getClientIp(req);
  const rate = registrationRateLimiter.check(clientIp);
  if (!rate.allowed) {
    res.status(429).json({
      error: 'Rate limit exceeded for registrations. Please wait before registering additional domains.',
      resetMs: rate.resetMs,
    });
    return;
  }

  const { name, registrantId, records } = req.body || {};

  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: "Field 'name' is required and must be a string." });
    return;
  }

  if (!registrantId || typeof registrantId !== 'string') {
    res.status(400).json({ error: "Field 'registrantId' is required and must be a string." });
    return;
  }

  const registry = getRegistryService();
  try {
    const result = registry.registerDomain({ name, registrantId, records }, clientIp);
    res.status(201).json(result);
  } catch (err: any) {
    const statusCode = err.statusCode || 400;
    res.status(statusCode).json({
      error: err.message || 'Registration failed',
      name: normalizeDomain(name),
    });
  }
});

/**
 * GET /api/v1/domains/:name
 * Lookup domain metadata and resource records (RDAP-aligned)
 */
apiRouter.get('/domains/:name', (req: Request, res: Response) => {
  const clientIp = getClientIp(req);
  const rate = lookupRateLimiter.check(clientIp);
  if (!rate.allowed) {
    res.status(429).json({
      error: 'Rate limit exceeded for lookups.',
      resetMs: rate.resetMs,
    });
    return;
  }

  const name = req.params.name;
  const registry = getRegistryService();
  const domain = registry.getDomain(name);

  if (!domain) {
    res.status(404).json({
      error: `Domain '${normalizeDomain(name)}' not found in registry.`,
      disclaimer: PROTOTYPE_DISCLAIMER,
    });
    return;
  }

  res.json(domain);
});

/**
 * PUT /api/v1/domains/:name/records
 * Update resource records with Bearer token authorization
 */
apiRouter.put('/domains/:name/records', (req: Request, res: Response) => {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({
      error: 'Authorization token required. Provide via Authorization: Bearer <token> or X-Auth-Token header.',
    });
    return;
  }

  const { records } = req.body || {};
  if (!records || !Array.isArray(records)) {
    res.status(400).json({
      error: "Field 'records' must be an array of resource record definitions.",
    });
    return;
  }

  const clientIp = getClientIp(req);
  const registry = getRegistryService();

  try {
    const result = registry.updateRecords(req.params.name, token, records, clientIp);
    // Flush resolver cache for this domain
    const resolver = getResolutionEngine();
    resolver.clearCache();
    res.json({
      ...result,
      message: `Records updated successfully for ${normalizeDomain(req.params.name)}.`,
    });
  } catch (err: any) {
    const statusCode = err.statusCode || 400;
    res.status(statusCode).json({
      error: err.message || 'Record update failed.',
    });
  }
});

/**
 * POST /api/v1/domains/:name/hosting
 * Connect domain or subdomain to external hosting provider destination.
 * Validates destination IP/hostname, enforces CNAME exclusivity, preserves MX/TXT.
 */
apiRouter.post('/domains/:name/hosting', (req: Request, res: Response) => {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({
      error: 'Authorization token required. Provide via Authorization: Bearer <token> or X-Auth-Token header.',
    });
    return;
  }

  const { subdomain, type, destination, provider, ttl } = req.body || {};
  if (!type || !destination) {
    res.status(400).json({
      error: "Fields 'type' ('A', 'AAAA', or 'CNAME') and 'destination' are required.",
    });
    return;
  }

  const clientIp = getClientIp(req);
  const registry = getRegistryService();

  try {
    const result = registry.connectHosting(
      req.params.name,
      token,
      { subdomain, type, destination, provider, ttl },
      clientIp
    );
    const resolver = getResolutionEngine();
    resolver.clearCache();
    res.json(result);
  } catch (err: any) {
    const statusCode = err.statusCode || 400;
    res.status(statusCode).json({
      error: err.message || 'Hosting connection failed.',
    });
  }
});

/**
 * GET /api/v1/domains/:name/hosting
 * Get current external hosting configuration and preserved records.
 */
apiRouter.get('/domains/:name/hosting', (req: Request, res: Response) => {
  const registry = getRegistryService();
  const status = registry.getHostingStatus(req.params.name);

  if (!status) {
    res.status(404).json({
      error: `Domain '${normalizeDomain(req.params.name)}' not found in registry.`,
      disclaimer: PROTOTYPE_DISCLAIMER,
    });
    return;
  }

  res.json(status);
});

/**
 * PATCH /api/v1/domains/:name/status
 * Administrative lock/suspension management
 */
apiRouter.patch('/domains/:name/status', (req: Request, res: Response) => {
  const adminKey = extractAdminKey(req);
  if (!adminKey) {
    res.status(401).json({
      error: 'Administrator authentication required via X-Admin-Key or Bearer token.',
    });
    return;
  }

  const { status } = req.body || {};
  if (!status || !['active', 'suspended', 'locked'].includes(status)) {
    res.status(400).json({
      error: "Valid 'status' ('active', 'suspended', 'locked') is required.",
    });
    return;
  }

  const clientIp = getClientIp(req);
  const registry = getRegistryService();

  try {
    const result = registry.updateStatus(req.params.name, adminKey, status as DomainStatus, clientIp);
    const resolver = getResolutionEngine();
    resolver.clearCache();
    res.json(result);
  } catch (err: any) {
    const statusCode = err.statusCode || 400;
    res.status(statusCode).json({
      error: err.message || 'Status update failed.',
    });
  }
});

/**
 * GET /api/v1/resolve?name=...&type=...
 * Application-level name resolver endpoint
 */
apiRouter.get('/resolve', async (req: Request, res: Response) => {
  const name = req.query.name;
  if (!name || typeof name !== 'string') {
    res.status(400).json({
      error: "Query parameter 'name' is required (e.g. /api/v1/resolve?name=deepgroup.dg&type=A)",
    });
    return;
  }

  const rawType = (req.query.type as string) || 'A';
  const validTypes: RecordType[] = ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS'];
  const recordType = rawType.toUpperCase() as RecordType;

  if (!validTypes.includes(recordType)) {
    res.status(400).json({
      error: `Unsupported record type '${rawType}'. Supported types: ${validTypes.join(', ')}`,
    });
    return;
  }

  const resolver = getResolutionEngine();
  const result = await resolver.resolve(name, recordType);
  res.json(result);
});

/**
 * GET /api/v1/dns-query?name=...&type=...
 * RFC 8484 DNS-over-HTTPS (DoH) JSON endpoint
 */
apiRouter.get('/dns-query', async (req: Request, res: Response) => {
  const name = req.query.name;
  if (!name || typeof name !== 'string') {
    res.status(400).json({
      error: "Query parameter 'name' is required.",
    });
    return;
  }

  const rawType = req.query.type as string;
  let numericType = 1; // Default A
  if (rawType) {
    if (/^\d+$/.test(rawType)) {
      numericType = parseInt(rawType, 10);
    } else {
      const typeUpper = rawType.toUpperCase();
      const map: Record<string, number> = { A: 1, NS: 2, CNAME: 5, MX: 15, TXT: 16, AAAA: 28 };
      numericType = map[typeUpper] || 1;
    }
  }

  const resolver = getResolutionEngine();
  const dohResponse = await resolver.resolveDoH(name, numericType);
  res.setHeader('Content-Type', 'application/dns-json');
  res.json(dohResponse);
});
