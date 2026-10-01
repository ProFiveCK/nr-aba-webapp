/**
 * Collapses a display name down to a bare comparison key: lowercased,
 * everything that isn't a letter or digit stripped out. "Val-cade" and
 * "Valcade" (or "Anne Marie" and "Anne-Marie") collapse to the same key, so
 * the places that guard against duplicate staff records can catch a
 * re-typed name even when punctuation or spacing drifted between the two
 * entries.
 */
export function normalizeNameKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
