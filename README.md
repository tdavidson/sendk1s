# k1distribution

This folder covers scripts created to send K1 tax documents to limited partners for Laconia Capital Group.

[Here's a video overview on how it works](https://www.loom.com/share/bad8633bf10c4b1f842de6d666a7dd6f) (optional).

## Installation

- `npm install` to install the dependencies (requires Node.js)
- `brew install pdftk-java` (use Homebrew on a Mac). The script looks for the `pdftk` binary on your system or at common paths.

If you have to install Homebrew to install pdftk-java:

```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```
then add brew to the path
```
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```
then install pdftk-java
```
brew install pdftk-java
```

## Typical workflow

1. **Encrypt** K-1 PDFs with `k1script.js` (outputs password-protected PDFs and a password CSV).
2. **Test matching** with `test_k1s.js` to verify PDF filenames match your LP CSV before sending.
3. **Send** K-1s with `send_k1s_gmail.js` or `send_k1s_sendgrid.js` using the `_protected` folder and your LP CSV.

You can also use npm scripts: `npm run encrypt -- ignore/2025_k1_ocrolus`, `npm run redact -- ignore/2025_k1_ocrolus`, `npm run test-match -- ...`, `npm run send-gmail -- ...`, `npm run send-sendgrid -- ...` (pass script arguments after `--`).

## redact_k1.js (optional)

Redacts the **receiving party’s** SSN/TIN (the second identifier on the page) when it is currently **unredacted**. Covers the number with a white rectangle and prints the redacted form on top (e.g. **-***0337 for TIN, ***-**-7876 for SSN). PDFs where the second identifier is already redacted are left unchanged (and copied as-is into the output folder).

**Usage:** `node redact_k1.js <input_path>` — use a path to a single PDF or a folder of PDFs. For a folder, output is written to `<input_folder>_redacted` (same filenames). For a single file, output is `<filename>_redacted.pdf`. Run redaction **before** encryption if you use it. A harmless font “glyf” warning from the PDF parser may appear only for PDFs that actually get redacted; the script suppresses it so the log stays clean.

**Font:** The overlay text uses **Courier** (embedded via `fonts/CourierPrime-Regular.ttf`) for consistent display across viewers. To match the K-1 form’s filled fields, If the font file is missing, the script falls back to the standard PDF Courier reference (see `fonts/README.md`).

## Confidentiality and .gitignore

Keep confidential documents and secrets out of version control. The repo’s `.gitignore` includes:

- `ignore/` – K-1 PDFs, password CSVs, and other sensitive files
- `credentials.json` and `token.json` – Gmail API credentials
- `.env` – environment variables (e.g. `SENDGRID_API_KEY`, `TEST_SEND_EMAIL`, `USE_QPDF` for encryption tool)

Store credentials and password CSVs under `ignore/` or in the project root only if they are listed in `.gitignore`.

---

## k1script.js

Encrypts K-1 PDFs with a password derived from SSN/TIN last 4 digits and ZIP code extracted from each PDF.

1. Put the unencrypted K-1s in a folder (e.g. inside `ignore` so they are not synced to GitHub).
2. Run the script, passing the path to that folder. If omitted, the default is `ignore/original`.

```
node k1script.js [path to folder]
# Example: node k1script.js ignore/2025_k1_ocrolus
```

3. Encrypted PDFs are written to a folder with the same path plus `_protected` (e.g. `ignore/2025_k1_ocrolus_protected`).
4. A password CSV is created in the `ignore` folder with the pattern `k1_passwords_<folder>.csv` (e.g. `k1_passwords_2025_k1_ocrolus.csv`). Use it to verify passwords; keep it in `ignore` so it is not committed to git.

**Encryption tool (PDFtk vs qpdf)**  
By default the script uses **PDFtk** to encrypt. If you use the redaction script first, PDFtk can change how the redacted font is stored, so the font may look different in the protected PDF. To preserve fonts (e.g. the redacted overlay text), you can use **qpdf** instead:

- Install qpdf: `brew install qpdf` (Mac).
- In your `.env` file, set: `USE_QPDF=1`
- Run the script as usual. It will use qpdf for encryption (256-bit AES). The script prints which tool it is using at startup.

If `USE_QPDF` is not set (or not `1`/`true`/`yes`), the script uses PDFtk and requires `pdftk` (e.g. `brew install pdftk-java` on Mac).

---

## test_k1s.js

Tests that each LP in your CSV has exactly one matching PDF (by filename). Does not send email; writes a CSV of match results. Run this before sending.

**Usage:**

```
node test_k1s.js [pdf_folder_path] [lp_csv_path]
```

- **pdf_folder_path** (required): folder containing K-1 PDFs (e.g. the `_protected` folder).
- **lp_csv_path** (optional): path to LP CSV; defaults to `lp_list.csv` in the project root.

Output: `matching_results.csv` is written next to the LP CSV (same directory). It lists each identifier, email, matched filename (or `NO MATCH`), and status.

---

## send_k1s.js (Gmail and SendGrid)

These scripts send K-1s to limited partners using the finance@ email address.

> There are two versions: **Gmail** (`send_k1s_gmail.js`) and **SendGrid** (`send_k1s_sendgrid.js`). Both have been tested. The Gmail version requires a `credentials.json` file from Google Cloud Console. The SendGrid version requires a SendGrid API key (e.g. in `.env` as `SENDGRID_API_KEY`). Both are set up using the finance@ email. SendGrid is easy to use but domain authentication is required to avoid spoof warnings. Gmail sends from Sent so messages are easy to find in the inbox. Gmail was used to distribute the 2024 K-1s.

You need three inputs (paths can vary):

- Email template (subject and body)
- K-1 PDFs to send (PDF format)
- CSV with LP identifiers and email addresses

Keep confidential documents in the `ignore` folder so they are not committed to git.

1. Create an email template file: first line `SUBJECT: Your subject`, then the body.
2. Create a CSV with columns `identifier` and `email`:

```
identifier,email
LP001,john.doe@example.com
ACME_LLC,contact@acme.com
"ACME LLC",contact@acme.com;finance@acme.com;tax@acme.com
```

Important notes:

- The **identifier** must match part of the K-1 PDF filename for that LP (matching is by “filename includes identifier”).
- No spaces after commas in the CSV.
- Header row `identifier,email` is required.
- One LP per line. Use semicolons (`;`) to separate multiple email addresses per LP.
- For values containing commas, wrap in double quotes; escape internal quotes by doubling them.

### Gmail: send_k1s_gmail.js

```
node send_k1s_gmail.js [path to pdf folder] [path to LP CSV] [path to email template]
```

#### Test send: send_k1s_gmail_test.js

Use this script to send **one** LP’s K-1 to a **test address** (e.g. finance@) so you can review the email and attachment before running the full send to all LPs.

**How it works**

- The script uses the same PDF folder, LP CSV, and email template as the full Gmail send.
- It picks **one** LP from the list (by default the first) and finds that LP’s matching PDF.
- It sends **one** email with that K-1 attached, but the email goes to the address in `TEST_SEND_EMAIL` (not to the LP’s email). You can open that inbox to confirm subject, body, and PDF look correct before sending to everyone.

**Required**

- `TEST_SEND_EMAIL` must be set in your `.env` file. If it is missing, the script exits with an error asking you to set it.
  - Example: `TEST_SEND_EMAIL=finance@laconiacapitalgroup.com`
- Same as full send: `credentials.json`, `token.json` (after first auth), PDF folder, LP CSV, and email template.

**Usage**

```
node send_k1s_gmail_test.js [pdf_folder] [lp_csv] [email_template] [lp_pick]
```

- **pdf_folder** – Folder containing the protected K-1 PDFs (e.g. `ignore/2025_k1_ocrolus_protected`).
- **lp_csv** – Path to the LP CSV (e.g. `2025_k1_spv1/spv1_lps.csv`). Defaults to `lp_list.csv` if omitted.
- **email_template** – Path to the email template file. Defaults to `email_template.txt` if omitted.
- **lp_pick** – Which LP to use (optional, default: `1`):
  - **Number** – 1-based index: `1` = first LP, `2` = second, etc.
  - **Text** – Part of the identifier: e.g. `SEGAL` or `MIDLAND` to pick that LP.

**Examples**

```bash
# Send the first LP’s K-1 to TEST_SEND_EMAIL
node send_k1s_gmail_test.js ignore/2025_k1_ocrolus_protected 2025_k1_spv1/spv1_lps.csv 2025_k1_spv1/spv1_email.txt

# Send the 3rd LP’s K-1
node send_k1s_gmail_test.js ignore/2025_k1_ocrolus_protected 2025_k1_spv1/spv1_lps.csv 2025_k1_spv1/spv1_email.txt 3

# Pick LP by identifier (e.g. SEGAL)
node send_k1s_gmail_test.js ignore/2025_k1_ocrolus_protected 2025_k1_spv1/spv1_lps.csv 2025_k1_spv1/spv1_email.txt SEGAL
```

Before running the full send, run the test send, check the email at `TEST_SEND_EMAIL`, then run `send_k1s_gmail.js` with the same arguments (without `lp_pick`) to send to all LPs.

**Full send (all LPs)** – arguments for `send_k1s_gmail.js`:

- **path to pdf folder**: e.g. `ignore/2025_k1_ocrolus_protected`
- **path to LP CSV**: e.g. `2025_k1_spv1/spv1_lps.csv`
- **path to email template** (optional): defaults to `email_template.txt` in the project root

Example:

```
node send_k1s_gmail.js ignore/2025_k1_ocrolus_protected 2025_k1_spv1/spv1_lps.csv 2025_k1_spv1/spv2_email.txt
```

### SendGrid: send_k1s_sendgrid.js

```
node send_k1s_sendgrid.js [path to pdf folder] [path to LP CSV] [path to email template]
```

- **path to pdf folder** (required): folder containing K-1 PDFs (e.g. `_protected` folder).
- **path to LP CSV** (optional): defaults to `lp_list.csv` in the project root.
- **path to email template** (optional): defaults to `email_template.txt` in the project root.

Requires `SENDGRID_API_KEY` in the environment (e.g. in a `.env` file in the project root; `.env` is in `.gitignore`).

---

## Notes on authorization for sending emails

### Gmail

1. In Google Cloud Console, download the credentials file and save it as `credentials.json` (e.g. in the project root or `ignore`; ensure it is in `.gitignore`).
2. The first time you run the script, you will be prompted to open a URL and authorize the app; this creates `token.json`. Keep `token.json` in `.gitignore` and do not commit it.
   - After you sign in, the browser will redirect to `http://localhost/...` and may show "This site can't be reached" or a blank page. That is normal (there is no local server). **Copy the authorization code from the browser’s address bar** (the long string after `code=` and before `&scope`) and paste it into the terminal when the script asks for it.
3. You will not need to authorize again unless you delete `token.json` or switch accounts. The script requests a refresh token so it can obtain new access tokens without asking you again. If you used to have to re-authorize on every run, delete `token.json` and run the script once more so it saves a token that includes a refresh token. To re-authorize for any reason, delete `token.json` and run the Gmail send script again.

### SendGrid

To remove spoof warnings and improve deliverability, authenticate your domain:

- Go to SendGrid **Settings → Sender Authentication**
- Click **Authenticate Your Domain** and enter your domain
- Add the DNS records SendGrid provides (CNAME, DKIM, return-path) at your DNS provider
- Wait for verification (often under 48 hours)

After domain authentication: no spoof warnings, better inbox placement, and protection against spoofing.
