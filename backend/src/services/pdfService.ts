import PDFDocument from 'pdfkit';
import { Writable } from 'stream';
import { IInvoice } from '../models/Invoice';
import { IBankDetails } from '../models/BusinessSettings';
import { IAddress } from '../models/Customer';
import { getPlaceOfSupply, getSupplyType } from '../utils/gstState';
import { summarizeByHsn, splitGst } from './calculationService';
import type { SalesReport } from '../controllers/reportController';

export type InvoicePdfData = Pick<
  IInvoice,
  | 'invoiceNumber'
  | 'invoiceDate'
  | 'dueDate'
  | 'shopifyOrderNumber'
  | 'customer'
  | 'businessDetails'
  | 'items'
  | 'subtotal'
  | 'discount'
  | 'taxableAmount'
  | 'totalGST'
  | 'grandTotal'
  | 'roundOff'
  | 'amountInWords'
  | 'invoiceStatus'
  | 'notes'
>;

const LEFT = 36;
const WIDTH = 523; // A4 width 595 - 2 * 36 margin
const RIGHT = LEFT + WIDTH;
const PAD = 3;
const BORDER = '#cbd5e1';
const MUTED = '#475569';
const HEADER_BG = '#f1f5f9';

// Built-in PDF fonts have no ₹ glyph, so amounts use "Rs.".
const num = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const money = (n: number): string => `Rs. ${num(n)}`;

