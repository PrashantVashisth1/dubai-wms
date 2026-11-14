import { PdfWriter, type FontKey, type ImageHandle, type Rgb } from '../pdf/pdfWriter';
import {
  computeShipping, formatCbm, formatCurrencyValue, formatDateShort, formatDateSlash, formatMoney, formatPlain2, formatQuantity,
  type ShippingInvoiceInput, type ShippingPaymentMethod, type TransactionType,
} from '../../shipping/shippingInvoice';

/**
 * 3-page Shipping Invoice PDF:
 *   1. DELIVERY ADVICE (A4 portrait, Arial/Helvetica)
 *   2. INVOICE / PACKING LIST (A4 landscape, Calibri/Carlito) - overflows onto extra pages
 *   3. DETAILED COMMODITY CLASSIFICATION FORM (A4 portrait, Calibri/Carlito) - overflows onto extra pages
 *
 * All coordinates are the template geometry measured from the reference
 * layout. Only static labels are literal strings here; every value comes from
 * the invoice document or is calculated by computeShipping().
 */

export type ShippingBranding = { logo?: Buffer | null; headerText?: string | null };

const A4_W = 595.28;
const A4_H = 841.89;
const BLACK: Rgb = [0, 0, 0];
const GREY: Rgb = [0.749, 0.749, 0.749];
const CHECK_STROKE: Rgb = [0.255, 0.443, 0.612];
const CHECK_FILL: Rgb = [0.357, 0.608, 0.835];
const H: FontKey = 'helvetica';
const HB: FontKey = 'helvetica-bold';
const C: FontKey = 'calibri';
const CB: FontKey = 'calibri-bold';

type Ctx = { pdf: PdfWriter; doc: ShippingInvoiceInput; calc: ReturnType<typeof computeShipping>; logo?: ImageHandle };

/** Largest size <= `size` (down to `min`) at which `text` wraps into at most `maxLines` lines of `width`. */
function fitLines(pdf: PdfWriter, text: string, font: FontKey, size: number, width: number, maxLines: number, min = 4) {
  let current = size;
  let lines = pdf.wrap(text, font, current, width);
  while (lines.length > maxLines && current > min) {
    current = Math.max(min, current - 0.25);
    lines = pdf.wrap(text, font, current, width);
  }
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    let last = lines[maxLines - 1];
    while (last && pdf.measure(`${last}…`, font, current) > width) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  return { lines, size: current };
}

/** Greedy line breaking at a separator (kept at the end of each broken line). */
function splitAtSeparator(pdf: PdfWriter, text: string, separator: string, font: FontKey, size: number, width: number) {
  const parts = text.split(separator);
  const lines: string[] = [];
  let line = '';
  parts.forEach((part, index) => {
    const token = index < parts.length - 1 ? `${part}${separator}` : part;
    if (line && pdf.measure(line + token, font, size) > width) { lines.push(line); line = token; } else line += token;
  });
  if (line) lines.push(line);
  return lines.flatMap(item => (pdf.measure(item, font, size) > width ? pdf.wrap(item, font, size, width) : [item]));
}

/** Single-line text shrunk to fit `width`. */
function fitSize(pdf: PdfWriter, text: string, font: FontKey, size: number, width: number, min = 4) {
  let current = size;
  while (pdf.measure(text, font, current) > width && current > min) current -= 0.25;
  return current;
}

/** Lines centred horizontally on `cx`, vertically balanced around the single-line baseline. */
function centeredAround(pdf: PdfWriter, text: string, cx: number, width: number, baseline: number, font: FontKey, size: number, maxLines: number, gapRatio = 1.2) {
  const fit = fitLines(pdf, text, font, size, width, maxLines);
  const gap = fit.size * gapRatio;
  const first = baseline + ((fit.lines.length - 1) * gap) / 2;
  fit.lines.forEach((line, index) => pdf.text(cx - pdf.measure(line, font, fit.size) / 2, first - index * gap, line, font, fit.size));
}

/* =========================================================================
 * Page 1 - DELIVERY ADVICE
 * ====================================================================== */

const PAYMENT_BOXES: Record<ShippingPaymentMethod, { x: number; y: number; label: string; labelX: number; labelY: number; boxed: boolean }> = {
  'CDR Cash': { x: 51.52, y: 470.23, label: '        CDR Cash', labelX: 52.22, labelY: 472.25, boxed: true },
  'CDR Bank': { x: 154.98, y: 470.23, label: '         CDR Bank', labelX: 153.89, labelY: 472.25, boxed: true },
  Deposit: { x: 241.72, y: 470.23, label: '         Deposit', labelX: 242.47, labelY: 472.25, boxed: false },
  'Credit A/C': { x: 51.52, y: 451.75, label: '        Credit A/C', labelX: 52.22, labelY: 453.77, boxed: true },
  'Stan G': { x: 154.98, y: 451.75, label: '         Stan G', labelX: 153.89, labelY: 453.77, boxed: true },
  'Bank G': { x: 241.72, y: 451.75, label: '         Bank G', labelX: 242.47, labelY: 453.77, boxed: true },
  FTT: { x: 51.52, y: 433.27, label: '        FTT', labelX: 52.22, labelY: 435.29, boxed: true },
  Others: { x: 154.98, y: 433.27, label: '         Others', labelX: 153.89, labelY: 435.29, boxed: true },
};

