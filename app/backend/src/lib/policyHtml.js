/**
 * The one rule for what a policy page may contain.
 *
 * Every body is cleaned here before it is stored — whether it was typed in
 * the editor, pasted from somewhere else or imported from Word — so what is
 * in the database is always safe to show as it is, and the reader never has
 * to clean anything itself.
 *
 * Only the plain document structure survives: headings, paragraphs, lists,
 * tables, quotes, links and pictures. No styles, classes, scripts or frames.
 * Pictures must be files stored with the policy; links may point to web
 * pages, email addresses, or elsewhere in the portal.
 */
import sanitizeHtml from 'sanitize-html';

/** Where a policy's stored file is served. */
export const policyFileUrl = (fileId) => `/api/policies/files/${fileId}`;

const URL_ATTRIBUTE = /(?:src|href)="([^"]+)"/g;

const POLICY_LINK = /\/policies\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[?#].*)?$/i;

const FILE_URL = /^\/api\/policies\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

const OPTIONS = {
  allowedTags: [
    'h2', 'h3', 'h4', 'p', 'br', 'hr', 'strong', 'em', 'u', 's', 'sub', 'sup',
    'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'code', 'pre',
    'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'class'],
    // Section addresses on headings: written below from the heading's own
    // words, so a re-save keeps the addresses other documents link to.
    h2: ['id'],
    h3: ['id'],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
    ol: ['start'],
  },
  // The one class an author may set on a picture: the frame opt-out. Any
  // other class word is stripped, so content styling stays in the stylesheet.
  allowedClasses: { img: ['bare'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  // A picture may only be one of this policy's stored files: no other site,
  // and no data: URIs, which would swell every page and every backup.
  allowedSchemesByTag: { img: [] },
  allowProtocolRelative: false,
  // The page title is the document's own heading, so the text starts one
  // level down; Word's bold and italic arrive as b and i.
  transformTags: {
    h1: 'h2',
    h5: 'h4',
    h6: 'h4',
    b: 'strong',
    i: 'em',
    strike: 's',
    del: 's',
    a: (tagName, attribs) => {
      const href = attribs.href || '';
      const external = /^https?:\/\//i.test(href);
      return {
        tagName,
        attribs: {
          ...(href ? { href } : {}),
          ...(attribs.title ? { title: attribs.title } : {}),
          // A link out of the portal opens on its own, and the page it opens
          // gets no handle back to this one.
          ...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
        },
      };
    },
  },
  exclusiveFilter: (frame) => frame.tag === 'img' && !FILE_URL.test(frame.attribs.src || ''),
};

/** The stored form of a policy body: clean HTML, safe to show as it is, with
 *  section addresses on its headings. */
export function cleanPolicyHtml(html) {
  return addHeadingIds(sanitizeHtml(String(html ?? ''), OPTIONS).trim());
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };

/** The words of a clean body, for searching and for telling an empty page. */
export function policyText(cleanHtml) {
  // End each block with a line break first, so the last word of one
  // paragraph and the first of the next do not run together.
  const spaced = String(cleanHtml ?? '').replace(/<\/(p|h[2-4]|li|td|th|caption|blockquote|pre)>|<br\s*\/?>/gi, '$&\n');
  const text = sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} });
  return text
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name) => ENTITIES[name])
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** The stored files a clean body shows or links to, each once. */
export function referencedFileIds(cleanHtml) {
  const ids = new Set();
  for (const [, url] of String(cleanHtml ?? '').matchAll(URL_ATTRIBUTE)) {
    const match = FILE_URL.exec(url);
    if (match) ids.add(match[1].toLowerCase());
  }
  return [...ids];
}

/** The library documents a clean body links to, each once, lowercase. */
export function referencedPolicyIds(cleanHtml) {
  const ids = new Set();
  for (const [, url] of String(cleanHtml ?? '').matchAll(URL_ATTRIBUTE)) {
    const match = POLICY_LINK.exec(url);
    if (match) ids.add(match[1].toLowerCase());
  }
  return [...ids];
}

/** How much of a heading's text a section address keeps, matching the reader. */
const SLUG_LIMIT = 60;

const COMBINING_MARKS = /[\u0300-\u036f]/g;

/** Advances the numbering map for one more heading, as in headingAnchors. */
function nextHeadingAnchor(seen, text) {
  const base = (String(text ?? '').trim().toLowerCase().normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_LIMIT)) || 'section';
  const count = (seen.get(base) ?? 0) + 1;
  seen.set(base, count);
  return count === 1 ? base : `${base}-${count}`;
}

/**
 * The section address for each heading text, numbered where words repeat —
 * the same rule the reader uses, so a stored address is the address the
 * contents panel and any deep link point at.
 */
export function headingAnchors(texts) {
  const seen = new Map();
  return texts.map((text) => nextHeadingAnchor(seen, text));
}

const ENTITIES_IN_TEXT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };

const HEADING = /<(h[23])([^>]*)>([\s\S]*?)<\/h[23]>/gi;

/**
 * Gives every h2/h3 an id, as part of the stored content. Ids the body
 * already carries are kept (and taken into account when numbering), so a
 * re-save never renumbers the addresses other documents link to.
 */
export function addHeadingIds(html) {
  const seen = new Map();
  // Seed the numbering with the ids the text already carries.
  for (const { attrs } of String(html ?? '').matchAll(HEADING)) {
    const existing = (/(?:^|\s)id=["']([^"']*)["']/.exec(attrs) || [])[1];
    if (existing) seen.set(existing.toLowerCase(), (seen.get(existing.toLowerCase()) ?? 0) + 1);
  }
  return String(html ?? '').replace(HEADING, (whole, tag, attrs, inner) => {
    const existing = (/(?:^|\s)id=["']([^"']*)["']/.exec(attrs) || [])[1];
    if (existing) return whole;
    const text = inner.replace(/<[^>]*>/g, '')
      .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name) => ENTITIES_IN_TEXT[name] ?? '')
      .trim();
    return `<${tag}${attrs} id="${nextHeadingAnchor(seen, text)}">${inner}</${tag}>`;
  });
}

