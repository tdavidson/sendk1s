/**
 * Test send: picks ONE LP from the list and sends that LP's K-1 to a test address
 * (e.g. finance@) so you can review the email before sending to everyone.
 *
 * Set TEST_SEND_EMAIL in .env (e.g. TEST_SEND_EMAIL=finance@example.com).
 *
 * Usage: node send_k1s_gmail_test.js [pdf_folder] [lp_csv] [email_template] [lp_index_or_identifier]
 *   lp_index_or_identifier: optional. 1-based index (e.g. 1 = first LP) or part of identifier. Default: 1
 */

require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');

const PDF_FOLDER = process.argv[2];
const LP_CSV_PATH = process.argv[3] || path.join(__dirname, 'lp_list.csv');
const EMAIL_TEMPLATE_PATH = process.argv[4] || path.join(__dirname, 'email_template.txt');
const LP_PICK = process.argv[5] || '1';
const TEST_SEND_EMAIL_OVERRIDE = process.argv[6]; // Optional: override .env TEST_SEND_EMAIL
const CREDENTIALS_PATH = process.env.CREDENTIALS_PATH
    ? path.resolve(__dirname, process.env.CREDENTIALS_PATH)
    : path.join(__dirname, 'credentials.json');
const TOKEN_PATH = process.env.TOKEN_PATH
    ? path.resolve(__dirname, process.env.TOKEN_PATH)
    : path.join(__dirname, 'token.json');
const TEST_SEND_EMAIL = (TEST_SEND_EMAIL_OVERRIDE && TEST_SEND_EMAIL_OVERRIDE.trim()) || process.env.TEST_SEND_EMAIL;

const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];
const FROM_EMAIL = process.env.FROM_EMAIL || '';
const FROM_NAME = process.env.FROM_NAME || '';

let EMAIL_SUBJECT, EMAIL_TEMPLATE;
try {
    const emailFile = fs.readFileSync(EMAIL_TEMPLATE_PATH, 'utf8');
    const [subjectLine, ...bodyLines] = emailFile.split('\n');
    EMAIL_SUBJECT = subjectLine.replace('SUBJECT:', '').trim();
    EMAIL_TEMPLATE = bodyLines.join('\n').trim();
} catch (error) {
    console.error(`Error loading email template from ${EMAIL_TEMPLATE_PATH}:`, error.message);
    process.exit(1);
}

async function authorize() {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const { client_secret, client_id, redirect_uris } = JSON.parse(content).installed;
    const oAuth2Client = new OAuth2Client(client_id, client_secret, redirect_uris[0]);
    if (await fs.pathExists(TOKEN_PATH)) {
        const token = JSON.parse(await fs.readFile(TOKEN_PATH));
        oAuth2Client.setCredentials(token);
        return oAuth2Client;
    }
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent',
    });
    console.log('\nAuthorize this app by visiting this url:\n', authUrl);
    console.log('\nAfter you sign in, the browser may show "This site can\'t be reached" or a blank page at localhost. That\'s normal.');
    console.log('Copy the ENTIRE code from the browser\'s address bar (the part after "code=" and before "&scope").\n');
    const code = await new Promise((resolve) => {
        const readline = require('readline').createInterface({ input: process.stdin, output: process.stdout });
        readline.question('Paste the code here and press Enter: ', (code) => { readline.close(); resolve(code?.trim() || ''); });
    });
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
    return oAuth2Client;
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function sendEmail(auth, recipients, pdfPath, pdfFilename) {
    const gmail = google.gmail({ version: 'v1', auth });
    const pdf = await fs.readFile(pdfPath);
    const recipientList = Array.isArray(recipients) ? recipients : recipients.split(/[,;]/);
    const email = [
        'Content-Type: multipart/mixed; boundary="boundary"',
        'MIME-Version: 1.0',
        `To: ${recipientList.join(', ')}`,
        `From: "${FROM_NAME}" <${FROM_EMAIL}>`,
        `Subject: ${EMAIL_SUBJECT}`,
        '',
        '--boundary',
        'Content-Type: text/html; charset="UTF-8"',
        '',
        `<div style="font-family: Arial, sans-serif; white-space: pre-wrap;">${escapeHtml(EMAIL_TEMPLATE)}</div>`,
        '',
        '--boundary',
        'Content-Type: application/pdf',
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${pdfFilename}"`,
        '',
        pdf.toString('base64'),
        '',
        '--boundary--'
    ].join('\n');

    const encodedEmail = Buffer.from(email).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encodedEmail } });
    return true;
}

