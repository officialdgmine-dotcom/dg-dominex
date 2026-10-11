/**
 * DG Domain Core - Type Definitions
 * Copyright (c) 2026 Deep Group
 *
 * Core domain entities, DNS record types, API payloads, and resolution interfaces.
 */

export type RecordType = 'A' | 'AAAA' | 'CNAME' | 'TXT' | 'MX' | 'NS';

export type DomainStatus = 'active' | 'suspended' | 'locked';

export interface ResourceRecord {
  id?: number;
  domainName: string;
  name: string;        // '@' for apex or subdomain label e.g. 'mail', 'api'
  type: RecordType;
  value: string;
  ttl: number;
  priority?: number | null;
  createdAt?: number;
}

export interface DomainEntity {
  name: string;                // FQDN e.g. 'deepgroup.dg'
  registrantId: string;
  authTokenHash: string;       // SHA-256 hash of registrant secret token
  status: DomainStatus;
  registeredAt: number;        // Unix epoch ms
  updatedAt: number;
  expiresAt: number;
}

export interface DomainPublicProfile {
  name: string;
  registrantId: string;
  status: DomainStatus;
  registeredAt: string;        // ISO 8601
  updatedAt: string;
  expiresAt: string;
  records: Omit<ResourceRecord, 'id' | 'domainName'>[];
  disclaimer: string;
}

export interface RecordInput {
  name: string;
  type: RecordType;
  value: string;
  ttl?: number;
  priority?: number | null;
}

export interface RegisterDomainInput {
  name: string;
  registrantId: string;
  records?: RecordInput[];
}

export interface RegistrationResult {
  name: string;
  registrantId: string;
  authToken: string;           // Returned ONCE upon registration
  status: DomainStatus;
  registeredAt: string;
  expiresAt: string;
  records: ResourceRecord[];
  disclaimer: string;
}

export interface AvailabilityResult {
  name: string;
  available: boolean;
  reason?: string;
  disclaimer: string;
}

export interface ResolutionAnswer {
  name: string;
  type: RecordType;
  data: string;
  TTL: number;
  priority?: number;
}

export interface ResolutionResult {
  question: {
    name: string;
    type: RecordType;
  };
  status: 'NOERROR' | 'NXDOMAIN' | 'REFUSED' | 'SERVFAIL';
  statusCode: number;          // 0 = NOERROR, 2 = SERVFAIL, 3 = NXDOMAIN, 5 = REFUSED
  answers: ResolutionAnswer[];
  cached: boolean;
  authoritative: boolean;
  executionTimeMs: number;
  disclaimer: string;
}

export interface DoHResponse {
  Status: number;              // 0 = Success, 3 = NXDOMAIN, etc.
  TC: boolean;
  RD: boolean;
  RA: boolean;
  AD: boolean;
  CD: boolean;
  Question: Array<{
    name: string;
    type: number;
  }>;
  Answer?: Array<{
    name: string;
    type: number;
    TTL: number;
    data: string;
  }>;
  Comment?: string;
}

export interface AuditLogEntry {
  id?: number;
  domainName: string | null;
  action: string;
  clientIp?: string;
  timestamp: number;
  details?: string;
}

export type HostingRecordType = 'A' | 'AAAA' | 'CNAME';

export interface HostingConnectionInput {
  subdomain?: string;          // '@' for apex or subdomain label e.g. 'www', 'app'
  type: HostingRecordType;     // 'A' (IPv4), 'AAAA' (IPv6), or 'CNAME' (canonical target)
  destination: string;         // Real hosting provider IP or target hostname
  provider?: string;           // Optional provider identifier e.g. 'github_pages', 'vercel', 'custom'
  ttl?: number;
}

export interface HostingConnectionResult {
  success: boolean;
  domain: string;
  subdomain: string;
  type: HostingRecordType;
  destination: string;
  provider: string;
  isPublicRoutable?: boolean;
  isPrivateAddress?: boolean;
  activeRecords: ResourceRecord[];
  disclaimer: string;
}

export interface HostingStatusResult {
  domain: string;
  status: DomainStatus;
  hostingDestinations: Array<{
    subdomain: string;
    type: HostingRecordType;
    destination: string;
    ttl: number;
  }>;
  preservedRecords: Array<{
    name: string;
    type: RecordType;
    value: string;
  }>;
  disclaimer: string;
}