const TRANSACTION_BOXES: Record<TransactionType, { x: number; y: number; w: number; h: number; label: string; labelX: number; labelY: number }> = {
  Import: { x: 51.52, y: 304.03, w: 8.1, h: 8.37, label: '         Import', labelX: 52.22, labelY: 306.02 },
  'Import for Re-Export': { x: 154.98, y: 304.03, w: 8.1, h: 8.37, label: '         Import for Re-Export', labelX: 153.89, labelY: 306.02 },
  'Temporary Exit': { x: 51.52, y: 285.55, w: 8.1, h: 8.37, label: '         Temporary Exit', labelX: 52.22, labelY: 287.54 },
  'Free Zone Internal Transfer': { x: 154.98, y: 286.06, w: 6.54, h: 8.98, label: '        Free Zone Internal Transfer', labelX: 153.89, labelY: 287.54 },
  Export: { x: 54.47, y: 267.07, w: 8.1, h: 8.37, label: '          Export', labelX: 52.22, labelY: 269.06 },
  'Free Zone B/E': { x: 154.98, y: 267.07, w: 8.1, h: 8.37, label: '        Free Zone B/E', labelX: 153.89, labelY: 269.06 },
};

function checkbox(pdf: PdfWriter, x: number, y: number, w: number, h: number, selected: boolean) {
  if (selected) pdf.fillRect(x, y, w, h, CHECK_FILL);
  pdf.strokeRect(x, y, w, h, 0.72, CHECK_STROKE);
}

