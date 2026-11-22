import { describe, expect, it } from 'vitest';

describe('pdfText', () => {
  it('extracts the text of a PDF (pdf-parse v2 API)', async () => {
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));
    doc.text('Jane Doe, Senior Engineer');
    doc.end();
    await done;
    const { pdfText } = require('./pdfText.js');
    expect(await pdfText(Buffer.concat(chunks))).toContain(
      'Jane Doe, Senior Engineer',
    );
  });
});
