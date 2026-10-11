/**
 * DG Domain Core - Prototype Resolution Engine
 * Copyright (c) 2026 Deep Group
 *
 * Implements authoritative application-level name resolution for the .dg namespace,
 * CNAME canonical chasing, in-memory TTL caching, and RFC 8484 DoH JSON responses.
 */

import {
  RecordType,
  ResolutionResult,
  ResolutionAnswer,
  DoHResponse,
} from '../core/types.ts';
import { normalizeDomain, PROTOTYPE_DISCLAIMER } from '../core/naming.ts';
import { RegistryDatabase, getDatabase } from '../db/database.ts';

// Standard DNS Type numbers (RFC 1035 / RFC 3596)
const DNS_TYPE_MAP: Record<RecordType, number> = {
  A: 1,
  NS: 2,
  CNAME: 5,
  MX: 15,
  TXT: 16,
  AAAA: 28,
};

const DNS_NUMBER_TO_TYPE: Record<number, RecordType> = {
  1: 'A',
  2: 'NS',
  5: 'CNAME',
  15: 'MX',
  16: 'TXT',
  28: 'AAAA',
};

interface CacheEntry {
  result: ResolutionResult;
  expiresAt: number;
}

export class ResolutionEngine {
  private dbManager: RegistryDatabase;
  private cache: Map<string, CacheEntry> = new Map();

  constructor(dbManager?: RegistryDatabase) {
    this.dbManager = dbManager || getDatabase();
  }

  /**
   * Primary resolver interface.
   * Resolves a prototype domain query to its configured resource records.
   */
  public async resolve(
    rawQueryName: string,
    requestedType: RecordType = 'A',
    depth = 0
  ): Promise<ResolutionResult> {
    const startTime = performance.now();
    const normalizedQuery = normalizeDomain(rawQueryName);
    const cacheKey = `${normalizedQuery}:${requestedType}`;

    // Check TTL Cache
    const cached = this.cache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      const execTime = performance.now() - startTime;
      return {
        ...cached.result,
        cached: true,
        executionTimeMs: Math.round(execTime * 100) / 100,
      };
    }

    // Namespace validation: strictly enforce .dg prototype boundary
    if (!normalizedQuery.endsWith('.dg')) {
      const execTime = performance.now() - startTime;
      return {
        question: { name: normalizedQuery, type: requestedType },
        status: 'REFUSED',
        statusCode: 5, // DNS REFUSED
        answers: [],
        cached: false,
        authoritative: false,
        executionTimeMs: Math.round(execTime * 100) / 100,
        disclaimer: `${PROTOTYPE_DISCLAIMER} (Refused: query is outside .dg private namespace)`,
      };
    }

    // Deconstruct query into registered domain and record label
    const zoneMatch = this.findAuthoritativeZone(normalizedQuery);
    if (!zoneMatch) {
      const execTime = performance.now() - startTime;
      return {
        question: { name: normalizedQuery, type: requestedType },
        status: 'NXDOMAIN',
        statusCode: 3, // DNS NXDOMAIN
        answers: [],
        cached: false,
        authoritative: true,
        executionTimeMs: Math.round(execTime * 100) / 100,
        disclaimer: PROTOTYPE_DISCLAIMER,
      };
    }

    const { domainName, recordLabel, status } = zoneMatch;

    if (status !== 'active') {
      const execTime = performance.now() - startTime;
      return {
        question: { name: normalizedQuery, type: requestedType },
        status: 'REFUSED',
        statusCode: 5,
        answers: [],
        cached: false,
        authoritative: true,
        executionTimeMs: Math.round(execTime * 100) / 100,
        disclaimer: `${PROTOTYPE_DISCLAIMER} (Domain status is ${status})`,
      };
    }

    // Direct match query
    const answers = this.fetchRecords(domainName, recordLabel, requestedType, normalizedQuery);

    // If requested A or AAAA and no direct answers, check for CNAME
    if (answers.length === 0 && (requestedType === 'A' || requestedType === 'AAAA')) {
      const cnameRecords = this.fetchRecords(domainName, recordLabel, 'CNAME', normalizedQuery);

      if (cnameRecords.length > 0 && depth < 5) {
        // CNAME found: chase canonical name
        const cnameTarget = cnameRecords[0].data;

        // If the CNAME target is an external host (outside .dg namespace, e.g. cname.vercel-dns.com, github.io),
        // return the authoritative CNAME record answer with NOERROR.
        if (!cnameTarget.endsWith('.dg')) {
          const execTime = performance.now() - startTime;
          const result: ResolutionResult = {
            question: { name: normalizedQuery, type: requestedType },
            status: 'NOERROR',
            statusCode: 0,
            answers: cnameRecords,
            cached: false,
            authoritative: true,
            executionTimeMs: Math.round(execTime * 100) / 100,
            disclaimer: `${PROTOTYPE_DISCLAIMER} (Resolves via CNAME to external host '${cnameTarget}')`,
          };

          this.cacheResult(cacheKey, result);
          return result;
        }

        const targetResolution = await this.resolve(cnameTarget, requestedType, depth + 1);

        const chainedAnswers: ResolutionAnswer[] = [
          ...cnameRecords,
          ...targetResolution.answers,
        ];

        const execTime = performance.now() - startTime;
        const result: ResolutionResult = {
          question: { name: normalizedQuery, type: requestedType },
          status: targetResolution.status,
          statusCode: targetResolution.statusCode,
          answers: chainedAnswers,
          cached: false,
          authoritative: true,
          executionTimeMs: Math.round(execTime * 100) / 100,
          disclaimer: PROTOTYPE_DISCLAIMER,
        };

        this.cacheResult(cacheKey, result);
        return result;
      }
    }

