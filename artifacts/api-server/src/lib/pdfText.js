'use strict';

/**
 * Extracts plain text from a PDF buffer (pdf-parse v2 API).
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
async function pdfText(buffer) {
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result?.text || '';
  } finally {
    await parser.destroy?.().catch?.(() => {});
  }
}

module.exports = { pdfText };
