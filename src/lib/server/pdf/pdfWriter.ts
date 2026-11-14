import { deflateSync, inflateSync } from 'node:zlib';
import { CARLITO_BOLD, CARLITO_REGULAR, HELVETICA_BOLD_WIDTHS, HELVETICA_WIDTHS, type EmbeddedFontData } from './fontData';

/**
 * Small dependency-free PDF 1.4 writer used by the invoicing PDFs.
 *
 * - Fonts: base-14 Helvetica / Helvetica-Bold (metric-identical to Arial) and
 *   embedded Carlito / Carlito-Bold (metric-identical to Calibri), WinAnsi encoded.
 * - Images: JPEG (passed through) and 8-bit non-interlaced PNG (alpha -> SMask).
 * - Coordinates are PDF points with the origin at the bottom-left of the page.
 */

export type FontKey = 'helvetica' | 'helvetica-bold' | 'calibri' | 'calibri-bold';
export type Rgb = [number, number, number];
export type ImageHandle = { id: string; width: number; height: number };

const FONT_RESOURCE: Record<FontKey, string> = { helvetica: 'F1', 'helvetica-bold': 'F2', calibri: 'F3', 'calibri-bold': 'F4' };
const WIDTHS: Record<FontKey, number[]> = {
  helvetica: HELVETICA_WIDTHS,
  'helvetica-bold': HELVETICA_BOLD_WIDTHS,
  calibri: CARLITO_REGULAR.widths,
  'calibri-bold': CARLITO_BOLD.widths,
};

// cp1252 code points 0x80-0x9F that differ from Latin-1.
const CP1252_EXTRA: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** Unicode -> WinAnsi byte codes. Unsupported characters become '?' after a best-effort accent strip. */
export function toWinAnsi(value: string): number[] {
  const codes: number[] = [];
  for (const char of String(value ?? '').replace(/[\r\n\t]+/g, ' ')) {
    const cp = char.codePointAt(0) ?? 63;
    if (cp >= 0x20 && cp <= 0x7e) { codes.push(cp); continue; }
    if (cp >= 0xa0 && cp <= 0xff) { codes.push(cp); continue; }
    if (CP1252_EXTRA[cp]) { codes.push(CP1252_EXTRA[cp]); continue; }
    // Compatibility decomposition: é -> e, № -> No, ﬁ -> fi. Anything left outside WinAnsi becomes '?'.
    const stripped = char.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    if (!stripped.length) { codes.push(63); continue; }
    for (const part of stripped) {
      const code = part.codePointAt(0) ?? 63;
      codes.push((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) ? code : CP1252_EXTRA[code] ?? 63);
    }
  }
  return codes;
}

function pdfString(codes: number[]) {
  let out = '(';
  for (const code of codes) {
    if (code === 0x28 || code === 0x29 || code === 0x5c) out += `\\${String.fromCharCode(code)}`;
    else if (code < 0x20 || code > 0x7e) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(code);
  }
  return `${out})`;
}

const n = (value: number) => (Math.round(value * 1000) / 1000).toString();

type PageState = { width: number; height: number; ops: string[] };
type ImageObject = { id: string; width: number; height: number; dict: string; data: Buffer; smask?: { dict: string; data: Buffer } };

export class PdfWriter {
  private pages: PageState[] = [];
  private images: ImageObject[] = [];
  private usedFonts = new Set<FontKey>();
  private current!: PageState;

  addPage(width: number, height: number) {
    this.current = { width, height, ops: [] };
    this.pages.push(this.current);
    return this.current;
  }

  get pageCount() { return this.pages.length; }
  get pageWidth() { return this.current.width; }
  get pageHeight() { return this.current.height; }

  measure(text: string, font: FontKey, size: number) {
    const widths = WIDTHS[font];
    let total = 0;
    for (const code of toWinAnsi(text)) total += widths[code - 32] ?? 500;
    return (total * size) / 1000;
  }

