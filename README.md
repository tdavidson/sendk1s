# Secure K1 Delivery

Auto-redact SSNs, encrypt PDFs, and send K1s securely from Gmail without exposing investor data. Created by Taylor Davidson of [Hemrock](https://www.hemrock.com).

## What it does

Takes a folder of K1 PDFs and processes them for secure distribution. Automatically redacts SSNs/TINs, encrypts each PDF with unique passwords, and sends them directly through your Gmail. Everything runs locally on your machine — no data uploads to external services. Supports bulk processing and includes a web interface for easy operation.

![Web UI overview](overview.jpeg)

## Why

Every unencrypted K1 sent via email is a potential data breach. One forwarded email exposes investor SSNs to your entire network.

## How it works

• **Local processing** — Web UI runs on localhost, all PDFs stay on your machine
• **Smart redaction** — Automatically finds and redacts the receiving party's SSN/TIN while preserving other data
• **Unique encryption** — Each PDF gets password-protected using last 4 digits of SSN plus ZIP code
• **Gmail integration** — OAuth setup sends encrypted K1s directly through your Gmail account
• **Bulk operations** — Process hundreds of K1s in minutes with CSV-based recipient matching

## Get started

```bash
npm install
brew install pdftk-java
cp .env.example .env
npm run ui
```

Open http://localhost:3000 and follow the web interface to authorize Gmail and process your K1s.

Created by Taylor Davidson of [Hemrock](https://www.hemrock.com). Questions, ask anytime.

## Detailed Setup

### 1. Install dependencies

```bash
npm install
```

Requires Node.js. Install PDFtk for encryption (or qpdf if you use redaction first):

```bash
brew install pdftk-java
```

### 2. Configure environment

Copy the example env file and edit with your values:

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

| Variable | Required for | Description |
|----------|---------------|-------------|
| `FROM_EMAIL` | Gmail, SendGrid | Sender email address |
| `FROM_NAME` | Gmail, SendGrid | Sender display name |
| `TEST_SEND_EMAIL` | Test send | Address to receive test emails |
| `SENDGRID_API_KEY` | SendGrid | SendGrid API key (if using SendGrid) |

Optional:

| Variable | Description |
|----------|-------------|
| `USE_QPDF` | Set to `1` to use qpdf instead of PDFtk (preserves fonts after redaction) |
| `CREDENTIALS_PATH` | Path to Gmail OAuth credentials (default: project root) |
| `TOKEN_PATH` | Path to Gmail OAuth token (default: project root) |
| `IGNORE_FOLDER` | Base folder for sensitive output (default: `ignore`) |
| `FONT_PATH` | Path to redaction overlay font (default: `fonts/CourierPrime-Regular.ttf`) |

### 3. Sensitive files

Keep confidential documents in the `ignore/` folder (it is gitignored):

- Put K-1 PDFs in a subfolder (e.g. `ignore/2025_fund_name/original/`)
- Place `credentials.json` and `token.json` in the project root for Gmail (they are gitignored)
- Password CSVs are written next to the fund folder (e.g. `ignore/2025_fund/k1_passwords_original.csv`)

### 4. Web UI

A minimal web interface lets you run prepare, test-match, and send operations from the browser.

**Start the UI:**

```bash
npm run ui
```

Open http://localhost:3000 (or the next available port if 3000 is in use).

**How it works:**

- **Prepare** — Choose redact only, encrypt only, or both. Select the folder containing your original PDFs (e.g. `ignore/2025_fund/original`). The UI runs the same scripts as the CLI.
- **Gmail authorization** — If you have `credentials.json` but no `token.json`, the UI shows an authorization section. Click "Authorize Gmail", sign in with Google — you're redirected back automatically. Add the shown redirect URI to your Google Cloud Console OAuth client if needed.
- **Test matching** — Select the `_protected` or `_redacted_protected` PDF folder and LP CSV to verify each LP has exactly one matching PDF.
- **Test send** — Send one LP's K-1 to a test address. Set the test email in the UI (or it uses `TEST_SEND_EMAIL` from `.env`). Pick which LP by row number.
- **Full send** — Send all K-1s via Gmail. Requires confirmation before sending.

Dropdowns list folders and files from `ignore/` and `example/`. The UI calls the underlying Node scripts; no PDFs or passwords are sent to the browser.

**Security:**

- The UI runs on **localhost only** — it does not listen on external interfaces.
- All processing happens on your machine. The browser only sends form data (paths, options) to the local server.
- PDFs, passwords, and credentials stay on disk. The server spawns the same CLI scripts you would run manually.
- Use the UI only on a trusted machine. Do not expose the server to a network.

---

## Typical workflow

1. **Prepare** K-1 PDFs: redact (optional) and encrypt
2. **Test matching** to verify PDF filenames match your LP CSV before sending
3. **Send** K-1s via Gmail or SendGrid

---

## prepare_k1s.js (redact + encrypt)

One-step or step-by-step preparation of K-1 PDFs.

**Usage:** `npm run prepare-k1s -- <input_path>` (input path is required)

| Command | Description |
|---------|-------------|
| `npm run prepare-k1s -- ignore/2025_fund` | Redact, then encrypt (both) |
| `npm run prepare-k1s-redact -- ignore/2025_fund` | Redact only |
| `npm run prepare-k1s-encrypt -- ignore/2025_fund_redacted` | Encrypt only |

For `--both` (default): input is the original PDF folder; output is `..._redacted` then `..._redacted_protected`.

---

## redact_k1.js (optional)

Redacts the **receiving party's** SSN/TIN (the second identifier on the page) when it is currently **unredacted**. Covers the number with a white rectangle and prints the redacted form on top (e.g. `**-***0337` for TIN, `***-**-7876` for SSN). PDFs where the second identifier is already redacted are left unchanged.

**Usage:** `node redact_k1.js <input_path>`

- **input_path:** Single PDF or folder of PDFs
- **Output:** `<filename>_redacted.pdf` or `<folder>_redacted/`

Run redaction **before** encryption if you use it.

---

## k1script.js (encryption)

Encrypts K-1 PDFs with a password derived from SSN/TIN last 4 digits and ZIP code extracted from each PDF.

**Usage:** `node k1script.js [input_folder]`

- **input_folder:** Defaults to `ignore/original` if omitted
- **Output:** `<input_folder>_protected/` and `k1_passwords_<folder>.csv` (saved in the parent of the input folder)

**Encryption tool:** PDFtk (default) or qpdf. Set `USE_QPDF=1` in `.env` to use qpdf (preserves fonts after redaction). Install with `brew install qpdf`.

---

## test_k1s.js

Tests that each LP in your CSV has exactly one matching PDF (by filename). Run before sending.

**Usage:** `node test_k1s.js <pdf_folder> [lp_csv]`

- **pdf_folder:** Folder containing K-1 PDFs (e.g. the `_protected` folder)
- **lp_csv:** Defaults to `lp_list.csv`

Output: `matching_results.csv` next to the LP CSV.

---

## Sending K-1s (Gmail and SendGrid)

You need: email template, K-1 PDFs, and LP CSV.

### LP CSV format

```csv
identifier,email
LP001,john.doe@example.com
ACME_LLC,contact@acme.com
"ACME LLC",contact@acme.com;finance@acme.com
```

- **identifier** must match part of the K-1 PDF filename
- Use semicolons (`;`) for multiple emails per LP
- Wrap values with commas in double quotes

See `example_list.csv` for a sample.

### Email template

First line: `SUBJECT: Your subject`. Remaining lines: body. See `email_template.txt` for a template.

### Gmail

```bash
node send_k1s_gmail.js <pdf_folder> [lp_csv] [email_template]
```

**Setup:**

1. Google Cloud Console: create OAuth credentials (type "Web application"), download as `credentials.json`
2. Add the redirect URI to your OAuth client: `http://localhost:3000/auth/gmail/callback` (and `:3001`, `:3002` if the UI uses those ports — the UI shows the exact URI to add)
3. Place `credentials.json` in the project root (gitignored)
4. Complete authorization (see flow below)

#### Gmail authorization flow

Both the terminal and web UI create the same `token.json` file. Once authorized, either interface can send emails.

**Terminal flow** (for `send_k1s_gmail.js` or `send_k1s_gmail_test.js`):

1. Run the script. If `token.json` doesn't exist, it prints a URL.
2. Open the URL in your browser and sign in with Google.
3. Google may show "This site can't be reached" or a blank page at localhost — that's expected. Copy the **entire code** from the address bar (the part after `code=` and before `&scope`).
4. Paste the code into the terminal when prompted and press Enter.
5. The script saves `token.json` and proceeds. Future runs use the stored token; no re-authorization unless you delete it or it expires.

**Web UI flow** (recommended):

1. Start the UI (`npm run ui`) and open http://localhost:3000.
2. If `token.json` doesn't exist, an "Authorize Gmail" section appears.
3. Click "Authorize Gmail". You're sent to Google to sign in.
4. After approving, Google redirects you back to the app. The server captures the code from the URL, exchanges it for tokens, saves `token.json`, and shows a success message.
5. No copy-paste. If the redirect fails (e.g. redirect URI not configured), use "Redirect not working? Use paste flow" to paste the code manually.

**Credentials type:** The redirect flow requires "Web application" credentials with the callback URI added in Google Cloud Console. If you have "Desktop app" credentials instead, use the paste flow in the web UI or authorize via the terminal.

### Test send (Gmail)

Send one LP's K-1 to `TEST_SEND_EMAIL` to review before full send:

```bash
node send_k1s_gmail_test.js <pdf_folder> [lp_csv] [email_template] [lp_pick]
```

`lp_pick`: number (1-based) or part of identifier.

### SendGrid

```bash
node send_k1s_sendgrid.js <pdf_folder> [lp_csv] [email_template]
```

Requires `SENDGRID_API_KEY` in `.env`. Authenticate your domain in SendGrid to avoid spoof warnings.

### Extensions

This can be edited to use Resend or other email providers.

---

## npm scripts

| Script | Description |
|--------|-------------|
| `npm run prepare-k1s -- <path>` | Redact + encrypt |
| `npm run prepare-k1s-redact -- <path>` | Redact only |
| `npm run prepare-k1s-encrypt -- <path>` | Encrypt only |
| `npm run redact -- <path>` | Redact (direct) |
| `npm run encrypt -- [path]` | Encrypt (direct) |
| `npm run test-match -- <pdf_folder> [lp_csv]` | Test PDF/LP matching |
| `npm run send-gmail -- ...` | Send via Gmail |
| `npm run send-gmail-test -- ...` | Test send via Gmail |
| `npm run send-sendgrid -- ...` | Send via SendGrid |
| `npm run ui` | Start web interface (localhost:3000) |

Pass arguments after `--`.

---

## Confidentiality

The repo's `.gitignore` includes:

- `ignore/` – K-1 PDFs, password CSVs
- `credentials.json`, `token.json` – Gmail OAuth (project root)
- `.env` – environment variables

Never commit these files.
