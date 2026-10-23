const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const say = (el, text, ok) => { el.className = ok ? "ok" : "err"; el.textContent = text; };

const PAGE_SIZE = 10;
let contacts = [], dept = "All", editingId = null, role = "viewer", myName = "", myEmail = "", mailOn = false;
let page = 1, tab = "directory";
const selectedIds = new Set();
const act = { page: 1, pages: 1, total: 0 };
const ROLE_LABEL = { viewer: "View only", editor: "Can edit", admin: "Admin" };

async function api(url, opts = {}) {
  const r = await fetch(url, { headers: {"Content-Type":"application/json"}, credentials:"same-origin", ...opts });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && url !== "/api/login") { showLogin(); throw new Error("Please sign in."); }
  if (!r.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

// Download a file from the server (so errors can be shown instead of a broken download)
async function download(url, opts, fallbackName) {
  const r = await fetch(url, { credentials: "same-origin", ...opts });
  if (r.status === 401) { showLogin(); throw new Error("Please sign in."); }
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Export failed."); }
  const blob = await r.blob();
  const m = /filename="?([^";]+)"?/.exec(r.headers.get("Content-Disposition") || "");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = m ? m[1] : fallbackName;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- views ----------
function showLogin() {
  $("loginView").hidden = false; $("appView").hidden = true;
  $("signinPanel").hidden = false; $("forgotPanel").hidden = true;
}
function setTab(name) {
  tab = name;
  for (const t of ["directory", "activity", "users"]) $("tab-" + t).hidden = t !== name;
  document.querySelectorAll("#tabs button").forEach(b => {
    if (b.dataset.tab === name) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  if (name === "activity") { act.page = 1; loadActivity(); }
  if (name === "users") loadUsers();
}
async function showApp(me) {
  role = me.role; myName = me.username; myEmail = me.email || ""; mailOn = !!me.emailEnabled; page = 1;
  const canEdit = role !== "viewer", isAdmin = role === "admin";
  $("addBtn").hidden = !canEdit; $("importBtn").hidden = !canEdit; $("exportPanel").hidden = !canEdit;
  $("listWrap").classList.toggle("selectable", canEdit);
  document.querySelector('[data-tab="activity"]').hidden = !isAdmin;
  document.querySelector('[data-tab="users"]').hidden = !isAdmin;
  $("who").textContent = me.username; $("whoRole").textContent = ROLE_LABEL[role] || role;
  $("loginView").hidden = true; $("appView").hidden = false;
  setTab("directory");
  contacts = await api("/api/contacts");
  renderDepts(); render();
}
async function reloadContacts() { contacts = await api("/api/contacts"); renderDepts(); render(); }

// ---------- directory ----------
function renderDepts() {
  const names = [...new Set(contacts.map(c => c.dept).filter(Boolean))].sort((a,b) => a.localeCompare(b));
  if (dept !== "All" && !names.includes(dept)) dept = "All";
  const n = d => contacts.filter(c => c.dept === d).length;
  $("deptSel").innerHTML = `<option value="All">All departments (${contacts.length})</option>` +
    names.map(d => `<option value="${esc(d)}">${esc(d)} (${n(d)})</option>`).join("");
  $("deptSel").value = dept;
  $("deptList").innerHTML = names.map(d => `<option value="${esc(d)}">`).join("");
}

function filteredContacts() {
  const q = $("q").value.trim().toLowerCase();
  return contacts.filter(c =>
    (dept === "All" || c.dept === dept) &&
    (c.name+" "+c.role+" "+c.dept+" "+c.email+" "+c.phone).toLowerCase().includes(q));
}

// Page buttons: 1 2 3 ... 9 10  (works for any number of pages)
function renderPager(el, cur, pages, onGo) {
  el.hidden = pages <= 1;
  if (pages <= 1) { el.innerHTML = ""; return; }
  const nums = new Set([1, pages, cur - 1, cur, cur + 1]);
  const list = [...nums].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
  let html = `<button class="pg" type="button" data-go="${cur - 1}" ${cur <= 1 ? "disabled" : ""}>Previous</button>`;
  list.forEach((n, i) => {
    if (i && n - list[i - 1] > 1) html += `<span class="gap" aria-hidden="true">&hellip;</span>`;
    html += `<button class="pg" type="button" data-go="${n}" ${n === cur ? 'aria-current="page"' : ""} aria-label="Page ${n}">${n}</button>`;
  });
  html += `<button class="pg" type="button" data-go="${cur + 1}" ${cur >= pages ? "disabled" : ""}>Next</button>`;
  el.innerHTML = html;
  el.onclick = e => { const b = e.target.closest("[data-go]"); if (b && !b.disabled) onGo(Number(b.dataset.go)); };
}

function updateSelectionUI(filtered, pageList) {
  const valid = new Set(contacts.map(c => c.id));
  for (const id of selectedIds) if (!valid.has(id)) selectedIds.delete(id);
  const n = selectedIds.size;
  $("exportCount").textContent = n ? `${n} selected${n > pageList.filter(c => selectedIds.has(c.id)).length ? " (including other pages)" : ""}` : "Nobody selected";
  $("exportBtn").disabled = n === 0;
  const onPage = pageList.filter(c => selectedIds.has(c.id)).length;
  $("selectPage").checked = pageList.length > 0 && onPage === pageList.length;
  $("selectPage").indeterminate = onPage > 0 && onPage < pageList.length;
  const missing = filtered.filter(c => !selectedIds.has(c.id)).length;
  const all = $("selectAllBtn");
  all.hidden = !(filtered.length > pageList.length && missing > 0);
  all.textContent = `Select all ${filtered.length} matching`;
}

function render() {
  const all = filteredContacts();
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  page = Math.min(Math.max(page, 1), pages);
  const start = (page - 1) * PAGE_SIZE, list = all.slice(start, start + PAGE_SIZE);
  const filtering = all.length !== contacts.length;
  $("headCount").textContent = filtering ? `${all.length} of ${contacts.length} contacts match` : `${contacts.length} contact${contacts.length === 1 ? "" : "s"}`;
  const canEdit = role !== "viewer";

  $("grid").innerHTML = list.length ? list.map(c => {
    const ini = c.name.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
    return `<article class="row${selectedIds.has(c.id) ? " picked" : ""}">
      ${canEdit ? `<label class="sel"><input type="checkbox" data-select="${c.id}" ${selectedIds.has(c.id) ? "checked" : ""} aria-label="Select ${esc(c.name)} for export"></label>` : ""}
      <div class="who"><div class="av" aria-hidden="true">${esc(ini)}</div>
        <div><p class="name">${esc(c.name)}</p><p class="role">${esc(c.role)}</p></div></div>
      ${c.dept ? `<span class="dept">${esc(c.dept)}</span>` : "<span></span>"}
      <div class="contact">
        ${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ""}
        ${c.phone ? `<a href="tel:${esc(c.phone.replace(/\s/g, ""))}">${esc(c.phone)}</a>` : ""}
      </div>
      ${canEdit ? `<div class="actions"><button class="btn ghost sm" data-edit="${c.id}" type="button">Edit</button><button class="btn danger sm" data-del="${c.id}" type="button">Delete</button></div>` : "<span></span>"}
    </article>`;
  }).join("") : `<div class="empty">${contacts.length ? "No contacts match your search. Try a different name or department." : "The directory is empty."}</div>`;

  // "More contacts on the next page" indicator
  const more = $("moreNote");
  if (all.length && pages > 1) {
    more.hidden = false;
    if (page < pages) {
      const left = all.length - (start + list.length), nextCount = Math.min(PAGE_SIZE, left);
      more.className = "more";
      more.innerHTML = `<span>Showing ${start + 1}\u2013${start + list.length} of ${all.length}. ${left} more contact${left === 1 ? "" : "s"} on the next page.</span><button class="btn sm" type="button" id="moreBtn">See next ${nextCount}</button>`;
      $("moreBtn").onclick = () => goPage(page + 1);
    } else {
      more.className = "more end";
      more.innerHTML = `<span>Showing ${start + 1}\u2013${start + list.length} of ${all.length}. That is the last page.</span><button class="btn sm" type="button" id="moreBtn">Back to page ${page - 1}</button>`;
      $("moreBtn").onclick = () => goPage(page - 1);
    }
  } else if (all.length) {
    more.hidden = false; more.className = "more end";
    more.innerHTML = `<span>Showing all ${all.length} contact${all.length === 1 ? "" : "s"}.</span>`;
  } else more.hidden = true;

  renderPager($("pager"), page, pages, goPage);
  if (canEdit) updateSelectionUI(all, list);
}
function goPage(n) { page = n; render(); $("headCount").scrollIntoView({ behavior: "smooth", block: "start" }); }

// ---------- directory events ----------
$("q").addEventListener("input", () => { page = 1; render(); suggest(); });
$("deptSel").addEventListener("change", () => { dept = $("deptSel").value; page = 1; render(); suggest(); });

$("selectPage").addEventListener("change", () => {
  const all = filteredContacts(), list = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  list.forEach(c => $("selectPage").checked ? selectedIds.add(c.id) : selectedIds.delete(c.id));
  render();
});
$("selectAllBtn").addEventListener("click", () => { filteredContacts().forEach(c => selectedIds.add(c.id)); render(); });
$("clearSelection").addEventListener("click", () => { selectedIds.clear(); render(); say($("exportMsg"), "", true); });
$("grid").addEventListener("change", e => {
  const box = e.target.closest("[data-select]"); if (!box) return;
  const id = Number(box.dataset.select);
  if (box.checked) selectedIds.add(id); else selectedIds.delete(id);
  box.closest(".row").classList.toggle("picked", box.checked);
  const all = filteredContacts(); updateSelectionUI(all, all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE));
});
$("exportBtn").addEventListener("click", async () => {
  const msg = $("exportMsg"), n = selectedIds.size, fmt = $("exportFormat").value;
  say(msg, "Preparing export...", true);
  try {
    await download("/api/contacts/export", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ ids: [...selectedIds], format: fmt }) }, fmt === "xlsx" ? "contacts.xlsx" : "contacts.csv");
    say(msg, `Exported ${n} contact${n === 1 ? "" : "s"}.`, true);
  } catch (err) { say(msg, err.message); }
});

