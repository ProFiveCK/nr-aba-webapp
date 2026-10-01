import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const templatePath = fileURLToPath(new URL('../../assets/leave-application-2023.pdf', import.meta.url));
const ink = rgb(0.04, 0.12, 0.3);
const formWidth = 1240;
const formHeight = 1755;

// The supplied one-page form is a scan. Coordinates below are measured against
// its 1240 x 1755 preview so the original layout and signature spaces survive.
const rows = {
  annual: 935,
  furlough: 959,
  sickWithMc: 982,
  sickWithoutMc: 1006,
  special: 1030,
  unpaid: 1054,
  medical: 1078,
  parental: 1102,
  study: 1126,
  official: 1150,
  adoption: 1174,
};

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

function printable(value) {
  return String(value ?? '')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
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
  const pdf = await PDFDocument.load(await readFile(templatePath));
  const page = pdf.getPage(0);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const xScale = page.getWidth() / formWidth;
  const yScale = page.getHeight() / formHeight;
  const text = (value, x, top, options = {}) => {
    const size = options.size ?? 9;
    const face = options.bold ? bold : font;
    const original = printable(value).replace(/\s+/g, ' ').trim();
    let content = original;
    if (options.maxWidth) {
      const max = options.maxWidth * xScale;
      while (content && face.widthOfTextAtSize(content, size) > max) content = content.slice(0, -1);
      if (content.length < original.length) content = `${content.slice(0, -3)}...`;
    }
    page.drawText(content, { x: x * xScale, y: page.getHeight() - top * yScale, size, font: face, color: ink });
  };
  const mark = (x, top) => text('X', x, top, { size: 10, bold: true });

  text(form.employee_name, 313, 205, { size: 10, maxWidth: 695 });
  text(form.department_code || '', 280, 233, { size: 10, maxWidth: 300 });
  // HR has no employee division field. Its space on the paper form stays blank.
  text(dateOnly(form.start_date), 360, 283, { size: 10, maxWidth: 205 });
  text(dateOnly(form.end_date), 665, 283, { size: 10, maxWidth: 260 });

  const selected = formKind(form.leave_type_name);
  const circles = {
    annual: [160, 355], furlough: [160, 405], sickWithMc: [160, 456],
    sickWithoutMc: [160, 456], sickUnspecified: [160, 456], special: [160, 507], unpaid: [160, 532],
    medical: [160, 557], parental: [160, 582], study: [160, 608],
    official: [160, 632], adoption: [160, 658],
  };
  if (selected) mark(...circles[selected]);
  if (selected === 'sickWithMc') mark(260, 481);
  if (selected === 'sickWithoutMc') mark(637, 481);
  if (!selected || selected === 'sickUnspecified') {
    const credit = form.balances?.find((balance) => balance.leave_type_name === form.leave_type_name)?.before;
    const label = selected === 'sickUnspecified'
      ? 'Sick leave: certificate status not recorded'
      : `Other approved leave type: ${form.leave_type_name}`;
    text(`${label} - ${Number(form.days).toFixed(2)} days${Number.isFinite(Number(credit)) && credit != null ? `; credit ${Number(credit).toFixed(2)} days` : ''}`,
      157, 683, { size: 8, maxWidth: 900 });
  }

  // The original caption limited this line to Sick/Special leave; the new
  // workflow requires an explanation for every leave category.
  page.drawRectangle({
    x: 150 * xScale, y: page.getHeight() - 720 * yScale,
    width: 410 * xScale, height: 30 * yScale, color: rgb(1, 1, 1),
  });
  text('Explanation / reason for leave', 153, 713, { size: 10, bold: true });
  const reason = String(form.reason || '').trim();
  const reasonLines = wrap(reason || 'No explanation recorded for this earlier application.', font, 9, 900 * xScale);
  if (reasonLines.length <= 1) {
    text(reasonLines[0] || '', 157, 737, { size: 9 });
  } else {
    text('See explanation attached on page 2.', 157, 737, { size: 9, bold: true });
  }

  if (selected && rows[selected]) text(Number(form.days).toFixed(2), 545, rows[selected] - 4, { size: 9 });
  if (form.approval_snapshot_available && Array.isArray(form.balances)) {
    for (const balance of form.balances) {
      const kind = formKind(balance.leave_type_name);
      if (kind && rows[kind] && Number.isFinite(Number(balance.before))) {
        text(Number(balance.before).toFixed(2), 846, rows[kind] - 4, { size: 9 });
      }
    }
  } else {
    text('Approval-time balance unavailable; HR to verify.', 704, 1456, { size: 8, maxWidth: 387 });
  }

  // Treasury's recorded decision is final. No handwritten signature is
  // fabricated: Section Head, HR, applicant and Chief Secretary lines remain.
  text(`Treasury approval: ${form.approved_by_name || 'Recorded approver'}  |  ${dateOnly(form.approved_at)}`, 148, 1542, { size: 8, maxWidth: 950 });
  mark(427, 1596); // APPROVED; leave NOT APPROVED unmarked.
  text(`Application ref: ${form.id}`, 147, 1706, { size: 7, maxWidth: 900 });

  if (reasonLines.length > 1) {
    let extra;
    let y;
    const nextPage = () => {
      extra = pdf.addPage([595, 842]);
      extra.drawText('LEAVE APPLICATION - EXPLANATION', { x: 50, y: 790, font: bold, size: 14, color: ink });
      extra.drawText(`Application ref: ${printable(form.id)}`, { x: 50, y: 765, font, size: 9, color: ink });
      y = 730;
    };
    nextPage();
    for (const line of reasonLines) {
      if (y < 55) nextPage();
      extra.drawText(line, { x: 50, y, font, size: 9, color: ink });
      y -= 14;
    }
  }

  pdf.setTitle(`Approved leave application - ${printable(form.employee_name)}`);
  pdf.setSubject('Treasury-approved Nauru Public Service leave application');
  return pdf.save();
}
