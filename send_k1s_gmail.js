require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');

// Configuration
const PDF_FOLDER = process.argv[2];
const LP_CSV_PATH = process.argv[3] || path.join(__dirname, 'lp_list.csv');
const EMAIL_TEMPLATE_PATH = process.argv[4] || path.join(__dirname, 'email_template.txt');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');

// Gmail API configuration
const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];
const FROM_EMAIL = 'finance@laconiacapitalgroup.com';
const FROM_NAME = 'Laconia Capital Group';

// Load and parse email template
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
    try {
        const content = await fs.readFile(CREDENTIALS_PATH);
        const { client_secret, client_id, redirect_uris } = JSON.parse(content).installed;
        const oAuth2Client = new OAuth2Client(client_id, client_secret, redirect_uris[0]);

        // Check if we have previously stored a token
        if (await fs.pathExists(TOKEN_PATH)) {
            const token = JSON.parse(await fs.readFile(TOKEN_PATH));
            oAuth2Client.setCredentials(token);
            return oAuth2Client;
        }

        // Get new token. prompt: 'consent' forces the consent screen so Google returns a
        // refresh_token (needed to get new access tokens without re-prompting every time).
        const authUrl = oAuth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
            prompt: 'consent',
        });
        console.log('\nAuthorize this app by visiting this url:\n', authUrl);
        console.log('\nAfter you sign in, the browser may show "This site can\'t be reached" or a blank page at localhost. That\'s normal.');
        console.log('Copy the ENTIRE code from the browser\'s address bar (the part after "code=" and before "&scope").\n');
        const code = await new Promise((resolve) => {
            const readline = require('readline').createInterface({
                input: process.stdin,
                output: process.stdout,
            });
            readline.question('Paste the code here and press Enter: ', (code) => {
                readline.close();
                resolve(code?.trim() || '');
            });
        });

        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);
        
        // Store the token
        await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
        console.log('Token stored to', TOKEN_PATH);
        
        return oAuth2Client;
    } catch (error) {
        console.error('Error during authorization:', error);
        throw error;
    }
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function sendEmail(auth, recipients, pdfPath, pdfFilename) {
    try {
        const gmail = google.gmail({ version: 'v1', auth });
        const pdf = await fs.readFile(pdfPath);
        
        // Handle multiple recipients
        const recipientList = Array.isArray(recipients) ? recipients : recipients.split(/[,;]/);
        
        // Construct email with attachment
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

        const encodedEmail = Buffer.from(email)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

        await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: encodedEmail,
            },
        });
        
        return true;
    } catch (error) {
        console.error(`Error sending email to ${Array.isArray(recipients) ? recipients.join(', ') : recipients}:`, error.message);
        return false;
    }
}

async function loadCSVData() {
    try {
        const lpDataRaw = await fs.readFile(LP_CSV_PATH);
        const lpData = parse(lpDataRaw, {
            columns: true,
            skip_empty_lines: true,
            bom: true
        });

        return { lpData };
    } catch (error) {
        console.error('Error loading CSV data:', error.message);
        throw error;
    }
}

async function main() {
    try {
        // Validate files exist
        if (!await fs.pathExists(PDF_FOLDER)) {
            console.error(`PDF folder not found: ${PDF_FOLDER}`);
            process.exit(1);
        }
        if (!await fs.pathExists(LP_CSV_PATH)) {
            console.error(`LP CSV file not found: ${LP_CSV_PATH}`);
            process.exit(1);
        }
        if (!await fs.pathExists(CREDENTIALS_PATH)) {
            console.error('Gmail API credentials not found. Please download credentials.json from Google Cloud Console');
            process.exit(1);
        }

        const auth = await authorize();
        const { lpData } = await loadCSVData();
        console.log(`Found ${lpData.length} LPs to process`);

        const allFiles = await fs.readdir(PDF_FOLDER);
        const pdfFiles = allFiles.filter(f => path.extname(f).toLowerCase() === '.pdf');
        const normalizeForMatch = (s) => (s || '').replace(/\s+/g, ' ').trim();

        let successCount = 0;
        let failureCount = 0;

        for (const lp of lpData) {
            const key = normalizeForMatch(lp.identifier);
            const matches = pdfFiles.filter(file => key && file.includes(key));
            const pdfFile = matches.length > 0 ? matches[0] : null;
            if (matches.length > 1) {
                console.warn(`Warning: Multiple PDFs match identifier "${lp.identifier}": ${matches.join(', ')}. Using first match.`);
            }
            if (pdfFile) {
                const pdfPath = path.join(PDF_FOLDER, pdfFile);
                console.log(`Sending K-1 to ${lp.email}`);
                const success = await sendEmail(auth, lp.email, pdfPath, pdfFile);

                if (success) {
                    successCount++;
                } else {
                    failureCount++;
                }
            } else {
                console.error(`No matching PDF found for LP: ${lp.identifier}`);
                failureCount++;
            }
        }

        console.log('\nEmail Distribution Summary:');
        console.log(`✅ Successfully sent: ${successCount}`);
        console.log(`❌ Failed to send: ${failureCount}`);

    } catch (error) {
        console.error('Error in main process:', error.message);
    }
}

// Add usage information
if (process.argv[2] === '--help' || process.argv[2] === '-h') {
    console.log(`
Usage: node send_k1s_gmail.js [pdf_folder_path] [lp_csv_path] [email_template_path]

Required files:
- credentials.json from Google Cloud Console
- LP CSV file with columns: identifier,email
- PDFs in pdf_folder_path
- Email template file (defaults to email_template.txt)

Example:
node send_k1s_gmail.js ignore/2025_k1_ocrolus_protected 2025_k1_spv1/spv1_lps.csv 2025_k1_spv1/spv2_email.txt
    `);
    process.exit(0);
}

main().catch(err => {
    const isInvalidGrant = err.response?.data?.error === 'invalid_grant' || (err.message && err.message.includes('invalid_grant'));
    if (isInvalidGrant) {
        console.error('\nGmail authorization failed (invalid_grant). The saved token is expired or was revoked.');
        console.error('Fix: Delete token.json and run the script again. You will be prompted to re-authorize in the browser.\n');
    } else {
        console.error(err);
    }
    process.exit(1);
});