function page1({ pdf, doc, calc, logo }: Ctx, headerText: string) {
  const B = 0.72;
  pdf.addPage(A4_W, A4_H);
  if (logo) pdf.drawImageFit(logo, 56.19, 722.52, 82.52, 55.82);
  if (headerText) {
    const fit = fitLines(pdf, headerText, H, 6.48, 230, 3);
    fit.lines.forEach((line, index) => pdf.text(52.34, 714.82 - index * fit.size * 1.15, line, H, fit.size));
  }
  pdf.text(251.71, 694.06, 'DELIVERY ADVICE', HB, 10.08);
  pdf.text(52.22, 682.66, 'Date:', HB, 5.76);
  pdf.text(122.21, 682.66, formatDateSlash(doc.date), HB, 5.76);
  pdf.hline(107.66, 196.36, 679.42, B);
  pdf.text(309.43, 682.66, 'D.A. No.:', HB, 5.76);
  pdf.text(336.43, 682.66, doc.invoiceRefNo, H, fitSize(pdf, doc.invoiceRefNo, H, 7.2, 204));
  pdf.hline(334.87, 542.76, 679.42, B);

  // Importer / agent / rep card table
  pdf.hline(282.43, 543, 670.15, B);
  pdf.hline(282.43, 543, 660.91, B);
  pdf.hline(282.43, 543, 633.19, B);
  pdf.vline(281.71, 633.19, 670.87, B);
  for (const x of [334.51, 395.26, 542.28]) pdf.vline(x, 633.19, 670.15, B);
  pdf.text(289.75, 663.67, 'Importer code', HB, 5.76);
  pdf.text(350.47, 663.67, 'agent code', HB, 5.76);
  pdf.text(452.14, 663.67, 'Rep Card No', HB, 5.76);
  const codeCell = (value: string | undefined, x1: number, x2: number) => {
    if (!value) return;
    const fit = fitLines(pdf, value, H, 7.2, x2 - x1 - 3, 3);
    const gap = fit.size * 1.15;
    const first = 645.31 + ((fit.lines.length - 1) * gap) / 2;
    fit.lines.forEach((line, index) => pdf.text(x1 + 1.92, first - index * gap, line, H, fit.size));
  };
  codeCell(doc.importerCode, 281.71, 334.51);
  codeCell(doc.agentCode, 334.51, 395.26);
  codeCell(doc.repCardNo, 395.26, 542.28);

  // Release instruction + consignee
  pdf.text(85.22, 618.31, 'Please authorize release of the below mentioned goods from our warehouse to', HB, 5.76);
  const shipTo = doc.shipTo;
  const consignee = `${[shipTo.companyName, (shipTo.addressLines || []).filter(Boolean).join(', '), shipTo.country].filter(Boolean).join(',')}, Contact Person: ${shipTo.contactPerson || ''},`;
  {
    const fit = fitLines(pdf, consignee, HB, 5.76, 204, 3);
    fit.lines.forEach((line, index) => pdf.text(439.35 - pdf.measure(line, HB, fit.size) / 2, 618.31 - index * 7.56 * (fit.size / 5.76), line, HB, fit.size));
  }

  // Goods table
  pdf.hline(51.26, 543, 598.87, B);
  pdf.hline(51.26, 543, 580.39, B);
  for (const x of [152.21, 195.89, 240.77, 281.71]) pdf.vline(x, 497.21, 598.87, B);
  pdf.vline(334.51, 432.53, 598.87, B);
  pdf.vline(50.54, 122.52, 599.59, B);
  pdf.vline(542.28, 122.52, 598.87, B);
  pdf.text(52.22, 588.31, '  Marks & Numbers', HB, 5.76);
  pdf.text(168.05, 588.31, 'Type', HB, 5.76);
  pdf.text(207.53, 588.31, 'Quantity', HB, 5.76);
  pdf.text(252.55, 588.31, 'Weight', HB, 5.76);
  pdf.text(283.39, 592.03, '  Volume/', HB, 5.76);
  pdf.text(283.39, 584.47, 'Cbm', HB, 5.76);
  pdf.text(405.34, 588.31, '      Description of Goods', HB, 5.76);
  if (doc.marksAndNumbers) {
    const fit = fitLines(pdf, doc.marksAndNumbers, HB, 5.76, 97, 9);
    fit.lines.forEach((line, index) => pdf.text(52.22, 564.67 - index * fit.size * 1.2, line, HB, fit.size));
  }
  const goodsCell = (value: string, cx: number, width: number) => {
    const fit = fitLines(pdf, value, HB, 7.2, width, 6);
    fit.lines.forEach((line, index) => pdf.text(cx - pdf.measure(line, HB, fit.size) / 2, 555.43 - index * fit.size * 1.2, line, HB, fit.size));
  };
  goodsCell(doc.cargoType, 174.89, 41);
  goodsCell(`${formatQuantity(calc.totals.packages)} ${doc.packageType} `, 219.26, 42);
  goodsCell(`${formatQuantity(calc.totals.weightKg)} KGS`, 262.16, 38);
  goodsCell(formatCbm(calc.totals.cbm, 4), 309.0, 50);
  pdf.text(336.43, 555.43, 'As per attached Invoice -', HB, 7.2);
  {
    const fit = fitLines(pdf, doc.goodsDescription, HB, 7.2, 200, 5);
    fit.lines.forEach((line, index) => pdf.text(439.3 - pdf.measure(line, HB, fit.size) / 2, 546.19 - index * fit.size * 1.2, line, HB, fit.size));
  }

  // Payment method + HS code
  pdf.hline(51.26, 335.23, 497.21, B);
  pdf.hline(395.98, 543, 497.21, B);
  pdf.hline(51.26, 335.23, 487.97, B);
  for (const y of [487.97, 478.73, 469.49, 460.25]) pdf.hline(395.98, 543, y, B);
  pdf.vline(395.26, 460.25, 497.93, B);
  pdf.text(52.22, 490.73, 'Payment Method', HB, 5.76);
  pdf.text(242.47, 490.73, 'Mark where appropriate', HB, 5.76);
  pdf.text(336.43, 490.73, 'HS CODE : ', HB, 7.2);
  if (doc.hsCodeLabel) {
    const fit = fitLines(pdf, doc.hsCodeLabel, H, 7.2, 143, 4);
    fit.lines.forEach((line, index) => pdf.text(469.63 - pdf.measure(line, H, fit.size) / 2, 490.37 - index * 9.24, line, H, fit.size));
  }
  for (const [method, box] of Object.entries(PAYMENT_BOXES) as Array<[ShippingPaymentMethod, (typeof PAYMENT_BOXES)[ShippingPaymentMethod]]>) {
    const selected = doc.paymentMethod === method;
    if (box.boxed || selected) checkbox(pdf, box.x, box.y, 8.1, 8.37, selected);
    pdf.text(box.labelX, box.labelY, box.label, HB, 5.76);
  }

  // Ref A/C + route
  pdf.hline(51.26, 543, 432.53, B);
  pdf.hline(51.26, 543, 423.41, B);
  pdf.vline(152.21, 423.41, 432.53, B);
  pdf.text(52.22, 426.17, 'Ref: A/C No.', HB, 5.76);
  if (doc.refAcNo) centeredAround(pdf, doc.refAcNo, 192.9, 278, 408.29, HB, 7.2, 3);
  pdf.hline(51.26, 543, 395.69, B);
  pdf.vline(334.51, 395.69, 423.41, B);
  pdf.vline(395.26, 395.69, 423.41, B);
  centeredAround(pdf, doc.fromLocation, 365.67, 57, 408.29, HB, 7.2, 3);
  centeredAround(pdf, doc.toCountry, 469.46, 143, 407.09, HB, 7.2, 3);

  // B/E refs + carrier's agent
  pdf.text(52.22, 390.05, 'B/E Ref Nos.  ', HB, 5.76);
  pdf.fillRect(52.22, 388.85, 37.68, 0.6, BLACK);
  if (calc.beRefNos) {
    // Refs contain no spaces: break lines at the "/" separators instead.
    let size = 7.2;
    let lines = splitAtSeparator(pdf, calc.beRefNos, '/', HB, size, 226);
    while (lines.length > 5 && size > 4) { size -= 0.25; lines = splitAtSeparator(pdf, calc.beRefNos, '/', HB, size, 226); }
    const gap = size * 1.2;
    const firstLine = 361.37 + ((Math.min(lines.length, 5) - 1) * gap) / 2;
    lines.slice(0, 5).forEach((line, index) => pdf.text(167.44 - pdf.measure(line, HB, size) / 2, firstLine - index * gap, line, HB, size));
  }
  for (const y of [386.45, 367.97, 349.49]) pdf.hline(282.43, 543, y, B);
  pdf.text(392.14, 389.21, "Carrier's Agent", HB, 5.76);
  if (doc.carrierAgent) {
    const fit = fitLines(pdf, doc.carrierAgent, HB, 7.2, 254, 2);
    const rows = fit.lines.length === 1 ? [374.6] : [374.6, 356.1];
    fit.lines.forEach((line, index) => pdf.text(412.35 - pdf.measure(line, HB, fit.size) / 2, rows[index], line, HB, fit.size));
  }

  // Country of origin / value
  pdf.hline(51.26, 543, 340.25, B);
  pdf.text(314.83, 343.01, 'Country of Origin ', HB, 5.76);
  pdf.text(461.14, 343.01, 'Value ', HB, 5.76);
  centeredAround(pdf, calc.countryOfOrigin, 339.23, 110, 324.62, HB, 7.2, 3);
  centeredAround(pdf, formatCurrencyValue(doc.currency, calc.totals.value), 469.76, 143, 324.62, HB, 7.2, 2);
  pdf.vline(395.26, 312.5, 349.48, B);
  pdf.hline(282.43, 543, 312.5, B);

  // Transaction type
  pdf.hline(51.26, 282.43, 330.98, B);
  pdf.hline(51.26, 282.43, 321.74, B);
  pdf.text(153.89, 333.77, 'Mark where appropriate', HB, 5.76);
  for (const [type, box] of Object.entries(TRANSACTION_BOXES) as Array<[TransactionType, (typeof TRANSACTION_BOXES)[TransactionType]]>) {
    checkbox(pdf, box.x, box.y, box.w, box.h, doc.transactionType === type);
    pdf.text(box.labelX, box.labelY, box.label, HB, 5.76);
  }

  // Declarations
  pdf.text(283.39, 306.02, 'I/We declare the details given herein to be true & complete.', HB, 5.76);
  pdf.text(283.39, 225.62, 'Licensee/Agent Stamp & Signature.', HB, 5.76);
  pdf.hline(51.26, 543, 222.86, B);
  pdf.text(52.22, 216.38, 'For Customs Use.', HB, 5.76);
  pdf.text(283.39, 216.38, 'I/We declare the details given herein to be true & complete.', HB, 5.76);
  pdf.text(283.39, 125.28, "Importer's Stamp & Signature.", HB, 5.76);
  pdf.vline(281.71, 122.52, 395.69, B);
  pdf.hline(51.26, 543, 122.52, B);
}