function openForm(c) {
  editingId = c ? c.id : null;
  $("dlgTitle").textContent = c ? "Edit contact" : "Add contact";
  for (const k of ["name","role","dept","email","phone"]) $("f_"+k).value = c ? c[k] : "";
  $("formErr").textContent = ""; $("dlg").showModal();
}
$("addBtn").addEventListener("click", () => openForm(null));
$("cancel").addEventListener("click", () => $("dlg").close());
$("contactForm").addEventListener("submit", async e => {
  e.preventDefault(); $("formErr").textContent = "";
  const body = JSON.stringify(Object.fromEntries(["name","role","dept","email","phone"].map(k => [k, $("f_"+k).value])));
  try {
    if (editingId) await api("/api/contacts/" + editingId, { method:"PUT", body });
    else await api("/api/contacts", { method:"POST", body });
    $("dlg").close(); await reloadContacts();
  } catch (err) { $("formErr").textContent = err.message; }
});
$("grid").addEventListener("click", async e => {
  const ed = e.target.closest("[data-edit]"), del = e.target.closest("[data-del]");
  if (ed) openForm(contacts.find(c => c.id === Number(ed.dataset.edit)));
  if (del) {
    const c = contacts.find(c => c.id === Number(del.dataset.del));
    if (!confirm(`Remove ${c.name} from the directory? The removal will be recorded in the activity log.`)) return;
    try { await api("/api/contacts/" + c.id, { method:"DELETE" }); selectedIds.delete(c.id); await reloadContacts(); }
    catch (err) { alert(err.message); }
  }
});

