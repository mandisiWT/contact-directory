const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));

let contacts = [], dept = "All", editingId = null, isAdmin = false, myName = "", role = "viewer";

async function api(url, opts = {}) {
  const r = await fetch(url, { headers: {"Content-Type":"application/json"}, credentials:"same-origin", ...opts });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && url !== "/api/login") { showLogin(); throw new Error("Please sign in."); }
  if (!r.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

// ----- views -----
function showLogin() {
  $("loginView").hidden = false; $("appView").hidden = true; $("userbar").hidden = true;
}
async function showApp(me) {
  role = me.role; isAdmin = role === "admin"; myName = me.username; $("addBtn").hidden = role === "viewer"; $("importBtn").hidden = role === "viewer";
  $("loginView").hidden = true; $("appView").hidden = false; $("userbar").hidden = false;
  $("who").textContent = me.username;
  contacts = await api("/api/contacts");
  renderChips(); render();
}

// ----- render -----
function renderChips() {
  const names = [...new Set(contacts.map(c => c.dept).filter(Boolean))].sort((a,b) => a.localeCompare(b));
  if (dept !== "All" && !names.includes(dept)) dept = "All";
  const n = d => contacts.filter(c => c.dept === d).length;
  $("deptSel").innerHTML = `<option value="All">All departments (${contacts.length})</option>` +
    names.map(d => `<option value="${esc(d)}">${esc(d)} (${n(d)})</option>`).join("");
  $("deptSel").value = dept;
  $("deptList").innerHTML = names.map(d => `<option value="${esc(d)}">`).join("");
}

function render() {
  const q = $("q").value.trim().toLowerCase();
  const list = contacts.filter(c =>
    (dept==="All" || c.dept===dept) &&
    (c.name+" "+c.role+" "+c.dept+" "+c.email).toLowerCase().includes(q));
  $("count").textContent = list.length + (list.length===1 ? " contact" : " contacts");
  $("grid").innerHTML = list.length ? list.map(c => {
    const ini = c.name.split(" ").map(w => w[0]).slice(0,2).join("");
    return `<article class="row">
      <div class="who"><div class="av">${esc(ini)}</div>
        <div><p class="name">${esc(c.name)}</p><p class="role">${esc(c.role)}</p></div></div>
      ${c.dept ? `<span class="dept">${esc(c.dept)}</span>` : "<span></span>"}
      ${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : "<span></span>"}
      ${c.phone ? `<a href="tel:${esc(c.phone.replace(/\s/g,""))}">${esc(c.phone)}</a>` : "<span></span>"}
      ${role !== "viewer" ? `<div class="actions">
        <button class="btn ghost sm" data-edit="${c.id}">Edit</button>
        <button class="btn danger sm" data-del="${c.id}">Delete</button>
      </div>` : "<span></span>"}
    </article>`;
  }).join("") : `<div class="empty">No contacts match your search. Try a different name or department.</div>`;
}

// ----- events -----
$("q").addEventListener("input", () => { render(); suggest(); });
$("deptSel").addEventListener("change", () => { dept = $("deptSel").value; render(); suggest(); });

$("loginForm").addEventListener("submit", async e => {
  e.preventDefault(); $("loginErr").textContent = "";
  try {
    const r = await api("/api/login", { method:"POST", body: JSON.stringify({ username: $("lu").value, password: $("lp").value }) });
    $("lp").value = ""; await showApp(r);
  } catch (err) { $("loginErr").textContent = err.message; }
});

$("logout").addEventListener("click", async () => {
  await fetch("/api/logout", { method:"POST" }); contacts = []; showLogin();
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
    $("dlg").close(); contacts = await api("/api/contacts"); renderChips(); render();
  } catch (err) { $("formErr").textContent = err.message; }
});

$("grid").addEventListener("click", async e => {
  const ed = e.target.closest("[data-edit]"), del = e.target.closest("[data-del]");
  if (ed) openForm(contacts.find(c => c.id === Number(ed.dataset.edit)));
  if (del) {
    const c = contacts.find(c => c.id === Number(del.dataset.del));
    if (!confirm(`Remove ${c.name} from the directory? This cannot be undone.`)) return;
    try { await api("/api/contacts/" + c.id, { method:"DELETE" }); contacts = contacts.filter(x => x.id !== c.id); renderChips(); render(); }
    catch (err) { alert(err.message); }
  }
});

