/**
 * Reads and amends ABA (Cemtex) files on the server.
 *
 * The browser builds the file, but the bytes stored here are what the bank
 * pays, so the server never takes them on trust: every file is parsed before
 * it is stored, and value-date changes are made by editing the stored file
 * rather than by accepting a new one.
 *
 * Layout, 120 characters per record (0-based [start, end)):
 *   0  header   [62,74) description  [74,80) processing date DDMMYY
 *   1  detail   [1,8) BSB  [8,17) account  [18,20) txn code  [20,30) cents
 *               [30,62) title  [62,80) lodgement ref  [96,112) remitter
 *   7  trailer  [20,30) net  [30,40) credits  [40,50) debits  [74,80) count
 */
import { badRequest } from './serviceError.js';

const RECORD_LENGTH = 120;
const DEBIT_CODE = '13';
const CREDIT_CODES = new Set(['50', '51', '52', '53', '54', '55', '56', '57']);

function splitRecords(text) {
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function cents(field, what) {
  if (!/^\d{10}$/.test(field)) throw badRequest(`ABA file: ${what} is not a number.`);
  return Number(field);
}

/**
 * Parses an ABA file and checks it adds up. Throws a 400 ServiceError naming
 * the first problem found.
 */
export function parseAbaFile(buffer) {
  const records = splitRecords(Buffer.from(buffer).toString('utf8'));
  if (records.length < 3) throw badRequest('ABA file: needs a header, at least one detail line and a trailer.');

  records.forEach((record, i) => {
    if (record.length !== RECORD_LENGTH) {
      throw badRequest(`ABA file: line ${i + 1} is ${record.length} characters, not ${RECORD_LENGTH}.`);
    }
  });
  const [head, ...rest] = records;
  const tail = rest.pop();
  if (head[0] !== '0') throw badRequest('ABA file: the first line is not a header (type 0).');
  if (tail[0] !== '7') throw badRequest('ABA file: the last line is not a trailer (type 7).');

  let credits = 0;
  let debits = 0;
  const details = rest.map((record, i) => {
    const line = i + 2;
    if (record[0] !== '1') throw badRequest(`ABA file: line ${line} is not a detail line (type 1).`);
    const txnCode = record.slice(18, 20);
    const amount = cents(record.slice(20, 30), `line ${line} amount`);
    if (txnCode === DEBIT_CODE) debits += amount;
    else if (CREDIT_CODES.has(txnCode)) credits += amount;
    else throw badRequest(`ABA file: line ${line} has unknown transaction code ${txnCode}.`);
    return {
      bsb: record.slice(1, 8),
      account: record.slice(8, 17).trim(),
      txnCode,
      cents: amount,
      title: record.slice(30, 62).trimEnd(),
      lodgementRef: record.slice(62, 80).trimEnd(),
    };
  });

  const trailer = {
    net: cents(tail.slice(20, 30), 'trailer net total'),
    credits: cents(tail.slice(30, 40), 'trailer credit total'),
    debits: cents(tail.slice(40, 50), 'trailer debit total'),
    count: Number(tail.slice(74, 80)),
  };
  if (trailer.credits !== credits || trailer.debits !== debits) {
    throw badRequest('ABA file: the trailer totals do not match the detail lines.');
  }
  if (trailer.net !== Math.abs(credits - debits)) throw badRequest('ABA file: the trailer net total is wrong.');
  if (trailer.count !== details.length) throw badRequest('ABA file: the trailer line count is wrong.');

  return {
    header: { desc: head.slice(62, 74).trimEnd(), proc: head.slice(74, 80) },
    details,
    credits: details.filter((d) => d.txnCode !== DEBIT_CODE),
    trailer,
  };
}

const pad = (value, width) => String(value).padEnd(width, ' ').slice(0, width);
const splice = (record, start, end, value) => record.slice(0, start) + pad(value, end - start) + record.slice(end);

/**
 * Returns a copy of the file with a new processing date and, optionally, a
 * new description and remitter. Nothing else changes: payees, accounts and
 * amounts are carried over byte for byte. The balancing debit's lodgement
 * reference is "<desc>-<date>", so it follows the new values, as it does when
 * the browser builds the file.
 */
export function amendValueDate(buffer, { proc, desc, remitter }) {
  if (!/^\d{6}$/.test(proc)) throw badRequest('Processing date must be DDMMYY (6 digits).');
  const text = Buffer.from(buffer).toString('utf8');
  parseAbaFile(buffer);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const records = splitRecords(text);

  let header = records[0];
  if (typeof desc === 'string') header = splice(header, 62, 74, desc);
  header = splice(header, 74, 80, proc);
  records[0] = header;
  const newDesc = header.slice(62, 74).trimEnd();

  for (let i = 1; i < records.length - 1; i++) {
    let record = records[i];
    if (typeof remitter === 'string') record = splice(record, 96, 112, remitter);
    if (record.slice(18, 20) === DEBIT_CODE) record = splice(record, 62, 80, `${newDesc}-${proc}`);
    records[i] = record;
  }
  return Buffer.from(records.join(eol) + eol, 'utf8');
}
