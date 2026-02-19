require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const pdfParse = require('pdf-parse');

const USE_QPDF = /^(1|true|yes)$/i.test(process.env.USE_QPDF || '');

// Suppress harmless pdfjs font warnings (glyf table recovery). pdfjs uses console.log (stdout).
function suppressPdfjsWarnings(fn) {
    const rawOut = process.stdout.write.bind(process.stdout);
    const rawErr = process.stderr.write.bind(process.stderr);
    const harmless = /glyf|trying to recover|DOMMatrix|Path2D|Cannot polyfill|Cannot find module 'canvas'/i;
    const filter = (chunk, encoding, callback, raw) => {
        const s = typeof chunk === 'string' ? chunk : chunk.toString();
        if (harmless.test(s)) {
            if (typeof encoding === 'function') encoding();
            else if (typeof callback === 'function') callback();
            return true;
        }
        return raw(chunk, encoding, callback);
    };
    process.stdout.write = (chunk, encoding, callback) => filter(chunk, encoding, callback, rawOut);
    process.stderr.write = (chunk, encoding, callback) => filter(chunk, encoding, callback, rawErr);
    return fn().finally(() => {
        process.stdout.write = rawOut;
        process.stderr.write = rawErr;
    });
}

// Get input folder from command line argument, or use default
const IGNORE_FOLDER = path.resolve(__dirname, process.env.IGNORE_FOLDER || 'ignore');
const INPUT_FOLDER = process.argv[2] || path.join(IGNORE_FOLDER, 'original');
const OUTPUT_FOLDER = `${INPUT_FOLDER}_protected`;

// Ensure input folder exists
if (!fs.existsSync(INPUT_FOLDER)) {
    console.log(`Creating input folder: ${INPUT_FOLDER}`);
    fs.mkdirSync(INPUT_FOLDER, { recursive: true });
}

// Check if the input folder has PDF files
const pdfFiles = fs.readdirSync(INPUT_FOLDER)
    .filter(file => path.extname(file).toLowerCase() === '.pdf');

if (pdfFiles.length === 0) {
    console.log(`Please place your PDF files in: ${INPUT_FOLDER}`);
    process.exit(0);
}

// Ensure output folder exists
if (!fs.existsSync(OUTPUT_FOLDER)) {
    fs.mkdirSync(OUTPUT_FOLDER, { recursive: true });
}

// Function to find PDFtk installation
function findPDFtkPath() {
    const possiblePaths = [
        '/opt/homebrew/bin/pdftk',  // Mac M1/M2 Homebrew
        '/usr/local/bin/pdftk',     // Mac Intel Homebrew
        '/usr/bin/pdftk',           // Linux default
        'C:\\Program Files (x86)\\PDFtk\\bin\\pdftk.exe',  // Windows default
        'pdftk'                     // Try system PATH as fallback
    ];

    for (const pdftkPath of possiblePaths) {
        try {
            if (pdftkPath === 'pdftk') {
                require('child_process').execSync('pdftk --version', { stdio: 'ignore' });
                return pdftkPath;
            } else if (fs.existsSync(pdftkPath)) {
                return pdftkPath;
            }
        } catch (error) {
            continue;
        }
    }
    throw new Error('PDFtk not found. Please install PDFtk and try again.');
}

// Function to find qpdf installation
function findQpdfPath() {
    const possiblePaths = [
        '/opt/homebrew/bin/qpdf',   // Mac M1/M2 Homebrew
        '/usr/local/bin/qpdf',      // Mac Intel Homebrew
        '/usr/bin/qpdf',            // Linux default
        'qpdf'                       // Try system PATH as fallback
    ];

    for (const qpdfPath of possiblePaths) {
        try {
            if (qpdfPath === 'qpdf') {
                require('child_process').execSync('qpdf --version', { stdio: 'ignore' });
                return qpdfPath;
            } else if (fs.existsSync(qpdfPath)) {
                return qpdfPath;
            }
        } catch (error) {
            continue;
        }
    }
    throw new Error('qpdf not found. Please install qpdf (e.g. brew install qpdf on Mac) and try again.');
}

// Choose encryption tool and resolve path at startup
let ENCRYPT_TOOL;
let PDFTK_PATH;
let QPDF_PATH;

