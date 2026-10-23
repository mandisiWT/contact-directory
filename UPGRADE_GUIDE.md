# Contact Directory v1.2 - upgrade guide

Read this once, top to bottom, before you copy anything.

## 1. What is in this upgrade

| You asked for | Where it is |
|---|---|
| Fewer stored contacts (10) | `scripts/trim-contacts.js` (safe, with a dry run and a backup) |
| New look | New layout: side menu, one-line-per-person list, clearer buttons |
| Show 10 contacts per page, a way to reach the next page | Page buttons plus a highlighted note such as "3 more contacts on the next page" with a "See next 3" button |
| See every update and addition | **Activity** tab (admin only): who, when, and exactly what changed (old value -> new value) |
| Export a report of changes whenever you want | **Activity -> Export report** (CSV or Excel), respects the filters you set (type, dates, search) |
| Add/remove users and set permissions | **Users** tab: View only / Can edit / Admin, add, remove, set each person's email |
| Reset a password by email (Gmail) | "Forgot your password?" on the sign-in page, plus a reset page that opens from the emailed link |
| Choose exactly which contacts to export | Tick people one by one, "Select this page", or "Select all N matching". Ticks are kept when you change page |
| Follow the device's light/dark setting | Automatic. Switching the device setting changes the app straight away |

Your existing login accounts are **not changed**. See section 2.

## 2. Your logins

- Usernames, password hashes and roles are never rewritten by this upgrade. You do **not** need to change any password.
- The upgrade only adds: an optional `email` column on users, an `audit_log` table (the activity history), and a `password_resets` table.
- Before the database is upgraded for the first time, the app makes a full copy next to it, named `directory.db.backup-before-upgrade-<date>`.
- `scripts/trim-contacts.js` checks at the end that the users table is identical and prints "UNCHANGED". If it ever says otherwise it tells you to restore its backup.

If you ever want to change your password anyway: sign in, click **Account** (bottom left), use **Change password**.

## 3. Upgrade steps (running on your own computer)

1. **Stop the app** (press Ctrl+C in the terminal where it runs).
2. **Back up your database yourself.** In your project folder, copy these into a safe folder, for example `backup-before-v1.2`:
   - `directory.db`
   - `directory.db-wal`
   - `directory.db-shm`
   (The last two only exist while the app is running or if it was not closed cleanly. If they are missing, that is fine. Copy whichever exist.)
3. **Copy the new files over your project.** Unzip this package and copy its contents into your project folder, choosing "replace" when asked. This package contains **no database files on purpose**, so nothing in it can overwrite your `directory.db`.
4. In the project folder run: `npm install`
   (This adds the email library and refreshes `package-lock.json`.)
5. **Preview the trim to 10 contacts** (changes nothing):
   `node scripts/trim-contacts.js`
   Read the KEEP / remove list. It keeps people so that every department stays represented, taking the oldest entries first.
6. **Apply it** if you are happy:
   `node scripts/trim-contacts.js --apply`
   It saves a full backup (`directory.db.backup-before-trim-...`), saves the removed people to `removed-contacts-....csv`, removes them, writes each removal to the activity log, and proves the logins are unchanged.
   To keep a different number: `node scripts/trim-contacts.js --keep 12 --apply`
   To pick exactly who goes, remove them in the app instead (Delete button). Each removal is logged.
7. Start the app: `npm start`. Look at the terminal: it should print `Database: ...` and `Password-reset email: NOT configured` (until section 4).
8. Sign in with your usual admin login.

### Quick check that everything works (about 3 minutes)

- Directory shows 10 people on page 1, and a note about more on the next page if you have more than 10.
- Edit someone's phone number, then open **Activity**: the change is at the top, showing old -> new.
- **Activity -> Export report** downloads a file.
- **Users**: add a test user with "View only", sign in as them in a private window: no Add/Edit/Delete/Export, no Activity or Users tabs.
- Turn your computer's dark mode on and off: the app follows.

## 4. Password reset by Gmail (practice setup)

Gmail does not allow your normal password for apps. You use an **App Password**:

1. Go to your Google Account -> **Security**. Turn on **2-Step Verification** if it is off.
2. In the Google Account search box type **App passwords**, open it, create one named "Contact Directory". Google shows 16 letters. Copy them (spaces do not matter).
3. Give the app these settings, then start it.

**Windows (PowerShell), in the project folder:**
```
$env:GMAIL_USER="you@gmail.com"
$env:GMAIL_APP_PASSWORD="abcd efgh ijkl mnop"
$env:APP_URL="http://localhost:3000"
npm start
```
**Mac / Linux:**
```
export GMAIL_USER="you@gmail.com"
export GMAIL_APP_PASSWORD="abcd efgh ijkl mnop"
export APP_URL="http://localhost:3000"
npm start
```
The terminal should now say `Password-reset email: Gmail account you@gmail.com`.

4. Give your admin account an email: **Account** (bottom left) -> "Email for password resets". Other users: **Users** tab -> type the email -> Save.
5. Sign out, click **Forgot your password?**, enter your username or email. Check the inbox (and Spam). Click the link, choose a new password.

Notes:
- The link works once and expires after 30 minutes.
- The page always answers "If that account has an email on file..." whether or not the account exists. That is deliberate.
- A person with no email on file cannot reset by email. Add one in the Users tab first.
- Do not put the App Password in your code or in a zip. Keep it in settings only.

## 4b. Password reset by Brevo instead of Gmail

Brevo sends through its SMTP relay. The app uses Brevo automatically when these three settings exist (if Gmail settings also exist, Brevo wins).

