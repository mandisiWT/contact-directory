const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const readXlsxFile = require('read-excel-file/node');

const { migrate } = require('./lib/schema');
const audit = require('./lib/audit');
const { toCsv, makeXlsx } = require('./lib/exporters');
const mailer = require('./lib/mailer');
const { allow } = require('./lib/ratelimit');

const app = express();
const PORT = process.env.PORT || 3000;
const RESET_MINUTES = 30;
const EMAIL_RE = /^\S+@\S+\.\S+$/;

// Time zone used when writing dates into exported activity reports
let REPORT_TZ = process.env.REPORT_TIMEZONE || 'Africa/Johannesburg';
try { new Intl.DateTimeFormat('en', { timeZone: REPORT_TZ }); } catch { REPORT_TZ = 'Africa/Johannesburg'; }

// ---------- Database (a single file: directory.db) ----------
// Keep the file where it was. Set DB_PATH only if you move it (e.g. to a Render persistent disk).
const DB_PATH = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(__dirname, 'directory.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
migrate(db, { dbPath: DB_PATH });

// One-time import of your original contacts (only when the contacts table is empty)
if (db.prepare('SELECT COUNT(*) n FROM contacts').get().n === 0) {
  const seed = [
    ["Nobuhle Gaqa","HR Director","Human Resource","nobuhle.gaqa@example.com","+27 31 555 0101"],
    ["Natesha Balgobind","Finance Director","Finance","natesha.balgobind@example.com","+27 31 555 0102"],
    ["Andrew Whitley","Project Director","Projects","andrew.whitley@example.com","+27 31 555 0103"],
    ["Malusi Zamisa","Finance Manager","Finance","malusi.zamisa@example.com","+27 31 555 0142"],
    ["Lethukuthula Ngubane","Communication","Communication","lethukuthula.ngubane@example.com","+27 31 555 0118"],
    ["Amanda Hadebe","Software Developer","ICT","amanda.hadebe@example.com","+27 31 555 0127"],
    ["Christina Mngomezulu","HR Manager","Human Resource","christina.mngomezulu@example.com","+27 31 555 0163"],
    ["Gugulethu Maphalala","HR Officer","Human Resource","gugulethu.maphalala@example.com","+27 31 555 0135"],
    ["Nokuthula Ngubane","Accounts Clerk","Finance","nokuthula.ngubane@example.com","+27 31 555 0171"],
    ["Thulisiwe Mthembu","Project Manager","Projects","thulisiwe.mthembu@example.com","+27 31 555 0156"],
    ["Samkelisiwe Manzini","Hub Manager","Projects","samkelisiwe.manzini@example.com","+27 31 555 0189"],
    ["Roy Jones","IT Systems Administrator","ICT","roy.jones@example.com","+27 31 555 0124"],
    ["Silindile Chilli","Procurement Officer","Finance","silindile.chilli@example.com","+27 31 555 0198"]
  ];
  const ins = db.prepare('INSERT INTO contacts (name, role, dept, email, phone) VALUES (?,?,?,?,?)');
  db.transaction(rows => rows.forEach(r => ins.run(...r)))(seed);
}

// First run: create an admin user (only when there are no users at all)
if (db.prepare('SELECT COUNT(*) n FROM users').get().n === 0) {
  const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString('hex');
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('admin', ?, 'admin')")
    .run(bcrypt.hashSync(pw, 12));
  console.log('\n=== First run: admin account created ===');
  console.log('Username: admin');
  console.log('Password: ' + pw);
  console.log('(Shown only once. Write it down.)\n');
}

console.log(`Database: ${DB_PATH}`);
console.log('Password-reset email: ' + mailer.describe());

// ---------- Middleware ----------
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-only-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 1000 * 60 * 60 * 8 }
}));
app.use(express.static(path.join(__dirname, 'public')));

// Checks the user still exists, so removed users lose access immediately
const requireAuth = (req, res, next) => {
  const u = req.session.userId &&
    db.prepare('SELECT id, username, role, email FROM users WHERE id = ?').get(req.session.userId);
  if (!u) return res.status(401).json({ error: 'Please sign in.' });
  req.user = u; next();
};
const ROLES = ['viewer', 'editor', 'admin'];
const requireEditor = (req, res, next) =>
  req.user.role !== 'viewer' ? next() : res.status(403).json({ error: 'Your account is view-only.' });
const requireAdmin = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only.' });

const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const q = (req, k) => String(req.query[k] ?? '');

