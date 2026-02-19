const fs = require('fs-extra');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

// Configuration
const PDF_FOLDER = process.argv[2];
const LP_CSV_PATH = process.argv[3] || path.join(__dirname, 'lp_list.csv');

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

async function testK1Matching() {
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

        const { lpData } = await loadCSVData();
        console.log(`Found ${lpData.length} LPs to process`);

        const allFiles = await fs.readdir(PDF_FOLDER);
        const pdfFiles = allFiles.filter(f => path.extname(f).toLowerCase() === '.pdf');

        const normalizeForMatch = (s) => (s || '').replace(/\s+/g, ' ').trim();

        const results = [];
        for (const lp of lpData) {
            const key = normalizeForMatch(lp.identifier);
            const matches = pdfFiles.filter(file => key && file.includes(key));
            const pdfFile = matches.length > 0 ? matches[0] : null;
            if (matches.length > 1) {
                console.warn(`Warning: Multiple PDFs match identifier "${lp.identifier}": ${matches.join(', ')}. Using first match.`);
            }
            results.push({
                identifier: lp.identifier,
                email: lp.email,
                matching_file: pdfFile || 'NO MATCH',
                status: pdfFile ? 'MATCH FOUND' : 'NO MATCH'
            });
        }

        // Write results to CSV
        const outputPath = path.join(path.dirname(LP_CSV_PATH), 'matching_results.csv');
        const output = stringify(results, {
            header: true,
            columns: ['identifier', 'email', 'matching_file', 'status']
        });
        await fs.writeFile(outputPath, output);

        // Print summary
        const matchCount = results.filter(r => r.status === 'MATCH FOUND').length;
        const noMatchCount = results.filter(r => r.status === 'NO MATCH').length;

        console.log('\nMatching Results Summary:');
        console.log(`✅ Matches found: ${matchCount}`);
        console.log(`❌ No matches: ${noMatchCount}`);
        console.log(`📊 Total LPs: ${results.length}`);
        console.log(`\nDetailed results written to: ${outputPath}`);

    } catch (error) {
        console.error('Error in test process:', error.message);
    }
}

// Add usage information
function printUsage() {
    console.log(`
Usage: node test_k1s.js <pdf_folder_path> [lp_csv_path]

Required:
- pdf_folder_path: folder containing K-1 PDF files (e.g. the _protected folder)
- lp_csv_path (optional): path to LP CSV; defaults to lp_list.csv in project root

LP CSV must have columns: identifier,email
Output: matching_results.csv is written next to the LP CSV.

Example:
node test_k1s.js ignore/2025_k1_ocrolus_protected 2025_k1_spv1/spv1_lps.csv
    `);
}

if (process.argv[2] === '--help' || process.argv[2] === '-h') {
    printUsage();
    process.exit(0);
}

if (!process.argv[2]) {
    console.error('Error: PDF folder path is required.\n');
    printUsage();
    process.exit(1);
}

testK1Matching().catch(console.error);