/* =========================================================================
 * Page 2 - INVOICE / PACKING LIST (landscape)
 * ====================================================================== */

const P2_W = A4_H;
const P2_H = A4_W;
const P2_COLS = [9.26, 40.1, 153.26, 376.87, 403.87, 487.27, 542.5, 619.3, 664.66, 708.96, 735.12, 824.28];
const P2_BOTTOM = 22;
const ROW_FIRST = 15;
const ROW = 15.36;
const P2_LINE_GAP = 9.36;

function page2Top(ctx: Ctx) {
  const { pdf, logo } = ctx;
  pdf.addPage(P2_W, P2_H);
  if (logo) pdf.drawImageFit(logo, 23.31, 513.53, 79.11, 52.44);
  pdf.text(363.31, 526.18, 'INVOICE / PACKING LIST', CB, 10.92);
}

function itemsHeader(ctx: Ctx, top: number) {
  const { pdf, doc } = ctx;
  const bottom = top - 31.2;
  pdf.fillRect(9.98, bottom + 0.6, 815.14, 31.32, GREY);
  pdf.hline(10.7, 825.72, top, 1.44);
  pdf.hline(10.7, 825.72, bottom, 1.44);
  for (const x of P2_COLS) pdf.vline(x, bottom, top, 1.44);
  const single = bottom + 12.48;
  pdf.text(13.34, single, 'S/NO', CB, 10.92);
  pdf.text(86.06, single, 'ITEM', CB, 10.92);
  pdf.text(235.61, single, 'DESCRIPTION', CB, 10.92);
  pdf.text(382.03, single, 'QTY', CB, 10.92);
  pdf.text(422.59, single, 'SERIAL NO', CB, 10.92);
  pdf.text(490.39, single, 'UNIT PRICE', CB, 10.92);
  pdf.text(552.94, bottom + 19.44, 'TOTAL PRICE ', CB, 10.92);
  pdf.textIn(P2_COLS[6] + 1.44, P2_COLS[7], bottom + 5.4, `(${doc.currency})`, CB, fitSize(pdf, `(${doc.currency})`, CB, 10.92, 74), 'center');
  pdf.text(623.02, single, 'HS CODE', CB, 10.92);
  pdf.text(675.7, bottom + 19.44, 'ECCN ', CB, 10.92);
  pdf.text(674.02, bottom + 5.4, 'Codes', CB, 10.92);
  pdf.text(712.68, single, 'COO', CB, 10.92);
  pdf.text(748.8, single, 'INBOUND REF', CB, 10.92);
  return bottom;
}