if (USE_QPDF) {
    QPDF_PATH = findQpdfPath();
    ENCRYPT_TOOL = 'qpdf';
    console.log(`Using qpdf at: ${QPDF_PATH} (USE_QPDF=1)`);
} else {
    PDFTK_PATH = findPDFtkPath();
    ENCRYPT_TOOL = 'pdftk';
    console.log(`Using PDFtk at: ${PDFTK_PATH}`);
}

/**
 * Extracts the last 4 digits of SSN/TIN and ZIP code from Part II of K-1 PDFs
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @returns {Promise<{last4_ssn: string | null, zip_code: string | null}>}
 */
async function extractSSNAndZip(pdfBuffer) {
    try {
        const pdfData = await pdfParse(pdfBuffer);
        const text = pdfData.text || '';

        // Extract last 4 digits of SSN or TIN (Part II, E - receiving party)
        // Page has sender ID first (higher), then receiving party — always use the second number (TIN or SSN).
        // Formats: SSN redacted ***-**-XXXX or unredacted XXX-XX-XXXX; TIN redacted **-***XXXX or unredacted XX-XXXXXXX.
        // No SSN/TIN: 00-0000000 or **-***0000 → last4 is 0000 (valid)
        let last4_id = null;
        const idPatterns = [
            /\*{2}-\*{3}(\d{4})/g,   // redacted TIN
            /\d{2}-\d{3}(\d{4})/g,   // unredacted TIN
            /\*{3}[-']?\*{2}[-']?(\d{4})/g,  // redacted SSN
            /\d{3}-\d{2}-(\d{4})/g   // unredacted SSN
        ];
        const allMatches = [];
        for (const re of idPatterns) {
            let m;
            while ((m = re.exec(text)) !== null) {
                allMatches.push({ index: m.index, end: m.index + m[0].length, last4: m[1] });
            }
        }
        allMatches.sort((a, b) => a.index - b.index);
        if (allMatches.length >= 2) {
            last4_id = allMatches[1].last4;
        } else if (allMatches.length === 1) {
            last4_id = allMatches[0].last4;
        }

        // Extract ZIP code from the LP's address block (after the LP's identifier, the second SSN/TIN).
        // Support 4-digit and 5-digit zip codes (international). Skip PO Box numbers.
        const lpIdentifierEnd = allMatches.length >= 2 ? allMatches[1].end : 0;
        const zipRegex = /\b(\d{4,5})\b/g;
        const zipCandidates = [];
        let zm;
        while ((zm = zipRegex.exec(text)) !== null) {
            if (zm.index < lpIdentifierEnd) continue;
            const preceding = text.slice(Math.max(0, zm.index - 20), zm.index);
            if (/\b(po\s*\.?\s*box|p\.o\.\s*box)\s*$/i.test(preceding)) continue;
            zipCandidates.push(zm[1]);
        }
        const zip_code = zipCandidates.length > 0 ? zipCandidates[0] : null;

        return { last4_ssn: last4_id, zip_code };
    } catch (error) {
        console.error(`Error extracting SSN/TIN/ZIP: ${error.message}`);
        return { last4_ssn: null, zip_code: null };
    }
}

/**
 * Encrypts a PDF file with the given password
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @param {string} password - Password for encryption
 * @returns {Promise<Buffer>} Encrypted PDF buffer
 */
