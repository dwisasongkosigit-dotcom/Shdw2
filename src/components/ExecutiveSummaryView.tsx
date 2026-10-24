import { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  ShieldAlert,
  Users,
  Building2,
  UserRound,
  X,
} from 'lucide-react';
import type { Client, Case, CurrentUser, DailyActivity, Job, TeamAgendaEntry } from '../lib/api';
import {
  exportExecutiveSummaryExcel,
  printExecutiveSummaryPdf,
  type AgendaExportRow,
  type ExecutiveSummaryExportData,
  type OperationsExportRow,
  type RiskExportRow,
  type SummaryMetric,
} from '../lib/executiveSummaryExport';
import { useToast } from './Toast';

interface ExecutiveSummaryViewProps {
  clients: Client[];
  jobs: Job[];
  cases: Case[];
  activities: DailyActivity[];
  agendaEntries: TeamAgendaEntry[];
  currentUser: CurrentUser;
  lastUpdated?: string;
  onNavigateTab: (tab: 'clients' | 'jobs' | 'cases' | 'agenda') => void;
}

type RiskBucket = 'High' | 'Medium' | 'Low';
type ClientRisk = Client & { overallRisk: RiskBucket | 'Not Assessed' };

const riskOrder: Record<string, number> = { High: 0, Medium: 1, Low: 2, 'Not Assessed': 3 };
const riskLabel: Record<string, string> = { High: 'High Risk', Medium: 'Medium Risk', Low: 'Low Risk', 'Not Assessed': 'Belum Dinilai' };
const riskTone: Record<string, string> = {
  High: 'border-rose-200 bg-rose-50 text-rose-700',
  Medium: 'border-amber-200 bg-amber-50 text-amber-700',
  Low: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  'Not Assessed': 'border-slate-200 bg-slate-100 text-slate-600',
};

function dateOnly(value?: string) {
  return value ? value.slice(0, 10) : '';
}

function formatDate(value?: string) {
  if (!value) return 'Belum dijadwalkan';
  const date = new Date(`${dateOnly(value)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function getRisk(client: Client): ClientRisk['overallRisk'] {
  const levels = [client.accountingRisk, client.taxRisk];
  if (levels.includes('High')) return 'High';
  if (levels.includes('Medium')) return 'Medium';
  if (levels.includes('Low')) return 'Low';
  return 'Not Assessed';
}

function monthBounds(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, '0')}` };
}

function isOpenJob(job: Job) {
  return job.status !== 'Selesai';
}

function isOpenCase(item: Case) {
  return item.status !== 'Resolved' && item.status !== 'Closed';
}

