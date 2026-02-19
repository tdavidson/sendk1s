#!/usr/bin/env node
/**
 * Web interface server for K-1 distribution.
 * Serves the UI and API endpoints to run prepare, test-match, and send operations.
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const { parse } = require('csv-parse/sync');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const PORT = process.env.PORT || 3000;
const IGNORE_FOLDER = path.resolve(__dirname, process.env.IGNORE_FOLDER || 'ignore');
const SCRIPT_DIR = __dirname;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// List folders in ignore/ recursively (for PDF paths, e.g. ignore/fund/original)
app.get('/api/folders', async (req, res) => {
  try {
    const folders = [];
    const walk = async (dir, prefix = '') => {
      if (!await fs.pathExists(dir)) return;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('.')) continue;
        const rel = path.join(prefix, e.name);
        folders.push(path.join('ignore', rel));
        await walk(path.join(dir, e.name), rel);
      }
    };
    await walk(IGNORE_FOLDER, '');
    res.json(folders.sort());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List CSV files in ignore/ and example/
app.get('/api/csv-files', async (req, res) => {
  try {
    const csvFiles = [];
    const walk = async (dir, prefix = '') => {
      if (!await fs.pathExists(dir)) return;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const rel = path.join(prefix, e.name);
        if (e.isDirectory() && !e.name.startsWith('.')) {
          await walk(path.join(dir, e.name), rel);
        } else if (e.name.endsWith('.csv')) {
          csvFiles.push(path.join('ignore', rel));
        }
      }
    };
    await walk(IGNORE_FOLDER, '');
    const exampleDir = path.join(SCRIPT_DIR, 'example');
    if (await fs.pathExists(exampleDir)) {
      const entries = await fs.readdir(exampleDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith('.csv')) {
          csvFiles.push(path.join('example', e.name));
        }
      }
    }
    res.json([...new Set(csvFiles)].sort());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List .txt files in ignore/ and example/ (email templates)
app.get('/api/txt-files', async (req, res) => {
  try {
    const txtFiles = [];
    const walk = async (dir, prefix = '') => {
      if (!await fs.pathExists(dir)) return;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const rel = path.join(prefix, e.name);
        if (e.isDirectory() && !e.name.startsWith('.')) {
          await walk(path.join(dir, e.name), rel);
        } else if (e.name.endsWith('.txt')) {
          txtFiles.push(path.join('ignore', rel));
        }
      }
    };
    await walk(IGNORE_FOLDER, '');
    const exampleDir = path.join(SCRIPT_DIR, 'example');
    if (await fs.pathExists(exampleDir)) {
      const entries = await fs.readdir(exampleDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith('.txt')) {
          txtFiles.push(path.join('example', e.name));
        }
      }
    }
    res.json([...new Set(txtFiles)].sort());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get LP list from a CSV (for test send LP picker)
app.get('/api/lps', async (req, res) => {
  const csvPath = req.query.csv;
  if (!csvPath) return res.status(400).json({ error: 'csv path required' });
  const fullPath = path.resolve(SCRIPT_DIR, csvPath);
  try {
    const content = await fs.readFile(fullPath);
    const rows = parse(content, { columns: true, skip_empty_lines: true, bom: true });
    res.json(rows.map((r, i) => ({ index: i + 1, identifier: r.identifier, email: r.email })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function runScript(script, args, cwd = SCRIPT_DIR) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [path.join(SCRIPT_DIR, script), ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      const output = stdout + (stderr ? '\n' + stderr : '');
      if (code === 0) resolve({ success: true, output });
      else reject(new Error(output || `Exit code ${code}`));
    });
    proc.on('error', reject);
  });
}

// Prepare: redact, encrypt, or both
app.post('/api/prepare', async (req, res) => {
  const { inputPath, mode } = req.body; // mode: 'redact-only' | 'encrypt-only' | 'both'
  if (!inputPath) return res.status(400).json({ error: 'inputPath required' });
  const fullPath = path.resolve(SCRIPT_DIR, inputPath);
  if (!await fs.pathExists(fullPath)) {
    return res.status(400).json({ error: `Path not found: ${inputPath}` });
  }
  const args = [];
  if (mode === 'redact-only') args.push('--redact-only');
  else if (mode === 'encrypt-only') args.push('--encrypt-only');
  else args.push('--both');
  args.push(fullPath);
  try {
    const result = await runScript('prepare_k1s.js', args);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Test matching
app.post('/api/test-match', async (req, res) => {
  const { pdfFolder, lpCsv } = req.body;
  if (!pdfFolder) return res.status(400).json({ error: 'pdfFolder required' });
  const pdfPath = path.resolve(SCRIPT_DIR, pdfFolder);
  const csvPath = lpCsv ? path.resolve(SCRIPT_DIR, lpCsv) : path.join(SCRIPT_DIR, 'lp_list.csv');
  if (!await fs.pathExists(pdfPath)) {
    return res.status(400).json({ error: `PDF folder not found: ${pdfFolder}` });
  }
  const args = [pdfPath, csvPath];
  try {
    const result = await runScript('test_k1s.js', args);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get TEST_SEND_EMAIL from .env (for UI pre-fill)
app.get('/api/test-send-email', (req, res) => {
  res.json({ email: process.env.TEST_SEND_EMAIL || '' });
});

// Gmail OAuth: check if token exists
const CREDENTIALS_PATH = process.env.CREDENTIALS_PATH
  ? path.resolve(SCRIPT_DIR, process.env.CREDENTIALS_PATH)
  : path.join(SCRIPT_DIR, 'credentials.json');
const TOKEN_PATH = process.env.TOKEN_PATH
  ? path.resolve(SCRIPT_DIR, process.env.TOKEN_PATH)
  : path.join(SCRIPT_DIR, 'token.json');
const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.send'];

app.get('/api/gmail-auth-status', async (req, res) => {
  try {
    const hasCredentials = await fs.pathExists(CREDENTIALS_PATH);
    const hasToken = await fs.pathExists(TOKEN_PATH);
    res.json({ hasCredentials, hasToken, authorized: hasCredentials && hasToken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Build redirect URI for OAuth callback (must be added to Google Cloud Console)
function getRedirectUri(req) {
  const host = req.get('host') || `localhost:${PORT}`;
  const protocol = req.get('x-forwarded-proto') || (req.connection?.encrypted ? 'https' : 'http');
  return `${protocol}://${host}/auth/gmail/callback`;
}

// Gmail OAuth: get auth URL — uses redirect flow so Google sends user back with code
app.get('/api/gmail-auth-url', async (req, res) => {
  try {
    if (!await fs.pathExists(CREDENTIALS_PATH)) {
      return res.status(400).json({ error: 'credentials.json not found. Place it in the project root.' });
    }
    const content = await fs.readFile(CREDENTIALS_PATH);
    const parsed = JSON.parse(content);
    const creds = parsed.installed || parsed.web;
    const { client_secret, client_id } = creds;
    const redirectUri = getRedirectUri(req);
    const oAuth2Client = new OAuth2Client(client_id, client_secret, redirectUri);
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: GMAIL_SCOPES,
      prompt: 'consent',
    });
    res.json({ authUrl, redirectUri });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Gmail OAuth: callback — Google redirects here with code; we capture it and complete auth
app.get('/auth/gmail/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    return res.redirect(`/?gmail_error=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return res.redirect('/?gmail_error=' + encodeURIComponent('No code received'));
  }
  try {
    if (!await fs.pathExists(CREDENTIALS_PATH)) {
      return res.redirect('/?gmail_error=' + encodeURIComponent('credentials.json not found'));
    }
    const content = await fs.readFile(CREDENTIALS_PATH);
    const parsed = JSON.parse(content);
    const creds = parsed.installed || parsed.web;
    const { client_secret, client_id } = creds;
    const redirectUri = getRedirectUri(req);
    const oAuth2Client = new OAuth2Client(client_id, client_secret, redirectUri);
    const { tokens } = await oAuth2Client.getToken(code);
    await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
    res.redirect('/?gmail=authorized');
  } catch (err) {
    const msg = err.response?.data?.error === 'invalid_grant'
      ? 'Redirect URI mismatch. Add this to Google Cloud Console: ' + getRedirectUri(req)
      : err.message;
    res.redirect('/?gmail_error=' + encodeURIComponent(msg));
  }
});

// Gmail OAuth: exchange code for token (fallback for paste flow if redirect fails)
app.post('/api/gmail-auth-code', async (req, res) => {
  const { code } = req.body;
  if (!code || typeof code !== 'string' || !code.trim()) {
    return res.status(400).json({ error: 'Code is required' });
  }
  try {
    if (!await fs.pathExists(CREDENTIALS_PATH)) {
      return res.status(400).json({ error: 'credentials.json not found.' });
    }
    const content = await fs.readFile(CREDENTIALS_PATH);
    const parsed = JSON.parse(content);
    const creds = parsed.installed || parsed.web;
    const { client_secret, client_id } = creds;
    const redirectUri = 'urn:ietf:wg:oauth:2.0:oob'; // paste flow
    const oAuth2Client = new OAuth2Client(client_id, client_secret, redirectUri);
    const { tokens } = await oAuth2Client.getToken(code.trim());
    await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
    res.json({ success: true, message: 'Gmail authorized. You can now send and test send.' });
  } catch (err) {
    const msg = err.response?.data?.error === 'invalid_grant'
      ? 'Invalid or expired code. Copy the full code from the browser and try again.'
      : err.message;
    res.status(400).json({ error: msg });
  }
});

// Test send (one LP to TEST_SEND_EMAIL)
app.post('/api/test-send', async (req, res) => {
  const { pdfFolder, lpCsv, emailTemplate, lpPick, testSendEmail } = req.body;
  if (!pdfFolder) return res.status(400).json({ error: 'pdfFolder required' });
  const pdfPath = path.resolve(SCRIPT_DIR, pdfFolder);
  const csvPath = lpCsv || path.join(SCRIPT_DIR, 'lp_list.csv');
  const templatePath = emailTemplate || path.join(SCRIPT_DIR, 'email_template.txt');
  const fullCsv = path.resolve(SCRIPT_DIR, csvPath);
  const fullTemplate = path.resolve(SCRIPT_DIR, templatePath);
  if (!await fs.pathExists(pdfPath)) {
    return res.status(400).json({ error: `PDF folder not found: ${pdfFolder}` });
  }
  const args = [pdfPath, fullCsv, fullTemplate, String(lpPick || '1')];
  if (testSendEmail && String(testSendEmail).trim()) {
    args.push(String(testSendEmail).trim());
  }
  try {
    const result = await runScript('send_k1s_gmail_test.js', args);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Full send (Gmail)
app.post('/api/send', async (req, res) => {
  const { pdfFolder, lpCsv, emailTemplate } = req.body;
  if (!pdfFolder) return res.status(400).json({ error: 'pdfFolder required' });
  const pdfPath = path.resolve(SCRIPT_DIR, pdfFolder);
  const csvPath = lpCsv || path.join(SCRIPT_DIR, 'lp_list.csv');
  const templatePath = emailTemplate || path.join(SCRIPT_DIR, 'email_template.txt');
  const fullCsv = path.resolve(SCRIPT_DIR, csvPath);
  const fullTemplate = path.resolve(SCRIPT_DIR, templatePath);
  if (!await fs.pathExists(pdfPath)) {
    return res.status(400).json({ error: `PDF folder not found: ${pdfFolder}` });
  }
  const args = [pdfPath, fullCsv, fullTemplate];
  try {
    const result = await runScript('send_k1s_gmail.js', args);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function tryListen(port) {
  const server = app.listen(port, () => {
    console.log(`K-1 Distribution UI: http://localhost:${server.address().port}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && port < 3010) {
      console.log(`Port ${port} in use, trying ${port + 1}...`);
      tryListen(port + 1);
    } else {
      throw err;
    }
  });
}
tryListen(PORT);