async function encryptPDF(pdfBuffer, password) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const tempInputPath = path.join(__dirname, `temp_input_${suffix}.pdf`);
    const tempOutputPath = path.join(__dirname, `temp_output_${suffix}.pdf`);
    const tempFiles = [tempInputPath, tempOutputPath];
    try {
        await fs.promises.writeFile(tempInputPath, pdfBuffer);

        if (ENCRYPT_TOOL === 'qpdf') {
            await new Promise((resolve, reject) => {
                execFile(QPDF_PATH, ['--encrypt', password, password, '256', '--', tempInputPath, tempOutputPath], (error, stdout, stderr) => {
                    if (error) {
                        if (stderr) console.error('qpdf stderr:', stderr);
                        reject(error);
                        return;
                    }
                    resolve(stdout);
                });
            });
        } else {
            await new Promise((resolve, reject) => {
                execFile(PDFTK_PATH, [tempInputPath, 'output', tempOutputPath, 'user_pw', password, 'encrypt_128bit'], (error, stdout, stderr) => {
                    if (error) {
                        if (stderr) console.error('PDFtk stderr:', stderr);
                        reject(error);
                        return;
                    }
                    resolve(stdout);
                });
            });
        }

        const encryptedBuffer = await fs.promises.readFile(tempOutputPath);
        
        if (!encryptedBuffer || encryptedBuffer.length === 0) {
            throw new Error('Generated PDF is empty');
        }

        return encryptedBuffer;
    } catch (error) {
        console.error(`Error encrypting PDF: ${error.message}`);
        throw error;
    } finally {
        for (const tempFile of tempFiles) {
            try {
                if (fs.existsSync(tempFile)) {
                    fs.unlinkSync(tempFile);
                }
            } catch (cleanupError) {
                console.error(`Error cleaning up temporary files: ${cleanupError.message}`);
            }
        }
    }
}

/**
 * Processes all K1 PDFs in the input folder
 */
async function processK1PDFs() {
    const passwordData = [];
    let encryptedCount = 0;
    let skippedCount = 0;
    let failureCount = 0;

    const files = fs.readdirSync(INPUT_FOLDER)
        .filter(file => path.extname(file).toLowerCase() === '.pdf');

    console.log(`Processing ${files.length} PDF files...`);

    for (const filename of files) {
        try {
            const inputPath = path.join(INPUT_FOLDER, filename);
            const pdfBuffer = fs.readFileSync(inputPath);

            const { last4_ssn, zip_code } = await extractSSNAndZip(pdfBuffer);

            if (zip_code) {
                const passwordPart1 = last4_ssn || '0000';
                const password = `${passwordPart1}${zip_code}`;

                const encryptedPdfBuffer = await encryptPDF(pdfBuffer, password);

                const outputPath = path.join(OUTPUT_FOLDER, filename);
                fs.writeFileSync(outputPath, encryptedPdfBuffer);

                passwordData.push({ filename, password });
                encryptedCount++;
            } else {
                console.log(`Skipping ${filename}: Could not extract ZIP code`);
                skippedCount++;
            }
        } catch (error) {
            console.error(`Error processing ${filename}: ${error.message}`);
            failureCount++;
        }
    }

    // Save password records in the same folder as the input (e.g. ignore/fund/ not ignore/ root)
    const folderName = path.basename(INPUT_FOLDER);
    const csvDir = path.dirname(INPUT_FOLDER);
    if (!fs.existsSync(csvDir)) {
        fs.mkdirSync(csvDir, { recursive: true });
    }
    const csvPath = path.join(csvDir, `k1_passwords_${folderName}.csv`);
    fs.writeFileSync(csvPath,
        'filename,password\n' +
        passwordData.map(entry => `${entry.filename},${entry.password}`).join('\n')
    );

    console.log(`\n✅ Processing complete. Passwords saved in ${path.basename(csvPath)}`);
    console.log(`   Encrypted: ${encryptedCount}, Skipped: ${skippedCount}${failureCount > 0 ? `, Failed: ${failureCount}` : ''}`);

    if (failureCount > 0) {
        process.exitCode = 1;
    }
}

// Add usage information at the start of the script
if (process.argv[2] === '--help' || process.argv[2] === '-h') {
    console.log(`
Usage: node k1script.js [input_folder_path]

If no input folder is specified, defaults to ignore/original
Output folder will be created as '[input_folder_path]_protected'

Encryption tool (set in .env):
- Default: PDFtk (brew install pdftk-java on Mac)
- To use qpdf instead (preserves fonts, e.g. redaction Courier): set USE_QPDF=1 in .env
  Then install qpdf (e.g. brew install qpdf on Mac)

Requirements:
- PDFtk or qpdf must be installed (qpdf if USE_QPDF=1)
- Input folder must contain PDF files
    `);
    process.exit(0);
}

// Run the script (suppress harmless pdfjs glyf warnings from redacted PDFs)
suppressPdfjsWarnings(() => processK1PDFs()).catch(console.error);