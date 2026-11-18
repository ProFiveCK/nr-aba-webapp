import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { cleanPolicyHtml, policyFileUrl, policyText, referencedFileIds } from './policyHtml.js';

const FILE = '0b9a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';

describe('what a policy page may contain', () => {
  test('scripts, event handlers, styles and frames never reach the page', () => {
    const clean = cleanPolicyHtml(
      '<p style="color:red" class="x" onclick="steal()">Hello<script>alert(1)</script></p>'
      + '<iframe src="https://example.com"></iframe><style>p{}</style><form><input></form>',
    );
    assert.equal(clean, '<p>Hello</p>');
  });

  test('a link may go to the web, an email address or the portal, never run code', () => {
    const clean = cleanPolicyHtml(
      '<a href="javascript:alert(1)">a</a><a href="mailto:hr@gov.nr">b</a>'
      + '<a href="/policies/1#purpose">c</a><a href="https://gov.nr" target="_self">d</a>',
    );
    assert.equal(clean, '<a>a</a><a href="mailto:hr@gov.nr">b</a><a href="/policies/1#purpose">c</a>'
      + '<a href="https://gov.nr" target="_blank" rel="noopener noreferrer">d</a>');
  });

  test("a picture must be one of the library's own files", () => {
    const own = `<img src="${policyFileUrl(FILE)}" alt="Chart" onerror="x()">`;
    const clean = cleanPolicyHtml(`${own}<img src="https://example.com/x.png"><img src="//example.com/x.png">`
      + '<img src="data:image/png;base64,AAAA"><img src="/api/hr/something">');
    assert.equal(clean, `<img src="${policyFileUrl(FILE)}" alt="Chart" />`);
  });

  test('headings start below the page title, and Word-style bold and italic are kept', () => {
    assert.equal(cleanPolicyHtml('<h1>A</h1><h5>B</h5><p><b>C</b> <i>D</i></p>'),
      '<h2>A</h2><h4>B</h4><p><strong>C</strong> <em>D</em></p>');
  });

  test('tables keep their cells and merges but lose the editor sizing', () => {
    const clean = cleanPolicyHtml('<table style="min-width:50px"><colgroup><col style="min-width:25px"></colgroup>'
      + '<tbody><tr><th colspan="2" rowspan="1"><p>Head</p></th></tr></tbody></table>');
    assert.equal(clean, '<table><tbody><tr><th colspan="2" rowspan="1"><p>Head</p></th></tr></tbody></table>');
  });

  test('the words of a page are found for search, with blocks kept apart', () => {
    assert.equal(policyText(cleanPolicyHtml('<h2>Pay</h2><p>Tom &amp; Jerry</p><ul><li>one</li><li>two</li></ul>')),
      'Pay\nTom & Jerry\none\ntwo');
    assert.equal(policyText(cleanPolicyHtml('<p></p><p> </p>')), '');
  });

  test('the files a page shows or links to are listed once each', () => {
    const other = '11111111-2222-4333-8444-555555555555';
    const html = cleanPolicyHtml(`<img src="${policyFileUrl(FILE)}"><a href="${policyFileUrl(FILE)}">form</a>`
      + `<a href="${policyFileUrl(other)}">other</a><a href="/api/policies/files/not-an-id">bad</a>`);
    assert.deepEqual(referencedFileIds(html), [FILE, other]);
  });
});
