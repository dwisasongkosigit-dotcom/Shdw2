export interface SummaryMetric {
  metric: string;
  value: string | number;
  note: string;
}

export interface RiskExportRow {
  clientId: string;
  clientName: string;
  overallRisk: string;
  accountingRisk: string;
  accountingReason: string;
  accountingAction: string;
  accountingSpv: string;
  accountingReview: string;
  taxRisk: string;
  taxReason: string;
  taxAction: string;
  taxSpv: string;
  taxReview: string;
}

export interface OperationsExportRow {
  category: string;
  reference: string;
  client: string;
  division: string;
  owner: string;
  status: string;
  deadline: string;
  summary: string;
}

export interface AgendaExportRow {
  date: string;
  time: string;
  title: string;
  type: string;
  division: string;
  client: string;
  job: string;
  participants: string;
  location: string;
  status: string;
}

export interface ExecutiveSummaryExportData {
  period: string;
  generatedAt: string;
  sourceUpdatedAt: string;
  scopeNote: string;
  overallStatus: string;
  metrics: SummaryMetric[];
  risks: RiskExportRow[];
  operations: OperationsExportRow[];
  agenda: AgendaExportRow[];
  highlights: string[];
}

function escapeHtml(value: unknown) {
  return String(value ?? '—').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] || character);
}

function tableRows<T>(rows: T[], columns: Array<{ key: keyof T; label: string }>) {
  if (!rows.length) return `<tr><td colspan="${columns.length}" class="empty">Tidak ada data pada periode ini.</td></tr>`;
  return rows.map((row) => `<tr>${columns.map(({ key }) => `<td>${escapeHtml(row[key])}</td>`).join('')}</tr>`).join('');
}

