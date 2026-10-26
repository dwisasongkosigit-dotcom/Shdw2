import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Ban, ClipboardCheck, Search, Trash2, Undo2, X } from 'lucide-react';
import {
  api,
  type CurrentUser,
  type Job,
  type JobHandoverDirection,
  type ActiveJobHandoverDirection,
  type JobHandoverRecord,
  type ProfileAssignmentHandoverRecord,
  type JobHandoverDestination,
  type Client,
} from '../lib/api';
import { ExportDropdown } from './ExportDropdown';
import type { ColumnDef } from '../lib/exportUtils';
import { useToast } from './Toast';
import { matchesMonthRange } from '../lib/dateFilters';

interface HandoverViewProps {
  jobs: Job[];
  clients: Client[];
  records: JobHandoverRecord[];
  hiddenHandoverJobIds: string[];
  profileAssignmentRecords: ProfileAssignmentHandoverRecord[];
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
  handoverDestinations: string;
  jobStatus: string;
  staffToClient: string;
  spvPicToClient: string;
  accountingToTax: string;
  taxToAccounting: string;
  staffToInternal: string;
};

const HANDOVER_OPTIONS: Array<{
  direction: ActiveJobHandoverDirection;
  label: string;
  helper: string;
}> = [
  { direction: 'staff-to-client', label: 'PIC staff → Klien', helper: 'PIC staff yang ditugaskan mencatat laporan yang sudah disampaikan ke klien.' },
  { direction: 'spv-pic-to-client', label: 'PIC SPV → Klien', helper: 'SPV yang ditugaskan sebagai PIC mencatat laporan yang sudah disampaikan ke klien.' },
  { direction: 'accounting-to-tax', label: 'Accounting → Tax', helper: 'PIC Accounting mencatat penyerahan pekerjaan ke tim Tax.' },
  { direction: 'tax-to-accounting', label: 'Tax → Accounting', helper: 'PIC Tax mencatat penyerahan pekerjaan ke tim Accounting.' },
  { direction: 'staff-to-internal', label: 'PIC → Tim Internal Lain', helper: 'PIC yang ditugaskan mencatat penyerahan sesuai pilihan tanggung jawab layanan.' },
];

const HANDOVER_DIRECTION_LABELS: Record<JobHandoverDirection, string> = {
  'staff-to-client': 'PIC staff → Klien',
  'spv-pic-to-client': 'PIC SPV → Klien',
  'accounting-to-tax': 'Accounting → Tax',
  'tax-to-accounting': 'Tax → Accounting',
  'staff-to-internal': 'PIC → Tim Internal Lain',
  'spv-to-client': 'SPV → Klien (format lama)',
  'spv-to-internal': 'SPV → Internal (format lama)',
  'tax-to-client': 'Tim Tax → Klien (format lama)',
};

const ACTIVE_HANDOVER_DIRECTIONS = new Set<JobHandoverDirection>(HANDOVER_OPTIONS.map((option) => option.direction));

function getHandoverDirectionLabel(direction: JobHandoverDirection) {
  return HANDOVER_DIRECTION_LABELS[direction];
}

function isSpvPicForDivision(client: Client | undefined, division: Job['division']) {
  return division === 'Accounting' ? client?.accountingSpvIsPic === true : client?.taxSpvIsPic === true;
}

function getHandoverDestination(direction: JobHandoverDirection): JobHandoverDestination {
  return direction.endsWith('-to-client') ? 'client' : 'internal';
}

function isHandoverDirectionVisible(
  direction: JobHandoverDirection,
  visibleOptions: typeof HANDOVER_OPTIONS,
  directionFilter: 'All' | JobHandoverDirection,
  destinationFilter: 'All' | JobHandoverDestination
) {
  if (ACTIVE_HANDOVER_DIRECTIONS.has(direction)) {
    return visibleOptions.some((option) => option.direction === direction);
  }
  return directionFilter === 'All' &&
    (destinationFilter === 'All' || getHandoverDestination(direction) === destinationFilter);
}

const HANDOVER_EXPORT_COLUMNS: ColumnDef<HandoverExportRow>[] = [
  { header: 'No', key: 'number', width: 7, align: 'center' },
  { header: 'ID Job', key: 'jobId', width: 18, align: 'center' },
  { header: 'Nama Klien', key: 'clientName', width: 28 },
  { header: 'Divisi', key: 'division', width: 14, align: 'center' },
  { header: 'Judul Pekerjaan', key: 'title', width: 38 },
  { header: 'PIC', key: 'picName', width: 24 },
  { header: 'SPV Reviewer', key: 'spvName', width: 24 },
  { header: 'Tanggung Jawab', key: 'serviceResponsibility', width: 24 },
  { header: 'Tujuan Serah Terima', key: 'handoverDestinations', width: 24 },
  { header: 'Status Job', key: 'jobStatus', width: 18 },
  { header: 'PIC staff → Klien', key: 'staffToClient', width: 42 },
  { header: 'PIC SPV → Klien', key: 'spvPicToClient', width: 42 },
  { header: 'Accounting → Tax', key: 'accountingToTax', width: 42 },
  { header: 'Tax → Accounting', key: 'taxToAccounting', width: 42 },
  { header: 'PIC → Tim Internal Lain', key: 'staffToInternal', width: 42 },
];

const HANDOVER_EXPORT_KEY: Record<ActiveJobHandoverDirection, keyof HandoverExportRow> = {
  'staff-to-client': 'staffToClient',
  'spv-pic-to-client': 'spvPicToClient',
  'accounting-to-tax': 'accountingToTax',
  'tax-to-accounting': 'taxToAccounting',
  'staff-to-internal': 'staffToInternal',
};

function canViewJob(job: Job, currentUser: CurrentUser) {
  if (currentUser.role === 'Admin' || currentUser.role === 'Owner' || currentUser.role === 'Manager') return true;
  if (currentUser.role === `Staff ${job.division}`) return job.picId === currentUser.id;
  if (currentUser.role === `SPV ${job.division}`) return job.spvId === currentUser.id || job.picId === currentUser.id;
  return false;
}

function getHandoverServiceResponsibility(job: Job, client?: Client) {
  const jobResponsibility = job.serviceResponsibility || 'Tim 3';
  const clientResponsibility = job.division === 'Accounting'
    ? client?.accountingServiceResponsibility
    : client?.taxServiceResponsibility;
  if (jobResponsibility === 'Tim Internal Lain') return jobResponsibility;
  if (jobResponsibility === 'Tim 3' && clientResponsibility === 'Tim Internal Lain') return clientResponsibility;
  return jobResponsibility;
}

function getHandoverPicLabel(job: Job) {
  return job.picName;
}

function isDirectionApplicable(job: Job, direction: JobHandoverDirection, client?: Client) {
  const responsibility = getHandoverServiceResponsibility(job, client);
  if (direction === 'staff-to-internal') return responsibility === 'Tim Internal Lain';
  if (responsibility !== 'Tim 3') return false;
  if (direction === 'staff-to-client') return !isSpvPicForDivision(client, job.division);
  if (direction === 'spv-pic-to-client') return isSpvPicForDivision(client, job.division);
  if (direction === 'accounting-to-tax') {
    return job.division === 'Accounting' && (client?.taxServiceResponsibility || 'Tim 3') === 'Tim 3';
  }
  if (direction === 'tax-to-accounting') {
    return job.division === 'Tax' && (client?.accountingServiceResponsibility || 'Tim 3') === 'Tim 3';
  }
  if (direction === 'tax-to-client') return job.division === 'Tax';
  return true;
}

function isHandoverConfigured(job: Job, client?: Client) {
  if (getHandoverServiceResponsibility(job, client) !== 'Tim 3') return true;
  return Array.isArray(job.handoverDestinations) || Object.keys(job.handoverDirectionOverrides || {}).length > 0;
}