  /** Word-wraps to `maxWidth`, hard-breaking words that are longer than a line. */
  wrap(text: string, font: FontKey, size: number, maxWidth: number): string[] {
    const lines: string[] = [];
    for (const paragraph of String(text ?? '').split(/\r?\n/)) {
      const words = paragraph.split(/\s+/).filter(Boolean);
      let line = '';
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (this.measure(candidate, font, size) <= maxWidth) { line = candidate; continue; }
        if (line) lines.push(line);
        if (this.measure(word, font, size) <= maxWidth) { line = word; continue; }
        let chunk = '';
        for (const char of word) {
          if (this.measure(chunk + char, font, size) > maxWidth && chunk) { lines.push(chunk); chunk = char; } else chunk += char;
        }
        line = chunk;
      }
      lines.push(line);
    }
    return lines.length ? lines : [''];
  }

  text(x: number, y: number, value: string, font: FontKey, size: number, color: Rgb = [0, 0, 0]) {
    if (!value) return;
    this.usedFonts.add(font);
    this.current.ops.push(`BT /${FONT_RESOURCE[font]} ${n(size)} Tf ${color.map(n).join(' ')} rg ${n(x)} ${n(y)} Td ${pdfString(toWinAnsi(value))} Tj ET`);
  }

  /** Draws text aligned inside [x1, x2]. */
  textIn(x1: number, x2: number, y: number, value: string, font: FontKey, size: number, align: 'left' | 'center' | 'right' = 'left', pad = 0) {
    const width = this.measure(value, font, size);
    const x = align === 'center' ? (x1 + x2 - width) / 2 : align === 'right' ? x2 - pad - width : x1 + pad;
    this.text(x, y, value, font, size);
  }

  fillRect(x: number, y: number, w: number, h: number, color: Rgb = [0, 0, 0]) {
    this.current.ops.push(`${color.map(n).join(' ')} rg ${n(x)} ${n(y)} ${n(w)} ${n(h)} re f`);
  }

  strokeRect(x: number, y: number, w: number, h: number, lineWidth: number, color: Rgb = [0, 0, 0]) {
    this.current.ops.push(`${n(lineWidth)} w ${color.map(n).join(' ')} RG ${n(x)} ${n(y)} ${n(w)} ${n(h)} re S`);
  }

  /** Horizontal rule drawn as a filled rectangle (Excel-style borders). */
  hline(x1: number, x2: number, y: number, thickness: number) { this.fillRect(x1, y, x2 - x1, thickness); }
  vline(x: number, y1: number, y2: number, thickness: number) { this.fillRect(x, y1, thickness, y2 - y1); }

  /** Registers an image from bytes (PNG or JPEG). Throws on unsupported formats. */
  addImage(bytes: Buffer): ImageHandle {
    const id = `Im${this.images.length + 1}`;
    const image = bytes[0] === 0xff && bytes[1] === 0xd8 ? parseJpeg(id, bytes) : parsePng(id, bytes);
    this.images.push(image);
    return { id, width: image.width, height: image.height };
  }

  /** Draws an image scaled to fit inside the box, preserving aspect ratio, anchored bottom-left. */
  drawImageFit(image: ImageHandle, x: number, y: number, boxW: number, boxH: number) {
    const scale = Math.min(boxW / image.width, boxH / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    this.current.ops.push(`q ${n(w)} 0 0 ${n(h)} ${n(x)} ${n(y + (boxH - h) / 2)} cm /${image.id} Do Q`);
  }

  build(info: { title?: string } = {}): Buffer {
    const objects: Buffer[] = [];
    const reserve = () => { objects.push(Buffer.alloc(0)); return objects.length; };
    const set = (id: number, body: string | Buffer) => { objects[id - 1] = typeof body === 'string' ? Buffer.from(body, 'latin1') : body; };
    const stream = (dict: string, data: Buffer) => Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]);

    const catalogId = reserve();
    const pagesId = reserve();
    const fontIds: Partial<Record<FontKey, number>> = {};
    for (const font of this.usedFonts) {
      if (font === 'helvetica' || font === 'helvetica-bold') {
        const id = reserve();
        set(id, `<< /Type /Font /Subtype /Type1 /BaseFont /${font === 'helvetica' ? 'Helvetica' : 'Helvetica-Bold'} /Encoding /WinAnsiEncoding >>`);
        fontIds[font] = id;
      } else {
        fontIds[font] = embedTrueType(font === 'calibri' ? CARLITO_REGULAR : CARLITO_BOLD, reserve, set, stream);
      }
    }
    const imageIds: Record<string, number> = {};
    for (const image of this.images) {
      let smaskRef = '';
      if (image.smask) {
        const smaskId = reserve();
        set(smaskId, stream(image.smask.dict, image.smask.data));
        smaskRef = ` /SMask ${smaskId} 0 R`;
      }
      const id = reserve();
      set(id, stream(`${image.dict}${smaskRef}`, image.data));
      imageIds[image.id] = id;
    }
    const fontDict = Object.entries(fontIds).map(([key, id]) => `/${FONT_RESOURCE[key as FontKey]} ${id} 0 R`).join(' ');
    const xobjects = Object.entries(imageIds).map(([key, id]) => `/${key} ${id} 0 R`).join(' ');
    const pageIds: number[] = [];
    for (const page of this.pages) {
      const contentId = reserve();
      set(contentId, stream('/Filter /FlateDecode', deflateSync(Buffer.from(page.ops.join('\n'), 'latin1'))));
      const pageId = reserve();
      set(pageId, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${n(page.width)} ${n(page.height)}] /Resources << /Font << ${fontDict} >>${xobjects ? ` /XObject << ${xobjects} >>` : ''} >> /Contents ${contentId} 0 R >>`);
      pageIds.push(pageId);
    }
    set(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    set(pagesId, `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
    const infoId = reserve();
    set(infoId, `<< /Producer (WMS Desk Invoicing)${info.title ? ` /Title ${pdfString(toWinAnsi(info.title))}` : ''} >>`);

    const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
    const offsets: number[] = [];
    let length = chunks[0].length;
    objects.forEach((body, index) => {
      offsets.push(length);
      const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
      chunks.push(chunk);
      length += chunk.length;
    });
    const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
    chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${length}\n%%EOF`, 'latin1'));
    return Buffer.concat(chunks);
  }
}

function embedTrueType(
  font: EmbeddedFontData,
  reserve: () => number,
  set: (id: number, body: string | Buffer) => void,
  stream: (dict: string, data: Buffer) => Buffer,
) {
  const raw = Buffer.from(font.base64, 'base64');
  const fileId = reserve();
  set(fileId, stream(`/Filter /FlateDecode /Length1 ${raw.length}`, deflateSync(raw)));
  const descriptorId = reserve();
  const name = `AAAAAA+${font.postScriptName}`;
  set(descriptorId, `<< /Type /FontDescriptor /FontName /${name} /Flags 32 /FontBBox [${font.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${font.ascent} /Descent ${font.descent} /CapHeight ${font.capHeight} /StemV 80 /FontFile2 ${fileId} 0 R >>`);
  const fontId = reserve();
  set(fontId, `<< /Type /Font /Subtype /TrueType /BaseFont /${name} /FirstChar 32 /LastChar 255 /Widths [${font.widths.join(' ')}] /FontDescriptor ${descriptorId} 0 R /Encoding /WinAnsiEncoding >>`);
  return fontId;
}

function parseJpeg(id: string, bytes: Buffer): ImageObject {
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      const height = bytes.readUInt16BE(offset + 5);
      const width = bytes.readUInt16BE(offset + 7);
      const components = bytes[offset + 9];
      const colorSpace = components === 1 ? '/DeviceGray' : components === 4 ? '/DeviceCMYK /Decode [1 0 1 0 1 0 1 0]' : '/DeviceRGB';
      return { id, width, height, data: bytes, dict: `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode` };
    }
    offset += 2 + length;
  }
  throw new Error('Unsupported JPEG image (no frame header found).');
}

function parsePng(id: string, bytes: Buffer): ImageObject {
  if (bytes.readUInt32BE(0) !== 0x89504e47) throw new Error('Logo must be a PNG or JPEG image.');
  let offset = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  let palette: Buffer | undefined;
  let transparency: Buffer | undefined;
  const idat: Buffer[] = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparency = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (bitDepth !== 8) throw new Error('PNG logos must use 8 bits per channel. Re-export the logo as a standard 8-bit PNG or JPEG.');
  if (interlace) throw new Error('Interlaced PNG logos are not supported. Re-export without interlacing.');
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (!channels) throw new Error('Unsupported PNG colour type.');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)];
    const src = raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1));
    const out = pixels.subarray(row * stride, (row + 1) * stride);
    const prev = row ? pixels.subarray((row - 1) * stride, row * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? out[i - channels] : 0;
      const up = prev[i];
      const upLeft = i >= channels ? prev[i - channels] : 0;
      let value = src[i];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      out[i] = value & 0xff;
    }
  }
  const rgb = Buffer.alloc(width * height * 3);
  const alpha = Buffer.alloc(width * height, 255);
  let hasAlpha = false;
  for (let i = 0; i < width * height; i += 1) {
    let r: number, g: number, b: number, a = 255;
    if (colorType === 0) { r = g = b = pixels[i]; if (transparency && transparency.length >= 2 && pixels[i] === transparency.readUInt16BE(0)) a = 0; }
    else if (colorType === 2) { r = pixels[i * 3]; g = pixels[i * 3 + 1]; b = pixels[i * 3 + 2]; }
    else if (colorType === 3) {
      const index = pixels[i];
      r = palette ? palette[index * 3] : 0; g = palette ? palette[index * 3 + 1] : 0; b = palette ? palette[index * 3 + 2] : 0;
      if (transparency && index < transparency.length) a = transparency[index];
    } else if (colorType === 4) { r = g = b = pixels[i * 2]; a = pixels[i * 2 + 1]; }
    else { r = pixels[i * 4]; g = pixels[i * 4 + 1]; b = pixels[i * 4 + 2]; a = pixels[i * 4 + 3]; }
    rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
    alpha[i] = a;
    if (a !== 255) hasAlpha = true;
  }
  const base = `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /BitsPerComponent 8 /Filter /FlateDecode`;
  return {
    id, width, height,
    dict: `${base} /ColorSpace /DeviceRGB`,
    data: deflateSync(rgb),
    smask: hasAlpha ? { dict: `${base} /ColorSpace /DeviceGray`, data: deflateSync(alpha) } : undefined,
  };
}
