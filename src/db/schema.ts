/**
 * DG Domain Core - Database Schema Definitions & Migrations
 * Copyright (c) 2026 Deep Group
 *
 * Lightweight SQL DDL with strict integrity constraints, foreign keys,
 * unique duplicate prevention indices, and audit trail tables.
 */

export const MIGRATIONS = [
  {
    version: 1,
    description: 'Initial schema: domains, records, audit_logs with foreign keys and unique constraints',
    up: `
      -- Enable foreign keys
      PRAGMA foreign_keys = ON;

      -- Schema migration tracker
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL,
        description TEXT NOT NULL
      );

      -- Registered Domains Table
      CREATE TABLE IF NOT EXISTS domains (
        name TEXT PRIMARY KEY,                       -- Canonical FQDN e.g. 'deepgroup.dg'
        registrant_id TEXT NOT NULL,                 -- Account or entity identifier
        auth_token_hash TEXT NOT NULL,               -- SHA-256 hash of registrant authorization token
        status TEXT NOT NULL DEFAULT 'active',       -- 'active', 'suspended', 'locked'
        registered_at INTEGER NOT NULL,              -- Epoch timestamp in milliseconds
        updated_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_domains_status ON domains(status);

      -- DNS Resource Records Table
      CREATE TABLE IF NOT EXISTS records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain_name TEXT NOT NULL,                   -- References domains(name)
        name TEXT NOT NULL,                          -- '@' for apex or subdomain label e.g. 'mail', 'api'
        type TEXT NOT NULL,                          -- 'A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS'
        value TEXT NOT NULL,                         -- Destination IP, canonical name, text value, etc.
        ttl INTEGER NOT NULL DEFAULT 300,            -- Time To Live in seconds
        priority INTEGER,                            -- MX record preference (nullable)
        created_at INTEGER NOT NULL,
        FOREIGN KEY (domain_name) REFERENCES domains(name) ON DELETE CASCADE,
        -- Strict constraint: prevent duplicate identical records
        UNIQUE (domain_name, name, type, value)
      );

      CREATE INDEX IF NOT EXISTS idx_records_lookup ON records(domain_name, name, type);

      -- Audit Trail Table
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain_name TEXT,
        action TEXT NOT NULL,                        -- 'REGISTER', 'UPDATE_RECORDS', 'STATUS_CHANGE', etc.
        client_ip TEXT,
        timestamp INTEGER NOT NULL,
        details TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_audit_domain ON audit_logs(domain_name);
    `,
  },
];
