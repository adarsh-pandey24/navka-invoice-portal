import { Response } from 'express';
import ExcelJS from 'exceljs';
import { stringify } from 'csv-stringify';

export type CellValue = string | number | Date | undefined | null;

export interface ExportColumn<T> {
  header: string;
  width?: number;
  /** Excel number format, e.g. '#,##0.00'. */
  numFmt?: string;
  value: (row: T) => CellValue;
}

export interface ExportSheet<T = any> {
  name: string;
  columns: ExportColumn<T>[];
  rows: T[];
}

export const MONEY_FMT = '#,##0.00';
export const DATE_FMT = 'dd-mmm-yyyy';

const safeFilename = (name: string) => name.replace(/[^A-Za-z0-9._-]/g, '_');

/**
 * Spreadsheet apps execute cells starting with = + - @ (and tab/CR) as formulas.
 * Customer names and notes come from users and Shopify, so neutralise them.
 */
export const sanitizeCell = (value: CellValue): CellValue => {
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
};

const csvValue = (value: CellValue): string | number => {
  if (value === undefined || value === null) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  return sanitizeCell(value) as string | number;
};

export const sendCsv = <T>(res: Response, filename: string, columns: ExportColumn<T>[], rows: T[]): Promise<void> => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(filename)}"`);
  res.write('﻿'); // BOM so Excel opens UTF-8 (₹, names) correctly

  return new Promise((resolve, reject) => {
    const stringifier = stringify({ header: true, columns: columns.map((c) => c.header) });
    stringifier.on('error', reject);
    stringifier.on('end', resolve);
    stringifier.pipe(res);
    for (const row of rows) stringifier.write(columns.map((c) => csvValue(c.value(row))));
    stringifier.end();
  });
};

export const sendExcel = async (res: Response, filename: string, sheets: ExportSheet[]): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'NAVKA Invoice Management';
  workbook.created = new Date();

  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name.slice(0, 31));
    ws.columns = sheet.columns.map((c, i) => ({
      header: c.header,
      key: `c${i}`,
      width: c.width || Math.max(12, c.header.length + 2),
      style: c.numFmt ? { numFmt: c.numFmt } : undefined,
    }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    for (const row of sheet.rows) {
      ws.addRow(sheet.columns.map((c) => sanitizeCell(c.value(row)) ?? null));
    }
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(filename)}"`);
  await workbook.xlsx.write(res);
  res.end();
};
