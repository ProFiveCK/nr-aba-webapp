import { readFileSync } from 'node:fs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// The approved copy is the official 2026 NPS Leave Application form
// (assets/nps-leave-application-2026.pdf) with this application's answers
// stamped onto it. The form itself stays exactly as HR designed it; anything
// filled in for this application is drawn in the portal's brand blue, so a
// reader can tell at a glance what's "the form" and what's "this person's
// answer".
const TEMPLATE = readFileSync(new URL('../../assets/nps-leave-application-2026.pdf', import.meta.url));

const ink = rgb(0, 0, 0);
const fill = rgb(0, 0.169, 0.498); // #002B7F
const muted = rgb(0.45, 0.47, 0.52);
const footerBand = rgb(0.106, 0.165, 0.29);
const footerInk = rgb(0.659, 0.784, 0.804);

// Positions on the template, in points measured from the top-left corner.
// `line` is the top of the field's underline; values sit just above it.
const FIELDS = {
  name: { x: 38, right: 285, line: 161.85 },
  email: { x: 299.65, right: 547, line: 161.85 },
  department: { x: 38, right: 285, line: 185.55 },
  position: { x: 299.65, right: 547, line: 185.55 },
  dateFrom: { x: 38, right: 232, line: 227.6 },
  dateTo: { x: 246.4, right: 337, line: 227.6 },
  total: { x: 38, right: 232, line: 260 },
  applicantSignature: { x: 38, right: 200, line: 585.55 },
  approverSignature: { x: 38, right: 285, line: 773.55 },
  approvedDate: { x: 299.65, right: 547, line: 773.55 },
};

// Left edge and baseline of each printed tick box in Section 3.
const TYPE_BOXES = {
  annual: { x: 36, baseline: 293 },
  furlough: { x: 36, baseline: 322 },
  sick: { x: 36, baseline: 351 },
  sickWithMc: { x: 329, baseline: 360 },
  sickWithoutMc: { x: 381, baseline: 360 },
  special: { x: 36, baseline: 386 },
  unpaid: { x: 36, baseline: 404 },
  medical: { x: 36, baseline: 421 },
  parental: { x: 36, baseline: 444 },
  study: { x: 36, baseline: 468 },
  official: { x: 36, baseline: 491 },
  adoption: { x: 36, baseline: 514 },
};

const APPROVED_BOX = { left: 189.5, right: 197.9, top: 721, bottom: 729.7 };
const REASON ={ x: 38, right: 557, baselines: [543.5, 560] };
const HR_CELLS = { before: [31, 124.75], after: [124.75, 218.5], top: 641.35, bottom: 662.4 };

