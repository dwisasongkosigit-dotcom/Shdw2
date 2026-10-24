import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Briefcase,
  Search,
  Filter,
  Plus,
  Clock,
  CheckCircle2,
  AlertTriangle,
  History,
  X,
  Edit,
  Save,
  Send,
  RotateCcw,
  RefreshCw,
  ChevronRight,
  ShieldAlert,
  Trash2,
  Download,
  AlertOctagon,
} from 'lucide-react';
import { api, type Job, type JobDivision, type Client, type CurrentUser, type JobStatus, type UserAccount } from '../lib/api';
import { useToast } from './Toast';
import { ExportDropdown } from './ExportDropdown';
import type { ColumnDef } from '../lib/exportUtils';

interface JobsViewProps {
  jobs: Job[];
  clients: Client[];
  users: UserAccount[];
  currentUser: CurrentUser;
  onRefresh: () => void;
  isRefreshing?: boolean;
  lastUpdated?: string;
}

export function JobsView({
  jobs,
  clients,
  users,
  currentUser,
  onRefresh,
  isRefreshing = false,
  lastUpdated,
}: JobsViewProps) {
  const { success, error, warning } = useToast();
  const currentDivision = currentUser.role.includes('Accounting') ? 'Accounting' : 'Tax';
  const [divisionFilter, setDivisionFilter] = useState<'All' | 'Accounting' | 'Tax'>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [priorityFilter, setPriorityFilter] = useState<string>('All');
  const [searchTerm, setSearchTerm] = useState('');

  // Selected job for detail / update
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Review / update inputs
  const [updateStatus, setUpdateStatus] = useState<JobStatus>('Dalam Proses');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [actionNotes, setActionNotes] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');

  // Auto-save status indicator
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const autoSaveTimeoutRef = useRef<any>(null);

  // Delete Job State
  const [jobToDelete, setJobToDelete] = useState<Job | null>(null);
  const [deletingJob, setDeletingJob] = useState(false);

  // New job form
  type JobDivisionSelection = JobDivision | 'Both';
  type JobPicAssignment = { picId: string; picName: string };
  type NewJobData = Omit<Partial<Job>, 'division'> & {
    division?: JobDivisionSelection;
    picAssignments?: Partial<Record<JobDivision, JobPicAssignment>>;
  };

  const [newJobData, setNewJobData] = useState<NewJobData>({
    division: currentUser.role.includes('Tax') ? 'Tax' : 'Accounting',
    priority: 'Sedang',
    startDate: new Date().toISOString().split('T')[0],
    deadline: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
  });

  const today = new Date().toISOString().split('T')[0];

  const isReadOnly = currentUser.role === 'Owner' || currentUser.role === 'Manager';
  const isSPV =
    !isReadOnly &&
    (currentUser.role === 'Admin' ||
      currentUser.role === 'SPV Accounting' ||
      currentUser.role === 'SPV Tax');
  const isStaff = !isReadOnly && currentUser.role.startsWith('Staff');

  // Filtered jobs
  const filteredJobs = useMemo(() => {
    return jobs.filter((j) => {
      if (divisionFilter !== 'All' && j.division !== divisionFilter) return false;
      if (statusFilter !== 'All') {
        if (statusFilter === 'Terlambat') {
          if (j.status === 'Selesai' || j.deadline >= today) return false;
        } else if (j.status !== statusFilter) {
          return false;
        }
      }
      if (priorityFilter !== 'All' && j.priority !== priorityFilter) return false;

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const mTitle = j.title.toLowerCase().includes(q);
        const mClient = j.clientName.toLowerCase().includes(q);
        const mId = j.id.toLowerCase().includes(q);
        const mPic = j.picName.toLowerCase().includes(q);
        if (!mTitle && !mClient && !mId && !mPic) return false;
      }
      return true;
    });
  }, [jobs, divisionFilter, statusFilter, priorityFilter, searchTerm, today]);

  const handleOpenDetail = (job: Job) => {
    setSelectedJob(job);
    setUpdateStatus(job.status);
    setProgressPercent(job.progressPercent || 0);
    setActionNotes('');
    setReviewNotes(job.reviewNotes || '');
    setAutoSaveStatus('idle');
  };

  const getClientPicAssignment = (client: Client | undefined, division: JobDivision): JobPicAssignment => {
    const requiredRole = division === 'Accounting' ? 'Staff Accounting' : 'Staff Tax';
    const clientPicId = division === 'Accounting' ? client?.accountingStaffPicId : client?.taxStaffPicId;
    const clientPic = users.find((user) => user.active && user.id === clientPicId && user.role === requiredRole)
      || users.find((user) => user.active && user.role === requiredRole);
    return { picId: clientPic?.id || '', picName: clientPic?.name || '' };
  };

  const handleClientOrDivisionChange = (clientId: string, division: JobDivisionSelection) => {
    const client = clients.find((candidate) => candidate.id === clientId);
    if (!client) return;

    const picAssignments = {
      Accounting: getClientPicAssignment(client, 'Accounting'),
      Tax: getClientPicAssignment(client, 'Tax'),
    };
    const defaultDivision = division === 'Tax' ? 'Tax' : 'Accounting';

    setNewJobData((previous) => ({
      ...previous,
      clientId,
      clientName: client.name,
      division,
      picAssignments,
      picId: division === 'Both' ? undefined : picAssignments[defaultDivision].picId,
      picName: division === 'Both' ? undefined : picAssignments[defaultDivision].picName,
      spvId: defaultDivision === 'Accounting' ? client.accountingSpvId : client.taxSpvId,
      spvName: defaultDivision === 'Accounting' ? client.accountingSpvName : client.taxSpvName,
    }));
  };

  const handleOpenAddModal = () => {
    const initialClient = clients[0];
    const initialDiv: JobDivisionSelection = currentUser.role.includes('Tax') ? 'Tax' : 'Accounting';
    const picAssignments = {
      Accounting: getClientPicAssignment(initialClient, 'Accounting'),
      Tax: getClientPicAssignment(initialClient, 'Tax'),
    };
    const defaultDivision = initialDiv === 'Tax' ? 'Tax' : 'Accounting';

    setNewJobData({
      division: initialDiv,
      priority: 'Sedang',
      startDate: new Date().toISOString().split('T')[0],
      deadline: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
      clientId: initialClient?.id || '',
      clientName: initialClient?.name || '',
      picAssignments,
      picId: picAssignments[defaultDivision].picId,
      picName: picAssignments[defaultDivision].picName,
      spvId: defaultDivision === 'Accounting' ? initialClient?.accountingSpvId : initialClient?.taxSpvId,
      spvName: defaultDivision === 'Accounting' ? initialClient?.accountingSpvName : initialClient?.taxSpvName,
    });
    setIsAddModalOpen(true);
  };

  const handleCreateJob = async () => {
    if (!newJobData.title?.trim() || !newJobData.clientId || !newJobData.deadline) {
      error('Validasi Gagal', 'Klien, judul pekerjaan, dan deadline wajib diisi.');
      return;
    }

    const assignedDivisions: JobDivision[] = newJobData.division === 'Both'
      ? ['Accounting', 'Tax']
      : [newJobData.division || 'Accounting'];
    if (assignedDivisions.some((division) => !newJobData.picAssignments?.[division]?.picId)) {
      error('PIC Belum Dipilih', 'Pilih PIC aktif untuk setiap divisi yang ditugaskan.');
      return;
    }

    setSaving(true);
    try {
      const selectedClient = clients.find((c) => c.id === newJobData.clientId);
      await api.createJob({
        ...newJobData,
        clientName: selectedClient?.name || 'Klien',
      });
      success('Pekerjaan Dibuat', assignedDivisions.length === 2
        ? 'Pekerjaan Accounting dan Tax berhasil dibuat dengan PIC masing-masing.'
        : `Pekerjaan ${assignedDivisions[0]} berhasil ditugaskan kepada PIC terpilih.`);
      setIsAddModalOpen(false);
      onRefresh();
    } catch (err: any) {
      error('Gagal Membuat Pekerjaan', err.message);
    } finally {
      setSaving(false);
    }
  };

  // Section 7.E: Auto-save notes/progress changes with debouncing
  const triggerAutoSave = (newPercent: number, noteText: string) => {
    if (!selectedJob || isReadOnly) return;
    if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);

    setAutoSaveStatus('saving');
    autoSaveTimeoutRef.current = setTimeout(async () => {
      try {
        await api.updateJob(selectedJob.id, {
          progressPercent: newPercent,
          notes: noteText,
          expectedVersion: selectedJob.version,
          historyNote: `Pembaruan progres otomatis ke ${newPercent}%`,
        });
        setAutoSaveStatus('saved');
        setTimeout(() => setAutoSaveStatus('idle'), 3000);
      } catch (err) {
        setAutoSaveStatus('error');
      }
    }, 1500);
  };

  // Staff Submitting Job for Review
  const handleSubmitForReview = async () => {
    if (!selectedJob || isReadOnly) return;
    setSaving(true);
    try {
      await api.updateJob(selectedJob.id, {
        status: 'Siap Direview',
        progressPercent: Math.max(progressPercent, 95),
        expectedVersion: selectedJob.version,
        historyNote: actionNotes || 'Pekerjaan telah selesai dikerjakan staf dan diajukan untuk review SPV.',
      });
      success('Pekerjaan Diajukan', 'Pekerjaan telah masuk ke antrean review SPV.');
      setSelectedJob(null);
      onRefresh();
    } catch (err: any) {
      error('Gagal Mengajukan Review', err.message);
    } finally {
      setSaving(false);
    }
  };

  // SPV Approving Job as 'Selesai'
  const handleApproveJob = async () => {
    if (!selectedJob || isReadOnly) return;
    setSaving(true);
    try {
      await api.updateJob(selectedJob.id, {
        status: 'Selesai',
        progressPercent: 100,
        expectedVersion: selectedJob.version,
        reviewNotes: actionNotes || 'Disetujui oleh SPV. Pekerjaan dinyatakan Selesai.',
        historyNote: actionNotes || 'Persetujuan resmi dari SPV.',
      });
      success('Pekerjaan Disetujui', 'Pekerjaan selesai; perubahan hanya tersimpan sementara selama server berjalan.');
      setSelectedJob(null);
      onRefresh();
    } catch (err: any) {
      error('Akses Ditolak', err.message);
    } finally {
      setSaving(false);
    }
  };

  // SPV Requesting Revision
  const handleRequestRevision = async () => {
    if (!selectedJob || isReadOnly) return;
    if (!actionNotes.trim() && !reviewNotes.trim()) {
      warning('Catatan Wajib', 'Harap masukkan catatan detail bagian yang perlu direvisi oleh staf.');
      return;
    }

    setSaving(true);
    try {
      await api.updateJob(selectedJob.id, {
        status: 'Perlu Revisi',
        expectedVersion: selectedJob.version,
        reviewNotes: actionNotes || reviewNotes,
        historyNote: `Instruksi revisi SPV: ${actionNotes || reviewNotes}`,
      });
      warning('Revisi Diminta', 'Pekerjaan dikembalikan ke staf dengan catatan revisi.');
      setSelectedJob(null);
      onRefresh();
    } catch (err: any) {
      error('Gagal Meminta Revisi', err.message);
    } finally {
      setSaving(false);
    }
  };

  // Explicit Update Button Handler (Section 7.B)
  const handleUpdateJobExplicit = async () => {
    if (!selectedJob || isReadOnly) return;

    if (updateStatus === 'Selesai' && isStaff) {
      error(
        'Pelanggaran Hak Akses',
        'Staff tidak memiliki kewenangan menyetujui pekerjaan (status Selesai). Harap ajukan pekerjaan ke SPV melalui status "Siap Direview".'
      );
      return;
    }

    setSaving(true);
    try {
      await api.updateJob(selectedJob.id, {
        status: updateStatus,
        progressPercent,
        notes: actionNotes || selectedJob.notes,
        expectedVersion: selectedJob.version,
        historyNote: actionNotes || `Update status ke ${updateStatus} (Progres: ${progressPercent}%)`,
      });
      success('Berhasil Disimpan', 'Pembaruan pekerjaan hanya tersimpan sementara selama server berjalan.');
      setSelectedJob(null);
      onRefresh();
    } catch (err: any) {
      error('Gagal Memperbarui', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDeleteJob = async () => {
    if (!jobToDelete) return;
    setDeletingJob(true);
    try {
      await api.deleteJob(jobToDelete.id);
      success('Pekerjaan Dihapus', `Pekerjaan '${jobToDelete.title}' (${jobToDelete.id}) berhasil dihapus.`);
      setJobToDelete(null);
      if (selectedJob?.id === jobToDelete.id) {
        setSelectedJob(null);
      }
      onRefresh();
    } catch (err: any) {
      error('Gagal Menghapus Pekerjaan', err.message);
    } finally {
      setDeletingJob(false);
    }
  };

  const jobExportColumns: ColumnDef<Job>[] = useMemo(
    () => [
      { header: 'No', key: 'no', width: 6, align: 'center', render: (j) => filteredJobs.indexOf(j) + 1 },
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
    [filteredJobs]
  );

  const selectableJobDivisions: JobDivisionSelection[] = currentUser.role === 'Admin'
    ? ['Accounting', 'Tax', 'Both']
    : currentUser.role === 'SPV Accounting'
      ? ['Accounting']
      : ['Tax'];
  const selectedClientForJob = clients.find((client) => client.id === newJobData.clientId);
  const activeJobDivisions: JobDivision[] = newJobData.division === 'Both'
    ? ['Accounting', 'Tax']
    : [newJobData.division || 'Accounting'];

  return (
    <div className="space-y-6">
      {/* Top Action Bar & Filter Row */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pb-2">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Cari ID job, judul, klien, atau PIC..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg placeholder-slate-400 focus:outline-none focus:border-amber-500"
          />
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          {/* Refresh Button */}
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50"
            title="Muat data terbaru dari database"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-amber-600' : 'text-slate-600'}`} />
            <span>{isRefreshing ? 'Memuat Data...' : 'Muat Ulang'}</span>
          </button>
          {lastUpdated && (
            <span className="hidden lg:inline-block text-[11px] text-slate-400 font-mono tabular-nums">
              {lastUpdated}
            </span>
          )}

          <ExportDropdown
            filename="Daftar_Pekerjaan_Jobs_TMM_BMA"
            sheetName="Jobs"
            title="MONITORING PENUGASAN & PROGRES PEKERJAAN (JOB MANAGEMENT)"
            subtitle={`Filter: ${divisionFilter} | Status: ${statusFilter} | Total: ${filteredJobs.length} pekerjaan`}
            columns={jobExportColumns}
            data={filteredJobs}
            label="Ekspor & Copas"
          />

          {isSPV && (
            <button
              onClick={handleOpenAddModal}
              className="flex items-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Tugaskan Pekerjaan (Job)</span>
            </button>
          )}
        </div>
      </div>

      {/* Segmented Filter Bar */}
      <div className="p-3.5 bg-white border border-slate-200 rounded-xl flex flex-wrap gap-2.5 items-center text-xs">
        {/* Division Tab */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            onClick={() => setDivisionFilter('All')}
            className={`px-3 py-1 rounded-md font-medium transition-colors ${
              divisionFilter === 'All' ? 'bg-white text-slate-900 shadow-sm font-semibold' : 'text-slate-600'
            }`}
          >
            Semua Divisi
          </button>
          <button
            onClick={() => setDivisionFilter('Accounting')}
            className={`px-3 py-1 rounded-md font-medium transition-colors ${
              divisionFilter === 'Accounting' ? 'bg-white text-slate-900 shadow-sm font-semibold' : 'text-slate-600'
            }`}
          >
            Accounting
          </button>
          <button
            onClick={() => setDivisionFilter('Tax')}
            className={`px-3 py-1 rounded-md font-medium transition-colors ${
              divisionFilter === 'Tax' ? 'bg-white text-slate-900 shadow-sm font-semibold' : 'text-slate-600'
            }`}
          >
            Tax
          </button>
        </div>

        {/* Status Dropdown */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-slate-700 font-medium focus:outline-none"
        >
          <option value="All">Semua Status</option>
          <option value="Belum Dimulai">Belum Dimulai</option>
          <option value="Dalam Proses">Dalam Proses</option>
          <option value="Menunggu Klien">Menunggu Klien</option>
          <option value="Siap Direview">Siap Direview (Pending SPV)</option>
          <option value="Perlu Revisi">Perlu Revisi</option>
          <option value="Selesai">Selesai (Approved)</option>
          <option value="Terlambat">Jatuh Tempo (Overdue)</option>
        </select>

        {/* Priority Dropdown */}
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-slate-700 font-medium focus:outline-none"
        >
          <option value="All">Semua Prioritas</option>
          <option value="Mendesak">Mendesak</option>
          <option value="Tinggi">Tinggi</option>
          <option value="Sedang">Sedang</option>
          <option value="Rendah">Rendah</option>
        </select>

        <span className="ml-auto text-slate-400 font-mono tabular-nums text-[11px]">
          {filteredJobs.length} Pekerjaan
        </span>
      </div>

      {/* Jobs Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-3 px-4">Job ID & Judul</th>
                <th className="py-3 px-3">Klien</th>
                <th className="py-3 px-3">Divisi</th>
                <th className="py-3 px-3">PIC & SPV Reviewer</th>
                <th className="py-3 px-3">Deadline</th>
                <th className="py-3 px-3 text-center">Progres</th>
                <th className="py-3 px-3 text-center">Status</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredJobs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    Tidak ada pekerjaan yang cocok dengan kriteria filter.
                  </td>
                </tr>
              ) : (
                filteredJobs.map((job) => {
                  const isOverdue = job.status !== 'Selesai' && job.deadline < today;

                  return (
                    <tr
                      key={job.id}
                      onClick={() => handleOpenDetail(job)}
                      className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                    >
                      {/* Title & ID */}
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 group-hover:text-amber-700 transition-colors line-clamp-1">
                          {job.title}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5">
                          {job.id} · Prioritas: {job.priority} · v{job.version}
                        </div>
                      </td>

                      {/* Client */}
                      <td className="py-3 px-3 text-slate-700 font-medium max-w-[160px] truncate">
                        {job.clientName}
                      </td>

                      {/* Division */}
                      <td className="py-3 px-3">
                        <span
                          className={`inline-block font-semibold ${
                            job.division === 'Tax' ? 'text-amber-700' : 'text-sky-700'
                          }`}
                        >
                          {job.division}
                        </span>
                      </td>

                      {/* PIC & SPV */}
                      <td className="py-3 px-3">
                        <div className="text-[11px] text-slate-800 font-medium truncate max-w-[130px]">
                          PIC: {job.picName}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate max-w-[130px]">
                          SPV: {job.spvName}
                        </div>
                      </td>

                      {/* Deadline & Overdue */}
                      <td className="py-3 px-3">
                        <div
                          className={`font-mono tabular-nums font-medium ${
                            isOverdue ? 'text-rose-600 font-bold' : 'text-slate-700'
                          }`}
                        >
                          {job.deadline}
                        </div>
                        {isOverdue && (
                          <div className="text-[10px] text-rose-500 font-semibold">
                            Lewat Batas Waktu
                          </div>
                        )}
                      </td>

                      {/* Progress Bar */}
                      <td className="py-3 px-3 text-center">
                        <div className="inline-flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-amber-600 rounded-full"
                              style={{ width: `${job.progressPercent}%` }}
                            />
                          </div>
                          <span className="font-mono tabular-nums text-[10px] font-semibold text-slate-700">
                            {job.progressPercent}%
                          </span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                            job.status === 'Selesai'
                              ? 'bg-emerald-100 text-emerald-800'
                              : job.status === 'Siap Direview'
                              ? 'bg-amber-100 text-amber-800 animate-pulse'
                              : job.status === 'Perlu Revisi'
                              ? 'bg-rose-100 text-rose-800'
                              : job.status === 'Dalam Proses'
                              ? 'bg-sky-100 text-sky-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {job.status}
                        </span>
                      </td>

                      {/* Action */}
                      <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleOpenDetail(job)}
                            className="text-xs font-semibold text-amber-700 hover:text-amber-800 inline-flex items-center gap-0.5"
                          >
                            Detail <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                          {(currentUser.role === 'Admin' ||
                            (currentUser.role === 'SPV Accounting' && job.division === 'Accounting') ||
                            (currentUser.role === 'SPV Tax' && job.division === 'Tax')) && (
                            <button
                              onClick={() => setJobToDelete(job)}
                              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                              title="Hapus Pekerjaan"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail / Approval Drawer */}
      {selectedJob && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-slate-500">{selectedJob.id}</span>
                  <span className="text-slate-300">·</span>
                  <span className="text-xs font-semibold text-amber-700">{selectedJob.division}</span>
                  <span className="text-slate-300">·</span>
                  <span className="text-[10px] font-mono text-slate-400">Versi: v{selectedJob.version}</span>
                </div>
                <h3 className="text-base font-bold text-slate-900 mt-0.5 line-clamp-1">
                  {selectedJob.title}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                {(currentUser.role === 'Admin' ||
                  (currentUser.role === 'SPV Accounting' && selectedJob.division === 'Accounting') ||
                  (currentUser.role === 'SPV Tax' && selectedJob.division === 'Tax')) && (
                  <button
                    onClick={() => setJobToDelete(selectedJob)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 rounded-md text-xs font-medium transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                    <span>Hapus Pekerjaan</span>
                  </button>
                )}
                <button
                  onClick={() => setSelectedJob(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs">
              {/* Meta details */}
              <div className="grid grid-cols-2 gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <div>
                  <span className="text-slate-500 font-medium">Klien:</span>
                  <p className="font-bold text-slate-900 mt-0.5">{selectedJob.clientName}</p>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">Status Pekerjaan:</span>
                  <p className="font-bold text-amber-700 mt-0.5">{selectedJob.status}</p>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">PIC Pelaksana (Divisi):</span>
                  <p className="font-semibold text-slate-800 mt-0.5">{selectedJob.picName}</p>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">SPV Reviewer (Divisi):</span>
                  <p className="font-semibold text-slate-800 mt-0.5">{selectedJob.spvName}</p>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">Mulai / Deadline:</span>
                  <p className="font-mono tabular-nums text-slate-800 mt-0.5">
                    {selectedJob.startDate} s/d {selectedJob.deadline}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">Prioritas:</span>
                  <p className="font-semibold text-slate-800 mt-0.5">{selectedJob.priority}</p>
                </div>
              </div>

              {/* Description & Review Notes */}
              <div>
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-1">
                  Deskripsi & Ruang Lingkup
                </h4>
                <p className="p-3 bg-white border border-slate-200 rounded-lg text-slate-700 leading-relaxed">
                  {selectedJob.description || 'Tidak ada uraian spesifik.'}
                </p>
              </div>

              {selectedJob.reviewNotes && (
                <div>
                  <h4 className="text-xs font-bold text-rose-800 uppercase tracking-wider mb-1">
                    Catatan Evaluasi / Catatan Revisi SPV
                  </h4>
                  <div className="p-3 bg-rose-50/60 border border-rose-200 rounded-lg text-rose-900 leading-relaxed font-medium">
                    {selectedJob.reviewNotes}
                  </div>
                </div>
              )}

              {/* Only the responsible division and assigned staff can update this job. */}
              {(!isReadOnly &&
                (currentUser.role === 'Admin' ||
                  (currentUser.role.startsWith('SPV') && selectedJob.division === currentDivision) ||
                  (isStaff && selectedJob.division === currentDivision && selectedJob.picId === currentUser.id))) ? (
                <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                      Pembaruan Progres & Approval Alur Kerja
                    </h4>
                    {/* Auto-save Status Badge (Section 7.E) */}
                    <span className="text-[11px] font-mono">
                      {autoSaveStatus === 'saving' && (
                        <span className="text-amber-700 font-semibold animate-pulse">Menyimpan otomatis...</span>
                      )}
                      {autoSaveStatus === 'saved' && (
                        <span className="text-emerald-700 font-semibold">Tersimpan di Database</span>
                      )}
                      {autoSaveStatus === 'error' && (
                        <span className="text-rose-700 font-semibold">Gagal Menyimpan</span>
                      )}
                    </span>
                  </div>

                  {/* Progress slider with Auto-save */}
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-slate-700 font-semibold">Tingkat Kemajuan (Progres):</label>
                      <span className="font-mono tabular-nums font-bold text-amber-700 text-sm">
                        {progressPercent}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={progressPercent}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setProgressPercent(val);
                        triggerAutoSave(val, actionNotes);
                      }}
                      className="w-full accent-amber-600"
                    />
                  </div>

                  {/* Status selection */}
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">Pilih Status Baru:</label>
                    <select
                      value={updateStatus}
                      onChange={(e) => setUpdateStatus(e.target.value as any)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 font-semibold"
                    >
                      <option value="Belum Dimulai">Belum Dimulai</option>
                      <option value="Dalam Proses">Dalam Proses</option>
                      <option value="Menunggu Klien">Menunggu Klien</option>
                      <option value="Siap Direview">Siap Direview (Serahkan ke SPV)</option>
                      {isSPV && <option value="Perlu Revisi">Perlu Revisi (Khusus SPV)</option>}
                      {isSPV && <option value="Selesai">Selesai (Persetujuan SPV)</option>}
                    </select>
                  </div>

                  {/* Action / Review notes with Auto-save trigger */}
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">
                      Catatan Aktivitas / Catatan Review SPV:
                    </label>
                    <textarea
                      rows={2}
                      value={actionNotes}
                      onChange={(e) => {
                        setActionNotes(e.target.value);
                        triggerAutoSave(progressPercent, e.target.value);
                      }}
                      placeholder="Tuliskan ringkasan pembaruan progres atau catatan instruksi khusus..."
                      className="w-full p-2.5 bg-white border border-slate-200 rounded-lg text-slate-900 text-xs focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  {/* Workflow Action Buttons */}
                  <div className="pt-2 flex flex-wrap gap-2">
                    {/* Staff Action: Submit for review */}
                    {selectedJob.status !== 'Selesai' && (
                      <button
                        type="button"
                        onClick={handleSubmitForReview}
                        disabled={saving}
                        className="flex items-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-semibold text-xs transition-colors shadow-sm disabled:opacity-50"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Ajukan Siap Direview SPV</span>
                      </button>
                    )}

                    {/* SPV Actions: Approve or Request Revision */}
                    {isSPV && (
                      <>
                        <button
                          type="button"
                          onClick={handleApproveJob}
                          disabled={saving}
                          className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold text-xs transition-colors shadow-sm disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Setujui (Approval Selesai)</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleRequestRevision}
                          disabled={saving}
                          className="flex items-center gap-1.5 px-3 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-semibold text-xs transition-colors shadow-sm disabled:opacity-50"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Minta Revisi Staf</span>
                        </button>
                      </>
                    )}

                    {/* Explicit Update Button (Section 7.B) */}
                    <button
                      type="button"
                      onClick={handleUpdateJobExplicit}
                      disabled={saving}
                      className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-semibold text-xs transition-colors disabled:opacity-50 shadow-sm"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>{saving ? 'Menyimpan Perubahan...' : 'Simpan Perubahan (Update)'}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-slate-100 border border-slate-200 rounded-lg text-slate-600 text-xs">
                  <strong>Mode Akses Read-Only:</strong> Peran Anda ({currentUser.role}) hanya berhak melihat data pekerjaan dan tidak dapat mengubah atau menyetujui status.
                </div>
              )}

              {/* Chronological Audit Trail History */}
              <div>
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 mb-2">
                  <History className="w-3.5 h-3.5 text-amber-600" />
                  <span>Riwayat Aktivitas & Jejak Audit (Job History):</span>
                </div>
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {selectedJob.history && selectedJob.history.length > 0 ? (
                    selectedJob.history.map((h) => (
                      <div
                        key={h.id}
                        className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px]"
                      >
                        <div className="flex justify-between items-center text-slate-500 mb-0.5">
                          <span className="font-bold text-slate-800">{h.action}</span>
                          <span className="font-mono tabular-nums text-[10px]">
                            {new Date(h.timestamp).toLocaleString('id-ID')}
                          </span>
                        </div>
                        <p className="text-slate-600">{h.notes}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">Oleh: {h.userName}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-slate-400 text-xs italic">Belum ada riwayat tercatat.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add New Job Modal (SPV / Admin) */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 className="text-sm font-bold text-slate-900">Buat & Tugaskan Pekerjaan Baru</h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Pilih Klien</label>
                <select
                  value={newJobData.clientId}
                  onChange={(e) => {
                    handleClientOrDivisionChange(e.target.value, (newJobData.division as any) || 'Accounting');
                  }}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-medium"
                >
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.id}) - PIC: {c.picAssignmentStatus}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Ditugaskan ke divisi</label>
                <select
                  value={newJobData.division}
                  onChange={(e) => handleClientOrDivisionChange(
                    newJobData.clientId || clients[0]?.id || '',
                    e.target.value as JobDivisionSelection
                  )}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-medium"
                >
                  {selectableJobDivisions.includes('Accounting') && <option value="Accounting">Accounting saja</option>}
                  {selectableJobDivisions.includes('Tax') && <option value="Tax">Tax saja</option>}
                  {selectableJobDivisions.includes('Both') && <option value="Both">Accounting dan Tax</option>}
                </select>
              </div>

              <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-amber-900 text-[11px]">
                <p className="font-semibold mb-2">Pilih PIC dari pengguna aktif</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {activeJobDivisions.map((division) => {
                    const requiredRole = division === 'Accounting' ? 'Staff Accounting' : 'Staff Tax';
                    const assignment = newJobData.picAssignments?.[division];
                    const spvName = division === 'Accounting'
                      ? selectedClientForJob?.accountingSpvName
                      : selectedClientForJob?.taxSpvName;

                    return (
                      <div key={division}>
                        <label className="block text-slate-700 font-semibold mb-1">PIC {division}</label>
                        <select
                          value={assignment?.picId || ''}
                          onChange={(e) => {
                            const user = users.find((candidate) => candidate.id === e.target.value);
                            setNewJobData((previous) => ({
                              ...previous,
                              picAssignments: {
                                ...previous.picAssignments,
                                [division]: { picId: user?.id || '', picName: user?.name || '' },
                              },
                            }));
                          }}
                          className="w-full px-3 py-2 bg-white border border-amber-200 rounded-lg text-slate-900"
                        >
                          <option value="">Pilih pengguna</option>
                          {users.filter((user) => user.active && user.role === requiredRole).map((user) => (
                            <option key={user.id} value={user.id}>{user.name}</option>
                          ))}
                        </select>
                        <p className="mt-1 text-slate-600">SPV reviewer: {spvName || 'Belum ditentukan'}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Judul Pekerjaan</label>
                <input
                  type="text"
                  placeholder="Contoh: Penyusunan SPT Masa PPh 21 Januari 2026"
                  value={newJobData.title || ''}
                  onChange={(e) => setNewJobData({ ...newJobData, title: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Prioritas</label>
                  <select
                    value={newJobData.priority}
                    onChange={(e) => setNewJobData({ ...newJobData, priority: e.target.value as any })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                  >
                    <option value="Rendah">Rendah</option>
                    <option value="Sedang">Sedang</option>
                    <option value="Tinggi">Tinggi</option>
                    <option value="Mendesak">Mendesak</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Batas Waktu (Deadline)</label>
                  <input
                    type="date"
                    value={newJobData.deadline}
                    onChange={(e) => setNewJobData({ ...newJobData, deadline: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Deskripsi & Ruang Lingkup</label>
                <textarea
                  rows={3}
                  placeholder="Rincian instruksi pengerjaan..."
                  value={newJobData.description || ''}
                  onChange={(e) => setNewJobData({ ...newJobData, description: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                />
              </div>
            </div>

            {/* Save Button (Section 7.A) */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="px-3.5 py-1.5 border border-slate-300 rounded-lg text-slate-700"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleCreateJob}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-semibold disabled:opacity-50 shadow-sm"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? 'Menyimpan ke Database...' : 'Simpan Pekerjaan (Save)'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Konfirmasi Hapus Pekerjaan */}
      {jobToDelete && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-rose-100 flex items-center justify-between bg-rose-50/60">
              <div className="flex items-center gap-2 text-rose-900 font-bold text-sm">
                <AlertOctagon className="w-5 h-5 text-rose-600" />
                <span>Konfirmasi Hapus Pekerjaan</span>
              </div>
              <button
                onClick={() => setJobToDelete(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <p className="font-bold text-slate-900 text-sm">{jobToDelete.title}</p>
                <p className="text-slate-500 font-mono text-[11px]">{jobToDelete.id} · Klien: {jobToDelete.clientName} · Divisi: {jobToDelete.division}</p>
              </div>

              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 text-[11px] flex items-start gap-2">
                <AlertOctagon className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-rose-800">Apakah Anda yakin ingin menghapus pekerjaan ini?</p>
                  <p className="text-slate-700 mt-1">Pekerjaan akan dihapus dari daftar penugasan dan dicatat di audit log server. Tindakan ini tidak dapat dibatalkan.</p>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setJobToDelete(null)}
                disabled={deletingJob}
                className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-100 font-medium"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteJob}
                disabled={deletingJob}
                className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-semibold disabled:opacity-50 shadow-sm"
              >
                <Trash2 className="w-4 h-4" />
                <span>{deletingJob ? 'Menghapus...' : 'Ya, Hapus Pekerjaan'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
