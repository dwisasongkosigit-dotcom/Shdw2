import { useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, ClipboardCheck, Clock3, LockKeyhole, Search, Send } from 'lucide-react';
import {
  api,
  type CurrentUser,
  type Job,
  type JobHandoverDirection,
  type JobHandoverRecord,
  type Client,
} from '../lib/api';
import { useToast } from './Toast';

interface HandoverViewProps {
  jobs: Job[];
  clients: Client[];
  records: JobHandoverRecord[];
  currentUser: CurrentUser;
  onRefresh: () => void | Promise<void>;
}

const HANDOVER_OPTIONS: Array<{
  direction: JobHandoverDirection;
  label: string;
  helper: string;
  taxOnly?: boolean;
}> = [
  { direction: 'staff-to-client', label: 'Staff → Klien', helper: 'Konfirmasi laporan staff/PIC telah sampai ke klien.' },
  { direction: 'spv-to-client', label: 'SPV → Klien', helper: 'Konfirmasi laporan SPV telah sampai ke klien.' },
  { direction: 'tax-to-accounting', label: 'Tim Tax → Accounting', helper: 'Konfirmasi data tim Tax telah diserahkan ke Accounting.', taxOnly: true },
  { direction: 'tax-to-client', label: 'Tim Tax → Klien', helper: 'Konfirmasi data tim Tax telah disampaikan kepada klien.', taxOnly: true },
];

function canViewJob(job: Job, currentUser: CurrentUser) {
  if (currentUser.role === 'Admin' || currentUser.role === 'Owner' || currentUser.role === 'Manager') return true;
  if (currentUser.role === `Staff ${job.division}`) return job.picId === currentUser.id;
  if (currentUser.role === `SPV ${job.division}`) return job.spvId === currentUser.id;
  return false;
}

