import { useMemo, useState } from 'react';
import {
  Building2,
  Briefcase,
  AlertCircle,
  Clock,
  ShieldAlert,
  RefreshCw,
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  ClipboardList,
  FileText,
} from 'lucide-react';
import type { CurrentUser, MeetingMinute, TeamAgendaEntry, Job, Case } from '../lib/api';

interface DashboardViewProps {
  stats: any;
  jobs: Job[];
  cases: Case[];
  agendaEntries: TeamAgendaEntry[];
  meetingMinutes: MeetingMinute[];
  currentUser: CurrentUser;
  onNavigateTab: (tab: any, filter?: { status?: string; followUp?: 'Overdue' }) => void;
  onOpenJob: (jobId: string) => void;
  onOpenCase: (caseId: string) => void;
  onRefresh: (division?: 'All' | 'Accounting' | 'Tax') => void;
  isRefreshing?: boolean;
  lastUpdated?: string;
  onDivisionChange: (division: 'All' | 'Accounting' | 'Tax') => void;
}

function normalizeParticipant(value: string) {
  return value.trim().toLocaleLowerCase('id-ID').replace(/\s*\([^)]*\)\s*$/, '');
}

function meetingDateLabel(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);
}

function currentJakartaMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

type MonthlySummary<T> = {
  total: number;
  completed: number;
  unfinished: number;
  completedItems: T[];
  unfinishedItems: T[];
};

