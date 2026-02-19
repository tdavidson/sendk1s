#!/usr/bin/env node
/**
 * Wrapper script to run redaction and/or encryption on K-1 PDFs.
 *
 * Usage:
 *   node prepare_k1s.js [--redact-only | --encrypt-only | --both] <input_path>
 *
 * Modes:
 *   --both (default): Redact first, then encrypt the redacted output
 *   --redact-only:    Run redaction only
 *   --encrypt-only:   Run encryption only (e.g. when PDFs are already redacted)
 *
 * The input path is required. For --both, provide the path to the original PDF folder.
 * For --encrypt-only, provide the path to the folder to encrypt (e.g. ..._redacted).
 */

const { spawnSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const hasRedactOnly = args.includes('--redact-only');
const hasEncryptOnly = args.includes('--encrypt-only');
const hasBoth = args.includes('--both');

const filteredArgs = args.filter(a => !a.startsWith('--'));
const inputPath = filteredArgs[filteredArgs.length - 1];

let mode;
if (hasRedactOnly && !hasEncryptOnly && !hasBoth) {
    mode = 'redact-only';
} else if (hasEncryptOnly && !hasRedactOnly && !hasBoth) {
    mode = 'encrypt-only';
} else {
    mode = 'both';
}

if (!inputPath || inputPath.startsWith('-')) {
    console.error('Error: Input path is required.');
    console.error('');
    console.error('Usage: node prepare_k1s.js [--redact-only | --encrypt-only | --both] <input_path>');
    console.error('');
    console.error('  --both (default)   Redact, then encrypt');
    console.error('  --redact-only      Redact only');
    console.error('  --encrypt-only     Encrypt only');
    console.error('');
    console.error('Example:');
    console.error('  npm run prepare-k1s -- ignore/2025_fund');
    console.error('  npm run prepare-k1s-redact -- ignore/2025_fund');
    console.error('  npm run prepare-k1s-encrypt -- ignore/2025_fund_redacted');
    process.exit(1);
}

const scriptDir = __dirname;

function runRedact(input) {
    console.log(`\n--- Redacting: ${input} ---\n`);
    const result = spawnSync('node', [path.join(scriptDir, 'redact_k1.js'), input], {
        stdio: 'inherit',
        cwd: scriptDir
    });
    if (result.status !== 0) {
        process.exit(result.status);
    }
    return `${input}_redacted`;
}

function runEncrypt(input) {
    console.log(`\n--- Encrypting: ${input} ---\n`);
    const result = spawnSync('node', [path.join(scriptDir, 'k1script.js'), input], {
        stdio: 'inherit',
        cwd: scriptDir
    });
    if (result.status !== 0) {
        process.exit(result.status);
    }
}

if (mode === 'redact-only') {
    runRedact(inputPath);
} else if (mode === 'encrypt-only') {
    runEncrypt(inputPath);
} else {
    const redactedPath = runRedact(inputPath);
    runEncrypt(redactedPath);
}

console.log('\n✅ Done.');
