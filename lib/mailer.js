// Sends password-reset emails. Order of preference when several are set:
//   1. Brevo API  (BREVO_API_KEY + MAIL_FROM_EMAIL)            - HTTPS, works where SMTP ports are blocked
//   2. Brevo SMTP (BREVO_SMTP_LOGIN + BREVO_SMTP_KEY + MAIL_FROM_EMAIL)
//   3. Gmail      (GMAIL_USER + GMAIL_APP_PASSWORD)
const env = process.env;

function provider() {
  if (env.BREVO_API_KEY && env.MAIL_FROM_EMAIL) return 'brevo-api';
  if (env.BREVO_SMTP_LOGIN && env.BREVO_SMTP_KEY && env.MAIL_FROM_EMAIL) return 'brevo';
  if (env.GMAIL_USER && env.GMAIL_APP_PASSWORD) return 'gmail';
  return null;
}
const configured = () => provider() !== null;

function describe() {
  const p = provider();
  if (p === 'brevo-api') return `Brevo API over HTTPS (sending as ${env.MAIL_FROM_EMAIL})`;
  if (p === 'brevo') return `Brevo SMTP (sending as ${env.MAIL_FROM_EMAIL})`;
  if (p === 'gmail') return `Gmail account ${env.GMAIL_USER}`;
  if (env.BREVO_API_KEY || env.BREVO_SMTP_LOGIN || env.BREVO_SMTP_KEY)
    return 'NOT configured - Brevo needs MAIL_FROM_EMAIL (your verified Brevo sender) plus BREVO_API_KEY, or BREVO_SMTP_LOGIN and BREVO_SMTP_KEY';
  return 'NOT configured (set BREVO_API_KEY + MAIL_FROM_EMAIL, or BREVO_SMTP_LOGIN + BREVO_SMTP_KEY + MAIL_FROM_EMAIL, or GMAIL_USER + GMAIL_APP_PASSWORD)';
}

let transport = null;
function getTransport() {
  if (!transport) {
    const nodemailer = require('nodemailer');
    if (provider() === 'brevo') {
      transport = nodemailer.createTransport({
        host: 'smtp-relay.brevo.com',
        port: Number(env.BREVO_SMTP_PORT) || 587,      // 587 = STARTTLS (works for most networks); 2525 is the fallback
        secure: Number(env.BREVO_SMTP_PORT) === 465,
        auth: { user: env.BREVO_SMTP_LOGIN, pass: env.BREVO_SMTP_KEY }
      });
    } else {
      transport = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: env.GMAIL_USER, pass: String(env.GMAIL_APP_PASSWORD).replace(/\s+/g, '') }
      });
    }
  }
  return transport;
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Brevo's HTTPS API (POST /v3/smtp/email). Needs an API key, not an SMTP key.
async function sendViaBrevoApi({ fromName, fromAddress, to, subject, text, html }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { name: fromName, email: fromAddress }, to: [{ email: to }], subject, htmlContent: html, textContent: text }),
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) {
    let detail = '';
    try { const b = await res.json(); detail = b.message || b.code || ''; } catch { /* no body */ }
    throw new Error(`Brevo API answered ${res.status}${detail ? ': ' + detail : ''}`);
  }
}

async function sendResetEmail({ to, username, link, minutes }) {
  const p = provider();
  const fromAddress = p === 'gmail' ? (env.MAIL_FROM_EMAIL || env.GMAIL_USER) : env.MAIL_FROM_EMAIL;
  const fromName = (env.MAIL_FROM_NAME || 'Contact Directory').replace(/["<>\r\n]/g, '');
  const message = {
    subject: 'Reset your Contact Directory password',
    text: `Hi ${username},\n\nUse this link to choose a new password. It works once and expires in ${minutes} minutes:\n\n${link}\n\nIf you didn't ask for this, ignore this email. Your password has not been changed.`,
    html: `<p>Hi ${esc(username)},</p><p>Use the button below to choose a new password. The link works once and expires in ${minutes} minutes.</p>` +
      `<p><a href="${esc(link)}" style="background:#0b4f4a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Choose a new password</a></p>` +
      `<p style="color:#555">Or paste this address into your browser:<br>${esc(link)}</p>` +
      `<p style="color:#555">If you didn't ask for this, ignore this email. Your password has not been changed.</p>`
  };
  if (p === 'brevo-api') return sendViaBrevoApi({ fromName, fromAddress, to, ...message });
  await getTransport().sendMail({ from: `"${fromName}" <${fromAddress}>`, to, ...message });
}

module.exports = { configured, describe, sendResetEmail };
