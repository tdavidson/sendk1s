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

        const results = [];
        const files = await fs.readdir(PDF_FOLDER);

        for (const lp of lpData) {
            const pdfFile = files.find(file => file.includes(lp.identifier));
            
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
if (process.argv[2] === '--help' || process.argv[2] === '-h') {
    console.log(`
Usage: node test_k1_matching.js [pdf_folder_path] [lp_csv_path]

Required:
- PDF folder path containing K1 files
- LP CSV file with columns: identifier,email

Example:
node test_k1_matching.js docs/K1_folder lp_list.csv
    `);
    process.exit(0);
}

testK1Matching().catch(console.error);