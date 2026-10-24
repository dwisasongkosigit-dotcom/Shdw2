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
  clientId?: string;
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
  scopeLabel?: string;
  divisionScope?: 'Accounting' | 'Tax' | 'Both';
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

  const metricCards = data.metrics.map((metric) => `<div class="metric"><dt>${escapeHtml(metric.metric)}</dt><dd>${escapeHtml(metric.value)}</dd><small>${escapeHtml(metric.note)}</small></div>`).join('');
  const riskColumns: Array<{ key: keyof RiskExportRow; label: string }> = data.divisionScope === 'Accounting'
    ? [
      { key: 'clientName', label: 'Klien' }, { key: 'overallRisk', label: 'Risiko' },
      { key: 'accountingReason', label: 'Alasan asesmen' }, { key: 'accountingAction', label: 'Tindakan' },
      { key: 'accountingSpv', label: 'SPV' }, { key: 'accountingReview', label: 'Tinjauan' },
    ]
    : data.divisionScope === 'Tax'
      ? [
        { key: 'clientName', label: 'Klien' }, { key: 'overallRisk', label: 'Risiko' },
        { key: 'taxReason', label: 'Alasan asesmen' }, { key: 'taxAction', label: 'Tindakan' },
        { key: 'taxSpv', label: 'SPV' }, { key: 'taxReview', label: 'Tinjauan' },
      ]
      : [
        { key: 'clientName', label: 'Klien' }, { key: 'overallRisk', label: 'Risiko' },
        { key: 'accountingRisk', label: 'Acc.' }, { key: 'accountingReason', label: 'Alasan Accounting' },
        { key: 'accountingAction', label: 'Tindakan Accounting' }, { key: 'accountingSpv', label: 'SPV Accounting' },
        { key: 'taxRisk', label: 'Tax' }, { key: 'taxReason', label: 'Alasan Tax' },
        { key: 'taxAction', label: 'Tindakan Tax' }, { key: 'taxSpv', label: 'SPV Tax' },
      ];
  const operationColumns: Array<{ key: keyof OperationsExportRow; label: string }> = [
    { key: 'category', label: 'Jenis' }, { key: 'reference', label: 'Referensi' },
    { key: 'client', label: 'Klien' }, { key: 'division', label: 'Divisi' },
    { key: 'owner', label: 'PIC' }, { key: 'status', label: 'Status' },
    { key: 'deadline', label: 'Tenggat' }, { key: 'summary', label: 'Ringkasan' },
  ];
  const agendaColumns: Array<{ key: keyof AgendaExportRow; label: string }> = [
    { key: 'date', label: 'Tanggal' }, { key: 'time', label: 'Waktu' },
    { key: 'title', label: 'Agenda' }, { key: 'type', label: 'Jenis' },
    { key: 'division', label: 'Divisi' }, { key: 'client', label: 'Klien' },
    { key: 'participants', label: 'Peserta' }, { key: 'location', label: 'Lokasi' },
    { key: 'status', label: 'Status' },
  ];
  const orientation = data.divisionScope === 'Both' ? 'landscape' : 'portrait';
  const highlights = data.highlights.map((item) => `<li>${escapeHtml(item)}</li>`).join('') || '<li>Tidak ada sorotan khusus pada cakupan ini.</li>';
  const footer = `<footer>${escapeHtml(data.scopeLabel || 'Executive Summary')}　·　Dokumen internal　·　TMM &amp; BMA Advisory</footer>`;

  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
    <html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Executive Summary · ${escapeHtml(data.period)}</title>
    <style>
      @page { size: A4 ${orientation}; margin: 16mm; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #263246; font: 9pt/1.55 Arial, sans-serif; }
      header { border-bottom: 2px solid #d4a64e; padding: 0 0 17px; }
      .brand { color: #a66a12; font-size: 8pt; font-weight: 700; letter-spacing: 1.8px; text-transform: uppercase; }
      h1 { color: #101b34; font-size: 25pt; line-height: 1.15; margin: 12px 0 5px; }
      .subtitle { color: #64748b; font-size: 9pt; margin: 0; }
      .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 20px; margin: 16px 0 0; padding: 13px 15px; background: #f7f8fa; border: 1px solid #e2e8f0; border-radius: 8px; }
      .meta dt, .metric dt { color: #7c8797; font-size: 7pt; font-weight: 700; letter-spacing: .7px; margin: 0 0 3px; text-transform: uppercase; }
      .meta dd { color: #263246; font-size: 9pt; font-weight: 600; margin: 0; }
      .status { display: inline-block; border: 1px solid #d6dee8; border-radius: 20px; color: #344256; font-size: 8pt; font-weight: 700; margin-top: 13px; padding: 4px 10px; }
      .scope { background: #fbf6eb; border-left: 2px solid #c28a2c; color: #536175; font-size: 8pt; margin: 11px 0 0; padding: 8px 10px; }
      h2 { border-bottom: 1px solid #dce1e8; color: #101b34; font-size: 13pt; margin: 24px 0 12px; padding-bottom: 7px; }
      h2 span { color: #a66a12; font-size: 8pt; letter-spacing: 1px; margin-right: 8px; }
      .metrics { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 8px; }
      .metric { break-inside: avoid; border: 1px solid #e2e8f0; border-radius: 7px; min-height: 78px; padding: 10px; }
      .metric dd { color: #101b34; font-size: 18pt; font-weight: 700; margin: 4px 0 2px; }
      .metric small { color: #778396; display: block; font-size: 7pt; line-height: 1.4; }
      .highlights { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin: 0; padding: 12px 15px 12px 28px; }
      .highlights li { margin: 4px 0; padding-left: 2px; }
      table { border-collapse: collapse; font-size: 7.5pt; table-layout: fixed; width: 100%; }
      th { background: #101b34; color: #fff; font-size: 7pt; letter-spacing: .3px; text-align: left; text-transform: uppercase; }
      th, td { border: 1px solid #dce1e8; padding: 6px; vertical-align: top; overflow-wrap: anywhere; }
      tbody tr:nth-child(even) { background: #f8fafc; }
      .empty { color: #718096; text-align: center; padding: 16px; }
      .section { break-inside: auto; }
      .page-break { break-before: page; }
      tr { break-inside: avoid; }
      footer { border-top: 1px solid #e2e8f0; color: #8490a0; font-size: 7pt; margin-top: 24px; padding-top: 8px; }
      @media screen { body { margin: 20px auto; max-width: ${orientation === 'landscape' ? '1120px' : '780px'}; padding: 40px 48px; box-shadow: 0 4px 30px #101b3418; } }
      @media print { .section { break-inside: auto; } }
    </style></head><body>
      <header><div class="brand">TMM &amp; BMA Advisory · Management Office</div><h1>Executive Summary</h1><p class="subtitle">Periode ${escapeHtml(data.period)} · ${escapeHtml(data.scopeLabel || 'Semua cakupan')}</p><span class="status">Status: ${escapeHtml(data.overallStatus)}</span><dl class="meta"><div><dt>Periode laporan</dt><dd>${escapeHtml(data.period)}</dd></div><div><dt>Dibuat pada</dt><dd>${escapeHtml(data.generatedAt)}</dd></div><div><dt>Data terakhir tersimpan</dt><dd>${escapeHtml(data.sourceUpdatedAt)}</dd></div><div><dt>Cakupan</dt><dd>${escapeHtml(data.scopeLabel || 'Semua cakupan')}</dd></div></dl><p class="scope">${escapeHtml(data.scopeNote)}</p></header>
      <section class="section"><h2><span>01</span>Ikhtisar periode</h2><dl class="metrics">${metricCards}</dl><h2><span>02</span>Sorotan untuk manajemen</h2><ul class="highlights">${highlights}</ul></section>
      <section class="section page-break"><h2><span>03</span>Portofolio risiko klien</h2><table><thead><tr>${riskColumns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead><tbody>${tableRows(data.risks, riskColumns)}</tbody></table></section>
      <section class="section page-break"><h2><span>04</span>Pekerjaan, kasus, dan tindak lanjut</h2><table><thead><tr>${operationColumns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead><tbody>${tableRows(data.operations, operationColumns)}</tbody></table></section>
      <section class="section page-break"><h2><span>05</span>Agenda meeting</h2><table><thead><tr>${agendaColumns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead><tbody>${tableRows(data.agenda, agendaColumns)}</tbody></table>${footer}</section>
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
    { metric: 'Cakupan laporan', value: data.scopeLabel || 'Semua cakupan', note: data.scopeNote },
    { metric: 'Periode laporan', value: data.period, note: 'Aktivitas dan agenda menggunakan periode terpilih; risiko adalah snapshot asesmen terkini.' },
    { metric: 'Status laporan', value: data.overallStatus, note: 'Status mengikuti risiko, tenggat terlambat, dan tindak lanjut pada cakupan terpilih.' },
    ...data.metrics,
    ...data.highlights.map((highlight, index) => ({ metric: `Sorotan manajemen ${index + 1}`, value: highlight, note: '' })),
    { metric: 'Cakupan data', value: data.scopeNote, note: `Data terakhir tersimpan ${data.sourceUpdatedAt} · Dibuat ${data.generatedAt}` },
  ];
  addSheet('Ringkasan', `EXECUTIVE SUMMARY · ${data.scopeLabel || 'Semua cakupan'}`, `Periode ${data.period} · Dibuat ${data.generatedAt}`, [
    { header: 'Indikator', key: 'metric', width: 30 },
    { header: 'Nilai / temuan', key: 'value', width: 52 },
    { header: 'Catatan', key: 'note', width: 58 },
  ], introRows);
  const riskColumns: Array<{ header: string; key: keyof RiskExportRow; width: number }> = data.divisionScope === 'Accounting'
    ? [
      { header: 'ID Klien', key: 'clientId', width: 16 }, { header: 'Klien', key: 'clientName', width: 32 },
      { header: 'Risiko Accounting', key: 'overallRisk', width: 18 }, { header: 'Alasan', key: 'accountingReason', width: 42 },
      { header: 'Tindakan', key: 'accountingAction', width: 42 }, { header: 'PIC SPV', key: 'accountingSpv', width: 28 },
      { header: 'Tanggal Review', key: 'accountingReview', width: 17 },
    ]
    : data.divisionScope === 'Tax'
      ? [
        { header: 'ID Klien', key: 'clientId', width: 16 }, { header: 'Klien', key: 'clientName', width: 32 },
        { header: 'Risiko Tax', key: 'overallRisk', width: 18 }, { header: 'Alasan', key: 'taxReason', width: 42 },
        { header: 'Tindakan', key: 'taxAction', width: 42 }, { header: 'PIC SPV', key: 'taxSpv', width: 28 },
        { header: 'Tanggal Review', key: 'taxReview', width: 17 },
      ]
      : [
        { header: 'ID Klien', key: 'clientId', width: 16 }, { header: 'Klien', key: 'clientName', width: 32 },
        { header: 'Kategori', key: 'overallRisk', width: 14 }, { header: 'Risiko Accounting', key: 'accountingRisk', width: 16 },
        { header: 'Alasan Accounting', key: 'accountingReason', width: 42 }, { header: 'Tindakan Accounting', key: 'accountingAction', width: 42 },
        { header: 'PIC Accounting', key: 'accountingSpv', width: 28 }, { header: 'Review Accounting', key: 'accountingReview', width: 17 },
        { header: 'Risiko Tax', key: 'taxRisk', width: 14 }, { header: 'Alasan Tax', key: 'taxReason', width: 42 },
        { header: 'Tindakan Tax', key: 'taxAction', width: 42 }, { header: 'PIC Tax', key: 'taxSpv', width: 28 },
        { header: 'Review Tax', key: 'taxReview', width: 17 },
      ];
  addSheet('Risiko Klien', 'PORTOFOLIO RISIKO KLIEN', `Cakupan risiko: ${data.scopeLabel || 'semua divisi'}.`, riskColumns, data.risks);
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
  addSheet('Agenda', 'AGENDA MEETING', `Agenda selama periode ${data.period}`, [
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
  const safeScope = (data.scopeLabel || 'Semua_Cakupan').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_|_$/g, '');
  anchor.download = `Executive_Summary_${safeScope}_${data.period.replace(/[^0-9-]/g, '-')}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    window.URL.revokeObjectURL(url);
    anchor.remove();
  }, 1000);
}
