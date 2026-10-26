import { ArrowLeft, CalendarDays, Download, FileSpreadsheet, Printer } from 'lucide-react';
import type { Case, Job } from '../lib/api';
import { exportToExcel } from '../lib/exportUtils';

type ReportItem = Job | Case;

type MonthlySummaryReportProps = {
  title: string;
  kind: 'job' | 'case';
  fromMonth: string;
  toMonth: string;
  completedItems: ReportItem[];
  unfinishedItems: ReportItem[];
  onBack: () => void;
  onOpenItem: (id: string) => void;
};

type ExportRow = {
  kelompok: string;
  judul: string;
  klien: string;
  divisi: string;
  penanggungJawab: string;
  status: string;
  prioritas: string;
  tanggalDibuat: string;
  tenggat: string;
};

function monthLabel(month: string) {
  if (!month) return month;
  const [year, value] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, value - 1, 1)));
}

function toExportRow(item: ReportItem, group: string, kind: 'job' | 'case'): ExportRow {
  return {
    kelompok: group,
    judul: item.title,
    klien: item.clientName,
    divisi: item.division,
    penanggungJawab: kind === 'job' ? (item as Job).picName : (item as Case).picName,
    status: item.status,
    prioritas: item.priority,
    tanggalDibuat: item.createdAt.slice(0, 10),
    tenggat: kind === 'job' ? (item as Job).deadline || '-' : (item as Case).nextFollowUpDate || '-',
  };
}

export function MonthlySummaryReport({
  title,
  kind,
  fromMonth,
  toMonth,
  completedItems,
  unfinishedItems,
  onBack,
  onOpenItem,
}: MonthlySummaryReportProps) {
  const periodLabel = fromMonth === toMonth
    ? monthLabel(fromMonth)
    : `${monthLabel(fromMonth)} – ${monthLabel(toMonth)}`;
  const total = completedItems.length + unfinishedItems.length;
  const exportRows = [
    ...completedItems.map((item) => toExportRow(item, 'Selesai', kind)),
    ...unfinishedItems.map((item) => toExportRow(item, 'Belum selesai', kind)),
  ];

  const handleExportExcel = async () => {
    await exportToExcel({
      filename: `Rekap_${title.replace(/[^a-zA-Z0-9]+/g, '_')}`,
      sheetName: 'Rincian Rekap',
      title: `Rekap ${title}`,
      subtitle: `Periode ${periodLabel} | ${total} item | Selesai ${completedItems.length} | Belum selesai ${unfinishedItems.length}`,
      columns: [
        { header: 'Kelompok', key: 'kelompok', width: 18 },
        { header: kind === 'job' ? 'Pekerjaan' : 'Kasus', key: 'judul', width: 42 },
        { header: 'Klien', key: 'klien', width: 28 },
        { header: 'Divisi', key: 'divisi', width: 16 },
        { header: 'PIC', key: 'penanggungJawab', width: 24 },
        { header: 'Status', key: 'status', width: 22 },
        { header: 'Prioritas', key: 'prioritas', width: 16 },
        { header: 'Tanggal dibuat', key: 'tanggalDibuat', width: 18 },
        { header: kind === 'job' ? 'Tenggat' : 'Tindak lanjut berikutnya', key: 'tenggat', width: 24 },
      ],
      data: exportRows,
    });
  };

  const renderGroup = (groupTitle: string, items: ReportItem[], state: 'completed' | 'unfinished') => (
    <section aria-labelledby={`monthly-report-${state}`} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 sm:px-6">
        <div>
          <h2 id={`monthly-report-${state}`} className={`text-base font-semibold ${state === 'completed' ? 'text-emerald-700' : 'text-amber-700'}`}>{groupTitle}</h2>
          <p className="mt-0.5 text-xs text-slate-500">{items.length} {kind === 'job' ? 'pekerjaan' : 'kasus'}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold tabular-nums ${state === 'completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          {items.length} item
        </span>
      </div>
      {items.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-5 py-3 font-semibold">{kind === 'job' ? 'Nama pekerjaan' : 'Nama kasus'}</th>
                <th scope="col" className="px-4 py-3 font-semibold">Klien / divisi</th>
                <th scope="col" className="px-4 py-3 font-semibold">PIC</th>
                <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                <th scope="col" className="px-4 py-3 font-semibold">{kind === 'job' ? 'Tenggat' : 'Tindak lanjut'}</th>
                <th scope="col" className="px-5 py-3 text-right font-semibold">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item.id} className="transition-colors hover:bg-slate-50/80">
                  <td className="max-w-[22rem] px-5 py-4 align-top">
                    <p className="font-semibold leading-5 text-slate-800">{item.title}</p>
                    <p className="mt-1 text-xs text-slate-500">Dibuat {item.createdAt.slice(0, 10)} · Prioritas {item.priority}</p>
                  </td>
                  <td className="px-4 py-4 align-top">
                    <p className="font-medium text-slate-700">{item.clientName}</p>
                    <p className="mt-1 text-xs text-slate-500">{item.division}</p>
                  </td>
                  <td className="px-4 py-4 align-top text-slate-700">{item.picName || 'Belum ditentukan'}</td>
                  <td className="px-4 py-4 align-top">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${state === 'completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{item.status}</span>
                  </td>
                  <td className="px-4 py-4 align-top text-slate-600">{kind === 'job' ? (item as Job).deadline || 'Belum ditentukan' : (item as Case).nextFollowUpDate || 'Belum ditentukan'}</td>
                  <td className="px-5 py-4 text-right align-top">
                    <button type="button" onClick={() => onOpenItem(item.id)} className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:border-amber-300 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
                      Buka
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-6 py-10 text-center text-sm text-slate-500">Tidak ada {kind === 'job' ? 'pekerjaan' : 'kasus'} pada bagian ini untuk periode terpilih.</p>
      )}
    </section>
  );

  return (
    <div className="monthly-report-print space-y-6">
      <div className="monthly-report-no-print flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
          <ArrowLeft className="size-4" aria-hidden="true" /> Kembali ke dashboard
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={handleExportExcel} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2">
            <FileSpreadsheet className="size-4" aria-hidden="true" /> Ekspor Excel
          </button>
          <button type="button" onClick={() => window.print()} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
            <Printer className="size-4" aria-hidden="true" /> Simpan PDF
          </button>
        </div>
      </div>

      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700">Laporan penyelesaian tugas</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
        <p className="mt-2 flex items-center gap-2 text-sm text-slate-500"><CalendarDays className="size-4" aria-hidden="true" /> Periode {periodLabel}</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-medium text-slate-500">Total item</p><p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{total}</p></div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4"><p className="text-xs font-medium text-emerald-700">Selesai</p><p className="mt-1 text-2xl font-bold tabular-nums text-emerald-800">{completedItems.length}</p></div>
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4"><p className="text-xs font-medium text-amber-700">Belum selesai</p><p className="mt-1 text-2xl font-bold tabular-nums text-amber-800">{unfinishedItems.length}</p></div>
        </div>
      </header>

      {renderGroup('Selesai', completedItems, 'completed')}
      {renderGroup('Belum selesai', unfinishedItems, 'unfinished')}
      <footer className="monthly-report-no-print flex items-center justify-between border-t border-slate-200 pt-4 text-xs text-slate-500">
        <span>Dokumen internal · Rekap berdasarkan status saat ini</span>
        <span className="inline-flex items-center gap-1"><Download className="size-3.5" aria-hidden="true" /> {total} item</span>
      </footer>
    </div>
  );
}