function page2(ctx: Ctx) {
  const { pdf, doc, calc } = ctx;
  page2Top(ctx);

  // Shipper / Ship To box (grows when addresses need more than six lines)
  const wrapAll = (lines: string[], width: number) => lines.flatMap(line => pdf.wrap(line, C, 9.36, width));
  const shipperLines = wrapAll([doc.shipper.companyName, ...(doc.shipper.addressLines || []), `NAME:${doc.shipper.contactName || ''}`, `MOBILE: ${doc.shipper.mobile || ''}`], 139);
  const shipToLines = wrapAll([
    doc.shipTo.companyName, ...(doc.shipTo.addressLines || []), ...(doc.shipTo.country ? [doc.shipTo.country] : []),
    ` Contact Person: ${doc.shipTo.contactPerson || ''}`, ` Mobile no: ${doc.shipTo.mobile || ''}`, `Email id : ${doc.shipTo.email || ''}`,
  ], 219);
  const boxLines = Math.max(6, shipperLines.length, shipToLines.length);
  const grow = (boxLines - 6) * 11.88;
  const shipperY = [481.9, 469.99, 458.11, 446.23, 434.59, 422.71];
  const shipToY = [482.26, 469.87, 458.83, 446.23, 434.59, 422.71];
  pdf.fillRect(9.98, 490.9, 367.73, 14.4, GREY);
  pdf.hline(10.7, 378.31, 504.58, 1.44);
  pdf.hline(10.7, 378.31, 490.3, 1.44);
  pdf.text(11.9, 495.22, 'SHIPPER', CB, 10.92);
  pdf.text(155.9, 495.22, 'SHIP TO', CB, 10.92);
  shipperLines.forEach((line, index) => pdf.text(11.66, shipperY[index] ?? 422.71 - (index - 5) * 11.88, line, C, 9.36));
  shipToLines.forEach((line, index) => pdf.text(155.66, shipToY[index] ?? 422.71 - (index - 5) * 11.88, line, C, 9.36));

  // Reference block
  pdf.text(406.51, 495.22, 'Invoice / Ref No.', CB, 10.92);
  pdf.text(489.67, 495.46, doc.invoiceRefNo, C, fitSize(pdf, doc.invoiceRefNo, C, 9.36, 335));
  pdf.text(406.27, 482.26, 'Date', CB, 9.36);
  pdf.text(489.67, 481.9, formatDateShort(doc.date), C, 9.36);
  pdf.text(406.27, 469.99, 'Order Number', CB, 9.36);
  if (doc.orderNumber) pdf.text(489.67, 469.99, doc.orderNumber, C, fitSize(pdf, doc.orderNumber, C, 9.36, 335));

  let headerTop = 418.99 - grow;
  let pageTop = 506.01; // left frame line starts at the top of the shipper box on the first page
  const drawFrameSegment = (to: number) => {
    pdf.vline(9.26, to, pageTop, 1.44);
    pdf.vline(824.28, to, headerTop, 1.44);
  };
  // The shipper box sides belong to the first page frame.
  pdf.vline(153.26, headerTop, 504.57, 1.44);
  pdf.vline(376.87, headerTop, 504.57, 1.44);
  let y = itemsHeader(ctx, headerTop);

  const rowCells = (line: (typeof calc.lines)[number], index: number) => [
    String(index + 1), line.itemCode, ` ${line.description}`, formatQuantity(line.qty), line.serialNo || 'N/A', formatMoney(line.unitPrice),
    formatMoney(line.lineTotal), line.hsCode, line.eccn || 'N/A', line.coo, line.inboundRef,
  ];
  const lastIndex = calc.lines.length - 1;
  let first = true;
  for (let index = 0; index < calc.lines.length; index += 1) {
    const cells = rowCells(calc.lines[index], index).map((value, col) => pdf.wrap(value, C, 7.8, P2_COLS[col + 1] - P2_COLS[col] - 4));
    const lineCount = Math.max(...cells.map(lines => lines.length));
    const height = (first ? ROW_FIRST : ROW) + (lineCount - 1) * P2_LINE_GAP;
    const reserve = index === lastIndex ? 67.11 : 0; // grand total + totals block stay with the last row
    if (y - height - reserve < P2_BOTTOM) {
      drawFrameSegment(y);
      page2Top(ctx);
      headerTop = 505;
      pageTop = headerTop;
      y = itemsHeader(ctx, headerTop);
      first = true;
    }
    const bottom = y - ((first ? ROW_FIRST : ROW) + (lineCount - 1) * P2_LINE_GAP);
    const textBase = bottom + 5.28 + ((lineCount - 1) * P2_LINE_GAP);
    cells.forEach((lines, col) => lines.forEach((line, lineIndex) => {
      const offset = ((lineCount - lines.length) * P2_LINE_GAP) / 2;
      pdf.textIn(P2_COLS[col] + 1.44, P2_COLS[col + 1], textBase - offset - lineIndex * P2_LINE_GAP, line, C, 7.8, 'center');
    }));
    const isLast = index === lastIndex;
    if (!isLast) pdf.hline(10.7, 824.28, bottom, 0.72);
    for (const x of P2_COLS.slice(1, -1)) pdf.vline(x + 0.36, isLast ? bottom - 0.38 : bottom, y, 0.72);
    y = isLast ? bottom - 0.38 : bottom;
    first = false;
  }

  // Grand total row
  const gtTop = y;
  const gtBottom = gtTop - 21.39;
  pdf.hline(10.7, 825.72, gtTop, 1.44);
  pdf.hline(10.7, 825.72, gtBottom, 1.44);
  for (const x of [153.62, 377.23, 404.23, 487.63, 542.86, 619.66, 665.02, 709.32, 735.48]) pdf.vline(x, gtBottom + 1.44, gtTop - 0.01, 0.72);
  drawFrameSegment(gtBottom);
  pdf.text(11.66, gtBottom + 8.28, 'GRAND TOTAL :', CB, 9.36);
  pdf.textIn(P2_COLS[3] + 1.44, P2_COLS[4], gtBottom + 8.28, formatQuantity(calc.totals.qty), CB, 9.36, 'center');
  const grand = formatCurrencyValue(doc.currency, calc.totals.value);
  pdf.textIn(P2_COLS[6] + 1.44, P2_COLS[7], gtBottom + 8.28, grand, CB, fitSize(pdf, grand, CB, 9.36, 74), 'center');

  // Totals block
  const rows = [gtBottom - 15, gtBottom - 15 - ROW, gtBottom - 15 - 2 * ROW];
  for (const rowBottom of rows) pdf.hline(10.34, 825.36, rowBottom, 0.72);
  pdf.vline(9.62, rows[2], gtBottom, 0.72);
  pdf.vline(735.48, rows[2], gtBottom, 0.72);
  pdf.vline(824.64, rows[2], gtBottom, 0.72);
  const labels = [`TOTAL VALUE (${doc.currency})`, 'TOTAL WEIGHT', 'TOTAL PKG'];
  const values = [grand, ` ${formatQuantity(calc.totals.weightKg)} KGS `, `${formatQuantity(calc.totals.packages)} ${doc.packageType} `];
  const valueBase = [5.4 - 0.48, 5.4 - 0.48, 5.4 - 1.92];
  labels.forEach((label, index) => {
    pdf.textIn(9.62, 735.48, rows[index] + 5.4, label, CB, 9.36, 'center');
    const value = values[index];
    const size = fitSize(pdf, value, CB, 9.36, 86);
    pdf.text(822.9 - pdf.measure(value, CB, size), rows[index] + valueBase[index], value, CB, size);
  });

  // Dimension table
  let dimTop = rows[2] - 12.6;
  const dimHeader = (top: number) => {
    pdf.text(406.27, top - 9.36, 'Dimension (cm):', CB, 9.36);
    pdf.hline(488.71, 825.72, top, 1.44);
    pdf.hline(488.71, 824.28, top - 13.92, 0.72);
    pdf.vline(487.27, top - 13.92, top + 1.44, 1.44);
    pdf.vline(824.28, top - 13.92, top, 1.44);
    const base = top - 9.36;
    pdf.text(500.59, base, 'Length', CB, 10.92);
    pdf.text(568.06, base, 'Width', CB, 10.92);
    pdf.text(628.18, base, 'Height', CB, 10.92);
    pdf.text(679.78, base, 'Qty', CB, 10.92);
    pdf.text(712.44, base, 'CBM', CB, 10.92);
    pdf.text(765.96, base, 'T.CBM', CB, 10.92);
    return top - 13.92;
  };
  const DIM_COLS = [487.27, 542.5, 619.3, 664.66, 708.96, 735.12, 824.28];
  const dimCenter = (col: number) => (DIM_COLS[col] + 1.44 + DIM_COLS[col + 1]) / 2 + 0.3;
  const DIM_ROW = 11.88;
  if (dimTop - 13.92 - DIM_ROW - 20 < P2_BOTTOM) { page2Top(ctx); dimTop = 505; }
  let dy = dimHeader(dimTop);
  let segmentTop = dimTop;
  const closeSegment = (bottom: number) => {
    for (const x of [542.86, 619.66, 665.02, 709.32, 735.48]) pdf.vline(x, bottom, segmentTop, 0.72);
    pdf.vline(487.63, bottom, segmentTop - 13.92, 0.72);
    pdf.vline(824.64, bottom, segmentTop - 13.92, 0.72);
  };
  calc.packages.forEach((pkg, index) => {
    const isLast = index === calc.packages.length - 1;
    if (dy - DIM_ROW - (isLast ? 18 : 0) < P2_BOTTOM) {
      closeSegment(dy);
      page2Top(ctx);
      segmentTop = 505;
      dy = dimHeader(505);
    }
    const bottom = dy - DIM_ROW;
    pdf.hline(488.35, 825.36, bottom, 0.72);
    const values = [formatQuantity(pkg.lengthCm), formatQuantity(pkg.widthCm), formatQuantity(pkg.heightCm), formatQuantity(pkg.qty), formatCbm(pkg.rowCbm, 2), formatCbm(pkg.rowTotalCbm, 2)];
    values.forEach((value, col) => {
      const yy = col >= 4 ? bottom + 3.12 : bottom + 3.48;
      pdf.text(dimCenter(col) - pdf.measure(value, C, 9.36) / 2, yy, value, C, 9.36);
    });
    dy = bottom;
  });
  closeSegment(dy);
  const totalPk = formatQuantity(calc.totals.packages);
  const totalCbm = formatCbm(calc.totals.cbm, 2);
  pdf.text(dimCenter(3) - pdf.measure(totalPk, CB, 9.36) / 2, dy - 7.92, totalPk, CB, 9.36);
  pdf.text(dimCenter(5) - pdf.measure(totalCbm, CB, 9.36) / 2, dy - 7.92, totalCbm, CB, 9.36);
  for (const yy of [dy - 11.52, dy - 13.08]) {
    pdf.hline(665.38, 709.8, yy, 0.72);
    pdf.hline(735.84, 825.12, yy, 0.72);
  }
}