export function ExecutiveSummaryView({ clients, jobs, cases, activities, agendaEntries, currentUser, lastUpdated, onNavigateTab }: ExecutiveSummaryViewProps) {
  const { success, error } = useToast();
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [selectedRisk, setSelectedRisk] = useState<RiskBucket>('High');
  const [exporting, setExporting] = useState<'pdf' | 'excel' | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportClientTypes, setExportClientTypes] = useState<Client['type'][]>(['Badan', 'OP']);
  const [exportDivision, setExportDivision] = useState<'Accounting' | 'Tax' | 'Both'>(
    currentUser.role === 'SPV Accounting' ? 'Accounting' : currentUser.role === 'SPV Tax' ? 'Tax' : 'Both'
  );

  const today = new Date().toISOString().slice(0, 10);
  const { start: periodStart, end: periodEnd } = monthBounds(period);
  const periodLabel = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${period}-01T00:00:00.000Z`));
  const activeClients = clients.filter((client) => client.status === 'Aktif');
  const riskClients = useMemo<ClientRisk[]>(
    () => activeClients.map((client) => ({ ...client, overallRisk: getRisk(client) })).sort((a, b) =>
      (riskOrder[a.overallRisk] - riskOrder[b.overallRisk]) || a.name.localeCompare(b.name)
    ),
    [activeClients]
  );
  const riskCounts = useMemo(() => ({
    High: riskClients.filter((client) => client.overallRisk === 'High').length,
    Medium: riskClients.filter((client) => client.overallRisk === 'Medium').length,
    Low: riskClients.filter((client) => client.overallRisk === 'Low').length,
    'Not Assessed': riskClients.filter((client) => client.overallRisk === 'Not Assessed').length,
  }), [riskClients]);
  const selectedRiskClients = riskClients.filter((client) => client.overallRisk === selectedRisk);
  const openJobs = jobs.filter(isOpenJob);
  const overdueJobs = openJobs.filter((job) => job.deadline && job.deadline < today).sort((a, b) => a.deadline.localeCompare(b.deadline));
  const readyForReview = jobs.filter((job) => job.status === 'Siap Direview');
  const openCases = cases.filter(isOpenCase);
  const overdueCases = openCases.filter((item) => item.nextFollowUpDate && item.nextFollowUpDate < today).sort((a, b) => a.nextFollowUpDate.localeCompare(b.nextFollowUpDate));
  const periodActivities = activities.filter((activity) => activity.date >= periodStart && activity.date <= periodEnd);
  const completedInPeriod = jobs.filter((job) => job.status === 'Selesai' && job.completedAt && dateOnly(job.completedAt) >= periodStart && dateOnly(job.completedAt) <= periodEnd).length;
  const periodAgenda = agendaEntries.filter((entry) => entry.date >= periodStart && entry.date <= periodEnd && entry.status !== 'Dibatalkan');
  const upcomingAgenda = agendaEntries.filter((entry) => entry.status === 'Terjadwal' && entry.date >= today).sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`)).slice(0, 5);
  const incompletePicClients = activeClients.filter((client) => client.picAssignmentStatus === 'Belum Lengkap');

  const teamWorkload = useMemo(() => {
    const workload = new Map<string, { name: string; active: number; overdue: number; review: number }>();
    openJobs.forEach((job) => {
      const key = job.picId || job.picName || 'Unassigned';
      const entry = workload.get(key) || { name: job.picName || 'Belum ditentukan', active: 0, overdue: 0, review: 0 };
      entry.active += 1;
      if (job.deadline && job.deadline < today) entry.overdue += 1;
      if (job.status === 'Siap Direview') entry.review += 1;
      workload.set(key, entry);
    });
    return [...workload.values()].sort((a, b) => b.active - a.active || a.name.localeCompare(b.name));
  }, [openJobs, today]);

  const overallStatus = overdueJobs.length > 0 || overdueCases.length > 0 || riskCounts.High > 0
    ? 'Perlu perhatian'
    : riskCounts.Medium > 0 || readyForReview.length > 0 || incompletePicClients.length > 0
      ? 'Perlu dipantau'
      : 'Terkendali';
  const overallTone = overallStatus === 'Perlu perhatian'
    ? 'border-rose-200 bg-rose-50 text-rose-800'
    : overallStatus === 'Perlu dipantau'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-emerald-200 bg-emerald-50 text-emerald-800';

  const highlights = useMemo(() => {
    const items: string[] = [];
    if (riskCounts.High) items.push(`${riskCounts.High} klien berstatus High Risk pada snapshot asesmen Accounting/Tax; buka detail alasan dan mitigasi di bawah.`);
    if (overdueJobs.length) items.push(`${overdueJobs.length} pekerjaan melewati tenggat dan belum selesai; prioritas pertama: ${overdueJobs[0].clientName} · ${overdueJobs[0].title}.`);
    if (overdueCases.length) items.push(`${overdueCases.length} follow-up kasus melewati tanggal rencana; tinjau PIC dan langkah berikutnya.`);
    if (readyForReview.length) items.push(`${readyForReview.length} pekerjaan menunggu review SPV.`);
    if (incompletePicClients.length) items.push(`${incompletePicClients.length} klien aktif belum memiliki 4 PIC lengkap.`);
    if (!items.length) items.push('Tidak ada pekerjaan terlambat, follow-up lewat jadwal, atau klien High Risk pada data yang tersedia.');
    return items;
  }, [incompletePicClients.length, overdueCases.length, overdueJobs, readyForReview.length, riskCounts.High]);

  const operations: OperationsExportRow[] = [
    ...overdueJobs.map((job) => ({ clientId: job.clientId, category: 'Pekerjaan terlambat', reference: job.id, client: job.clientName, division: job.division, owner: job.picName, status: job.status, deadline: formatDate(job.deadline), summary: job.title || job.description || 'Tinjau progres dan rencana pemulihan tenggat.' })),
    ...readyForReview.map((job) => ({ clientId: job.clientId, category: 'Menunggu review SPV', reference: job.id, client: job.clientName, division: job.division, owner: job.spvName || 'Belum ditentukan', status: job.status, deadline: formatDate(job.deadline), summary: job.title || job.description || 'Pekerjaan menunggu keputusan review.' })),
    ...overdueCases.map((item) => ({ clientId: item.clientId, category: 'Follow-up kasus terlambat', reference: item.id, client: item.clientName, division: item.division, owner: item.followUpPicName || item.picName, status: item.status, deadline: formatDate(item.nextFollowUpDate), summary: item.followUpPlan || item.latestProgress || 'Konfirmasi langkah berikutnya bersama PIC.' })),
    ...incompletePicClients.map((client) => ({ clientId: client.id, category: 'PIC belum lengkap', reference: client.id, client: client.name, division: 'Lintas Divisi', owner: 'Admin / SPV', status: client.picAssignmentStatus, deadline: '—', summary: 'Lengkapi penugasan PIC untuk Accounting dan Tax.' })),
  ];

  const selectedExportDivisions: Array<'Accounting' | 'Tax'> = exportDivision === 'Both' ? ['Accounting', 'Tax'] : [exportDivision];
  const selectedExportClients = activeClients.filter((client) => exportClientTypes.includes(client.type));
  const selectedExportClientIds = new Set(clients.filter((client) => exportClientTypes.includes(client.type)).map((client) => client.id));
  const selectedRiskRows = riskClients.filter((client) => selectedExportClientIds.has(client.id)).map((client) => {
    const selectedRiskLevel = exportDivision === 'Accounting' ? client.accountingRisk : exportDivision === 'Tax' ? client.taxRisk : client.overallRisk;
    return {
      clientId: client.id,
      clientName: client.name,
      overallRisk: riskLabel[selectedRiskLevel],
      accountingRisk: exportDivision === 'Tax' ? '' : client.accountingRisk,
      accountingReason: exportDivision === 'Tax' ? '' : client.accountingRiskReason || 'Belum ada alasan asesmen yang dicatat.',
      accountingAction: exportDivision === 'Tax' ? '' : client.accountingRiskRecommendation || 'Belum ada tindakan mitigasi yang dicatat.',
      accountingSpv: exportDivision === 'Tax' ? '' : client.accountingSpvName || 'Belum ditentukan',
      accountingReview: exportDivision === 'Tax' ? '' : formatDate(client.accountingRiskReviewDate),
      taxRisk: exportDivision === 'Accounting' ? '' : client.taxRisk,
      taxReason: exportDivision === 'Accounting' ? '' : client.taxRiskReason || 'Belum ada alasan asesmen yang dicatat.',
      taxAction: exportDivision === 'Accounting' ? '' : client.taxRiskRecommendation || 'Belum ada tindakan mitigasi yang dicatat.',
      taxSpv: exportDivision === 'Accounting' ? '' : client.taxSpvName || 'Belum ditentukan',
      taxReview: exportDivision === 'Accounting' ? '' : formatDate(client.taxRiskReviewDate),
    };
  });
  const selectedRiskCounts = {
    High: selectedRiskRows.filter((client) => client.overallRisk === riskLabel.High).length,
    Medium: selectedRiskRows.filter((client) => client.overallRisk === riskLabel.Medium).length,
    Low: selectedRiskRows.filter((client) => client.overallRisk === riskLabel.Low).length,
    'Not Assessed': selectedRiskRows.filter((client) => client.overallRisk === riskLabel['Not Assessed']).length,
  };
  const selectedExportJobs = jobs.filter((job) => selectedExportClientIds.has(job.clientId) && selectedExportDivisions.includes(job.division));
  const selectedOpenJobs = selectedExportJobs.filter(isOpenJob);
  const selectedOverdueJobs = selectedOpenJobs.filter((job) => job.deadline && job.deadline < today);
  const selectedReadyForReview = selectedExportJobs.filter((job) => job.status === 'Siap Direview');
  const selectedExportCases = cases.filter((item) => selectedExportClientIds.has(item.clientId) && selectedExportDivisions.includes(item.division));
  const selectedOpenCases = selectedExportCases.filter(isOpenCase);
  const selectedOverdueCases = selectedOpenCases.filter((item) => item.nextFollowUpDate && item.nextFollowUpDate < today);
  const selectedActivityCount = periodActivities.filter((activity) => selectedExportClientIds.has(activity.clientId) && selectedExportDivisions.includes(activity.division)).length;
  const selectedCompletedCount = selectedExportJobs.filter((job) => job.status === 'Selesai' && job.completedAt && dateOnly(job.completedAt) >= periodStart && dateOnly(job.completedAt) <= periodEnd).length;
  const selectedAgenda = agendaEntries.filter((entry) => entry.date >= periodStart && entry.date <= periodEnd && entry.status !== 'Dibatalkan')
    .filter((entry) => (!entry.clientId || selectedExportClientIds.has(entry.clientId)) && (entry.division === 'Lintas Divisi' || selectedExportDivisions.includes(entry.division)))
    .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
  const selectedOperations = operations.filter((item) => selectedExportClientIds.has(item.clientId || '') && (item.category === 'PIC belum lengkap' ? exportDivision === 'Both' : selectedExportDivisions.includes(item.division as 'Accounting' | 'Tax')));
  const selectedRiskNeedsAttention = selectedRiskCounts.High > 0 || selectedOverdueJobs.length > 0 || selectedOverdueCases.length > 0;
  const selectedRiskNeedsMonitoring = selectedRiskCounts.Medium > 0 || selectedReadyForReview.length > 0;
  const selectedOverallStatus = selectedRiskNeedsAttention ? 'Perlu perhatian' : selectedRiskNeedsMonitoring ? 'Perlu dipantau' : 'Terkendali';
  const selectedHighlights = [
    ...(selectedRiskCounts.High ? [`${selectedRiskCounts.High} klien berstatus High Risk pada cakupan yang dipilih.`] : []),
    ...(selectedOverdueJobs.length ? [`${selectedOverdueJobs.length} pekerjaan melewati tenggat; prioritas pertama: ${selectedOverdueJobs[0].clientName} · ${selectedOverdueJobs[0].title}.`] : []),
    ...(selectedOverdueCases.length ? [`${selectedOverdueCases.length} follow-up kasus melewati tanggal rencana.`] : []),
    ...(selectedReadyForReview.length ? [`${selectedReadyForReview.length} pekerjaan menunggu review SPV.`] : []),
  ];
  if (!selectedHighlights.length) selectedHighlights.push('Tidak ada pekerjaan terlambat atau risiko High pada cakupan yang dipilih.');
  const typeLabel = exportClientTypes.length === 2 ? 'Badan & Orang Pribadi' : exportClientTypes.length === 0 ? 'Pilih jenis klien' : exportClientTypes[0] === 'OP' ? 'Orang Pribadi' : 'Badan';
  const divisionLabel = exportDivision === 'Both' ? 'Accounting & Tax' : exportDivision;
  const scopeLabel = `${typeLabel} · ${divisionLabel}`;
  const agendaRows: AgendaExportRow[] = selectedAgenda.map((entry) => ({
    date: formatDate(entry.date),
    time: `${entry.startTime || '—'}${entry.endTime ? `–${entry.endTime}` : ''}`,
    title: entry.title,
    type: entry.meetingType,
    division: entry.division,
    client: entry.clientName || '—',
    job: entry.jobTitle || '—',
    participants: entry.participants.join(', ') || '—',
    location: entry.location || '—',
    status: entry.status,
  }));
  const exportMetrics: SummaryMetric[] = [
    { metric: 'Klien aktif', value: selectedExportClients.length, note: `Kategori klien: ${typeLabel}.` },
    { metric: 'High Risk', value: selectedRiskCounts.High, note: 'Sesuai divisi yang dipilih.' },
    { metric: 'Medium Risk', value: selectedRiskCounts.Medium, note: 'Sesuai divisi yang dipilih.' },
    { metric: 'Low Risk', value: selectedRiskCounts.Low, note: 'Sesuai divisi yang dipilih.' },
    { metric: 'Belum dinilai', value: selectedRiskCounts['Not Assessed'], note: 'Pada divisi yang dipilih.' },
    { metric: 'Pekerjaan aktif', value: selectedOpenJobs.length, note: 'Pekerjaan yang belum selesai.' },
    { metric: 'Pekerjaan terlambat', value: selectedOverdueJobs.length, note: 'Tenggat sebelum hari ini.' },
    { metric: 'Menunggu review SPV', value: selectedReadyForReview.length, note: 'Status Siap Direview.' },
    { metric: 'Kasus terbuka', value: selectedOpenCases.length, note: 'Kasus selain Resolved dan Closed.' },
    { metric: 'Aktivitas periode', value: selectedActivityCount, note: `Log aktivitas pada ${periodLabel}.` },
    { metric: 'Pekerjaan selesai periode', value: selectedCompletedCount, note: `Penyelesaian pada ${periodLabel}.` },
    { metric: 'Agenda periode', value: agendaRows.length, note: `Jadwal yang tidak dibatalkan pada ${periodLabel}.` },
  ];
  const exportData: ExecutiveSummaryExportData = {
    period: periodLabel,
    generatedAt: new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeStyle: 'short' }).format(new Date()),
    sourceUpdatedAt: lastUpdated ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(lastUpdated)) : 'Belum tersedia',
    scopeLabel,
    scopeNote: `Cakupan: ${typeLabel} untuk divisi ${divisionLabel}. Rincian risiko hanya memuat kolom divisi yang dipilih.`,
    divisionScope: exportDivision,
    overallStatus: selectedOverallStatus,
    metrics: exportMetrics,
    risks: selectedRiskRows,
    operations: selectedOperations,
    agenda: agendaRows,
    highlights: selectedHighlights,
  };

  const toggleExportClientType = (type: Client['type']) => {
    setExportClientTypes((current) => current.includes(type) ? current.filter((item) => item !== type) : [...current, type]);
  };

  const runExport = async (format: 'pdf' | 'excel') => {
    if (!exportClientTypes.length) {
      error('Pilih jenis klien', 'Pilih Badan, Orang Pribadi, atau keduanya sebelum mengekspor.');
      return;
    }
    setExporting(format);
    try {
      if (format === 'pdf') printExecutiveSummaryPdf(exportData);
      else await exportExecutiveSummaryExcel(exportData);
      setExportDialogOpen(false);
      success(format === 'pdf' ? 'Ringkasan siap dicetak' : 'Ringkasan berhasil diekspor', format === 'pdf' ? 'Pilih “Save as PDF” pada dialog cetak.' : `Workbook dibuat untuk cakupan ${scopeLabel}.`);
    } catch (err) {
      error('Ekspor belum berhasil', err instanceof Error ? err.message : 'Silakan coba kembali.');
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="flex flex-col gap-5 pb-8">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0a1128] via-[#111d39] to-[#1b2a48] px-5 py-6 text-white shadow-lg sm:px-7 sm:py-7">
        <div className="pointer-events-none absolute -right-12 -top-24 size-72 rounded-full border border-amber-300/10" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl"><div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300"><span className="size-1.5 rounded-full bg-amber-300" />Management Office</div><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Executive Summary</h1><p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">Gambaran portofolio risiko, progres pekerjaan, hambatan, dan keputusan yang perlu perhatian manajemen.</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="executive-period">Periode ringkasan</label><input id="executive-period" type="month" value={period} onChange={(event) => setPeriod(event.target.value || new Date().toISOString().slice(0, 7))} className="min-h-10 rounded-xl border border-white/15 bg-white/[0.08] px-3 py-2 text-xs font-medium text-white outline-none [color-scheme:dark] focus:border-amber-400" />
            <button type="button" onClick={() => setExportDialogOpen(true)} disabled={Boolean(exporting)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-amber-500 px-3.5 py-2.5 text-xs font-semibold text-slate-950 transition hover:bg-amber-400 disabled:opacity-50"><Download className="size-4" />Ekspor ringkasan</button>
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-xs leading-5 text-amber-950 sm:flex-row sm:items-center sm:justify-between"><div><span className="font-semibold">Ringkasan portofolio:</span> risiko klien, progres pekerjaan, kasus terbuka, dan agenda dalam satu tampilan. Saat ekspor, SPV dapat memilih Badan atau Orang Pribadi serta Accounting, Tax, atau keduanya.</div><span className={`inline-flex shrink-0 items-center gap-2 self-start rounded-full border px-3 py-1.5 text-[11px] font-semibold sm:self-auto ${overallTone}`}><span className="size-1.5 rounded-full bg-current" />{overallStatus}</span></div>

      <section aria-label="Indikator utama" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Klien High Risk" value={riskCounts.High} note="Kategori tertinggi per klien" icon={<ShieldAlert />} tone="rose" onClick={() => setSelectedRisk('High')} />
        <MetricCard label="Pekerjaan terlambat" value={overdueJobs.length} note="Pekerjaan aktif melewati tenggat" icon={<Clock3 />} tone="amber" onClick={() => onNavigateTab('jobs')} />
        <MetricCard label="Menunggu review SPV" value={readyForReview.length} note="Status Siap Direview" icon={<Briefcase />} tone="sky" onClick={() => onNavigateTab('jobs')} />
        <MetricCard label="Selesai bulan ini" value={completedInPeriod} note={`Pekerjaan selesai · ${periodLabel}`} icon={<CheckCircle2 />} tone="emerald" onClick={() => onNavigateTab('jobs')} />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold text-slate-900">Sorotan & keputusan prioritas</h2><p className="mt-1 text-[11px] text-slate-500">Indikator yang memerlukan peninjauan atau tindak lanjut.</p></div><AlertTriangle className="size-4 shrink-0 text-amber-600" /></div>
          <ul className="mt-4 space-y-2.5">{highlights.map((highlight, index) => <li key={`${highlight}-${index}`} className="flex gap-2.5 rounded-xl border border-slate-100 bg-slate-50/70 p-3 text-xs leading-5 text-slate-700"><span className={`mt-1 size-1.5 shrink-0 rounded-full ${highlight.includes('High Risk') || highlight.includes('terlambat') ? 'bg-rose-500' : 'bg-amber-500'}`} />{highlight}</li>)}</ul>
          <div className="mt-4 border-t border-slate-100 pt-4"><div className="flex items-center justify-between gap-3"><h3 className="text-xs font-semibold text-slate-800">Beban pekerjaan per PIC</h3><span className="text-[10px] text-slate-400">Aktif · terlambat · review</span></div>
            {teamWorkload.length ? <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[440px] text-left text-[11px]"><thead><tr className="border-b border-slate-200 text-slate-500"><th className="py-2 pr-3 font-medium">PIC</th><th className="px-2 py-2 text-center font-medium">Aktif</th><th className="px-2 py-2 text-center font-medium">Terlambat</th><th className="px-2 py-2 text-center font-medium">Review</th></tr></thead><tbody className="divide-y divide-slate-100">{teamWorkload.slice(0, 7).map((person) => <tr key={person.name}><td className="py-2.5 pr-3 font-medium text-slate-800">{person.name}</td><td className="px-2 py-2.5 text-center tabular-nums text-slate-700">{person.active}</td><td className={`px-2 py-2.5 text-center tabular-nums ${person.overdue ? 'font-semibold text-rose-600' : 'text-slate-500'}`}>{person.overdue}</td><td className="px-2 py-2.5 text-center tabular-nums text-slate-700">{person.review}</td></tr>)}</tbody></table></div> : <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Belum ada pekerjaan aktif yang memiliki PIC.</p>}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold text-slate-900">Progres periode</h2><p className="mt-1 text-[11px] text-slate-500">Aktivitas & penyelesaian pada {periodLabel}.</p></div><BarChart3 className="size-4 shrink-0 text-slate-400" /></div>
          <div className="mt-4 grid grid-cols-2 gap-3"><PeriodStat label="Log aktivitas" value={periodActivities.length} icon={<FileText />} /><PeriodStat label="Pekerjaan selesai" value={completedInPeriod} icon={<CheckCircle2 />} /><PeriodStat label="Agenda" value={periodAgenda.length} icon={<CalendarDays />} /><PeriodStat label="Kasus terbuka" value={openCases.length} icon={<AlertCircle />} /></div>
          <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/70 p-3"><div className="flex items-center justify-between"><h3 className="text-xs font-semibold text-slate-800">Agenda terdekat</h3><button type="button" onClick={() => onNavigateTab('agenda')} className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 hover:text-amber-800">Lihat agenda <ArrowUpRight className="size-3" /></button></div>
            {upcomingAgenda.length ? <ul className="mt-2 divide-y divide-slate-200/70">{upcomingAgenda.slice(0, 3).map((entry) => <li key={entry.id} className="flex items-start justify-between gap-3 py-2"><div className="min-w-0"><p className="truncate text-[11px] font-semibold text-slate-800">{entry.title}</p><p className="mt-0.5 truncate text-[10px] text-slate-500">{entry.clientName || entry.meetingType} · {entry.location || 'Lokasi belum ditentukan'}</p></div><span className="shrink-0 text-right text-[10px] font-medium text-slate-600">{formatDate(entry.date)}<br />{entry.startTime}</span></li>)}</ul> : <p className="mt-2 text-[11px] text-slate-500">Belum ada agenda terjadwal mendatang.</p>}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-700">Portofolio klien</p><h2 className="mt-1 text-base font-semibold text-slate-900">Segmentasi risiko & rencana tindak lanjut</h2><p className="mt-1 text-xs text-slate-500">Level klien mengikuti kategori tertinggi dari asesmen Accounting atau Tax. Penilaian sumber tidak diubah otomatis.</p></div><button type="button" onClick={() => onNavigateTab('clients')} className="inline-flex items-center gap-1 self-start text-xs font-semibold text-slate-600 hover:text-slate-900 sm:self-auto">Buka master klien <ArrowUpRight className="size-3.5" /></button></div>
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(['High', 'Medium', 'Low'] as RiskBucket[]).map((bucket) => {
            const count = riskCounts[bucket];
            const percent = activeClients.length ? Math.round(count / activeClients.length * 100) : 0;
            return <button key={bucket} type="button" onClick={() => setSelectedRisk(bucket)} aria-pressed={selectedRisk === bucket} className={`rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${selectedRisk === bucket ? 'border-slate-400 bg-slate-50 shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50'}`}><div className="flex items-center justify-between"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${riskTone[bucket]}`}>{riskLabel[bucket]}</span><span className="text-xl font-semibold tabular-nums text-slate-900">{count}</span></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${bucket === 'High' ? 'bg-rose-500' : bucket === 'Medium' ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${percent}%` }} /></div><p className="mt-1.5 text-[10px] text-slate-500">{percent}% dari {activeClients.length} klien aktif · klik untuk detail</p></button>;
          })}
        </div>
        {riskCounts['Not Assessed'] > 0 && <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600"><span className="font-semibold">Belum dinilai: {riskCounts['Not Assessed']} klien.</span> Mohon SPV melengkapi asesmen Accounting dan Tax agar risiko tidak luput dari pemantauan.</p>}
        <div className="mt-4 space-y-3">
          {selectedRiskClients.length ? selectedRiskClients.map((client) => (
            <article key={client.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[10px] font-semibold text-slate-400">{client.id}</span><span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${riskTone[client.overallRisk]}`}>{riskLabel[client.overallRisk]}</span></div><h3 className="mt-1 break-words text-sm font-semibold text-slate-900">{client.name}</h3></div><span className="shrink-0 text-[10px] text-slate-500">Pembaruan {formatDate(client.updatedAt)}</span></div>
              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                <RiskDivisionDetail division="Accounting" level={client.accountingRisk} reason={client.accountingRiskReason} action={client.accountingRiskRecommendation} owner={client.accountingSpvName} reviewDate={client.accountingRiskReviewDate} />
                <RiskDivisionDetail division="Tax" level={client.taxRisk} reason={client.taxRiskReason} action={client.taxRiskRecommendation} owner={client.taxSpvName} reviewDate={client.taxRiskReviewDate} />
              </div>
            </article>
          )) : <div className="rounded-xl border border-dashed border-slate-200 px-5 py-10 text-center"><Users className="mx-auto size-7 text-slate-300" /><p className="mt-2 text-sm font-semibold text-slate-700">Belum ada klien {riskLabel[selectedRisk]}</p><p className="mt-1 text-xs text-slate-500">Tidak ada data pada kategori ini untuk snapshot aktif.</p></div>}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-slate-900">Daftar pekerjaan prioritas</h2><p className="mt-1 text-[11px] text-slate-500">Tenggat lewat, review SPV, dan follow-up kasus yang sudah lewat jadwal.</p></div><button type="button" onClick={() => onNavigateTab('jobs')} className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600 hover:text-slate-900">Lihat semua <ArrowUpRight className="size-3" /></button></div>
        {operations.length ? <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-[11px]"><thead><tr className="border-b border-slate-200 text-slate-500"><th className="py-2 pr-3 font-medium">Jenis / referensi</th><th className="px-2 py-2 font-medium">Klien & PIC</th><th className="px-2 py-2 font-medium">Status / tenggat</th><th className="px-2 py-2 font-medium">Konteks / tindakan tercatat</th></tr></thead><tbody className="divide-y divide-slate-100">{operations.slice(0, 8).map((item) => <tr key={`${item.category}-${item.reference}`}><td className="py-3 pr-3"><span className="block font-semibold text-slate-800">{item.category}</span><span className="mt-0.5 block font-mono text-[10px] text-slate-400">{item.reference}</span></td><td className="px-2 py-3"><span className="block font-medium text-slate-800">{item.client}</span><span className="mt-0.5 block text-[10px] text-slate-500">{item.owner} · {item.division}</span></td><td className="px-2 py-3"><span className="block font-medium text-slate-700">{item.status}</span><span className="mt-0.5 block text-[10px] text-rose-600">{item.deadline}</span></td><td className="max-w-[320px] px-2 py-3 leading-5 text-slate-600">{item.summary}</td></tr>)}</tbody></table></div> : <div className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-3 text-xs text-emerald-800"><CheckCircle2 className="size-4 shrink-0" />Belum ada pekerjaan, review, atau follow-up terlambat yang memerlukan eskalasi.</div>}
      </section>

      <div className="flex flex-col gap-1 text-[10px] text-slate-400 sm:flex-row sm:items-center sm:justify-between"><span>Risiko = level tertinggi dari asesmen Accounting dan Tax per klien; alasan, rekomendasi, SPV, dan tanggal review mengikuti catatan yang tersimpan.</span><span>Data sumber terakhir tersimpan {lastUpdated ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(lastUpdated)) : 'belum tersedia'}</span></div>

      {exportDialogOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setExportDialogOpen(false); }} onKeyDown={(event) => { if (event.key === 'Escape') setExportDialogOpen(false); }}><section role="dialog" aria-modal="true" aria-labelledby="export-dialog-title" className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-700">Laporan terarah</p><h2 id="export-dialog-title" className="mt-1 text-lg font-semibold text-slate-900">Pilih cakupan ekspor</h2><p className="mt-1 text-xs leading-5 text-slate-500">Pilih jenis klien dan divisi yang ingin dimasukkan ke dalam laporan.</p></div><button type="button" autoFocus onClick={() => setExportDialogOpen(false)} aria-label="Tutup pilihan ekspor" className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"><X className="size-4" /></button></div>
          <fieldset className="mt-5"><legend className="text-xs font-semibold text-slate-800">Jenis klien</legend><div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">{([{ type: 'Badan' as const, label: 'Badan usaha', detail: 'PT, CV, Firma, dan lainnya', icon: Building2 }, { type: 'OP' as const, label: 'Orang Pribadi', detail: 'Klien individu / OP', icon: UserRound }]).map(({ type, label, detail, icon: Icon }) => <label key={type} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition ${exportClientTypes.includes(type) ? 'border-amber-300 bg-amber-50/70' : 'border-slate-200 hover:bg-slate-50'}`}><input type="checkbox" checked={exportClientTypes.includes(type)} onChange={() => toggleExportClientType(type)} className="size-4 accent-amber-600" /><span className="rounded-lg bg-white p-2 text-slate-600"><Icon className="size-4" /></span><span><span className="block text-xs font-semibold text-slate-800">{label}</span><span className="mt-0.5 block text-[10px] text-slate-500">{detail}</span></span></label>)}</div></fieldset>
          <fieldset className="mt-5"><legend className="text-xs font-semibold text-slate-800">Cakupan divisi</legend><div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">{([{ value: 'Accounting' as const, label: 'Accounting' }, { value: 'Tax' as const, label: 'Tax' }, { value: 'Both' as const, label: 'Keduanya' }]).map(({ value, label }) => <label key={value} className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-xs font-medium transition ${exportDivision === value ? 'border-slate-800 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}><input type="radio" name="executive-export-division" value={value} checked={exportDivision === value} onChange={() => setExportDivision(value)} className="accent-amber-500" />{label}</label>)}</div></fieldset>
          <div className="mt-5 flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-[10px] text-slate-500">Cakupan: <span className="font-semibold text-slate-700">{scopeLabel}</span></p><div className="flex gap-2"><button type="button" onClick={() => setExportDialogOpen(false)} className="min-h-10 rounded-xl border border-slate-200 px-3.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">Batal</button><button type="button" onClick={() => runExport('pdf')} disabled={Boolean(exporting) || !exportClientTypes.length} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><FileText className="size-4" />{exporting === 'pdf' ? 'Menyiapkan…' : 'PDF'}</button><button type="button" onClick={() => runExport('excel')} disabled={Boolean(exporting) || !exportClientTypes.length} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-amber-500 px-3.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"><Download className="size-4" />{exporting === 'excel' ? 'Menyiapkan…' : 'Excel'}</button></div></div>
        </section></div>}
    </div>
  );
}

