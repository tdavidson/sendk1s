require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const { parse } = require('csv-parse/sync');
const sgMail = require('@sendgrid/mail');

// Configuration
const PDF_FOLDER = process.argv[2];
const LP_CSV_PATH = process.argv[3] || path.join(__dirname, 'lp_list.csv');
const EMAIL_TEMPLATE_PATH = process.argv[4] || path.join(__dirname, 'email_template.txt');
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || '';
const FROM_NAME = process.env.FROM_NAME || '';

// Load and parse email template (validated in main)
let EMAIL_SUBJECT, EMAIL_TEMPLATE;
function loadEmailTemplate() {
    if (!fs.existsSync(EMAIL_TEMPLATE_PATH)) {
        throw new Error(`Email template not found at ${EMAIL_TEMPLATE_PATH}`);
    }
    const emailFile = fs.readFileSync(EMAIL_TEMPLATE_PATH, 'utf8');
    const [subjectLine, ...bodyLines] = emailFile.split('\n');
    EMAIL_SUBJECT = subjectLine.replace('SUBJECT:', '').trim();
    EMAIL_TEMPLATE = bodyLines.join('\n').trim();
}

// Initialize SendGrid
sgMail.setApiKey(SENDGRID_API_KEY);

async function sendEmail(recipients, pdfPath, pdfFilename) {
    try {
        const pdf = await fs.readFile(pdfPath);
        
        // Handle multiple recipients
        const recipientList = Array.isArray(recipients) ? recipients : recipients.split(/[,;]/);
        
        const msg = {
            to: recipientList,
            from: {
                email: FROM_EMAIL,
                name: FROM_NAME
            },
            subject: EMAIL_SUBJECT,
            text: EMAIL_TEMPLATE,
            attachments: [
                {
                    content: pdf.toString('base64'),
                    filename: pdfFilename,
                    type: 'application/pdf',
                    disposition: 'attachment'
                }
            ]
        };

        await sgMail.send(msg);
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
        // Validate configuration
        if (!SENDGRID_API_KEY) {
            console.error('SendGrid API key not found. Please set SENDGRID_API_KEY in your .env file.');
            process.exit(1);
        }
        if (!FROM_EMAIL || !FROM_NAME) {
            console.error('FROM_EMAIL and FROM_NAME must be set. Copy .env.example to .env and configure your sender details.');
            process.exit(1);
        }

        // Validate files exist
        if (!await fs.pathExists(PDF_FOLDER)) {
            console.error(`PDF folder not found: ${PDF_FOLDER}`);
            process.exit(1);
        }
        if (!await fs.pathExists(LP_CSV_PATH)) {
            console.error(`LP CSV file not found: ${LP_CSV_PATH}`);
            process.exit(1);
        }
        loadEmailTemplate();

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
                const success = await sendEmail(lp.email, pdfPath, pdfFile);

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
Usage: node send_k1s_sendgrid.js [pdf_folder_path] [lp_csv_path] [email_template_path]

Required:
- SENDGRID_API_KEY environment variable (e.g. in .env in project root)
- pdf_folder_path: folder containing K-1 PDFs (e.g. the _protected folder)
- lp_csv_path (optional): defaults to lp_list.csv in project root
- email_template_path (optional): defaults to email_template.txt in project root

Example:
node send_k1s_sendgrid.js ignore/2025_fund_protected ignore/2025_fund/lps.csv ignore/2025_fund/email.txt

Setup steps:
1. Sign up for SendGrid
2. Create API key with "Mail Send" permissions
3. Set SENDGRID_API_KEY (e.g. in .env)
4. Verify your sender email in SendGrid
    `);
    process.exit(0);
}

main().catch(console.error);