/* =========================================================================
 * Page 3 - DETAILED COMMODITY CLASSIFICATION FORM
 * ====================================================================== */

const P3_COLS = [50.3, 84.98, 141.53, 315.43, 362.83, 400.9, 445.9, 521.16];
const P3_ROW_FIRST = 19.44;
const P3_ROW = 19.8;
const P3_GAP = 8.4;
const P3_BOTTOM = 40;

function page3Header(ctx: Ctx) {
  const { pdf, doc, logo } = ctx;
  pdf.addPage(A4_W, A4_H);
  if (logo) pdf.drawImageFit(logo, 65.09, 745.88, 54.79, 34.89);
  pdf.text(52.46, 728.26, 'DETAILED COMMODITY CLASSIFICATION  FORM', CB, 8.04);
  pdf.text(52.46, 718.06, 'FOR STATISTICAL USE', CB, 8.04);
  pdf.text(415.18, 718.06, 'DATE', CB, 8.04);
  const date = formatDateShort(doc.date);
  pdf.text(520.13 - pdf.measure(date, CB, 8.04), 718.06, date, CB, 8.04);
  pdf.text(52.46, 697.66, 'PORT, Customs & Free Zone Corporation', CB, 8.04);
  // Table header
  pdf.hline(51.62, 522.48, 683.74, 1.32);
  pdf.hline(51.62, 522.48, 649.99, 1.32);
  pdf.text(58.94, 664.63, 'SL No', CB, 8.04);
  pdf.text(90.14, 669.91, 'HARMONISED ', CB, 8.04);
  pdf.text(87.14, 659.47, 'PRODUCT CODE', CB, 8.04);
  pdf.text(206.45, 664.63, 'DESCRIPTION', CB, 8.04);
  pdf.text(317.71, 669.91, 'COUNTRY OF ', CB, 8.04);
  pdf.text(327.31, 659.47, 'ORIGIN', CB, 8.04);
  pdf.text(364.66, 664.63, 'QUANTITY ', CB, 8.04);
  pdf.text(412.42, 675.07, 'GROSS ', CB, 8.04);
  pdf.text(404.14, 664.63, 'WEIGHT (IN ', CB, 8.04);
  pdf.text(415.9, 654.19, 'KGS)', CB, 8.04);
  const priceLabel = `TOTAL PRICE ${doc.currency}`;
  pdf.text(484.17 - pdf.measure(priceLabel, CB, 8.04) / 2, 664.63, priceLabel, CB, fitSize(pdf, priceLabel, CB, 8.04, 73));
  return 649.99;
}

