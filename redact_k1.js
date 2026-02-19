/**
 * Redact the receiving party's SSN/TIN (second identifier on the page) if it is
 * currently unredacted. Draws a white rectangle over the number and prints the
 * redacted form on top (e.g. **-***0337 for TIN, ***-**-7876 for SSN).
 *
 * Usage: node redact_k1.js <input_path>
 *   input_path: path to a single PDF file or a folder of PDFs (e.g. ignore/2025_k1_ocrolus)
 * Output: redacted PDF(s) in the same folder with _redacted before .pdf (e.g. file_redacted.pdf),
 *   or a folder named <input_folder>_redacted if input is a folder.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

// Same ID patterns as k1script.js (order matters for "second in document")
const ID_PATTERNS = [
    { regex: /\*{2}-\*{3}(\d{4})/g, name: 'redacted_tin' },
    { regex: /\d{2}-\d{3}(\d{4})/g, name: 'unredacted_tin' },
    { regex: /\*{3}[-']?\*{2}[-']?(\d{4})/g, name: 'redacted_ssn' },
    { regex: /\d{3}-\d{2}-(\d{4})/g, name: 'unredacted_ssn' }
];

const PADDING = 1; // extra points around redaction box
const UPWARD_EXTRA = 1; // extend box upward so rect covers text (PDF.js y is baseline)

// Courier (CourierPrime-Regular.ttf) matches K-1 filled fields. Embedded for consistent display.
const COURIER_FONT_PATH = process.env.FONT_PATH || path.join(__dirname, 'fonts', 'CourierPrime-Regular.ttf');

function findAllIdMatches(text) {
    const matches = [];
    for (const { regex, name } of ID_PATTERNS) {
        let m;
        regex.lastIndex = 0;
        while ((m = regex.exec(text)) !== null) {
            matches.push({
                start: m.index,
                end: m.index + m[0].length,
                last4: m[1],
                name
            });
        }
    }
    matches.sort((a, b) => a.start - b.start);
    return matches;
}

// Suppress harmless pdfjs/font warnings for the duration of fn (e.g. whole redaction run).
// pdfjs uses console.log for warnings (stdout), not stderr. Filter: glyf table recovery, etc.
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
    process.stdout.write = function (chunk, encoding, callback) {
        return filter(chunk, encoding, callback, rawOut);
    };
    process.stderr.write = function (chunk, encoding, callback) {
        return filter(chunk, encoding, callback, rawErr);
    };
    return fn().finally(() => {
        process.stdout.write = rawOut;
        process.stderr.write = rawErr;
    });
}

async function getTextContentWithPositions(pdfBuffer) {
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    if (typeof pdfjsLib.GlobalWorkerOptions !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    }
    const doc = await pdfjsLib.getDocument({ data: pdfBuffer }).promise;
    const numPages = doc.numPages;
    const allItems = [];
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await doc.getPage(pageNum);
        const content = await page.getTextContent();
        for (const item of content.items) {
            if (!item.str) continue;
            const transform = item.transform;
            const x = transform[4];
            const y = transform[5];
            const w = item.width != null ? item.width : 0;
            const h = item.height != null ? item.height : 0;
            allItems.push({
                pageIndex: pageNum - 1,
                str: item.str,
                x, y, w, h
            });
        }
    }
    return allItems;
}

function getBoundingBox(items) {
    if (items.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const it of items) {
        const left = it.x;
        const bottom = it.y - it.h;
        const right = it.x + it.w;
        const top = it.y + (it.h || 0) * 0.6 + UPWARD_EXTRA;
        minX = Math.min(minX, left);
        minY = Math.min(minY, bottom);
        maxX = Math.max(maxX, right);
        maxY = Math.max(maxY, top);
    }
    return {
        x: minX - PADDING,
        y: minY - PADDING,
        width: maxX - minX + 2 * PADDING,
        height: maxY - minY + 2 * PADDING
    };
}

function toUint8Array(buffer) {
    if (Buffer.isBuffer(buffer)) return new Uint8Array(buffer);
    if (buffer instanceof Uint8Array) return buffer;
    return new Uint8Array(buffer);
}

async function redactPdf(inputPath, outputPath) {
    const raw = fs.readFileSync(inputPath);
    const pdfData = toUint8Array(raw);
    const allItems = await getTextContentWithPositions(pdfData);
    const fullText = allItems.map(i => i.str).join('');

    const matches = findAllIdMatches(fullText);
    if (matches.length < 2) {
        return { redacted: false, reason: 'fewer than 2 identifiers found' };
    }

    const second = matches[1];
    const isUnredacted = second.name === 'unredacted_tin' || second.name === 'unredacted_ssn';
    if (!isUnredacted) {
        return { redacted: false, reason: 'second identifier is already redacted' };
    }

    const start = second.start;
    const end = second.end;
    let offset = 0;
    const itemsToRedact = [];
    for (const it of allItems) {
        const nextOffset = offset + it.str.length;
        if (offset < end && nextOffset > start) {
            itemsToRedact.push(it);
        }
        offset = nextOffset;
        if (offset >= end) break;
    }

    if (itemsToRedact.length === 0) {
        return { redacted: false, reason: 'could not map match to text items' };
    }

    const pageIndex = itemsToRedact[0].pageIndex;
    const box = getBoundingBox(itemsToRedact);
    if (!box) {
        return { redacted: false, reason: 'could not compute bounding box' };
    }

    const redactedText = second.name === 'unredacted_tin' ? `**-***${second.last4}` : `***-**-${second.last4}`;

    const pdfDoc = await PDFDocument.load(pdfData);
    // Use embedded Courier (CourierPrime-Regular.ttf) for consistent display; fall back to standard Courier.
    let font;
    if (fs.existsSync(COURIER_FONT_PATH)) {
        const fontkit = require('@pdf-lib/fontkit');
        pdfDoc.registerFontkit(fontkit);
        const fontBytes = new Uint8Array(fs.readFileSync(COURIER_FONT_PATH));
        font = await pdfDoc.embedFont(fontBytes);
    } else {
        font = await pdfDoc.embedFont(StandardFonts.Courier);
    }
    const pages = pdfDoc.getPages();
    const page = pages[pageIndex];

    const originalBaseline = itemsToRedact.reduce((s, it) => s + it.y, 0) / itemsToRedact.length;
    const fontSize = Math.min(box.height * 0.8, 12);
    const boxHeight = fontSize * 1.05;
    const boxY = originalBaseline - fontSize * 0.1;

    page.drawRectangle({
        x: box.x,
        y: boxY,
        width: box.width,
        height: boxHeight,
        color: rgb(1, 1, 1)
    });

    page.drawText(redactedText, {
        x: box.x + 2,
        y: originalBaseline,
        size: fontSize,
        font,
        color: rgb(0, 0, 0)
    });

    const outBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, outBytes);
    return { redacted: true, pageIndex: pageIndex + 1 };
}

async function main() {
    const inputPath = process.argv[2];
    if (!inputPath || process.argv[2] === '--help' || process.argv[2] === '-h') {
        console.log(`
Usage: node redact_k1.js <input_path>

  input_path  Path to a single PDF file or a folder containing PDFs.

Redacts the receiving party's SSN/TIN (the second identifier on the page) only when
it is currently unredacted. Draws a white rectangle and prints the redacted form on top
(e.g. **-***0337 for TIN, ***-**-7876 for SSN). Output files: _redacted.pdf or folder _redacted.

Example:
  node redact_k1.js ignore/2025_k1_ocrolus
  node redact_k1.js ignore/2025_k1_ocrolus/some_file.pdf
`);
        process.exit(inputPath ? 0 : 1);
    }

    const stat = fs.statSync(inputPath);
    const isDir = stat.isDirectory();
    const files = isDir
        ? fs.readdirSync(inputPath)
            .filter(f => path.extname(f).toLowerCase() === '.pdf')
            .map(f => path.join(inputPath, f))
        : [inputPath];

    if (files.length === 0) {
        console.log(isDir ? `No PDF files in ${inputPath}` : 'Not a PDF file.');
        process.exit(0);
    }

    await suppressPdfjsWarnings(async () => {
        let outputDir;
        if (isDir) {
            outputDir = `${inputPath}_redacted`;
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
        }

        let redactedCount = 0;
        let skippedCount = 0;
        for (const filePath of files) {
            const basename = path.basename(filePath);
            const outPath = isDir
                ? path.join(outputDir, basename)
                : filePath.replace(/\.pdf$/i, '_redacted.pdf');

            try {
                const result = await redactPdf(filePath, outPath);
                if (result.redacted) {
                    console.log(`Redacted: ${basename} (page ${result.pageIndex})`);
                    redactedCount++;
                } else {
                    console.log(`Skipped: ${basename} — ${result.reason}`);
                    if (isDir) {
                        fs.copyFileSync(filePath, outPath);
                    }
                    skippedCount++;
                }
            } catch (err) {
                console.error(`Error processing ${basename}:`, err.message);
                skippedCount++;
            }
        }

        console.log(`\nDone. Redacted: ${redactedCount}, Skipped: ${skippedCount}`);
        if (isDir) {
            console.log(`Output folder: ${outputDir}`);
        }
    });
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
