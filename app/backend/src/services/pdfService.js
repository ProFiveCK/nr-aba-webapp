import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export async function generateForexTTPdf(request, attachments = [], options = {}) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  let page = pdfDoc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();
  let y = height - 50;

  const margin = 50;
  const lineHeight = 14;
  const smallGap = 6;
  const sectionGap = 18;

  function newPageIfNeeded(needed = 80) {
    if (y - needed < margin) {
      page = pdfDoc.addPage([595, 842]);
      y = height - 50;
    }
  }

  function drawText(text, x, yPos, opts = {}) {
    const size = opts.size || 10;
    const color = opts.color || rgb(0, 0, 0);
    const f = opts.bold ? boldFont : font;
    page.drawText(String(text ?? ''), { x, y: yPos, size, font: f, color });
  }

  function drawSection(title) {
    newPageIfNeeded();
    y -= sectionGap;
    drawText(title, margin, y, { size: 12, bold: true, color: rgb(0.1, 0.2, 0.4) });
    y -= smallGap + 2;
    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      thickness: 0.5,
      color: rgb(0.7, 0.7, 0.7),
    });
    y -= smallGap;
  }

  function drawField(label, value) {
    newPageIfNeeded();
    drawText(`${label}:`, margin, y, { bold: true });
    drawText(value, margin + 140, y);
    y -= lineHeight;
  }

  drawText('FOREX Telegraphic Transfer Request', margin, y, { size: 16, bold: true, color: rgb(0.1, 0.2, 0.4) });
  y -= lineHeight + smallGap;
  drawField('Request ID', request.request_id);
  drawField('Status', request.status);
  drawField('Department', request.department_code);
  drawField('Division', request.division_code);

  const form = request.form_data || {};

  drawSection('Applicant / Originator');
  drawField('Name', form.applicant_name);
  drawField('Email', form.applicant_email);
  drawField('Department', form.applicant_department);
  drawField('Phone', form.applicant_phone);

  drawSection('Beneficiary Details');
  drawField('Name', form.beneficiary_name);
  drawField('Address', form.beneficiary_address);
  drawField('Bank', form.beneficiary_bank);
  drawField('SWIFT/BIC', form.beneficiary_swift);
  drawField('Account', form.beneficiary_account);
  drawField('Currency', form.payment_currency);
  drawField('Amount', form.payment_amount);

  drawSection('Payment Purpose');
  drawField('Purpose Code', form.purpose_code);
  drawField('Description', form.purpose_description);
  drawField('Invoice Reference', form.invoice_reference);

  drawSection('Charges');
  drawField('Charge Bearer', form.charge_bearer);
  drawField('Fee Amount', form.fee_amount);

  drawSection('Supporting Documents');
  for (const a of attachments) {
    drawField(a.category, a.file_name);
  }
  if (!attachments.length) {
    drawText('No supporting documents on file.', margin, y, { color: rgb(0.5, 0.5, 0.5) });
    y -= lineHeight;
  }

  drawSection('Approval');
  drawField('Submitted', request.created_at ? new Date(request.created_at).toLocaleString() : 'N/A');
  drawField('Last updated', request.updated_at ? new Date(request.updated_at).toLocaleString() : 'N/A');

  // Footer on every page
  const pages = pdfDoc.getPages();
  pages.forEach((p, idx) => {
    p.drawText(`Page ${idx + 1} of ${pages.length}`, {
      x: width - margin - 70,
      y: margin - 10,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
  });

  return pdfDoc.save();
}