// ---------- Auth routes ----------
app.post('/api/login', (req, res) => {
  const { username = '', password = '' } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username));
  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Login failed.' });
    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ username: user.username, role: user.role, email: user.email || '', emailEnabled: mailer.configured() });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireAuth, (req, res) =>
  res.json({ username: req.user.username, role: req.user.role, email: req.user.email || '', emailEnabled: mailer.configured() }));

// ---------- Password reset by email (Gmail) ----------
app.post('/api/password/forgot', (req, res) => {
  if (!allow('forgot-ip:' + req.ip, 5, 15 * 60 * 1000))
    return res.status(429).json({ error: 'Too many requests. Please try again in a few minutes.' });
  // Same answer whether or not the account exists, so this can't be used to discover usernames.
  res.json({ ok: true, message: 'If that account has an email address on file, a reset link is on its way.' });
  try {
    const id = String((req.body || {}).identifier || '').trim().slice(0, 200);
    if (!id) return;
    const user = db.prepare(`SELECT id, username, email FROM users
      WHERE username = ? COLLATE NOCASE OR (email IS NOT NULL AND email <> '' AND lower(email) = lower(?)) LIMIT 1`).get(id, id);
    if (!user || !user.email) return;
    if (!allow('forgot-user:' + user.id, 3, 15 * 60 * 1000)) return;

    const base = (process.env.APP_URL || (process.env.NODE_ENV === 'production' ? '' : `http://localhost:${PORT}`)).replace(/\/+$/, '');
    if (!base) { console.error('Password reset: set APP_URL (your site address) so reset links can be built.'); return; }

    const token = crypto.randomBytes(32).toString('hex');
    db.transaction(() => {
      db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
      db.prepare('INSERT INTO password_resets (user_id, token_hash, expires_at, created_at) VALUES (?,?,?,?)')
        .run(user.id, sha256(token), Date.now() + RESET_MINUTES * 60000, Date.now());
    })();
    audit.record(db, { id: user.id, username: user.username }, {
      action: 'password.reset_request', entity: 'user', entityId: user.id, target: user.username,
      summary: `Password reset link requested for ${user.username}`
    });

    const link = `${base}/reset.html?token=${token}`;
    if (!mailer.configured()) {
      console.warn('Password reset requested but email is not configured (see UPGRADE_GUIDE.md, section 4).');
      if (process.env.NODE_ENV !== 'production') console.warn('Development only - reset link: ' + link);
      return;
    }
    mailer.sendResetEmail({ to: user.email, username: user.username, link, minutes: RESET_MINUTES })
      .catch(e => console.error('Could not send reset email:', e.message));
  } catch (e) { console.error('Password reset error:', e.message); }
});

app.get('/api/password/check', (req, res) => {
  const row = db.prepare('SELECT expires_at FROM password_resets WHERE token_hash = ?').get(sha256(q(req, 'token')));
  res.json({ valid: !!row && row.expires_at > Date.now() });
});

app.post('/api/password/reset', (req, res) => {
  if (!allow('reset-ip:' + req.ip, 10, 15 * 60 * 1000))
    return res.status(429).json({ error: 'Too many attempts. Please try again in a few minutes.' });
  const { token = '', password = '' } = req.body || {};
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const row = db.prepare('SELECT user_id, expires_at FROM password_resets WHERE token_hash = ?').get(sha256(token));
  const user = row && row.expires_at > Date.now() && db.prepare('SELECT id, username FROM users WHERE id = ?').get(row.user_id);
  if (!user) return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(password), 12), user.id);
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
  })();
  audit.record(db, { id: user.id, username: user.username }, {
    action: 'password.reset', entity: 'user', entityId: user.id, target: user.username,
    summary: `${user.username} reset their password using an emailed link`
  });
  res.json({ ok: true });
});

// ---------- Account & user management ----------
app.post('/api/account/password', requireAuth, (req, res) => {
  const { current = '', next = '' } = req.body || {};
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(String(current), row.password_hash))
    return res.status(400).json({ error: 'Current password is incorrect.' });
  if (String(next).length < 8)
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(next), 12), req.user.id);
  audit.record(db, req.user, { action: 'password.change', entity: 'user', entityId: req.user.id, target: req.user.username,
    summary: `${req.user.username} changed their own password` });
  res.json({ ok: true });
});

