/**
 * Pure TypeScript PDF 1.4 Generator (Zero dependencies, zero AI tokens).
 * Works identically in Node.js (server API + tests) and Browser (preview + download).
 * Encodes Portuguese WinAnsi characters accurately using PDF octal escapes.
 */

export interface PdfKeyValue {
  label: string;
  value: string;
}

export interface PdfSection {
  title: string;
  rows?: PdfKeyValue[];
  paragraphs?: string[];
  highlightBox?: {
    title: string;
    lines: Array<{ label: string; value: string; bold?: boolean }>;
    footnote?: string;
  };
}

export interface PdfDocumentPayload {
  documentNumber: string;
  title: string;
  subtitle?: string;
  dealershipName: string;
  dealershipLegalLine?: string;
  dealershipAddress?: string;
  dealershipContact?: string;
  issuedAtFormatted: string;
  issuedByName: string;
  templateMeta: string;
  sections: PdfSection[];
  signatures?: Array<{ label: string; sublabel?: string }>;
  footerNote?: string;
}

// WinAnsiEncoding table for common Portuguese/Latin-1 punctuation beyond ASCII
const UNICODE_TO_WINANSI: Record<number, number> = {
  0x2013: 0x96, // en-dash
  0x2014: 0x97, // em-dash
  0x2018: 0x91, // left single quote
  0x2019: 0x92, // right single quote
  0x201c: 0x93, // left double quote
  0x201d: 0x94, // right double quote
  0x2022: 0x95, // bullet
  0x2026: 0x85, // ellipsis
  0x00b7: 0xb7, // middle dot
};

function encodePdfWinAnsi(input: string): string {
  const clean = (input || '').replace(/\r/g, '');
  let out = '';
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    if (code === 0x28 || code === 0x29 || code === 0x5c) {
      out += '\\' + clean[i];
    } else if (code >= 0x20 && code <= 0x7e) {
      out += clean[i];
    } else if (code >= 0xa0 && code <= 0xff) {
      out += '\\' + code.toString(8).padStart(3, '0');
    } else if (UNICODE_TO_WINANSI[code] !== undefined) {
      out += '\\' + UNICODE_TO_WINANSI[code].toString(8).padStart(3, '0');
    } else if (code === 0x09) {
      out += '  ';
    } else {
      out += '?';
    }
  }
  return out;
}

