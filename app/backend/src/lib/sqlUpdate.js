/**
 * Building a partial UPDATE from a request body.
 *
 * The obvious `SET col = COALESCE($n, col)` shape cannot distinguish "the
 * caller did not mention this field" from "the caller wants this field
 * cleared", so a column set that way can be given a value but never have one
 * removed. These helpers key off whether the body *carries* the field instead,
 * which leaves null free to mean null.
 */

/**
 * Picks the fields a request body actually carries, in allowlist order.
 *
 * `allowedFields` is the allowlist the SET clause is built from, so a request
 * can never name a column that was not intended to be writable. A field that is
 * present but undefined is treated as absent, matching how JSON round-trips.
 */
export function collectUpdates(body, allowedFields) {
  const updates = {};
  if (!body || typeof body !== 'object') return updates;
  for (const field of allowedFields) {
    if (Object.hasOwn(body, field) && body[field] !== undefined) {
      updates[field] = body[field];
    }
  }
  return updates;
}

/**
 * Turns `{ a: 1, b: null }` into `{ clause: 'a = $2, b = $3', values: [1, null] }`.
 *
 * `startIndex` is the number of placeholders already used by the caller — the
 * WHERE clause usually takes `$1` — so the returned placeholders continue from
 * there. Field names come from the allowlist `collectUpdates` applied, never
 * from user input, so they are safe to interpolate.
 */
export function buildUpdateAssignments(updates, startIndex = 1) {
  const values = [];
  const parts = [];
  for (const [field, value] of Object.entries(updates)) {
    values.push(value);
    parts.push(`${field} = $${startIndex + values.length}`);
  }
  return { clause: parts.join(', '), values };
}

/**
 * The fields whose stored value actually changed, comparing before and after
 * rows. Compared as strings because `pg` hands back NUMERIC as a string and
 * DATE as a Date, so a raw `!==` reports changes that did not happen.
 */
export function changedFields(before, after, fields) {
  return fields.filter((field) => String(before?.[field]) !== String(after?.[field]));
}
