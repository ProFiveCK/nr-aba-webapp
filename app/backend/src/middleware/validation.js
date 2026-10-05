import { body, param, query, validationResult } from 'express-validator';

export { body, param, query, validationResult };

export function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const list = errors.array();
    // `message` is what the client shows; the generic default says nothing
    // useful, so name the field instead.
    const first = list[0];
    const message = first.msg && first.msg !== 'Invalid value' ? first.msg : `Invalid value for ${first.path || 'request'}.`;
    res.status(422).json({ message, errors: list });
    return false;
  }
  return true;
}