function wrapText(text: string, maxChars: number): string[] {
  const paragraphs = (text || '').replace(/\r/g, '').split('\n');
  const lines: string[] = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) {
      lines.push('');
      continue;
    }
    const words = trimmed.split(/\s+/);
    let current = '';
    for (const word of words) {
      if (!current) {
        current = word;
      } else if (current.length + 1 + word.length <= maxChars) {
        current += ' ' + word;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

/**
 * Builds a valid, multi-page A4 PDF 1.4 binary Uint8Array using Helvetica / Helvetica-Bold
 * with WinAnsiEncoding. Deterministic, fast, and 100% offline/token-free.
 */
export function generateDealershipPdf(payload: PdfDocumentPayload): Uint8Array {
  const PAGE_W = 595.28; // A4 pt
  const PAGE_H = 841.89;
  const MARGIN_X = 42;
  const CONTENT_W = PAGE_W - MARGIN_X * 2;
  const BOTTOM_SAFE = 62;

  const pages: string[][] = [];
  let cmds: string[] = [];
  let cursorY = PAGE_H - 40;

  const startNewPage = (isFirst: boolean) => {
    if (cmds.length > 0) {
      pages.push(cmds);
    }
    cmds = [];
    cursorY = PAGE_H - 42;

    if (isFirst) {
      // Dark header band
      const bandHeight = 74;
      const bandBottom = PAGE_H - bandHeight;
      cmds.push('0.07 0.07 0.09 rg');
      cmds.push(`0 ${bandBottom.toFixed(2)} ${PAGE_W.toFixed(2)} ${bandHeight.toFixed(2)} re f`);
      // Red accent line below header
      cmds.push('0.86 0.15 0.15 rg');
      cmds.push(`0 ${(bandBottom - 3).toFixed(2)} ${PAGE_W.toFixed(2)} 3 re f`);

      // Brand + Title in header
      cmds.push('1 1 1 rg');
      cmds.push(`BT /F2 15 Tf ${MARGIN_X} ${(PAGE_H - 30).toFixed(2)} Td (${encodePdfWinAnsi(payload.dealershipName)}) Tj ET`);

      cmds.push('0.80 0.80 0.84 rg');
      const headerSub = [payload.dealershipLegalLine, payload.dealershipAddress]
        .filter(Boolean)
        .join(' · ');
      if (headerSub) {
        cmds.push(`BT /F1 8.5 Tf ${MARGIN_X} ${(PAGE_H - 45).toFixed(2)} Td (${encodePdfWinAnsi(headerSub.slice(0, 96))}) Tj ET`);
      }
      if (payload.dealershipContact) {
        cmds.push(`BT /F1 8.5 Tf ${MARGIN_X} ${(PAGE_H - 58).toFixed(2)} Td (${encodePdfWinAnsi(payload.dealershipContact.slice(0, 96))}) Tj ET`);
      }

      // Document badge right-aligned
      cmds.push('1 1 1 rg');
      const docCode = `DOC ${payload.documentNumber}`;
      cmds.push(`BT /F2 9 Tf ${(PAGE_W - MARGIN_X - 115).toFixed(2)} ${(PAGE_H - 30).toFixed(2)} Td (${encodePdfWinAnsi(docCode)}) Tj ET`);
      cmds.push('0.75 0.75 0.80 rg');
      cmds.push(`BT /F1 8 Tf ${(PAGE_W - MARGIN_X - 115).toFixed(2)} ${(PAGE_H - 44).toFixed(2)} Td (${encodePdfWinAnsi(payload.issuedAtFormatted)}) Tj ET`);

      cursorY = bandBottom - 26;

      // Document Title & Subtitle
      cmds.push('0.08 0.08 0.10 rg');
      cmds.push(`BT /F2 15 Tf ${MARGIN_X} ${cursorY.toFixed(2)} Td (${encodePdfWinAnsi(payload.title)}) Tj ET`);
      cursorY -= 16;

      if (payload.subtitle) {
        cmds.push('0.35 0.35 0.40 rg');
        cmds.push(`BT /F1 9.5 Tf ${MARGIN_X} ${cursorY.toFixed(2)} Td (${encodePdfWinAnsi(payload.subtitle)}) Tj ET`);
        cursorY -= 14;
      }

      // Thin divider
      cmds.push('0.85 0.86 0.89 RG 0.7 w');
      cmds.push(`${MARGIN_X} ${cursorY.toFixed(2)} m ${(PAGE_W - MARGIN_X).toFixed(2)} ${cursorY.toFixed(2)} l S`);
      cursorY -= 16;
    } else {
      // Continuation header
      cmds.push('0.45 0.45 0.50 rg');
      cmds.push(`BT /F1 8.5 Tf ${MARGIN_X} ${(PAGE_H - 28).toFixed(2)} Td (${encodePdfWinAnsi(`${payload.dealershipName} · ${payload.title} · DOC ${payload.documentNumber}`)}) Tj ET`);
      cmds.push('0.85 0.86 0.89 RG 0.5 w');
      cmds.push(`${MARGIN_X} ${(PAGE_H - 36).toFixed(2)} m ${(PAGE_W - MARGIN_X).toFixed(2)} ${(PAGE_H - 36).toFixed(2)} l S`);
      cursorY = PAGE_H - 56;
    }
  };

  const ensureSpace = (neededPt: number) => {
    if (cursorY - neededPt < BOTTOM_SAFE) {
      startNewPage(false);
    }
  };

  startNewPage(true);

  for (const section of payload.sections) {
    ensureSpace(34);
    // Section Header
    cmds.push('0.95 0.96 0.97 rg');
    cmds.push(`${MARGIN_X} ${(cursorY - 5).toFixed(2)} ${CONTENT_W.toFixed(2)} 18 re f`);
    cmds.push('0.10 0.10 0.14 rg');
    cmds.push(`BT /F2 9.5 Tf ${(MARGIN_X + 7).toFixed(2)} ${cursorY.toFixed(2)} Td (${encodePdfWinAnsi(section.title.toUpperCase())}) Tj ET`);
    cursorY -= 20;

    if (section.rows && section.rows.length > 0) {
      for (const row of section.rows) {
        const valueLines = wrapText(row.value || '—', 62);
        const rowH = Math.max(15, valueLines.length * 12.5 + 4);
        ensureSpace(rowH + 4);

        cmds.push('0.38 0.40 0.45 rg');
        cmds.push(`BT /F2 8.8 Tf ${(MARGIN_X + 4).toFixed(2)} ${cursorY.toFixed(2)} Td (${encodePdfWinAnsi(row.label)}:) Tj ET`);

        cmds.push('0.10 0.10 0.13 rg');
        valueLines.forEach((vLine, idx) => {
          const lineY = cursorY - idx * 12.5;
          cmds.push(`BT /F1 9 Tf ${(MARGIN_X + 152).toFixed(2)} ${lineY.toFixed(2)} Td (${encodePdfWinAnsi(vLine)}) Tj ET`);
        });

        cursorY -= rowH;
        // Subtle hairline between rows
        cmds.push('0.92 0.93 0.95 RG 0.4 w');
        cmds.push(`${MARGIN_X} ${(cursorY + 4).toFixed(2)} m ${(PAGE_W - MARGIN_X).toFixed(2)} ${(cursorY + 4).toFixed(2)} l S`);
      }
      cursorY -= 6;
    }

    if (section.highlightBox) {
      const box = section.highlightBox;
      const boxH = 26 + box.lines.length * 16 + (box.footnote ? 18 : 0);
      ensureSpace(boxH + 10);

      const boxBottom = cursorY - boxH + 10;
      cmds.push('0.97 0.97 0.98 rg');
      cmds.push(`${MARGIN_X} ${boxBottom.toFixed(2)} ${CONTENT_W.toFixed(2)} ${boxH.toFixed(2)} re f`);
      cmds.push('0.78 0.80 0.85 RG 0.8 w');
      cmds.push(`${MARGIN_X} ${boxBottom.toFixed(2)} ${CONTENT_W.toFixed(2)} ${boxH.toFixed(2)} re S`);

      let innerY = cursorY - 6;
      cmds.push('0.10 0.10 0.14 rg');
      cmds.push(`BT /F2 9.5 Tf ${(MARGIN_X + 10).toFixed(2)} ${innerY.toFixed(2)} Td (${encodePdfWinAnsi(box.title)}) Tj ET`);
      innerY -= 16;

      for (const line of box.lines) {
        const font = line.bold ? '/F2' : '/F1';
        const size = line.bold ? '10' : '9';
        cmds.push(line.bold ? '0.07 0.07 0.09 rg' : '0.28 0.30 0.34 rg');
        cmds.push(`BT ${font} ${size} Tf ${(MARGIN_X + 10).toFixed(2)} ${innerY.toFixed(2)} Td (${encodePdfWinAnsi(line.label)}) Tj ET`);
        cmds.push(line.bold ? '0.75 0.12 0.12 rg' : '0.10 0.10 0.14 rg');
        cmds.push(`BT ${font} ${size} Tf ${(MARGIN_X + 320).toFixed(2)} ${innerY.toFixed(2)} Td (${encodePdfWinAnsi(line.value)}) Tj ET`);
        innerY -= 16;
      }

      if (box.footnote) {
        cmds.push('0.42 0.44 0.48 rg');
        cmds.push(`BT /F1 8 Tf ${(MARGIN_X + 10).toFixed(2)} ${(innerY + 2).toFixed(2)} Td (${encodePdfWinAnsi(box.footnote.slice(0, 108))}) Tj ET`);
      }

      cursorY = boxBottom - 14;
    }

    if (section.paragraphs && section.paragraphs.length > 0) {
      for (const para of section.paragraphs) {
        const lines = wrapText(para, 94);
        for (const line of lines) {
          ensureSpace(14);
          if (line) {
            cmds.push('0.18 0.20 0.24 rg');
            cmds.push(`BT /F1 9 Tf ${(MARGIN_X + 4).toFixed(2)} ${cursorY.toFixed(2)} Td (${encodePdfWinAnsi(line)}) Tj ET`);
          }
          cursorY -= 12.5;
        }
        cursorY -= 4;
      }
    }

    cursorY -= 6;
  }

  // Signatures block
  if (payload.signatures && payload.signatures.length > 0) {
    ensureSpace(64);
    cursorY -= 14;
    const count = Math.min(2, payload.signatures.length);
    const colW = (CONTENT_W - 24) / count;
    payload.signatures.slice(0, 2).forEach((sig, idx) => {
      const xStart = MARGIN_X + idx * (colW + 24);
      cmds.push('0.45 0.47 0.52 RG 0.7 w');
      cmds.push(`${xStart.toFixed(2)} ${cursorY.toFixed(2)} m ${(xStart + colW).toFixed(2)} ${cursorY.toFixed(2)} l S`);
      cmds.push('0.12 0.12 0.15 rg');
      cmds.push(`BT /F2 8.5 Tf ${xStart.toFixed(2)} ${(cursorY - 12).toFixed(2)} Td (${encodePdfWinAnsi(sig.label)}) Tj ET`);
      if (sig.sublabel) {
        cmds.push('0.42 0.44 0.48 rg');
        cmds.push(`BT /F1 7.8 Tf ${xStart.toFixed(2)} ${(cursorY - 23).toFixed(2)} Td (${encodePdfWinAnsi(sig.sublabel)}) Tj ET`);
      }
    });
    cursorY -= 38;
  }

  if (cmds.length > 0) {
    pages.push(cmds);
  }

  // Stamp footers on every page
  const totalPages = pages.length;
  pages.forEach((pageCmds, idx) => {
    const footerY = 30;
    pageCmds.push('0.85 0.86 0.89 RG 0.5 w');
    pageCmds.push(`${MARGIN_X} ${(footerY + 12).toFixed(2)} m ${(PAGE_W - MARGIN_X).toFixed(2)} ${(footerY + 12).toFixed(2)} l S`);
    pageCmds.push('0.45 0.47 0.52 rg');
    const leftFooter = `${payload.templateMeta} · Emitido por ${payload.issuedByName}`;
    pageCmds.push(`BT /F1 7.5 Tf ${MARGIN_X} ${footerY.toFixed(2)} Td (${encodePdfWinAnsi(leftFooter.slice(0, 88))}) Tj ET`);
    const rightFooter = `Pag. ${idx + 1}/${totalPages}`;
    pageCmds.push(`BT /F1 7.5 Tf ${(PAGE_W - MARGIN_X - 42).toFixed(2)} ${footerY.toFixed(2)} Td (${encodePdfWinAnsi(rightFooter)}) Tj ET`);
    if (payload.footerNote) {
      pageCmds.push(`BT /F1 7 Tf ${MARGIN_X} ${(footerY - 10).toFixed(2)} Td (${encodePdfWinAnsi(payload.footerNote.slice(0, 110))}) Tj ET`);
    }
  });

  // Assemble PDF 1.4 object table
  // Object IDs:
  // 1 = Catalog
  // 2 = Pages
  // 3 = Font F1 (Helvetica + WinAnsiEncoding)
  // 4 = Font F2 (Helvetica-Bold + WinAnsiEncoding)
  // For each page i: contentObj = 5 + i*2, pageObj = 6 + i*2
  const objects: string[] = [];
  const pageObjIds: number[] = [];
  for (let i = 0; i < pages.length; i++) {
    pageObjIds.push(6 + i * 2);
  }

  objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`
  );
  objects.push(
    `3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`
  );
  objects.push(
    `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`
  );

  for (let i = 0; i < pages.length; i++) {
    const contentId = 5 + i * 2;
    const pageId = 6 + i * 2;
    const stream = pages[i].join('\n');
    const byteLen = new TextEncoder().encode(stream).length;

    objects.push(
      `${contentId} 0 obj\n<< /Length ${byteLen} >>\nstream\n${stream}\nendstream\nendobj\n`
    );
    objects.push(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W.toFixed(2)} ${PAGE_H.toFixed(2)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`
    );
  }

  // Build final bytes with exact xref offsets
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0]; // object 0
  let totalBytes = 0;

  const pushStr = (s: string) => {
    const bytes = encoder.encode(s);
    chunks.push(bytes);
    totalBytes += bytes.length;
  };

  pushStr('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  for (const obj of objects) {
    offsets.push(totalBytes);
    pushStr(obj);
  }

  const xrefOffset = totalBytes;
  pushStr(`xref\n0 ${offsets.length}\n`);
  pushStr('0000000000 65535 f \n');
  for (let i = 1; i < offsets.length; i++) {
    pushStr(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }

  pushStr(
    `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  );

  const result = new Uint8Array(totalBytes);
  let pos = 0;
  for (const chunk of chunks) {
    result.set(chunk, pos);
    pos += chunk.length;
  }
  return result;
}
