/**
 * DG Domain Core - SQLite Database Driver
 * Copyright (c) 2026 Deep Group
 *
 * Lightweight, zero-external-dependency SQLite driver using Node 22 native DatabaseSync.
 * Supports file persistence or isolated in-memory instances for testing.
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { MIGRATIONS } from './schema.ts';

export class RegistryDatabase {
  public db: DatabaseSync;
  private isClosed = false;

  constructor(dbPath: string = ':memory:') {
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(dbPath);
    this.initPragmas();
    this.runMigrations();
  }

  private initPragmas(): void {
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA journal_mode = WAL;');
  }

  private runMigrations(): void {
    // Migration tracking table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL,
        description TEXT NOT NULL
      );
    `);

    const checkStmt = this.db.prepare('SELECT version FROM schema_migrations WHERE version = ?');
    const insertStmt = this.db.prepare(
      'INSERT INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)'
    );

    for (const migration of MIGRATIONS) {
      const existing = checkStmt.get(migration.version) as { version: number } | undefined;
      if (!existing) {
        this.db.exec(migration.up);
        insertStmt.run(migration.version, Date.now(), migration.description);
      }
    }
  }

  /**
   * Run operations inside an atomic transaction.
   */
  public transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN TRANSACTION;');
    try {
      const result = fn();
      this.db.exec('COMMIT;');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  public close(): void {
    if (!this.isClosed) {
      this.db.close();
      this.isClosed = true;
    }
  }
}

// Default singleton instance for the app runtime
let defaultDbInstance: RegistryDatabase | null = null;

export function getDatabase(dbPath?: string): RegistryDatabase {
  if (!defaultDbInstance) {
    const targetPath = dbPath || process.env.DG_DB_PATH || 'data/dg_core.db';
    defaultDbInstance = new RegistryDatabase(targetPath);
  }
  return defaultDbInstance;
}

export function createInMemoryDatabase(): RegistryDatabase {
  return new RegistryDatabase(':memory:');
}
