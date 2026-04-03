import { Store, type SessionData } from "express-session";
import type BetterSqlite3 from "better-sqlite3";

/**
 * Production-safe SQLite session store for express-session.
 *
 * Uses better-sqlite3's synchronous API — operations are blocking but
 * complete in microseconds for typical session sizes, making them safe
 * inside a Node.js server without additional async overhead.
 *
 * ── Migration path ──────────────────────────────────────────────────────────
 * To switch to PostgreSQL sessions, replace this store with connect-pg-simple
 * and pass a pg.Pool.  The express-session configuration in server/index.ts
 * is the only file that needs updating.
 *
 * To switch to Redis (high-traffic, multi-instance deployments), use
 * connect-redis with an ioredis client.  Again, only server/index.ts changes.
 */
export class SqliteSessionStore extends Store {
  private readonly db: BetterSqlite3.Database;
  private pruneTimer: NodeJS.Timeout | null = null;

  constructor(db: BetterSqlite3.Database) {
    super();
    this.db = db;
    // Table creation is handled in server/storage.ts bootstrap block.
    this.schedulePrune();
  }

  private schedulePrune() {
    // Prune expired sessions every 60 minutes to keep the table lean.
    this.pruneTimer = setInterval(() => this.prune(), 60 * 60 * 1000);
    this.pruneTimer.unref(); // Don't keep the process alive just for cleanup.
  }

  private prune() {
    this.db.prepare("DELETE FROM sessions WHERE expired_at < ?").run(Date.now());
  }

  get(sid: string, callback: (err: any, session?: SessionData | null) => void): void {
    try {
      const row = this.db
        .prepare("SELECT sess, expired_at FROM sessions WHERE sid = ?")
        .get(sid) as { sess: string; expired_at: number } | undefined;

      if (!row) return callback(null, null);
      if (row.expired_at < Date.now()) {
        this.destroy(sid, () => {});
        return callback(null, null);
      }
      callback(null, JSON.parse(row.sess) as SessionData);
    } catch (err) {
      callback(err);
    }
  }

  set(sid: string, session: SessionData, callback?: (err?: any) => void): void {
    try {
      const maxAge = session.cookie?.maxAge ?? 7 * 24 * 60 * 60 * 1000;
      const expiredAt = Date.now() + maxAge;

      this.db
        .prepare(
          `INSERT INTO sessions (sid, sess, expired_at) VALUES (?, ?, ?)
           ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expired_at = excluded.expired_at`,
        )
        .run(sid, JSON.stringify(session), expiredAt);

      callback?.();
    } catch (err) {
      callback?.(err as Error);
    }
  }

  destroy(sid: string, callback?: (err?: any) => void): void {
    try {
      this.db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
      callback?.();
    } catch (err) {
      callback?.(err as Error);
    }
  }

  touch(sid: string, session: SessionData, callback?: () => void): void {
    try {
      const maxAge = session.cookie?.maxAge ?? 7 * 24 * 60 * 60 * 1000;
      const expiredAt = Date.now() + maxAge;
      this.db
        .prepare("UPDATE sessions SET expired_at = ? WHERE sid = ?")
        .run(expiredAt, sid);
      callback?.();
    } catch {
      callback?.();
    }
  }

  length(callback: (err: any, length?: number) => void): void {
    try {
      const row = this.db
        .prepare("SELECT COUNT(*) AS count FROM sessions WHERE expired_at >= ?")
        .get(Date.now()) as { count: number };
      callback(null, row.count);
    } catch (err) {
      callback(err);
    }
  }

  clear(callback?: (err?: any) => void): void {
    try {
      this.db.prepare("DELETE FROM sessions").run();
      callback?.();
    } catch (err) {
      callback?.(err as Error);
    }
  }

  close() {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
  }
}
