import { useEffect, useMemo, useRef, useState } from 'react';
import { Ban, CheckCircle2, ClipboardCheck, LockKeyhole, Search, Undo2, X } from 'lucide-react';
import {
  api,
  type CurrentUser,
  type Job,
  type JobHandoverDirection,
  type JobHandoverRecord,
  type Client,
} from '../lib/api';
import { ExportDropdown } from './ExportDropdown';
import type { ColumnDef } from '../lib/exportUtils';
import { useToast } from './Toast';

interface HandoverViewProps {
  jobs: Job[];
  clients: Client[];
  records: JobHandoverRecord[];
  currentUser: CurrentUser;
  onRefresh: () => void | Promise<void>;
}

type HandoverExportRow = {
  number: number;
  jobId: string;
  clientName: string;
  division: string;
  title: string;
  picName: string;
  spvName: string;
  serviceResponsibility: string;
  jobStatus: string;
  staffToClient: string;
  staffToInternal: string;
  spvToClient: string;
  spvToInternal: string;
  taxToAccounting: string;
  taxToClient: string;
};

const HANDOVER_OPTIONS: Array<{
  direction: JobHandoverDirection;
  label: string;
  helper: string;
  taxOnly?: boolean;
}> = [
  { direction: 'staff-to-client', label: 'Staff → Klien', helper: 'Konfirmasi laporan dari PIC telah sampai ke klien.' },
  { direction: 'staff-to-internal', label: 'Staff → Internal', helper: 'Konfirmasi hasil kerja PIC telah diserahkan ke tim internal.' },
  { direction: 'spv-to-client', label: 'SPV → Klien', helper: 'Konfirmasi laporan yang disetujui reviewer telah sampai ke klien.' },
  { direction: 'spv-to-internal', label: 'SPV → Internal', helper: 'Konfirmasi hasil review telah diserahkan ke tim internal.' },
  { direction: 'tax-to-accounting', label: 'Tim Tax → Accounting', helper: 'Konfirmasi data Tax telah diserahkan ke Accounting.', taxOnly: true },
  { direction: 'tax-to-client', label: 'Tim Tax → Klien', helper: 'Konfirmasi data Tax telah disampaikan kepada klien.', taxOnly: true },
];

const HANDOVER_EXPORT_COLUMNS: ColumnDef<HandoverExportRow>[] = [
  { header: 'No', key: 'number', width: 7, align: 'center' },
  { header: 'ID Job', key: 'jobId', width: 18, align: 'center' },
  { header: 'Nama Klien', key: 'clientName', width: 28 },
  { header: 'Divisi', key: 'division', width: 14, align: 'center' },
  { header: 'Judul Pekerjaan', key: 'title', width: 38 },
  { header: 'PIC', key: 'picName', width: 24 },
  { header: 'SPV Reviewer', key: 'spvName', width: 24 },
  { header: 'Tanggung Jawab', key: 'serviceResponsibility', width: 24 },
  { header: 'Status Job', key: 'jobStatus', width: 18 },
  { header: 'Staff → Klien', key: 'staffToClient', width: 42 },
  { header: 'Staff → Internal', key: 'staffToInternal', width: 42 },
  { header: 'SPV → Klien', key: 'spvToClient', width: 42 },
  { header: 'SPV → Internal', key: 'spvToInternal', width: 42 },
  { header: 'Tim Tax → Accounting', key: 'taxToAccounting', width: 42 },
  { header: 'Tim Tax → Klien', key: 'taxToClient', width: 42 },
];

const HANDOVER_EXPORT_KEY: Record<JobHandoverDirection, keyof HandoverExportRow> = {
  'staff-to-client': 'staffToClient',
  'staff-to-internal': 'staffToInternal',
  'spv-to-client': 'spvToClient',
  'spv-to-internal': 'spvToInternal',
  'tax-to-accounting': 'taxToAccounting',
  'tax-to-client': 'taxToClient',
};

function canViewJob(job: Job, currentUser: CurrentUser) {
  if (currentUser.role === 'Admin' || currentUser.role === 'Owner' || currentUser.role === 'Manager') return true;
  if (currentUser.role === `Staff ${job.division}`) return job.picId === currentUser.id;
  if (currentUser.role === `SPV ${job.division}`) return job.spvId === currentUser.id;
  return false;
}