function isDirectionRequired(job: Job, direction: JobHandoverDirection, client?: Client) {
  if (!isDirectionApplicable(job, direction, client)) return false;
  if (direction === 'staff-to-internal') return true;
  const override = job.handoverDirectionOverrides?.[direction];
  if (override !== undefined) return override;
  if (!Array.isArray(job.handoverDestinations)) return false;
  const destination = direction.endsWith('-to-client') ? 'client' : 'internal';
  return job.handoverDestinations.includes(destination);
}

function getConfiguredDestinationLabel(job: Job, client?: Client) {
  if (!isHandoverConfigured(job, client)) return 'Belum diatur';
  const destinations = new Set(HANDOVER_OPTIONS
    .filter((option) => isDirectionRequired(job, option.direction, client))
    .map((option) => option.direction === 'staff-to-client'
      ? 'Klien (PIC staff)'
      : option.direction === 'spv-pic-to-client'
        ? 'Klien (PIC SPV)'
        : option.direction === 'staff-to-internal'
          ? 'Tim Internal Lain'
          : `${job.division} → ${job.division === 'Accounting' ? 'Tax' : 'Accounting'}`));
  return destinations.size ? [...destinations].join(' + ') : 'Tidak diperlukan';
}

function canRecordDirection(job: Job, direction: ActiveJobHandoverDirection, currentUser: CurrentUser, client?: Client) {
  if (job.status !== 'Selesai' || !isDirectionRequired(job, direction, client)) return false;
  if (currentUser.role === 'Admin') return true;
  const isSpvPic = isSpvPicForDivision(client, job.division);
  const assignedPicRole = isSpvPic ? `SPV ${job.division}` : `Staff ${job.division}`;
  const matchesDirectionRole = direction === 'spv-pic-to-client'
    ? isSpvPic && currentUser.role === `SPV ${job.division}`
    : direction === 'staff-to-client'
      ? !isSpvPic && currentUser.role === `Staff ${job.division}`
      : currentUser.role === assignedPicRole;
  return matchesDirectionRole && job.picId === currentUser.id;
}

