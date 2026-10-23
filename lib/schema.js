// Database schema + safe, additive upgrades.
// Nothing here ever changes or deletes existing users, passwords or contacts.
const fs = require('fs');

const SCHEMA_VERSION = 2;

function stamp() {
  return new Date().toISOString().replace(/\..+/, '').replace(/[-:]/g, '').replace('T', '-');
}

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
}

function migrate(db, { dbPath, log = console.log } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      dept TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const version = db.pragma('user_version', { simple: true });
  if (version >= SCHEMA_VERSION) return { upgraded: false, backup: null };

  // Take a full copy of an existing database before the first upgrade.
  let backup = null;
  const hasUsers = db.prepare('SELECT COUNT(*) n FROM users').get().n > 0;
  if (hasUsers && dbPath && dbPath !== ':memory:' && fs.existsSync(dbPath)) {
    backup = `${dbPath}.backup-before-upgrade-${stamp()}`;
    try {
      db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
      log(`Database backup written to ${backup}`);
    } catch (e) {
      backup = null;
      log('WARNING: could not write a backup before upgrading: ' + e.message);
    }
  }

  // Older databases: role column (viewer / editor / admin)
  const userCols = columns(db, 'users');
  if (!userCols.includes('role')) {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'editor'");
    if (userCols.includes('is_admin')) db.exec("UPDATE users SET role = 'admin' WHERE is_admin = 1");
  }
  // New: optional email address per user (used for password reset)
  if (!columns(db, 'users').includes('email')) db.exec('ALTER TABLE users ADD COLUMN email TEXT');
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email
           ON users(lower(email)) WHERE email IS NOT NULL AND email <> ''`);

  // New: activity log (who changed what, and when)
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY,
      at TEXT NOT NULL DEFAULT (datetime('now')),
      actor_id INTEGER,
      actor TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      entity TEXT NOT NULL DEFAULT '',
      entity_id INTEGER,
      target TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      details TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
  `);

  // New: single-use password-reset tokens (only a hash of the token is stored)
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_resets_user ON password_resets(user_id);
  `);

  db.pragma('user_version = ' + SCHEMA_VERSION);
  log(`Database upgraded to version ${SCHEMA_VERSION}.`);
  return { upgraded: true, backup };
}

module.exports = { migrate, SCHEMA_VERSION, stamp };