    const execTime = performance.now() - startTime;
    const result: ResolutionResult = {
      question: { name: normalizedQuery, type: requestedType },
      status: answers.length > 0 ? 'NOERROR' : 'NXDOMAIN',
      statusCode: answers.length > 0 ? 0 : 3,
      answers,
      cached: false,
      authoritative: true,
      executionTimeMs: Math.round(execTime * 100) / 100,
      disclaimer: PROTOTYPE_DISCLAIMER,
    };

    if (answers.length > 0) {
      this.cacheResult(cacheKey, result);
    }

    return result;
  }

  /**
   * RFC 8484 compatible DNS-over-HTTPS (DoH) JSON formatter.
   */
  public async resolveDoH(rawQueryName: string, numericType = 1): Promise<DoHResponse> {
    const recordType = DNS_NUMBER_TO_TYPE[numericType] || 'A';
    const res = await this.resolve(rawQueryName, recordType);

    const questionEntry = {
      name: res.question.name.endsWith('.') ? res.question.name : `${res.question.name}.`,
      type: numericType,
    };

    const answerEntries = res.answers.map((ans) => ({
      name: ans.name.endsWith('.') ? ans.name : `${ans.name}.`,
      type: DNS_TYPE_MAP[ans.type] || 1,
      TTL: ans.TTL,
      data: ans.priority !== undefined && ans.priority !== null ? `${ans.priority} ${ans.data}` : ans.data,
    }));

    return {
      Status: res.statusCode,
      TC: false,
      RD: true,
      RA: true,
      AD: false,
      CD: false,
      Question: [questionEntry],
      Answer: answerEntries.length > 0 ? answerEntries : undefined,
      Comment: res.disclaimer,
    };
  }

  /**
   * Locates the authoritative domain zone and computes the relative record label.
   */
  private findAuthoritativeZone(query: string): {
    domainName: string;
    recordLabel: string;
    status: string;
  } | null {
    // 1. Check if the exact query is a registered domain (apex query)
    const exactStmt = this.dbManager.db.prepare('SELECT name, status FROM domains WHERE name = ?');
    const exact = exactStmt.get(query) as { name: string; status: string } | undefined;
    if (exact) {
      return { domainName: exact.name, recordLabel: '@', status: exact.status };
    }

    // 2. Walk parent labels to find parent registered zone
    const parts = query.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const candidateDomain = parts.slice(i).join('.');
      const subLabel = parts.slice(0, i).join('.');

      const parent = exactStmt.get(candidateDomain) as { name: string; status: string } | undefined;
      if (parent) {
        return {
          domainName: parent.name,
          recordLabel: subLabel,
          status: parent.status,
        };
      }
    }

    return null;
  }

  /**
   * Queries matching records from the database.
   */
  private fetchRecords(
    domainName: string,
    label: string,
    type: RecordType,
    queryFqdn: string
  ): ResolutionAnswer[] {
    const stmt = this.dbManager.db.prepare(`
      SELECT name, type, value, ttl, priority
      FROM records
      WHERE domain_name = ? AND name = ? AND type = ?
    `);

    const rows = stmt.all(domainName, label, type) as Array<{
      name: string;
      type: RecordType;
      value: string;
      ttl: number;
      priority: number | null;
    }>;

    return rows.map((r) => ({
      name: queryFqdn,
      type: r.type,
      data: r.value,
      TTL: r.ttl,
      priority: r.priority !== null ? r.priority : undefined,
    }));
  }

  private cacheResult(key: string, result: ResolutionResult): void {
    if (result.answers.length === 0) return;
    const minTtl = Math.min(...result.answers.map((a) => a.TTL));
    const ttlSeconds = Math.max(5, Math.min(minTtl, 3600)); // clamp between 5s and 1h
    this.cache.set(key, {
      result,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  public clearCache(): void {
    this.cache.clear();
  }
}

let defaultResolutionEngine: ResolutionEngine | null = null;

export function getResolutionEngine(dbManager?: RegistryDatabase): ResolutionEngine {
  if (!defaultResolutionEngine) {
    defaultResolutionEngine = new ResolutionEngine(dbManager);
  }
  return defaultResolutionEngine;
}