// ---------- sign in / out / forgot password ----------
$("loginForm").addEventListener("submit", async e => {
  e.preventDefault(); $("loginErr").textContent = "";
  try {
    const r = await api("/api/login", { method:"POST", body: JSON.stringify({ username: $("lu").value, password: $("lp").value }) });
    $("lp").value = ""; setPwVisible(false); await showApp(r);
  } catch (err) { $("loginErr").textContent = err.message; }
});
$("logout").addEventListener("click", async () => {
  await fetch("/api/logout", { method:"POST" }); contacts = []; selectedIds.clear(); showLogin();
});
$("forgotLink").addEventListener("click", () => {
  $("signinPanel").hidden = true; $("forgotPanel").hidden = false; say($("forgotMsg"), "", true);
  $("fid").value = $("lu").value; $("fid").focus();
});
$("backToSignin").addEventListener("click", () => { $("forgotPanel").hidden = true; $("signinPanel").hidden = false; });
$("forgotForm").addEventListener("submit", async e => {
  e.preventDefault(); $("forgotBtn").disabled = true; say($("forgotMsg"), "Sending...", true);
  try {
    const d = await api("/api/password/forgot", { method: "POST", body: JSON.stringify({ identifier: $("fid").value }) });
    say($("forgotMsg"), d.message, true);
  } catch (err) { say($("forgotMsg"), err.message); }
  setTimeout(() => { $("forgotBtn").disabled = false; }, 4000);
});
function setPwVisible(on) {
  $("lp").type = on ? "text" : "password";
  $("togglePw").textContent = on ? "Hide" : "Show";
  $("togglePw").setAttribute("aria-pressed", on);
}
$("togglePw").addEventListener("click", () => setPwVisible($("lp").type === "password"));

