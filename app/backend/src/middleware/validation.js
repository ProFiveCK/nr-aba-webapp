import { body, param, query, validationResult } from 'express-validator';

export { body, param, query, validationResult };

export function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ errors: errors.array() });
    return false;
  }
  return true;
}
