import crypto from 'crypto';
import multer from 'multer';
import {
  FOREX_TT_MAX_FILE_BYTES,
  FOREX_TT_ALLOWED_MIMES,
  FOREX_TT_ALLOWED_EXTENSIONS,
} from '../config.js';

const storage = multer.memoryStorage();

function fileFilter(_req, file, cb) {
  const ext = file.originalname?.toLowerCase().slice(file.originalname.lastIndexOf('.'));
  const mimeOk = FOREX_TT_ALLOWED_MIMES.has(file.mimetype);
  const extOk = FOREX_TT_ALLOWED_EXTENSIONS.has(ext);
  if (mimeOk || extOk) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype || ext}. Allowed: PDF, PNG, JPG.`), false);
  }
}

export const forexTTUpload = multer({
  storage,
  limits: { fileSize: FOREX_TT_MAX_FILE_BYTES, files: 5 },
  fileFilter,
}).any();

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
