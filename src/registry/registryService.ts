/**
 * DG Domain Core - Domain Registry Service
 * Copyright (c) 2026 Deep Group
 *
 * Implements authoritative domain registration, availability checks,
 * duplicate prevention, record management, and RDAP-aligned profile queries.
 */

import {
  DomainEntity,
  DomainPublicProfile,
  DomainStatus,
  RegisterDomainInput,
  RegistrationResult,
  AvailabilityResult,
  RecordInput,
  ResourceRecord,
  HostingConnectionInput,
  HostingConnectionResult,
  HostingStatusResult,
  HostingRecordType,
} from '../core/types.ts';
import {
  validateDomainName,
  validateRecordValue,
  validateHostingDestination,
  validateTtl,
  normalizeDomain,
  PROTOTYPE_DISCLAIMER,
} from '../core/naming.ts';
import { generateAuthToken, hashAuthToken, verifyAuthToken, verifyAdminKey } from '../security/auth.ts';
import { RegistryDatabase, getDatabase } from '../db/database.ts';

export class RegistryService {
  private dbManager: RegistryDatabase;

  constructor(dbManager?: RegistryDatabase) {
    this.dbManager = dbManager || getDatabase();
  }

  /**
   * Checks domain availability against syntax rules, reserved list, and active registrations.
   */
  public checkAvailability(rawName: string): AvailabilityResult {
    const validation = validateDomainName(rawName);

    if (validation.valid === false) {
      return {
        name: normalizeDomain(rawName),
        available: false,
        reason: validation.error,
        disclaimer: PROTOTYPE_DISCLAIMER,
      };
    }

    const normalized = validation.normalizedName;
    const stmt = this.dbManager.db.prepare('SELECT name, status FROM domains WHERE name = ?');
    const existing = stmt.get(normalized) as { name: string; status: string } | undefined;

    if (existing) {
      return {
        name: normalized,
        available: false,
        reason: `Domain '${normalized}' is already registered (Status: ${existing.status}).`,
        disclaimer: PROTOTYPE_DISCLAIMER,
      };
    }

    return {
      name: normalized,
      available: true,
      disclaimer: PROTOTYPE_DISCLAIMER,
    };
  }