// ---------- tabs ----------
$("tabs").addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (b && !b.hidden) setTab(b.dataset.tab); });

// ---------- activity (admin) ----------
const ACT_LABEL = {
  "contact.create": ["Contact added", "add"], "contact.update": ["Contact edited", "edit"], "contact.delete": ["Contact removed", "del"],
  "contact.import": ["Contacts imported", "add"], "contact.export": ["Contacts exported", ""],
  "user.create": ["User added", "add"], "user.delete": ["User removed", "del"], "user.role": ["Permission changed", "edit"], "user.email": ["Email changed", "edit"],
  "password.change": ["Password changed", "edit"], "password.reset_request": ["Reset requested", ""], "password.reset": ["Password reset", "edit"]
};
function actQuery() {
  const p = new URLSearchParams();
  if ($("actType").value) p.set("type", $("actType").value);
  if ($("actFrom").value) p.set("from", new Date($("actFrom").value + "T00:00:00").toISOString());
  if ($("actTo").value) { const d = new Date($("actTo").value + "T00:00:00"); d.setDate(d.getDate() + 1); p.set("to", d.toISOString()); }
  if ($("actQ").value.trim()) p.set("q", $("actQ").value.trim());
  return p;
}
async function loadActivity() {
  const p = actQuery(); p.set("page", act.page);
  try {
    const d = await api("/api/audit?" + p);
    act.page = d.page; act.pages = d.pages; act.total = d.total;
    const first = d.total ? (d.page - 1) * d.pageSize + 1 : 0;
    $("actCount").textContent = d.total ? `${d.total} event${d.total === 1 ? "" : "s"} - showing ${first}\u2013${first + d.items.length - 1}` : "No events match these filters";
    $("actList").innerHTML = `<div class="thead" aria-hidden="true"><span>When</span><span>Who</span><span>What</span><span>Details</span></div>` +
      (d.items.length ? d.items.map(actRow).join("") : `<div class="empty">Nothing recorded for these filters yet. Changes made from now on will appear here.</div>`);
    renderPager($("actPager"), d.page, d.pages, n => { act.page = n; loadActivity(); });
    say($("actMsg"), "", true);
  } catch (err) { say($("actMsg"), err.message); }
}
function actRow(r) {
  const [label, kind] = ACT_LABEL[r.action] || [r.action, ""];
  const when = new Date(r.at).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  let what;
  if (r.action === "contact.update" && r.details && r.details.changes) {
    const show = v => v === "" ? "(empty)" : esc(v);
    what = `<b>${esc(r.target)}</b>` + r.details.changes.map(c => `<span class="chg">${esc(c.label)}: <s>${show(c.from)}</s> &rarr; <i>${show(c.to)}</i></span>`).join("");
  } else if (r.action === "contact.import" || r.action === "contact.export") {
    what = `<b>${esc(r.target)}</b><span class="chg">${esc(r.summary)}</span>`;
  } else what = `<b>${esc(r.target || "")}</b><span class="chg">${esc(r.summary)}</span>`;
  return `<article class="row"><span class="when">${esc(when)}</span><span class="by">${esc(r.actor)}</span><span class="badge ${kind}">${esc(label)}</span><div class="what">${what}</div></article>`;
}
$("actForm").addEventListener("change", () => { act.page = 1; loadActivity(); });
$("actForm").addEventListener("submit", e => e.preventDefault());
let actTimer; $("actQ").addEventListener("input", () => { clearTimeout(actTimer); actTimer = setTimeout(() => { act.page = 1; loadActivity(); }, 300); });
$("actReset").addEventListener("click", () => { $("actForm").reset(); act.page = 1; loadActivity(); });
$("actExport").addEventListener("click", async () => {
  const p = actQuery(); p.set("format", $("actFormat").value);
  say($("actMsg"), "Preparing report...", true);
  try { await download("/api/audit/export?" + p, {}, "activity-report." + $("actFormat").value); say($("actMsg"), "Report downloaded. It contains every event matching the filters above, not just this page.", true); }
  catch (err) { say($("actMsg"), err.message); }
});

