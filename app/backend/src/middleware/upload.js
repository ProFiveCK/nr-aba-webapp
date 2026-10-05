import crypto from 'crypto';
import multer from 'multer';
import {
  FOREX_TT_MAX_FILE_BYTES,
  FOREX_TT_ALLOWED_MIMES,
  FOREX_TT_ALLOWED_EXTENSIONS,
  LEAVE_ATTACHMENT_MAX_FILE_BYTES,
  LEAVE_ATTACHMENT_MAX_FILES,
  LEAVE_ATTACHMENT_ALLOWED_MIMES,
  LEAVE_ATTACHMENT_ALLOWED_EXTENSIONS,
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

/**
 * Supporting documents submitted with a leave application.
 *
 * `.any()` so a JSON request passes straight through untouched — the leave
 * endpoint accepts both, and only applications for a type that requires a
 * document need to send a file at all.
 */
const leaveAttachmentMulter = multer({
  storage,
  limits: { fileSize: LEAVE_ATTACHMENT_MAX_FILE_BYTES, files: LEAVE_ATTACHMENT_MAX_FILES },
  fileFilter: allowOnly(
    LEAVE_ATTACHMENT_ALLOWED_MIMES,
    LEAVE_ATTACHMENT_ALLOWED_EXTENSIONS,
    'PDF, PNG, JPG, DOC, DOCX'
  ),
}).any();

/**
 * Multer reports a rejected upload with its own error codes and no HTTP
 * status, which the error handler can only read as a server fault — so a file
 * one megabyte too big came back as "an unexpected error occurred". These are
 * all the applicant's to fix, so they are given a status and wording that says
 * what to do.
 */
export const leaveAttachmentUpload = (req, res, next) => {
  leaveAttachmentMulter(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      err.status = 413;
      err.message = `Each attachment must be ${Math.round(LEAVE_ATTACHMENT_MAX_FILE_BYTES / (1024 * 1024))}MB or smaller.`;
    } else if (err.code === 'LIMIT_FILE_COUNT') {
      err.status = 400;
      err.message = `Attach at most ${LEAVE_ATTACHMENT_MAX_FILES} documents.`;
    } else if (!err.status) {
      // A fileFilter rejection: a plain Error whose message already names the
      // offending type and what is allowed.
      err.status = 400;
    }
    return next(err);
  });
};

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