function canRecordDirection(job: Job, direction: JobHandoverDirection, currentUser: CurrentUser) {
  if (job.status !== 'Selesai') return false;
  const isTaxDirection = direction === 'tax-to-accounting' || direction === 'tax-to-client';
  if (isTaxDirection && job.division !== 'Tax') return false;
  if (currentUser.role === 'Admin') return true;
  if (direction === 'staff-to-client') {
    return currentUser.role === `Staff ${job.division}` && job.picId === currentUser.id;
  }
  if (direction === 'spv-to-client') {
    return currentUser.role === `SPV ${job.division}` && job.spvId === currentUser.id;
  }
  if (job.division !== 'Tax') return false;
  return (
    (currentUser.role === 'Staff Tax' && job.picId === currentUser.id) ||
    (currentUser.role === 'SPV Tax' && job.spvId === currentUser.id)
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function HandoverView({ jobs, clients, records, currentUser, onRefresh }: HandoverViewProps) {
  const { success, error } = useToast();
  const [clientFilter, setClientFilter] = useState('All');
  const [directionFilter, setDirectionFilter] = useState<'All' | JobHandoverDirection>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | 'review' | 'handover' | 'complete'>('All');
  const [periodFilter, setPeriodFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [newlySavedRecords, setNewlySavedRecords] = useState<JobHandoverRecord[]>([]);

  const visibleJobs = useMemo(() => jobs.filter((job) => canViewJob(job, currentUser)), [jobs, currentUser]);
  const visibleJobIds = useMemo(() => new Set(visibleJobs.map((job) => job.id)), [visibleJobs]);
  const visibleRecords = useMemo(() => {
    const byId = new Map<string, JobHandoverRecord>();
    [...records, ...newlySavedRecords].forEach((record) => {
      if (visibleJobIds.has(record.jobId)) byId.set(record.id, record);
    });
    return [...byId.values()];
  }, [records, newlySavedRecords, visibleJobIds]);
  const recordByKey = useMemo(
    () => new Map(visibleRecords.map((record) => [`${record.jobId}:${record.direction}`, record])),
    [visibleRecords]
  );
  const availablePeriods = useMemo(() => {
    const periods = new Set<string>();
    visibleJobs.forEach((job) => {
      if (job.completedAt) periods.add(job.completedAt.slice(0, 7));
    });
    visibleRecords.forEach((record) => periods.add(record.sentAt.slice(0, 7)));
    return [...periods].filter(Boolean).sort((a, b) => b.localeCompare(a));
  }, [visibleJobs, visibleRecords]);

  const filteredJobs = useMemo(() => visibleJobs.filter((job) => {
    if (clientFilter !== 'All' && job.clientId !== clientFilter) return false;
    const selectedDirection = HANDOVER_OPTIONS.find((option) => option.direction === directionFilter);
    if (selectedDirection?.taxOnly && job.division !== 'Tax') return false;
    const query = searchTerm.trim().toLocaleLowerCase('id-ID');
    if (query && ![job.id, job.title, job.clientName, job.picName, job.spvName].some((value) => value.toLocaleLowerCase('id-ID').includes(query))) return false;
    const jobOptions = HANDOVER_OPTIONS.filter((option) => !option.taxOnly || job.division === 'Tax');
    const jobRecords = jobOptions.map((option) => recordByKey.get(`${job.id}:${option.direction}`));
    const completedHandoverCount = jobRecords.filter(Boolean).length;
    if (statusFilter === 'review' && job.status === 'Selesai') return false;
    if (statusFilter === 'handover' && (job.status !== 'Selesai' || completedHandoverCount === jobOptions.length)) return false;
    if (statusFilter === 'complete' && (job.status !== 'Selesai' || completedHandoverCount !== jobOptions.length)) return false;
    if (periodFilter !== 'All') {
      const hasPeriod = job.completedAt?.startsWith(periodFilter) || jobRecords.some((record) => record?.sentAt.startsWith(periodFilter));
      if (!hasPeriod) return false;
    }
    return true;
  }).sort((a, b) => (b.completedAt || b.updatedAt || b.createdAt).localeCompare(a.completedAt || a.updatedAt || a.createdAt)), [
    visibleJobs,
    clientFilter,
    directionFilter,
    searchTerm,
    recordByKey,
    statusFilter,
    periodFilter,
  ]);

  const pendingReviewCount = visibleJobs.filter((job) => job.status !== 'Selesai').length;
  const pendingHandoverCount = visibleJobs.reduce((total, job) => {
    if (job.status !== 'Selesai') return total;
    return total + HANDOVER_OPTIONS.filter((option) => (!option.taxOnly || job.division === 'Tax') && !recordByKey.has(`${job.id}:${option.direction}`)).length;
  }, 0);

  const handleRecordHandover = async (job: Job, direction: JobHandoverDirection) => {
    const key = `${job.id}:${direction}`;
    if (savingKey || job.status !== 'Selesai' || recordByKey.has(key) || !canRecordDirection(job, direction, currentUser)) return;
    setSavingKey(key);
    try {
      const response = await api.recordJobHandover(job.id, direction);
      setNewlySavedRecords((previous) => [...previous.filter((record) => record.id !== response.record.id), response.record]);
      success('Serah Terima Dicatat', `${response.message} ${formatDate(response.record.sentAt)} · ${response.record.sentByName}.`);
      await onRefresh();
    } catch (err: any) {
      error('Gagal Mencatat Serah Terima', err.message || 'Periksa koneksi lalu coba kembali.');
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <section className="flex flex-col gap-5" aria-labelledby="handover-page-title">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
            <ClipboardCheck className="size-5" />
          </div>
          <div>
            <h1 id="handover-page-title" className="text-lg font-bold tracking-tight text-slate-900">Rekap Serah Terima</h1>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-600">Catat laporan yang benar-benar dikirim ke klien atau diserahkan antar divisi. Review selesai tidak otomatis menandai laporan sudah terkirim.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:min-w-64">
          <div className="rounded-xl border border-amber-100 bg-amber-50/70 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">Menunggu Review</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{pendingReviewCount}</p>
          </div>
          <div className="rounded-xl border border-sky-100 bg-sky-50/70 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-800">Checklist Terbuka</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{pendingHandoverCount}</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="relative sm:col-span-2 xl:col-span-1">
            <span className="sr-only">Cari job, klien, PIC, atau reviewer</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Cari job atau klien..." className="min-h-11 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs text-slate-900 outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-100" />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Klien
            <select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)} className="min-h-11 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium normal-case tracking-normal text-slate-700 outline-none focus:border-amber-500">
              <option value="All">Semua Klien</option>
              {clients.slice().sort((a, b) => a.name.localeCompare(b.name)).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Status
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="min-h-11 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium normal-case tracking-normal text-slate-700 outline-none focus:border-amber-500">
              <option value="All">Semua Status</option>
              <option value="review">Menunggu Review SPV</option>
              <option value="handover">Perlu Serah Terima</option>
              <option value="complete">Serah Terima Lengkap</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Periode
            <select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)} className="min-h-11 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium normal-case tracking-normal text-slate-700 outline-none focus:border-amber-500">
              <option value="All">Semua Periode</option>
              {availablePeriods.map((period) => <option key={period} value={period}>{new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date(`${period}-01T00:00:00`))}</option>)}
            </select>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Tujuan</span>
          <button type="button" aria-pressed={directionFilter === 'All'} onClick={() => setDirectionFilter('All')} className={`min-h-9 rounded-full px-3 text-[11px] font-semibold transition-colors ${directionFilter === 'All' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>Semua</button>
          {HANDOVER_OPTIONS.map((option) => (
            <button key={option.direction} type="button" aria-pressed={directionFilter === option.direction} onClick={() => setDirectionFilter(option.direction)} className={`min-h-9 rounded-full px-3 text-[11px] font-semibold transition-colors ${directionFilter === option.direction ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-300' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
              {option.label}
            </button>
          ))}
          <span className="ml-auto text-[11px] tabular-nums text-slate-400">{filteredJobs.length} job</span>
        </div>
      </div>

      <div className="space-y-3">
        {filteredJobs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center">
            <ClipboardCheck className="mx-auto size-8 text-slate-300" />
            <h2 className="mt-3 text-sm font-semibold text-slate-800">Tidak ada job yang cocok</h2>
            <p className="mt-1 text-xs text-slate-500">Ubah filter klien, tujuan, periode, atau pencarian.</p>
          </div>
        ) : filteredJobs.map((job) => {
          const options = HANDOVER_OPTIONS.filter((option) => (!option.taxOnly || job.division === 'Tax') && (directionFilter === 'All' || option.direction === directionFilter));
          const doneCount = options.filter((option) => recordByKey.has(`${job.id}:${option.direction}`)).length;
          const isReviewed = job.status === 'Selesai';
          return (
            <article key={job.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] font-bold text-slate-500">{job.id}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${job.division === 'Tax' ? 'bg-amber-50 text-amber-800' : 'bg-sky-50 text-sky-800'}`}>{job.division}</span>
                    {isReviewed ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800"><CheckCircle2 className="size-3" /> Review selesai</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600"><LockKeyhole className="size-3" /> Menunggu review SPV</span>
                    )}
                  </div>
                  <h2 className="mt-1.5 truncate text-sm font-bold text-slate-900">{job.title}</h2>
                  <p className="mt-1 truncate text-xs text-slate-600">{job.clientName} <span className="px-1 text-slate-300">·</span> PIC {job.picName} <span className="px-1 text-slate-300">·</span> SPV {job.spvName}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-[11px] text-slate-500">
                  {isReviewed ? <><Clock3 className="size-3.5" /><span>Review: {job.completedAt ? formatDate(job.completedAt) : 'Selesai'}</span></> : <><LockKeyhole className="size-3.5" /><span>Checklist terkunci</span></>}
                </div>
              </div>

              <div className="divide-y divide-slate-100">
                {options.length === 0 ? (
                  <p className="px-5 py-4 text-xs text-slate-500">Tidak ada tujuan serah terima untuk divisi ini.</p>
                ) : options.map((option) => {
                  const record = recordByKey.get(`${job.id}:${option.direction}`);
                  const canRecord = canRecordDirection(job, option.direction, currentUser);
                  const key = `${job.id}:${option.direction}`;
                  const disabled = !isReviewed || Boolean(record) || !canRecord || Boolean(savingKey);
                  return (
                    <label key={option.direction} className={`flex items-start gap-3 px-4 py-3.5 transition-colors sm:px-5 ${disabled ? 'cursor-default' : 'cursor-pointer hover:bg-amber-50/50'}`}>
                      <input type="checkbox" checked={Boolean(record)} disabled={disabled} onChange={(event) => { if (event.target.checked) void handleRecordHandover(job, option.direction); }} aria-label={`Catat ${option.label} untuk ${job.title}`} className="mt-0.5 size-4 shrink-0 accent-amber-600 disabled:cursor-not-allowed" />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-800">
                          {option.label}<ArrowRight className="size-3 text-slate-400" />
                          {record ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">Terkirim</span> : !isReviewed ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">Aktif setelah review</span> : !canRecord ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">Menunggu pengirim yang ditugaskan</span> : savingKey === key ? <span className="text-[10px] text-amber-700">Menyimpan...</span> : <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700"><Send className="size-3" /> Konfirmasi pengiriman</span>}
                        </span>
                        <span className="mt-1 block text-[11px] leading-4 text-slate-500">{record ? `${formatDate(record.sentAt)} · Dicatat oleh ${record.sentByName} (${record.sentByRole})` : option.helper}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {isReviewed && options.length > 0 && (
                <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/70 px-4 py-2.5 text-[10px] text-slate-500 sm:px-5">
                  <span>{doneCount} dari {options.length} tujuan dicatat</span>
                  <span>{doneCount === options.length ? 'Serah terima lengkap' : 'Tanggal dan pengirim tersimpan otomatis saat dicentang'}</span>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
