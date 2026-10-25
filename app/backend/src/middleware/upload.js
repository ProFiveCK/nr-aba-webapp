import crypto from 'crypto';
import multer from 'multer';
import {
  FOREX_TT_MAX_FILE_BYTES,
  FOREX_TT_ALLOWED_MIMES,
  FOREX_TT_ALLOWED_EXTENSIONS,
} from '../config.js';

const storage = multer.memoryStorage();

/** A filter that accepts a file whose MIME type *or* extension is allowed. */
function allowOnly(mimes, extensions, description) {
  return (_req, file, cb) => {
    const ext = file.originalname?.toLowerCase().slice(file.originalname.lastIndexOf('.'));
    if (mimes.has(file.mimetype) || extensions.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype || ext}. Allowed: ${description}.`), false);
    }
  };
}

export const forexTTUpload = multer({
  storage,
  limits: { fileSize: FOREX_TT_MAX_FILE_BYTES, files: 5 },
  fileFilter: allowOnly(FOREX_TT_ALLOWED_MIMES, FOREX_TT_ALLOWED_EXTENSIONS, 'PDF, PNG, JPG'),
}).any();

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