// ---------- users (admin) ----------
async function loadUsers() {
  $("mailNotice").hidden = mailOn;
  try {
    const users = await api("/api/users");
    $("userList").innerHTML = `<div class="thead" aria-hidden="true"><span>Username</span><span>Email for password reset</span><span>Permission</span><span></span></div>` +
      users.map(u => {
        const me = u.username === myName;
        return `<article class="row">
          <span><b>${esc(u.username)}</b>${me ? ' <small class="muted">(you)</small>' : ""}</span>
          <div class="mailcell"><input type="email" value="${esc(u.email)}" placeholder="No email on file" data-mail="${u.id}" aria-label="Email for ${esc(u.username)}" maxlength="200"><button class="btn ghost sm" type="button" data-savemail="${u.id}">Save</button></div>
          ${me ? `<span class="muted">${esc(ROLE_LABEL[u.role] || u.role)}</span>` :
            `<select data-rid="${u.id}" aria-label="Permission for ${esc(u.username)}">${["viewer","editor","admin"].map(r => `<option value="${r}"${r === u.role ? " selected" : ""}>${ROLE_LABEL[r]}</option>`).join("")}</select>`}
          ${me ? "<span></span>" : `<div class="actions"><button class="btn danger sm" type="button" data-uid="${u.id}" data-uname="${esc(u.username)}">Remove</button></div>`}
        </article>`;
      }).join("");
  } catch (err) { say($("userMsg"), err.message); }
}
$("addUserBtn").addEventListener("click", () => { $("userForm").reset(); $("userFormErr").textContent = ""; $("userDlg").showModal(); });
$("userCancel").addEventListener("click", () => $("userDlg").close());
$("userForm").addEventListener("submit", async e => {
  e.preventDefault();
  try {
    await api("/api/users", { method: "POST", body: JSON.stringify({ username: $("nu_name").value, email: $("nu_email").value, password: $("nu_pw").value, role: $("nu_role").value }) });
    $("userDlg").close(); say($("userMsg"), "User added.", true); await loadUsers();
  } catch (err) { $("userFormErr").textContent = err.message; }
});
$("userList").addEventListener("click", async e => {
  const rm = e.target.closest("[data-uid]"), sv = e.target.closest("[data-savemail]");
  if (rm) {
    if (!confirm(`Remove user "${rm.dataset.uname}"? They will no longer be able to sign in. This is recorded in the activity log.`)) return;
    try { await api("/api/users/" + rm.dataset.uid, { method: "DELETE" }); say($("userMsg"), "User removed.", true); await loadUsers(); }
    catch (err) { say($("userMsg"), err.message); }
  }
  if (sv) {
    const input = document.querySelector(`[data-mail="${sv.dataset.savemail}"]`);
    try { await api(`/api/users/${sv.dataset.savemail}/email`, { method: "PUT", body: JSON.stringify({ email: input.value }) }); say($("userMsg"), "Email saved.", true); }
    catch (err) { say($("userMsg"), err.message); }
  }
});
$("userList").addEventListener("change", async e => {
  const sel = e.target.closest("[data-rid]"); if (!sel) return;
  try { await api(`/api/users/${sel.dataset.rid}/role`, { method: "PUT", body: JSON.stringify({ role: sel.value }) }); say($("userMsg"), "Permission updated.", true); }
  catch (err) { say($("userMsg"), err.message); await loadUsers(); }
});

