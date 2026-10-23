#!/usr/bin/env node
/*
 * Trim the directory down to N contacts (default 10) - safely.
 *
 *   node scripts/trim-contacts.js              -> DRY RUN: shows who stays / who goes, changes nothing
 *   node scripts/trim-contacts.js --apply      -> does it (after making a backup)
 *   node scripts/trim-contacts.js --keep 10 --db path/to/directory.db
 *
 * What it guarantees:
 *   - login accounts (users table, usernames + password hashes) are never touched; it proves this at the end
 *   - a full copy of the database is saved first, plus a CSV of every contact removed
 *   - every removal is written to the activity log
 *
 * Stop the app before running this with --apply.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { migrate, stamp } = require('../lib/schema');
const audit = require('../lib/audit');
const { toCsv } = require('../lib/exporters');

const args = process.argv.slice(2);
const flag = n => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const KEEP = parseInt(opt('--keep', '10'), 10);
const APPLY = flag('--apply');
const DB_PATH = path.resolve(opt('--db', process.env.DB_PATH || path.join(__dirname, '..', 'directory.db')));

if (!Number.isInteger(KEEP) || KEEP < 1) { console.error('--keep must be a whole number of 1 or more.'); process.exit(1); }
if (!fs.existsSync(DB_PATH)) { console.error(`Could not find the database at ${DB_PATH}\nPut your directory.db there, or pass --db <path>.`); process.exit(1); }

const db = new Database(DB_PATH, APPLY ? {} : { readonly: true });   // a dry run opens the file read-only
if (APPLY) {
  db.pragma('journal_mode = WAL');
  migrate(db, { dbPath: DB_PATH });   // adds the activity-log table if needed (and backs up first)
}

const loginFingerprint = () => {
  const h = crypto.createHash('sha256');
  const rows = db.prepare('SELECT id, username, password_hash, role FROM users ORDER BY id').all();
  rows.forEach(r => h.update(`${r.id}|${r.username}|${r.password_hash}|${r.role}\n`));
  return { count: rows.length, hash: h.digest('hex') };
};

const contacts = db.prepare('SELECT id, name, role, dept, email, phone FROM contacts ORDER BY id').all();
console.log(`\nDatabase: ${DB_PATH}`);
console.log(`Contacts in directory: ${contacts.length}   Keeping: ${KEEP}\n`);
if (contacts.length <= KEEP) { console.log('Nothing to trim - already at or under the limit.'); process.exit(0); }

// Choose who stays: take one person at a time from each department (oldest entry first),
// round and round, so every department keeps a presence for as long as possible.
const groups = new Map();
for (const c of contacts) {
  const k = (c.dept || '(no department)').toLowerCase();
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(c);
}
const order = [...groups.values()].sort((a, b) => a[0].id - b[0].id);
const keep = new Set();
while (keep.size < KEEP) for (const g of order) { if (keep.size < KEEP && g.length) keep.add(g.shift().id); }

const pad = (s, n) => String(s).padEnd(n).slice(0, n);
console.log('  ' + pad('Decision', 10) + pad('Name', 24) + pad('Role', 26) + 'Department');
for (const c of contacts) console.log('  ' + pad(keep.has(c.id) ? 'KEEP' : 'remove', 10) + pad(c.name, 24) + pad(c.role, 26) + c.dept);
const removed = contacts.filter(c => !keep.has(c.id));
console.log(`\n${keep.size} stay, ${removed.length} would be removed.`);

if (!APPLY) { console.log('\nThis was a dry run - nothing was changed.\nTo go ahead, run it again with:  node scripts/trim-contacts.js --apply\n'); process.exit(0); }

const before = loginFingerprint();
const tag = stamp();
const backup = `${DB_PATH}.backup-before-trim-${tag}`;
db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
console.log(`\nFull backup saved: ${backup}`);
const csvPath = path.join(path.dirname(DB_PATH), `removed-contacts-${tag}.csv`);
fs.writeFileSync(csvPath, toCsv(['Name', 'Role', 'Department', 'Email', 'Phone'], removed.map(c => [c.name, c.role, c.dept, c.email, c.phone])));
console.log(`Removed contacts saved to: ${csvPath}`);

const del = db.prepare('DELETE FROM contacts WHERE id = ?');
db.transaction(() => {
  for (const c of removed) {
    del.run(c.id);
    audit.record(db, { id: null, username: 'Maintenance (trim script)' }, {
      action: 'contact.delete', entity: 'contact', entityId: c.id, target: c.name,
      summary: `Removed ${c.name}${c.role ? ', ' + c.role : ''}${c.dept ? ' (' + c.dept + ')' : ''} - directory trimmed to ${KEEP} contacts`,
      details: { before: c }
    });
  }
})();

const after = loginFingerprint();
const same = before.count === after.count && before.hash === after.hash;
db.pragma('wal_checkpoint(TRUNCATE)');
console.log(`\nContacts now: ${db.prepare('SELECT COUNT(*) n FROM contacts').get().n}`);
console.log(`Login accounts: ${before.count} before, ${after.count} after - ${same ? 'UNCHANGED (usernames, passwords and roles identical)' : 'MISMATCH - restore the backup above and tell me'}`);
db.close();
process.exit(same ? 0 : 2);