export function DashboardView({
  stats,
  jobs: allJobs,
  cases: allCases,
  agendaEntries,
  meetingMinutes,
  currentUser,
  onNavigateTab,
  onOpenJob,
  onOpenCase,
  onRefresh,
  isRefreshing = false,
  lastUpdated,
  onDivisionChange,
}: DashboardViewProps) {
  const isDivisionRestricted = currentUser.role.startsWith('Staff') || currentUser.role.startsWith('SPV');
  const userDivision = currentUser.role.includes('Accounting') ? 'Accounting' : 'Tax';
  const [divisionFilter, setDivisionFilter] = useState<'All' | 'Accounting' | 'Tax'>(
    isDivisionRestricted ? userDivision : 'All'
  );
  const changeDivision = (division: 'All' | 'Accounting' | 'Tax') => {
    setDivisionFilter(division);
    onDivisionChange(division);
  };
  const [fromMonth, setFromMonth] = useState(currentJakartaMonth);
  const [toMonth, setToMonth] = useState(currentJakartaMonth);
  const [expandedMonthlyCard, setExpandedMonthlyCard] = useState<string | null>(null);
  const validMonthRange = fromMonth <= toMonth;
  const myRevisionJobs = useMemo(
    () => currentUser.role.startsWith('Staff')
      ? allJobs
          .filter((job) => job.picId === currentUser.id && job.status === 'Perlu Revisi')
          .sort((a, b) => a.deadline.localeCompare(b.deadline))
      : [],
    [allJobs, currentUser.id, currentUser.role]
  );
  const monthlySummary = useMemo(() => {
    const roleDivision = currentUser.role.includes('Accounting') ? 'Accounting' : currentUser.role.includes('Tax') ? 'Tax' : null;
    const selectedDivision = roleDivision || (divisionFilter === 'All' ? null : divisionFilter);
    const scopedJobs = allJobs.filter((job) => {
      if (selectedDivision && job.division !== selectedDivision) return false;
      if (currentUser.role.startsWith('Staff') && job.picId !== currentUser.id) return false;
      const month = job.recurringMonth || job.startDate?.slice(0, 7) || job.createdAt.slice(0, 7);
      return validMonthRange && month >= fromMonth && month <= toMonth;
    });
    const scopedCases = allCases.filter((item) => {
      if (selectedDivision && item.division !== selectedDivision) return false;
      if (currentUser.role.startsWith('Staff') && item.picId !== currentUser.id && item.followUpPicId !== currentUser.id) return false;
      const month = item.createdAt.slice(0, 7);
      return validMonthRange && month >= fromMonth && month <= toMonth;
    });
    const summarize = <T,>(items: T[], isDone: (item: T) => boolean): MonthlySummary<T> => {
      const completedItems = items.filter(isDone);
      const unfinishedItems = items.filter((item) => !isDone(item));
      return {
        total: items.length,
        completed: completedItems.length,
        unfinished: unfinishedItems.length,
        completedItems,
        unfinishedItems,
      };
    };
    return {
      continuing: summarize(scopedJobs.filter((job) => job.jobType === 'Continuing'), (job) => job.status === 'Selesai'),
      additional: summarize(scopedJobs.filter((job) => job.jobType !== 'Continuing'), (job) => job.status === 'Selesai'),
      cases: summarize(scopedCases, (item) => item.status === 'Resolved' || item.status === 'Closed'),
    };
  }, [allJobs, allCases, currentUser.id, currentUser.role, divisionFilter, fromMonth, toMonth, validMonthRange]);

  if (!stats) {
    return (
      <div className="p-8 text-center bg-white border border-slate-200 rounded-xl">
        <div className="w-8 h-8 border-2 border-amber-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-slate-500">Memuat metrik aktual dashboard...</p>
      </div>
    );
  }

  const { clients, jobs, cases, activities, workload } = stats;
  const assignedCases = cases.assigned || [];
  const participantAliases = new Set([currentUser.name, currentUser.username, currentUser.email].filter(Boolean).map(normalizeParticipant));
  const myUpcomingMeetings = agendaEntries
    .filter((entry) => entry.status === 'Terjadwal' && entry.date >= new Date().toISOString().slice(0, 10))
    .filter((entry) => entry.participantUserIds?.includes(currentUser.id) || entry.participants.some((person) => participantAliases.has(normalizeParticipant(person))))
    .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))
    .slice(0, 4);
  const myMeetingMinutes = meetingMinutes
    .filter((meeting) => meeting.attendeeUserIds?.includes(currentUser.id) || meeting.attendees.some((person) => participantAliases.has(normalizeParticipant(person))))
    .sort((a, b) => `${b.meetingDate}${b.startTime}`.localeCompare(`${a.meetingDate}${a.startTime}`))
    .slice(0, 4);
  const myMeetingTasks = meetingMinutes
    .flatMap((meeting) => meeting.actionItems
      .filter((action) => action.status !== 'Selesai' && (
        action.ownerUserId === currentUser.id ||
        (action.ownerUserId === undefined && participantAliases.has(normalizeParticipant(action.owner)))
      ))
      .map((action) => ({ action, meeting })))
    .sort((a, b) => (a.action.deadline || a.meeting.meetingDate).localeCompare(b.action.deadline || b.meeting.meetingDate))
    .slice(0, 4);
  const isReadOnly = currentUser.role === 'Owner' || currentUser.role === 'Manager';

  return (
    <div className="space-y-6">
      {/* Top Banner & Refresh Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">
              Ringkasan Kendali Operasional
            </h2>
            {isReadOnly && (
              <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                Mode Akses: Read-Only
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Data aktual dari basis 50 klien TMM/BMA. Pengguna:{' '}
            <span className="font-semibold text-slate-700">{currentUser.name}</span> ({currentUser.role})
          </p>
        </div>

        {/* Division Filter & Explicit Refresh Button */}
        <div className="flex items-center gap-3 self-start sm:self-auto">
          {/* Division Filter */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs">
            {!isDivisionRestricted && <button
              onClick={() => changeDivision('All')}
              className={`px-3 py-1.5 rounded-md font-medium transition-all ${
                divisionFilter === 'All'
                  ? 'bg-white text-slate-900 shadow-sm font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Semua Divisi
            </button>}
            {!isDivisionRestricted && <button
              onClick={() => changeDivision('Accounting')}
              className={`px-3 py-1.5 rounded-md font-medium transition-all ${
                divisionFilter === 'Accounting'
                  ? 'bg-white text-slate-900 shadow-sm font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Accounting
            </button>}
            {!isDivisionRestricted && <button
              onClick={() => changeDivision('Tax')}
              className={`px-3 py-1.5 rounded-md font-medium transition-all ${
                divisionFilter === 'Tax'
                  ? 'bg-white text-slate-900 shadow-sm font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Tax
            </button>}
            {isDivisionRestricted && <span className="px-3 py-1.5 rounded-md bg-white text-slate-900 shadow-sm font-semibold">{userDivision}</span>}
          </div>

          {/* Refresh Button with Last Updated Timestamp */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => onRefresh(divisionFilter)}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-sm transition-colors disabled:opacity-50"
              title="Segarkan data bersama dari database"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-amber-600' : 'text-slate-600'}`} />
              <span>{isRefreshing ? 'Memuat Data...' : 'Muat Ulang'}</span>
            </button>
            {lastUpdated && (
              <span className="hidden md:inline-block text-[11px] text-slate-400 font-mono tabular-nums">
                {lastUpdated}
              </span>
            )}
          </div>
        </div>
      </div>

      <section aria-labelledby="monthly-activity-heading" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-700">Rekap periode</p>
            <h2 id="monthly-activity-heading" className="mt-1 text-sm font-semibold text-slate-900">Penyelesaian tugas per kelompok</h2>
            <p className="mt-1 text-xs text-slate-500">Status saat ini untuk tugas yang dibuat pada rentang bulan terpilih.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:min-w-[19rem]">
            <label className="text-[11px] font-semibold text-slate-600">Dari bulan
              <input type="month" value={fromMonth} max={toMonth} onChange={(event) => setFromMonth(event.target.value)} aria-label="Bulan awal rekap" className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-800" />
            </label>
            <label className="text-[11px] font-semibold text-slate-600">Sampai bulan
              <input type="month" value={toMonth} min={fromMonth} onChange={(event) => setToMonth(event.target.value)} aria-label="Bulan akhir rekap" className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-800" />
            </label>
          </div>
        </div>
        {!validMonthRange && <p role="alert" className="mt-3 text-xs font-medium text-rose-600">Rentang bulan tidak valid. Pilih bulan akhir yang sama atau setelah bulan awal.</p>}
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {([
            { key: 'continuing', title: 'Job berkelanjutan', summary: monthlySummary.continuing, icon: CalendarDays, accent: 'text-sky-700 bg-sky-50', kind: 'job' as const },
            { key: 'additional', title: 'Job Management tambahan', summary: monthlySummary.additional, icon: Briefcase, accent: 'text-amber-700 bg-amber-50', kind: 'job' as const },
            { key: 'cases', title: 'Case Register', summary: monthlySummary.cases, icon: ShieldAlert, accent: 'text-rose-700 bg-rose-50', kind: 'case' as const },
          ]).map(({ key, title, summary, icon: Icon, accent, kind }) => {
            const isExpanded = expandedMonthlyCard === key;
            const groups = kind === 'job'
              ? [
                  { label: 'Selesai', items: summary.completedItems as Job[], color: 'text-emerald-700', empty: 'Belum ada tugas selesai.' },
                  { label: 'Belum selesai', items: summary.unfinishedItems as Job[], color: 'text-amber-700', empty: 'Semua tugas sudah selesai.' },
                ]
              : [
                  { label: 'Selesai', items: summary.completedItems as Case[], color: 'text-emerald-700', empty: 'Belum ada kasus selesai.' },
                  { label: 'Belum selesai', items: summary.unfinishedItems as Case[], color: 'text-amber-700', empty: 'Semua kasus sudah selesai.' },
                ];

            return (
              <article key={key} className={`overflow-hidden rounded-lg border bg-slate-50/70 transition-colors ${isExpanded ? 'border-slate-300' : 'border-slate-200'}`}>
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  aria-controls={`monthly-details-${key}`}
                  onClick={() => setExpandedMonthlyCard(isExpanded ? null : key)}
                  className="w-full p-3.5 text-left transition-colors hover:bg-slate-100/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-inset"
                >
                  <span className="flex items-center gap-2"><span className={`rounded-lg p-2 ${accent}`}><Icon className="size-4" aria-hidden="true" /></span><span className="text-xs font-semibold text-slate-800">{title}</span></span>
                  <span className="mt-3 block text-2xl font-bold tabular-nums text-slate-900">{summary.total}<span className="ml-1.5 text-[11px] font-medium text-slate-500">total tugas</span></span>
                  <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-200 pt-2 text-[11px]">
                    <span className="text-emerald-700">Selesai <strong className="tabular-nums">{summary.completed}</strong></span>
                    <span className="text-amber-700">Belum selesai <strong className="tabular-nums">{summary.unfinished}</strong></span>
                    <span className="ml-auto text-slate-500">{isExpanded ? 'Tutup rincian' : 'Lihat rincian'}</span>
                  </span>
                </button>
                {isExpanded && (
                  <div id={`monthly-details-${key}`} className="grid gap-3 border-t border-slate-200 p-3.5 sm:grid-cols-2">
                    {groups.map((group) => (
                      <section key={group.label} aria-label={`${group.label}: ${group.items.length}`}>
                        <h4 className={`mb-2 text-[11px] font-bold ${group.color}`}>{group.label} <span className="tabular-nums">({group.items.length})</span></h4>
                        {group.items.length ? (
                          <ul className="max-h-64 space-y-1.5 overflow-y-auto">
                            {group.items.map((item) => (
                              <li key={item.id}>
                                <button
                                  type="button"
                                  onClick={() => kind === 'job' ? onOpenJob(item.id) : onOpenCase(item.id)}
                                  className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-left transition-colors hover:border-amber-300 hover:bg-amber-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                                >
                                  <span className="block truncate text-[11px] font-semibold text-slate-800">{item.title}</span>
                                  <span className="mt-1 flex flex-wrap items-center gap-x-1 text-[10px] text-slate-500">
                                    <span>{item.clientName}</span><span aria-hidden="true">·</span>
                                    <span>{kind === 'job' ? (item as Job).status : (item as Case).status}</span>
                                    {kind === 'job' && (item as Job).deadline && <><span aria-hidden="true">·</span><span>Tenggat {(item as Job).deadline}</span></>}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="rounded-md border border-dashed border-slate-200 px-2.5 py-3 text-[10px] text-slate-500">{group.empty}</p>
                        )}
                      </section>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {currentUser.role.startsWith('Staff') && (
        <section aria-labelledby="my-revision-jobs-heading" className="rounded-xl border border-rose-200 bg-rose-50/60 p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="rounded-xl bg-rose-100 p-2.5 text-rose-700"><AlertCircle className="size-4" aria-hidden="true" /></span>
              <div>
                <h2 id="my-revision-jobs-heading" className="text-sm font-semibold text-slate-900">Pekerjaan perlu revisi <span className="text-rose-700">({myRevisionJobs.length})</span></h2>
                <p className="mt-1 text-xs text-slate-600">Catatan SPV untuk pekerjaan yang ditugaskan kepada Anda.</p>
              </div>
            </div>
            <button type="button" onClick={() => onNavigateTab('jobs')} className="inline-flex shrink-0 items-center gap-1 self-start text-xs font-semibold text-rose-700 hover:text-rose-800">Buka pekerjaan <ArrowUpRight className="size-3.5" aria-hidden="true" /></button>
          </div>
          {myRevisionJobs.length ? (
            <ul className="mt-3 divide-y divide-rose-100 rounded-lg border border-rose-100 bg-white px-3">
              {myRevisionJobs.slice(0, 5).map((job) => (
                <li key={job.id} className="flex flex-col gap-2 py-3 first:pt-3 last:pb-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{job.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{job.clientName} · {job.division} · Tenggat {job.deadline || 'belum ditentukan'}</p>
                    {job.reviewNotes?.trim() && <p className="mt-2 rounded-md bg-rose-50 px-2.5 py-2 text-xs leading-5 text-rose-900"><span className="font-semibold">Catatan SPV:</span> {job.reviewNotes}</p>}
                  </div>
                  <button type="button" onClick={() => onOpenJob(job.id)} className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1 self-start rounded-md border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-800 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2">
                    Buka detail
                    <ArrowUpRight className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
              {myRevisionJobs.length > 5 && <li className="py-2 text-center text-[11px] font-medium text-rose-700">+{myRevisionJobs.length - 5} pekerjaan revisi lainnya</li>}
            </ul>
          ) : (
            <p className="mt-3 rounded-lg border border-dashed border-rose-200 bg-white/80 px-3 py-4 text-center text-xs text-slate-600">Tidak ada pekerjaan yang perlu revisi saat ini.</p>
          )}
        </section>
      )}

      <section aria-labelledby="my-meetings-heading" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-amber-50 p-2.5 text-amber-700"><CalendarDays className="size-4" /></span>
            <div><h2 id="my-meetings-heading" className="text-sm font-semibold text-slate-900">Agenda meeting saya</h2><p className="mt-1 text-xs text-slate-500">Meeting mendatang yang mencantumkan Anda sebagai peserta.</p></div>
          </div>
          <button type="button" onClick={() => onNavigateTab('agenda')} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-amber-700 hover:text-amber-800">Semua agenda <ArrowUpRight className="size-3.5" /></button>
        </div>
        {myUpcomingMeetings.length ? <ul className="mt-4 divide-y divide-slate-100">{myUpcomingMeetings.map((entry) => <li key={entry.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"><div className="min-w-0"><p className="truncate text-sm font-medium text-slate-800">{entry.title}</p><p className="mt-1 truncate text-xs text-slate-500">{entry.clientName || entry.meetingType}{entry.location ? ` · ${entry.location}` : ''}</p></div><span className="shrink-0 text-xs font-medium tabular-nums text-slate-600">{meetingDateLabel(entry.date)} · {entry.startTime || 'Waktu belum ditentukan'}</span></li>)}</ul> : <p className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">Belum ada meeting mendatang yang mencantumkan Anda sebagai peserta.</p>}
      </section>

      <section aria-labelledby="my-minutes-heading" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-slate-100 p-2.5 text-slate-700"><FileText className="size-4" /></span>
            <div><h2 id="my-minutes-heading" className="text-sm font-semibold text-slate-900">MoM & tindak lanjut saya</h2><p className="mt-1 text-xs text-slate-500">Hasil rapat yang mencantumkan Anda dan tugas yang menjadi tanggung jawab Anda.</p></div>
          </div>
          <button type="button" onClick={() => onNavigateTab('mom')} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-amber-700 hover:text-amber-800">Semua MoM <ArrowUpRight className="size-3.5" /></button>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-xs font-semibold text-slate-700"><FileText className="size-3.5 text-slate-400" />Notulen & hasil rapat</h3>
            {myMeetingMinutes.length ? <ul className="mt-2 divide-y divide-slate-100">{myMeetingMinutes.map((meeting) => {
              const result = meeting.agendaItems.find((item) => item.decision.trim())?.decision || meeting.agendaItems.find((item) => item.topic.trim())?.topic;
              return <li key={meeting.id} className="py-3 first:pt-1 last:pb-0"><p className="truncate text-sm font-medium text-slate-800">{meeting.title}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{result || 'Hasil rapat belum dicatat.'}</p><p className="mt-1 text-[10px] font-medium text-slate-400">{meetingDateLabel(meeting.meetingDate)} · {meeting.id}</p></li>;
            })}</ul> : <p className="mt-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">Belum ada notulen rapat yang mencantumkan Anda.</p>}
          </div>
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-xs font-semibold text-slate-700"><ClipboardList className="size-3.5 text-slate-400" />Tugas rapat terbuka</h3>
            {myMeetingTasks.length ? <ul className="mt-2 divide-y divide-slate-100">{myMeetingTasks.map(({ action, meeting }) => <li key={`${meeting.id}-${action.id}`} className="py-3 first:pt-1 last:pb-0"><p className="text-sm font-medium text-slate-800">{action.description}</p><div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-500"><span className={`rounded-full px-2 py-0.5 font-semibold ${action.status === 'Dalam Proses' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{action.status}</span><span>{meeting.id} · {meeting.title}</span>{action.deadline && <span className={action.deadline < new Date().toISOString().slice(0, 10) ? 'font-semibold text-rose-600' : ''}>Tenggat {meetingDateLabel(action.deadline)}</span>}</div></li>)}</ul> : <p className="mt-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">Tidak ada tindak lanjut rapat yang masih terbuka untuk Anda.</p>}
          </div>
        </div>
      </section>

      <section aria-labelledby="my-cases-heading" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-amber-50 p-2.5 text-amber-700"><ShieldAlert className="size-4" /></span>
            <div>
              <h2 id="my-cases-heading" className="text-sm font-semibold text-slate-900">Kasus yang ditugaskan ke saya <span className="text-slate-500">({cases.assignedCount || 0})</span></h2>
              <p className="mt-1 text-xs text-slate-500">Kasus aktif saat Anda menjadi PIC utama atau PIC follow-up.</p>
            </div>
          </div>
          <button type="button" onClick={() => onNavigateTab('cases')} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-amber-700 hover:text-amber-800">Case Register <ArrowUpRight className="size-3.5" /></button>
        </div>
        {assignedCases.length ? (
          <ul className="mt-4 divide-y divide-slate-100">
            {assignedCases.map((item: { id: string; title: string; clientName: string; division: string; priority: string; status: string; nextFollowUpDate: string }) => (
              <li key={item.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">{item.title}</p>
                  <p className="mt-1 truncate text-xs text-slate-500">{item.clientName} · {item.division} · {item.id}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2 text-[11px]">
                  <span className={`rounded-full px-2 py-1 font-semibold ${item.priority === 'Tinggi' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>{item.priority}</span>
                  <span className="rounded-full bg-amber-50 px-2 py-1 font-semibold text-amber-800">{item.status}</span>
                  <span className="text-slate-500">Follow-up {item.nextFollowUpDate || 'belum dijadwalkan'}</span>
                  <button type="button" onClick={() => onOpenCase(item.id)} className="inline-flex min-h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2">Buka detail <ArrowUpRight className="size-3.5" aria-hidden="true" /></button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">Belum ada kasus aktif yang ditugaskan kepada Anda.</p>
        )}
      </section>

      {/* Incomplete PIC Alert Banner (Prompt 2 requirement) */}
      {clients.incompletePicCount > 0 && (
        <div
          onClick={() => onNavigateTab('clients')}
          className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center justify-between gap-3 cursor-pointer hover:bg-amber-100/60 transition-colors shadow-sm"
        >
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>Perhatian Penugasan:</strong> Terdapat{' '}
              <span className="font-bold underline">{clients.incompletePicCount} klien</span> dengan status{' '}
              <span className="font-semibold text-rose-700">"Pembagian PIC Tim 3 Belum Lengkap"</span> (hanya divisi dengan tanggung jawab Tim 3 yang wajib memiliki PIC utama dan SPV reviewer).
            </span>
          </div>
          <span className="font-semibold text-amber-800 text-[11px] shrink-0 underline">
            Lengkapi Penugasan PIC →
          </span>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => onNavigateTab('clients')}
          className="group w-full rounded-xl border border-slate-200/90 bg-white p-5 text-left shadow-sm transition-all hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
          aria-label={`Buka daftar klien aktif, ${clients.active} dari ${clients.total} klien terdaftar`}
        >
          <span className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Basis Klien Aktif</span>
            <Building2 className="size-4 text-slate-400 transition-colors group-hover:text-amber-600" aria-hidden="true" />
          </span>
          <span className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-extrabold tabular-nums text-slate-900">{clients.active}</span>
            <span className="text-xs text-slate-500">/ {clients.total} Terdaftar</span>
          </span>
          <span className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-[11px] text-slate-500">
            <span>Badan: <strong className="font-mono tabular-nums text-slate-800">{clients.badan}</strong></span>
            <span aria-hidden="true">·</span>
            <span>OP: <strong className="font-mono tabular-nums text-slate-800">{clients.op}</strong></span>
            <span aria-hidden="true">·</span>
            <span>PKP: <strong className="font-mono tabular-nums text-slate-800">{clients.pkp}</strong></span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => onNavigateTab('jobs', { status: 'Siap Direview' })}
          className="group w-full rounded-xl border border-slate-200/90 bg-white p-5 text-left shadow-sm transition-all hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
          aria-label={`Buka ${jobs.readyForReview} pekerjaan yang menunggu review SPV`}
        >
          <span className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Pekerjaan Siap Review SPV</span>
            <Briefcase className="size-4 text-slate-400 transition-colors group-hover:text-amber-600" aria-hidden="true" />
          </span>
          <span className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-extrabold tabular-nums text-amber-600">{jobs.readyForReview}</span>
            <span className="text-xs text-slate-500">Menunggu Approval</span>
          </span>
          <span className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-[11px] text-slate-500">
            <span>Proses: <strong className="font-mono tabular-nums text-slate-800">{jobs.inProgress}</strong></span>
            <span aria-hidden="true">·</span>
            <span>Revisi: <strong className="font-mono tabular-nums text-rose-600">{jobs.needsRevision}</strong></span>
            <span aria-hidden="true">·</span>
            <span>Selesai: <strong className="font-mono tabular-nums text-emerald-600">{jobs.completed}</strong></span>
          </span>
        </button>

        <div className="group flex w-full flex-col rounded-xl border border-rose-200 bg-white shadow-sm transition-colors hover:border-rose-300">
          <button
            type="button"
            onClick={() => onNavigateTab('jobs', { status: 'Terlambat' })}
            className="w-full flex-1 rounded-t-xl p-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-inset"
            aria-label={`Buka ${jobs.overdue} pekerjaan yang terlambat`}
          >
            <span className="flex items-center justify-between text-xs font-medium text-slate-500">
              <span>Pekerjaan Jatuh Tempo</span>
              <Clock className={`size-4 ${jobs.overdue > 0 ? 'text-rose-500' : 'text-slate-400'}`} aria-hidden="true" />
            </span>
            <span className="mt-3 flex items-baseline gap-2">
              <span className={`font-mono text-3xl font-extrabold tabular-nums ${jobs.overdue > 0 ? 'text-rose-600' : 'text-slate-900'}`}>{jobs.overdue}</span>
              <span className="text-xs text-slate-500">Terlambat</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => onNavigateTab('followup', { followUp: 'Overdue' })}
            disabled={cases.overdueFollowUps === 0}
            className="mx-5 mb-4 flex min-h-9 items-center justify-between gap-2 border-t border-slate-100 pt-3 text-left text-[11px] text-slate-500 transition-colors enabled:hover:text-rose-600 enabled:focus-visible:outline-none enabled:focus-visible:ring-2 enabled:focus-visible:ring-rose-500 disabled:cursor-not-allowed disabled:opacity-70"
            aria-label={`Buka ${cases.overdueFollowUps} follow-up lewat batas`}
          >
            <span>Follow-up lewat batas</span>
            <strong className="font-mono tabular-nums text-rose-600">{cases.overdueFollowUps}</strong>
          </button>
        </div>

        <button
          type="button"
          onClick={() => onNavigateTab('cases', { status: 'Terbuka' })}
          className="group w-full rounded-xl border border-slate-200/90 bg-white p-5 text-left shadow-sm transition-all hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
          aria-label={`Buka ${cases.open} kasus terbuka dan risiko`}
        >
          <span className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Kasus Terbuka & Risiko</span>
            <ShieldAlert className="size-4 text-slate-400 transition-colors group-hover:text-amber-600" aria-hidden="true" />
          </span>
          <span className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-extrabold tabular-nums text-slate-900">{cases.open}</span>
            <span className="text-xs text-slate-500">Kasus Terbuka</span>
          </span>
          <span className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-[11px] text-slate-500">
            <span>High Tax: <strong className="font-mono tabular-nums text-amber-700">{clients.taxRisks.High}</strong></span>
            <span aria-hidden="true">·</span>
            <span>High Acc: <strong className="font-mono tabular-nums text-amber-700">{clients.accRisks.High}</strong></span>
          </span>
        </button>
      </div>

      {/* Two Column Layout: Compliance Distribution & Separate Risk Matrices */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Compliance & Tax Profile Matrix */}
        <div className="p-5 bg-white border border-slate-200 rounded-xl shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 tracking-tight">
              Distribusi Rezim Pajak & Kepatuhan PKP
            </h3>
            <span className="text-xs text-slate-400 font-mono tabular-nums">Total {clients.active} Klien</span>
          </div>

          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs text-slate-600 mb-1">
                <span>Status PKP ({clients.pkp} PKP · {clients.nonPkp} Non-PKP)</span>
                <span className="font-mono tabular-nums font-semibold text-slate-800">
                  {Math.round((clients.pkp / (clients.active || 1)) * 100)}% PKP
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden flex">
                <div
                  className="bg-amber-600 h-full"
                  style={{ width: `${(clients.pkp / (clients.active || 1)) * 100}%` }}
                />
                <div
                  className="bg-slate-300 h-full"
                  style={{ width: `${(clients.nonPkp / (clients.active || 1)) * 100}%` }}
                />
              </div>
            </div>

            <div className="pt-2">
              <p className="text-xs font-semibold text-slate-700 mb-2">Rezim PPh Klien:</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {Object.entries(clients.pphRegimes || {}).map(([regime, count]: [string, any]) => (
                  <div key={regime} className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                    <div className="text-[11px] text-slate-500 truncate">{regime}</div>
                    <div className="text-base font-bold text-slate-900 font-mono tabular-nums mt-0.5">
                      {count} <span className="text-[10px] text-slate-400 font-normal">klien</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Accounting & Tax Risk Breakdown */}
        <div className="p-5 bg-white border border-slate-200 rounded-xl shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 tracking-tight">
              Matriks Penilaian Risiko Terpisah
            </h3>
            <span className="text-xs text-slate-400 font-medium">Accounting vs Tax</span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Accounting Risk Box */}
            <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/50">
              <p className="text-xs font-bold text-slate-800 mb-2.5">Risiko Accounting</p>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                  <span className="text-slate-600">Tinggi (High)</span>
                  <span className="font-mono tabular-nums font-bold text-rose-600">{clients.accRisks.High}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                  <span className="text-slate-600">Sedang (Medium)</span>
                  <span className="font-mono tabular-nums font-bold text-amber-600">{clients.accRisks.Medium}</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-slate-600">Rendah (Low)</span>
                  <span className="font-mono tabular-nums font-bold text-emerald-600">{clients.accRisks.Low}</span>
                </div>
              </div>
            </div>

            {/* Tax Risk Box */}
            <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/50">
              <p className="text-xs font-bold text-slate-800 mb-2.5">Risiko Tax</p>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                  <span className="text-slate-600">Tinggi (High)</span>
                  <span className="font-mono tabular-nums font-bold text-rose-600">{clients.taxRisks.High}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                  <span className="text-slate-600">Sedang (Medium)</span>
                  <span className="font-mono tabular-nums font-bold text-amber-600">{clients.taxRisks.Medium}</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-slate-600">Rendah (Low)</span>
                  <span className="font-mono tabular-nums font-bold text-emerald-600">{clients.taxRisks.Low}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-900 leading-relaxed">
            <strong>Catatan Kepatuhan:</strong> Penilaian risiko perpajakan dan akuntansi dievaluasi independen oleh masing-masing SPV berdasarkan riwayat equalisasi dan keabsahan dokumen transaksi.
          </div>
        </div>
      </div>

      {/* Workload per PIC and Division */}
      <div className="p-5 bg-white border border-slate-200 rounded-xl shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 tracking-tight">
              Beban Kerja Tim (Workload per PIC)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Distribusi tugas aktif, pekerjaan siap review, dan mitigasi keterlambatan per personil
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2.5 px-3 font-semibold">Nama PIC</th>
                <th className="py-2.5 px-3 font-semibold text-center">Pekerjaan Berjalan</th>
                <th className="py-2.5 px-3 font-semibold text-center">Siap Review SPV</th>
                <th className="py-2.5 px-3 font-semibold text-center">Terlambat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {workload.map((w: any) => (
                <tr key={w.name} className="hover:bg-slate-50 transition-colors">
                  <td className="py-2.5 px-3 font-medium text-slate-900">{w.name}</td>
                  <td className="py-2.5 px-3 text-center font-mono tabular-nums text-slate-700">
                    {w.activeJobs}
                  </td>
                  <td className="py-2.5 px-3 text-center font-mono tabular-nums">
                    {w.readyReview > 0 ? (
                      <span className="font-semibold text-amber-600">{w.readyReview}</span>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-center font-mono tabular-nums">
                    {w.overdue > 0 ? (
                      <span className="font-bold text-rose-600">{w.overdue}</span>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