// ----- start: are we already signed in? -----
fetch("/api/me", { credentials:"same-origin" })
  .then(r => r.ok ? r.json() : Promise.reject())
  .then(me => showApp(me))
  .catch(showLogin);

// ----- account & users -----
const say = (el, text, ok) => { el.className = ok ? "ok" : "err"; el.textContent = text; };

async function loadUsers() {
  const users = await api("/api/users");
  $("userList").innerHTML = users.map(u =>
    `<li><span>${esc(u.username)}</span><span class="uctl">` +
    (u.username === myName ? `<small>you (${esc(u.role)})</small>` :
      `<select data-rid="${u.id}" aria-label="Role for ${esc(u.username)}">${["viewer","editor","admin"].map(r => `<option value="${r}"${r===u.role?" selected":""}>${r}</option>`).join("")}</select>` +
      `<button class="btn danger sm" data-uid="${u.id}" data-uname="${esc(u.username)}">Remove</button>`) +
    `</span></li>`).join("");
}

$("acctBtn").addEventListener("click", async () => {
  $("pwForm").reset(); $("userForm").reset(); say($("pwMsg"), ""); say($("userMsg"), "");
  $("usersSec").hidden = !isAdmin;
  $("acctDlg").showModal();
  if (isAdmin) try { await loadUsers(); } catch (err) { say($("userMsg"), err.message); }
});
$("acctClose").addEventListener("click", () => $("acctDlg").close());

$("pwForm").addEventListener("submit", async e => {
  e.preventDefault();
  try {
    await api("/api/account/password", { method: "POST", body: JSON.stringify({ current: $("pw_cur").value, next: $("pw_new").value }) });
    $("pwForm").reset(); say($("pwMsg"), "Password updated.", true);
  } catch (err) { say($("pwMsg"), err.message); }
});

$("userForm").addEventListener("submit", async e => {
  e.preventDefault();
  try {
    await api("/api/users", { method: "POST", body: JSON.stringify({ username: $("nu_name").value, password: $("nu_pw").value, role: $("nu_role").value }) });
    $("userForm").reset(); say($("userMsg"), "User added.", true); await loadUsers();
  } catch (err) { say($("userMsg"), err.message); }
});

$("userList").addEventListener("click", async e => {
  const b = e.target.closest("[data-uid]"); if (!b) return;
  if (!confirm(`Remove user "${b.dataset.uname}"? They will no longer be able to sign in.`)) return;
  try { await api("/api/users/" + b.dataset.uid, { method: "DELETE" }); await loadUsers(); }
  catch (err) { say($("userMsg"), err.message); }
});

$("userList").addEventListener("change", async e => {
  const sel = e.target.closest("[data-rid]"); if (!sel) return;
  try { await api("/api/users/" + sel.dataset.rid + "/role", { method: "PUT", body: JSON.stringify({ role: sel.value }) }); say($("userMsg"), "Role updated.", true); }
  catch (err) { say($("userMsg"), err.message); await loadUsers(); }
});

// ----- type-ahead name suggestions (alphabetical) -----
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
function pick(i) { const c = sugItems[i]; if (!c) return; $("q").value = c.name; hideSugg(); render(); }
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

// ----- Excel import -----
$("importBtn").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  const m = $("importMsg"); say(m, "Importing " + f.name + "...", true);
  try {
    const r = await fetch("/api/contacts/import", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/octet-stream" }, body: f });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { showLogin(); return; }
    if (!r.ok) throw new Error(d.error || "Import failed.");
    contacts = await api("/api/contacts"); renderChips(); render();
    say(m, `Added ${d.added} contact${d.added === 1 ? "" : "s"}. Skipped ${d.skipped} (duplicates, missing name or invalid email).`, true);
  } catch (err) { say(m, err.message); }
});