function isDirectionApplicable(job: Job, direction: JobHandoverDirection, client?: Client) {
  if ((job.serviceResponsibility || 'Tim 3') !== 'Tim 3') return false;
  if ((direction === 'tax-to-accounting' || direction === 'tax-to-client') && job.division !== 'Tax') return false;
  if (direction === 'tax-to-accounting' && (client?.accountingServiceResponsibility || 'Tim 3') !== 'Tim 3') return false;
  return true;
}

function canRecordDirection(job: Job, direction: JobHandoverDirection, currentUser: CurrentUser, client?: Client) {
  if (job.status !== 'Selesai' || !isDirectionApplicable(job, direction, client)) return false;
  if (currentUser.role === 'Admin') return true;
  if (direction === 'staff-to-client' || direction === 'staff-to-internal') {
    return currentUser.role === `Staff ${job.division}` && job.picId === currentUser.id;
  }
  if (direction === 'spv-to-client' || direction === 'spv-to-internal') {
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

function formatJakartaDateTime(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '-'
    : new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
}

function getChecklistExportValue(
  job: Job,
  record: JobHandoverRecord | undefined,
  canceledRecord: JobHandoverRecord | undefined,
  applicable: boolean
) {
  if (!applicable && !record && !canceledRecord) return '— Tidak berlaku';
  if (record) return `✓ Terkirim · ${formatJakartaDateTime(record.sentAt)} · ${record.sentByName}`;
  if (canceledRecord) {
    return `☐ Dibatalkan · ${formatJakartaDateTime(canceledRecord.canceledAt)} · ${canceledRecord.canceledByName || '—'}`;
  }
  return job.status === 'Selesai' ? '☐ Belum dicatat' : '— Menunggu review SPV';
}

function HandoverChecklistCell({
  job,
  option,
  record,
  canceledRecord,
  applicable,
  canRecord,
  saving,
  busy,
  canCancel,
  onRecord,
  onCancel,
}: {
  job: Job;
  option: (typeof HANDOVER_OPTIONS)[number];
  record?: JobHandoverRecord;
  canceledRecord?: JobHandoverRecord;
  applicable: boolean;
  canRecord: boolean;
  saving: boolean;
  busy: boolean;
  canCancel: boolean;
  onRecord: (job: Job, direction: JobHandoverDirection) => void;
  onCancel: (job: Job, record: JobHandoverRecord) => void;
}) {
  if (!applicable && !record && !canceledRecord) {
    return (
      <td className="min-w-52 border-b border-slate-100 px-3 py-3 align-top">
        <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">Tidak berlaku</span>
        <p className="mt-1 text-[10px] leading-4 text-slate-400">Bukan tanggung jawab Tim 3 untuk job ini.</p>
      </td>
    );
  }

  const isReviewed = job.status === 'Selesai';
  const disabled = !isReviewed || Boolean(record) || !canRecord || busy;
  const status = record
    ? 'Terkirim'
    : canceledRecord
      ? 'Dibatalkan'
      : saving
        ? 'Menyimpan…'
        : !isReviewed
          ? 'Menunggu review SPV'
          : canRecord
            ? 'Belum dicatat'
            : 'Menunggu pengirim yang ditugaskan';
  const checkboxId = `handover-${job.id}-${option.direction}`;

  return (
    <td className="min-w-52 border-b border-slate-100 px-3 py-3 align-top">
      <div className="flex min-w-44 flex-col gap-1.5">
        <label htmlFor={checkboxId} className={`inline-flex w-fit items-center gap-2 text-xs font-semibold ${disabled ? 'cursor-default' : 'cursor-pointer'}`}>
          <input
            id={checkboxId}
            type="checkbox"
            checked={Boolean(record)}
            disabled={disabled}
            onChange={(event) => {
              if (event.target.checked) onRecord(job, option.direction);
            }}
            aria-label={`Catat ${option.label} untuk ${job.title}`}
            className="size-4 shrink-0 accent-amber-600 disabled:cursor-not-allowed"
          />
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            record ? 'bg-emerald-50 text-emerald-800' : canceledRecord ? 'bg-rose-50 text-rose-800' : isReviewed ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-800'
          }`}>
            {status}
          </span>
        </label>
        {record ? (
          <p className="text-[10px] leading-4 text-slate-500">
            {formatDate(record.sentAt)} · {record.sentByName}
          </p>
        ) : canceledRecord ? (
          <p className="text-[10px] leading-4 text-slate-500">
            {formatDate(canceledRecord.sentAt)} · dibatalkan {formatDate(canceledRecord.canceledAt || '')} oleh {canceledRecord.canceledByName || 'pengguna'}
          </p>
        ) : (
          <p className="text-[10px] leading-4 text-slate-500">
            {saving ? 'Menyimpan catatan serah terima…' : !isReviewed ? 'Checklist aktif setelah review SPV.' : canRecord ? option.helper : 'Hanya pengirim yang ditugaskan dapat mencatat.'}
          </p>
        )}
        {record && canCancel && (
          <button
            type="button"
            onClick={() => onCancel(job, record)}
            className="inline-flex min-h-8 w-fit items-center gap-1 rounded-lg border border-rose-200 px-2 text-[10px] font-semibold text-rose-700 transition hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
          >
            <Undo2 className="size-3" /> Batalkan
          </button>
        )}
      </div>
    </td>
  );
}

export function HandoverView({ jobs, clients, records, currentUser, onRefresh }: HandoverViewProps) {
  const { success, error } = useToast();
  const [clientFilter, setClientFilter] = useState('All');
  const [directionFilter, setDirectionFilter] = useState<'All' | JobHandoverDirection>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | 'review' | 'handover' | 'complete' | 'delivered' | 'canceled'>('All');
  const [periodFilter, setPeriodFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ job: Job; record: JobHandoverRecord } | null>(null);
  const [cancelingRecordId, setCancelingRecordId] = useState<string | null>(null);
  const cancelDialogRef = useRef<HTMLDialogElement>(null);
  const [newlySavedRecords, setNewlySavedRecords] = useState<JobHandoverRecord[]>([]);

  const visibleJobs = useMemo(() => jobs.filter((job) => canViewJob(job, currentUser)), [jobs, currentUser]);
  const clientsById = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);
  const visibleJobIds = useMemo(() => new Set(visibleJobs.map((job) => job.id)), [visibleJobs]);
  const visibleRecords = useMemo(() => {
    const byId = new Map<string, JobHandoverRecord>();
    [...records, ...newlySavedRecords].forEach((record) => {
      if (visibleJobIds.has(record.jobId)) byId.set(record.id, record);
    });
    return [...byId.values()];
  }, [records, newlySavedRecords, visibleJobIds]);
  const recordsByJobId = useMemo(() => {
    const byJobId = new Map<string, JobHandoverRecord[]>();
    visibleRecords.forEach((record) => {
      const jobRecords = byJobId.get(record.jobId) || [];
      jobRecords.push(record);
      byJobId.set(record.jobId, jobRecords);
    });
    return byJobId;
  }, [visibleRecords]);
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
  const visibleChecklistOptions = useMemo(
    () => HANDOVER_OPTIONS.filter((option) => directionFilter === 'All' || option.direction === directionFilter),
    [directionFilter]
  );
  const handoverExportColumns = useMemo(() => {
    const selectedKeys = new Set(visibleChecklistOptions.map((option) => HANDOVER_EXPORT_KEY[option.direction]));
    return HANDOVER_EXPORT_COLUMNS.filter((column) => {
      const isChecklistColumn = Object.values(HANDOVER_EXPORT_KEY).includes(column.key as keyof HandoverExportRow);
      return !isChecklistColumn || selectedKeys.has(column.key as keyof HandoverExportRow);
    });
  }, [visibleChecklistOptions]);

  const filteredJobs = useMemo(() => visibleJobs.filter((job) => {
    if (clientFilter !== 'All' && job.clientId !== clientFilter) return false;
    const selectedDirection = HANDOVER_OPTIONS.find((option) => option.direction === directionFilter);
    if (selectedDirection?.taxOnly && job.division !== 'Tax') return false;
    const query = searchTerm.trim().toLocaleLowerCase('id-ID');
    if (query && ![job.id, job.title, job.clientName, job.picName, job.spvName].some((value) => value.toLocaleLowerCase('id-ID').includes(query))) return false;
    const jobOptions = HANDOVER_OPTIONS.filter((option) =>
      (directionFilter === 'All' || option.direction === directionFilter) &&
      isDirectionApplicable(job, option.direction, clientsById.get(job.clientId))
    );
    const jobRecords = jobOptions.map((option) => recordByKey.get(`${job.id}:${option.direction}`));
    const completedHandoverCount = jobRecords.filter(Boolean).length;
    const jobHistory = recordsByJobId.get(job.id) || [];
    if (statusFilter === 'review' && (job.status === 'Selesai' || (job.serviceResponsibility || 'Tim 3') !== 'Tim 3')) return false;
    if (statusFilter === 'handover' && (job.status !== 'Selesai' || jobOptions.length === 0 || completedHandoverCount === jobOptions.length)) return false;
    if (statusFilter === 'complete' && (job.status !== 'Selesai' || jobOptions.length === 0 || completedHandoverCount !== jobOptions.length)) return false;
    if (statusFilter === 'delivered' && !jobHistory.some((record) =>
      !record.canceledAt &&
      (directionFilter === 'All' || record.direction === directionFilter) &&
      (periodFilter === 'All' || record.sentAt.startsWith(periodFilter))
    )) return false;
    if (statusFilter === 'canceled' && !jobHistory.some((record) =>
      Boolean(record.canceledAt) &&
      (directionFilter === 'All' || record.direction === directionFilter) &&
      (periodFilter === 'All' || record.canceledAt?.startsWith(periodFilter))
    )) return false;
    if (periodFilter !== 'All') {
      const hasActiveRecordInPeriod = jobRecords.some((record) => record?.sentAt.startsWith(periodFilter));
          const hasCanceledRecordInPeriod = jobHistory.some((record) =>
        Boolean(record.canceledAt) &&
        (directionFilter === 'All' || record.direction === directionFilter) &&
        (record.sentAt.startsWith(periodFilter) || record.canceledAt?.startsWith(periodFilter))
      );
      if (!job.createdAt.startsWith(periodFilter) && !job.completedAt?.startsWith(periodFilter) && !hasActiveRecordInPeriod && !hasCanceledRecordInPeriod) return false;
    }
    return true;
  }).sort((a, b) => (b.completedAt || b.updatedAt || b.createdAt).localeCompare(a.completedAt || a.updatedAt || a.createdAt)), [
    visibleJobs,
    clientsById,
    clientFilter,
    directionFilter,
    searchTerm,
    recordByKey,
    recordsByJobId,
    canceledRecordByKey,
    statusFilter,
    periodFilter,
  ]);

  const handoverExportRows = useMemo(() => filteredJobs.map((job, index) => {
    const client = clientsById.get(job.clientId);
    const exportValue = (direction: JobHandoverDirection) => getChecklistExportValue(
      job,
      recordByKey.get(`${job.id}:${direction}`),
      canceledRecordByKey.get(`${job.id}:${direction}`),
      isDirectionApplicable(job, direction, client)
    );
    return {
      number: index + 1,
      jobId: job.id,
      clientName: job.clientName,
      division: job.division,
      title: job.title,
      picName: job.picName,
      spvName: job.spvName,
      serviceResponsibility: job.serviceResponsibility || 'Tim 3',
      jobStatus: job.status,
      staffToClient: exportValue('staff-to-client'),
      staffToInternal: exportValue('staff-to-internal'),
      spvToClient: exportValue('spv-to-client'),
      spvToInternal: exportValue('spv-to-internal'),
      taxToAccounting: exportValue('tax-to-accounting'),
      taxToClient: exportValue('tax-to-client'),
    };
  }), [filteredJobs, clientsById, recordByKey, canceledRecordByKey]);

  const summaryJobs = useMemo(() => visibleJobs.filter((job) => {
    if ((job.serviceResponsibility || 'Tim 3') !== 'Tim 3') return false;
    if (clientFilter !== 'All' && job.clientId !== clientFilter) return false;
    const selectedDirection = HANDOVER_OPTIONS.find((option) => option.direction === directionFilter);
    if (selectedDirection && !isDirectionApplicable(job, selectedDirection.direction, clientsById.get(job.clientId))) return false;
    const query = searchTerm.trim().toLocaleLowerCase('id-ID');
    if (query && ![job.id, job.title, job.clientName, job.picName, job.spvName].some((value) => value.toLocaleLowerCase('id-ID').includes(query))) return false;
    if (periodFilter !== 'All') {
      const hasPeriod = job.createdAt.startsWith(periodFilter) || job.completedAt?.startsWith(periodFilter) ||
        (recordsByJobId.get(job.id) || []).some((record) =>
          (directionFilter === 'All' || record.direction === directionFilter) &&
          (record.sentAt.startsWith(periodFilter) || record.canceledAt?.startsWith(periodFilter))
        );
      if (!hasPeriod) return false;
    }
    return true;
  }), [visibleJobs, clientsById, clientFilter, directionFilter, searchTerm, periodFilter, recordsByJobId]);
  const summaryJobIds = useMemo(() => new Set(summaryJobs.map((job) => job.id)), [summaryJobs]);
  const summaryJobsById = useMemo(() => new Map(summaryJobs.map((job) => [job.id, job])), [summaryJobs]);
  const summaryRecords = useMemo(() => visibleRecords.filter((record) =>
    summaryJobIds.has(record.jobId) && (directionFilter === 'All' || record.direction === directionFilter)
  ), [visibleRecords, summaryJobIds, directionFilter]);
  const activeSummaryRecords = useMemo(() => summaryRecords.filter((record) => {
    const job = summaryJobsById.get(record.jobId);
    return Boolean(job && isDirectionApplicable(job, record.direction, clientsById.get(job.clientId)) &&
      !record.canceledAt && (periodFilter === 'All' || record.sentAt.startsWith(periodFilter)));
  }), [summaryRecords, summaryJobsById, clientsById, periodFilter]);
  const canceledSummaryRecords = useMemo(() => summaryRecords.filter((record) => {
    const job = summaryJobsById.get(record.jobId);
    return Boolean(job && isDirectionApplicable(job, record.direction, clientsById.get(job.clientId)) &&
      record.canceledAt && (periodFilter === 'All' || record.canceledAt.startsWith(periodFilter)));
  }), [summaryRecords, summaryJobsById, clientsById, periodFilter]);
  const pendingReviewCount = useMemo(
    () => summaryJobs.filter((job) => job.status !== 'Selesai').length,
    [summaryJobs]
  );
  const pendingHandoverCount = useMemo(() => summaryJobs.reduce((total, job) => {
    if (job.status !== 'Selesai') return total;
    return total + HANDOVER_OPTIONS.filter((option) =>
      (directionFilter === 'All' || option.direction === directionFilter) &&
      isDirectionApplicable(job, option.direction, clientsById.get(job.clientId)) &&
      !recordByKey.has(`${job.id}:${option.direction}`)
    ).length;
  }, 0), [summaryJobs, directionFilter, recordByKey, clientsById]);
  const activeCountByDirection = useMemo(() => {
    const counts = new Map<JobHandoverDirection, number>();
    activeSummaryRecords.forEach((record) => counts.set(record.direction, (counts.get(record.direction) || 0) + 1));
    return counts;
  }, [activeSummaryRecords]);
  const directionSummary = useMemo(() => HANDOVER_OPTIONS
    .filter((option) => directionFilter === 'All' || option.direction === directionFilter)
    .filter((option) => summaryJobs.some((job) => isDirectionApplicable(job, option.direction, clientsById.get(job.clientId))))
    .map((option) => ({ ...option, count: activeCountByDirection.get(option.direction) || 0 })),
  [directionFilter, summaryJobs, activeCountByDirection, clientsById]);

  const handleRecordHandover = async (job: Job, direction: JobHandoverDirection) => {
    const key = `${job.id}:${direction}`;
    if (savingKey || job.status !== 'Selesai' || recordByKey.has(key) || !canRecordDirection(job, direction, currentUser, clientsById.get(job.clientId))) return;
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
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-600">Catat dokumen yang benar-benar diserahkan Staff atau SPV ke klien maupun tim internal. Checklist hanya aktif untuk pekerjaan yang menjadi tanggung jawab Tim 3.</p>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="handover-summary-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="handover-summary-title" className="text-sm font-bold text-slate-900">Ringkasan Rekap</h2>
            <p className="mt-1 text-[11px] text-slate-500">Mengikuti filter klien, periode, dan tujuan. Klik angka untuk melihat job terkait di daftar bawah.</p>
          </div>
          <span className="text-[10px] font-medium text-slate-400">{summaryJobs.length} job dalam cakupan</span>
        </div>
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          {[
            { key: 'delivered' as const, label: 'Terkirim / Diserahkan', count: activeSummaryRecords.length, color: 'emerald' },
            { key: 'handover' as const, label: 'Checklist Terbuka', count: pendingHandoverCount, color: 'sky' },
            { key: 'review' as const, label: 'Menunggu Review', count: pendingReviewCount, color: 'amber' },
            { key: 'canceled' as const, label: 'Catatan Dibatalkan', count: canceledSummaryRecords.length, color: 'rose' },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={statusFilter === item.key}
              aria-label={`${item.label}: ${item.count}. Tampilkan job terkait.`}
              onClick={() => setStatusFilter((current) => current === item.key ? 'All' : item.key)}
              className={`rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 ${
                item.color === 'emerald' ? `border-emerald-100 bg-emerald-50/60 hover:bg-emerald-100/70 ${statusFilter === item.key ? 'ring-2 ring-emerald-400' : ''}` :
                item.color === 'sky' ? `border-sky-100 bg-sky-50/60 hover:bg-sky-100/70 ${statusFilter === item.key ? 'ring-2 ring-sky-400' : ''}` :
                item.color === 'amber' ? `border-amber-100 bg-amber-50/60 hover:bg-amber-100/70 ${statusFilter === item.key ? 'ring-2 ring-amber-400' : ''}` :
                `border-rose-100 bg-rose-50/60 hover:bg-rose-100/70 ${statusFilter === item.key ? 'ring-2 ring-rose-400' : ''}`
              }`}
            >
              <span className={`block text-[10px] font-semibold uppercase tracking-wide ${
                item.color === 'emerald' ? 'text-emerald-800' : item.color === 'sky' ? 'text-sky-800' : item.color === 'amber' ? 'text-amber-800' : 'text-rose-800'
              }`}>{item.label}</span>
              <span className="mt-1 block text-xl font-bold tabular-nums text-slate-900">{item.count}</span>
            </button>
          ))}
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
              <option value="delivered">Terkirim / Diserahkan</option>
              <option value="canceled">Catatan Dibatalkan</option>
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
          <ExportDropdown
            filename="Rekap_Serah_Terima_TMM_BMA"
            sheetName="Rekap Serah Terima"
            title="REKAP SERAH TERIMA PEKERJAAN"
            subtitle={`Filter: ${statusFilter} · Klien: ${clientFilter === 'All' ? 'Semua klien' : clients.find((client) => client.id === clientFilter)?.name || 'Klien'} · Periode: ${periodFilter} · Tujuan: ${directionFilter === 'All' ? 'Semua tujuan' : HANDOVER_OPTIONS.find((option) => option.direction === directionFilter)?.label || 'Tujuan'} · ${filteredJobs.length} job`}
            columns={handoverExportColumns}
            data={handoverExportRows}
            label="Ekspor Rekap"
            className="ml-auto"
          />
          <span className="text-[11px] tabular-nums text-slate-400">{filteredJobs.length} job</span>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {filteredJobs.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <ClipboardCheck className="mx-auto size-8 text-slate-300" />
            <h2 className="mt-3 text-sm font-semibold text-slate-800">Tidak ada job yang cocok</h2>
            <p className="mt-1 text-xs text-slate-500">Ubah filter klien, tujuan, periode, atau pencarian.</p>
          </div>
        ) : (
          <div className="overflow-x-auto" role="region" aria-label="Tabel checklist rekap serah terima" tabIndex={0}>
            <table className="w-full min-w-[2048px] border-collapse text-left text-xs">
              <caption className="sr-only">Checklist serah terima per job. Centang terisi otomatis dari catatan serah terima yang tersimpan.</caption>
              <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="sticky left-0 z-20 w-10 border-b border-slate-200 bg-slate-50 px-3 py-3 text-center">No</th>
                  <th scope="col" className="sticky left-10 z-20 w-64 border-b border-slate-200 bg-slate-50 px-3 py-3">Job / Klien</th>
                  <th scope="col" className="w-48 border-b border-slate-200 px-3 py-3">PIC / SPV</th>
                  <th scope="col" className="w-40 border-b border-slate-200 px-3 py-3">Status Review</th>
                  {visibleChecklistOptions.map((option) => (
                    <th key={option.direction} scope="col" className="w-56 border-b border-slate-200 px-3 py-3">{option.label}</th>
                  ))}
                  <th scope="col" className="w-32 border-b border-slate-200 px-3 py-3 text-center">Progres</th>
                </tr>
              </thead>
              <tbody>
                {filteredJobs.map((job, index) => {
                  const client = clientsById.get(job.clientId);
                  const jobOptions = visibleChecklistOptions.filter((option) => isDirectionApplicable(job, option.direction, client));
                  const doneCount = jobOptions.filter((option) => recordByKey.has(`${job.id}:${option.direction}`)).length;
                  const isReviewed = job.status === 'Selesai';
                  const isTim3Assignment = (job.serviceResponsibility || 'Tim 3') === 'Tim 3';

                  return (
                    <tr key={job.id} className="group hover:bg-slate-50/70">
                      <td className="sticky left-0 z-[1] border-b border-slate-100 bg-white px-3 py-3 text-center font-mono text-[10px] text-slate-400 group-hover:bg-slate-50">{index + 1}</td>
                      <td className="sticky left-10 z-[1] border-b border-slate-100 bg-white px-3 py-3 group-hover:bg-slate-50">
                        <div className="flex min-w-56 flex-col gap-1">
                          <span className="font-mono text-[10px] font-semibold text-slate-500">{job.id}</span>
                          <span className="max-w-64 truncate text-xs font-semibold text-slate-900" title={job.title}>{job.title}</span>
                          <span className="flex items-center gap-1.5 truncate text-[10px] text-slate-500">
                            <span className={`rounded-full px-1.5 py-0.5 font-semibold ${job.division === 'Tax' ? 'bg-amber-50 text-amber-800' : 'bg-sky-50 text-sky-800'}`}>{job.division}</span>
                            <span className="truncate" title={job.clientName}>{job.clientName}</span>
                          </span>
                          <span className="text-[10px] text-slate-400">Tanggung jawab · {job.serviceResponsibility || 'Tim 3'}</span>
                        </div>
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3">
                        <div className="flex flex-col gap-1 text-[10px] text-slate-600">
                          <span className="truncate" title={job.picName}>PIC · {job.picName}</span>
                          <span className="truncate" title={job.spvName}>SPV · {job.spvName}</span>
                        </div>
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3">
                        <div className="flex flex-col gap-1">
                          <span className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${!isTim3Assignment ? 'bg-slate-100 text-slate-500' : isReviewed ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
                            {!isTim3Assignment ? <LockKeyhole className="size-3" /> : isReviewed ? <CheckCircle2 className="size-3" /> : <LockKeyhole className="size-3" />}
                            {!isTim3Assignment ? 'Di luar Tim 3' : isReviewed ? 'Review selesai' : 'Menunggu SPV'}
                          </span>
                          {isTim3Assignment && isReviewed && job.completedAt && <span className="text-[10px] text-slate-500">{formatDate(job.completedAt)}</span>}
                        </div>
                      </td>
                      {visibleChecklistOptions.map((option) => {
                        const key = `${job.id}:${option.direction}`;
                        const record = recordByKey.get(key);
                        const canceledRecord = canceledRecordByKey.get(key);
                        return (
                          <HandoverChecklistCell
                            key={option.direction}
                            job={job}
                            option={option}
                            record={record}
                            canceledRecord={canceledRecord}
                            applicable={isDirectionApplicable(job, option.direction, client)}
                            canRecord={canRecordDirection(job, option.direction, currentUser, client)}
                            saving={savingKey === key}
                            busy={Boolean(savingKey)}
                            canCancel={Boolean(record && canCancelHandover(job, record, currentUser))}
                            onRecord={(targetJob, direction) => void handleRecordHandover(targetJob, direction)}
                            onCancel={(targetJob, targetRecord) => setCancelTarget({ job: targetJob, record: targetRecord })}
                          />
                        );
                      })}
                      <td className="border-b border-slate-100 px-3 py-3 text-center">
                        <span className={`rounded-full px-2 py-1 text-[10px] font-bold tabular-nums ${jobOptions.length > 0 && doneCount === jobOptions.length ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                          {jobOptions.length === 0 ? 'Tidak berlaku' : `${doneCount} / ${jobOptions.length}`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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
