import ExcelJS from 'exceljs';

export interface ColumnDef<T> {
  header: string;
  key: keyof T | string;
  width?: number;
  align?: 'left' | 'center' | 'right';
  render?: (item: T) => string | number;
}

/**
 * Downloads a professionally styled Excel (.xlsx) workbook for management presentation.
 * Features:
 * - Brand styling (Dark Navy header #0F172A with gold accent)
 * - Auto-sized columns with margins
 * - Cell borders, zebra striping, and proper alignments
 * - Frozen top header row for smooth scrolling
 */
export async function exportToExcel<T>({
  filename,
  sheetName = 'Data Rekapitulasi',
  title,
  subtitle,
  columns,
  data,
}: {
  filename: string;
  sheetName?: string;
  title?: string;
  subtitle?: string;
  columns: ColumnDef<T>[];
  data: T[];
}): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TMM & BMA Advisory Control Center';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(sheetName, {
    views: [{ state: 'frozen', xSplit: 0, ySplit: title ? 4 : 1 }],
  });

  let currentRowIndex = 1;

  // Title Block (if provided)
  if (title) {
    const titleRow = worksheet.getRow(currentRowIndex);
    titleRow.values = [title.toUpperCase()];
    titleRow.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FF0F172A' } };
    titleRow.height = 24;
    currentRowIndex++;

    if (subtitle) {
      const subRow = worksheet.getRow(currentRowIndex);
      subRow.values = [subtitle];
      subRow.font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF64748B' } };
      subRow.height = 18;
      currentRowIndex++;
    }

    // Blank row spacer
    worksheet.getRow(currentRowIndex).height = 10;
    currentRowIndex++;
  }

  // Header columns
  worksheet.columns = columns.map((col) => ({
    header: col.header,
    key: String(col.key),
    width: col.width || 20,
  }));

  // Re-apply headers on the target row if title exists
  const headerRowNumber = currentRowIndex;
  const headerRow = worksheet.getRow(headerRowNumber);
  headerRow.values = columns.map((col) => col.header);
  headerRow.height = 26;

  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F172A' }, // Slate-900 / Deep Navy
    };
    cell.font = {
      name: 'Arial',
      size: 10,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: 'center',
      wrapText: true,
    };
    cell.border = {
      top: { style: 'medium', color: { argb: 'FF0F172A' } },
      bottom: { style: 'medium', color: { argb: 'FFD97706' } }, // Amber border
      left: { style: 'thin', color: { argb: 'FF334155' } },
      right: { style: 'thin', color: { argb: 'FF334155' } },
    };
  });

  // Data rows
  data.forEach((item, idx) => {
    const rowValues = columns.map((col) => {
      if (col.render) {
        return col.render(item);
      }
      const val = (item as any)[col.key];
      return val !== undefined && val !== null ? val : '-';
    });

    const dataRow = worksheet.addRow(rowValues);
    dataRow.height = 22;

    const isEven = idx % 2 === 0;
    dataRow.eachCell((cell, colNumber) => {
      const colDef = columns[colNumber - 1];
      cell.font = { name: 'Arial', size: 9, color: { argb: 'FF1E293B' } };
      cell.alignment = {
        vertical: 'middle',
        horizontal: colDef?.align || 'left',
        wrapText: true,
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };

      if (!isEven) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8FAFC' }, // subtle slate-50 zebra stripe
        };
      }
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename.replace(/\.xlsx$/i, '')}_${Date.now()}.xlsx`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

/**
 * Downloads a clean, Excel-compatible CSV with UTF-8 BOM (\uFEFF)
 * and properly escaped strings so Excel immediately parses it into columns without garbling.
 */
export function exportToCleanCsv<T>({
  filename,
  columns,
  data,
}: {
  filename: string;
  columns: ColumnDef<T>[];
  data: T[];
}): void {
  // UTF-8 BOM (\uFEFF) is mandatory for Excel on Windows to detect UTF-8 and split columns cleanly
  const BOM = '\uFEFF';
  const headers = columns.map((c) => `"${c.header.replace(/"/g, '""')}"`).join(',');

  const rows = data.map((item) => {
    return columns
      .map((col) => {
        let val = col.render ? col.render(item) : (item as any)[col.key];
        if (val === undefined || val === null) val = '';
        const stringVal = String(val).replace(/\r\n/g, ' ').replace(/\n/g, ' ').trim();
        return `"${stringVal.replace(/"/g, '""')}"`;
      })
      .join(',');
  });

  const csvContent = BOM + [headers, ...rows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename.replace(/\.csv$/i, '')}_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

/**
 * Copies formatted Tab-Separated Values (TSV) directly to clipboard.
 * When pasted in Excel, Google Sheets, Word, or Email (Ctrl+V),
 * it instantly pastes as perfectly formatted grid columns!
 */
export async function copyTableToClipboard<T>({
  columns,
  data,
}: {
  columns: ColumnDef<T>[];
  data: T[];
}): Promise<number> {
  const headers = columns.map((c) => c.header).join('\t');
  const rows = data.map((item) => {
    return columns
      .map((col) => {
        let val = col.render ? col.render(item) : (item as any)[col.key];
        if (val === undefined || val === null) val = '';
        return String(val).replace(/\t/g, ' ').replace(/\r\n/g, ' ').replace(/\n/g, ' ').trim();
      })
      .join('\t');
  });

  const tsvContent = [headers, ...rows].join('\r\n');
  await navigator.clipboard.writeText(tsvContent);
  return data.length;
}
