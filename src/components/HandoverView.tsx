import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Ban, CheckCircle2, ClipboardCheck, Clock3, LockKeyhole, Search, Send, Undo2, X } from 'lucide-react';
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

function canCancelHandover(job: Job, record: JobHandoverRecord, currentUser: CurrentUser) {
  return currentUser.role === 'Admin' ||
    record.sentById === currentUser.id ||
    (currentUser.role === `SPV ${job.division}` && job.spvId === currentUser.id);
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
  const [cancelTarget, setCancelTarget] = useState<{ job: Job; record: JobHandoverRecord } | null>(null);
  const [cancelingRecordId, setCancelingRecordId] = useState<string | null>(null);
  const cancelDialogRef = useRef<HTMLDialogElement>(null);
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
  const recordByKey = useMemo(() => {
    const activeRecords = visibleRecords.filter((record) => !record.canceledAt);
    return new Map(activeRecords.map((record) => [`${record.jobId}:${record.direction}`, record]));
  }, [visibleRecords]);
  const canceledRecordByKey = useMemo(() => {
    const canceledRecords = visibleRecords
      .filter((record) => record.canceledAt)
      .sort((a, b) => (a.canceledAt || '').localeCompare(b.canceledAt || ''));
    return new Map(canceledRecords.map((record) => [`${record.jobId}:${record.direction}`, record]));
  }, [visibleRecords]);
  const availablePeriods = useMemo(() => {
    const periods = new Set<string>();
    visibleJobs.forEach((job) => {
      periods.add(job.createdAt.slice(0, 7));
      if (job.completedAt) periods.add(job.completedAt.slice(0, 7));
    });
    visibleRecords.forEach((record) => {
      periods.add(record.sentAt.slice(0, 7));
      if (record.canceledAt) periods.add(record.canceledAt.slice(0, 7));
    });
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
      const hasActiveRecordInPeriod = jobRecords.some((record) => record?.sentAt.startsWith(periodFilter));
      const hasCanceledRecordInPeriod = HANDOVER_OPTIONS.some((option) => {
        const record = canceledRecordByKey.get(`${job.id}:${option.direction}`);
        return record && (record.sentAt.startsWith(periodFilter) || record.canceledAt?.startsWith(periodFilter));
      });
      if (!job.createdAt.startsWith(periodFilter) && !job.completedAt?.startsWith(periodFilter) && !hasActiveRecordInPeriod && !hasCanceledRecordInPeriod) return false;
    }
    return true;
  }).sort((a, b) => (b.completedAt || b.updatedAt || b.createdAt).localeCompare(a.completedAt || a.updatedAt || a.createdAt)), [
    visibleJobs,
    clientFilter,
    directionFilter,
    searchTerm,
    recordByKey,
    canceledRecordByKey,
    statusFilter,
    periodFilter,
  ]);

  const summaryJobs = useMemo(() => visibleJobs.filter((job) => {
    if (clientFilter !== 'All' && job.clientId !== clientFilter) return false;
    const selectedDirection = HANDOVER_OPTIONS.find((option) => option.direction === directionFilter);
    if (selectedDirection?.taxOnly && job.division !== 'Tax') return false;
    const query = searchTerm.trim().toLocaleLowerCase('id-ID');
    if (query && ![job.id, job.title, job.clientName, job.picName, job.spvName].some((value) => value.toLocaleLowerCase('id-ID').includes(query))) return false;
    if (periodFilter !== 'All') {
      const hasPeriod = job.createdAt.startsWith(periodFilter) || job.completedAt?.startsWith(periodFilter) || visibleRecords.some((record) =>
        record.jobId === job.id && (record.sentAt.startsWith(periodFilter) || record.canceledAt?.startsWith(periodFilter))
      );
      if (!hasPeriod) return false;
    }
    return true;
  }), [visibleJobs, clientFilter, directionFilter, searchTerm, periodFilter, visibleRecords]);
  const summaryJobIds = useMemo(() => new Set(summaryJobs.map((job) => job.id)), [summaryJobs]);
  const summaryRecords = visibleRecords.filter((record) => {
    if (!summaryJobIds.has(record.jobId)) return false;
    if (directionFilter !== 'All' && record.direction !== directionFilter) return false;
    return true;
  });
  const activeSummaryRecords = summaryRecords.filter((record) =>
    !record.canceledAt && (periodFilter === 'All' || record.sentAt.startsWith(periodFilter))
  );
  const canceledSummaryRecords = summaryRecords.filter((record) =>
    record.canceledAt && (periodFilter === 'All' || record.canceledAt.startsWith(periodFilter))
  );
  const pendingReviewCount = summaryJobs.filter((job) => job.status !== 'Selesai').length;
  const pendingHandoverCount = summaryJobs.reduce((total, job) => {
    if (job.status !== 'Selesai') return total;
    return total + HANDOVER_OPTIONS.filter((option) =>
      (!option.taxOnly || job.division === 'Tax') &&
      (directionFilter === 'All' || option.direction === directionFilter) &&
      !recordByKey.has(`${job.id}:${option.direction}`)
    ).length;
  }, 0);
  const directionSummary = HANDOVER_OPTIONS
    .filter((option) => directionFilter === 'All' || option.direction === directionFilter)
    .filter((option) => !option.taxOnly || summaryJobs.some((job) => job.division === 'Tax'))
    .map((option) => ({
      ...option,
      count: activeSummaryRecords.filter((record) => record.direction === option.direction).length,
    }));

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

  const handleCancelHandover = async () => {
    if (!cancelTarget || cancelingRecordId) return;
    const { job, record } = cancelTarget;
    setCancelingRecordId(record.id);
    try {
      const response = await api.cancelJobHandover(job.id, record.id);
      setNewlySavedRecords((previous) => [...previous.filter((item) => item.id !== response.record.id), response.record]);
      success('Catatan Dibatalkan', `${response.message} ${formatDate(response.record.canceledAt || '')} · ${response.record.canceledByName}.`);
      setCancelTarget(null);
      await onRefresh();
    } catch (err: any) {
      error('Gagal Membatalkan Catatan', err.message || 'Periksa koneksi lalu coba kembali.');
    } finally {
      setCancelingRecordId(null);
    }
  };

  useEffect(() => {
    const dialog = cancelDialogRef.current;
    if (!cancelTarget || !dialog || dialog.open) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [cancelTarget]);

  return (
    <>
    <section className="flex flex-col gap-5" aria-labelledby="handover-page-title">
      <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
          <ClipboardCheck className="size-5" />
        </div>
        <div>
          <h1 id="handover-page-title" className="text-lg font-bold tracking-tight text-slate-900">Rekap Serah Terima</h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-600">Catat laporan yang benar-benar dikirim ke klien atau diserahkan antar divisi. Review selesai tidak otomatis menandai laporan sudah terkirim.</p>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="handover-summary-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="handover-summary-title" className="text-sm font-bold text-slate-900">Ringkasan Rekap</h2>
            <p className="mt-1 text-[11px] text-slate-500">Mengikuti filter klien, periode, dan tujuan yang dipilih.</p>
          </div>
          <span className="text-[10px] font-medium text-slate-400">{summaryJobs.length} job dalam cakupan</span>
        </div>
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">Terkirim / Diserahkan</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{activeSummaryRecords.length}</p>
          </div>
          <div className="rounded-xl border border-sky-100 bg-sky-50/60 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-800">Checklist Terbuka</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{pendingHandoverCount}</p>
          </div>
          <div className="rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">Menunggu Review</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{pendingReviewCount}</p>
          </div>
          <div className="rounded-xl border border-rose-100 bg-rose-50/60 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-rose-800">Catatan Dibatalkan</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{canceledSummaryRecords.length}</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 xl:grid-cols-4">
          {directionSummary.map((item) => (
            <div key={item.direction} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
              <span className="truncate text-[11px] font-medium text-slate-600">{item.label}</span>
              <span className="shrink-0 text-sm font-bold tabular-nums text-slate-900">{item.count}</span>
            </div>
          ))}
        </div>
      </section>

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
                  const key = `${job.id}:${option.direction}`;
                  const record = recordByKey.get(key);
                  const canceledRecord = canceledRecordByKey.get(key);
                  const canRecord = canRecordDirection(job, option.direction, currentUser);
                  const canCancel = Boolean(record && canCancelHandover(job, record, currentUser));
                  const disabled = !isReviewed || Boolean(record) || !canRecord || Boolean(savingKey);
                  const checkboxId = `handover-${job.id}-${option.direction}`;
                  return (
                    <div key={option.direction} className="flex items-start gap-3 px-4 py-3.5 transition-colors sm:px-5">
                      <input id={checkboxId} type="checkbox" checked={Boolean(record)} disabled={disabled} onChange={(event) => { if (event.target.checked) void handleRecordHandover(job, option.direction); }} aria-label={`Catat ${option.label} untuk ${job.title}`} className="mt-0.5 size-4 shrink-0 accent-amber-600 disabled:cursor-not-allowed" />
                      <div className="min-w-0 flex-1">
                        <label htmlFor={checkboxId} className={`flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-800 ${disabled ? 'cursor-default' : 'cursor-pointer'}`}>
                          {option.label}<ArrowRight className="size-3 text-slate-400" />
                          {record ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">Terkirim</span> : canceledRecord ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-800">Dibatalkan · bisa dicatat ulang</span> : !isReviewed ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">Aktif setelah review</span> : !canRecord ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">Menunggu pengirim yang ditugaskan</span> : savingKey === key ? <span className="text-[10px] text-amber-700">Menyimpan...</span> : <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700"><Send className="size-3" /> Konfirmasi pengiriman</span>}
                        </label>
                        <p className="mt-1 text-[11px] leading-4 text-slate-500">
                          {record
                            ? `${formatDate(record.sentAt)} · Dicatat oleh ${record.sentByName} (${record.sentByRole})`
                            : canceledRecord
                              ? `${formatDate(canceledRecord.sentAt)} · Awalnya dicatat oleh ${canceledRecord.sentByName}; dibatalkan ${formatDate(canceledRecord.canceledAt || '')} oleh ${canceledRecord.canceledByName || 'pengguna'}.`
                              : option.helper}
                        </p>
                        {record && canCancel && (
                          <button type="button" onClick={() => setCancelTarget({ job, record })} disabled={Boolean(cancelingRecordId)} className="mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-rose-200 px-2.5 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50">
                            <Undo2 className="size-3.5" /> Batalkan catatan
                          </button>
                        )}
                      </div>
                    </div>
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

    <dialog
      ref={cancelDialogRef}
      aria-labelledby="cancel-handover-title"
      aria-describedby="cancel-handover-description"
      onCancel={(event) => {
        event.preventDefault();
        setCancelTarget(null);
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-transparent p-0 text-slate-900 shadow-none backdrop:bg-slate-950/60 backdrop:backdrop-blur-sm"
    >
      {cancelTarget && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-700">
              <Ban className="size-5" />
            </div>
            <button type="button" aria-label="Tutup dialog" onClick={() => setCancelTarget(null)} disabled={Boolean(cancelingRecordId)} className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50">
              <X className="size-4" />
            </button>
          </div>
          <h2 id="cancel-handover-title" className="mt-4 text-base font-bold text-slate-900">Batalkan catatan serah terima?</h2>
          <p id="cancel-handover-description" className="mt-2 text-sm leading-6 text-slate-600">
            Catatan {HANDOVER_OPTIONS.find((option) => option.direction === cancelTarget.record.direction)?.label} untuk <span className="font-semibold text-slate-800">{cancelTarget.job.title}</span> akan ditandai dibatalkan. Riwayat pengiriman awal tetap tersimpan.
          </p>
          <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-600">
            Dicatat oleh {cancelTarget.record.sentByName} pada {formatDate(cancelTarget.record.sentAt)}. Pembatalan akan mencatat nama dan waktu Anda.
          </div>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setCancelTarget(null)} disabled={Boolean(cancelingRecordId)} className="min-h-10 rounded-lg border border-slate-200 px-4 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">
              Kembali
            </button>
            <button type="button" onClick={() => void handleCancelHandover()} disabled={Boolean(cancelingRecordId)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-rose-700 px-4 text-xs font-semibold text-white transition hover:bg-rose-800 disabled:cursor-wait disabled:opacity-60">
              <Undo2 className="size-3.5" /> {cancelingRecordId ? 'Membatalkan...' : 'Ya, batalkan catatan'}
            </button>
          </div>
        </div>
      )}
    </dialog>
    </>
  );
}