function MetricCard({ label, value, note, icon, tone, onClick }: { label: string; value: number; note: string; icon: React.ReactNode; tone: 'rose' | 'amber' | 'sky' | 'emerald'; onClick: () => void }) {
  const tones = { rose: 'bg-rose-50 text-rose-700', amber: 'bg-amber-50 text-amber-700', sky: 'bg-sky-50 text-sky-700', emerald: 'bg-emerald-50 text-emerald-700' };
  return <button type="button" onClick={onClick} className="group rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-slate-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"><div className="flex items-start justify-between"><span className="text-xs font-medium text-slate-500">{label}</span><span className={`rounded-lg p-2 ${tones[tone]}`}>{icon}</span></div><p className="mt-3 text-2xl font-semibold tabular-nums text-slate-900">{value}</p><p className="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-500"><span>{note}</span><ArrowUpRight className="size-3 shrink-0 opacity-0 transition group-hover:opacity-100" /></p></button>;
}

function PeriodStat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-3"><span className="inline-flex size-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600">{icon}</span><p className="mt-2 text-lg font-semibold tabular-nums text-slate-900">{value}</p><p className="mt-0.5 text-[10px] text-slate-500">{label}</p></div>;
}

function RiskDivisionDetail({ division, level, reason, action, owner, reviewDate }: { division: 'Accounting' | 'Tax'; level: string; reason: string; action: string; owner: string; reviewDate: string }) {
  return <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-3"><div className="flex items-center justify-between gap-2"><h4 className="text-[11px] font-semibold text-slate-800">{division}</h4><span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${riskTone[level] || riskTone['Not Assessed']}`}>{level}</span></div><p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Alasan asesmen</p><p className="mt-0.5 text-xs leading-5 text-slate-700">{reason || 'Belum ada alasan asesmen yang dicatat.'}</p><p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Solusi / tindakan tercatat</p><p className="mt-0.5 text-xs leading-5 text-slate-700">{action || 'Belum ada tindakan mitigasi yang dicatat; perlu dikonfirmasi dan dicatat oleh SPV.'}</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-200 pt-2 text-[10px] text-slate-500"><span>PIC SPV: <strong className="font-medium text-slate-700">{owner || 'Belum ditentukan'}</strong></span><span>Review: <strong className="font-medium text-slate-700">{reviewDate ? formatDate(reviewDate) : 'Belum dijadwalkan'}</strong></span></div></div>;
}