export function leaveApplicationFormKind(name) {
  const value = String(name || '').trim().toLowerCase();
  if (value === 'annual' || value === 'annual leave') return 'annual';
  if (value === 'furlough' || value === 'furlough leave') return 'furlough';
  if (value === 'sick (with mc)' || value === 'sick leave (with mc)') return 'sickWithMc';
  if (value === 'sick (without mc)' || value === 'sick leave (without mc)') return 'sickWithoutMc';
  if (value === 'medical (with mc)') return 'sickWithMc';
  if (value === 'medical (without mc)') return 'sickWithoutMc';
  if (value === 'medical (certificate status not recorded)') return 'sickUnspecified';
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
const formKind = leaveApplicationFormKind;

// Any sick-leave kind ticks the parent "Sick Leave" box, same as a person
// would tick both the category and the with/without-certificate option on
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

const dayCount = (value) => `${Number(value).toFixed(2)} days`;

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

// Short context the form has no dedicated box for: unlisted leave types,
// parental entitlements. Printed under the reason so it stays on page one.
function contextNotes(form, selected) {
  const notes = [];
  if (!selected || selected === 'sickUnspecified') {
    const credit = form.balances?.find((balance) => balance.leave_type_name === form.leave_type_name)?.before;
    const label = selected === 'sickUnspecified'
      ? 'Sick leave: certificate status not recorded'
      : `Other approved leave type: ${form.leave_type_name}`;
    notes.push(`${label} - ${dayCount(form.days)}${credit != null && Number.isFinite(Number(credit)) ? `; credit ${dayCount(credit)}` : ''}`);
  }
  if (form.parental_note) notes.push(form.parental_note);
  return notes.join(' ');
}

function totalRequested(form) {
  if (form.duration_unit === 'hours') return `${Number(form.hours)} hours (${Number(form.days)} days from the leave balance)`;
  return dayCount(form.days);
}

export async function generateLeaveApplicationPdf(form, { firstPageOnly = false } = {}) {
  const pdf = await PDFDocument.load(TEMPLATE);
  const page = pdf.getPage(0);
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Everything is placed in "distance from the top" coordinates and converted
  // to PDF's bottom-up space here, in one place.
  const toY = (top) => pageHeight - top;

  const text = (str, x, top, opts = {}) => {
    const face = opts.bold ? bold : font;
    let size = opts.size ?? 9;
    let content = printable(str).replace(/\s+/g, ' ').trim();
    if (opts.maxWidth) {
      // Shrink a little before truncating, so a long name stays whole.
      const minSize = opts.minSize ?? size;
      while (size > minSize && face.widthOfTextAtSize(content, size) > opts.maxWidth) size -= 0.25;
      while (content && face.widthOfTextAtSize(content, size) > opts.maxWidth) content = content.slice(0, -1);
    }
    const width = face.widthOfTextAtSize(content, size);
    const drawX = opts.align === 'center' ? x - width / 2 : x;
    page.drawText(content, { x: drawX, y: toY(top), size, font: face, color: opts.color ?? fill });
  };

  const field = (key, value, opts = {}) => {
    const f = FIELDS[key];
    if (value) text(value, f.x, f.line - 3, { size: 9, minSize: 6.5, maxWidth: f.right - f.x, ...opts });
  };

  // An X drawn inside one of the form's printed boxes (given by its inner
  // edges, from the top). The APPROVED box sits on a dark band, so it gets a
  // white fill first to keep the blue mark readable.
  const tick = ({ left, right, top, bottom }, { background, thickness = 0.9 } = {}) => {
    if (background) page.drawRectangle({ x: left, y: toY(bottom), width: right - left, height: bottom - top, color: background });
    const inset = thickness * 0.8;
    const [x1, x2, y1, y2] = [left + inset, right - inset, toY(bottom) + inset, toY(top) - inset];
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color: fill });
    page.drawLine({ start: { x: x1, y: y2 }, end: { x: x2, y: y1 }, thickness, color: fill });
  };
  // The small Section 3 boxes are text glyphs: TYPE_BOXES holds each glyph's
  // left edge and baseline, and the visible square sits just inside that.
  const typeTick = ({ x, baseline }) => tick({ left: x + 0.9, right: x + 5, top: baseline - 4.1, bottom: baseline - 0.2 });

  // --- Section 1: applicant ------------------------------------------------
  field('name', form.employee_name);
  field('email', form.email);
  field('department', [form.department_code, form.division_code].filter(Boolean).join(' / '));
  field('position', form.position_title);

  // --- Section 2: leave period ---------------------------------------------
  field('dateFrom', dateOnly(form.start_date));
  field('dateTo', dateOnly(form.end_date));
  field('total', totalRequested(form));

  // --- Section 3: type of leave --------------------------------------------
  const selected = formKind(form.leave_type_name);
  if (TYPE_BOXES[selected]) typeTick(TYPE_BOXES[selected]);
  if (isSickKind(selected)) typeTick(TYPE_BOXES.sick);

  const reasonWidth = REASON.right - REASON.x;
  const reason = String(form.reason || '').trim();
  // Wrapped at the continuation page's font/size (9pt, full width) since
  // those are the lines actually drawn there when it overflows.
  const reasonLines = wrap(reason || 'No explanation recorded for this earlier application.', font, 9, reasonWidth);
  const notes = contextNotes(form, selected);
  const noteLines = notes ? wrap(notes, font, 7.5, reasonWidth) : [];
  const overflow = reasonLines.length + noteLines.length > REASON.baselines.length;
  if (!overflow) {
    [...reasonLines.map((line) => [line, 9]), ...noteLines.map((line) => [line, 7.5])]
      .forEach(([line, size], index) => text(line, REASON.x, REASON.baselines[index], { size }));
  } else {
    text(firstPageOnly ? 'Full explanation is retained in the application record.' : 'See explanation attached on page 2.',
      REASON.x, REASON.baselines[0], { size: 9, bold: true });
    if (notes) text(notes, REASON.x, REASON.baselines[1], { size: 7.5, maxWidth: reasonWidth });
  }

  // A blank applicant signature only made sense on paper. This copy is
  // generated from an already-decided, dated record, so the submission date
  // is printed in its place.
  if (form.applied_at) field('applicantSignature', `Submitted electronically ${dateOnly(form.applied_at)}`, { size: 7.5 });

  // --- Section 4: HR verification ------------------------------------------
  const cellCentre = ([left, right]) => (left + right) / 2;
  const cellBaseline = (HR_CELLS.top + HR_CELLS.bottom) / 2 + 3;
  if (form.approval_snapshot_available && Array.isArray(form.balances)) {
    const balance = form.balances.find((b) => b.leave_type_name === form.leave_type_name)
      || form.balances.find((b) => selected && formKind(b.leave_type_name) === selected);
    if (balance && form.balance_column_label) {
      // Paternity reports a single service-year figure, not a before/after
      // pair; show it with its own caption rather than as a "before" value.
      text(dayCount(balance.after), cellCentre(HR_CELLS.after), cellBaseline - 3, { size: 8, align: 'center' });
      text(form.balance_column_label, cellCentre(HR_CELLS.after), cellBaseline + 5, { size: 5.5, align: 'center', color: muted });
    } else if (balance) {
      if (Number.isFinite(Number(balance.before))) text(dayCount(balance.before), cellCentre(HR_CELLS.before), cellBaseline, { size: 8.5, align: 'center' });
      if (balance.after != null && Number.isFinite(Number(balance.after))) text(dayCount(balance.after), cellCentre(HR_CELLS.after), cellBaseline, { size: 8.5, align: 'center' });
    }
  } else {
    text('Approval-time balance unavailable; HR to verify.', 320, cellBaseline, { size: 7.5 });
  }

  // --- Section 7: final approval -------------------------------------------
  // This copy only ever exists for an approved application.
  tick(APPROVED_BOX, { background: rgb(1, 1, 1), thickness: 1.4 });
  field('approverSignature', `Approved electronically by ${form.approved_by_name || 'Recorded approver'}`, { size: 8.5 });
  field('approvedDate', dateOnly(form.approved_at));

  // The supplied form's footer still reads "Nauru"; restate it with the
  // Naoero name used everywhere else in the portal.
  page.drawRectangle({ x: 27, y: toY(814.5), width: 521, height: 14, color: footerBand });
  text('Naoero Public Service \xB7 Human Resource Division \xB7 Leave Application Form \xB7 2026', pageWidth / 2, 809.9,
    { size: 6.95, align: 'center', color: footerInk });

  text(`Application ref: ${form.id}`, 36, 794, { size: 6, color: muted });

  pdf.setTitle(`Approved leave application - ${printable(form.employee_name)}`);
  pdf.setSubject('Approved Naoero Public Service leave application');
  pdf.setProducer('Naoero Public Service leave portal');

  if (overflow && !firstPageOnly) {
    let extra;
    let extraY;
    const nextPage = () => {
      extra = pdf.addPage([pageWidth, pageHeight]);
      extra.drawText('LEAVE APPLICATION - EXPLANATION', { x: 42, y: pageHeight - 60, font: bold, size: 13, color: ink });
      extra.drawText(`Application ref: ${printable(form.id)}`, { x: 42, y: pageHeight - 82, font, size: 9, color: ink });
      extraY = pageHeight - 110;
    };
    nextPage();
    const lines = notes ? [...reasonLines, '', ...wrap(notes, font, 9, reasonWidth)] : reasonLines;
    for (const line of lines) {
      if (extraY < 55) nextPage();
      extra.drawText(line, { x: 42, y: extraY, font, size: 9, color: fill });
      extraY -= 14;
    }
  }

  return pdf.save();
}