app.put('/api/account/email', requireAuth, (req, res) => {
  const { email = '', current = '' } = req.body || {};
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(String(current), row.password_hash))
    return res.status(400).json({ error: 'Current password is incorrect.' });
  const mail = String(email).trim().slice(0, 200);
  if (!EMAIL_RE.test(mail)) return res.status(400).json({ error: 'Enter a valid email address.' });
  try { db.prepare('UPDATE users SET email = ? WHERE id = ?').run(mail, req.user.id); }
  catch (e) { return res.status(409).json({ error: 'That email address is already used by another account.' }); }
  audit.record(db, req.user, { action: 'user.email', entity: 'user', entityId: req.user.id, target: req.user.username,
    summary: `${req.user.username} changed their own email: ${req.user.email || '(none)'} -> ${mail}`,
    details: { from: req.user.email || '', to: mail } });
  res.json({ ok: true, email: mail });
});

app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  res.json(db.prepare("SELECT id, username, role, COALESCE(email, '') AS email FROM users ORDER BY username COLLATE NOCASE").all());
});

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const { username = '', password = '', role = 'viewer', email = '' } = req.body || {};
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
  const name = String(username).trim();
  if (!/^[A-Za-z0-9._-]{3,50}$/.test(name))
    return res.status(400).json({ error: 'Username: 3-50 letters, numbers, dot, dash or underscore.' });
  if (String(password).length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const mail = String(email).trim().slice(0, 200);
  if (mail && !EMAIL_RE.test(mail)) return res.status(400).json({ error: 'Email looks invalid.' });
  try {
    const r = db.prepare('INSERT INTO users (username, password_hash, role, email) VALUES (?,?,?,?)')
      .run(name, bcrypt.hashSync(String(password), 12), role, mail || null);
    audit.record(db, req.user, { action: 'user.create', entity: 'user', entityId: Number(r.lastInsertRowid), target: name,
      summary: `Added user ${name} with ${role} permission${mail ? ' (' + mail + ')' : ''}`, details: { role, email: mail } });
    res.status(201).json({ id: Number(r.lastInsertRowid), username: name, role, email: mail });
  } catch (e) {
    const dupEmail = /email/i.test(String(e.message));
    res.status(409).json({ error: dupEmail ? 'That email address is already used by another account.' : 'That username already exists.' });
  }
});

app.put('/api/users/:id/role', requireAuth, requireAdmin, (req, res) => {
  const role = String((req.body || {}).role || '');
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
  if (Number(req.params.id) === req.user.id)
    return res.status(400).json({ error: "You can't change your own role." });
  const target = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, target.id);
  if (target.role !== role) audit.record(db, req.user, { action: 'user.role', entity: 'user', entityId: target.id, target: target.username,
    summary: `Changed ${target.username}'s permission: ${target.role} -> ${role}`, details: { from: target.role, to: role } });
  res.json({ ok: true });
});

app.put('/api/users/:id/email', requireAuth, requireAdmin, (req, res) => {
  const mail = String((req.body || {}).email || '').trim().slice(0, 200);
  if (mail && !EMAIL_RE.test(mail)) return res.status(400).json({ error: 'Email looks invalid.' });
  const target = db.prepare('SELECT id, username, email FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  try { db.prepare('UPDATE users SET email = ? WHERE id = ?').run(mail || null, target.id); }
  catch (e) { return res.status(409).json({ error: 'That email address is already used by another account.' }); }
  if ((target.email || '') !== mail) audit.record(db, req.user, { action: 'user.email', entity: 'user', entityId: target.id, target: target.username,
    summary: `Changed ${target.username}'s email: ${target.email || '(none)'} -> ${mail || '(none)'}`, details: { from: target.email || '', to: mail } });
  res.json({ ok: true });
});

app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  if (Number(req.params.id) === req.user.id)
    return res.status(400).json({ error: "You can't remove your own account." });
  const target = db.prepare('SELECT id, username, role, email FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  db.transaction(() => {
    db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(target.id);
  })();
  audit.record(db, req.user, { action: 'user.delete', entity: 'user', entityId: target.id, target: target.username,
    summary: `Removed user ${target.username} (${target.role})`, details: { role: target.role, email: target.email || '' } });
  res.json({ ok: true });
});

// ---------- Activity log (admin only) ----------
const auditFilters = req => ({ type: q(req, 'type'), from: q(req, 'from'), to: q(req, 'to'), q: q(req, 'q'), page: q(req, 'page') });

app.get('/api/audit', requireAuth, requireAdmin, (req, res) => {
  res.json(audit.list(db, { ...auditFilters(req), pageSize: 10 }));
});