1. In Brevo go to **Senders, Domains & Dedicated IPs -> Senders** and add the address you want emails to come from. Brevo emails it a confirmation link; click it. Only a verified sender works.
2. Go to **Settings (gear) -> SMTP & API -> SMTP tab**. Copy the **Login** shown there (it looks like `xxxxx@smtp-brevo.com`). Click **Generate a new SMTP key** and copy the key (starts with `xsmtpsib-`). Use the **SMTP key**, not an API key and not your Brevo password.
3. Start the app with these settings.

**Windows (PowerShell):**
```
$env:BREVO_SMTP_LOGIN="xxxxx@smtp-brevo.com"
$env:BREVO_SMTP_KEY="xsmtpsib-your-key-here"
$env:MAIL_FROM_EMAIL="your-verified-sender@example.com"
$env:MAIL_FROM_NAME="Contact Directory"
$env:APP_URL="http://localhost:3000"
npm.cmd start
```
**Mac / Linux:** the same, using `export NAME="value"` for each line and `npm start`.

The terminal should print `Password-reset email: Brevo SMTP (sending as ...)`.

Optional: `BREVO_SMTP_PORT` can be `2525` if port 587 is blocked on your network, or `465` for SSL.

Notes:
- `MAIL_FROM_EMAIL` must be exactly a sender you verified in Brevo, or Brevo rejects the message.
- If the sender is a free `@gmail.com` or `@outlook.com` address, messages are more likely to land in Spam. Fine for practice. For real use, verify your own domain in Brevo (DKIM/SPF).
- Brevo's free plan has a daily sending limit, which is plenty for password resets.
- Never put the SMTP key in code or in a zip.

## 4c. Password reset by the Brevo API (works where SMTP ports are blocked)

Render's free web services block the normal mail ports (25, 465, 587). The Brevo API sends over HTTPS instead, which is not blocked.

1. Verify a sender in Brevo (same as section 4b, step 1).
2. In Brevo: **Settings (gear) -> SMTP & API -> API Keys tab -> Generate a new API key**. Name it "Contact Directory" and copy it (starts with `xkeysib-`). This is a different key from the SMTP key.
3. Set these (locally or on Render):
   - `BREVO_API_KEY` = the API key
   - `MAIL_FROM_EMAIL` = your verified Brevo sender
   - optional `MAIL_FROM_NAME`
   - `APP_URL` = your site address
4. Restart. The terminal should print `Password-reset email: Brevo API over HTTPS (sending as ...)`.

If more than one method is set, the app uses the first of: Brevo API, Brevo SMTP, Gmail. To go back to SMTP, delete `BREVO_API_KEY`.

Errors appear in the terminal or Render logs as `Could not send reset email: Brevo API answered 401: ...` (wrong key) or `400/403` (sender not verified, or the IP/account restriction in Brevo's security settings).

## 5. Running on Render

Render's disk is wiped on every deploy unless you attach a Persistent Disk. That is what made your logins disappear before.

1. In Render, add a **Persistent Disk** to the service (for example mounted at `/var/data`).
2. In **Environment**, set:
   - `DB_PATH` = `/var/data/directory.db`
   - `SESSION_SECRET` = a long random text
   - `APP_URL` = your site address, e.g. `https://your-app.onrender.com` (no slash at the end)
   - Email settings: `GMAIL_USER` + `GMAIL_APP_PASSWORD` (section 4) `BREVO_SMTP_LOGIN` + `BREVO_SMTP_KEY` + `MAIL_FROM_EMAIL` (section 4b), or `BREVO_API_KEY` + `MAIL_FROM_EMAIL` (section 4c, the best choice on Render's free tier)
   - optional `REPORT_TIMEZONE` (default `Africa/Johannesburg`; used for the dates in exported reports)
   - `ADMIN_PASSWORD` only matters when the database is brand new (it becomes the admin's first password).
3. Upload your **existing** `directory.db` to `/var/data/` once (Render shell or SFTP), **before** the first start. If the app starts with no database file it creates a fresh one with a new admin password.
4. Redeploy.

## 6. Using the new features

- **Pages**: 10 contacts per page. The amber bar under the list says how many more there are and offers "See next N". Numbered buttons and Previous/Next are under it.
- **Exporting chosen people**: tick any people (ticks stay when you change pages), or use "Select this page" / "Select all N matching" (matches your current search and department), pick CSV or Excel, press **Export selected**. Only Can edit and Admin accounts can export.
- **Activity** (admin only): filter by type, date range or words. The report button exports **everything matching the filters**, not only the page you are looking at. Times in the report use `REPORT_TIMEZONE`. On screen they use your own time zone.
- History only exists from the moment you upgrade. Changes made before then were not recorded. The trimmed contacts appear as removals made by "Maintenance (trim script)".
- **Permissions**: View only = search and read. Can edit = add, edit, delete, import, export. Admin = all that plus users, permissions and Activity. You cannot change or remove your own account.

## 7. If something goes wrong

- **Cannot sign in after upgrading**: stop the app, delete the current `directory.db`, `directory.db-wal`, `directory.db-shm`, copy your three backed-up files back in, start the old version of the code. Then tell me what the terminal printed.
- **Went wrong during trim**: copy `directory.db.backup-before-trim-...` over `directory.db` (app stopped).
- **No email arrives**: check Spam; check the terminal for "Could not send reset email" (wrong App Password is the usual cause); make sure the user has an email in the Users tab; in production `APP_URL` must be set.
- **Terminal says the admin account was created with a password**: the app started with an empty/new database. Stop it, put your real `directory.db` in place, start again.
