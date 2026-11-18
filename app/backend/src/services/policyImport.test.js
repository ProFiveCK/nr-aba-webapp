import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { wordToPolicyHtml } from './policyImport.js';

// A small Word document: Heading 1 and 2, bold red large text, a paragraph in
// a house style, a table, a PNG picture and an EMF drawing.
const WORD = readFileSync(new URL('../test-support/fixtures/policy-import.docx', import.meta.url));

test('a Word document arrives as plain structure, with its pictures stored', async () => {
  const stored = [];
  const { html, notes } = await wordToPolicyHtml(WORD, async ({ data, contentType }) => {
    stored.push({ contentType, bytes: data.length });
    return '/api/policies/files/0b9a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
  });

  assert.match(html, /^<h2>Purpose<\/h2><p>Staff must <strong>record every payment<\/strong> before it is released\.<\/p><h3>Steps<\/h3>/,
    'Heading 1 becomes the first level under the page title, and colour and size are left behind');
  assert.match(html, /<table><tr><td><p>Role<\/p><\/td>/);
  assert.match(html, /<img alt="Chart alt text" src="\/api\/policies\/files\/0b9a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d" \/>/);
  assert.deepEqual(stored.map((s) => s.contentType), ['image/png'], 'only the picture a browser can show is stored');
  assert.doesNotMatch(html, /<p>\s*<\/p>/, 'the picture left out leaves no empty paragraph behind');
  assert.equal(notes.length, 2);
  assert.match(notes[0], /1 picture was in a format a web page cannot show/);
  assert.match(notes[1], /Fancy Callout/);
});
