// Drop-in for the few SheetJS (`xlsx`) calls the HR screens use, built on
// ExcelJS. The `xlsx` 0.18 package on npm has unpatched high-severity
// advisories, so it is not shipped.
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

function json_to_sheet(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const headers = [];
  for (const row of list) {
    for (const key of Object.keys(row || {})) if (!headers.includes(key)) headers.push(key);
  }
  return { headers, rows: list, '!cols': null };
}

function book_new() {
  return { sheets: [] };
}

function book_append_sheet(wb, ws, name) {
  const safe = String(name || `Sheet${wb.sheets.length + 1}`)
    .replace(/[\\/*?:[\]]/g, ' ')
    .slice(0, 31);
  wb.sheets.push({ name: safe, ws });
}

async function writeFileAsync(wb, filename) {
  const book = new ExcelJS.Workbook();
  for (const { name, ws } of wb.sheets) {
    const sheet = book.addWorksheet(name);
    sheet.columns = ws.headers.map((h, i) => ({
      header: h,
      key: h,
      width: ws['!cols']?.[i]?.wch || Math.max(10, String(h).length + 2),
    }));
    for (const row of ws.rows) sheet.addRow(row);
    sheet.getRow(1).font = { bold: true };
  }
  const buffer = await book.xlsx.writeBuffer();
  saveAs(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename,
  );
}

function writeFile(wb, filename) {
  writeFileAsync(wb, filename).catch((err) => console.error('Excel export failed:', err));
}

export const utils = { json_to_sheet, book_new, book_append_sheet };
export { writeFile };
