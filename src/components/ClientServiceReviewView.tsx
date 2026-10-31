import { useMemo, useState } from 'react';
import { Download, RefreshCw, Search, X } from 'lucide-react';
import { api, type Case, type Client, type CurrentUser, type DailyActivity, type Job } from '../lib/api';
import { exportToExcel, type ColumnDef } from '../lib/exportUtils';
import { useToast } from './Toast';

interface Props { clients: Client[]; jobs: Job[]; cases: Case[]; activities: DailyActivity[]; currentUser: CurrentUser; onRefresh: () => void; }
type ReviewRow = { job: Job; client?: Client; activities: DailyActivity[]; cases: Case[]; finding: string; action: string; response: string; note: string; status: string; };

export function ClientServiceReviewView({ clients, jobs, cases, activities, currentUser, onRefresh }: Props) {
  const { success, error } = useToast();
  const [query, setQuery] = useState('');
  const [clientFilter, setClientFilter] = useState('All');
  const [jobFilter, setJobFilter] = useState('All');
  const [divisionFilter, setDivisionFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState('');
  const [saving, setSaving] = useState(false);

  const rows = useMemo<ReviewRow[]>(() => {
    const clientById = new Map(clients.map((client) => [client.id, client]));
    const activitiesByJob = new Map<string, DailyActivity[]>();
    const openCasesByClientDivision = new Map<string, Case[]>();
    for (const activity of activities) {
      if (!activity.jobId) continue;
      const current = activitiesByJob.get(activity.jobId) || [];
      current.push(activity);
      activitiesByJob.set(activity.jobId, current);
    }
    for (const caseItem of cases) {
      if (caseItem.status === 'Closed' || !caseItem.clientId || !caseItem.division) continue;
      const key = `${caseItem.clientId}:${caseItem.division}`;
      const current = openCasesByClientDivision.get(key) || [];
      current.push(caseItem);
      openCasesByClientDivision.set(key, current);
    }
    return jobs.map((job) => {
      const jobActivities = activitiesByJob.get(job.id) || [];
      const latestActivity = jobActivities.reduce<DailyActivity | undefined>((latest, activity) => !latest || activity.date > latest.date ? activity : latest, undefined);
      const jobCases = openCasesByClientDivision.get(`${job.clientId}:${job.division}`) || [];
      return { job, client: clientById.get(job.clientId), activities: jobActivities, cases: jobCases, finding: latestActivity?.obstacles || (job.status === 'Selesai' ? 'Tidak ada pending item' : job.description || 'Review pekerjaan berjalan'), action: latestActivity?.followUp || job.notes || 'Tinjau progres pekerjaan dan tindak lanjut klien', response: latestActivity?.resultProgress || (job.status === 'Menunggu Klien' ? 'Menunggu respons klien' : '-'), note: job.reviewNotes || '-', status: job.status };
    });
  }, [activities, cases, clients, jobs]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredRows = useMemo(() => rows.filter((row) => {
    const text = `${row.job.title} ${row.job.clientName} ${row.job.picName} ${row.finding}`.toLowerCase();
    return (!normalizedQuery || text.includes(normalizedQuery)) && (clientFilter === 'All' || row.job.clientId === clientFilter) && (jobFilter === 'All' || row.job.id === jobFilter) && (divisionFilter === 'All' || row.job.division === divisionFilter) && (statusFilter === 'All' || row.status === statusFilter);
  }), [clientFilter, divisionFilter, jobFilter, normalizedQuery, rows, statusFilter]);
  const selected = rows.find((row) => row.job.id === selectedId);

  const saveReview = async () => {
    if (!selected) return;
    setSaving(true);
    try { await api.updateJob(selected.job.id, { reviewNotes: selectedNote }); success('Review diperbarui', 'Perubahan tersimpan dan kamu tetap berada di Client Service Review.'); onRefresh(); setSelectedId(null); } catch (err: any) { error('Gagal menyimpan', err.message || 'Perubahan tidak dapat disimpan.'); } finally { setSaving(false); }
  };

  const exportColumns: ColumnDef<ReviewRow>[] = [
    { header: 'No', key: 'no', width: 8, align: 'center', render: (row) => filteredRows.indexOf(row) + 1 },
    { header: 'ACCT & TAX', key: 'division', width: 14, align: 'center', render: (row) => row.job.division === 'Accounting' ? 'ACCT' : 'TAX' },
    { header: 'CLIENT / JOB', key: 'job', width: 32, render: (row) => `${row.job.clientName} · ${row.job.title}` },
    { header: 'FINDING / PENDING ITEM', key: 'finding', width: 42 },
    { header: 'DATE', key: 'date', width: 14, align: 'center', render: (row) => row.job.deadline },
    { header: 'INTERNAL ACTION / FOLLOW-UP', key: 'action', width: 42 },
    { header: 'CLIENT RESPONSE', key: 'response', width: 36 },
    { header: 'ADDITIONAL NOTE', key: 'note', width: 28 },
    { header: 'SUCCESSFUL', key: 'status', width: 16, align: 'center', render: (row) => row.status === 'Selesai' ? 'ADA' : 'TIDAK ADA' },
  ];

  return <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-700">Cross-module review</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Client Service Review</h1><p className="mt-1 max-w-2xl text-xs text-slate-500">Satu ruang review untuk pekerjaan, aktivitas harian, case, dan respons klien.</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" onClick={onRefresh} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><RefreshCw className="size-4" /> Segarkan</button><button type="button" onClick={() => exportToExcel({ filename: 'Client_Service_Review', sheetName: 'Monthly Review', title: 'CLIENT SERVICE REVIEW', subtitle: 'Draft konsolidasi pekerjaan dan tindak lanjut', columns: exportColumns, data: filteredRows })} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800"><Download className="size-4" /> Ekspor Excel</button></div>
    </div>
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5"><label className="xl:col-span-2"><span className="mb-1 block text-[11px] font-semibold text-slate-600">Cari klien, pekerjaan, atau temuan</span><div className="relative"><Search className="absolute left-3 top-2.5 size-4 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ketik kata kunci" className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-xs outline-none focus:border-amber-500" /></div></label><FilterSelect label="Klien" value={clientFilter} onChange={setClientFilter} options={[['All','Semua klien'], ...clients.map((client) => [client.id, client.name])]} /><FilterSelect label="Pekerjaan" value={jobFilter} onChange={setJobFilter} options={[['All','Semua pekerjaan'], ...jobs.map((job) => [job.id, job.title])]} /><FilterSelect label="Divisi" value={divisionFilter} onChange={setDivisionFilter} options={[['All','Accounting & Tax'], ['Accounting','Accounting'], ['Tax','Tax']]} /><FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={[['All','Semua status'], ...Array.from(new Set(jobs.map((job) => job.status))).map((status) => [status, status])]} /></div><p className="mt-4 border-t border-slate-100 pt-3 text-[11px] text-slate-500">Menampilkan <strong className="text-slate-800">{filteredRows.length}</strong> dari {rows.length} pekerjaan. Klik “Buka” untuk review tanpa pindah ke Job Management.</p></section>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="min-w-[1100px] w-full text-left text-xs"><thead className="bg-slate-950 text-white"><tr><th className="px-4 py-3">Periode / Klien</th><th className="px-4 py-3">Pekerjaan</th><th className="px-4 py-3">Finding / Pending</th><th className="px-4 py-3">Internal Action</th><th className="px-4 py-3">Respons Klien</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Aksi</th></tr></thead><tbody className="divide-y divide-slate-100">{filteredRows.map((row) => <tr key={row.job.id} className="align-top hover:bg-amber-50/30"><td className="px-4 py-4"><p className="font-semibold text-slate-900">{row.job.clientName}</p><p className="mt-1 text-[10px] text-slate-400">{row.job.division} · Deadline {row.job.deadline}</p></td><td className="px-4 py-4"><p className="font-medium text-slate-800">{row.job.title}</p><p className="mt-1 text-[10px] text-slate-400">PIC: {row.job.picName || '-'}</p></td><td className="max-w-[230px] px-4 py-4 text-slate-600">{row.finding}</td><td className="max-w-[230px] px-4 py-4 text-slate-600">{row.action}</td><td className="max-w-[190px] px-4 py-4 text-slate-600">{row.response}</td><td className="px-4 py-4"><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${row.status === 'Selesai' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{row.status}</span></td><td className="px-4 py-4"><button type="button" onClick={() => { setSelectedId(row.job.id); setSelectedNote(row.note === '-' ? '' : row.note); }} className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:border-amber-400 hover:text-amber-700">Buka</button></td></tr>)}</tbody></table></div>{!filteredRows.length && <div className="p-10 text-center text-sm text-slate-500">Tidak ada pekerjaan sesuai filter.</div>}</section>
    {selected && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-4 sm:items-center"><div role="dialog" aria-modal="true" aria-labelledby="review-detail-title" className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-widest text-amber-700">Review detail</p><h2 id="review-detail-title" className="mt-1 text-lg font-bold text-slate-950">{selected.job.title}</h2><p className="text-xs text-slate-500">{selected.job.clientName} · {selected.job.division} · PIC {selected.job.picName}</p></div><button type="button" onClick={() => setSelectedId(null)} aria-label="Tutup detail" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="size-4" /></button></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><Info label="Finding / Pending Item" value={selected.finding} /><Info label="Internal Action / Follow-up" value={selected.action} /><Info label="Client Response" value={selected.response} /><Info label="Case terbuka terkait" value={`${selected.cases.length} case`} /></div><label className="mt-4 block"><span className="mb-1 block text-xs font-semibold text-slate-700">Additional Note</span><textarea value={selectedNote} onChange={(e) => setSelectedNote(e.target.value)} rows={4} className="w-full rounded-lg border border-slate-200 p-3 text-xs outline-none focus:border-amber-500" placeholder="Tambahkan catatan review..." /></label><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setSelectedId(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700">Batal</button><button type="button" disabled={saving} onClick={saveReview} className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{saving ? 'Menyimpan...' : 'Simpan & kembali ke review'}</button></div></div></div>}
  </div>;
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[][] }) { return <label><span className="mb-1 block text-[11px] font-semibold text-slate-600">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-amber-500">{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 text-xs leading-5 text-slate-700">{value}</p></div>; }