app.get('/api/audit/export', requireAuth, requireAdmin, (req, res) => {
  const format = q(req, 'format').toLowerCase() || 'csv';
  if (!['csv', 'xlsx'].includes(format)) return res.status(400).json({ error: 'Choose CSV or Excel format.' });
  const rows = audit.listAll(db, auditFilters(req));
  const headers = [`When (${REPORT_TZ})`, 'Who', 'What happened', 'Item', 'Details'];
  const data = rows.map(r => [audit.formatWhen(r.at, REPORT_TZ), r.actor, audit.ACTION_LABELS[r.action] || r.action, r.target, r.summary]);
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="activity-report-${stamp}.csv"`);
    return res.send(toCsv(headers, data));
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="activity-report-${stamp}.xlsx"`);
  res.send(makeXlsx(headers, data, 'Activity'));
});

// ---------- Contact routes (all protected) ----------
function clean(body = {}) {
  const f = k => String(body[k] ?? '').trim().slice(0, 200);
  const c = { name: f('name'), role: f('role'), dept: f('dept'), email: f('email'), phone: f('phone') };
  if (!c.name) return { error: 'Name is required.' };
  if (c.email && !EMAIL_RE.test(c.email)) return { error: 'Email looks invalid.' };
  return { c };
}

app.get('/api/contacts', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT id, name, role, dept, email, phone FROM contacts ORDER BY name COLLATE NOCASE').all());
});