async function loadCSVData() {
    const lpDataRaw = await fs.readFile(LP_CSV_PATH);
    return parse(lpDataRaw, { columns: true, skip_empty_lines: true, bom: true });
}

function pickOneLP(lpData, pick) {
    const trim = (s) => (s || '').trim();
    const index = parseInt(pick, 10);
    if (!Number.isNaN(index) && index >= 1 && index <= lpData.length) {
        return lpData[index - 1];
    }
    const key = trim(pick).toLowerCase();
    const normalized = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const found = lpData.find(lp => normalized(lp.identifier).includes(key) || key.includes(normalized(lp.identifier)));
    return found || null;
}

async function main() {
    if (!PDF_FOLDER || process.argv[2] === '--help' || process.argv[2] === '-h') {
        console.log(`
Usage: node send_k1s_gmail_test.js [pdf_folder] [lp_csv] [email_template] [lp_pick] [test_email]

  Sends ONE LP's K-1 to the test address so you can review before sending to everyone.

  pdf_folder       Folder containing protected K-1 PDFs
  lp_csv           LP CSV (default: lp_list.csv)
  email_template   Template file (default: email_template.txt)
  lp_pick          Which LP: number 1-N or part of identifier (default: 1)
  test_email       Optional: override TEST_SEND_EMAIL from .env

  Set in .env: TEST_SEND_EMAIL=your@email.com (or pass as 6th arg)

Example:
  node send_k1s_gmail_test.js ignore/2025_fund_protected ignore/2025_fund/lps.csv ignore/2025_fund/email.txt 1
  node send_k1s_gmail_test.js ignore/2025_fund_protected ignore/2025_fund/lps.csv ignore/2025_fund/email.txt "LP001"
`);
        process.exit(PDF_FOLDER ? 0 : 1);
    }

    if (!await fs.pathExists(PDF_FOLDER)) {
        console.error(`PDF folder not found: ${PDF_FOLDER}`);
        process.exit(1);
    }
    if (!await fs.pathExists(LP_CSV_PATH)) {
        console.error(`LP CSV not found: ${LP_CSV_PATH}`);
        process.exit(1);
    }
    if (!await fs.pathExists(CREDENTIALS_PATH)) {
        console.error('credentials.json not found.');
        process.exit(1);
    }
    if (!FROM_EMAIL || !FROM_NAME) {
        console.error('FROM_EMAIL and FROM_NAME must be set. Copy .env.example to .env and configure your sender details.');
        process.exit(1);
    }
    if (!TEST_SEND_EMAIL || !TEST_SEND_EMAIL.trim()) {
        console.error('TEST_SEND_EMAIL is not set. Add it to your .env file, e.g.:\n  TEST_SEND_EMAIL=finance@example.com');
        process.exit(1);
    }

    const lpData = await loadCSVData();
    const lp = pickOneLP(lpData, LP_PICK);
    if (!lp) {
        console.error(`Could not find LP for "${LP_PICK}". Use a number 1-${lpData.length} or part of an identifier.`);
        process.exit(1);
    }

    const normalizeForMatch = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const pdfFiles = (await fs.readdir(PDF_FOLDER)).filter(f => path.extname(f).toLowerCase() === '.pdf');
    const key = normalizeForMatch(lp.identifier);
    const matches = pdfFiles.filter(file => key && file.includes(key));
    const pdfFile = matches.length > 0 ? matches[0] : null;

    if (!pdfFile) {
        console.error(`No matching PDF for LP: ${lp.identifier}`);
        process.exit(1);
    }

    console.log(`Test send: 1 email`);
    console.log(`  LP:     ${lp.identifier}`);
    console.log(`  PDF:    ${pdfFile}`);
    console.log(`  To:     ${TEST_SEND_EMAIL} (TEST_SEND_EMAIL)`);
    console.log('');

    const auth = await authorize();
    const pdfPath = path.join(PDF_FOLDER, pdfFile);
    const success = await sendEmail(auth, TEST_SEND_EMAIL, pdfPath, pdfFile);

    if (success) {
        console.log(`✅ Test email sent to ${TEST_SEND_EMAIL}. Check the inbox before running the full send.`);
    } else {
        console.error('❌ Send failed.');
        process.exit(1);
    }
}

main().catch(err => {
    const isInvalidGrant = err.response?.data?.error === 'invalid_grant' || (err.message && err.message.includes('invalid_grant'));
    if (isInvalidGrant) {
        console.error('\nGmail authorization failed (invalid_grant). The saved token is expired or was revoked.');
        console.error('Fix: Delete token.json and run this script again. You will be prompted to re-authorize in the browser.\n');
    } else {
        console.error(err);
    }
    process.exit(1);
});
