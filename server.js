const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const readXlsxFile = require('read-excel-file/node');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Database (a single file: directory.db) ----------
const db = new Database(path.join(__dirname, 'directory.db'));
db.pragma('journal_mode = WAL');
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

// Upgrade older databases: add a role column (viewer / editor / admin)
const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userCols.includes('role')) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'editor'");
  if (userCols.includes('is_admin')) db.exec("UPDATE users SET role = 'admin' WHERE is_admin = 1");
}

// One-time import of your original contacts
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

// First run: create an admin user
if (db.prepare('SELECT COUNT(*) n FROM users').get().n === 0) {
  const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString('hex');
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('admin', ?, 'admin')")
    .run(bcrypt.hashSync(pw, 12));
  console.log('\n=== First run: admin account created ===');
  console.log('Username: admin');
  console.log('Password: ' + pw);
  console.log('(Shown only once. Write it down.)\n');
}

// ---------- Middleware ----------
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));
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
    db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(req.session.userId);
  if (!u) return res.status(401).json({ error: 'Please sign in.' });
  req.user = u; next();
};
const ROLES = ['viewer', 'editor', 'admin'];
const requireEditor = (req, res, next) =>
  req.user.role !== 'viewer' ? next() : res.status(403).json({ error: 'Your account is view-only.' });
const requireAdmin = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only.' });

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
    res.json({ username: user.username, role: user.role });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireAuth, (req, res) =>
  res.json({ username: req.user.username, role: req.user.role }));

// ---------- Account & user management ----------
app.post('/api/account/password', requireAuth, (req, res) => {
  const { current = '', next = '' } = req.body || {};
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(String(current), row.password_hash))
    return res.status(400).json({ error: 'Current password is incorrect.' });
  if (String(next).length < 8)
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(next), 12), req.user.id);
  res.json({ ok: true });
});

app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, username, role FROM users ORDER BY username COLLATE NOCASE').all());
});

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const { username = '', password = '', role = 'viewer' } = req.body || {};
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
  const name = String(username).trim();
  if (!/^[A-Za-z0-9._-]{3,50}$/.test(name))
    return res.status(400).json({ error: 'Username: 3-50 letters, numbers, dot, dash or underscore.' });
  if (String(password).length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  try {
    const r = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?,?,?)')
      .run(name, bcrypt.hashSync(String(password), 12), role);
    res.status(201).json({ id: r.lastInsertRowid, username: name, role });
  } catch (e) {
    res.status(409).json({ error: 'That username already exists.' });
  }
});

app.put('/api/users/:id/role', requireAuth, requireAdmin, (req, res) => {
  const role = String((req.body || {}).role || '');
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
  if (Number(req.params.id) === req.user.id)
    return res.status(400).json({ error: "You can't change your own role." });
  const r = db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'User not found.' });
  res.json({ ok: true });
});

app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  if (Number(req.params.id) === req.user.id)
    return res.status(400).json({ error: "You can't remove your own account." });
  const r = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'User not found.' });
  res.json({ ok: true });
});

// ---------- Contact routes (all protected) ----------
function clean(body = {}) {
  const f = k => String(body[k] ?? '').trim().slice(0, 200);
  const c = { name: f('name'), role: f('role'), dept: f('dept'), email: f('email'), phone: f('phone') };
  if (!c.name) return { error: 'Name is required.' };
  if (c.email && !/^\S+@\S+\.\S+$/.test(c.email)) return { error: 'Email looks invalid.' };
  return { c };
}

app.get('/api/contacts', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT id, name, role, dept, email, phone FROM contacts ORDER BY name COLLATE NOCASE').all());
});

app.post('/api/contacts', requireAuth, requireEditor, (req, res) => {
  const { c, error } = clean(req.body);
  if (error) return res.status(400).json({ error });
  const r = db.prepare('INSERT INTO contacts (name, role, dept, email, phone) VALUES (?,?,?,?,?)')
    .run(c.name, c.role, c.dept, c.email, c.phone);
  res.status(201).json({ id: r.lastInsertRowid, ...c });
});

app.put('/api/contacts/:id', requireAuth, requireEditor, (req, res) => {
  const { c, error } = clean(req.body);
  if (error) return res.status(400).json({ error });
  const r = db.prepare(`UPDATE contacts SET name=?, role=?, dept=?, email=?, phone=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(c.name, c.role, c.dept, c.email, c.phone, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Contact not found.' });
  res.json({ id: Number(req.params.id), ...c });
});

app.delete('/api/contacts/:id', requireAuth, requireEditor, (req, res) => {
  const r = db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Contact not found.' });
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
  db.transaction(() => {
    for (const r of rows.slice(1)) {
      const get = k => col[k] < 0 ? '' : String(r[col[k]] ?? '');
      const fullName = col.name >= 0 ? get('name') : [get('first'), get('last')].map(x => x.trim()).filter(Boolean).join(' ');
      const { c, error } = clean({ name: fullName, role: get('role'), dept: get('dept'), email: get('email'), phone: get('phone') });
      const key = c && c.name.toLowerCase() + '|' + c.email.toLowerCase();
      if (error || seen.has(key)) { skipped++; continue; }
      seen.add(key);
      ins.run(c.name, c.role, c.dept, c.email, c.phone); added++;
    }
  })();
  res.json({ added, skipped });
});

app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