function canCancelHandover(record: JobHandoverRecord, currentUser: CurrentUser, job: Job) {
  if (currentUser.role === 'Admin') return true;
  if (record.sentById !== currentUser.id) return false;
  return !currentUser.role.startsWith('SPV') ||
    (currentUser.role === `SPV ${job.division}` && job.picId === currentUser.id);
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
  direction: ActiveJobHandoverDirection,
  record: JobHandoverRecord | undefined,
  canceledRecord: JobHandoverRecord | undefined,
  applicable: boolean,
  client?: Client
) {
  if (!applicable && !record && !canceledRecord) return '— Tidak berlaku';
  if (record) return `✓ Terkirim · ${formatJakartaDateTime(record.sentAt)} · ${record.sentByName}`;
  if (canceledRecord) {
    return `☐ Dibatalkan · ${formatJakartaDateTime(canceledRecord.canceledAt)} · ${canceledRecord.canceledByName || '—'}`;
  }
  if (!isHandoverConfigured(job, client)) return '— Tujuan belum diatur';
  if (!isDirectionRequired(job, direction, client)) return '— Tidak diminta';
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
  canDelete,
  onRecord,
  onCancel,
  onDelete,
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
  canDelete: boolean;
  onRecord: (job: Job, direction: ActiveJobHandoverDirection) => void;
  onCancel: (job: Job, record: JobHandoverRecord) => void;
  onDelete: (job: Job, record: JobHandoverRecord) => void;
}) {
  if (!applicable && !record && !canceledRecord) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">Tidak berlaku</span>
        <p className="mt-1 text-[10px] leading-4 text-slate-400">Tujuan ini tidak sesuai tanggung jawab layanan job.</p>
      </div>
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
                : 'Menunggu PIC yang ditugaskan';
  const checkboxId = `handover-${job.id}-${option.direction}`;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex min-w-44 flex-col gap-1.5">
        <span className="text-xs font-semibold text-slate-800">{option.label}</span>
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
            {saving ? 'Menyimpan catatan serah terima…' : !isReviewed ? 'Checklist aktif setelah review SPV.' : canRecord ? option.helper : 'Hanya PIC yang ditugaskan dapat mencatat; SPV lain hanya melihat.'}
          </p>
        )}
        {record && (canCancel || canDelete) && (
          <div className="flex flex-wrap gap-2">
            {canCancel && (
              <button
                type="button"
                onClick={() => onCancel(job, record)}
                disabled={busy}
                className="inline-flex min-h-8 w-fit items-center gap-1 rounded-lg border border-rose-200 px-2 text-[10px] font-semibold text-rose-700 transition hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:cursor-wait disabled:opacity-50"
              >
                <Undo2 className="size-3" /> Batalkan
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={() => onDelete(job, record)}
                disabled={busy}
                className="inline-flex min-h-8 w-fit items-center gap-1 rounded-lg border border-rose-200 px-2 text-[10px] font-semibold text-rose-700 transition hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:cursor-wait disabled:opacity-50"
                aria-label={`Hapus permanen catatan ${option.label} untuk ${job.title}`}
              >
                <Trash2 className="size-3" /> Hapus
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

type ProfileHandoverAssignment = {
  clientId: string;
  clientName: string;
  division: Job['division'];
  picId: string;
  picName: string;
  spvName: string;
  isSpvPic: boolean;
};

type ProfileHandoverAssignmentRow = ProfileHandoverAssignment & {
  record?: ProfileAssignmentHandoverRecord;
  canceledRecord?: ProfileAssignmentHandoverRecord;
};

function getProfileHandoverOwner(client: Client, division: Job['division']) {
  const isSpvPic = isSpvPicForDivision(client, division);
  if (division === 'Accounting') {
    return {
      isSpvPic,
      picId: isSpvPic ? client.accountingSpvId : client.accountingStaffPicId,
      picName: isSpvPic ? client.accountingSpvName : client.accountingStaffPicName,
      spvId: client.accountingSpvId,
      spvName: client.accountingSpvName,
    };
  }
  return {
    isSpvPic,
    picId: isSpvPic ? client.taxSpvId : client.taxStaffPicId,
    picName: isSpvPic ? client.taxSpvName : client.taxStaffPicName,
    spvId: client.taxSpvId,
    spvName: client.taxSpvName,
  };
}

function canViewProfileAssignment(client: Client, division: Job['division'], currentUser: CurrentUser) {
  if (['Admin', 'Owner', 'Manager'].includes(currentUser.role)) return true;
  const { picId, spvId } = getProfileHandoverOwner(client, division);
  if (currentUser.role === `Staff ${division}`) return picId === currentUser.id;
  if (currentUser.role === `SPV ${division}`) return spvId === currentUser.id || picId === currentUser.id;
  return false;
}

function ProfileAssignmentHandoverCard({ assignment, currentUser, savingKey, cancelingRecordId, onRecord, onCancel }: {
  assignment: ProfileHandoverAssignmentRow;
  currentUser: CurrentUser;
  savingKey: string | null;
  cancelingRecordId: string | null;
  onRecord: (assignment: ProfileHandoverAssignment, destinationDivision: Job['division']) => void;
  onCancel: (assignment: ProfileHandoverAssignment, record: ProfileAssignmentHandoverRecord) => void;
}) {
  const existingRecord = assignment.record;
  const historyRecord = assignment.canceledRecord;
  const defaultDestination = existingRecord?.destinationDivision || historyRecord?.destinationDivision ||
    (assignment.division === 'Accounting' ? 'Tax' : 'Accounting');
  const [destinationDivision, setDestinationDivision] = useState<Job['division']>(defaultDestination);
  const key = `profile:${assignment.clientId}:${assignment.division}`;
  const isSaving = savingKey === key;
  const busy = Boolean(savingKey);
  const isCanceling = cancelingRecordId === existingRecord?.id;
  const canRecord = currentUser.role === 'Admin' || (
    currentUser.id === assignment.picId &&
    currentUser.role === `${assignment.isSpvPic ? 'SPV' : 'Staff'} ${assignment.division}`
  );
  const canCancel = Boolean(existingRecord && (currentUser.role === 'Admin' || existingRecord.sentById === currentUser.id));
  const status = existingRecord ? 'Sudah diserahkan' : historyRecord ? 'Catatan dibatalkan' : 'Belum dicatat';

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] font-semibold text-slate-500">{assignment.clientId}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${assignment.division === 'Tax' ? 'bg-amber-50 text-amber-800' : 'bg-sky-50 text-sky-800'}`}>{assignment.division}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{assignment.clientName}</span>
          </div>
          <h2 className="text-sm font-bold leading-5 text-slate-900">PIC → Tim Internal Lain</h2>
          <p className="mt-1 text-[11px] text-slate-500">PIC {assignment.picName && assignment.picName !== '-' ? assignment.picName : 'belum ditentukan'} · {assignment.isSpvPic ? 'PIC SPV' : 'PIC staff'}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${existingRecord ? 'bg-emerald-50 text-emerald-800' : historyRecord ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-800'}`}>{status}</span>
      </div>
      <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-end sm:justify-between sm:px-5">
        <div className="flex flex-col gap-1">
          {existingRecord ? (
            <p className="text-[10px] leading-4 text-slate-500">Diserahkan ke {existingRecord.destinationDivision || defaultDestination} · {formatDate(existingRecord.sentAt)} oleh {existingRecord.sentByName}</p>
          ) : historyRecord ? (
            <p className="text-[10px] leading-4 text-slate-500">Sebelumnya diserahkan ke {historyRecord.destinationDivision || defaultDestination}; dibatalkan {formatDate(historyRecord.canceledAt || '')}.</p>
          ) : (
            <p className="text-[10px] leading-4 text-slate-500">Tidak perlu membuat job atau mengisi judul tugas untuk mencatat assignment ini.</p>
          )}
          {!existingRecord && (
            <label className="flex items-center gap-2 text-[10px] font-semibold text-slate-600">
              Tim tujuan
              <select value={destinationDivision} onChange={(event) => setDestinationDivision(event.target.value as Job['division'])} className="min-h-9 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-800 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100">
                <option value="Accounting" disabled={assignment.division === 'Accounting'}>Accounting</option>
                <option value="Tax" disabled={assignment.division === 'Tax'}>Tax</option>
              </select>
            </label>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!existingRecord && (
            <button type="button" onClick={() => onRecord(assignment, destinationDivision)} disabled={!canRecord || busy} className="inline-flex min-h-9 items-center justify-center rounded-lg bg-amber-600 px-3 text-[11px] font-semibold text-white transition hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
              {isSaving ? 'Menyimpan…' : 'Catat sudah diserahkan'}
            </button>
          )}
          {canCancel && existingRecord && (
            <button type="button" onClick={() => onCancel(assignment, existingRecord)} disabled={isCanceling || busy} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-rose-200 px-3 text-[10px] font-semibold text-rose-700 transition hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-50">
              <Undo2 className="size-3.5" /> {isCanceling ? 'Membatalkan…' : 'Batalkan'}
            </button>
          )}
          {!existingRecord && !canRecord && <span className="text-[10px] text-slate-500">Hanya PIC yang ditugaskan atau Admin dapat mencatat.</span>}
        </div>
      </div>
    </article>
  );
}

export function HandoverView({ jobs, clients, records, hiddenHandoverJobIds, profileAssignmentRecords, currentUser, onRefresh }: HandoverViewProps) {
  const { success, error } = useToast();
  const [clientFilter, setClientFilter] = useState('All');
  const [picFilter, setPicFilter] = useState('All');
  const [destinationFilter, setDestinationFilter] = useState<'All' | JobHandoverDestination>('All');
  const [directionFilter, setDirectionFilter] = useState<'All' | JobHandoverDirection>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | 'review' | 'handover' | 'complete' | 'delivered' | 'canceled' | 'unconfigured'>('All');
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const hasPeriodFilter = Boolean(periodFrom || periodTo);
  const periodLabel = hasPeriodFilter ? `${periodFrom || 'awal'}–${periodTo || 'terbaru'}` : 'Semua periode';
  const [searchTerm, setSearchTerm] = useState('');
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const normalizedSearchTerm = deferredSearchTerm.trim().toLocaleLowerCase('id-ID');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ job: Job; record: JobHandoverRecord } | null>(null);
  const [cancelingRecordId, setCancelingRecordId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ job: Job; record: JobHandoverRecord } | null>(null);
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null);
  const [deletedRecordIds, setDeletedRecordIds] = useState<Set<string>>(() => new Set());
  const [removeFromRecapTarget, setRemoveFromRecapTarget] = useState<Job | null>(null);
  const [removingFromRecapJobId, setRemovingFromRecapJobId] = useState<string | null>(null);
  const cancelDialogRef = useRef<HTMLDialogElement>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const removeFromRecapDialogRef = useRef<HTMLDialogElement>(null);
  const [newlySavedRecords, setNewlySavedRecords] = useState<JobHandoverRecord[]>([]);
  const [newlySavedProfileRecords, setNewlySavedProfileRecords] = useState<ProfileAssignmentHandoverRecord[]>([]);
  const [cancelingProfileRecordId, setCancelingProfileRecordId] = useState<string | null>(null);

  const hiddenHandoverJobIdSet = useMemo(() => new Set(hiddenHandoverJobIds), [hiddenHandoverJobIds]);
  const visibleJobs = useMemo(() => jobs.filter((job) =>
    canViewJob(job, currentUser) && !hiddenHandoverJobIdSet.has(job.id)
  ), [jobs, currentUser, hiddenHandoverJobIdSet]);
  const clientsById = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);
  const jobAssignmentKeys = useMemo(() => new Set(jobs.map((job) => `${job.clientId}:${job.division}`)), [jobs]);
  const profileAssignments = useMemo(() => clients.flatMap((client) =>
    (['Accounting', 'Tax'] as const).flatMap((division) => {
      const responsibility = division === 'Accounting'
        ? client.accountingServiceResponsibility || 'Tim 3'
        : client.taxServiceResponsibility || 'Tim 3';
      if (responsibility !== 'Tim Internal Lain' || jobAssignmentKeys.has(`${client.id}:${division}`) || !canViewProfileAssignment(client, division, currentUser)) return [];
      const owner = getProfileHandoverOwner(client, division);
      return [{ clientId: client.id, clientName: client.name, division, picId: owner.picId, picName: owner.picName, spvName: owner.spvName, isSpvPic: owner.isSpvPic }];
    })
  ), [clients, jobAssignmentKeys, currentUser]);
  const profileAssignmentKeys = useMemo(() => new Set(profileAssignments.map((assignment) => `${assignment.clientId}:${assignment.division}`)), [profileAssignments]);
  const visibleProfileRecords = useMemo(() => {
    const byId = new Map<string, ProfileAssignmentHandoverRecord>();
    [...profileAssignmentRecords, ...newlySavedProfileRecords].forEach((record) => {
      if (profileAssignmentKeys.has(`${record.clientId}:${record.division}`)) byId.set(record.id, record);
    });
    return [...byId.values()];
  }, [profileAssignmentRecords, newlySavedProfileRecords, profileAssignmentKeys]);
  const profileRecordByKey = useMemo(() => {
    const active = visibleProfileRecords.filter((record) => !record.canceledAt).sort((a, b) => a.sentAt.localeCompare(b.sentAt));
    return new Map(active.map((record) => [`${record.clientId}:${record.division}`, record]));
  }, [visibleProfileRecords]);
  const canceledProfileRecordByKey = useMemo(() => {
    const canceled = visibleProfileRecords.filter((record) => record.canceledAt).sort((a, b) => (a.canceledAt || '').localeCompare(b.canceledAt || ''));
    return new Map(canceled.map((record) => [`${record.clientId}:${record.division}`, record]));
  }, [visibleProfileRecords]);
  const availablePics = useMemo(() => {
    const picsById = new Map<string, string>();
    visibleJobs.forEach((job) => picsById.set(job.picId, job.picName));
    profileAssignments.forEach((assignment) => {
      if (assignment.picId) picsById.set(assignment.picId, assignment.picName);
    });
    return [...picsById.entries()].sort((a, b) => a[1].localeCompare(b[1], 'id-ID'));
  }, [visibleJobs, profileAssignments]);
  const visibleJobIds = useMemo(() => new Set(visibleJobs.map((job) => job.id)), [visibleJobs]);
  const visibleRecords = useMemo(() => {
    const byId = new Map<string, JobHandoverRecord>();
    [...records, ...newlySavedRecords].forEach((record) => {
      if (visibleJobIds.has(record.jobId) && !deletedRecordIds.has(record.id)) byId.set(record.id, record);
    });
    return [...byId.values()];
  }, [records, newlySavedRecords, visibleJobIds, deletedRecordIds]);
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
  const visibleChecklistOptions = useMemo(
    () => HANDOVER_OPTIONS.filter((option) =>
      (directionFilter === 'All' || option.direction === directionFilter) &&
      (destinationFilter === 'All' || getHandoverDestination(option.direction) === destinationFilter)
    ),
    [directionFilter, destinationFilter]
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
    const client = clientsById.get(job.clientId);
    if (picFilter !== 'All' && job.picId !== picFilter) return false;
    if (directionFilter !== 'All' && !isDirectionRequired(job, directionFilter, client)) return false;
    if (destinationFilter !== 'All' && !HANDOVER_OPTIONS.some((option) =>
      getHandoverDestination(option.direction) === destinationFilter && isDirectionRequired(job, option.direction, client)
    )) return false;
    if (normalizedSearchTerm && ![job.id, job.title, job.clientName, getHandoverPicLabel(job), job.spvName].some((value) => value.toLocaleLowerCase('id-ID').includes(normalizedSearchTerm))) return false;
    const jobOptions = HANDOVER_OPTIONS.filter((option) =>
      visibleChecklistOptions.some((visibleOption) => visibleOption.direction === option.direction) &&
      isDirectionRequired(job, option.direction, client)
    );
    const jobRecords = jobOptions.map((option) => recordByKey.get(`${job.id}:${option.direction}`));
    const completedHandoverCount = jobRecords.filter(Boolean).length;
    const jobHistory = recordsByJobId.get(job.id) || [];
    if (statusFilter === 'review' && (job.status === 'Selesai' || !['Tim 3', 'Tim Internal Lain'].includes(getHandoverServiceResponsibility(job, client)))) return false;
    if (statusFilter === 'handover' && (job.status !== 'Selesai' || jobOptions.length === 0 || completedHandoverCount === jobOptions.length)) return false;
    if (statusFilter === 'complete' && (job.status !== 'Selesai' || jobOptions.length === 0 || completedHandoverCount !== jobOptions.length)) return false;
    if (statusFilter === 'unconfigured' && isHandoverConfigured(job, client)) return false;
    if (statusFilter === 'delivered' && !jobHistory.some((record) =>
      !record.canceledAt &&
      isHandoverDirectionVisible(record.direction, visibleChecklistOptions, directionFilter, destinationFilter) &&
      matchesMonthRange(record.sentAt, periodFrom, periodTo)
    )) return false;
    if (statusFilter === 'canceled' && !jobHistory.some((record) =>
      Boolean(record.canceledAt) &&
      isHandoverDirectionVisible(record.direction, visibleChecklistOptions, directionFilter, destinationFilter) &&
      matchesMonthRange(record.canceledAt, periodFrom, periodTo)
    )) return false;
    if (hasPeriodFilter) {
      const hasActiveRecordInPeriod = jobRecords.some((record) => record && matchesMonthRange(record.sentAt, periodFrom, periodTo));
      const hasHandoverRecordInPeriod = jobHistory.some((record) =>
        isHandoverDirectionVisible(record.direction, visibleChecklistOptions, directionFilter, destinationFilter) &&
        (matchesMonthRange(record.sentAt, periodFrom, periodTo) || matchesMonthRange(record.canceledAt, periodFrom, periodTo))
      );
      if (!matchesMonthRange(job.createdAt, periodFrom, periodTo) && !matchesMonthRange(job.completedAt, periodFrom, periodTo) && !hasActiveRecordInPeriod && !hasHandoverRecordInPeriod) return false;
    }
    return true;
  }).sort((a, b) => (b.completedAt || b.updatedAt || b.createdAt).localeCompare(a.completedAt || a.updatedAt || a.createdAt)), [
    visibleJobs,
    clientsById,
    clientFilter,
    picFilter,
    destinationFilter,
    directionFilter,
    visibleChecklistOptions,
    normalizedSearchTerm,
    recordByKey,
    recordsByJobId,
    canceledRecordByKey,
    statusFilter,
    periodFrom,
    periodTo,
    hasPeriodFilter,
  ]);
  const filteredProfileAssignments = useMemo(() => profileAssignments.filter((assignment) => {
    if (clientFilter !== 'All' && assignment.clientId !== clientFilter) return false;
    if (picFilter !== 'All' && assignment.picId !== picFilter) return false;
    if (directionFilter !== 'All' && directionFilter !== 'staff-to-internal') return false;
    if (destinationFilter === 'client') return false;

    const key = `${assignment.clientId}:${assignment.division}`;
    const record = profileRecordByKey.get(key);
    const canceledRecord = canceledProfileRecordByKey.get(key);
    const destinationDivision = record?.destinationDivision || canceledRecord?.destinationDivision || (assignment.division === 'Accounting' ? 'Tax' : 'Accounting');
    if (normalizedSearchTerm && ![assignment.clientId, assignment.clientName, assignment.picName, assignment.spvName, destinationDivision, 'Tim Internal Lain']
      .some((value) => value.toLocaleLowerCase('id-ID').includes(normalizedSearchTerm))) return false;
    if (statusFilter === 'review' || statusFilter === 'unconfigured') return false;
    if (statusFilter === 'handover' && record) return false;
    if ((statusFilter === 'complete' || statusFilter === 'delivered') && !record) return false;
    if (statusFilter === 'canceled' && (record || !canceledRecord)) return false;
    if (hasPeriodFilter) {
      const hasRecordInPeriod = [record, canceledRecord].some((item) => item && (
        matchesMonthRange(item.sentAt, periodFrom, periodTo) || matchesMonthRange(item.canceledAt, periodFrom, periodTo)
      ));
      if (!hasRecordInPeriod) return false;
    }
    return true;
  }), [profileAssignments, clientFilter, picFilter, directionFilter, destinationFilter, normalizedSearchTerm, profileRecordByKey, canceledProfileRecordByKey, statusFilter, hasPeriodFilter, periodFrom, periodTo]);

  const handoverExportRows = useMemo(() => {
    const jobRows = filteredJobs.map((job, index) => {
      const client = clientsById.get(job.clientId);
      const exportValue = (direction: ActiveJobHandoverDirection) => getChecklistExportValue(
        job,
        direction,
        recordByKey.get(`${job.id}:${direction}`),
        canceledRecordByKey.get(`${job.id}:${direction}`),
        isDirectionApplicable(job, direction, client),
        client
      );
      return {
        number: index + 1,
        jobId: job.id,
        clientName: job.clientName,
        division: job.division,
        title: job.title,
        picName: getHandoverPicLabel(job),
        spvName: job.spvName,
        serviceResponsibility: getHandoverServiceResponsibility(job, client),
        handoverDestinations: getConfiguredDestinationLabel(job, client),
        jobStatus: job.status,
        staffToClient: exportValue('staff-to-client'),
        spvPicToClient: exportValue('spv-pic-to-client'),
        accountingToTax: exportValue('accounting-to-tax'),
        taxToAccounting: exportValue('tax-to-accounting'),
        staffToInternal: exportValue('staff-to-internal'),
      };
    });
    const profileRows = filteredProfileAssignments.map((assignment, index) => {
      const key = `${assignment.clientId}:${assignment.division}`;
      const record = profileRecordByKey.get(key);
      const canceledRecord = canceledProfileRecordByKey.get(key);
      const destinationDivision = record?.destinationDivision || canceledRecord?.destinationDivision || (assignment.division === 'Accounting' ? 'Tax' : 'Accounting');
      return {
        number: jobRows.length + index + 1,
        jobId: `ASSIGN-${assignment.clientId}-${assignment.division}`,
        clientName: assignment.clientName,
        division: assignment.division,
        title: 'Assignment layanan (tanpa job)',
        picName: assignment.picName || 'Belum ditentukan',
        spvName: assignment.spvName || 'Belum ditentukan',
        serviceResponsibility: 'Tim Internal Lain',
        handoverDestinations: `Internal (${destinationDivision})`,
        jobStatus: 'Tidak ada job',
        staffToClient: '— Tidak berlaku',
        spvPicToClient: '— Tidak berlaku',
        accountingToTax: '— Tidak berlaku',
        taxToAccounting: '— Tidak berlaku',
        staffToInternal: record
          ? `✓ Diserahkan ke ${record.destinationDivision || destinationDivision} · ${formatDate(record.sentAt)} · ${record.sentByName}`
          : canceledRecord
            ? `☐ Dibatalkan · ${formatDate(canceledRecord.canceledAt || '')} · ${canceledRecord.canceledByName || '—'}`
            : '☐ Belum dicatat',
      };
    });
    return [...jobRows, ...profileRows];
  }, [filteredJobs, filteredProfileAssignments, clientsById, recordByKey, canceledRecordByKey, profileRecordByKey, canceledProfileRecordByKey]);

  const summaryJobs = useMemo(() => visibleJobs.filter((job) => {
    if (clientFilter !== 'All' && job.clientId !== clientFilter) return false;
    const client = clientsById.get(job.clientId);
    if (picFilter !== 'All' && job.picId !== picFilter) return false;
    const responsibility = getHandoverServiceResponsibility(job, client);
    if (responsibility !== 'Tim 3' && responsibility !== 'Tim Internal Lain') return false;
    if (directionFilter !== 'All' && !isDirectionRequired(job, directionFilter, client)) return false;
    if (destinationFilter !== 'All' && !HANDOVER_OPTIONS.some((option) =>
      getHandoverDestination(option.direction) === destinationFilter && isDirectionRequired(job, option.direction, client)
    )) return false;
    if (normalizedSearchTerm && ![job.id, job.title, job.clientName, getHandoverPicLabel(job), job.spvName].some((value) => value.toLocaleLowerCase('id-ID').includes(normalizedSearchTerm))) return false;
    if (hasPeriodFilter) {
      const hasPeriod = matchesMonthRange(job.createdAt, periodFrom, periodTo) || matchesMonthRange(job.completedAt, periodFrom, periodTo) ||
        (recordsByJobId.get(job.id) || []).some((record) =>
          isHandoverDirectionVisible(record.direction, visibleChecklistOptions, directionFilter, destinationFilter) &&
          (matchesMonthRange(record.sentAt, periodFrom, periodTo) || matchesMonthRange(record.canceledAt, periodFrom, periodTo))
        );
      if (!hasPeriod) return false;
    }
    return true;
  }), [visibleJobs, clientsById, clientFilter, picFilter, destinationFilter, directionFilter, visibleChecklistOptions, normalizedSearchTerm, periodFrom, periodTo, hasPeriodFilter, recordsByJobId]);
  const summaryProfileAssignments = useMemo(() => profileAssignments.filter((assignment) => {
    if (clientFilter !== 'All' && assignment.clientId !== clientFilter) return false;
    if (picFilter !== 'All' && assignment.picId !== picFilter) return false;
    if (directionFilter !== 'All' && directionFilter !== 'staff-to-internal') return false;
    if (destinationFilter === 'client') return false;
    if (normalizedSearchTerm && ![assignment.clientId, assignment.clientName, assignment.picName, assignment.spvName, 'Tim Internal Lain']
      .some((value) => value.toLocaleLowerCase('id-ID').includes(normalizedSearchTerm))) return false;
    if (hasPeriodFilter) {
      const key = `${assignment.clientId}:${assignment.division}`;
      const record = profileRecordByKey.get(key);
      const canceledRecord = canceledProfileRecordByKey.get(key);
      if (![record, canceledRecord].some((item) => item && (
        matchesMonthRange(item.sentAt, periodFrom, periodTo) || matchesMonthRange(item.canceledAt, periodFrom, periodTo)
      ))) return false;
    }
    return true;
  }), [profileAssignments, clientFilter, picFilter, directionFilter, destinationFilter, normalizedSearchTerm, hasPeriodFilter, profileRecordByKey, canceledProfileRecordByKey, periodFrom, periodTo]);
  const summaryJobIds = useMemo(() => new Set(summaryJobs.map((job) => job.id)), [summaryJobs]);
  const summaryJobsById = useMemo(() => new Map(summaryJobs.map((job) => [job.id, job])), [summaryJobs]);
  const summaryRecords = useMemo(() => visibleRecords.filter((record) =>
    summaryJobIds.has(record.jobId) && isHandoverDirectionVisible(record.direction, visibleChecklistOptions, directionFilter, destinationFilter)
  ), [visibleRecords, summaryJobIds, visibleChecklistOptions, directionFilter, destinationFilter]);
  const activeSummaryRecords = useMemo(() => summaryRecords.filter((record) => {
    const job = summaryJobsById.get(record.jobId);
    return Boolean(job && isDirectionApplicable(job, record.direction, clientsById.get(job.clientId)) &&
      !record.canceledAt && matchesMonthRange(record.sentAt, periodFrom, periodTo));
  }), [summaryRecords, summaryJobsById, clientsById, periodFrom, periodTo]);
  const canceledSummaryRecords = useMemo(() => summaryRecords.filter((record) => {
    const job = summaryJobsById.get(record.jobId);
    return Boolean(job && isDirectionApplicable(job, record.direction, clientsById.get(job.clientId)) &&
      record.canceledAt && matchesMonthRange(record.canceledAt, periodFrom, periodTo));
  }), [summaryRecords, summaryJobsById, clientsById, periodFrom, periodTo]);
  const activeProfileSummaryCount = summaryProfileAssignments.filter((assignment) => {
    const record = profileRecordByKey.get(`${assignment.clientId}:${assignment.division}`);
    return Boolean(record && matchesMonthRange(record.sentAt, periodFrom, periodTo));
  }).length;
  const canceledProfileSummaryCount = summaryProfileAssignments.filter((assignment) => {
    const key = `${assignment.clientId}:${assignment.division}`;
    return !profileRecordByKey.has(key) && Boolean(canceledProfileRecordByKey.get(key)?.canceledAt && matchesMonthRange(canceledProfileRecordByKey.get(key)?.canceledAt, periodFrom, periodTo));
  }).length;
  const pendingReviewCount = useMemo(
    () => summaryJobs.filter((job) => job.status !== 'Selesai').length,
    [summaryJobs]
  );
  const pendingHandoverCount = useMemo(() => summaryJobs.reduce((total, job) => {
    if (job.status !== 'Selesai') return total;
    return total + visibleChecklistOptions.filter((option) =>
      isDirectionRequired(job, option.direction, clientsById.get(job.clientId)) &&
      !recordByKey.has(`${job.id}:${option.direction}`)
    ).length;
  }, 0) + summaryProfileAssignments.filter((assignment) => !profileRecordByKey.has(`${assignment.clientId}:${assignment.division}`)).length, [summaryJobs, visibleChecklistOptions, recordByKey, clientsById, summaryProfileAssignments, profileRecordByKey]);
  const unconfiguredJobCount = useMemo(
    () => summaryJobs.filter((job) => !isHandoverConfigured(job, clientsById.get(job.clientId))).length,
    [summaryJobs]
  );
  const activeCountByDirection = useMemo(() => {
    const counts = new Map<JobHandoverDirection, number>();
    activeSummaryRecords.forEach((record) => counts.set(record.direction, (counts.get(record.direction) || 0) + 1));
    counts.set('staff-to-internal', (counts.get('staff-to-internal') || 0) + activeProfileSummaryCount);
    return counts;
  }, [activeSummaryRecords, activeProfileSummaryCount]);
  const directionSummary = useMemo(() => visibleChecklistOptions
    .filter((option) => summaryJobs.some((job) => isDirectionRequired(job, option.direction, clientsById.get(job.clientId))) ||
      (option.direction === 'staff-to-internal' && summaryProfileAssignments.length > 0))
    .map((option) => ({ ...option, count: activeCountByDirection.get(option.direction) || 0 })),
  [visibleChecklistOptions, summaryJobs, summaryProfileAssignments, activeCountByDirection, clientsById]);

  const handleRecordHandover = async (job: Job, direction: ActiveJobHandoverDirection) => {
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

  const handleRecordProfileAssignment = async (assignment: ProfileHandoverAssignment, destinationDivision: Job['division']) => {
    const key = `profile:${assignment.clientId}:${assignment.division}`;
    if (savingKey || profileRecordByKey.has(`${assignment.clientId}:${assignment.division}`) || destinationDivision === assignment.division) return;
    const canRecord = currentUser.role === 'Admin' || (
      currentUser.id === assignment.picId &&
      currentUser.role === `${assignment.isSpvPic ? 'SPV' : 'Staff'} ${assignment.division}`
    );
    if (!canRecord) return;

    setSavingKey(key);
    try {
      const response = await api.recordProfileAssignmentHandover(assignment.clientId, assignment.division, destinationDivision);
      setNewlySavedProfileRecords((previous) => [...previous.filter((record) => record.id !== response.record.id), response.record]);
      success('Serah Terima Dicatat', `${response.message} ${formatDate(response.record.sentAt)} · ${response.record.sentByName}.`);
      await onRefresh();
    } catch (err: any) {
      error('Gagal Mencatat Serah Terima', err.message || 'Periksa koneksi lalu coba kembali.');
    } finally {
      setSavingKey(null);
    }
  };

  const handleCancelProfileAssignment = async (assignment: ProfileHandoverAssignment, record: ProfileAssignmentHandoverRecord) => {
    if (cancelingProfileRecordId || !window.confirm(`Batalkan serah terima ${assignment.division} untuk ${assignment.clientName}? Riwayat awal tetap tersimpan.`)) return;
    setCancelingProfileRecordId(record.id);
    try {
      const response = await api.cancelProfileAssignmentHandover(assignment.clientId, assignment.division, record.id);
      setNewlySavedProfileRecords((previous) => [...previous.filter((item) => item.id !== response.record.id), response.record]);
      success('Catatan Dibatalkan', `${response.message} ${formatDate(response.record.canceledAt || '')} · ${response.record.canceledByName}.`);
      await onRefresh();
    } catch (err: any) {
      error('Gagal Membatalkan Catatan', err.message || 'Periksa koneksi lalu coba kembali.');
    } finally {
      setCancelingProfileRecordId(null);
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

  const handleDeleteHandover = async () => {
    if (!deleteTarget || deletingRecordId || currentUser.role !== 'Admin') return;
    const { job, record } = deleteTarget;
    setDeletingRecordId(record.id);
    try {
      const response = await api.deleteJobHandover(job.id, record.id);
      setDeletedRecordIds((previous) => new Set(previous).add(record.id));
      setNewlySavedRecords((previous) => previous.filter((item) => item.id !== record.id));
      success('Catatan Dihapus', response.message);
      setDeleteTarget(null);
      await onRefresh();
    } catch (err: any) {
      error('Gagal Menghapus Catatan', err.message || 'Periksa koneksi lalu coba kembali.');
    } finally {
      setDeletingRecordId(null);
    }
  };

  const handleRemoveUnconfiguredJobFromRecap = async () => {
    if (!removeFromRecapTarget || removingFromRecapJobId || currentUser.role !== 'Admin') return;
    const job = removeFromRecapTarget;
    setRemovingFromRecapJobId(job.id);
    try {
      const response = await api.removeUnconfiguredJobFromHandoverRecap(job.id);
      success('Job Dikeluarkan dari Rekap', response.message);
      setRemoveFromRecapTarget(null);
      await onRefresh();
    } catch (err: any) {
      error('Gagal Mengeluarkan Job', err.message || 'Periksa koneksi lalu coba kembali.');
    } finally {
      setRemovingFromRecapJobId(null);
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

  useEffect(() => {
    const dialog = deleteDialogRef.current;
    if (!deleteTarget || !dialog || dialog.open) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [deleteTarget]);

  useEffect(() => {
    const dialog = removeFromRecapDialogRef.current;
    if (!removeFromRecapTarget || !dialog || dialog.open) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [removeFromRecapTarget]);

  return (
    <>
    <section className="flex flex-col gap-5" aria-labelledby="handover-page-title">
      <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
          <ClipboardCheck className="size-5" />
        </div>
        <div>
          <h1 id="handover-page-title" className="text-lg font-bold tracking-tight text-slate-900">Rekap Serah Terima</h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-600">PIC yang ditugaskan mencatat serah terima untuk tugas/job yang benar-benar ada: ke klien, antar divisi Accounting ��� Tax, atau Tim Internal Lain. Riwayat dan pembatalan tersimpan; Admin dapat menghapus catatan atau mengeluarkan job lama yang tujuan serah terimanya belum diatur dari rekap tanpa menghapus data job.</p>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="handover-summary-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="handover-summary-title" className="text-sm font-bold text-slate-900">Ringkasan Rekap</h2>
            <p className="mt-1 text-[11px] text-slate-500">Mengikuti filter klien, PIC, periode, dan tujuan untuk job serta assignment tanpa job.</p>
          </div>
          <span className="text-[10px] font-medium text-slate-400">{summaryJobs.length + summaryProfileAssignments.length} item</span>
        </div>
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-5">
          {[
            { key: 'delivered' as const, label: 'Terkirim / Diserahkan', count: activeSummaryRecords.length + activeProfileSummaryCount, color: 'emerald' },
            { key: 'handover' as const, label: 'Checklist Terbuka', count: pendingHandoverCount, color: 'sky' },
            { key: 'review' as const, label: 'Menunggu Review', count: pendingReviewCount, color: 'amber' },
            { key: 'canceled' as const, label: 'Catatan Dibatalkan', count: canceledSummaryRecords.length + canceledProfileSummaryCount, color: 'rose' },
            { key: 'unconfigured' as const, label: 'Tujuan Belum Diatur', count: unconfiguredJobCount, color: 'amber' },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={statusFilter === item.key}
              aria-label={`${item.label}: ${item.count}. Tampilkan item terkait.`}
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
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 xl:grid-cols-5">
          {directionSummary.map((item) => (
            <div key={item.direction} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
              <span className="truncate text-[11px] font-medium text-slate-600">{item.label}</span>
              <span className="shrink-0 text-sm font-bold tabular-nums text-slate-900">{item.count}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <label className="relative sm:col-span-2 xl:col-span-1">
            <span className="sr-only">Cari job, assignment, klien, PIC, atau reviewer</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Cari job, assignment, atau klien..." className="min-h-11 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs text-slate-900 outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-100" />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Klien
            <select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)} className="min-h-11 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium normal-case tracking-normal text-slate-700 outline-none focus:border-amber-500">
              <option value="All">Semua Klien</option>
              {clients.slice().sort((a, b) => a.name.localeCompare(b.name)).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            PIC
            <select value={picFilter} onChange={(event) => setPicFilter(event.target.value)} className="min-h-11 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium normal-case tracking-normal text-slate-700 outline-none focus:border-amber-500">
              <option value="All">Semua PIC</option>
              {availablePics.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
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
              <option value="unconfigured">Tujuan Belum Diatur</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Bulan mulai
            <input type="month" value={periodFrom} onChange={(event) => setPeriodFrom(event.target.value)} aria-label="Bulan mulai rekap serah terima" className="min-h-11 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium normal-case tracking-normal text-slate-700 outline-none focus:border-amber-500" />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Sampai bulan
            <input type="month" value={periodTo} onChange={(event) => setPeriodTo(event.target.value)} aria-label="Bulan akhir rekap serah terima" className="min-h-11 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium normal-case tracking-normal text-slate-700 outline-none focus:border-amber-500" />
          </label>
        </div>

        <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap items-center gap-2" aria-label="Filter tujuan serah terima">
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Tujuan</span>
            {([
              ['All', 'Semua'],
              ['client', 'Klien'],
              ['internal', 'Internal'],
            ] as const).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={destinationFilter === value} onClick={() => setDestinationFilter(value)} className={`min-h-9 rounded-full px-3 text-[11px] font-semibold transition-colors ${destinationFilter === value ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2" aria-label="Filter arah serah terima">
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Arah</span>
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
              subtitle={`Filter: ${statusFilter} · Klien: ${clientFilter === 'All' ? 'Semua klien' : clients.find((client) => client.id === clientFilter)?.name || 'Klien'} · PIC: ${picFilter === 'All' ? 'Semua PIC' : availablePics.find(([id]) => id === picFilter)?.[1] || 'PIC'} · Periode: ${periodLabel} · Tujuan: ${destinationFilter === 'All' ? 'Semua tujuan' : destinationFilter === 'client' ? 'Klien' : 'Internal'} · Arah: ${directionFilter === 'All' ? 'Semua arah' : HANDOVER_OPTIONS.find((option) => option.direction === directionFilter)?.label || 'Arah'} · ${filteredJobs.length + filteredProfileAssignments.length} item`}
              columns={handoverExportColumns}
              data={handoverExportRows}
              label="Ekspor Rekap"
              className="ml-auto"
            />
            <span className="text-[11px] tabular-nums text-slate-400">{filteredJobs.length + filteredProfileAssignments.length} item</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3" aria-label="Daftar rekap serah terima">
        {filteredJobs.length === 0 && filteredProfileAssignments.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center">
            <ClipboardCheck className="mx-auto size-8 text-slate-300" />
            <h2 className="mt-3 text-sm font-semibold text-slate-800">Tidak ada item yang cocok</h2>
            <p className="mt-1 text-xs text-slate-500">Ubah filter klien, PIC, tujuan, arah, periode, atau pencarian untuk menemukan job maupun assignment.</p>
          </div>
        )}
        {filteredJobs.map((job, index) => {
          const client = clientsById.get(job.clientId);
          const jobHistory = recordsByJobId.get(job.id) || [];
          const jobOptions = visibleChecklistOptions.filter((option) => {
            const key = `${job.id}:${option.direction}`;
            return isDirectionRequired(job, option.direction, client) || recordByKey.has(key) || canceledRecordByKey.has(key);
          });
          const allRequiredOptions = HANDOVER_OPTIONS.filter((option) => isDirectionRequired(job, option.direction, client));
          const requiredOptions = visibleChecklistOptions.filter((option) => isDirectionRequired(job, option.direction, client));
          const doneCount = requiredOptions.filter((option) => recordByKey.has(`${job.id}:${option.direction}`)).length;
          const isReviewed = job.status === 'Selesai';
          const responsibility = getHandoverServiceResponsibility(job, client);
          const isTrackedAssignment = responsibility === 'Tim 3' || responsibility === 'Tim Internal Lain';
          const canceledRecords = jobHistory.filter((record) => Boolean(record.canceledAt) && ACTIVE_HANDOVER_DIRECTIONS.has(record.direction) && visibleChecklistOptions.some((option) => option.direction === record.direction)).sort((a, b) => (b.canceledAt || '').localeCompare(a.canceledAt || ''));
          const legacyRecords = jobHistory.filter((record) => !ACTIVE_HANDOVER_DIRECTIONS.has(record.direction) && (destinationFilter === 'All' || getHandoverDestination(record.direction) === destinationFilter) && directionFilter === 'All').sort((a, b) => b.sentAt.localeCompare(a.sentAt));
          const configuredDestinationLabel = getConfiguredDestinationLabel(job, client);
          const destinationLabel = configuredDestinationLabel === 'Belum diatur' ? 'Tujuan belum diatur' : configuredDestinationLabel;

          return (
            <article key={job.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[10px] font-semibold text-slate-500">{job.id}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${job.division === 'Tax' ? 'bg-amber-50 text-amber-800' : 'bg-sky-50 text-sky-800'}`}>{job.division}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{job.clientName}</span>
                    </div>
                    <h2 className="text-sm font-bold leading-5 text-slate-900">{job.title}</h2>
                    <p className="mt-1 text-[11px] text-slate-500">PIC {getHandoverPicLabel(job)} <span className="px-1 text-slate-300">·</span> SPV {job.spvName}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${!isTrackedAssignment ? 'bg-slate-100 text-slate-500' : isReviewed ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
                      {!isTrackedAssignment ? 'Di luar cakupan serah terima' : isReviewed ? 'Review selesai' : 'Menunggu SPV'}
                    </span>
                    {!isHandoverConfigured(job, client) ? (
                      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-800">Atur tujuan</span>
                    ) : !isReviewed ? (
                      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-800">Aktif setelah review</span>
                    ) : allRequiredOptions.length === 0 ? (
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">Tidak perlu serah terima</span>
                    ) : requiredOptions.length === 0 ? (
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">Tidak ada item di filter ini</span>
                    ) : doneCount === requiredOptions.length ? (
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-800">Serah terima selesai · {doneCount}/{requiredOptions.length}</span>
                    ) : (
                      <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-semibold text-sky-800">Menunggu {requiredOptions.length - doneCount} serah terima · {doneCount}/{requiredOptions.length}</span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-[10px]">
                  <span className="font-semibold uppercase tracking-wide text-slate-400">Serah ke</span>
                  <span className={`rounded-full px-2 py-1 font-semibold ${!isHandoverConfigured(job, client) ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{destinationLabel}</span>
                  <span className="text-slate-400">Tanggung jawab: {responsibility}</span>
                  {isReviewed && job.completedAt && <span className="text-slate-400">Selesai {formatDate(job.completedAt)}</span>}
                  <span className="ml-auto text-slate-400">{index + 1} / {filteredJobs.length}</span>
                </div>

                {!isHandoverConfigured(job, client) && (
                  <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-[11px] leading-5 text-amber-900 sm:flex-row sm:items-center sm:justify-between">
                    <p>Tujuan job lama ini belum diatur dan belum dihitung sebagai checklist terbuka. Minta Admin/SPV mengatur Klien/Internal lewat <span className="font-semibold">Job Management → Edit Tugas</span>.</p>
                    {currentUser.role === 'Admin' && (
                      <button
                        type="button"
                        onClick={() => setRemoveFromRecapTarget(job)}
                        disabled={Boolean(removingFromRecapJobId)}
                        className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 self-start rounded-lg border border-rose-200 bg-white px-3 text-[10px] font-semibold text-rose-700 transition hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:cursor-wait disabled:opacity-50 sm:self-auto"
                        aria-label={`Hapus ${job.title} dari rekap serah terima`}
                      >
                        <Trash2 className="size-3.5" /> Hapus dari rekap
                      </button>
                    )}
                  </div>
                )}
                {isHandoverConfigured(job, client) && allRequiredOptions.length === 0 && (
                  <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-[11px] text-slate-500">Tidak ada dokumen serah terima yang perlu dicatat untuk job ini.</p>
                )}

                {jobOptions.length > 0 && (
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {jobOptions.map((option) => {
                      const key = `${job.id}:${option.direction}`;
                      const record = recordByKey.get(key);
                      return (
                        <HandoverChecklistCell
                          key={option.direction}
                          job={job}
                          option={option}
                          record={record}
                          canceledRecord={canceledRecordByKey.get(key)}
                          applicable={isDirectionApplicable(job, option.direction, client)}
                          canRecord={canRecordDirection(job, option.direction, currentUser, client)}
                          saving={savingKey === key}
                          busy={Boolean(savingKey)}
                          canCancel={Boolean(record && canCancelHandover(record, currentUser, job))}
                          canDelete={currentUser.role === 'Admin'}
                          onRecord={(targetJob, direction) => void handleRecordHandover(targetJob, direction)}
                          onCancel={(targetJob, targetRecord) => setCancelTarget({ job: targetJob, record: targetRecord })}
                          onDelete={(targetJob, targetRecord) => setDeleteTarget({ job: targetJob, record: targetRecord })}
                        />
                      );
                    })}
                  </div>
                )}

                {canceledRecords.length > 0 && (
                  <details className="rounded-xl border border-rose-100 bg-rose-50/40 p-3" aria-label={`Catatan dibatalkan untuk ${job.title}`}>
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[11px] font-bold text-rose-900">
                      Riwayat catatan dibatalkan
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-800">{canceledRecords.length}</span>
                    </summary>
                    <div className="mt-3 flex flex-col gap-2">
                      {canceledRecords.map((record) => (
                        <div key={record.id} className="flex flex-col gap-2 rounded-lg border border-rose-100 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-800">{getHandoverDirectionLabel(record.direction)}</p>
                            <p className="mt-1 text-[10px] leading-4 text-slate-500">Dikirim {formatDate(record.sentAt)} oleh {record.sentByName} <span className="px-1 text-slate-300">·</span> Dibatalkan {formatDate(record.canceledAt || '')} oleh {record.canceledByName || 'pengguna'}</p>
                          </div>
                          {currentUser.role === 'Admin' && (
                            <button
                              type="button"
                              onClick={() => setDeleteTarget({ job, record })}
                              className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-rose-200 px-3 text-[10px] font-semibold text-rose-700 transition hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                              aria-label={`Hapus permanen catatan ${record.direction} untuk ${job.title}`}
                            >
                              <Trash2 className="size-3.5" /> Hapus
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {legacyRecords.length > 0 && (
                  <details className="rounded-xl border border-slate-200 bg-slate-50/70 p-3" aria-label={`Riwayat serah terima lama untuk ${job.title}`}>
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[11px] font-semibold text-slate-700">
                      Riwayat format serah terima sebelumnya
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-700">{legacyRecords.length}</span>
                    </summary>
                    <div className="mt-3 flex flex-col gap-2">
                      {legacyRecords.map((record) => (
                        <div key={record.id} className="rounded-lg border border-slate-200 bg-white p-3">
                          <p className="text-xs font-semibold text-slate-800">{getHandoverDirectionLabel(record.direction)}</p>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-[10px] leading-4 text-slate-500">
                              Dikirim {formatDate(record.sentAt)} oleh {record.sentByName}
                              {record.canceledAt && ` · Dibatalkan ${formatDate(record.canceledAt)} oleh ${record.canceledByName || 'pengguna'}`}
                            </p>
                            {currentUser.role === 'Admin' && (
                              <button
                                type="button"
                                onClick={() => setDeleteTarget({ job, record })}
                                className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 self-start rounded-lg border border-rose-200 px-3 text-[10px] font-semibold text-rose-700 transition hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 sm:self-auto"
                                aria-label={`Hapus permanen catatan ${record.direction} untuk ${job.title}`}
                              >
                                <Trash2 className="size-3.5" /> Hapus
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </article>
          );
        })}
        {filteredProfileAssignments.map((assignment) => {
          const key = `${assignment.clientId}:${assignment.division}`;
          const record = profileRecordByKey.get(key);
          const canceledRecord = canceledProfileRecordByKey.get(key);
          return (
            <ProfileAssignmentHandoverCard
              key={`${key}:${record?.id || canceledRecord?.id || 'pending'}`}
              assignment={{ ...assignment, record, canceledRecord }}
              currentUser={currentUser}
              savingKey={savingKey}
              cancelingRecordId={cancelingProfileRecordId}
              onRecord={(target, destinationDivision) => void handleRecordProfileAssignment(target, destinationDivision)}
              onCancel={(target, targetRecord) => void handleCancelProfileAssignment(target, targetRecord)}
            />
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
            Catatan {getHandoverDirectionLabel(cancelTarget.record.direction)} untuk <span className="font-semibold text-slate-800">{cancelTarget.job.title}</span> akan ditandai dibatalkan. Riwayat pengiriman awal tetap tersimpan.
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

    <dialog
      ref={deleteDialogRef}
      aria-labelledby="delete-handover-title"
      aria-describedby="delete-handover-description"
      onCancel={(event) => {
        event.preventDefault();
        setDeleteTarget(null);
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-transparent p-0 text-slate-900 shadow-none backdrop:bg-slate-950/60 backdrop:backdrop-blur-sm"
    >
      {deleteTarget && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6">
          <div className="flex size-10 items-center justify-center rounded-xl bg-rose-50 text-rose-700">
            <Trash2 className="size-5" />
          </div>
          <h2 id="delete-handover-title" className="mt-4 text-base font-bold text-slate-900">Hapus catatan serah terima?</h2>
          <p id="delete-handover-description" className="mt-2 text-sm leading-6 text-slate-600">Catatan serah terima ini untuk <span className="font-semibold text-slate-800">{deleteTarget.job.title}</span> akan dihapus permanen dari rekap. Aktivitas penghapusan tetap tercatat di audit log.</p>
          <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-600">{getHandoverDirectionLabel(deleteTarget.record.direction)} · dikirim {formatDate(deleteTarget.record.sentAt)}{deleteTarget.record.canceledAt && ` · dibatalkan ${formatDate(deleteTarget.record.canceledAt)}`}</div>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setDeleteTarget(null)} disabled={Boolean(deletingRecordId)} className="min-h-10 rounded-lg border border-slate-200 px-4 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">Kembali</button>
            <button type="button" onClick={() => void handleDeleteHandover()} disabled={Boolean(deletingRecordId)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-rose-700 px-4 text-xs font-semibold text-white transition hover:bg-rose-800 disabled:cursor-wait disabled:opacity-60"><Trash2 className="size-3.5" />{deletingRecordId ? 'Menghapus...' : 'Hapus permanen'}</button>
          </div>
        </div>
      )}
    </dialog>

    <dialog
      ref={removeFromRecapDialogRef}
      aria-labelledby="remove-handover-recap-title"
      aria-describedby="remove-handover-recap-description"
      onCancel={(event) => {
        event.preventDefault();
        setRemoveFromRecapTarget(null);
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-transparent p-0 text-slate-900 shadow-none backdrop:bg-slate-950/60 backdrop:backdrop-blur-sm"
    >
      {removeFromRecapTarget && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6">
          <div className="flex size-10 items-center justify-center rounded-xl bg-rose-50 text-rose-700">
            <Trash2 className="size-5" />
          </div>
          <h2 id="remove-handover-recap-title" className="mt-4 text-base font-bold text-slate-900">Hapus job dari rekap serah terima?</h2>
          <p id="remove-handover-recap-description" className="mt-2 text-sm leading-6 text-slate-600">
            <span className="font-semibold text-slate-800">{removeFromRecapTarget.title}</span> tidak akan ditampilkan lagi di rekap serah terima. Data job tetap tersimpan di Job Management; tindakan ini tidak menghapus job atau catatan serah terima.
          </p>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setRemoveFromRecapTarget(null)} disabled={Boolean(removingFromRecapJobId)} className="min-h-10 rounded-lg border border-slate-200 px-4 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">Kembali</button>
            <button type="button" onClick={() => void handleRemoveUnconfiguredJobFromRecap()} disabled={Boolean(removingFromRecapJobId)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-rose-700 px-4 text-xs font-semibold text-white transition hover:bg-rose-800 disabled:cursor-wait disabled:opacity-60"><Trash2 className="size-3.5" />{removingFromRecapJobId ? 'Menghapus...' : 'Ya, hapus dari rekap'}</button>
          </div>
        </div>
      )}
    </dialog>
    </>
  );
}
