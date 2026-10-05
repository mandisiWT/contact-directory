// Sample data. Later, load this from a server with fetch('/api/contacts') instead.
const contacts = [
  {name:"Amara Nkosi", role:"Operations Manager", dept:"Operations", email:"amara.nkosi@example.com", phone:"+27 31 555 0101"},
  {name:"Daniel Pillay", role:"Senior Accountant", dept:"Finance", email:"daniel.pillay@example.com", phone:"+27 31 555 0102"},
  {name:"Lerato Mokoena", role:"Recruiter", dept:"People", email:"lerato.mokoena@example.com", phone:"+27 31 555 0103"},
  {name:"Sam Naidoo", role:"Software Engineer", dept:"Engineering", email:"sam.naidoo@example.com", phone:"+27 31 555 0104"},
  {name:"Chloe van Wyk", role:"Support Lead", dept:"Support", email:"chloe.vanwyk@example.com", phone:"+27 31 555 0105"},
  {name:"Thabo Dlamini", role:"Engineering Manager", dept:"Engineering", email:"thabo.dlamini@example.com", phone:"+27 31 555 0106"},
  {name:"Priya Govender", role:"Payroll Specialist", dept:"Finance", email:"priya.govender@example.com", phone:"+27 31 555 0107"},
  {name:"Jason Mthembu", role:"Logistics Coordinator", dept:"Operations", email:"jason.mthembu@example.com", phone:"+27 31 555 0108"},
  {name:"Nomsa Khumalo", role:"HR Business Partner", dept:"People", email:"nomsa.khumalo@example.com", phone:"+27 31 555 0109"}
]

const depts = ["All", ...new Set(contacts.map(c => c.dept))].sort((a,b) => a==="All" ? -1 : b==="All" ? 1 : a.localeCompare(b));
let dept = "All";
const $ = id => document.getElementById(id);
const esc = s => s.replace(/[&<>"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]));

function renderChips(){
  $("chips").innerHTML = depts.map(d =>
    `<button class="chip" aria-pressed="${d===dept}" data-d="${esc(d)}">${esc(d)}</button>`).join("");
}

function render(){
  const q = $("q").value.trim().toLowerCase();
  const list = contacts.filter(c =>
    (dept==="All" || c.dept===dept) &&
    (c.name+" "+c.role+" "+c.dept).toLowerCase().includes(q));
  $("count").textContent = list.length + (list.length===1 ? " contact" : " contacts");
  $("grid").innerHTML = list.length ? list.map(c => {
    const ini = c.name.split(" ").map(w => w[0]).slice(0,2).join("");
    return `<article class="card">
      <div class="top"><div class="av">${esc(ini)}</div>
        <div><p class="name">${esc(c.name)}</p><p class="role">${esc(c.role)}, ${esc(c.dept)}</p></div></div>
      <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>
      <a href="tel:${esc(c.phone.replace(/\s/g,""))}">${esc(c.phone)}</a>
    </article>`;
  }).join("") : `<div class="empty">No contacts match your search. Try a different name or department.</div>`;
}

$("q").addEventListener("input", render);
$("chips").addEventListener("click", e => {
  const b = e.target.closest("button"); if(!b) return;
  dept = b.dataset.d; renderChips(); render();
});
renderChips(); render();
