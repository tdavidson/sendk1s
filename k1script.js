const fs = require('fs');
const path = require('path');
const PDFtk = require('node-pdftk');
const pdfParse = require('pdf-parse');

// Get input folder from command line argument, or use default
const INPUT_FOLDER = process.argv[2] || path.join(__dirname, '..', 'docs', 'original');
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
                // Try running pdftk --version
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

// Find PDFtk path at startup
const PDFTK_PATH = findPDFtkPath();
console.log(`Using PDFtk at: ${PDFTK_PATH}`);

/**
 * Extracts the last 4 digits of SSN/TIN and ZIP code from Part II of K-1 PDFs
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @returns {Promise<{last4_ssn: string | null, zip_code: string | null}>}
 */
async function extractSSNAndZip(pdfBuffer) {
    try {
        const pdfData = await pdfParse(pdfBuffer);
        const text = pdfData.text || '';

        // Extract last 4 digits of SSN or TIN
        // Matches patterns like:
        // ***-**-1234 (SSN)
        // **-***0337 (TIN)
        const idMatches = text.match(/\*{2}-\*{3}(\d{4})/g) || 
                          text.match(/\*{3}[-']?\*{2}[-']?(\d{4})/g) || [];
        const last4_id = idMatches.length > 0 ? 
            idMatches[0].replace(/\*{2}-\*{3}|\*{3}[-']?\*{2}[-']?/, '') : 
            null;

        // Extract ZIP code (prioritize 5-digit, fallback to zip+4)
        const zipMatches = text.match(/\b(\d{5})(?:-\d{4})?\b/g) || [];
        const zip_code = zipMatches.length > 0 ? zipMatches[0].slice(0, 5) : null;

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
    const tempFiles = [];
    try {
        const tempInputPath = path.join(__dirname, `temp_input_${Date.now()}.pdf`);
        const tempOutputPath = path.join(__dirname, `temp_output_${Date.now()}.pdf`);
        
        tempFiles.push(tempInputPath, tempOutputPath);
        await fs.promises.writeFile(tempInputPath, pdfBuffer);

        // Use discovered PDFtk path
        const command = `"${PDFTK_PATH}" "${tempInputPath}" output "${tempOutputPath}" user_pw ${password} encrypt_128bit`;
        await new Promise((resolve, reject) => {
            require('child_process').exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.error('PDFtk stderr:', stderr);
                    reject(error);
                    return;
                }
                resolve(stdout);
            });
        });

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
            } else {
                console.log(`Skipping ${filename}: Could not extract ZIP code`);
            }
        } catch (error) {
            console.error(`Error processing ${filename}: ${error.message}`);
        }
    }

    // Save password records
    const folderName = path.basename(INPUT_FOLDER);
    const csvPath = path.join(__dirname, '..', 'docs', `k1_passwords_${folderName}.csv`);
    fs.writeFileSync(csvPath, 
        'filename,password\n' + 
        passwordData.map(entry => `${entry.filename},${entry.password}`).join('\n')
    );

    console.log(`\n✅ Processing complete. Passwords saved in ${path.basename(csvPath)}`);
}

// Add usage information at the start of the script
if (process.argv[2] === '--help' || process.argv[2] === '-h') {
    console.log(`
Usage: node k1script.js [input_folder_path]

If no input folder is specified, defaults to '../original'
Output folder will be created as '[input_folder_path]_protected'

Requirements:
- PDFtk must be installed on your system
- Input folder must contain PDF files
    `);
    process.exit(0);
}

// Run the script
processK1PDFs().catch(console.error);