const fmtDate = (d?: Date | string): string => {
  if (!d) return '-';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const fmtAddress = (a?: IAddress): string =>
  a ? [a.street, a.city, a.state, a.pincode, a.country].filter(Boolean).join(', ') || '-' : '-';

interface Column {
  label: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

// Bordered table drawing with page breaks (header row repeated on each new page).
const tableHelpers = (doc: PDFKit.PDFDocument) => {
  const ensureSpace = (height: number): boolean => {
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      return true;
    }
    return false;
  };

  const drawRow = (columns: Column[], values: string[], opts: { bold?: boolean; fill?: string } = {}) => {
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    const height =
      Math.max(...values.map((v, i) => doc.heightOfString(v, { width: columns[i].width - PAD * 2 }))) + PAD * 2;
    const left = doc.page.margins.left;
    const y = doc.y;
    if (opts.fill) doc.rect(left, y, columns.reduce((s, c) => s + c.width, 0), height).fill(opts.fill);
    let x = left;
    columns.forEach((col, i) => {
      doc.rect(x, y, col.width, height).strokeColor(BORDER).lineWidth(0.5).stroke();
      doc
        .fillColor('#0f172a')
        .text(values[i], x + PAD, y + PAD, { width: col.width - PAD * 2, align: col.align || 'left' });
      x += col.width;
    });
    doc.x = left;
    doc.y = y + height;
  };

  const drawTable = (columns: Column[], rows: string[][]) => {
    const header = columns.map((c) => c.label);
    drawRow(columns, header, { bold: true, fill: HEADER_BG });
    for (const row of rows) {
      if (ensureSpace(24)) drawRow(columns, header, { bold: true, fill: HEADER_BG });
      drawRow(columns, row);
    }
  };

  return { ensureSpace, drawRow, drawTable };
};

/**
 * Renders a GST tax invoice to `out` (an HTTP response or file stream).
 * Layout: business header, invoice meta, bill/ship to, item table, HSN tax
 * summary with CGST/SGST/IGST split, totals, amount in words, bank details, signature.
 */
export const generateInvoicePdf = (invoice: InvoicePdfData, bank: IBankDetails | undefined, out: Writable): void => {
  const doc = new PDFDocument({
    size: 'A4',
    margin: LEFT,
    bufferPages: true, // needed to stamp the CANCELLED watermark on every page
    info: { Title: `Tax Invoice ${invoice.invoiceNumber}` },
  });
  doc.pipe(out);

  const business = invoice.businessDetails;
  const shipState = invoice.customer.shippingAddress?.state || invoice.customer.billingAddress?.state;
  const supplyType = getSupplyType(business.gstin, { gstin: invoice.customer.gstin, state: shipState });
  const placeOfSupply = getPlaceOfSupply({ gstin: invoice.customer.gstin, state: shipState });

  const { ensureSpace, drawTable } = tableHelpers(doc);

  // ---- Header -------------------------------------------------------------
  const top = doc.y;
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(15).text(business.name, LEFT, top, { width: 320 });
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
  doc.text(business.address, { width: 320 });
  doc.text(`GSTIN: ${business.gstin}`);
  doc.text([business.phone, business.email].filter(Boolean).join('  |  '));
  const leftBottom = doc.y;

  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(14).text('TAX INVOICE', 370, top, { width: RIGHT - 370, align: 'right' });
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
  const meta: Array<[string, string]> = [
    ['Invoice No', invoice.invoiceNumber],
    ['Invoice Date', fmtDate(invoice.invoiceDate)],
    ['Due Date', fmtDate(invoice.dueDate)],
  ];
  if (invoice.shopifyOrderNumber) meta.push(['Order No', invoice.shopifyOrderNumber]);
  if (placeOfSupply) meta.push(['Place of Supply', placeOfSupply]);
  meta.push(['Supply', supplyType === 'INTRA_STATE' ? 'Intra-state' : 'Inter-state']);
  for (const [label, value] of meta) {
    doc.text(`${label}: ${value}`, 370, doc.y, { width: RIGHT - 370, align: 'right' });
  }

  doc.y = Math.max(leftBottom, doc.y) + 8;
  doc.moveTo(LEFT, doc.y).lineTo(RIGHT, doc.y).strokeColor(BORDER).lineWidth(1).stroke();
  doc.y += 8;

  // ---- Bill to / Ship to ---------------------------------------------------
  const partyTop = doc.y;
  const half = WIDTH / 2 - 6;
  const c = invoice.customer;
  const writeParty = (title: string, x: number, lines: string[]) => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text(title, x, partyTop, { width: half });
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#0f172a').text(c.name, x, doc.y + 2, { width: half });
    doc.font('Helvetica').fontSize(8.5).fillColor('#1e293b');
    for (const line of lines.filter(Boolean)) doc.text(line, x, doc.y, { width: half });
    return doc.y;
  };
  const billBottom = writeParty('BILL TO', LEFT, [
    fmtAddress(c.billingAddress),
    c.gstin ? `GSTIN: ${c.gstin}` : '',
    [c.phone, c.email].filter(Boolean).join('  |  '),
  ]);
  const shipBottom = writeParty('SHIP TO', LEFT + WIDTH / 2 + 6, [fmtAddress(c.shippingAddress || c.billingAddress)]);
  doc.x = LEFT;
  doc.y = Math.max(billBottom, shipBottom) + 12;

  // ---- Items ---------------------------------------------------------------
  const itemCols: Column[] = [
    { label: '#', width: 20, align: 'center' },
    { label: 'Item', width: 120 },
    { label: 'HSN/SAC', width: 50 },
    { label: 'Qty', width: 30, align: 'right' },
    { label: 'Rate', width: 55, align: 'right' },
    { label: 'Discount', width: 45, align: 'right' },
    { label: 'Taxable', width: 60, align: 'right' },
    { label: 'GST %', width: 33, align: 'right' },
    { label: 'GST', width: 50, align: 'right' },
    { label: 'Total', width: 60, align: 'right' },
  ];
  drawTable(
    itemCols,
    invoice.items.map((item, i) => [
      String(i + 1),
      item.productName,
      item.hsnSac,
      String(item.quantity),
      num(item.unitPrice),
      num(item.discount),
      num(item.taxableAmount),
      `${item.gstRate}%`,
      num(item.gstAmount),
      num(item.totalAmount),
    ])
  );
  doc.y += 12;

  // ---- HSN tax summary -----------------------------------------------------
  ensureSpace(60);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text('TAX SUMMARY (HSN/SAC)', LEFT, doc.y);
  doc.y += 3;
  const taxCols: Column[] = [
    { label: 'HSN/SAC', width: 83 },
    { label: 'GST %', width: 60, align: 'right' },
    { label: 'Taxable Value', width: 95, align: 'right' },
    { label: 'CGST', width: 95, align: 'right' },
    { label: 'SGST', width: 95, align: 'right' },
    { label: 'IGST', width: 95, align: 'right' },
  ];
  drawTable(
    taxCols,
    summarizeByHsn(invoice.items, supplyType).map((r) => [
      r.hsnSac,
      `${r.gstRate}%`,
      num(r.taxableAmount),
      num(r.cgst),
      num(r.sgst),
      num(r.igst),
    ])
  );
  doc.y += 12;

  // ---- Totals --------------------------------------------------------------
  const split = splitGst(invoice.totalGST, supplyType);
  const totals: Array<[string, string]> = [
    ['Subtotal', money(invoice.subtotal)],
    ['Discount', `- ${money(invoice.discount)}`],
    ['Taxable Amount', money(invoice.taxableAmount)],
  ];
  if (supplyType === 'INTRA_STATE') {
    totals.push(['CGST', money(split.cgst)], ['SGST', money(split.sgst)]);
  } else {
    totals.push(['IGST', money(split.igst)]);
  }
  if (invoice.roundOff) totals.push(['Round Off', money(invoice.roundOff)]);

  ensureSpace(totals.length * 13 + 60);
  const labelX = 340;
  doc.font('Helvetica').fontSize(9);
  for (const [label, value] of totals) {
    const y = doc.y;
    doc.fillColor(MUTED).text(label, labelX, y, { width: 90 });
    doc.fillColor('#0f172a').text(value, labelX + 90, y, { width: RIGHT - labelX - 90, align: 'right' });
    doc.y = y + 13;
  }
  doc.moveTo(labelX, doc.y).lineTo(RIGHT, doc.y).strokeColor(BORDER).lineWidth(0.5).stroke();
  doc.y += 4;
  const gtY = doc.y;
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text('Grand Total', labelX, gtY, { width: 90 });
  doc.text(money(invoice.grandTotal), labelX + 90, gtY, { width: RIGHT - labelX - 90, align: 'right' });
  doc.x = LEFT;
  doc.y = gtY + 20;

  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text('AMOUNT IN WORDS', LEFT, doc.y);
  doc.font('Helvetica').fontSize(9).fillColor('#0f172a').text(invoice.amountInWords, LEFT, doc.y + 2, { width: WIDTH });
  doc.y += 12;

  if (invoice.notes) {
    ensureSpace(40);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text('NOTES', LEFT, doc.y);
    doc.font('Helvetica').fontSize(9).fillColor('#0f172a').text(invoice.notes, LEFT, doc.y + 2, { width: WIDTH });
    doc.y += 12;
  }

  // ---- Bank details & signature ------------------------------------------
  ensureSpace(90);
  const footTop = doc.y;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text('BANK DETAILS', LEFT, footTop);
  doc.font('Helvetica').fontSize(8.5).fillColor('#1e293b');
  const bankLines = [
    bank?.bankName && `Bank: ${bank.bankName}`,
    bank?.accountNumber && `A/c No: ${bank.accountNumber}`,
    bank?.ifscCode && `IFSC: ${bank.ifscCode}`,
    bank?.branch && `Branch: ${bank.branch}`,
  ].filter(Boolean) as string[];
  for (const line of bankLines.length ? bankLines : ['-']) doc.text(line, LEFT, doc.y, { width: 250 });

  doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text(`For ${business.name}`, 330, footTop, {
    width: RIGHT - 330,
    align: 'right',
  });
  doc.moveTo(400, footTop + 55).lineTo(RIGHT, footTop + 55).strokeColor(BORDER).lineWidth(0.5).stroke();
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('Authorised Signatory', 330, footTop + 59, {
    width: RIGHT - 330,
    align: 'right',
  });

  doc.y = Math.max(doc.y, footTop + 80);
  doc.font('Helvetica').fontSize(7.5).fillColor('#94a3b8').text('This is a computer-generated invoice.', LEFT, doc.y, {
    width: WIDTH,
    align: 'center',
  });

  if (invoice.invoiceStatus === 'CANCELLED') {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.save();
      doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
      doc.font('Helvetica-Bold').fontSize(80).fillColor('#e11d48').opacity(0.15);
      doc.text('CANCELLED', 0, doc.page.height / 2 - 40, { width: doc.page.width, align: 'center' });
      doc.restore();
    }
  }

  doc.end();
};

