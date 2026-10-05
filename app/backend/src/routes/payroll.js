import express from 'express';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { body, handleValidation } from '../middleware/validation.js';
import { requireAuth } from '../services/authService.js';
import { decodeBase64File } from '../utils/helpers.js';
import {
  EXCEL_MIME_TYPES,
  PAYROLL_ACCESS_ROLES,
  PAYROLL_MAX_FILE_BYTES,
  PAYROLL_PYTHON_BIN,
} from '../config.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const PAYROLL_SCRIPT_PATH = process.env.PAYROLL_SCRIPT_PATH || path.join(REPO_ROOT, 'scripts', 'reformat_payroll.py');

router.post(
  '/reformat',
  requireAuth(PAYROLL_ACCESS_ROLES),
  [
    body('file_name').isString().trim().isLength({ min: 1, max: 255 }),
    body('file_data').isString().trim().notEmpty(),
    body('mime_type').optional({ nullable: true }).isString().isLength({ min: 1, max: 255 })
  ],
  async (req, res) => {
    if (!handleValidation(req, res)) return;

    const fileName = sanitizePayrollFileName(req.body.file_name);
    const mimeType = req.body.mime_type || null;
    const extension = path.extname(fileName).toLowerCase();

    if (!['.xlsx', '.xls'].includes(extension)) {
      res.status(400).json({ message: 'Unsupported file type. Upload an Excel workbook (.xls or .xlsx).' });
      return;
    }

    if (mimeType && !EXCEL_MIME_TYPES.has(mimeType)) {
      res.status(400).json({ message: 'Unsupported file type. Upload an Excel workbook.' });
      return;
    }

    let inputBuffer;
    try {
      inputBuffer = decodeBase64File(req.body.file_data);
    } catch (_err) {
      res.status(400).json({ message: 'Invalid file upload payload.' });
      return;
    }

    if (!inputBuffer.length) {
      res.status(400).json({ message: 'Please upload a non-empty Excel file.' });
      return;
    }

    if (inputBuffer.length > PAYROLL_MAX_FILE_BYTES) {
      res.status(400).json({ message: 'The uploaded file is too large. Maximum size is 10 MB.' });
      return;
    }

    // Validate file magic bytes — do not trust the client-supplied extension/MIME alone.
    // .xlsx/.xlsb/.xlsm are ZIP-based (PK\x03\x04); .xls is OLE2 (D0 CF 11 E0 A1 B1 1A E1).
    const magic = inputBuffer.subarray(0, 8);
    const isZip = magic[0] === 0x50 && magic[1] === 0x4b && magic[2] === 0x03 && magic[3] === 0x04;
    const isOle =
      magic[0] === 0xd0 && magic[1] === 0xcf && magic[2] === 0x11 && magic[3] === 0xe0 &&
      magic[4] === 0xa1 && magic[5] === 0xb1 && magic[6] === 0x1a && magic[7] === 0xe1;
    if (extension === '.xlsx' && !isZip) {
      res.status(400).json({ message: 'File content does not match a .xlsx workbook (expected ZIP container).' });
      return;
    }
    if (extension === '.xls' && !isOle && !isZip) {
      res.status(400).json({ message: 'File content does not match a .xls workbook (expected OLE2 or ZIP container).' });
      return;
    }
    if (!isZip && !isOle) {
      res.status(400).json({ message: 'Unrecognized file format. Upload a valid Excel workbook.' });
      return;
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'payroll-reformat-'));
    const inputPath = path.join(tempDir, fileName);
    const outputPath = path.join(tempDir, buildPayrollOutputName(fileName));

    try {
      await fs.writeFile(inputPath, inputBuffer);
      await runPayrollScript(inputPath, outputPath);

      let outputBuffer;
      try {
        outputBuffer = await fs.readFile(outputPath);
      } catch (_err) {
        res.status(500).json({ message: 'Payroll processing did not produce an output file.' });
        return;
      }

      res.json({
        file_name: path.basename(outputPath),
        mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        file_data: outputBuffer.toString('base64')
      });
    } catch (err) {
      console.error('Payroll reformat failed', err);
      res.status(500).json({
        message: err instanceof Error && err.message
          ? err.message
          : 'Payroll processing failed.'
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
);

function sanitizePayrollFileName(name) {
  return path.basename(String(name).trim() || 'payroll.xlsx');
}

function buildPayrollOutputName(fileName) {
  const ext = path.extname(fileName) || '.xlsx';
  const stem = path.basename(fileName, ext);
  return `${stem} - Reformatted.xlsx`;
}

async function runPayrollScript(inputPath, outputPath) {
  try {
    await fs.access(PAYROLL_SCRIPT_PATH);
  } catch (_err) {
    throw new Error('Payroll script is not available on the server.');
  }

  await new Promise((resolve, reject) => {
    const child = spawn(
      PAYROLL_PYTHON_BIN,
      [PAYROLL_SCRIPT_PATH, '--input', inputPath, '--output', outputPath],
      { cwd: REPO_ROOT }
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      reject(new Error(`Unable to start payroll processor: ${err.message}`));
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const details = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n');
      reject(new Error(details || `Payroll processor exited with code ${code}.`));
    });
  });
}

export default router;
