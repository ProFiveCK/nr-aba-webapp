import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// The printed form itself (labels, lines, headings, boilerplate) stays black,
// like the original paper form. Anything actually filled in for this
// application — the applicant's details, the ticks showing what was chosen,
// the dates, the days, the approval line — is drawn in the portal's brand
// blue, so a reader can tell at a glance what's "the form" and what's "this
// person's answer" without hunting for it.
const ink = rgb(0, 0, 0);
const fill = rgb(0, 0.169, 0.498); // #002B7F
const rule = rgb(0.55, 0.57, 0.62);
const bandFill = rgb(0.9, 0.93, 0.98);
const pageWidth = 595; // A4 (matches the original supplied form's page size)
const pageHeight = 842;
const margin = 42;
const contentRight = pageWidth - margin;
const contentWidth = contentRight - margin;

// Drawn from scratch so every line and column is straight. The previous
// version overlaid text on a scanned 2023 paper form; the scan itself was
// photographed slightly askew, so text sitting on a perfectly horizontal
// baseline drifted away from the scan's crooked printed lines the further it
// sat from the top-left corner. Rebuilding the form as vectors removes the
// scan (and its skew) entirely while keeping the same sections, wording and
// reading order an officer would recognise from the paper original.

const LEAVE_ROWS = [
  { kind: 'annual', label: 'ANNUAL LEAVE' },
  { kind: 'furlough', label: 'FURLOUGH LEAVE' },
  { kind: 'sickWithMc', label: 'SICK LEAVE (WITH M/C) (7 DAYS)' },
  { kind: 'sickWithoutMc', label: 'SICK LEAVE (WITHOUT M/C) (3 DAYS)' },
  { kind: 'special', label: 'SPECIAL LEAVE' },
  { kind: 'unpaid', label: 'LEAVE WITHOUT PAY' },
  { kind: 'medical', label: 'MEDICAL LEAVE (3 MONTHS)' },
  { kind: 'parental', label: 'MATERNITY/PATERNITY LEAVE' },
  { kind: 'study', label: 'STUDY LEAVE' },
  { kind: 'official', label: 'SPECIAL LEAVE (OFFICIAL)' },
  { kind: 'adoption', label: 'ADOPTION LEAVE' },
];

const CHECKBOXES = [
  { kind: 'annual', label: 'Annual leave', note: "(Requires 2 weeks' notice)" },
  { indent: true, label: 'Prepayment of leave', note: '(Attach letter of request)' },
  { kind: 'furlough', label: 'Furlough Leave', note: '(Requires 1 month notice)' },
  { indent: true, label: 'Prepayment of leave', note: '(Attach letter of request)' },
  { kind: 'sick', label: 'Sick leave', note: '(Attach medical certificate for sick leave more than 1 day)' },
  { pair: true, left: 'With medical certificate', leftKind: 'sickWithMc', right: 'Without medical certificate', rightKind: 'sickWithoutMc' },
  { kind: 'special', label: 'Special leave', note: '(State reason for leave)' },
  { kind: 'unpaid', label: 'Leave without pay', note: '(Requires 1 month notice and letter stating reason)' },
  { kind: 'medical', label: 'Medical leave', note: '(Attach Medical Certificate)' },
  { kind: 'parental', label: 'Maternity/Paternity leave', note: '(Attach Medical Certificate)' },
  { kind: 'study', label: 'Study leave', note: '(Attach relevant documents)' },
  { kind: 'official', label: 'Special leave (Official)', note: '(Attach relevant documents)' },
  { kind: 'adoption', label: 'Adoption leave', note: '(Attach relevant documents)' },
];

function formKind(name) {
  const value = String(name || '').trim().toLowerCase();
  if (value === 'annual' || value === 'annual leave') return 'annual';
  if (value === 'furlough' || value === 'furlough leave') return 'furlough';
  if (value === 'sick (with mc)' || value === 'sick leave (with mc)') return 'sickWithMc';
  if (value === 'sick (without mc)' || value === 'sick leave (without mc)') return 'sickWithoutMc';
  if (value === 'sick' || value === 'sick leave') return 'sickUnspecified';
  if (value === 'special' || value === 'special leave') return 'special';
  if (value === 'leave without pay') return 'unpaid';
  if (value === 'medical' || value === 'medical leave') return 'medical';
  if (/^(maternity|paternity|maternity\/paternity)( leave)?$/.test(value)) return 'parental';
  if (value === 'study' || value === 'study leave') return 'study';
  if (value === 'official' || value === 'special leave (official)') return 'official';
  if (value === 'adoption' || value === 'adoption leave') return 'adoption';
  return null;
}