export function printExecutiveSummaryPdf(data: ExecutiveSummaryExportData) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) throw new Error('Jendela cetak terblokir. Izinkan pop-up untuk mengekspor PDF.');

  const metricRows = tableRows(data.metrics, [
    { key: 'metric', label: 'Indikator' },
    { key: 'value', label: 'Nilai' },
    { key: 'note', label: 'Catatan' },
  ]);
  const riskColumns: Array<{ key: keyof RiskExportRow; label: string }> = [
    { key: 'clientName', label: 'Klien' },
    { key: 'overallRisk', label: 'Kategori' },
    { key: 'accountingReason', label: 'Alasan Accounting' },
    { key: 'accountingAction', label: 'Tindakan Accounting' },
    { key: 'accountingSpv', label: 'PIC Accounting' },
    { key: 'taxReason', label: 'Alasan Tax' },
    { key: 'taxAction', label: 'Tindakan Tax' },
    { key: 'taxSpv', label: 'PIC Tax' },
  ];
  const operationColumns: Array<{ key: keyof OperationsExportRow; label: string }> = [
    { key: 'category', label: 'Jenis' },
    { key: 'reference', label: 'Referensi' },
    { key: 'client', label: 'Klien' },
    { key: 'division', label: 'Divisi' },
    { key: 'owner', label: 'PIC' },
    { key: 'status', label: 'Status' },
    { key: 'deadline', label: 'Tenggat' },
    { key: 'summary', label: 'Ringkasan' },
  ];
  const agendaColumns: Array<{ key: keyof AgendaExportRow; label: string }> = [
    { key: 'date', label: 'Tanggal' },
    { key: 'time', label: 'Waktu' },
    { key: 'title', label: 'Agenda' },
    { key: 'type', label: 'Jenis' },
    { key: 'division', label: 'Divisi' },
    { key: 'client', label: 'Klien' },
    { key: 'participants', label: 'Peserta' },
    { key: 'location', label: 'Lokasi' },
    { key: 'status', label: 'Status' },
  ];

  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
    <html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Executive Summary Tim 3 · ${escapeHtml(data.period)}</title>
    <style>
      @page { size: A4 landscape; margin: 14mm; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #263246; font: 9pt/1.5 Arial, sans-serif; }
      header { border-bottom: 3px solid #d4a64e; padding: 0 0 14px; }
      .brand { color: #a66a12; font-size: 8pt; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; }
      h1 { color: #101b34; font-size: 24pt; line-height: 1.15; margin: 9px 0 4px; }
      .meta { color: #64748b; font-size: 8pt; margin: 0; }
      .status { display: inline-block; border: 1px solid #d6dee8; border-radius: 20px; color: #344256; font-size: 8pt; font-weight: 700; margin: 11px 0 0; padding: 4px 10px; }
      .scope { background: #f8fafc; border-left: 3px solid #c28a2c; color: #536175; margin: 12px 0 0; padding: 8px 10px; font-size: 8pt; }
      h2 { border-bottom: 1px solid #dce1e8; color: #101b34; font-size: 12pt; margin: 18px 0 9px; padding-bottom: 5px; }
      .highlights { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 18px; margin: 10px 0; }
      .highlight { border-left: 2px solid #d4a64e; padding-left: 8px; }
      table { border-collapse: collapse; font-size: 7pt; table-layout: fixed; width: 100%; }
      th { background: #101b34; color: #fff; font-size: 6.5pt; letter-spacing: .2px; text-align: left; text-transform: uppercase; }
      th, td { border: 1px solid #dce1e8; padding: 5px; vertical-align: top; overflow-wrap: anywhere; }
      tbody tr:nth-child(even) { background: #f8fafc; }
      .empty { color: #718096; text-align: center; padding: 14px; }
      .section { break-inside: auto; }
      .page-break { break-before: page; }
      footer { border-top: 1px solid #e2e8f0; color: #8490a0; font-size: 7pt; margin-top: 18px; padding-top: 7px; }
      @media screen { body { margin: 24px auto; max-width: 1120px; padding: 38px; box-shadow: 0 4px 30px #101b3418; } }
    </style></head><body>
      <header><div class="brand">TMM &amp; BMA Advisory · Management Office</div><h1>Executive Summary Tim 3</h1><p class="meta">Periode ${escapeHtml(data.period)} · Dibuat ${escapeHtml(data.generatedAt)} · Data tersimpan ${escapeHtml(data.sourceUpdatedAt)}</p><span class="status">Status tim: ${escapeHtml(data.overallStatus)}</span><p class="scope">${escapeHtml(data.scopeNote)}</p></header>
      <section class="section"><h2>Ikhtisar periode</h2><table><thead><tr><th>Indikator</th><th>Nilai</th><th>Catatan</th></tr></thead><tbody>${metricRows}</tbody></table><h2>Sorotan untuk manajemen</h2><div class="highlights">${data.highlights.length ? data.highlights.map((item) => `<div class="highlight">${escapeHtml(item)}</div>`).join('') : '<div class="highlight">Tidak ada keputusan khusus yang teridentifikasi dari data saat ini.</div>'}</div></section>
      <section class="section page-break"><h2>Portofolio risiko klien</h2><table><thead><tr>${riskColumns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead><tbody>${tableRows(data.risks, riskColumns)}</tbody></table></section>
      <section class="section page-break"><h2>Pekerjaan, kasus, dan tindak lanjut</h2><table><thead><tr>${operationColumns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead><tbody>${tableRows(data.operations, operationColumns)}</tbody></table></section>
      <section class="section page-break"><h2>Agenda mendatang dan bulan terpilih</h2><table><thead><tr>${agendaColumns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead><tbody>${tableRows(data.agenda, agendaColumns)}</tbody></table></section>
      <footer>TMM &amp; BMA Advisory · Dokumen internal · Executive Summary Tim 3</footer>
      <script>window.addEventListener('load', () => setTimeout(() => window.print(), 250));</script>
    </body></html>`);
  printWindow.document.close();
}

export async function exportExecutiveSummaryExcel(data: ExecutiveSummaryExportData) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TMM & BMA Advisory Control Center';
  workbook.created = new Date();

  const addSheet = <T>(
    name: string,
    title: string,
    subtitle: string,
    columns: Array<{ header: string; key: keyof T; width: number }>,
    rows: T[]
  ) => {
    const worksheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 3, showGridLines: false }] });
    worksheet.columns = columns.map((column) => ({ key: String(column.key), width: column.width }));
    worksheet.mergeCells(1, 1, 1, columns.length);
    const titleCell = worksheet.getCell(1, 1);
    titleCell.value = title;
    titleCell.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FF101B34' } };
    worksheet.mergeCells(2, 1, 2, columns.length);
    const subtitleCell = worksheet.getCell(2, 1);
    subtitleCell.value = subtitle;
    subtitleCell.font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF64748B' } };
    const headerRow = worksheet.getRow(3);
    headerRow.values = columns.map((column) => column.header);
    headerRow.height = 26;
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF101B34' } };
      cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = { bottom: { style: 'medium', color: { argb: 'FFD4A64E' } } };
    });
    rows.forEach((row, index) => {
      const nextRow = worksheet.addRow(columns.map((column) => row[column.key] ?? '—'));
      nextRow.height = 32;
      nextRow.eachCell((cell) => {
        cell.font = { name: 'Arial', size: 9, color: { argb: 'FF263246' } };
        cell.alignment = { vertical: 'top', wrapText: true };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
        if (index % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      });
    });
    if (rows.length) worksheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: Math.max(3, rows.length + 3), column: columns.length } };
  };

  const introRows = [
    { metric: 'Periode laporan', value: data.period, note: 'Aktivitas dan agenda menggunakan periode terpilih; risiko adalah snapshot asesmen terkini.' },
    { metric: 'Status tim', value: data.overallStatus, note: 'Status dihitung dari risiko aktif, tenggat terlambat, dan tindak lanjut lewat jadwal.' },
    ...data.metrics,
    ...data.highlights.map((highlight, index) => ({ metric: `Sorotan manajemen ${index + 1}`, value: highlight, note: '' })),
    { metric: 'Cakupan data', value: data.scopeNote, note: `Data terakhir tersimpan ${data.sourceUpdatedAt} · Dibuat ${data.generatedAt}` },
  ];
  addSheet('Ringkasan', 'EXECUTIVE SUMMARY TIM 3', `Periode ${data.period} · Dibuat ${data.generatedAt}`, [
    { header: 'Indikator', key: 'metric', width: 30 },
    { header: 'Nilai / temuan', key: 'value', width: 52 },
    { header: 'Catatan', key: 'note', width: 58 },
  ], introRows);
  addSheet('Risiko Klien', 'PORTOFOLIO RISIKO KLIEN', 'Kategori klien mengikuti level tertinggi dari asesmen Accounting dan Tax yang tersimpan.', [
    { header: 'ID Klien', key: 'clientId', width: 16 },
    { header: 'Klien', key: 'clientName', width: 32 },
    { header: 'Kategori', key: 'overallRisk', width: 14 },
    { header: 'Risiko Accounting', key: 'accountingRisk', width: 16 },
    { header: 'Alasan Accounting', key: 'accountingReason', width: 42 },
    { header: 'Tindakan Accounting', key: 'accountingAction', width: 42 },
    { header: 'PIC Accounting', key: 'accountingSpv', width: 28 },
    { header: 'Review Accounting', key: 'accountingReview', width: 17 },
    { header: 'Risiko Tax', key: 'taxRisk', width: 14 },
    { header: 'Alasan Tax', key: 'taxReason', width: 42 },
    { header: 'Tindakan Tax', key: 'taxAction', width: 42 },
    { header: 'PIC Tax', key: 'taxSpv', width: 28 },
    { header: 'Review Tax', key: 'taxReview', width: 17 },
  ], data.risks);
  addSheet('Operasional', 'PEKERJAAN, KASUS & TINDAK LANJUT', `Prioritas aktif per ${data.generatedAt}`, [
    { header: 'Jenis', key: 'category', width: 18 },
    { header: 'Referensi', key: 'reference', width: 19 },
    { header: 'Klien', key: 'client', width: 30 },
    { header: 'Divisi', key: 'division', width: 16 },
    { header: 'PIC', key: 'owner', width: 26 },
    { header: 'Status', key: 'status', width: 22 },
    { header: 'Tenggat', key: 'deadline', width: 16 },
    { header: 'Ringkasan / tindakan', key: 'summary', width: 50 },
  ], data.operations);
  addSheet('Agenda', 'AGENDA TIM 3', `Agenda pada atau setelah periode ${data.period}`, [
    { header: 'Tanggal', key: 'date', width: 16 },
    { header: 'Waktu', key: 'time', width: 15 },
    { header: 'Agenda', key: 'title', width: 34 },
    { header: 'Jenis', key: 'type', width: 22 },
    { header: 'Divisi', key: 'division', width: 16 },
    { header: 'Klien', key: 'client', width: 30 },
    { header: 'Pekerjaan', key: 'job', width: 32 },
    { header: 'Peserta', key: 'participants', width: 42 },
    { header: 'Lokasi / link', key: 'location', width: 28 },
    { header: 'Status', key: 'status', width: 16 },
  ], data.agenda);

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `Executive_Summary_Tim_3_${data.period.replace(/[^0-9-]/g, '-')}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    window.URL.revokeObjectURL(url);
    anchor.remove();
  }, 1000);
}