function page3(ctx: Ctx) {
  const { pdf, doc, calc } = ctx;
  let y = page3Header(ctx);
  let tableTop = 683.74;
  const frame = (bottom: number) => {
    pdf.vline(50.3, bottom, tableTop + 1.32, 1.32);
    for (const x of P3_COLS.slice(1, -1)) pdf.vline(x, bottom + 1.32, tableTop - 0.01, 0.6);
    pdf.vline(521.16, bottom, tableTop, 1.32);
  };
  const lastIndex = calc.lines.length - 1;
  let first = true;
  calc.lines.forEach((line, index) => {
    const cells = [String(index + 1), line.hsCode, ` ${line.description}`, line.coo, formatQuantity(line.qty), formatPlain2(line.grossWeightKg), formatPlain2(line.lineTotal)]
      .map((value, col) => pdf.wrap(value, C, 7.32, P3_COLS[col + 1] - P3_COLS[col] - 4));
    const lineCount = Math.max(...cells.map(lines => lines.length));
    const isLast = index === lastIndex;
    const need = (first ? P3_ROW_FIRST : P3_ROW) + (lineCount - 1) * P3_GAP + (isLast ? 45 : 0);
    if (y - need < P3_BOTTOM) {
      frame(y);
      pdf.hline(51.62, 522.48, y, 1.32);
      y = page3Header(ctx);
      tableTop = 683.74;
      first = true;
    }
    const height = (first ? P3_ROW_FIRST : P3_ROW) + (lineCount - 1) * P3_GAP;
    const bottom = y - height;
    const textBase = bottom + 7.56 + (lineCount - 1) * P3_GAP;
    cells.forEach((lines, col) => lines.forEach((text, lineIndex) => {
      const offset = ((lineCount - lines.length) * P3_GAP) / 2;
      pdf.textIn(P3_COLS[col] + (col === 0 ? 1.32 : 0.6), P3_COLS[col + 1], textBase - offset - lineIndex * P3_GAP, text, C, 7.32, 'center');
    }));
    if (isLast) pdf.hline(51.62, 522.48, bottom - 0.38, 1.32);
    else pdf.hline(51.62, 521.16, bottom, 0.6);
    y = isLast ? bottom - 0.38 : bottom;
    first = false;
  });
  frame(y);

  // Totals + packing box
  const B = y;
  pdf.text(328.99, B - 15.84, 'TOTAL', CB, 8.04);
  const center = (col: number) => (P3_COLS[col] + 0.6 + P3_COLS[col + 1]) / 2;
  const totals = [formatQuantity(calc.totals.qty), formatPlain2(calc.totals.weightKg), formatCurrencyValue(doc.currency, calc.totals.value)];
  totals.forEach((value, index) => {
    const size = fitSize(pdf, value, CB, 8.04, P3_COLS[index + 5] - P3_COLS[index + 4] - 1);
    pdf.text(center(index + 4) - pdf.measure(value, CB, size) / 2 + (index === 2 ? -0.7 : 0), B - 11.88, value, CB, size);
  });
  pdf.fillRect(363.07, B - 18.72, 158.81, 0.6, BLACK);
  pdf.fillRect(363.07, B - 20.04, 158.81, 0.6, BLACK);
  pdf.hline(142.49, 316.39, B - 19.8, 1.32);
  pdf.hline(142.49, 316.39, B - 39.6, 1.32);
  pdf.vline(141.17, B - 39.6, B - 18.48, 1.32);
  pdf.vline(315.07, B - 39.6, B - 19.8, 1.32);
  const packing = `TOTAL NO OF PACKING: ${formatQuantity(calc.totals.packages)} ${doc.packageType}`;
  const size = fitSize(pdf, packing, CB, 9.36, 170);
  pdf.text(228.87 - pdf.measure(packing, CB, size) / 2, B - 32.16, packing, CB, size);
}

export function renderShippingInvoicePdf(doc: ShippingInvoiceInput, branding: ShippingBranding = {}) {
  const pdf = new PdfWriter();
  const calc = computeShipping(doc);
  let logo: ImageHandle | undefined;
  if (branding.logo?.length) logo = pdf.addImage(branding.logo);
  const ctx: Ctx = { pdf, doc, calc, logo };
  page1(ctx, (branding.headerText || '').trim());
  page2(ctx);
  page3(ctx);
  return pdf.build({ title: `Shipping Invoice ${doc.invoiceRefNo}` });
}
