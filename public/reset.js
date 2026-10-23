const $ = id => document.getElementById(id);
const token = new URLSearchParams(location.search).get("token") || "";
const show = id => { for (const p of ["checking", "formPanel", "donePanel", "badPanel"]) $(p).hidden = p !== id; };
const say = (text, ok) => { $("resetMsg").className = ok ? "ok" : "err"; $("resetMsg").textContent = text; };

// Keep the token out of the browser history once it has been read
if (token) history.replaceState(null, "", location.pathname);

(async () => {
  if (!token) return show("badPanel");
  try {
    const r = await fetch("/api/password/check?token=" + encodeURIComponent(token));
    const d = await r.json();
    show(d.valid ? "formPanel" : "badPanel");
  } catch { show("badPanel"); }
})();

$("resetForm").addEventListener("submit", async e => {
  e.preventDefault();
  if ($("np1").value !== $("np2").value) return say("The two passwords don't match.");
  if ($("np1").value.length < 8) return say("Password must be at least 8 characters.");
  $("resetBtn").disabled = true; say("Saving...", true);
  try {
    const r = await fetch("/api/password/reset", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: $("np1").value })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Could not reset the password.");
    show("donePanel");
  } catch (err) { say(err.message); $("resetBtn").disabled = false; }
});