// Export the contacts picked in the directory (any mix of people, across pages).
app.post('/api/contacts/export', requireAuth, requireEditor, (req, res) => {
  const body = req.body || {};
  const format = String(body.format || 'csv').toLowerCase();
  if (!['csv', 'xlsx'].includes(format)) return res.status(400).json({ error: 'Choose CSV or Excel format.' });
  if (!Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 50000)
    return res.status(400).json({ error: 'Select at least one contact to export.' });
  const ids = [...new Set(body.ids.map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return res.status(400).json({ error: 'No valid contacts were selected.' });
  const rows = [];
  for (let i = 0; i < ids.length; i += 500) {            // chunked: SQLite limits the number of ? placeholders
    const chunk = ids.slice(i, i + 500);
    rows.push(...db.prepare(`SELECT name, role, dept, email, phone FROM contacts WHERE id IN (${chunk.map(() => '?').join(',')})`).all(...chunk));
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  if (!rows.length) return res.status(404).json({ error: 'No selected contacts were found.' });
  audit.record(db, req.user, { action: 'contact.export', entity: 'contact', target: `${rows.length} contact${rows.length === 1 ? '' : 's'}`,
    summary: `Exported ${rows.length} contact${rows.length === 1 ? '' : 's'} as ${format.toUpperCase()}`,
    details: { format, count: rows.length, names: rows.slice(0, 50).map(r => r.name) } });
  const headers = ['Name', 'Role', 'Department', 'Email', 'Phone'];
  const data = rows.map(c => [c.name, c.role, c.dept, c.email, c.phone]);
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="contacts-${stamp}.csv"`);
    return res.send(toCsv(headers, data));
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="contacts-${stamp}.xlsx"`);
  res.send(makeXlsx(headers, data, 'Contacts'));
});

app.post('/api/contacts', requireAuth, requireEditor, (req, res) => {
  const { c, error } = clean(req.body);
  if (error) return res.status(400).json({ error });
  const r = db.prepare('INSERT INTO contacts (name, role, dept, email, phone) VALUES (?,?,?,?,?)')
    .run(c.name, c.role, c.dept, c.email, c.phone);
  const id = Number(r.lastInsertRowid);
  audit.record(db, req.user, { action: 'contact.create', entity: 'contact', entityId: id, target: c.name,
    summary: `Added ${c.name}${c.role ? ', ' + c.role : ''}${c.dept ? ' (' + c.dept + ')' : ''}`, details: { after: c } });
  res.status(201).json({ id, ...c });
});

app.put('/api/contacts/:id', requireAuth, requireEditor, (req, res) => {
  const { c, error } = clean(req.body);
  if (error) return res.status(400).json({ error });
  const before = db.prepare('SELECT id, name, role, dept, email, phone FROM contacts WHERE id = ?').get(req.params.id);
  if (!before) return res.status(404).json({ error: 'Contact not found.' });
  db.prepare(`UPDATE contacts SET name=?, role=?, dept=?, email=?, phone=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(c.name, c.role, c.dept, c.email, c.phone, before.id);
  const changes = audit.diffContact(before, c);
  if (changes.length) audit.record(db, req.user, { action: 'contact.update', entity: 'contact', entityId: before.id, target: before.name,
    summary: `Edited ${before.name} - ${audit.describeChanges(changes)}`, details: { changes } });
  res.json({ id: before.id, ...c });
});

app.delete('/api/contacts/:id', requireAuth, requireEditor, (req, res) => {
  const before = db.prepare('SELECT id, name, role, dept, email, phone FROM contacts WHERE id = ?').get(req.params.id);
  if (!before) return res.status(404).json({ error: 'Contact not found.' });
  db.prepare('DELETE FROM contacts WHERE id = ?').run(before.id);
  audit.record(db, req.user, { action: 'contact.delete', entity: 'contact', entityId: before.id, target: before.name,
    summary: `Removed ${before.name}${before.role ? ', ' + before.role : ''}${before.dept ? ' (' + before.dept + ')' : ''}`, details: { before } });
  res.json({ ok: true });
});

// Bulk import from an .xlsx file (first sheet, first row = headers)
const HEADERS = {
  name: ['name', 'full name', 'fullname', 'contact', 'contact name'],
  first: ['first name', 'firstname', 'first', 'given name'],
  last: ['last name', 'lastname', 'last', 'surname', 'family name'],
  role: ['role', 'title', 'job title', 'position', 'designation'],
  dept: ['dept', 'department', 'division', 'unit'],
  email: ['email', 'e-mail', 'email address', 'mail'],
  phone: ['phone', 'telephone', 'tel', 'mobile', 'cell', 'phone number', 'contact number', 'number']
};
const FIELDS = Object.keys(HEADERS);
const detect = head => Object.fromEntries(FIELDS.map(k => [k, head.findIndex(h => HEADERS[k].includes(h))]));
const rawUpload = express.raw({ type: 'application/octet-stream', limit: '5mb' });
async function readSheet(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw new Error('No file received.');
  let rows;
  try { rows = await readXlsxFile(buf); }
  catch (e) { throw new Error('Could not read that file. Please upload a valid .xlsx workbook.'); }
  if (rows.length < 2) throw new Error('The spreadsheet has no contact rows.');
  if (rows.length > 5001) throw new Error('Too many rows (limit is 5000 per upload).');
  return rows;
}

// Step 1: read the headers and a few sample rows so the user can map columns
app.post('/api/contacts/import/preview', requireAuth, requireEditor, rawUpload, async (req, res) => {
  try {
    const rows = await readSheet(req.body);
    const headers = rows[0].map((h, i) => String(h ?? '').trim() || 'Column ' + (i + 1));
    res.json({
      headers,
      suggested: detect(headers.map(h => h.toLowerCase())),
      sample: rows.slice(1, 4).map(r => headers.map((_, i) => String(r[i] ?? ''))),
      total: rows.length - 1
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Step 2: import using the chosen mapping (?map={"name":0,"role":2,...}, -1 = not used)
app.post('/api/contacts/import', requireAuth, requireEditor, rawUpload, async (req, res) => {
  let rows;
  try { rows = await readSheet(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  let col;
  try { col = req.query.map ? JSON.parse(req.query.map) : detect(rows[0].map(h => String(h ?? '').trim().toLowerCase())); }
  catch (e) { return res.status(400).json({ error: 'Invalid column mapping.' }); }
  for (const k of FIELDS) col[k] = Number.isInteger(col[k]) && col[k] >= 0 && col[k] < rows[0].length ? col[k] : -1;
  if (col.name < 0 && col.first < 0 && col.last < 0)
    return res.status(400).json({ error: 'Choose a column for Full name, or for First name and/or Last name.' });
  const seen = new Set(db.prepare('SELECT name, email FROM contacts').all()
    .map(c => c.name.toLowerCase() + '|' + c.email.toLowerCase()));
  const ins = db.prepare('INSERT INTO contacts (name, role, dept, email, phone) VALUES (?,?,?,?,?)');
  let added = 0, skipped = 0;
  const addedNames = [];
  db.transaction(() => {
    for (const r of rows.slice(1)) {
      const get = k => col[k] < 0 ? '' : String(r[col[k]] ?? '');
      const fullName = col.name >= 0 ? get('name') : [get('first'), get('last')].map(x => x.trim()).filter(Boolean).join(' ');
      const { c, error } = clean({ name: fullName, role: get('role'), dept: get('dept'), email: get('email'), phone: get('phone') });
      const key = c && c.name.toLowerCase() + '|' + c.email.toLowerCase();
      if (error || seen.has(key)) { skipped++; continue; }
      seen.add(key);
      ins.run(c.name, c.role, c.dept, c.email, c.phone); added++; addedNames.push(c.name);
    }
  })();
  audit.record(db, req.user, { action: 'contact.import', entity: 'contact', target: `${added} contact${added === 1 ? '' : 's'}`,
    summary: `Imported ${added} contact${added === 1 ? '' : 's'} from a spreadsheet (${skipped} skipped)`,
    details: { added, skipped, names: addedNames.slice(0, 100) } });
  res.json({ added, skipped });
});

app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
