const fs = require('fs-extra');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { google } = require('googleapis');

// Configuration
const PDF_FOLDER = process.argv[2] ? `${process.argv[2]}_protected` : path.join(__dirname, '..', 'original_protected');
const LP_CSV_PATH = process.argv[3] || path.join(__dirname, 'lp_list.csv');
const PASSWORD_CSV_PATH = path.join(__dirname, 'k1_passwords.csv');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');

// Gmail API configuration
const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];
const FROM_EMAIL = 'finance@laconiacapitalgroup.com';
const FROM_NAME = 'Laconia Ocrolus SPV II L.P.';

// Load and parse email template
const emailFile = fs.readFileSync(path.join(__dirname, 'email_template.txt'), 'utf8');
const [subjectLine, ...bodyLines] = emailFile.split('\n');
const EMAIL_SUBJECT = subjectLine.replace('SUBJECT:', '').trim();
const EMAIL_TEMPLATE = bodyLines.join('\n').trim();

async function authorize() {
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: CREDENTIALS_PATH,
            scopes: SCOPES,
        });
        return auth.getClient();
    } catch (error) {
        console.error('Error authorizing Gmail:', error.message);
        throw error;
    }
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
            'Content-Type: text/plain; charset="UTF-8"',
            '',
            EMAIL_TEMPLATE,
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
            skip_empty_lines: true
        });

        const passwordDataRaw = await fs.readFile(PASSWORD_CSV_PATH);
        const passwordData = parse(passwordDataRaw, {
            columns: true,
            skip_empty_lines: true
        });

        return { lpData, passwordData };
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
        if (!await fs.pathExists(PASSWORD_CSV_PATH)) {
            console.error(`Password CSV file not found: ${PASSWORD_CSV_PATH}`);
            process.exit(1);
        }
        if (!await fs.pathExists(CREDENTIALS_PATH)) {
            console.error('Gmail API credentials not found. Please download credentials.json from Google Cloud Console');
            process.exit(1);
        }

        const auth = await authorize();
        const { lpData, passwordData } = await loadCSVData();
        console.log(`Found ${lpData.length} LPs to process`);

        let successCount = 0;
        let failureCount = 0;

        for (const lp of lpData) {
            const pdfFile = passwordData.find(p => p.filename.includes(lp.identifier));
            
            if (pdfFile) {
                const pdfPath = path.join(PDF_FOLDER, pdfFile.filename);
                
                if (await fs.pathExists(pdfPath)) {
                    console.log(`Sending K-1 to ${lp.email}`);
                    const success = await sendEmail(auth, lp.email, pdfPath, pdfFile.filename);
                    
                    if (success) {
                        successCount++;
                    } else {
                        failureCount++;
                    }
                } else {
                    console.error(`PDF not found: ${pdfPath}`);
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
Usage: node send_k1s.js [pdf_folder_path] [lp_csv_path]

Required files:
- credentials.json from Google Cloud Console
- LP CSV file with columns: identifier,email
- k1_passwords.csv (generated by k1script.js)
- Protected PDFs in [pdf_folder_path]_protected

Setup steps:
1. Go to Google Cloud Console
2. Create a project
3. Enable Gmail API
4. Create OAuth 2.0 credentials
5. Download credentials.json to script directory
    `);
    process.exit(0);
}

main().catch(console.error);