// ---------- your account ----------
$("acctBtn").addEventListener("click", () => {
  $("pwForm").reset(); $("mailForm").reset(); say($("pwMsg"), "", true); say($("emMsg"), "", true);
  $("em_new").value = myEmail;
  $("acctDlg").showModal();
});
$("acctClose").addEventListener("click", () => $("acctDlg").close());
$("pwForm").addEventListener("submit", async e => {
  e.preventDefault();
  try {
    await api("/api/account/password", { method: "POST", body: JSON.stringify({ current: $("pw_cur").value, next: $("pw_new").value }) });
    $("pwForm").reset(); say($("pwMsg"), "Password updated.", true);
  } catch (err) { say($("pwMsg"), err.message); }
});
$("mailForm").addEventListener("submit", async e => {
  e.preventDefault();
  try {
    const d = await api("/api/account/email", { method: "PUT", body: JSON.stringify({ email: $("em_new").value, current: $("em_cur").value }) });
    myEmail = d.email; $("em_cur").value = ""; say($("emMsg"), "Email saved.", true);
  } catch (err) { say($("emMsg"), err.message); }
});

// ---------- type-ahead name suggestions ----------
let sugItems = [], sugIdx = -1;
function hideSugg() { $("sugg").hidden = true; sugIdx = -1; $("q").setAttribute("aria-expanded", "false"); }
function suggest() {
  const q = $("q").value.trim().toLowerCase();
  if (!q) return hideSugg();
  const pool = contacts.filter(c => dept === "All" || c.dept === dept);
  const byName = (a, b) => a.name.localeCompare(b.name);
  const first = [], other = [];
  pool.forEach(c => {
    const n = c.name.toLowerCase();
    if (n.startsWith(q)) first.push(c);
    else if (n.split(/\s+/).some(w => w.startsWith(q))) other.push(c);
  });
  sugItems = [...first.sort(byName), ...other.sort(byName)].slice(0, 8);
  if (!sugItems.length) return hideSugg();
  sugIdx = -1;
  $("sugg").innerHTML = sugItems.map((c, i) =>
    `<li role="option" id="sg${i}" data-i="${i}"><span>${esc(c.name)}</span><small>${esc(c.dept || c.role)}</small></li>`).join("");
  $("sugg").hidden = false; $("q").setAttribute("aria-expanded", "true");
}
function pick(i) { const c = sugItems[i]; if (!c) return; $("q").value = c.name; hideSugg(); page = 1; render(); }
function markSugg() {
  [...$("sugg").children].forEach((li, i) => li.setAttribute("aria-selected", i === sugIdx));
  $("q").setAttribute("aria-activedescendant", sugIdx >= 0 ? "sg" + sugIdx : "");
}
$("q").setAttribute("role", "combobox"); $("q").setAttribute("aria-controls", "sugg"); $("q").setAttribute("aria-expanded", "false");
$("q").addEventListener("keydown", e => {
  if ($("sugg").hidden) return;
  if (e.key === "ArrowDown") { e.preventDefault(); sugIdx = (sugIdx + 1) % sugItems.length; markSugg(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); sugIdx = (sugIdx - 1 + sugItems.length) % sugItems.length; markSugg(); }
  else if (e.key === "Enter" && sugIdx >= 0) { e.preventDefault(); pick(sugIdx); }
  else if (e.key === "Escape") hideSugg();
});
$("sugg").addEventListener("mousedown", e => { const li = e.target.closest("li"); if (li) { e.preventDefault(); pick(Number(li.dataset.i)); } });
document.addEventListener("click", e => { if (!e.target.closest(".sw")) hideSugg(); });

