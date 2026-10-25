import { useState, useMemo } from 'react';
import {
  AlertCircle,
  Search,
  Filter,
  Plus,
  Clock,
  CheckCircle2,
  Calendar,
  User,
  History,
  X,
  Edit,
  Save,
  MessageSquare,
  ChevronRight,
  ShieldAlert,
  RefreshCw,
  Shield,
  Trash2,
  Download,
  AlertOctagon,
} from 'lucide-react';
import { api, type Case, type Client, type CurrentUser, type CaseStatus, type UserAccount } from '../lib/api';
import { useToast } from './Toast';
import { ExportDropdown } from './ExportDropdown';
import type { ColumnDef } from '../lib/exportUtils';

interface CasesViewProps {
  cases: Case[];
  clients: Client[];
  users: UserAccount[];
  currentUser: CurrentUser;
  onRefresh: () => void;
}

export function CasesView({ cases, clients, users, currentUser, onRefresh }: CasesViewProps) {
  const { success, error } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [divisionFilter, setDivisionFilter] = useState<'All' | 'Accounting' | 'Tax'>('All');
  const [clientFilter, setClientFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [priorityFilter, setPriorityFilter] = useState<string>('All');

  const [selectedCase, setSelectedCase] = useState<Case | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Delete Case State
  const [caseToDelete, setCaseToDelete] = useState<Case | null>(null);
  const [deletingCase, setDeletingCase] = useState(false);

  // Adding timeline activity entry into case
  const [newTimelineActivity, setNewTimelineActivity] = useState('');
  const [newTimelineNotes, setNewTimelineNotes] = useState('');
  const [newTimelineNextStep, setNewTimelineNextStep] = useState('');

  // Editing existing case
  const [editStatus, setEditStatus] = useState<CaseStatus>('Open');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [nextFollowUpDate, setNextFollowUpDate] = useState('');

  // New Case Data
  const [newCaseData, setNewCaseData] = useState<Partial<Case>>({
    division: currentUser.role.includes('Tax') ? 'Tax' : 'Accounting',
    priority: 'Sedang',
    status: 'Open',
    nextFollowUpDate: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
  });

  const isReadOnly = currentUser.role === 'Owner' || currentUser.role === 'Manager';
  const currentDivision = currentUser.role.includes('Accounting') ? 'Accounting' : 'Tax';
  const selectedCaseClient = clients.find((client) => client.id === newCaseData.clientId);
  const caseSpvIsPic = newCaseData.division === 'Accounting'
    ? selectedCaseClient?.accountingSpvIsPic
    : selectedCaseClient?.taxSpvIsPic;
  const casePicRole = caseSpvIsPic
    ? `SPV ${newCaseData.division}`
    : `Staff ${newCaseData.division}`;
  const canEditCase = (item: Case) =>
    !isReadOnly &&
    (currentUser.role === 'Admin' ||
      (item.division === currentDivision &&
        (!currentUser.role.startsWith('Staff') ||
          item.picId === currentUser.id ||
          item.followUpPicId === currentUser.id)));
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<string>(
    new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date())
  );

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
      setLastRefreshed(
        new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date())
      );
      success('Data Disinkronkan', 'Daftar kasus berhasil disinkronkan dengan database server.');
    } catch (err: any) {
      error('Gagal Menyinkronkan', err.message);
    } finally {
      setRefreshing(false);
    }
  };

  const today = new Date().toISOString().split('T')[0];

  const filteredCases = useMemo(() => {
    return cases.filter((c) => {
      if (divisionFilter !== 'All' && c.division !== divisionFilter) return false;
      if (clientFilter !== 'All' && c.clientId !== clientFilter) return false;
      if (statusFilter !== 'All' && c.status !== statusFilter) return false;
      if (priorityFilter !== 'All' && c.priority !== priorityFilter) return false;

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const mTitle = c.title.toLowerCase().includes(q);
        const mClient = c.clientName.toLowerCase().includes(q);
        const mId = c.id.toLowerCase().includes(q);
        const mDesc = c.description.toLowerCase().includes(q);
        if (!mTitle && !mClient && !mId && !mDesc) return false;
      }
      return true;
    });
  }, [cases, divisionFilter, clientFilter, statusFilter, priorityFilter, searchTerm]);

  const handleOpenDetail = (item: Case) => {
    setSelectedCase(item);
    setEditStatus(item.status);
    setResolutionNotes(item.resolutionNotes || '');
    setNextFollowUpDate(item.nextFollowUpDate || '');
    setNewTimelineActivity('');
    setNewTimelineNotes('');
    setNewTimelineNextStep('');
  };

  const handleCreateCase = async () => {
    if (!newCaseData.title?.trim() || !newCaseData.clientId || !newCaseData.description?.trim() || !newCaseData.picId) {
      error('Validasi Gagal', 'Klien, PIC penanggung jawab, judul masalah, dan uraian kasus wajib diisi.');
      return;
    }

    setSaving(true);
    try {
      const selectedClient = clients.find((c) => c.id === newCaseData.clientId);
      await api.createCase({
        ...newCaseData,
        clientName: selectedClient?.name || 'Klien',
      });
      success('Kasus Dicatat', 'Kasus baru berhasil dicatat di Case Register.');
      setIsAddModalOpen(false);
      onRefresh();
    } catch (err: any) {
      error('Gagal Mencatat Kasus', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddTimelineEntry = async () => {
    if (!selectedCase || !newTimelineActivity.trim()) {
      error('Validasi Gagal', 'Uraian aktivitas tindakan kasus wajib diisi.');
      return;
    }

    setSaving(true);
    try {
      await api.addCaseTimeline(selectedCase.id, {
        activity: newTimelineActivity.trim(),
        notes: newTimelineNotes.trim(),
        nextStep: newTimelineNextStep.trim(),
        date: new Date().toISOString().split('T')[0],
      });
      success('Aktivitas Ditambahkan', 'Catatan penanganan kasus berhasil disimpan.');

      // Update local view
      const updated = await api.getCases({ id: selectedCase.id });
      const current = updated.find((c) => c.id === selectedCase.id);
      if (current) setSelectedCase(current);

      setNewTimelineActivity('');
      setNewTimelineNotes('');
      setNewTimelineNextStep('');
      onRefresh();
    } catch (err: any) {
      error('Gagal Menambahkan', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateCaseStatus = async () => {
    if (!selectedCase) return;

    setSaving(true);
    try {
      await api.updateCase(selectedCase.id, {
        status: editStatus,
        resolutionNotes,
        nextFollowUpDate,
      });
      success('Kasus Diperbarui', 'Status dan rencana tindak lanjut berhasil disimpan.');
      setSelectedCase(null);
      onRefresh();
    } catch (err: any) {
      error('Gagal Memperbarui', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDeleteCase = async () => {
    if (!caseToDelete) return;
    setDeletingCase(true);
    try {
      await api.deleteCase(caseToDelete.id);
      success('Kasus Dihapus', `Kasus '${caseToDelete.title}' (${caseToDelete.id}) berhasil dihapus.`);
      setCaseToDelete(null);
      if (selectedCase?.id === caseToDelete.id) {
        setSelectedCase(null);
      }
      onRefresh();
    } catch (err: any) {
      error('Gagal Menghapus Kasus', err.message);
    } finally {
      setDeletingCase(false);
    }
  };

  const caseExportColumns: ColumnDef<Case>[] = useMemo(
    () => [
      { header: 'No', key: 'no', width: 6, align: 'center', render: (c) => filteredCases.indexOf(c) + 1 },
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
    [filteredCases]
  );

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pb-2">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Cari ID case, judul masalah, klien, atau uraian..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg placeholder-slate-400 focus:outline-none focus:border-amber-500"
          />
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          {lastRefreshed && (
            <span className="text-[11px] text-slate-400 font-mono hidden md:inline-block">
              Diperbarui: {lastRefreshed} WIB
            </span>
          )}

          <button
            onClick={handleManualRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-amber-600' : ''}`} />
            <span>{refreshing ? 'Memuat...' : 'Segarkan'}</span>
          </button>

          <ExportDropdown
            filename="Register_Kasus_Case_TMM_BMA"
            sheetName="Case Register"
            title="REGISTER KASUS & PERMASALAHAN KLIEN (CASE REGISTER)"
            subtitle={`Filter: ${divisionFilter} | Klien: ${clientFilter === 'All' ? 'Semua Klien' : clients.find((client) => client.id === clientFilter)?.name || 'Klien'} | Status: ${statusFilter} | Total: ${filteredCases.length} kasus`}
            columns={caseExportColumns}
            data={filteredCases}
            label="Ekspor & Copas"
          />

          {isReadOnly ? (
            <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 border border-slate-200 text-slate-600 text-xs font-semibold rounded-lg">
              <Shield className="w-3.5 h-3.5 text-slate-500" />
              <span>Mode Read-Only ({currentUser.role})</span>
            </div>
          ) : (
            <button
              onClick={() => {
                const division = currentUser.role.includes('Tax') ? 'Tax' : 'Accounting';
                const initialClient = clients[0];
                const spvIsPic = division === 'Accounting'
                  ? initialClient?.accountingSpvIsPic
                  : initialClient?.taxSpvIsPic;
                const defaultPicId = spvIsPic
                  ? division === 'Accounting' ? initialClient?.accountingSpvId : initialClient?.taxSpvId
                  : division === 'Accounting' ? initialClient?.accountingStaffPicId : initialClient?.taxStaffPicId;
                const defaultPicName = spvIsPic
                  ? division === 'Accounting' ? initialClient?.accountingSpvName : initialClient?.taxSpvName
                  : division === 'Accounting' ? initialClient?.accountingStaffPicName : initialClient?.taxStaffPicName;
                const isStaffInDivision = currentUser.role === `Staff ${division}`;
                setNewCaseData({
                  division,
                  priority: 'Sedang',
                  status: 'Open',
                  clientId: initialClient?.id || '',
                  picId: isStaffInDivision && !spvIsPic ? currentUser.id : defaultPicId || '',
                  picName: isStaffInDivision && !spvIsPic ? currentUser.name : defaultPicName || '',
                  nextFollowUpDate: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
                });
                setIsAddModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Buka Kasus Baru (Case Register)</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter Row */}
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
          <option value="Open">Open</option>
          <option value="In Progress">In Progress</option>
          <option value="Waiting for Client">Waiting for Client</option>
          <option value="Waiting Internal">Waiting Internal</option>
          <option value="Resolved">Resolved</option>
          <option value="Closed">Closed</option>
        </select>

        {/* Priority Dropdown */}
        <select
          value={clientFilter}
          onChange={(event) => setClientFilter(event.target.value)}
          aria-label="Filter klien kasus"
          className="min-h-10 max-w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-medium text-slate-700 focus:outline-none"
        >
          <option value="All">Semua Klien</option>
          {clients.slice().sort((a, b) => a.name.localeCompare(b.name)).map((client) => (
            <option key={client.id} value={client.id}>{client.name}</option>
          ))}
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-slate-700 font-medium focus:outline-none"
        >
          <option value="All">Semua Prioritas</option>
          <option value="Tinggi">Tinggi (High Risk)</option>
          <option value="Sedang">Sedang</option>
          <option value="Rendah">Rendah</option>
        </select>

        <span className="ml-auto text-slate-400 font-mono tabular-nums text-[11px]">
          {filteredCases.length} Kasus Terdata
        </span>
      </div>

      {/* Cases List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredCases.length === 0 ? (
          <div className="col-span-2 py-12 text-center text-slate-400 bg-white border border-slate-200 rounded-xl">
            Tidak ada kasus yang sesuai dengan kriteria filter.
          </div>
        ) : (
          filteredCases.map((item) => {
            const isFollowUpOverdue =
              item.status !== 'Resolved' && item.status !== 'Closed' && item.nextFollowUpDate < today;

            return (
              <div
                key={item.id}
                onClick={() => handleOpenDetail(item)}
                className="p-5 bg-white border border-slate-200/90 rounded-xl hover:border-slate-300 transition-all cursor-pointer shadow-sm flex flex-col justify-between group"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono font-bold text-slate-500">{item.id}</span>
                      <span className="text-slate-300">·</span>
                      <span className="text-[11px] font-semibold text-amber-700">{item.division}</span>
                    </div>
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                        item.priority === 'Tinggi'
                          ? 'bg-rose-100 text-rose-800'
                          : item.priority === 'Sedang'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      Prioritas: {item.priority}
                    </span>
                  </div>

                  <h3 className="text-sm font-bold text-slate-900 group-hover:text-amber-700 transition-colors line-clamp-2">
                    {item.title}
                  </h3>
                  <p className="text-xs text-slate-500 font-medium mt-1">{item.clientName}</p>

                  <p className="text-xs text-slate-600 mt-2 line-clamp-2 leading-relaxed">
                    {item.description}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-1.5 text-slate-500">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>Follow-up:</span>
                    <span
                      className={`font-mono tabular-nums ${
                        isFollowUpOverdue ? 'text-rose-600 font-bold' : 'text-slate-700 font-medium'
                      }`}
                    >
                      {item.nextFollowUpDate}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        item.status === 'Resolved' || item.status === 'Closed'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {item.status}
                    </span>

                    {(currentUser.role === 'Admin' ||
                      (currentUser.role === 'SPV Accounting' && item.division === 'Accounting') ||
                      (currentUser.role === 'SPV Tax' && item.division === 'Tax')) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setCaseToDelete(item);
                        }}
                        className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                        title="Hapus Kasus"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Case Detail / Multi-Activity Drawer Modal */}
      {selectedCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-6">
          <div role="dialog" aria-modal="true" aria-labelledby="case-detail-title" className="flex h-[92dvh] max-h-[900px] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-slate-500">{selectedCase.id}</span>
                  <span className="text-slate-300">·</span>
                  <span className="text-xs font-semibold text-amber-700">{selectedCase.division}</span>
                </div>
                <h3 id="case-detail-title" className="text-base font-bold text-slate-900 mt-0.5 line-clamp-1">
                  {selectedCase.title}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                {(currentUser.role === 'Admin' ||
                  (currentUser.role === 'SPV Accounting' && selectedCase.division === 'Accounting') ||
                  (currentUser.role === 'SPV Tax' && selectedCase.division === 'Tax')) && (
                  <button
                    onClick={() => setCaseToDelete(selectedCase)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 rounded-md text-xs font-medium transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                    <span>Hapus Kasus</span>
                  </button>
                )}
                <button
                  onClick={() => setSelectedCase(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs">
              {/* Info grid */}
              <div className="grid grid-cols-2 gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <div>
                  <span className="text-slate-500 font-medium">Klien:</span>
                  <p className="font-bold text-slate-900 mt-0.5">{selectedCase.clientName}</p>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">PIC Penanggung Jawab:</span>
                  <p className="font-semibold text-slate-800 mt-0.5">{selectedCase.picName}</p>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">Status Kasus:</span>
                  <p className="font-bold text-amber-700 mt-0.5">{selectedCase.status}</p>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">Jadwal Follow-up:</span>
                  <p className="font-mono tabular-nums text-slate-800 mt-0.5">
                    {selectedCase.nextFollowUpDate}
                  </p>
                </div>
              </div>

              {/* Description & Root Cause */}
              <div>
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-1">
                  Uraian Masalah & Analisis Penyebab
                </h4>
                <div className="p-3 bg-white border border-slate-200 rounded-lg text-slate-700 space-y-2">
                  <p className="leading-relaxed">{selectedCase.description}</p>
                  {selectedCase.rootCause && (
                    <div className="pt-2 border-t border-slate-100">
                      <span className="font-bold text-slate-800">Akar Masalah (Root Cause): </span>
                      <span>{selectedCase.rootCause}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Multi-Date Action Log (Section F: Satu case punya banyak catatan aktivitas bertanggal) */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                    <History className="w-3.5 h-3.5 text-amber-600" />
                    <span>Kronologi Tindakan Bertanggal (Case Activities):</span>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    {selectedCase.timeline?.length || 0} Catatan Tindakan
                  </span>
                </div>

                <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                  {selectedCase.timeline && selectedCase.timeline.length > 0 ? (
                    selectedCase.timeline.map((act) => (
                      <div
                        key={act.id}
                        className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                      >
                        <div className="flex justify-between items-center text-slate-500 mb-1">
                          <span className="font-semibold text-slate-800">{act.userName}</span>
                          <span className="font-mono tabular-nums text-[11px]">{act.date}</span>
                        </div>
                        <p className="text-slate-700 font-medium">{act.activity}</p>
                        {act.notes && <p className="text-slate-500 mt-1 text-[11px]">{act.notes}</p>}
                        {act.nextStep && (
                          <div className="mt-1.5 pt-1.5 border-t border-slate-200/60 text-[11px] text-amber-800 font-medium">
                            Tindak lanjut: {act.nextStep}
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="text-slate-400 italic">Belum ada kronologi tindakan.</p>
                  )}
                </div>

                {/* Form to add a new dated activity log inside this case */}
                {!canEditCase(selectedCase) ? (
                  <div className="p-3 bg-slate-100 border border-slate-200 rounded-lg text-slate-500 text-xs italic">
                    Mode Read-Only: Anda dapat melihat semua divisi, tetapi hanya PIC divisi terkait yang dapat mengubah kasus.
                  </div>
                ) : (
                  <div className="mt-3 p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                    <span className="text-xs font-bold text-slate-800 block">
                      Tambah Catatan Tindakan Baru pada Kasus Ini:
                    </span>
                    <input
                      type="text"
                      placeholder="Uraian tindakan yang baru dilakukan..."
                      value={newTimelineActivity}
                      onChange={(e) => setNewTimelineActivity(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded text-xs"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="Catatan tambahan..."
                        value={newTimelineNotes}
                        onChange={(e) => setNewTimelineNotes(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded text-xs"
                      />
                      <input
                        type="text"
                        placeholder="Rencana langkah berikutnya..."
                        value={newTimelineNextStep}
                        onChange={(e) => setNewTimelineNextStep(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded text-xs"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleAddTimelineEntry}
                      disabled={saving || !newTimelineActivity.trim()}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded font-medium text-xs disabled:opacity-50"
                    >
                      + Simpan Catatan Tindakan ke Kasus
                    </button>
                  </div>
                )}
              </div>

              {/* Status & Resolution Form */}
              {canEditCase(selectedCase) && (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Perbarui Status Kasus & Penyelesaian
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-600 font-medium mb-1">Status Kasus</label>
                      <select
                        value={editStatus}
                        onChange={(e) => setEditStatus(e.target.value as any)}
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded text-slate-900 font-semibold"
                      >
                        <option value="Open">Open</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Waiting for Client">Waiting for Client</option>
                        <option value="Waiting Internal">Waiting Internal</option>
                        <option value="Resolved">Resolved (Terselesaikan)</option>
                        <option value="Closed">Closed</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-slate-600 font-medium mb-1">Tanggal Follow-up Berikutnya</label>
                      <input
                        type="date"
                        value={nextFollowUpDate}
                        onChange={(e) => setNextFollowUpDate(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded text-slate-900 font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-600 font-medium mb-1">Catatan Penyelesaian</label>
                    <textarea
                      rows={2}
                      value={resolutionNotes}
                      onChange={(e) => setResolutionNotes(e.target.value)}
                      placeholder="Keterangan kesimpulan dan penutupan kasus jika telah selesai..."
                      className="w-full p-2 bg-white border border-slate-200 rounded text-xs"
                    />
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleUpdateCaseStatus}
                      disabled={saving}
                      className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-semibold text-xs"
                    >
                      Simpan Perubahan Kasus
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Case Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 className="text-sm font-bold text-slate-900">Buka Kasus Perpajakan / Akuntansi Baru</h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Pilih Klien</label>
                <select
                  value={newCaseData.clientId}
                  onChange={(e) => {
                    const cl = clients.find((c) => c.id === e.target.value);
                    const spvIsPic = newCaseData.division === 'Accounting'
                      ? cl?.accountingSpvIsPic
                      : cl?.taxSpvIsPic;
                    const assignedPicId = spvIsPic
                      ? newCaseData.division === 'Accounting' ? cl?.accountingSpvId : cl?.taxSpvId
                      : newCaseData.division === 'Accounting' ? cl?.accountingStaffPicId : cl?.taxStaffPicId;
                    const assignedPicName = spvIsPic
                      ? newCaseData.division === 'Accounting' ? cl?.accountingSpvName : cl?.taxSpvName
                      : newCaseData.division === 'Accounting' ? cl?.accountingStaffPicName : cl?.taxStaffPicName;
                    setNewCaseData({
                      ...newCaseData,
                      clientId: e.target.value,
                      clientName: cl?.name || '',
                      picId: assignedPicId || '',
                      picName: assignedPicName || '',
                    });
                  }}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-medium"
                >
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Divisi Terkait</label>
                <select
                  value={newCaseData.division}
                  onChange={(e) => {
                    const division = e.target.value as 'Accounting' | 'Tax';
                    const client = clients.find((candidate) => candidate.id === newCaseData.clientId);
                    const spvIsPic = division === 'Accounting' ? client?.accountingSpvIsPic : client?.taxSpvIsPic;
                    const picId = spvIsPic
                      ? division === 'Accounting' ? client?.accountingSpvId : client?.taxSpvId
                      : division === 'Accounting' ? client?.accountingStaffPicId : client?.taxStaffPicId;
                    const picName = spvIsPic
                      ? division === 'Accounting' ? client?.accountingSpvName : client?.taxSpvName
                      : division === 'Accounting' ? client?.accountingStaffPicName : client?.taxStaffPicName;
                    setNewCaseData({ ...newCaseData, division, picId: picId || '', picName: picName || '' });
                  }}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-medium"
                >
                  <option value="Accounting">Accounting</option>
                  <option value="Tax">Tax</option>
                </select>
              </div>

              <div>
                <label htmlFor="case-pic" className="block text-slate-700 font-semibold mb-1">PIC Penanggung Jawab{caseSpvIsPic ? ' (SPV)' : ''}</label>
                <select
                  id="case-pic"
                  required
                  value={newCaseData.picId || ''}
                  onChange={(e) => {
                    const selectedPic = users.find((user) => user.id === e.target.value);
                    setNewCaseData({ ...newCaseData, picId: selectedPic?.id || '', picName: selectedPic?.name || '' });
                  }}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-medium text-slate-900"
                >
                  <option value="">Pilih PIC aktif</option>
                  {users.filter((user) =>
                    user.active &&
                    user.role === casePicRole &&
                    (!caseSpvIsPic || user.id === (newCaseData.division === 'Accounting' ? selectedCaseClient?.accountingSpvId : selectedCaseClient?.taxSpvId))
                  ).map((user) => (
                    <option key={user.id} value={user.id}>{user.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-500">PIC ini akan melihat kasus pada dashboard dan dapat memperbarui tindak lanjutnya.</p>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Judul Masalah</label>
                <input
                  type="text"
                  placeholder="Contoh: Faktur Pajak Masukan Supplier Terindikasi Suspensi"
                  value={newCaseData.title || ''}
                  onChange={(e) => setNewCaseData({ ...newCaseData, title: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Prioritas / Tingkat Risiko</label>
                  <select
                    value={newCaseData.priority}
                    onChange={(e) => setNewCaseData({ ...newCaseData, priority: e.target.value as any })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                  >
                    <option value="Tinggi">Tinggi (High Risk)</option>
                    <option value="Sedang">Sedang</option>
                    <option value="Rendah">Rendah</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Tanggal Follow-up Pertama</label>
                  <input
                    type="date"
                    value={newCaseData.nextFollowUpDate}
                    onChange={(e) => setNewCaseData({ ...newCaseData, nextFollowUpDate: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Uraian Kasus & Kronologi Singkat</label>
                <textarea
                  rows={3}
                  placeholder="Jelaskan detail temuan masalah..."
                  value={newCaseData.description || ''}
                  onChange={(e) => setNewCaseData({ ...newCaseData, description: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                />
              </div>
            </div>

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
                onClick={handleCreateCase}
                disabled={saving}
                className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-semibold"
              >
                {saving ? 'Menyimpan...' : 'Buka Kasus'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Konfirmasi Hapus Kasus */}
      {caseToDelete && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-rose-100 flex items-center justify-between bg-rose-50/60">
              <div className="flex items-center gap-2 text-rose-900 font-bold text-sm">
                <AlertOctagon className="w-5 h-5 text-rose-600" />
                <span>Konfirmasi Hapus Kasus</span>
              </div>
              <button
                onClick={() => setCaseToDelete(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <p className="font-bold text-slate-900 text-sm">{caseToDelete.title}</p>
                <p className="text-slate-500 font-mono text-[11px]">{caseToDelete.id} · Klien: {caseToDelete.clientName} · Divisi: {caseToDelete.division}</p>
              </div>

              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 text-[11px] flex items-start gap-2">
                <AlertOctagon className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-rose-800">Apakah Anda yakin ingin menghapus kasus ini?</p>
                  <p className="text-slate-700 mt-1">Seluruh riwayat temuan, timeline penanganan, dan catatan tindak lanjut pada kasus ini akan dihapus dari server.</p>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setCaseToDelete(null)}
                disabled={deletingCase}
                className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-100 font-medium"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteCase}
                disabled={deletingCase}
                className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-semibold disabled:opacity-50 shadow-sm"
              >
                <Trash2 className="w-4 h-4" />
                <span>{deletingCase ? 'Menghapus...' : 'Ya, Hapus Kasus'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
