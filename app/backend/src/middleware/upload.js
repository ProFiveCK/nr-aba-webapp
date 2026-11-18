import crypto from 'crypto';
import multer from 'multer';
import {
  FOREX_TT_MAX_FILE_BYTES,
  FOREX_TT_ALLOWED_MIMES,
  FOREX_TT_ALLOWED_EXTENSIONS,
  POLICY_MAX_FILE_BYTES,
} from '../config.js';
import { ServiceError } from '../lib/serviceError.js';

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

// ===== Policies & Procedures =====

const startsWith = (bytes) => (buffer) => buffer.length >= bytes.length && bytes.every((byte, i) => buffer[i] === byte);
const ascii = (text) => [...Buffer.from(text, 'latin1')];
const zip = startsWith([0x50, 0x4b, 0x03, 0x04]);
const ole = startsWith([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/**
 * What a policy may carry, by file name ending: the type it is served as, and
 * a check that the contents really are that kind of file, so a renamed file
 * cannot pass as another.
 */
const POLICY_FILE_KINDS = {
  '.pdf': { type: 'application/pdf', looksRight: startsWith(ascii('%PDF-')) },
  '.docx': { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', looksRight: zip },
  '.xlsx': { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', looksRight: zip },
  '.pptx': { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', looksRight: zip },
  '.doc': { type: 'application/msword', looksRight: ole },
  '.xls': { type: 'application/vnd.ms-excel', looksRight: ole },
  '.ppt': { type: 'application/vnd.ms-powerpoint', looksRight: ole },
  '.png': { type: 'image/png', looksRight: startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  '.jpg': { type: 'image/jpeg', looksRight: startsWith([0xff, 0xd8, 0xff]) },
  '.jpeg': { type: 'image/jpeg', looksRight: startsWith([0xff, 0xd8, 0xff]) },
  '.gif': { type: 'image/gif', looksRight: startsWith(ascii('GIF8')) },
  '.webp': { type: 'image/webp', looksRight: (b) => startsWith(ascii('RIFF'))(b) && b.subarray(8, 12).toString('latin1') === 'WEBP' },
};

/** Files that can be attached to a policy, or shown in its text. */
export const POLICY_ATTACHMENT_ENDINGS = Object.keys(POLICY_FILE_KINDS);
/** What Word import reads. Older .doc files have to be saved as .docx first. */
export const POLICY_WORD_ENDINGS = ['.docx'];

const policyMulter = multer({
  storage,
  limits: { fileSize: POLICY_MAX_FILE_BYTES, files: 1, fields: 4 },
}).single('file');

/**
 * Accepts one file with one of the given endings, and leaves it on
 * `req.policyFile` ready to store. `asking` finishes "Choose …" when it is not.
 */
export function policyUpload(endings, asking) {
  return (req, res, next) => policyMulter(req, res, (err) => {
    if (err) {
      next(new ServiceError(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
        `Choose one file no larger than ${POLICY_MAX_FILE_BYTES / 1024 / 1024} MB.`));
      return;
    }
    const file = req.file;
    if (!file) {
      next(new ServiceError(400, 'Choose a file to upload.'));
      return;
    }
    const name = String(file.originalname || 'file').replace(/[\x00-\x1f/\\]/g, '_').slice(0, 180);
    const dot = name.lastIndexOf('.');
    const ending = dot === -1 ? '' : name.slice(dot).toLowerCase();
    const kind = endings.includes(ending) ? POLICY_FILE_KINDS[ending] : null;
    if (!kind) {
      next(new ServiceError(400, `Choose ${asking}.`));
      return;
    }
    if (!kind.looksRight(file.buffer)) {
      next(new ServiceError(400, `${name} is named as a ${ending} file, but its contents are not one.`));
      return;
    }
    req.policyFile = {
      file_name: name,
      content_type: kind.type,
      byte_size: file.size,
      checksum: sha256(file.buffer),
      file_data: file.buffer,
    };
    next();
  });
}
