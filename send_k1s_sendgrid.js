require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const { parse } = require('csv-parse/sync');
const sgMail = require('@sendgrid/mail');

// Configuration
const PDF_FOLDER = process.argv[2];
const LP_CSV_PATH = process.argv[3] || path.join(__dirname, 'lp_list.csv');
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = 'finance@laconiacapitalgroup.com';
const FROM_NAME = 'Laconia Capital Group';

// Load and parse email template
const emailFile = fs.readFileSync(path.join(__dirname, 'email_template.txt'), 'utf8');
const [subjectLine, ...bodyLines] = emailFile.split('\n');
const EMAIL_SUBJECT = subjectLine.replace('SUBJECT:', '').trim();
const EMAIL_TEMPLATE = bodyLines.join('\n').trim();

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
            console.error('SendGrid API key not found. Please set SENDGRID_API_KEY environment variable.');
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

        const { lpData } = await loadCSVData();
        console.log(`Found ${lpData.length} LPs to process`);

        let successCount = 0;
        let failureCount = 0;

        for (const lp of lpData) {
            // Look for PDF files that contain the LP's identifier
            const files = await fs.readdir(PDF_FOLDER);
            const pdfFile = files.find(file => file.includes(lp.identifier));
            
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
Usage: node send_k1s.js [pdf_folder_path] [lp_csv_path]

Required:
- SENDGRID_API_KEY environment variable
- LP CSV file with columns: identifier,email
- PDFs in pdf_folder_path
- email_template.txt in script directory

Setup steps:
1. Sign up for SendGrid
2. Create API key with "Mail Send" permissions
3. Set SENDGRID_API_KEY environment variable
4. Verify your sender email in SendGrid
    `);
    process.exit(0);
}

main().catch(console.error);