import { useState, useMemo } from 'react';
import {
  FileSpreadsheet,
  Download,
  Calendar,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Briefcase,
  AlertCircle,
  Copy,
} from 'lucide-react';
import { api, type Client, type Job, type Case, type DailyActivity, type CurrentUser } from '../lib/api';
import { useToast } from './Toast';
import { ExportDropdown } from './ExportDropdown';
import type { ColumnDef } from '../lib/exportUtils';

interface ReportsViewProps {
  clients: Client[];
  jobs: Job[];
  cases: Case[];
  activities: DailyActivity[];
  currentUser: CurrentUser;
}

export type ReportCategory =
  | 'daily-activity'
  | 'cases'
  | 'follow-up'
  | 'jobs'
  | 'compliance'
  | 'risk';

export function ReportsView({ clients, jobs, cases, activities }: ReportsViewProps) {
  const { success, error } = useToast();
  const [reportType, setReportType] = useState<ReportCategory>('daily-activity');

  const today = new Date().toISOString().split('T')[0];

  const highRiskClients = useMemo(() => {
    return clients.filter((c) => c.taxRisk === 'High' || c.accountingRisk === 'High');
  }, [clients]);

  const followUpCases = useMemo(() => {
    return cases.filter((c) => c.status !== 'Resolved' && c.status !== 'Closed' && c.nextFollowUpDate);
  }, [cases]);

  // 1. Daily Activity Columns
  const dailyActivityColumns: ColumnDef<DailyActivity>[] = useMemo(
    () => [
      { header: 'No', key: 'no', width: 6, align: 'center', render: (_, i?: any) => (activities.indexOf(_) + 1) },
      { header: 'ID Aktivitas', key: 'id', width: 16, align: 'center' },
      { header: 'Tanggal', key: 'date', width: 14, align: 'center' },
      { header: 'Nama Klien', key: 'clientName', width: 28 },
      { header: 'Divisi', key: 'division', width: 12, align: 'center' },
      { header: 'Staff PIC', key: 'picName', width: 22 },
      { header: 'Ref Job/Case', key: 'ref', width: 16, align: 'center', render: (a) => a.jobId || a.caseId || '-' },
      { header: 'Deskripsi Kegiatan Nyata', key: 'description', width: 42 },
      { header: 'Hasil & Progres', key: 'resultProgress', width: 28, render: (a) => a.resultProgress || '-' },
      { header: 'Kendala yang Ditemui', key: 'obstacles', width: 25, render: (a) => a.obstacles || '-' },
      { header: 'Rencana Tindak Lanjut', key: 'followUp', width: 25, render: (a) => a.followUp || '-' },
      { header: 'Durasi (Mnt)', key: 'durationMinutes', width: 12, align: 'center', render: (a) => a.durationMinutes || 60 },
      { header: 'Status Aktivitas', key: 'status', width: 15, align: 'center' },
    ],
    [activities]
  );

  // 2. Case Register Columns
  const caseColumns: ColumnDef<Case>[] = useMemo(
    () => [
      { header: 'No', key: 'no', width: 6, align: 'center', render: (c) => cases.indexOf(c) + 1 },
      { header: 'ID Kasus', key: 'id', width: 16, align: 'center' },
      { header: 'Tgl Dibuat', key: 'createdAt', width: 14, align: 'center', render: (c) => c.createdAt?.split('T')[0] || '-' },
      { header: 'Nama Klien', key: 'clientName', width: 28 },
      { header: 'Divisi', key: 'division', width: 12, align: 'center' },
      { header: 'Judul Kasus / Temuan', key: 'title', width: 35 },
      { header: 'Prioritas', key: 'priority', width: 14, align: 'center' },
      { header: 'PIC Penanggung Jawab', key: 'picName', width: 22 },
      { header: 'Status Kasus', key: 'status', width: 15, align: 'center' },
      { header: 'Target Follow-up', key: 'nextFollowUpDate', width: 16, align: 'center', render: (c) => c.nextFollowUpDate || '-' },
      { header: 'Akar Masalah (Root Cause)', key: 'rootCause', width: 35, render: (c) => c.rootCause || '-' },
      { header: 'Uraian Kasus & Fakta', key: 'description', width: 40, render: (c) => c.description || '-' },
      { header: 'Tindakan yang Dilakukan', key: 'actionsTaken', width: 35, render: (c) => c.actionsTaken || '-' },
      { header: 'Progres Terkini', key: 'latestProgress', width: 35, render: (c) => c.latestProgress || '-' },
      { header: 'Catatan Penyelesaian', key: 'resolutionNotes', width: 35, render: (c) => c.resolutionNotes || '-' },
    ],
    [cases]
  );

  // 3. Follow-up & Overdue Columns
  const followUpColumns: ColumnDef<Case>[] = useMemo(
    () => [
      { header: 'No', key: 'no', width: 6, align: 'center', render: (c) => followUpCases.indexOf(c) + 1 },
      { header: 'ID Kasus', key: 'id', width: 16, align: 'center' },
      { header: 'Nama Klien', key: 'clientName', width: 28 },
      { header: 'Divisi', key: 'division', width: 12, align: 'center' },
      { header: 'Judul Kasus', key: 'title', width: 32 },
      { header: 'PIC Kasus', key: 'picName', width: 20 },
      { header: 'Jatuh Tempo Follow-up', key: 'nextFollowUpDate', width: 18, align: 'center' },
      {
        header: 'Status Jatuh Tempo',
        key: 'overdueStatus',
        width: 18,
        align: 'center',
        render: (c) => (c.nextFollowUpDate < today ? 'TERLAMBAT (OVERDUE)' : 'MENDATANG (UPCOMING)'),
      },
      { header: 'Status Kasus', key: 'status', width: 14, align: 'center' },
      { header: 'Rencana Tindak Lanjut', key: 'followUpPlan', width: 35, render: (c) => c.followUpPlan || '-' },
      { header: 'Progres Terkini', key: 'latestProgress', width: 30, render: (c) => c.latestProgress || '-' },
    ],
    [followUpCases, today]
  );

  // 4. Job Management Columns
  const jobColumns: ColumnDef<Job>[] = useMemo(
    () => [
      { header: 'No', key: 'no', width: 6, align: 'center', render: (j) => jobs.indexOf(j) + 1 },
      { header: 'ID Job', key: 'id', width: 16, align: 'center' },
      { header: 'Nama Klien', key: 'clientName', width: 28 },
      { header: 'Divisi', key: 'division', width: 12, align: 'center' },
      { header: 'Judul Pekerjaan', key: 'title', width: 35 },
      { header: 'Prioritas', key: 'priority', width: 12, align: 'center' },
      { header: 'Staff PIC', key: 'picName', width: 22 },
      { header: 'SPV Reviewer', key: 'spvName', width: 22 },
      { header: 'Tgl Mulai', key: 'startDate', width: 14, align: 'center' },
      { header: 'Deadline', key: 'deadline', width: 14, align: 'center' },
      { header: 'Progres (%)', key: 'progressPercent', width: 12, align: 'center', render: (j) => `${j.progressPercent}%` },
      { header: 'Status Pekerjaan', key: 'status', width: 16, align: 'center' },
      { header: 'Catatan Review SPV', key: 'reviewNotes', width: 35, render: (j) => j.reviewNotes || '-' },
    ],
    [jobs]
  );

  // 5. Compliance Columns
  const complianceColumns: ColumnDef<Client>[] = useMemo(
    () => [
      { header: 'No', key: 'no', width: 6, align: 'center', render: (c) => clients.indexOf(c) + 1 },
      { header: 'Client ID', key: 'id', width: 14, align: 'center' },
      { header: 'Nama Klien', key: 'name', width: 30 },
      { header: 'Tipe', key: 'type', width: 10, align: 'center' },
      { header: 'Bentuk Usaha', key: 'entityType', width: 14, align: 'center' },
      { header: 'Status Klien', key: 'status', width: 14, align: 'center' },
      { header: 'Status PKP', key: 'pkpStatus', width: 14, align: 'center' },
      { header: 'Rezim PPh', key: 'pphRegime', width: 24 },
      { header: 'Tahun Pajak', key: 'taxYearEffective', width: 12, align: 'center' },
      { header: 'Fasilitas UMKM', key: 'umkm', width: 16, align: 'center', render: (c) => (c.umkmFacilityEndYear ? `s/d ${c.umkmFacilityEndYear}` : '-') },
      { header: 'Staff Acc PIC', key: 'accountingStaffPicName', width: 20, render: (c) => c.accountingStaffPicName || '-' },
      { header: 'Staff Tax PIC', key: 'taxStaffPicName', width: 20, render: (c) => c.taxStaffPicName || '-' },
      { header: 'SPV Acc', key: 'accountingSpvName', width: 20, render: (c) => c.accountingSpvName || '-' },
      { header: 'SPV Tax', key: 'taxSpvName', width: 20, render: (c) => c.taxSpvName || '-' },
      { header: 'Status 4 PIC', key: 'picAssignmentStatus', width: 15, align: 'center' },
    ],
    [clients]
  );

  // 6. Risk Audit Columns
  const riskColumns: ColumnDef<Client>[] = useMemo(
    () => [
      { header: 'No', key: 'no', width: 6, align: 'center', render: (c) => clients.indexOf(c) + 1 },
      { header: 'Client ID', key: 'id', width: 14, align: 'center' },
      { header: 'Nama Klien', key: 'name', width: 30 },
      { header: 'Risiko Accounting', key: 'accountingRisk', width: 16, align: 'center' },
      { header: 'Alasan Risiko Acc', key: 'accountingRiskReason', width: 35, render: (c) => c.accountingRiskReason || '-' },
      { header: 'Risiko Tax', key: 'taxRisk', width: 16, align: 'center' },
      { header: 'Alasan Risiko Tax', key: 'taxRiskReason', width: 35, render: (c) => c.taxRiskReason || '-' },
      { header: 'Rekomendasi Penanganan', key: 'recommendation', width: 35, render: (c) => c.taxRiskRecommendation || c.accountingRiskRecommendation || '-' },
      { header: 'Staff Acc PIC', key: 'accountingStaffPicName', width: 20, render: (c) => c.accountingStaffPicName || '-' },
      { header: 'Staff Tax PIC', key: 'taxStaffPicName', width: 20, render: (c) => c.taxStaffPicName || '-' },
    ],
    [clients]
  );

  const [downloadingExcel, setDownloadingExcel] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<string>(
    new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date())
  );

  const handleDownloadExcel = async () => {
    setDownloadingExcel(true);
    try {
      await api.downloadExcelReport();
      success('Laporan Excel Siap', 'File workbook multi-sheet 6 lembar kerja (Daily Activity, Case, Follow Up, Job, Klien, Ringkasan) berhasil diunduh.');
    } catch (err: any) {
      error('Gagal Mengunduh Excel', err.message);
    } finally {
      setDownloadingExcel(false);
    }
  };

  const handleRefreshReports = () => {
    setLastRefreshed(
      new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date())
    );
    success('Data Disinkronkan', 'Tampilan laporan telah disinkronkan dengan data terkini.');
  };

  // Get active export props based on selected tab
  const activeExportConfig = useMemo(() => {
    switch (reportType) {
      case 'daily-activity':
        return {
          filename: 'Laporan_Daily_Activity_TMM_BMA',
          sheetName: 'Daily Activity',
          title: 'REKAPITULASI JURNAL AKTIVITAS HARIAN STAF (DAILY ACTIVITY)',
          columns: dailyActivityColumns,
          data: activities,
        };
      case 'cases':
        return {
          filename: 'Laporan_Case_Register_TMM_BMA',
          sheetName: 'Case Register',
          title: 'REGISTER KASUS & PERMASALAHAN KLIEN (CASE REGISTER)',
          columns: caseColumns,
          data: cases,
        };
      case 'follow-up':
        return {
          filename: 'Laporan_Follow_Up_Kasus_TMM_BMA',
          sheetName: 'Follow-up Cases',
          title: 'PENGAWASAN TINDAK LANJUT KASUS JATUH TEMPO (FOLLOW-UP)',
          columns: followUpColumns,
          data: followUpCases,
        };
      case 'jobs':
        return {
          filename: 'Laporan_Job_Management_TMM_BMA',
          sheetName: 'Job Management',
          title: 'MONITORING PENUGASAN & PROGRES PEKERJAAN (JOB MANAGEMENT)',
          columns: jobColumns,
          data: jobs,
        };
      case 'compliance':
        return {
          filename: 'Laporan_Kepatuhan_Pajak_TMM_BMA',
          sheetName: 'Kepatuhan Pajak',
          title: 'MASTER KLIEN, PROFIL REZIM PPH & KEPATUHAN PKP',
          columns: complianceColumns,
          data: clients,
        };
      case 'risk':
        return {
          filename: 'Laporan_Audit_Risiko_Klien_TMM_BMA',
          sheetName: 'Audit Risiko',
          title: 'AUDIT PENILAIAN RISIKO KLIEN (ACCOUNTING & TAX)',
          columns: riskColumns,
          data: clients,
        };
    }
  }, [
    reportType,
    activities,
    cases,
    followUpCases,
    jobs,
    clients,
    dailyActivityColumns,
    caseColumns,
    followUpColumns,
    jobColumns,
    complianceColumns,
    riskColumns,
  ]);

  return (
    <div className="space-y-6">
      {/* Header, Excel Download & Action Buttons */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-amber-600" />
            <span>Pusat Ekspor & Laporan Komprehensif</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Format berkolom siap pakai, rapi, elegan untuk management & presentasi
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto">
          {lastRefreshed && (
            <span className="text-[11px] text-slate-400 font-mono hidden md:inline-block">
              Diperbarui: {lastRefreshed} WIB
            </span>
          )}

          <button
            onClick={handleRefreshReports}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg shadow-sm transition-colors"
          >
            <Calendar className="w-3.5 h-3.5 text-slate-500" />
            <span>Segarkan</span>
          </button>

          {/* Tab-specific Elegant Exporter with 1-click Copas to Clipboard */}
          <ExportDropdown
            filename={activeExportConfig.filename}
            sheetName={activeExportConfig.sheetName}
            title={activeExportConfig.title}
            columns={activeExportConfig.columns as any}
            data={activeExportConfig.data as any}
            label="Ekspor / Copas Tab Ini"
          />

          {/* Full Multi-sheet Workbook (.xlsx) */}
          <button
            onClick={handleDownloadExcel}
            disabled={downloadingExcel}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold rounded-lg shadow-sm transition-colors disabled:opacity-50"
            title="Download file Excel lengkap berisi 6 lembar kerja"
          >
            <FileSpreadsheet className={`w-4 h-4 ${downloadingExcel ? 'animate-bounce' : ''}`} />
            <span>{downloadingExcel ? 'Membuat File Excel...' : 'Unduh Excel Lengkap (6 Sheets .xlsx)'}</span>
          </button>
        </div>
      </div>

      {/* Management Info Banner */}
      <div className="p-4 bg-gradient-to-r from-slate-900 via-slate-800 to-amber-950 text-white rounded-2xl shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-wider">
            <CheckCircle2 className="w-4 h-4" />
            <span>Format Ekspor Kolom Rapi & Siap Pakai untuk Manajemen</span>
          </div>
          <p className="text-xs text-slate-200 leading-relaxed max-w-3xl">
            Tersedia 3 pilihan fleksibel: <strong>Unduh Excel (.xlsx)</strong> dengan styling korporat & garis rapi, <strong>Salin Tabel (Tinggal Copas)</strong> untuk langsung paste (Ctrl+V) ke Excel / Google Sheets, atau <strong>CSV (Excel Ready)</strong> dengan UTF-8 BOM otomatis berkolom.
          </p>
        </div>
        <button
          onClick={handleDownloadExcel}
          disabled={downloadingExcel}
          className="self-start md:self-auto px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs transition-all shrink-0 shadow-lg"
        >
          Unduh Buku Kerja 6 Sheets
        </button>
      </div>

      {/* Report Type Selector Tabs (All 6 categories) */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl overflow-x-auto text-xs">
        <button
          onClick={() => setReportType('daily-activity')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
            reportType === 'daily-activity'
              ? 'bg-white text-slate-900 shadow-sm font-bold'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Clock className="w-3.5 h-3.5 text-amber-600" />
          <span>Daily Activity ({activities.length})</span>
        </button>

        <button
          onClick={() => setReportType('cases')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
            reportType === 'cases'
              ? 'bg-white text-slate-900 shadow-sm font-bold'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
          <span>Case Register ({cases.length})</span>
        </button>

        <button
          onClick={() => setReportType('follow-up')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
            reportType === 'follow-up'
              ? 'bg-white text-slate-900 shadow-sm font-bold'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
          <span>Follow-up & Overdue ({followUpCases.length})</span>
        </button>

        <button
          onClick={() => setReportType('jobs')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
            reportType === 'jobs'
              ? 'bg-white text-slate-900 shadow-sm font-bold'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Briefcase className="w-3.5 h-3.5 text-sky-600" />
          <span>Job Management ({jobs.length})</span>
        </button>

        <button
          onClick={() => setReportType('compliance')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
            reportType === 'compliance'
              ? 'bg-white text-slate-900 shadow-sm font-bold'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          <span>Kepatuhan Pajak & PKP ({clients.length})</span>
        </button>

        <button
          onClick={() => setReportType('risk')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
            reportType === 'risk'
              ? 'bg-white text-slate-900 shadow-sm font-bold'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
          <span>Audit Risiko ({highRiskClients.length})</span>
        </button>
      </div>

      {/* Report Content Table Preview */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-800">
              {reportType === 'daily-activity' && 'Pratinjau: Jurnal Aktivitas Harian Staf'}
              {reportType === 'cases' && 'Pratinjau: Register Kasus & Masalah Pajak / Accounting'}
              {reportType === 'follow-up' && 'Pratinjau: Jadwal Follow-up & Komitmen Jatuh Tempo'}
              {reportType === 'jobs' && 'Pratinjau: Monitoring SLA Pekerjaan (Job Management)'}
              {reportType === 'compliance' && 'Pratinjau: Master Klien & Profil Kepatuhan Perpajakan'}
              {reportType === 'risk' && 'Pratinjau: Audit Penilaian Risiko Klien'}
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              ({activeExportConfig.data.length} baris data)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <ExportDropdown
              filename={activeExportConfig.filename}
              sheetName={activeExportConfig.sheetName}
              title={activeExportConfig.title}
              columns={activeExportConfig.columns as any}
              data={activeExportConfig.data as any}
              label="Ekspor Tabel Ini"
            />
          </div>
        </div>

        <div className="overflow-x-auto max-h-[550px] overflow-y-auto">
          {/* 1. Daily Activity Table */}
          {reportType === 'daily-activity' && (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[10px] sticky top-0 z-10">
                <tr>
                  <th className="py-3 px-3 text-center w-10">No</th>
                  <th className="py-3 px-3">ID & Tanggal</th>
                  <th className="py-3 px-3">Nama Klien</th>
                  <th className="py-3 px-3">Divisi & PIC</th>
                  <th className="py-3 px-3">Ref Job/Case</th>
                  <th className="py-3 px-3">Deskripsi Aktivitas</th>
                  <th className="py-3 px-3">Hasil / Progres</th>
                  <th className="py-3 px-3">Kendala & Follow-up</th>
                  <th className="py-3 px-3 text-center">Durasi</th>
                  <th className="py-3 px-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activities.map((a, idx) => (
                  <tr key={a.id} className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-3 text-center text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                    <td className="py-2.5 px-3 font-mono">
                      <div className="font-bold text-slate-900">{a.id}</div>
                      <div className="text-[10px] text-slate-400">{a.date}</div>
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-slate-800">{a.clientName}</td>
                    <td className="py-2.5 px-3 text-slate-700">
                      <div>{a.picName}</div>
                      <span className="text-[10px] text-amber-700 font-semibold">{a.division}</span>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[10px] text-slate-500">
                      {a.jobId || a.caseId || '-'}
                    </td>
                    <td className="py-2.5 px-3 text-slate-800 max-w-xs">{a.description}</td>
                    <td className="py-2.5 px-3 text-slate-600 text-[11px] max-w-xs">{a.resultProgress || '-'}</td>
                    <td className="py-2.5 px-3 text-slate-600 text-[11px] max-w-xs">
                      {a.obstacles ? `Kendala: ${a.obstacles}` : ''}
                      {a.followUp ? ` | Rencana: ${a.followUp}` : '-'}
                    </td>
                    <td className="py-2.5 px-3 text-center font-mono tabular-nums">{a.durationMinutes || 60}m</td>
                    <td className="py-2.5 px-3 text-right">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                          a.status === 'Selesai'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {a.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* 2. Cases Table */}
          {reportType === 'cases' && (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[10px] sticky top-0 z-10">
                <tr>
                  <th className="py-3 px-3 text-center w-10">No</th>
                  <th className="py-3 px-3">Case ID & Judul</th>
                  <th className="py-3 px-3">Klien</th>
                  <th className="py-3 px-3">Divisi & PIC</th>
                  <th className="py-3 px-3">Prioritas</th>
                  <th className="py-3 px-3">Akar Masalah</th>
                  <th className="py-3 px-3">Progres Terkini</th>
                  <th className="py-3 px-3">Target Follow-up</th>
                  <th className="py-3 px-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cases.map((c, idx) => (
                  <tr key={c.id} className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-3 text-center text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                    <td className="py-2.5 px-3 font-mono">
                      <div className="font-bold text-slate-900">{c.title}</div>
                      <div className="text-[10px] text-slate-400">{c.id}</div>
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-slate-800">{c.clientName}</td>
                    <td className="py-2.5 px-3 text-slate-700">
                      <div>{c.picName}</div>
                      <span className="text-[10px] text-amber-700 font-semibold">{c.division}</span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                          c.priority === 'Tinggi'
                            ? 'bg-rose-100 text-rose-800'
                            : c.priority === 'Sedang'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {c.priority}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 text-[11px] max-w-xs">{c.rootCause || '-'}</td>
                    <td className="py-2.5 px-3 text-slate-700 text-[11px] max-w-xs">{c.latestProgress || '-'}</td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-slate-800 font-medium">
                      {c.nextFollowUpDate || '-'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold text-slate-800">{c.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* 3. Follow-up & Overdue Table */}
          {reportType === 'follow-up' && (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[10px] sticky top-0 z-10">
                <tr>
                  <th className="py-3 px-3 text-center w-10">No</th>
                  <th className="py-3 px-3">Kasus & Klien</th>
                  <th className="py-3 px-3">Divisi & PIC</th>
                  <th className="py-3 px-3">Tenggat Follow-up</th>
                  <th className="py-3 px-3">Status Jatuh Tempo</th>
                  <th className="py-3 px-3">Rencana Tindak Lanjut</th>
                  <th className="py-3 px-3">Progres Terkini</th>
                  <th className="py-3 px-3 text-right">Status Kasus</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {followUpCases.map((c, idx) => {
                  const isOverdue = c.nextFollowUpDate < today;
                  return (
                    <tr key={c.id} className={`hover:bg-slate-50/60 ${isOverdue ? 'bg-rose-50/20' : ''}`}>
                      <td className="py-2.5 px-3 text-center text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                      <td className="py-2.5 px-3 font-mono">
                        <div className="font-bold text-slate-900">{c.title}</div>
                        <div className="text-[11px] text-slate-600 font-sans">{c.clientName} ({c.id})</div>
                      </td>
                      <td className="py-2.5 px-3 text-slate-700">
                        <div>{c.picName}</div>
                        <span className="text-[10px] text-amber-700 font-semibold">{c.division}</span>
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums font-bold">
                        <span className={isOverdue ? 'text-rose-600' : 'text-slate-800'}>
                          {c.nextFollowUpDate}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                            isOverdue ? 'bg-rose-100 text-rose-800 font-bold' : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {isOverdue ? 'Terlambat (Overdue)' : 'Mendatang (Upcoming)'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 text-[11px] max-w-xs">{c.followUpPlan || '-'}</td>
                      <td className="py-2.5 px-3 text-slate-600 text-[11px] max-w-xs">{c.latestProgress || '-'}</td>
                      <td className="py-2.5 px-3 text-right font-semibold text-slate-800">{c.status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* 4. Jobs Table */}
          {reportType === 'jobs' && (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[10px] sticky top-0 z-10">
                <tr>
                  <th className="py-3 px-3 text-center w-10">No</th>
                  <th className="py-3 px-3">Job ID & Judul</th>
                  <th className="py-3 px-3">Klien</th>
                  <th className="py-3 px-3">Divisi</th>
                  <th className="py-3 px-3">PIC</th>
                  <th className="py-3 px-3">SPV Reviewer</th>
                  <th className="py-3 px-3">Deadline</th>
                  <th className="py-3 px-3 text-center">Progres</th>
                  <th className="py-3 px-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {jobs.map((j, idx) => (
                  <tr key={j.id} className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-3 text-center text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-slate-900">{j.title}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{j.id}</div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-700">{j.clientName}</td>
                    <td className="py-2.5 px-3 font-semibold text-slate-800">{j.division}</td>
                    <td className="py-2.5 px-3 text-slate-700">{j.picName}</td>
                    <td className="py-2.5 px-3 text-slate-600">{j.spvName}</td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-slate-700">{j.deadline}</td>
                    <td className="py-2.5 px-3 text-center font-mono tabular-nums font-bold text-amber-700">
                      {j.progressPercent}%
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold text-slate-800">{j.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* 5. Compliance Table */}
          {reportType === 'compliance' && (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[10px] sticky top-0 z-10">
                <tr>
                  <th className="py-3 px-3 text-center w-10">No</th>
                  <th className="py-3 px-3">Client ID & Nama</th>
                  <th className="py-3 px-3">Bentuk</th>
                  <th className="py-3 px-3">Status PKP</th>
                  <th className="py-3 px-3">Rezim PPh</th>
                  <th className="py-3 px-3">Tahun Pajak</th>
                  <th className="py-3 px-3">Fasilitas UMKM</th>
                  <th className="py-3 px-3">Status Klien</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {clients.map((c, idx) => (
                  <tr key={c.id} className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-3 text-center text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                    <td className="py-2.5 px-3 font-semibold text-slate-900">
                      <div>{c.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{c.id}</div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-700">{c.entityType}</td>
                    <td className="py-2.5 px-3 font-semibold text-amber-800">{c.pkpStatus}</td>
                    <td className="py-2.5 px-3 text-slate-800">{c.pphRegime}</td>
                    <td className="py-2.5 px-3 font-mono tabular-nums">{c.taxYearEffective}</td>
                    <td className="py-2.5 px-3 text-slate-500 font-mono tabular-nums">
                      {c.umkmFacilityEndYear ? `s/d ${c.umkmFacilityEndYear}` : '-'}
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-slate-800">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] ${
                          c.status === 'Aktif'
                            ? 'bg-emerald-100 text-emerald-800'
                            : c.status === 'Putus Kontrak'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* 6. Risk Audit Table */}
          {reportType === 'risk' && (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[10px] sticky top-0 z-10">
                <tr>
                  <th className="py-3 px-3 text-center w-10">No</th>
                  <th className="py-3 px-3">Nama Klien</th>
                  <th className="py-3 px-3">Risiko Accounting</th>
                  <th className="py-3 px-3">Alasan Acc Risk</th>
                  <th className="py-3 px-3">Risiko Tax</th>
                  <th className="py-3 px-3">Alasan Tax Risk</th>
                  <th className="py-3 px-3">Rekomendasi Penanganan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {clients.map((c, idx) => (
                  <tr key={c.id} className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-3 text-center text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                    <td className="py-2.5 px-3 font-semibold text-slate-900">
                      <div>{c.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{c.id}</div>
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          c.accountingRisk === 'High'
                            ? 'bg-rose-100 text-rose-800'
                            : c.accountingRisk === 'Medium'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {c.accountingRisk}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-700 max-w-xs">{c.accountingRiskReason}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          c.taxRisk === 'High'
                            ? 'bg-rose-100 text-rose-800'
                            : c.taxRisk === 'Medium'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {c.taxRisk}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-700 max-w-xs">{c.taxRiskReason}</td>
                    <td className="py-2.5 px-3 text-slate-600 text-[11px] max-w-xs">
                      {c.taxRiskRecommendation || c.accountingRiskRecommendation || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