  /**
   * Registers a domain name in the .dg prototype namespace.
   * Enforces syntax validation, duplicate prevention, and generates secure credentials.
   */
  public registerDomain(input: RegisterDomainInput, clientIp?: string): RegistrationResult {
    if (!input || !input.name) {
      throw new Error('Domain name is required.');
    }

    if (!input.registrantId || input.registrantId.trim().length === 0) {
      throw new Error('Registrant identifier is required.');
    }

    const validation = validateDomainName(input.name);
    if (validation.valid === false) {
      throw new Error(validation.error);
    }

    const normalized = validation.normalizedName;

    // Validate any initial records provided
    const recordsToInsert: RecordInput[] = [];
    if (input.records && Array.isArray(input.records)) {
      for (const rec of input.records) {
        if (!rec.type || !rec.value) {
          throw new Error('Record type and value are required.');
        }
        const valCheck = validateRecordValue(rec.type, rec.value);
        if (!valCheck.valid) {
          throw new Error(valCheck.error || 'Invalid record configuration.');
        }
        const recordName = (rec.name || '@').trim();
        recordsToInsert.push({
          name: recordName === '' ? '@' : recordName,
          type: rec.type,
          value: rec.value.trim(),
          ttl: Math.max(30, rec.ttl || 300),
          priority: rec.type === 'MX' ? rec.priority ?? 10 : null,
        });
      }
    }

    // Default record if none specified: apex A record pointing to standard prototype loopback / demo IP
    if (recordsToInsert.length === 0) {
      recordsToInsert.push({
        name: '@',
        type: 'A',
        value: '127.0.0.1',
        ttl: 300,
        priority: null,
      });
      recordsToInsert.push({
        name: '@',
        type: 'TXT',
        value: `heritage=deep-group; namespace=dg; name=${normalized}`,
        ttl: 300,
        priority: null,
      });
    }

    const rawAuthToken = generateAuthToken();
    const tokenHash = hashAuthToken(rawAuthToken);
    const now = Date.now();
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;
    const expiresAt = now + oneYearMs;

    return this.dbManager.transaction(() => {
      // Duplicate prevention check
      const checkStmt = this.dbManager.db.prepare('SELECT name FROM domains WHERE name = ?');
      const existing = checkStmt.get(normalized);
      if (existing) {
        const error = new Error(`Domain '${normalized}' is already registered. Duplicate registrations are prohibited.`);
        (error as any).statusCode = 409;
        throw error;
      }

      // Insert domain record
      const insertDomainStmt = this.dbManager.db.prepare(`
        INSERT INTO domains (name, registrant_id, auth_token_hash, status, registered_at, updated_at, expires_at)
        VALUES (?, ?, ?, 'active', ?, ?, ?)
      `);
      insertDomainStmt.run(normalized, input.registrantId.trim(), tokenHash, now, now, expiresAt);

      // Insert DNS resource records
      const insertRecordStmt = this.dbManager.db.prepare(`
        INSERT INTO records (domain_name, name, type, value, ttl, priority, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const insertedRecords: ResourceRecord[] = [];
      for (const rec of recordsToInsert) {
        insertRecordStmt.run(
          normalized,
          rec.name,
          rec.type,
          rec.value,
          rec.ttl || 300,
          rec.priority ?? null,
          now
        );
        insertedRecords.push({
          domainName: normalized,
          name: rec.name,
          type: rec.type,
          value: rec.value,
          ttl: rec.ttl || 300,
          priority: rec.priority ?? null,
          createdAt: now,
        });
      }

      // Record audit log
      const auditStmt = this.dbManager.db.prepare(`
        INSERT INTO audit_logs (domain_name, action, client_ip, timestamp, details)
        VALUES (?, 'REGISTER', ?, ?, ?)
      `);
      auditStmt.run(
        normalized,
        clientIp || '127.0.0.1',
        now,
        JSON.stringify({ registrantId: input.registrantId, recordCount: insertedRecords.length })
      );

      return {
        name: normalized,
        registrantId: input.registrantId.trim(),
        authToken: rawAuthToken,
        status: 'active',
        registeredAt: new Date(now).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
        records: insertedRecords,
        disclaimer: PROTOTYPE_DISCLAIMER,
      };
    });
  }

  /**
   * Fetches public domain registration details and records.
   */
  public getDomain(rawName: string): DomainPublicProfile | null {
    const normalized = normalizeDomain(rawName);
    const domainStmt = this.dbManager.db.prepare(
      'SELECT name, registrant_id, status, registered_at, updated_at, expires_at FROM domains WHERE name = ?'
    );
    const row = domainStmt.get(normalized) as
      | {
          name: string;
          registrant_id: string;
          status: DomainStatus;
          registered_at: number;
          updated_at: number;
          expires_at: number;
        }
      | undefined;

    if (!row) {
      return null;
    }

    const recordsStmt = this.dbManager.db.prepare(
      'SELECT name, type, value, ttl, priority, created_at FROM records WHERE domain_name = ? ORDER BY type, name'
    );
    const rawRecords = recordsStmt.all(normalized) as Array<{
      name: string;
      type: string;
      value: string;
      ttl: number;
      priority: number | null;
      created_at: number;
    }>;

    return {
      name: row.name,
      registrantId: row.registrant_id,
      status: row.status,
      registeredAt: new Date(row.registered_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
      records: rawRecords.map((r) => ({
        name: r.name,
        type: r.type as any,
        value: r.value,
        ttl: r.ttl,
        priority: r.priority,
        createdAt: r.created_at,
      })),
      disclaimer: PROTOTYPE_DISCLAIMER,
    };
  }

  /**
   * Updates domain DNS resource records with authorization token check.
   */
  public updateRecords(
    rawName: string,
    authToken: string,
    records: RecordInput[],
    clientIp?: string
  ): { success: boolean; records: ResourceRecord[] } {
    const normalized = normalizeDomain(rawName);

    const getDomainStmt = this.dbManager.db.prepare(
      'SELECT name, auth_token_hash, status FROM domains WHERE name = ?'
    );
    const domain = getDomainStmt.get(normalized) as
      | { name: string; auth_token_hash: string; status: DomainStatus }
      | undefined;

    if (!domain) {
      const error = new Error(`Domain '${normalized}' was not found in registry.`);
      (error as any).statusCode = 404;
      throw error;
    }

    if (domain.status === 'locked' || domain.status === 'suspended') {
      const error = new Error(`Domain '${normalized}' is ${domain.status} and cannot be modified.`);
      (error as any).statusCode = 403;
      throw error;
    }

    if (!verifyAuthToken(authToken, domain.auth_token_hash)) {
      const error = new Error('Invalid authorization token for domain record updates.');
      (error as any).statusCode = 401;
      throw error;
    }

    // Validate incoming records
    if (!Array.isArray(records)) {
      const error = new Error('Records payload must be an array.');
      (error as any).statusCode = 400;
      throw error;
    }

    const validatedRecords: RecordInput[] = [];
    for (const rec of records) {
      if (!rec.type || !rec.value) {
        const error = new Error('Every record requires a type and value.');
        (error as any).statusCode = 400;
        throw error;
      }
      const valCheck = validateRecordValue(rec.type, rec.value);
      if (!valCheck.valid) {
        const error = new Error(valCheck.error || 'Invalid record configuration.');
        (error as any).statusCode = 400;
        throw error;
      }
      const ttlCheck = validateTtl(rec.ttl);
      if (!ttlCheck.valid) {
        const error = new Error(`Record '${rec.name}' error: ${ttlCheck.error}`);
        (error as any).statusCode = 400;
        throw error;
      }
      const name = (rec.name || '@').trim();
      validatedRecords.push({
        name: name === '' ? '@' : name,
        type: rec.type,
        value: rec.value.trim(),
        ttl: ttlCheck.value,
        priority: rec.type === 'MX' ? rec.priority ?? 10 : null,
      });
    }

    // Validate CNAME exclusivity (RFC 1034): CNAME cannot coexist with other types on the same label
    const labelTypes = new Map<string, Set<string>>();
    for (const rec of validatedRecords) {
      if (!labelTypes.has(rec.name)) {
        labelTypes.set(rec.name, new Set());
      }
      labelTypes.get(rec.name)!.add(rec.type);
    }
    for (const [label, types] of labelTypes.entries()) {
      if (types.has('CNAME') && types.size > 1) {
        const error = new Error(
          `Record conflict: CNAME on label '${label}' cannot coexist with other record types (${Array.from(types).join(', ')}). RFC 1034 requires CNAME exclusivity.`
        );
        (error as any).statusCode = 400;
        throw error;
      }
    }

    const now = Date.now();

    return this.dbManager.transaction(() => {
      // Remove existing records
      const deleteStmt = this.dbManager.db.prepare('DELETE FROM records WHERE domain_name = ?');
      deleteStmt.run(normalized);

      // Insert new records
      const insertStmt = this.dbManager.db.prepare(`
        INSERT INTO records (domain_name, name, type, value, ttl, priority, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const inserted: ResourceRecord[] = [];
      for (const rec of validatedRecords) {
        insertStmt.run(
          normalized,
          rec.name,
          rec.type,
          rec.value,
          rec.ttl || 300,
          rec.priority ?? null,
          now
        );
        inserted.push({
          domainName: normalized,
          name: rec.name,
          type: rec.type,
          value: rec.value,
          ttl: rec.ttl || 300,
          priority: rec.priority ?? null,
          createdAt: now,
        });
      }

      // Update domain updated_at timestamp
      const updateDomainStmt = this.dbManager.db.prepare(
        'UPDATE domains SET updated_at = ? WHERE name = ?'
      );
      updateDomainStmt.run(now, normalized);

      // Log action
      const auditStmt = this.dbManager.db.prepare(`
        INSERT INTO audit_logs (domain_name, action, client_ip, timestamp, details)
        VALUES (?, 'UPDATE_RECORDS', ?, ?, ?)
      `);
      auditStmt.run(
        normalized,
        clientIp || '127.0.0.1',
        now,
        JSON.stringify({ recordCount: inserted.length })
      );

      return {
        success: true,
        records: inserted,
      };
    });
  }

  /**
   * Administrative status change (lock, suspend, active).
   */
  public updateStatus(
    rawName: string,
    adminKey: string,
    newStatus: DomainStatus,
    clientIp?: string
  ): { success: boolean; name: string; status: DomainStatus } {
    if (!verifyAdminKey(adminKey)) {
      const error = new Error('Unauthorized: Invalid administrator key.');
      (error as any).statusCode = 401;
      throw error;
    }

    if (!['active', 'suspended', 'locked'].includes(newStatus)) {
      const error = new Error(`Invalid status '${newStatus}'. Must be active, suspended, or locked.`);
      (error as any).statusCode = 400;
      throw error;
    }

    const normalized = normalizeDomain(rawName);
    const domainStmt = this.dbManager.db.prepare('SELECT name FROM domains WHERE name = ?');
    const domain = domainStmt.get(normalized);

    if (!domain) {
      const error = new Error(`Domain '${normalized}' was not found in registry.`);
      (error as any).statusCode = 404;
      throw error;
    }

    const now = Date.now();
    const updateStmt = this.dbManager.db.prepare(
      'UPDATE domains SET status = ?, updated_at = ? WHERE name = ?'
    );
    updateStmt.run(newStatus, now, normalized);

    const auditStmt = this.dbManager.db.prepare(`
      INSERT INTO audit_logs (domain_name, action, client_ip, timestamp, details)
      VALUES (?, 'STATUS_CHANGE', ?, ?, ?)
    `);
    auditStmt.run(
      normalized,
      clientIp || '127.0.0.1',
      now,
      JSON.stringify({ newStatus })
    );

    return {
      success: true,
      name: normalized,
      status: newStatus,
    };
  }

  /**
   * Retrieves all registered domains for inspection and admin explorer.
   */
  public listDomains(limit = 100, offset = 0): DomainEntity[] {
    const stmt = this.dbManager.db.prepare(`
      SELECT name, registrant_id, auth_token_hash, status, registered_at, updated_at, expires_at
      FROM domains
      ORDER BY registered_at DESC
      LIMIT ? OFFSET ?
    `);
    const rows = stmt.all(limit, offset) as Array<{
      name: string;
      registrant_id: string;
      auth_token_hash: string;
      status: DomainStatus;
      registered_at: number;
      updated_at: number;
      expires_at: number;
    }>;

    return rows.map((r) => ({
      name: r.name,
      registrantId: r.registrant_id,
      authTokenHash: r.auth_token_hash,
      status: r.status,
      registeredAt: r.registered_at,
      updatedAt: r.updated_at,
      expiresAt: r.expires_at,
    }));
  }

  /**
   * Returns registry statistics.
   */
  public getStats(): { totalDomains: number; activeDomains: number; totalRecords: number } {
    const totalDomainsRow = this.dbManager.db
      .prepare('SELECT COUNT(*) as count FROM domains')
      .get() as { count: number };
    const activeDomainsRow = this.dbManager.db
      .prepare("SELECT COUNT(*) as count FROM domains WHERE status = 'active'")
      .get() as { count: number };
    const totalRecordsRow = this.dbManager.db
      .prepare('SELECT COUNT(*) as count FROM records')
      .get() as { count: number };

    return {
      totalDomains: totalDomainsRow.count,
      activeDomains: activeDomainsRow.count,
      totalRecords: totalRecordsRow.count,
    };
  }

  /**
   * Connects domain or subdomain to an external hosting provider.
   * Validates destination format (A IPv4 or CNAME host).
   * Enforces CNAME exclusivity on the target label while PRESERVING other
   * non-conflicting records (e.g. MX, TXT, other subdomains).
   */
  public connectHosting(
    rawName: string,
    authToken: string,
    input: HostingConnectionInput,
    clientIp?: string
  ): HostingConnectionResult {
    const normalized = normalizeDomain(rawName);

    const getDomainStmt = this.dbManager.db.prepare(
      'SELECT name, auth_token_hash, status FROM domains WHERE name = ?'
    );
    const domain = getDomainStmt.get(normalized) as
      | { name: string; auth_token_hash: string; status: DomainStatus }
      | undefined;

    if (!domain) {
      const error = new Error(`Domain '${normalized}' was not found in registry.`);
      (error as any).statusCode = 404;
      throw error;
    }

    if (domain.status === 'locked' || domain.status === 'suspended') {
      const error = new Error(`Domain '${normalized}' is ${domain.status} and cannot be modified.`);
      (error as any).statusCode = 403;
      throw error;
    }

    if (!verifyAuthToken(authToken, domain.auth_token_hash)) {
      const error = new Error('Invalid authorization token for domain record updates.');
      (error as any).statusCode = 401;
      throw error;
    }

    if (!input || !input.type || !input.destination) {
      const error = new Error("Hosting configuration requires 'type' ('A', 'AAAA', or 'CNAME') and 'destination'.");
      (error as any).statusCode = 400;
      throw error;
    }

    if (input.type !== 'A' && input.type !== 'AAAA' && input.type !== 'CNAME') {
      const error = new Error(`Invalid hosting record type '${input.type}'. Supported types: 'A', 'AAAA', and 'CNAME'.`);
      (error as any).statusCode = 400;
      throw error;
    }

    const subdomainLabel = (input.subdomain || '@').trim();
    const targetLabel = subdomainLabel === '' ? '@' : subdomainLabel;
    const sourceFqdn = targetLabel === '@' ? normalized : `${targetLabel}.${normalized}`;

    // Validate real destination (no 0.0.0.0, no IP in CNAME, no self-loop)
    const destCheck = validateHostingDestination(input.type, input.destination, sourceFqdn);
    if (!destCheck.valid) {
      const error = new Error(destCheck.error || 'Invalid hosting destination.');
      (error as any).statusCode = 400;
      throw error;
    }

    // Validate TTL
    const ttlCheck = validateTtl(input.ttl);
    if (!ttlCheck.valid) {
      const error = new Error(ttlCheck.error || 'Invalid TTL value.');
      (error as any).statusCode = 400;
      throw error;
    }

    const targetDestination = input.destination.trim();
    const ttl = ttlCheck.value;
    const provider = (input.provider || 'custom').trim();
    const now = Date.now();

    return this.dbManager.transaction(() => {
      // Conflict resolution on targetLabel:
      // Replace existing address/alias records (A, AAAA, CNAME) on this target label,
      // while preserving all other record types (MX, TXT, NS) and other subdomains
      const deleteConflictStmt = this.dbManager.db.prepare(`
        DELETE FROM records WHERE domain_name = ? AND name = ? AND type IN ('A', 'AAAA', 'CNAME')
      `);
      deleteConflictStmt.run(normalized, targetLabel);

      // Insert new hosting record
      const insertStmt = this.dbManager.db.prepare(`
        INSERT INTO records (domain_name, name, type, value, ttl, priority, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, ?)
      `);
      insertStmt.run(normalized, targetLabel, input.type, targetDestination, ttl, now);

      // Update updated_at on domains
      const updateDomainStmt = this.dbManager.db.prepare(
        'UPDATE domains SET updated_at = ? WHERE name = ?'
      );
      updateDomainStmt.run(now, normalized);

      // Log action
      const auditStmt = this.dbManager.db.prepare(`
        INSERT INTO audit_logs (domain_name, action, client_ip, timestamp, details)
        VALUES (?, 'CONNECT_HOSTING', ?, ?, ?)
      `);
      auditStmt.run(
        normalized,
        clientIp || '127.0.0.1',
        now,
        JSON.stringify({
          subdomain: targetLabel,
          type: input.type,
          destination: targetDestination,
          provider,
          isPublicRoutable: destCheck.isPublicRoutable,
          isPrivateAddress: destCheck.isPrivateAddress,
        })
      );

      // Fetch all active records for domain
      const recordsStmt = this.dbManager.db.prepare(
        'SELECT domain_name as domainName, name, type, value, ttl, priority, created_at as createdAt FROM records WHERE domain_name = ? ORDER BY type, name'
      );
      const allRecords = recordsStmt.all(normalized) as unknown as ResourceRecord[];

      return {
        success: true,
        domain: normalized,
        subdomain: targetLabel,
        type: input.type,
        destination: targetDestination,
        provider,
        isPublicRoutable: destCheck.isPublicRoutable,
        isPrivateAddress: destCheck.isPrivateAddress,
        activeRecords: allRecords,
        disclaimer: PROTOTYPE_DISCLAIMER,
      };
    });
  }

  /**
   * Retrieves hosting destinations for a domain.
   */
  public getHostingStatus(rawName: string): HostingStatusResult | null {
    const normalized = normalizeDomain(rawName);
    const domainStmt = this.dbManager.db.prepare(
      'SELECT name, status FROM domains WHERE name = ?'
    );
    const domain = domainStmt.get(normalized) as { name: string; status: DomainStatus } | undefined;

    if (!domain) {
      return null;
    }

    const recordsStmt = this.dbManager.db.prepare(
      'SELECT domain_name as domainName, name, type, value, ttl, priority, created_at as createdAt FROM records WHERE domain_name = ?'
    );
    const records = recordsStmt.all(normalized) as unknown as ResourceRecord[];

    const hostingDestinations = records
      .filter((r) => r.type === 'A' || r.type === 'AAAA' || r.type === 'CNAME')
      .map((r) => ({
        subdomain: r.name,
        type: r.type as HostingRecordType,
        destination: r.value,
        ttl: r.ttl,
      }));

    const preservedRecords = records
      .filter((r) => r.type !== 'A' && r.type !== 'AAAA' && r.type !== 'CNAME')
      .map((r) => ({
        name: r.name,
        type: r.type,
        value: r.value,
      }));

    return {
      domain: domain.name,
      status: domain.status,
      hostingDestinations,
      preservedRecords,
      disclaimer: PROTOTYPE_DISCLAIMER,
    };
  }
}

let defaultRegistryService: RegistryService | null = null;

export function getRegistryService(dbManager?: RegistryDatabase): RegistryService {
  if (!defaultRegistryService) {
    defaultRegistryService = new RegistryService(dbManager);
  }
  return defaultRegistryService;
}