// ---------- Excel import (with column mapping) ----------
const FIELD_LABELS = { name:"Full name", first:"First name", last:"Last name", role:"Role", dept:"Department", email:"Email", phone:"Phone" };
let impFile = null;
async function upload(url, file) {
  const r = await fetch(url, { method:"POST", credentials:"same-origin", headers:{"Content-Type":"application/octet-stream"}, body:file });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) { showLogin(); throw new Error("Please sign in."); }
  if (!r.ok) throw new Error(d.error || "Import failed.");
  return d;
}
$("importBtn").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  const m = $("importMsg"); say(m, "Reading " + f.name + "...", true);
  try {
    const p = await upload("/api/contacts/import/preview", f);
    impFile = f; say(m, "", true);
    $("impInfo").textContent = `${f.name}: ${p.total} row${p.total === 1 ? "" : "s"} found. Match each field to a column in your spreadsheet.`;
    $("impMap").innerHTML = Object.keys(FIELD_LABELS).map(k =>
      `<label>${FIELD_LABELS[k]}<select data-f="${k}"><option value="-1">(none)</option>` +
      p.headers.map((h, i) => `<option value="${i}"${p.suggested[k] === i ? " selected" : ""}>${esc(h)}</option>`).join("") +
      `</select></label>`).join("");
    $("impSample").innerHTML = `<table><thead><tr>${p.headers.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>` +
      p.sample.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("") + `</tbody></table>`;
    $("impErr").textContent = ""; $("impDlg").showModal();
  } catch (err) { say(m, err.message); }
});
$("impCancel").addEventListener("click", () => $("impDlg").close());
$("impForm").addEventListener("submit", async e => {
  e.preventDefault();
  const map = {};
  document.querySelectorAll("#impMap select").forEach(s => map[s.dataset.f] = Number(s.value));
  if (map.name < 0 && map.first < 0 && map.last < 0) { $("impErr").textContent = "Choose a column for Full name, or for First name and/or Last name."; return; }
  try {
    const d = await upload("/api/contacts/import?map=" + encodeURIComponent(JSON.stringify(map)), impFile);
    $("impDlg").close(); await reloadContacts();
    say($("importMsg"), `Added ${d.added} contact${d.added === 1 ? "" : "s"}. Skipped ${d.skipped} (duplicates, missing name or invalid email).`, true);
  } catch (err) { $("impErr").textContent = err.message; }
});

// ---------- start: are we already signed in? ----------
fetch("/api/me", { credentials:"same-origin" })
  .then(r => r.ok ? r.json() : Promise.reject())
  .then(me => showApp(me))
  .catch(showLogin);
