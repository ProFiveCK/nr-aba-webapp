/**
 * Turns a Word document into a policy body.
 *
 * Mammoth reads the document's structure rather than its look: a paragraph
 * styled "Heading 1" becomes a heading, a numbered list a list, a table a
 * table. Fonts, colours and spacing are left behind on purpose, so every
 * policy reads the same way in the portal whoever wrote it.
 */
import mammoth from 'mammoth';
import { cleanPolicyHtml } from '../lib/policyHtml.js';

// The policy's title is the page heading, so Word's top level starts one down.
const STYLE_MAP = [
  "p[style-name='Title'] => h2:fresh",
  "p[style-name='Subtitle'] => h3:fresh",
  "p[style-name='Heading 1'] => h2:fresh",
  "p[style-name='Heading 2'] => h3:fresh",
  "p[style-name='Heading 3'] => h4:fresh",
  "p[style-name='Heading 4'] => h4:fresh",
  "p[style-name='Heading 5'] => h4:fresh",
  "p[style-name='Heading 6'] => h4:fresh",
];

const PICTURE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/**
 * The document as a clean policy body, and anything worth telling the person
 * who imported it. `savePicture({ data, contentType })` stores one picture and
 * returns its URL; pictures a browser cannot show (Word's own drawing formats)
 * are left out and named in the notes.
 */
export async function wordToPolicyHtml(buffer, savePicture) {
  let leftOut = 0;
  const result = await mammoth.convertToHtml({ buffer }, {
    styleMap: STYLE_MAP,
    convertImage: mammoth.images.imgElement(async (image) => {
      if (!PICTURE_TYPES.has(image.contentType)) {
        leftOut += 1;
        return { src: '' };
      }
      return { src: await savePicture({ data: await image.readAsBuffer(), contentType: image.contentType }) };
    }),
  });
  const notes = [];
  if (leftOut) {
    notes.push(`${leftOut} picture${leftOut === 1 ? ' was' : 's were'} in a format a web page cannot show, and ${leftOut === 1 ? 'was' : 'were'} left out. Save ${leftOut === 1 ? 'it' : 'them'} as PNG or JPEG and add ${leftOut === 1 ? 'it' : 'them'} with Insert picture.`);
  }
  const unrecognised = new Set(result.messages
    .map((message) => /Unrecognised paragraph style: '([^']+)'/.exec(message.message)?.[1])
    .filter(Boolean));
  if (unrecognised.size) {
    notes.push(`Paragraphs in these Word styles came in as plain text: ${[...unrecognised].join(', ')}. Use Heading 1–3 in Word for headings.`);
  }
  // Word documents space themselves out with empty paragraphs, and a picture
  // left out leaves one behind; on a web page they are only gaps.
  return { html: cleanPolicyHtml(result.value).replace(/<p>\s*<\/p>/g, ''), notes };
}