/**
 * Sales report statement (landscape A4): summary, HSN/SAC tax table and invoice register.
 */
export const generateSalesReportPdf = (
  report: SalesReport,
  summary: Array<{ label: string; value: string | number }>,
  businessName: string,
  out: Writable
): void => {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: LEFT, info: { Title: 'Sales Report' } });
  doc.pipe(out);
  const { ensureSpace, drawTable } = tableHelpers(doc);
  const width = doc.page.width - LEFT * 2;

  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(15).text(`${businessName} - Sales Report`, LEFT, doc.y);
  const f = report.filters;
  const filterText = [
    `Period: ${f.startDate || 'Beginning'} to ${f.endDate || 'Today'}`,
    f.customer && `Customer: ${f.customer}`,
    f.hsnSac && `HSN/SAC: ${f.hsnSac}`,
    f.paymentStatus.length && `Payment status: ${f.paymentStatus.join(', ')}`,
    f.source.length && `Source: ${f.source.join(', ')}`,
    `Invoice status: ${f.invoiceStatus.join(', ')}`,
  ].filter(Boolean);
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
  doc.text(filterText.join('  |  '), { width });
  doc.text(`Generated: ${fmtDate(report.generatedAt)}`, { width });
  doc.y += 10;

  // Summary as a 4-column metric grid.
  const metricCols: Column[] = [
    { label: 'Metric', width: width / 4 },
    { label: 'Value', width: width / 4, align: 'right' },
    { label: 'Metric', width: width / 4 },
    { label: 'Value', width: width / 4, align: 'right' },
  ];
  const fmtValue = (v: string | number) => (typeof v === 'number' ? money(v) : v);
  const metricRows: string[][] = [];
  for (let i = 0; i < summary.length; i += 2) {
    const a = summary[i];
    const b = summary[i + 1];
    metricRows.push([a.label, fmtValue(a.value), b?.label || '', b ? fmtValue(b.value) : '']);
  }
  drawTable(metricCols, metricRows);
  doc.y += 14;

  ensureSpace(60);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('HSN/SAC SUMMARY', LEFT, doc.y);
  doc.y += 3;
  drawTable(
    [
      { label: 'HSN/SAC', width: 110 },
      { label: 'GST %', width: 70, align: 'right' },
      { label: 'Qty', width: 70, align: 'right' },
      { label: 'Taxable Value', width: 110, align: 'right' },
      { label: 'CGST', width: 100, align: 'right' },
      { label: 'SGST', width: 100, align: 'right' },
      { label: 'IGST', width: 100, align: 'right' },
      { label: 'Total GST', width: width - 660, align: 'right' },
    ],
    report.hsnSummary.length
      ? report.hsnSummary.map((r) => [
          r.hsnSac,
          `${r.gstRate}%`,
          String(r.quantity),
          num(r.taxableAmount),
          num(r.cgst),
          num(r.sgst),
          num(r.igst),
          num(r.gstAmount),
        ])
      : [['No data', '', '', '', '', '', '', '']]
  );
  doc.y += 14;

  ensureSpace(60);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('INVOICE REGISTER', LEFT, doc.y);
  doc.y += 3;
  drawTable(
    [
      { label: 'Invoice No', width: 95 },
      { label: 'Date', width: 55 },
      { label: 'Customer', width: 120 },
      { label: 'GSTIN', width: 90 },
      { label: 'Taxable', width: 65, align: 'right' },
      { label: 'CGST', width: 55, align: 'right' },
      { label: 'SGST', width: 55, align: 'right' },
      { label: 'IGST', width: 55, align: 'right' },
      { label: 'Total GST', width: 60, align: 'right' },
      { label: 'Grand Total', width: 65, align: 'right' },
      { label: 'Status', width: width - 715 },
    ],
    report.items.length
      ? report.items.map((r) => [
          r.invoiceNumber,
          fmtDate(r.invoiceDate),
          r.customerName,
          r.customerGstin || '-',
          num(r.taxableAmount),
          num(r.cgst),
          num(r.sgst),
          num(r.igst),
          num(r.totalGST),
          num(r.grandTotal),
          r.paymentStatus,
        ])
      : [['No invoices match the filters', '', '', '', '', '', '', '', '', '', '']]
  );

  if (report.itemsTruncated) {
    doc.y += 6;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
      `Showing the latest ${report.items.length} of ${report.itemsTotal} invoices. Use the Excel export for the full register.`,
      LEFT,
      doc.y,
      { width }
    );
  }

  doc.end();
};
