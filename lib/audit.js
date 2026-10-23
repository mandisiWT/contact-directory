// Activity log helpers: record what changed, list it, and describe it.
const FIELDS = [['name', 'Name'], ['role', 'Role'], ['dept', 'Department'], ['email', 'Email'], ['phone', 'Phone']];

const TYPE_GROUPS = {
  contacts: ['contact.create', 'contact.update', 'contact.delete', 'contact.import'],
  exports: ['contact.export'],
  users: ['user.create', 'user.delete', 'user.role', 'user.email'],
  passwords: ['password.change', 'password.reset', 'password.reset_request']
};

function record(db, actor, e) {
  db.prepare(`INSERT INTO audit_log (actor_id, actor, action, entity, entity_id, target, summary, details)
              VALUES (?,?,?,?,?,?,?,?)`).run(
    actor && actor.id != null ? actor.id : null,
    actor ? actor.username : 'system',
    e.action, e.entity || '', e.entityId == null ? null : e.entityId,
    e.target || '', e.summary || '',
    e.details ? JSON.stringify(e.details) : null);
}

function diffContact(before, after) {
  return FIELDS.filter(([k]) => String(before[k] ?? '') !== String(after[k] ?? ''))
    .map(([k, label]) => ({ field: k, label, from: String(before[k] ?? ''), to: String(after[k] ?? '') }));
}

function describeChanges(changes) {
  const show = v => (v === '' ? '(empty)' : v);
  return changes.map(c => `${c.label}: ${show(c.from)} -> ${show(c.to)}`).join('; ');
}

// ISO instant (from the browser) -> the 'YYYY-MM-DD HH:MM:SS' UTC format stored in the table
function isoToDb(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d) ? null : d.toISOString().slice(0, 19).replace('T', ' ');
}

function buildWhere(f = {}) {
  const where = [], args = [];
  const group = TYPE_GROUPS[f.type];
  if (group) { where.push(`action IN (${group.map(() => '?').join(',')})`); args.push(...group); }
  const from = isoToDb(f.from), to = isoToDb(f.to);
  if (from) { where.push('at >= ?'); args.push(from); }
  if (to) { where.push('at < ?'); args.push(to); }
  const q = String(f.q || '').trim().slice(0, 100);
  if (q) {
    const like = '%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%';
    where.push("(summary LIKE ? ESCAPE '\\' OR actor LIKE ? ESCAPE '\\' OR target LIKE ? ESCAPE '\\')");
    args.push(like, like, like);
  }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', args };
}

function list(db, f = {}) {
  const pageSize = Math.min(Math.max(parseInt(f.pageSize, 10) || 10, 1), 100);
  const { sql, args } = buildWhere(f);
  const total = db.prepare(`SELECT COUNT(*) n FROM audit_log ${sql}`).get(...args).n;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(parseInt(f.page, 10) || 1, 1), pages);
  const items = db.prepare(`SELECT id, at, actor, action, entity, target, summary, details
                            FROM audit_log ${sql} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, (page - 1) * pageSize)
    .map(r => ({ ...r, at: r.at.replace(' ', 'T') + 'Z', details: r.details ? safeJson(r.details) : null }));
  return { items, total, page, pages, pageSize };
}

function listAll(db, f = {}, limit = 50000) {
  const { sql, args } = buildWhere(f);
  return db.prepare(`SELECT at, actor, action, target, summary FROM audit_log ${sql} ORDER BY id DESC LIMIT ?`)
    .all(...args, limit);
}

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

const ACTION_LABELS = {
  'contact.create': 'Contact added', 'contact.update': 'Contact edited', 'contact.delete': 'Contact removed',
  'contact.import': 'Contacts imported', 'contact.export': 'Contacts exported',
  'user.create': 'User added', 'user.delete': 'User removed', 'user.role': 'Permission changed', 'user.email': 'User email changed',
  'password.change': 'Password changed', 'password.reset_request': 'Password reset requested', 'password.reset': 'Password reset by email'
};

// 'YYYY-MM-DD HH:MM:SS' (UTC) -> 'YYYY-MM-DD HH:MM:SS' in the given time zone
function formatWhen(dbTime, timeZone = 'Africa/Johannesburg') {
  const d = new Date(dbTime.replace(' ', 'T') + 'Z');
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

module.exports = { record, diffContact, describeChanges, list, listAll, formatWhen, ACTION_LABELS, TYPE_GROUPS };
