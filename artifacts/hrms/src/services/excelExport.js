// src/utils/excelExport.js
//
// Shared, styled Excel export used by every report on the Reports page.
// Uses ExcelJS instead of the `xlsx` package because SheetJS's free/community
// build cannot write cell colors, fills, or fonts into .xlsx files — that's a
// Pro-only feature there. ExcelJS supports full styling and runs fine in the
// browser.
//
// Install:  npm install exceljs file-saver

import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { displayName } from './brand';

// Evaluated when a report is exported, after sign-in.
const BRAND_NAME_FN = () => displayName();
const BRAND_GREEN = 'FF16A34A'; // ARGB — #16a34a
const WHITE = 'FFFFFFFF';
const DARK_TEXT = 'FF1F2937';
const MUTED_TEXT = 'FF64748B';
const ROW_STRIPE = 'FFF3F4F6';
const BORDER_LIGHT = 'FFE2E8F0';

const HEADER_ROW_OFFSET = 4; // banner(1) + title(2) + subtitle(3) + blank(4) -> header on row 5

/**
 * Adds one fully-styled report sheet (banner, title, subtitle, colored
 * header, striped data rows, auto-sized columns, frozen header, autofilter)
 * to an existing ExcelJS workbook.
 *
 * @param {ExcelJS.Workbook} workbook
 * @param {string} reportTitle   e.g. "Headcount Report"
 * @param {string} dateRangeLabel e.g. "2026-06-01 → 2026-07-09" or "As of today"
 * @param {Array<Object>} rows   array of plain objects (same shape your table already uses)
 * @param {string} [sheetName]   defaults to reportTitle (Excel sheet names cap at 31 chars)
 */
export function buildReportSheet(workbook, reportTitle, dateRangeLabel, rows, sheetName) {
  const safeRows = rows && rows.length ? rows : [{ ' ': 'No records found for this selection.' }];
  const headers = Object.keys(safeRows[0]);
  const colCount = headers.length;

  const sheet = workbook.addWorksheet((sheetName || reportTitle).slice(0, 31));

  // ── Row 1: Brand banner ────────────────────────────────────────────────
  sheet.mergeCells(1, 1, 1, colCount);
  const brandCell = sheet.getCell(1, 1);
  brandCell.value = BRAND_NAME_FN();
  brandCell.font = { bold: true, size: 16, color: { argb: WHITE } };
  brandCell.alignment = { horizontal: 'center', vertical: 'middle' };
  brandCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_GREEN } };
  sheet.getRow(1).height = 28;

  // ── Row 2: Report name ─────────────────────────────────────────────────
  sheet.mergeCells(2, 1, 2, colCount);
  const titleCell = sheet.getCell(2, 1);
  titleCell.value = reportTitle;
  titleCell.font = { bold: true, size: 13, color: { argb: DARK_TEXT } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(2).height = 22;

  // ── Row 3: date range + generated timestamp ────────────────────────────
  sheet.mergeCells(3, 1, 3, colCount);
  const subCell = sheet.getCell(3, 1);
  subCell.value = `${dateRangeLabel || ''}   •   Generated on ${new Date().toLocaleString()}   •   ${safeRows.length} record${safeRows.length === 1 ? '' : 's'}`;
  subCell.font = { italic: true, size: 10, color: { argb: MUTED_TEXT } };
  subCell.alignment = { horizontal: 'center' };
  sheet.getRow(3).height = 18;

  // Row 4 left blank as a visual spacer.

  // ── Row 5: column headers — the green #16a34a / white text row ─────────
  const headerRowIndex = HEADER_ROW_OFFSET + 1;
  const headerRow = sheet.getRow(headerRowIndex);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: WHITE }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_GREEN } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: WHITE } },
      bottom: { style: 'thin', color: { argb: WHITE } },
      left: { style: 'thin', color: { argb: WHITE } },
      right: { style: 'thin', color: { argb: WHITE } },
    };
  });
  headerRow.height = 22;
  headerRow.commit();

  // ── Data rows (striped for readability) ────────────────────────────────
  safeRows.forEach((row, rIdx) => {
    const excelRow = sheet.getRow(headerRowIndex + 1 + rIdx);
    headers.forEach((h, cIdx) => {
      const cell = excelRow.getCell(cIdx + 1);
      cell.value = row[h] ?? '—';
      cell.alignment = { vertical: 'middle' };
      cell.border = { bottom: { style: 'thin', color: { argb: BORDER_LIGHT } } };
      if (rIdx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROW_STRIPE } };
      }
    });
  });

  // ── Column widths (auto-sized, capped so nothing runs off-screen) ──────
  headers.forEach((h, i) => {
    const maxLen = Math.max(h.length, ...safeRows.map(r => String(r[h] ?? '').length));
    sheet.getColumn(i + 1).width = Math.min(Math.max(maxLen + 2, 12), 40);
  });

  // ── Freeze header + enable filter dropdown on the header row ───────────
  sheet.views = [{ state: 'frozen', ySplit: headerRowIndex }];
  sheet.autoFilter = {
    from: { row: headerRowIndex, column: 1 },
    to: { row: headerRowIndex, column: colCount },
  };

  return sheet;
}

/**
 * Builds a single-sheet workbook for one report and triggers the download.
 * Used by the "Export Excel" button inside the report preview modal.
 */
export async function downloadStyledExcel(reportTitle, dateRangeLabel, rows, filename) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = BRAND_NAME_FN();
  workbook.created = new Date();

  buildReportSheet(workbook, reportTitle, dateRangeLabel, rows);

  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename
  );
}

/**
 * Builds a multi-sheet workbook (one sheet per report) and triggers the
 * download. Used by the "Export All" button.
 */
export async function downloadStyledExcelMulti(sheetsConfig, filename) {
  // sheetsConfig: Array<{ reportTitle, dateRangeLabel, rows, sheetName? }>
  const workbook = new ExcelJS.Workbook();
  workbook.creator = BRAND_NAME_FN();
  workbook.created = new Date();

  sheetsConfig.forEach(({ reportTitle, dateRangeLabel, rows, sheetName }) => {
    if (rows && rows.length) {
      buildReportSheet(workbook, reportTitle, dateRangeLabel, rows, sheetName);
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename
  );
}