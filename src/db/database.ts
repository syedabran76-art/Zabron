/**
 * Zabron — SQLite database singleton.
 *
 * Uses Node 22+'s built-in `node:sqlite` module so the bot runs
 * without native compilation. Behind the scenes we translate the
 * small subset of better-sqlite3's API that Zabron relies on.
 */

import { DatabaseSync, StatementSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { logger } from '../utils/logger.js';
import { MIGRATIONS } from './migrations.js';

// Compatibility shims mirroring better-sqlite3's most used helpers.
export interface ZDatabase {
  exec(sql: string): void;
  prepare(sql: string): ZStatement;
  transaction<T extends (...args: any[]) => void>(fn: T): T;
  close(): void;
  pragma(pragma: string): unknown;
}

export interface ZStatement {
  run(...params: unknown[]): RunResult;
  get(...params: unknown[]): any;
  all(...params: unknown[]): any[];
}

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

let db: ZDatabase | null = null;
let dbPath = './data/zabron.sqlite';

export function initDatabase(path?: string): ZDatabase {
  if (db) return db;
  dbPath = resolve(path ?? process.env.DATABASE_PATH ?? './data/zabron.sqlite');

  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const native = new DatabaseSync(dbPath);
  const wrapped: ZDatabase = {
    exec: (sql: string) => native.exec(sql),
    pragma: (pragma: string) => {
      const [name, value] = pragma.split('=').map((s) => s.trim());
      if (value === undefined) {
        return native.prepare(`PRAGMA ${name}`).get();
      }
      native.exec(`PRAGMA ${name} = ${value}`);
      return null;
    },
    prepare: (sql: string) => wrapStatement(native.prepare(sql)),
    transaction: <T extends (...args: any[]) => void>(fn: T) => {
      return ((...args: any[]) => {
        native.exec('BEGIN');
        try {
          const result = fn(...args);
          native.exec('COMMIT');
          return result;
        } catch (err) {
          native.exec('ROLLBACK');
          throw err;
        }
      }) as unknown as T;
    },
    close: () => {
      native.close();
    },
  };

  wrapped.pragma('journal_mode = WAL');
  wrapped.pragma('foreign_keys = ON');
  wrapped.pragma('synchronous = NORMAL');

  runMigrations(wrapped);
  db = wrapped;
  logger.info('Database initialised', { path: dbPath });
  return wrapped;
}

export function getDatabase(): ZDatabase {
  if (!db) throw new Error('Database has not been initialised yet.');
  return db;
}

export function closeDatabase(): void {
  if (db) {
    try {
      db.close();
    } catch (err) {
      logger.warn('Error while closing database', { err: String(err) });
    }
    db = null;
  }
}

function wrapStatement(stmt: StatementSync): ZStatement {
  return {
    run: (...params: unknown[]) => {
      const result = stmt.run(...params as any[]);
      return {
        changes: Number(result.changes ?? 0),
        lastInsertRowid: result.lastInsertRowid ?? 0n,
      };
    },
    get: (...params: unknown[]) => {
      const row = stmt.get(...params as any[]);
      return row ?? null;
    },
    all: (...params: unknown[]) => {
      const rows = stmt.all(...params as any[]);
      return rows ?? [];
    },
  };
}

function runMigrations(database: ZDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      description TEXT,
      applied_at INTEGER NOT NULL
    );
  `);
  const applied = new Set<string>(
    (database.prepare('SELECT id FROM migrations').all() as any[]).map((r) => r.id),
  );

  const insert = database.prepare(
    'INSERT INTO migrations (id, description, applied_at) VALUES (?, ?, ?)',
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    const tx = database.transaction(() => {
      migration.up(database);
      insert.run(migration.id, migration.description, Date.now());
    });
    try {
      tx();
      logger.info('Applied migration', { id: migration.id, description: migration.description });
    } catch (err) {
      logger.error('Migration failed', { id: migration.id, err: String(err) });
      throw err;
    }
  }
}