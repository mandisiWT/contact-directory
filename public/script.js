// Sample data. Later, load this from a server with fetch('/api/contacts') instead.
const contacts = [
{name:"Nobuhle Gaqa", role:"HR Director", dept:"Human Resources", email:"nobuhle.gaqa@example.com", phone:"+27 31 555 0101"},
{name:"Natesha Balgobind", role:"Finance Director", dept:"Finance", email:"natesha.balgobind@example.com", phone:"+27 31 555 0102"},
{name:"Andrew Whitley", role:"Project Director", dept:"Projects", email:"andrew.whitley@example.com", phone:"+27 31 555 0103"},
{name:"Malusi Zamisa", role:"Finance Manager", dept:"Finance", email:"malusi.zamisa@example.com", phone:"+27 31 555 0142"},
{name:"Lethukuthula Ngubane", role:"Communication", dept:"Communication", email:"lethukuthula.ngubane@example.com", phone:"+27 31 555 0118"},
{name:"Amanda Hadebe", role:"Software Developer", dept:"ICT", email:"amanda.hadebe@example.com", phone:"+27 31 555 0127"},
{name:"Christina Mngomezulu", role:"HR Manager", dept:"Human Resource", email:"christina.mngomezulu@example.com", phone:"+27 31 555 0163"},
{name:"Gugulethu Maphalala", role:"HR Officer", dept:"Human Resource", email:"gugulethu.maphalala@example.com", phone:"+27 31 555 0135"},
{name:"Nokuthula Ngubane", role:"Accounts Clerk", dept:"Finance", email:"nokuthula.ngubane@example.com", phone:"+27 31 555 0171"},
{name:"Thulisiwe Mthembu", role:"Project Manager", dept:"Projects", email:"thulisiwe.mthembu@example.com", phone:"+27 31 555 0156"},
{name:"Samkelisiwe Manzini", role:"Hub Manager", dept:"Projects", email:"samkelisiwe.manzini@example.com", phone:"+27 31 555 0189"},
{name:"Roy Jones", role:"IT Systems Administrator", dept:"ICT", email:"roy.jones@example.com", phone:"+27 31 555 0124"},
{name:"Silindile Chilli", role:"Procurement Officer", dept:"Finance", email:"silindile.chilli@example.com", phone:"+27 31 555 0198"}

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