// Any sick-leave kind ticks the parent "Sick leave" box, same as a person
// would circle both the category and the with/without-certificate option on
// the paper form.
function isSickKind(kind) {
  return kind === 'sickWithMc' || kind === 'sickWithoutMc' || kind === 'sickUnspecified';
}

function printable(value) {
  return String(value ?? '')
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7e\xA0-\xFF\n]/g, '?');
}

function dateOnly(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function wrap(text, font, size, maxWidth) {
  const lines = [];
  for (const paragraph of printable(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        line = word;
        while (font.widthOfTextAtSize(line, size) > maxWidth) {
          let end = line.length - 1;
          while (end > 1 && font.widthOfTextAtSize(line.slice(0, end), size) > maxWidth) end--;
          lines.push(line.slice(0, end));
          line = line.slice(end);
        }
      }
    }
    if (line) lines.push(line);
    if (!paragraph.trim()) lines.push('');
  }
  return lines;
}

export async function generateLeaveApplicationPdf(form) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([pageWidth, pageHeight]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  // All drawing happens in "distance from the top" coordinates (`top`) and is
  // converted to PDF's bottom-up space here, in one place, so every other
  // helper below reads as a normal top-down page layout.
  const toY = (top) => pageHeight - top;

  const text = (str, x, top, opts = {}) => {
    const size = opts.size ?? 8.5;
    const face = opts.italic ? italic : opts.bold ? bold : font;
    const color = opts.color ?? ink;
    let content = printable(str).replace(/\s+/g, ' ').trim();
    if (opts.maxWidth) {
      while (content && face.widthOfTextAtSize(content, size) > opts.maxWidth) content = content.slice(0, -1);
    }
    let drawX = x;
    if (opts.align === 'center') drawX = x - face.widthOfTextAtSize(content, size) / 2;
    if (opts.align === 'right') drawX = x - face.widthOfTextAtSize(content, size);
    page.drawText(content, { x: drawX, y: toY(top), size, font: face, color });
    return face.widthOfTextAtSize(content, size);
  };

  const hLine = (x1, x2, top, opts = {}) => {
    page.drawLine({ start: { x: x1, y: toY(top) }, end: { x: x2, y: toY(top) }, thickness: opts.thickness ?? 0.75, color: opts.color ?? ink });
  };
  const vLine = (x, top1, top2, opts = {}) => {
    page.drawLine({ start: { x, y: toY(top1) }, end: { x, y: toY(top2) }, thickness: opts.thickness ?? 0.75, color: opts.color ?? ink });
  };
  const box = (x, top, w, h, opts = {}) => {
    page.drawRectangle({ x, y: toY(top) - h, width: w, height: h, borderColor: opts.borderColor ?? ink, borderWidth: opts.borderWidth ?? 0.75, color: opts.fill });
  };
  // The circle is part of the printed form (black); an actual tick is this
  // application's data, so it's drawn in the fill colour like everything
  // else that was filled in rather than pre-printed.
  const checkbox = (x, top, checked) => {
    const r = 3.6;
    page.drawCircle({ x: x + r, y: toY(top) + r - 1, size: r, borderColor: ink, borderWidth: 0.75 });
    if (checked) {
      text('X', x + r - 2.4, top - 0.6, { size: 7, bold: true, color: fill });
    }
  };
  const field = (label, labelX, lineX1, lineX2, top, value, opts = {}) => {
    text(label, labelX, top, { size: opts.labelSize ?? 8.5, bold: true });
    hLine(lineX1, lineX2, top + 2);
    if (value) text(value, lineX1 + 4, top, { size: opts.valueSize ?? 8.5, maxWidth: lineX2 - lineX1 - 8, color: fill });
  };

  // --- Header -------------------------------------------------------------
  box(margin, 40, contentWidth, 46);
  text('REPUBLIC OF NAURU', pageWidth / 2, 53, { size: 11, bold: true, align: 'center' });
  text('NAURU PUBLIC SERVICE', pageWidth / 2, 66, { size: 9.5, bold: true, align: 'center' });
  const titleWidth = text('LEAVE APPLICATION', pageWidth / 2, 80, { size: 9.5, bold: true, align: 'center' });
  hLine(pageWidth / 2 - titleWidth / 2, pageWidth / 2 + titleWidth / 2, 82);

  // --- Applicant details ---------------------------------------------------
  field('Applicant Name:', margin, margin + 92, contentRight, 103, form.employee_name, { valueSize: 9.5 });
  field('Department:', margin, margin + 70, 300, 119, form.department_code || '');
  field('Division:', 318, 358, contentRight, 119, form.division_code || '');
  field('Leave   Date   From:', margin, margin + 108, 300, 139, dateOnly(form.start_date));
  field('To:', 318, 340, contentRight, 139, dateOnly(form.end_date));

  // --- Leave type checklist -------------------------------------------------
  text('Leave applied for:', margin, 157, { size: 9, bold: true });
  let row = 171;
  const rowStep = 12.2;
  const selected = formKind(form.leave_type_name);
  for (const item of CHECKBOXES) {
    if (item.pair) {
      checkbox(58, row, selected === item.leftKind);
      text(item.left, 70, row, { size: 8 });
      checkbox(306, row, selected === item.rightKind);
      text(item.right, 318, row, { size: 8 });
    } else if (item.indent) {
      checkbox(70, row, false);
      text(item.label, 82, row, { size: 8 });
      text(item.note, 306, row, { size: 8, italic: true, color: rule });
    } else {
      checkbox(46, row, selected === item.kind || (item.kind === 'sick' && isSickKind(selected)));
      text(item.label, 58, row, { size: 8, bold: true });
      text(item.note, 306, row, { size: 8, italic: true, color: rule });
    }
    row += rowStep;
  }

  // --- Explanation ----------------------------------------------------------
  const explanationTop = row + 6;
  text('Explanation / reason for leave', margin, explanationTop, { size: 9, bold: true });
  const reason = String(form.reason || '').trim();
  // Wrapped at the continuation page's font/size (9pt, full content width) since
  // those are the lines actually drawn there; the single-line preview on this
  // page is rendered smaller, so it always fits within whatever wrapped here.
  const reasonLines = wrap(reason || 'No explanation recorded for this earlier application.', font, 9, contentWidth);
  if (reasonLines.length <= 1) {
    text(reasonLines[0] || '', margin + 4, explanationTop + 13, { size: 8, color: fill });
  } else {
    text('See explanation attached on page 2.', margin + 4, explanationTop + 13, { size: 8, bold: true, color: fill });
  }
  if (!selected || selected === 'sickUnspecified') {
    const credit = form.balances?.find((balance) => balance.leave_type_name === form.leave_type_name)?.before;
    const label = selected === 'sickUnspecified'
      ? 'Sick leave: certificate status not recorded'
      : `Other approved leave type: ${form.leave_type_name}`;
    text(`${label} - ${Number(form.days).toFixed(2)} days${Number.isFinite(Number(credit)) && credit != null ? `; credit ${Number(credit).toFixed(2)} days` : ''}`,
      margin + 4, explanationTop + 25, { size: 7.5, maxWidth: contentWidth - 8, italic: true, color: fill });
  }

  const sigTop = explanationTop + 36;
  hLine(margin, contentRight, sigTop);
  text('Applicant signature', 350, sigTop + 11, { size: 7.5 });
  // A blank "/  /" only made sense on paper, for someone to hand-write a
  // date next to their signature. This copy is generated from an
  // already-decided, dated record, so the date the application was actually
  // submitted is printed instead of leaving it for someone to fill in later.
  text(dateOnly(form.applied_at), 470, sigTop + 11, { size: 7.5, color: fill });

  // --- Department sign-off table --------------------------------------------
  let tableTop = sigTop + 22;
  box(margin, tableTop, contentWidth, 13, { fill: bandFill });
  text('THIS SECTION TO BE COMPLETED BY DEPARTMENT — SECTION HEAD & HEAD OF DEPARTMENT', pageWidth / 2, tableTop + 9, { size: 6.8, bold: true, align: 'center' });
  tableTop += 13;

  const labelColRight = margin + 225;
  const groupWidth = (contentRight - labelColRight) / 2;
  const subColWidth = groupWidth / 4;
  const group1X = labelColRight;
  const group2X = labelColRight + groupWidth;
  const subHeaders = ['HRS', 'DAYS', 'WEEKS', 'MONTHS'];

  const headerRowH = 12;
  const subHeaderRowH = 11;
  box(margin, tableTop, contentWidth, headerRowH + subHeaderRowH);
  vLine(labelColRight, tableTop, tableTop + headerRowH + subHeaderRowH);
  vLine(group2X, tableTop, tableTop + headerRowH + subHeaderRowH);
  hLine(labelColRight, contentRight, tableTop + headerRowH);
  text('LEAVE APPLIED FOR', group1X + groupWidth / 2, tableTop + 8.5, { size: 6.8, bold: true, align: 'center' });
  text('AVAILABLE CREDIT', group2X + groupWidth / 2, tableTop + 8.5, { size: 6.8, bold: true, align: 'center' });
  for (let i = 0; i < 4; i++) {
    vLine(group1X + i * subColWidth, tableTop + headerRowH, tableTop + headerRowH + subHeaderRowH);
    vLine(group2X + i * subColWidth, tableTop + headerRowH, tableTop + headerRowH + subHeaderRowH);
    text(subHeaders[i], group1X + i * subColWidth + subColWidth / 2, tableTop + headerRowH + 8, { size: 6, bold: true, align: 'center' });
    text(subHeaders[i], group2X + i * subColWidth + subColWidth / 2, tableTop + headerRowH + 8, { size: 6, bold: true, align: 'center' });
  }
  vLine(group1X + 4 * subColWidth, tableTop, tableTop + headerRowH + subHeaderRowH);
  vLine(group2X + 4 * subColWidth, tableTop, tableTop + headerRowH + subHeaderRowH);

  let rowTop = tableTop + headerRowH + subHeaderRowH;
  const dataRowH = 12.6;
  const daysX1 = group1X + subColWidth * 1.5;
  const daysX2 = group2X + subColWidth * 1.5;
  for (const def of LEAVE_ROWS) {
    box(margin, rowTop, contentWidth, dataRowH);
    vLine(labelColRight, rowTop, rowTop + dataRowH);
    vLine(group2X, rowTop, rowTop + dataRowH);
    for (let i = 1; i < 4; i++) {
      vLine(group1X + i * subColWidth, rowTop, rowTop + dataRowH);
      vLine(group2X + i * subColWidth, rowTop, rowTop + dataRowH);
    }
    text(def.label, margin + 4, rowTop + 9, { size: 6.8 });
    if (def.kind === selected) {
      text(Number(form.days).toFixed(2), daysX1, rowTop + 9, { size: 7.5, bold: true, align: 'center', color: fill });
    }
    if (form.approval_snapshot_available && Array.isArray(form.balances)) {
      const balance = form.balances.find((b) => formKind(b.leave_type_name) === def.kind);
      if (balance && Number.isFinite(Number(balance.before))) {
        text(Number(balance.before).toFixed(2), daysX2, rowTop + 9, { size: 7.5, align: 'center', color: fill });
      }
    }
    rowTop += dataRowH;
  }
  if (!form.approval_snapshot_available) {
    text('Approval-time balance unavailable; HR to verify.', margin, rowTop + 10, { size: 7, italic: true, color: fill });
    rowTop += 12;
  }

  // --- Recommendation and department sign-off --------------------------------
  // This copy only ever exists for an approved application, so "recommended"
  // is always yes — there's no separate recommendation ever recorded.
  let y = rowTop + 14;
  text('Leave recommended', margin, y, { size: 8 });
  checkbox(140, y, true);
  text('Yes', 152, y, { size: 8 });
  checkbox(178, y, false);
  text('No', 190, y, { size: 8 });

  // The signature line sits further below the row above it than before, so
  // there's an actual blank space for the Section Head to sign into rather
  // than a line crowding straight into the text above it.
  y += 26;
  hLine(360, contentRight, y);
  text('Section Head', pageWidth - (contentRight - 360) / 2, y + 10, { size: 7, align: 'center' });

  y += 24;
  field('State reason if NO:', margin, margin + 100, contentRight, y, '');
  y += 20;
  hLine(360, contentRight, y);
  text('Head of Department', pageWidth - (contentRight - 360) / 2, y + 10, { size: 7, align: 'center' });

  // --- HR verification --------------------------------------------------------
  y += 20;
  box(margin, y, contentWidth, 13, { fill: bandFill });
  text('THIS SECTION TO BE COMPLETED BY HUMAN RESOURCE & LABOUR DEPARTMENT', pageWidth / 2, y + 9, { size: 6.8, bold: true, align: 'center' });
  y += 13;
  const hrCol2 = margin + 150;
  const hrCol3 = margin + 320;
  box(margin, y, contentWidth, 13);
  vLine(hrCol2, y, y + 13);
  vLine(hrCol3, y, y + 13);
  text('LEAVE APPLIED', margin + 4, y + 9, { size: 6.8, bold: true, italic: true });
  text('AVAILABLE CREDITS', hrCol2 + 4, y + 9, { size: 6.8, bold: true, italic: true });
  text('COMMENTS/REASONS', hrCol3 + 4, y + 9, { size: 6.8, bold: true, italic: true });
  y += 13;
  box(margin, y, contentWidth, 13);
  vLine(hrCol2, y, y + 13);
  vLine(hrCol3, y, y + 13);
  if (form.leave_type_name) text(form.leave_type_name, margin + 4, y + 9, { size: 7, color: fill });
  y += 27;
  field('Verified by:', margin, margin + 70, 260, y, '');

  // Treasury's recorded decision is final. No handwritten signature is
  // fabricated: Section Head, HR, applicant and Chief Secretary lines remain
  // on the form exactly as the paper original shows them.
  y += 20;
  text(`Treasury approval: ${form.approved_by_name || 'Recorded approver'}  |  ${dateOnly(form.approved_at)}`, margin, y, { size: 7.5, italic: true, color: fill });

  // Centred as one block rather than pinned to the left margin, so it reads
  // as the form's final decision line rather than an afterthought — and
  // lines up visually with the centred Chief Secretary signature below it.
  y += 20;
  const approvedLabel = 'APPROVED';
  const notApprovedLabel = 'NOT APPROVED';
  const boxSize = 7.2;
  const gap = 9;
  const approvedWidth = bold.widthOfTextAtSize(approvedLabel, 9.5);
  const slashWidth = bold.widthOfTextAtSize('/', 9.5);
  const notApprovedWidth = bold.widthOfTextAtSize(notApprovedLabel, 9.5);
  const decisionWidth = boxSize + gap + approvedWidth + gap * 1.5 + slashWidth + gap * 1.5 + notApprovedWidth;
  let decisionX = pageWidth / 2 - decisionWidth / 2;
  checkbox(decisionX, y, true); // APPROVED; NOT APPROVED stays unmarked.
  decisionX += boxSize + gap;
  text(approvedLabel, decisionX, y, { size: 9.5, bold: true });
  decisionX += approvedWidth + gap * 1.5;
  text('/', decisionX, y, { size: 9.5, bold: true });
  decisionX += slashWidth + gap * 1.5;
  text(notApprovedLabel, decisionX, y, { size: 9.5, bold: true });

  y += 24;
  hLine(pageWidth / 2 - 70, pageWidth / 2 + 70, y);
  text('Chief Secretary', pageWidth / 2, y + 11, { size: 8, align: 'center' });

  text(`Application ref: ${form.id}`, margin, pageHeight - margin + 10, { size: 6.5, color: rule });

  pdf.setTitle(`Approved leave application - ${printable(form.employee_name)}`);
  pdf.setSubject('Treasury-approved Nauru Public Service leave application');

  if (reasonLines.length > 1) {
    let extra;
    let extraY;
    const nextPage = () => {
      extra = pdf.addPage([pageWidth, pageHeight]);
      extra.drawText('LEAVE APPLICATION - EXPLANATION', { x: margin, y: pageHeight - 60, font: bold, size: 13, color: ink });
      extra.drawText(`Application ref: ${printable(form.id)}`, { x: margin, y: pageHeight - 82, font, size: 9, color: ink });
      extraY = pageHeight - 110;
    };
    nextPage();
    for (const line of reasonLines) {
      if (extraY < 55) nextPage();
      extra.drawText(line, { x: margin, y: extraY, font, size: 9, color: fill });
      extraY -= 14;
    }
  }

  return pdf.save();
}
