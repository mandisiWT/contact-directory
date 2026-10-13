const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

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

// One-time import of your original contacts
if (db.prepare('SELECT COUNT(*) n FROM contacts').get().n === 0) {
  const seed = [
    ["Nobuhle Gaqa","HR Director","Human Resource","nobuhle.gaqa@example.com","+27 31 555 0101"],
    ["Natesha Balgobind","Finance Director","Finance","natesha.balgobind@example.com","+27 31 555 0102"],
    ["Andrew Whitley","Project Director","Projects","andrew.whitley@example.com","+27 31 555 0103"],
    ["Lethukuthula Ngubane","Communication","Communication","lethukuthula.ngubane@example.com","+27 31 555 0118"],
    ["Amanda Hadebe","Software Developer","ICT","amanda.hadebe@example.com","+27 31 555 0127"],
    ["Christina Mngomezulu","HR Manager","Human Resource","christina.mngomezulu@example.com","+27 31 555 0163"],
    ["Gugulethu Maphalala","HR Officer","Human Resource","gugulethu.maphalala@example.com","+27 31 555 0135"],
    ["Nokuthula Ngubane","Accounts Clerk","Finance","nokuthula.ngubane@example.com","+27 31 555 0171"],npm
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
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?,?)')
    .run('admin', bcrypt.hashSync(pw, 12));
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

const requireAuth = (req, res, next) =>
  req.session.userId ? next() : res.status(401).json({ error: 'Please sign in.' });

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
    res.json({ username: user.username });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireAuth, (req, res) => res.json({ username: req.session.username }));

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

app.post('/api/contacts', requireAuth, (req, res) => {
  const { c, error } = clean(req.body);
  if (error) return res.status(400).json({ error });
  const r = db.prepare('INSERT INTO contacts (name, role, dept, email, phone) VALUES (?,?,?,?,?)')
    .run(c.name, c.role, c.dept, c.email, c.phone);
  res.status(201).json({ id: r.lastInsertRowid, ...c });
});

app.put('/api/contacts/:id', requireAuth, (req, res) => {
  const { c, error } = clean(req.body);
  if (error) return res.status(400).json({ error });
  const r = db.prepare(`UPDATE contacts SET name=?, role=?, dept=?, email=?, phone=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(c.name, c.role, c.dept, c.email, c.phone, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Contact not found.' });
  res.json({ id: Number(req.params.id), ...c });
});

app.delete('/api/contacts/:id', requireAuth, (req, res) => {
  const r = db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Contact not found.' });
  res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
