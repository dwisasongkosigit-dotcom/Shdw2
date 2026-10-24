import { useState, useMemo } from 'react';
import {
  Search,
  Filter,
  Plus,
  RefreshCw,
  Building2,
  Users,
  CheckCircle2,
  AlertTriangle,
  History,
  X,
  Edit,
  Save,
  Check,
  Trash2,
  UserX,
  Download,
  AlertOctagon,
  ChevronRight,
} from 'lucide-react';
import { api, type Case, type Client, type CurrentUser, type UserAccount } from '../lib/api';
import { ClientSegmentationChart } from './ClientSegmentationChart';
import { ClientPicWorkloadChart, type ClientPicWorkloadItem } from './ClientPicWorkloadChart';
import { useToast } from './Toast';
import { ExportDropdown } from './ExportDropdown';
import type { ColumnDef } from '../lib/exportUtils';

type ClientPicDivision = 'Accounting' | 'Tax';

function getPrimaryPic(client: Client, division: ClientPicDivision) {
  const spvIsPic = division === 'Accounting' ? client.accountingSpvIsPic : client.taxSpvIsPic;
  const id = division === 'Accounting'
    ? spvIsPic ? client.accountingSpvId : client.accountingStaffPicId
    : spvIsPic ? client.taxSpvId : client.taxStaffPicId;
  const name = division === 'Accounting'
    ? spvIsPic ? client.accountingSpvName : client.accountingStaffPicName
    : spvIsPic ? client.taxSpvName : client.taxStaffPicName;
  const role = spvIsPic
    ? `SPV ${division}`
    : `Staff ${division}`;

  return { id: id || '', name: name || '', role };
}

function getPicFilterKey(pic: { id: string; name: string }) {
  if (pic.id) return `user:${pic.id}`;
  const normalizedName = pic.name.trim().toLocaleLowerCase('id-ID');
  return normalizedName ? `name:${normalizedName}` : '';
}

function formatCapitalInput(value?: number | null) {
  if (value === undefined || value === null) return '';
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(value);
}

function parseCapitalInput(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits ? Number(digits) : null;
}

interface ClientsViewProps {
  clients: Client[];
  cases: Case[];
  users: UserAccount[];
  currentUser: CurrentUser;
  onRefresh: () => void;
  isRefreshing?: boolean;
  lastUpdated?: string;
}

export function ClientsView({
  clients,
  cases,
  users,
  currentUser,
  onRefresh,
  isRefreshing = false,
  lastUpdated,
}: ClientsViewProps) {
  const { success, error } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('All');
  const [filterPkp, setFilterPkp] = useState<string>('All');
  const [filterPph, setFilterPph] = useState<string>('All');
  const [filterRisk, setFilterRisk] = useState<string>('All');
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [filterPicStatus, setFilterPicStatus] = useState<string>('All');
  const [filterPicOwner, setFilterPicOwner] = useState<string>('All');
  const [filterInvestment, setFilterInvestment] = useState<string>('All');
  const [filterDataType, setFilterDataType] = useState<string>('All');
  const [chartDataType, setChartDataType] = useState<'Real' | 'Simulasi' | 'Semua'>('Real');
  // Modal states
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [picChangeNote, setPicChangeNote] = useState('');

  // Form state
  const [formData, setFormData] = useState<Partial<Client>>({});

  // Terminate & Delete states
  const [clientToTerminate, setClientToTerminate] = useState<Client | null>(null);
  const [terminationReason, setTerminationReason] = useState('');
  const [terminationDate, setTerminationDate] = useState(new Date().toISOString().split('T')[0]);
  const [terminating, setTerminating] = useState(false);

  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isReadOnly = currentUser.role === 'Owner' || currentUser.role === 'Manager';
  const canEdit = !isReadOnly && (
    currentUser.role === 'Admin' ||
    currentUser.role === 'SPV Accounting' ||
    currentUser.role === 'SPV Tax'
  );
  const canTerminate = !isReadOnly && (
    currentUser.role === 'Admin' ||
    currentUser.role === 'SPV Accounting' ||
    currentUser.role === 'SPV Tax'
  );
  const canDelete = currentUser.role === 'Admin';
  const isAdmin = currentUser.role === 'Admin';
  const canEditClient = (client: Client) => isAdmin ||
    (currentUser.role === 'SPV Accounting' && client.accountingSpvId === currentUser.id) ||
    (currentUser.role === 'SPV Tax' && client.taxSpvId === currentUser.id);
  const selectedClientCases = useMemo(() => selectedClient
    ? cases.filter((item) => item.clientId === selectedClient.id).slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    : [], [cases, selectedClient?.id]);
  const accountingPicOwnerName = formData.accountingSpvIsPic ? formData.accountingSpvName : formData.accountingStaffPicName;
  const taxPicOwnerName = formData.taxSpvIsPic ? formData.taxSpvName : formData.taxStaffPicName;
  const isPicAssignmentComplete = [
    accountingPicOwnerName,
    formData.accountingSpvName,
    taxPicOwnerName,
    formData.taxSpvName,
  ].every((name) => Boolean(name?.trim() && name !== '-'));
  const picFilterOptions = useMemo(() => {
    const options = new Map<string, { key: string; name: string; roles: Set<string> }>();
    clients.forEach((client) => {
      (['Accounting', 'Tax'] as const).forEach((division) => {
        const pic = getPrimaryPic(client, division);
        const key = getPicFilterKey(pic);
        if (!key || !pic.name.trim() || pic.name === '-') return;
        const existing = options.get(key);
        if (existing) {
          existing.roles.add(pic.role);
        } else {
          options.set(key, { key, name: pic.name, roles: new Set([pic.role]) });
        }
      });
    });
    return [...options.values()]
      .map((option) => ({ ...option, roleLabel: [...option.roles].join(' / ') }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clients]);
  const picWorkloadData = useMemo<ClientPicWorkloadItem[]>(() => {
    const workload = new Map<string, {
      id: string;
      name: string;
      roles: Set<string>;
      clientIds: Set<string>;
      accountingClientIds: Set<string>;
      taxClientIds: Set<string>;
    }>();
    const supportedRoles = new Set(['Staff Accounting', 'Staff Tax', 'SPV Accounting', 'SPV Tax']);

    users.filter((user) => user.active && supportedRoles.has(user.role)).forEach((user) => {
      const key = `user:${user.id}`;
      workload.set(key, {
        id: key,
        name: user.name,
        roles: new Set([user.role]),
        clientIds: new Set(),
        accountingClientIds: new Set(),
        taxClientIds: new Set(),
      });
    });

    clients
      .filter((client) => client.status === 'Aktif' && (chartDataType === 'Semua' || client.dataType === chartDataType))
      .forEach((client) => {
        (['Accounting', 'Tax'] as const).forEach((division) => {
          const pic = getPrimaryPic(client, division);
          const key = getPicFilterKey(pic);
          if (!key || !pic.name.trim() || pic.name === '-') return;
          let item = workload.get(key);
          if (!item) {
            item = {
              id: key,
              name: pic.name,
              roles: new Set(),
              clientIds: new Set(),
              accountingClientIds: new Set(),
              taxClientIds: new Set(),
            };
            workload.set(key, item);
          }
          item.roles.add(pic.role);
          item.clientIds.add(client.id);
          (division === 'Accounting' ? item.accountingClientIds : item.taxClientIds).add(client.id);
        });
      });

    return [...workload.values()].map((item) => ({
      id: item.id,
      name: item.name,
      role: [...item.roles].join(' / '),
      totalClients: item.clientIds.size,
      accountingClients: item.accountingClientIds.size,
      taxClients: item.taxClientIds.size,
    }));
  }, [clients, users, chartDataType]);

  // Filter clients
  const filteredClients = useMemo(() => {
    return clients.filter((c) => {
      if (filterType !== 'All' && c.type !== filterType) return false;
      if (filterPkp !== 'All' && c.pkpStatus !== filterPkp) return false;
      if (filterPph !== 'All' && c.pphRegime !== filterPph) return false;
      if (filterRisk !== 'All') {
        if (filterRisk === 'High' && c.taxRisk !== 'High' && c.accountingRisk !== 'High') return false;
        if (filterRisk === 'Medium' && c.taxRisk !== 'Medium' && c.accountingRisk !== 'Medium') return false;
        if (filterRisk === 'Low' && c.taxRisk !== 'Low' && c.accountingRisk !== 'Low') return false;
      }
      if (filterStatus !== 'All' && c.status !== filterStatus) return false;
      if (filterPicStatus !== 'All' && c.picAssignmentStatus !== filterPicStatus) return false;
      if (filterPicOwner !== 'All') {
        const isAssignedToSelectedPic = (['Accounting', 'Tax'] as const).some((division) =>
          getPicFilterKey(getPrimaryPic(c, division)) === filterPicOwner
        );
        if (!isAssignedToSelectedPic) return false;
      }
      if (filterInvestment !== 'All' && c.investmentCategory !== filterInvestment) return false;
      if (filterDataType !== 'All' && c.dataType !== filterDataType) return false;

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchesName = c.name.toLowerCase().includes(q);
        const matchesId = c.id.toLowerCase().includes(q);
        const matchesAccStaff = c.accountingStaffPicName && c.accountingStaffPicName.toLowerCase().includes(q);
        const matchesTaxStaff = c.taxStaffPicName && c.taxStaffPicName.toLowerCase().includes(q);
        const matchesAccSpv = c.accountingSpvName && c.accountingSpvName.toLowerCase().includes(q);
        const matchesTaxSpv = c.taxSpvName && c.taxSpvName.toLowerCase().includes(q);
        const matchesNotes = c.notes && c.notes.toLowerCase().includes(q);
        if (!matchesName && !matchesId && !matchesAccStaff && !matchesTaxStaff && !matchesAccSpv && !matchesTaxSpv && !matchesNotes) {
          return false;
        }
      }

      return true;
    });
  }, [clients, searchTerm, filterType, filterPkp, filterPph, filterRisk, filterStatus, filterPicStatus, filterPicOwner, filterInvestment, filterDataType]);

  const handleOpenDetail = (client: Client, edit = false) => {
    setSelectedClient(client);
    setFormData({ ...client });
    setPicChangeNote('');
    setIsEditMode(!isReadOnly && edit);
  };

  const getActiveUserForRole = (role: UserAccount['role']) =>
    users.find((user) => user.active && user.role === role);

  const handleOpenAddModal = () => {
    const accountingStaff = getActiveUserForRole('Staff Accounting');
    const taxStaff = getActiveUserForRole('Staff Tax');
    const accountingSpv = getActiveUserForRole('SPV Accounting');
    const taxSpv = getActiveUserForRole('SPV Tax');

    setFormData({
      type: 'Badan',
      entityType: 'PT',
      investmentCategory: 'Belum Ditentukan',
      dataType: 'Real',
      status: 'Aktif',
      pkpStatus: 'PKP',
      pphRegime: 'PPh Badan Tarif Umum',
      taxYearEffective: new Date().getFullYear(),
      accountingRisk: 'Not Assessed',
      taxRisk: 'Not Assessed',
      accountingStaffPicName: accountingStaff?.name || '',
      accountingStaffPicId: accountingStaff?.id || '',
      taxStaffPicName: taxStaff?.name || '',
      taxStaffPicId: taxStaff?.id || '',
      accountingSpvIsPic: false,
      taxSpvIsPic: false,
      accountingSpvName: accountingSpv?.name || '',
      accountingSpvId: accountingSpv?.id || '',
      taxSpvName: taxSpv?.name || '',
      taxSpvId: taxSpv?.id || '',
    });
    setPicChangeNote('');
    setIsAddModalOpen(true);
  };

  // Section 7.A & 7.B: Save and Update handling
  const handleSaveClient = async () => {
    if (!formData.name?.trim()) {
      error('Validasi Gagal', 'Nama klien wajib diisi.');
      return;
    }

    setSaving(true);
    try {
      if (selectedClient && isEditMode) {
        // Update existing record
        const res = await api.updateClient(selectedClient.id, {
          ...formData,
          expectedVersion: selectedClient.version,
          picChangeNotes: picChangeNote.trim() || undefined,
        });
        success('Berhasil Disimpan', `Perubahan data klien ${formData.name} berhasil disimpan di database.`);
      } else {
        // Create new record
        const res = await api.createClient(formData);
        success('Berhasil Disimpan', `Klien ${formData.name} berhasil ditambahkan dan disimpan di database.`);
      }
      setSelectedClient(null);
      setIsAddModalOpen(false);
      onRefresh();
    } catch (err: any) {
      error('Gagal Menyimpan', err.message || 'Terjadi kesalahan saat menyimpan ke database server. Data lama Anda tetap utuh.');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenTerminate = (client: Client) => {
    setClientToTerminate(client);
    setTerminationDate(new Date().toISOString().split('T')[0]);
    setTerminationReason('Klien memutuskan kontrak kerja sama jasa konsultasi.');
  };

  const handleConfirmTerminate = async () => {
    if (!clientToTerminate) return;
    setTerminating(true);
    try {
      await api.terminateClient(clientToTerminate.id, {
        terminationReason: terminationReason.trim() || 'Klien memutuskan kontrak kerja sama jasa konsultasi.',
        terminationDate,
      });
      success('Status Berhasil Diubah', `Klien '${clientToTerminate.name}' resmi diubah status menjadi Putus Kontrak.`);
      setClientToTerminate(null);
      if (selectedClient?.id === clientToTerminate.id) {
        setSelectedClient(null);
      }
      onRefresh();
    } catch (err: any) {
      error('Gagal Mengubah Status', err.message);
    } finally {
      setTerminating(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!clientToDelete) return;
    setDeleting(true);
    try {
      await api.deleteClient(clientToDelete.id);
      success('Klien Dihapus', `Klien '${clientToDelete.name}' (${clientToDelete.id}) berhasil dihapus permanen.`);
      setClientToDelete(null);
      if (selectedClient?.id === clientToDelete.id) {
        setSelectedClient(null);
      }
      onRefresh();
    } catch (err: any) {
      error('Gagal Menghapus Klien', err.message);
    } finally {
      setDeleting(false);
    }
  };

  const clientExportColumns: ColumnDef<Client>[] = useMemo(
    () => [
      { header: 'No', key: 'no', width: 6, align: 'center', render: (c) => filteredClients.indexOf(c) + 1 },
      { header: 'Client ID', key: 'id', width: 14, align: 'center', render: (c) => c.id },
      { header: 'Nama Klien', key: 'name', width: 28, render: (c) => c.name },
      { header: 'Tipe', key: 'type', width: 10, align: 'center', render: (c) => c.type },
      { header: 'Bentuk Usaha', key: 'entityType', width: 14, align: 'center', render: (c) => c.entityType },
      { header: 'Kategori Investasi', key: 'investmentCategory', width: 18, align: 'center', render: (c) => c.investmentCategory || 'Belum Ditentukan' },
      { header: 'Jenis Data', key: 'dataType', width: 12, align: 'center', render: (c) => c.dataType || 'Belum Diatur' },
      { header: 'Status Kontrak', key: 'status', width: 16, align: 'center', render: (c) => c.status },
      { header: 'Status PKP', key: 'pkpStatus', width: 14, align: 'center', render: (c) => c.pkpStatus || '-' },
      { header: 'Rezim PPh', key: 'pphRegime', width: 22, render: (c) => c.pphRegime || '-' },
      { header: 'Tahun Pajak', key: 'taxYearEffective', width: 14, align: 'center', render: (c) => c.taxYearEffective || '-' },
      { header: 'Fasilitas UMKM s/d', key: 'umkmEnd', width: 18, align: 'center', render: (c) => c.umkmFacilityEndYear ? `s/d ${c.umkmFacilityEndYear}` : '-' },
      { header: 'PIC Accounting', key: 'accountingStaffPicName', width: 20, render: (c) => c.accountingSpvIsPic ? c.accountingSpvName || '-' : c.accountingStaffPicName || '-' },
      { header: 'PIC Tax', key: 'taxStaffPicName', width: 20, render: (c) => c.taxSpvIsPic ? c.taxSpvName || '-' : c.taxStaffPicName || '-' },
      { header: 'SPV Reviewer Acc', key: 'accountingSpvName', width: 20, render: (c) => c.accountingSpvName || '-' },
      { header: 'SPV Reviewer Tax', key: 'taxSpvName', width: 20, render: (c) => c.taxSpvName || '-' },
      { header: 'Status PIC', key: 'picAssignmentStatus', width: 16, align: 'center', render: (c) => c.picAssignmentStatus },
      { header: 'Risiko Acc', key: 'accountingRisk', width: 14, align: 'center', render: (c) => c.accountingRisk || '-' },
      { header: 'Risiko Tax', key: 'taxRisk', width: 14, align: 'center', render: (c) => c.taxRisk || '-' },
      { header: 'NPWP', key: 'npwp', width: 22, render: (c) => c.npwp || '-' },
      { header: 'Contact Person', key: 'contactPerson', width: 20, render: (c) => c.contactPerson || '-' },
      { header: 'Telepon / WA', key: 'contactPhone', width: 18, render: (c) => c.contactPhone || '-' },
      { header: 'Tanggal Putus Kontrak', key: 'terminationDate', width: 20, align: 'center', render: (c) => c.terminationDate || '-' },
      { header: 'Alasan Putus Kontrak', key: 'terminationReason', width: 30, render: (c) => c.terminationReason || '-' },
      { header: 'Catatan Klien', key: 'notes', width: 32, render: (c) => c.notes || '-' },
    ],
    [filteredClients]
  );

  return (
    <div className="space-y-6">
      {/* Search and Action Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pb-2">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Cari ID, nama klien, PIC utama, atau catatan..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          />
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto flex-wrap">
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
            filename="Master_Klien_TMM_BMA"
            sheetName="Master Klien"
            title="MASTER DATA KLIEN & PROFIL PERPAJAKAN TMM/BMA"
            subtitle={`Filter: ${filterType} | PKP: ${filterPkp} | Status: ${filterStatus} | Total: ${filteredClients.length} klien`}
            columns={clientExportColumns}
            data={filteredClients}
            label="Ekspor & Copas"
          />

          {canEdit && (
            <button
              onClick={handleOpenAddModal}
              className="flex items-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Tambah Klien</span>
            </button>
          )}
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-700">Portofolio Klien</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">Segmentasi & profil risiko</h2>
            <p className="mt-1 text-xs text-slate-500">PMA/PMDN dan risiko tertinggi Accounting atau Tax.</p>
          </div>
          <div className="inline-flex w-full rounded-lg border border-slate-200 bg-white p-1 sm:w-auto" aria-label="Pilih data untuk grafik">
            {(['Real', 'Simulasi', 'Semua'] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setChartDataType(type)}
                aria-pressed={chartDataType === type}
                className={`min-h-10 flex-1 rounded-md px-3 text-xs font-semibold transition-colors sm:flex-none ${chartDataType === type ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {type === 'Semua' ? 'Semua data' : type}
              </button>
            ))}
          </div>
        </div>
        <ClientSegmentationChart clients={clients} dataType={chartDataType} />
        <div className="mt-4">
          <ClientPicWorkloadChart data={picWorkloadData} dataType={chartDataType} />
        </div>
      </section>

      {/* Multi-facet Filter Row */}
      <div className="p-3.5 bg-white border border-slate-200 rounded-xl flex flex-wrap gap-2.5 items-center text-xs">
        <div className="flex items-center gap-1 text-slate-500 font-medium">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <span>Filter:</span>
        </div>

        {/* Status Penugasan 4 PIC */}
        <select
          value={filterPicStatus}
          onChange={(e) => setFilterPicStatus(e.target.value)}
          className={`px-2.5 py-1.5 border rounded-md font-semibold focus:outline-none ${
            filterPicStatus === 'Belum Lengkap'
              ? 'bg-amber-50 border-amber-300 text-amber-900'
              : 'bg-slate-50 border-slate-200 text-slate-700'
          }`}
        >
          <option value="All">Semua Status PIC</option>
          <option value="Lengkap">PIC Utama Lengkap</option>
          <option value="Belum Lengkap">PIC Belum Lengkap</option>
        </select>

        <select
          value={filterPicOwner}
          onChange={(e) => setFilterPicOwner(e.target.value)}
          aria-label="Filter berdasarkan PIC utama"
          className="max-w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-slate-700 font-medium focus:outline-none"
        >
          <option value="All">Semua PIC Utama</option>
          {picFilterOptions.map((pic) => (
            <option key={pic.key} value={pic.key}>{pic.name} — {pic.roleLabel}</option>
          ))}
        </select>

        {/* Jenis OP / Badan */}
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-slate-700 font-medium focus:outline-none"
        >
          <option value="All">Semua Jenis (OP/Badan)</option>
          <option value="Badan">Badan Usaha</option>
          <option value="OP">Orang Pribadi (OP)</option>
        </select>

        <select
          value={filterInvestment}
          onChange={(e) => setFilterInvestment(e.target.value)}
          aria-label="Filter PMA atau PMDN"
          className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-slate-700 font-medium focus:outline-none"
        >
          <option value="All">Semua PMA/PMDN</option>
          <option value="PMA">PMA</option>
          <option value="PMDN">PMDN</option>
          <option value="Belum Ditentukan">Belum Ditentukan</option>
        </select>
        <select
          value={filterDataType}
          onChange={(e) => setFilterDataType(e.target.value)}
          aria-label="Filter data Real atau Simulasi"
          className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-slate-700 font-medium focus:outline-none"
        >
          <option value="All">Semua Real/Simulasi</option>
          <option value="Real">Real</option>
          <option value="Simulasi">Simulasi</option>
          <option value="Belum Diatur">Belum Diatur</option>
        </select>

        {/* Status PKP */}
        <select
          value={filterPkp}
          onChange={(e) => setFilterPkp(e.target.value)}
          className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-slate-700 font-medium focus:outline-none"
        >
          <option value="All">Semua Status PKP</option>
          <option value="PKP">PKP</option>
          <option value="Non-PKP">Non-PKP</option>
          <option value="Belum Diisi">Belum Diisi</option>
        </select>

        {/* Rezim PPh */}
        <select
          value={filterPph}
          onChange={(e) => setFilterPph(e.target.value)}
          className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-slate-700 font-medium focus:outline-none"
        >
          <option value="All">Semua Rezim PPh</option>
          <option value="PPh Final UMKM">PPh Final UMKM (PP 55)</option>
          <option value="PPh Badan Tarif Umum">PPh Badan Tarif Umum</option>
          <option value="PPh OP Tarif Umum">PPh OP Tarif Umum</option>
          <option value="PPh Final Lainnya">PPh Final Lainnya</option>
        </select>

        {/* Tingkat Risiko */}
        <select
          value={filterRisk}
          onChange={(e) => setFilterRisk(e.target.value)}
          className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-slate-700 font-medium focus:outline-none"
        >
          <option value="All">Semua Risiko</option>
          <option value="High">Risiko Tinggi (High)</option>
          <option value="Medium">Risiko Sedang (Medium)</option>
          <option value="Low">Risiko Rendah (Low)</option>
        </select>

        <span className="ml-auto text-slate-400 font-mono tabular-nums text-[11px]">
          Menampilkan {filteredClients.length} dari {clients.length} klien
        </span>
      </div>

      {/* Clients Table */}
      <div className="hidden xl:block bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-3 px-4">Client ID & Nama</th>
                <th className="py-3 px-3">Bentuk & Profil</th>
                <th className="py-3 px-3">Status PKP</th>
                <th className="py-3 px-3">Rezim PPh</th>
                <th className="py-3 px-3">PIC Utama & Reviewer</th>
                <th className="py-3 px-3 text-center">Status PIC</th>
                <th className="py-3 px-3 text-center">Risiko Acc / Tax</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredClients.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    Tidak ada klien yang sesuai dengan kriteria filter pencarian.
                  </td>
                </tr>
              ) : (
                filteredClients.map((client) => {
                  const isPicComplete = client.picAssignmentStatus === 'Lengkap';

                  return (
                    <tr
                      key={client.id}
                      onClick={() => handleOpenDetail(client, false)}
                      className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                    >
                      {/* ID & Name */}
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 group-hover:text-amber-700 transition-colors">
                          {client.name}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5">
                          {client.id} · {client.status} · {client.investmentCategory} · {client.dataType}
                        </div>
                      </td>

                      {/* Bentuk & Profil */}
                      <td className="py-3 px-3">
                        <div className="text-slate-700 font-medium">
                          {client.type === 'OP' ? 'Orang Pribadi' : client.entityType}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          Tahun {client.taxYearEffective}
                        </div>
                      </td>

                      {/* Status PKP */}
                      <td className="py-3 px-3">
                        <span
                          className={`inline-block font-medium ${
                            client.pkpStatus === 'PKP'
                              ? 'text-amber-700 font-semibold'
                              : client.pkpStatus === 'Non-PKP'
                              ? 'text-slate-600'
                              : 'text-slate-400'
                          }`}
                        >
                          {client.pkpStatus}
                        </span>
                      </td>

                      {/* Rezim PPh */}
                      <td className="py-3 px-3">
                        <div className="text-slate-800 font-medium max-w-[160px] truncate" title={client.pphRegime}>
                          {client.pphRegime}
                        </div>
                        {client.umkmFacilityEndYear && (
                          <div className="text-[10px] text-slate-400 font-mono tabular-nums">
                            Fasilitas s/d {client.umkmFacilityEndYear}
                          </div>
                        )}
                      </td>

                      {/* 4 PIC Assignments Detail */}
                      <td className="py-3 px-3 text-[11px] space-y-0.5 max-w-[210px]">
                        <div className="truncate text-slate-800">
                          <span className="font-semibold text-slate-500">PIC Acc:</span> {client.accountingSpvIsPic ? `${client.accountingSpvName} (SPV)` : client.accountingStaffPicName || '-'}
                        </div>
                        <div className="truncate text-slate-800">
                          <span className="font-semibold text-slate-500">PIC Tax:</span> {client.taxSpvIsPic ? `${client.taxSpvName} (SPV)` : client.taxStaffPicName || '-'}
                        </div>
                        <div className="truncate text-slate-500 text-[10px]">
                          <span>SPV Reviewer: {client.accountingSpvName?.split(',')[0]} (Acc) · {client.taxSpvName?.split(',')[0]} (Tax)</span>
                        </div>
                      </td>

                      {/* Status PIC Badge (Prompt 2 requirement) */}
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                            isPicComplete
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-900 border border-amber-300'
                          }`}
                        >
                          {isPicComplete ? 'PIC Lengkap' : 'Pembagian PIC Belum Lengkap'}
                        </span>
                      </td>

                      {/* Risk Scores */}
                      <td className="py-3 px-3 text-center">
                        <div className="flex items-center justify-center gap-1 font-mono text-[10px]">
                          <span
                            className={`px-1.5 py-0.5 rounded font-bold ${
                              client.accountingRisk === 'High' ? 'text-rose-700 bg-rose-50' : 'text-slate-600'
                            }`}
                          >
                            A: {client.accountingRisk}
                          </span>
                          <span>·</span>
                          <span
                            className={`px-1.5 py-0.5 rounded font-bold ${
                              client.taxRisk === 'High' ? 'text-rose-700 bg-rose-50' : 'text-slate-600'
                            }`}
                          >
                            T: {client.taxRisk}
                          </span>
                        </div>
                      </td>

                      {/* Action */}
                      <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          {canEditClient(client) && (
                            <button
                              onClick={() => handleOpenDetail(client, true)}
                              className="p-1.5 text-slate-400 hover:text-amber-700 hover:bg-amber-50 rounded transition-colors"
                              title="Edit Data Klien & PIC"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canTerminate && canEditClient(client) && client.status !== 'Putus Kontrak' && (
                            <button
                              onClick={() => handleOpenTerminate(client)}
                              className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors"
                              title="Putus Kontrak Klien"
                            >
                              <UserX className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              onClick={() => setClientToDelete(client)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                              title="Hapus Klien Permanen"
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

      <div className="grid gap-3 xl:hidden">
        {filteredClients.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Tidak ada klien yang sesuai dengan kriteria filter.
          </div>
        ) : filteredClients.map((client) => (
            <article key={client.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <button type="button" onClick={() => handleOpenDetail(client)} className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-lg">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-slate-900">{client.name}</h3>
                    <p className="mt-1 text-[11px] font-mono text-slate-500">{client.id} · {client.status}</p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-slate-400" />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-700">{client.investmentCategory}</span>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${client.dataType === 'Real' ? 'bg-emerald-50 text-emerald-700' : client.dataType === 'Simulasi' ? 'bg-violet-50 text-violet-700' : 'bg-amber-50 text-amber-800'}`}>{client.dataType}</span>
                  <span className="rounded-full bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-700">Risiko {client.accountingRisk === 'High' || client.taxRisk === 'High' ? 'High' : client.accountingRisk === 'Medium' || client.taxRisk === 'Medium' ? 'Medium' : client.accountingRisk === 'Low' || client.taxRisk === 'Low' ? 'Low' : 'Belum Dinilai'}</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-[11px]">
                  <div><span className="text-slate-400">PIC Accounting</span><p className="mt-0.5 truncate font-medium text-slate-700">{client.accountingSpvIsPic ? `${client.accountingSpvName} (SPV)` : client.accountingStaffPicName || '-'}</p></div>
                  <div><span className="text-slate-400">PIC Tax</span><p className="mt-0.5 truncate font-medium text-slate-700">{client.taxSpvIsPic ? `${client.taxSpvName} (SPV)` : client.taxStaffPicName || '-'}</p></div>
                </div>
              </button>
              <div className="mt-3 flex items-center justify-end border-t border-slate-100 pt-3">
                <div className="flex gap-2">
                  {canEditClient(client) && <button type="button" onClick={() => handleOpenDetail(client, true)} className="min-h-10 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700">Edit klien</button>}
                  <button type="button" onClick={() => handleOpenDetail(client)} className="min-h-10 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white">Detail</button>
                </div>
              </div>
            </article>
          ))}
      </div>

      {/* Client detail and edit modal */}
      {(selectedClient || isAddModalOpen) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-3 backdrop-blur-sm sm:p-5">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="client-form-title"
            className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-in zoom-in-95 duration-200 sm:max-h-[calc(100dvh-2.5rem)]"
          >
            {/* Client modal header */}
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/50 p-3 sm:p-5">
              <div className="min-w-0 flex-1">
                <h3 id="client-form-title" className="truncate text-sm font-bold text-slate-900 sm:text-base">
                  {isAddModalOpen
                    ? 'Tambah Klien Baru'
                    : isEditMode
                    ? `Edit Klien: ${selectedClient?.name}`
                    : `Detail Klien: ${selectedClient?.name}`}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selectedClient ? `${selectedClient.id} · Versi Data: v${selectedClient.version}` : 'Input master data konsultan'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                {selectedClient && !isEditMode && canEditClient(selectedClient) && (
                  <button
                    onClick={() => setIsEditMode(true)}
                    aria-label="Edit Data dan PIC Klien"
                    className="flex min-h-10 items-center gap-1.5 px-2 sm:px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-xs font-medium"
                  >
                    <Edit className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Edit Data & PIC</span>
                  </button>
                )}
                {selectedClient && !isEditMode && canTerminate && canEditClient(selectedClient) && selectedClient.status !== 'Putus Kontrak' && (
                  <button
                    onClick={() => handleOpenTerminate(selectedClient)}
                    aria-label="Putus kontrak klien"
                    className="flex min-h-10 items-center gap-1.5 px-2 sm:px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-md text-xs font-medium transition-colors"
                  >
                    <UserX className="w-3.5 h-3.5 text-amber-700" />
                    <span className="hidden sm:inline">Putus Kontrak</span>
                  </button>
                )}
                {selectedClient && !isEditMode && canDelete && (
                  <button
                    onClick={() => setClientToDelete(selectedClient)}
                    aria-label="Hapus klien"
                    className="flex min-h-10 items-center gap-1.5 px-2 sm:px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 rounded-md text-xs font-medium transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                    <span>Hapus Klien</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedClient(null);
                    setIsAddModalOpen(false);
                  }}
                  aria-label="Tutup detail klien"
                  className="min-h-10 min-w-10 p-1.5 text-slate-400 hover:text-slate-700 rounded-md"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Client modal content */}
            <div className="flex-1 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 sm:pb-6 flex flex-col gap-6 text-xs">
              {/* Basic Client Info */}
              <div className="space-y-4">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider pb-1 border-b border-slate-100">
                  1. Informasi Identitas Klien
                </h4>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="block text-slate-600 font-medium mb-1">Nama Klien / Perusahaan</label>
                    <input
                      type="text"
                      disabled={!isEditMode && !isAddModalOpen}
                      value={formData.name || ''}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-medium disabled:bg-slate-100"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-600 font-medium mb-1">Jenis Klien</label>
                    <select
                      disabled={!isEditMode && !isAddModalOpen}
                      value={formData.type || 'Badan'}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          type: e.target.value as any,
                          entityType: e.target.value === 'OP' ? '-' : 'PT',
                        })
                      }
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 disabled:bg-slate-100"
                    >
                      <option value="Badan">Badan Usaha</option>
                      <option value="OP">Orang Pribadi (OP)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-600 font-medium mb-1">Bentuk Badan Usaha</label>
                    <select
                      disabled={!isEditMode && !isAddModalOpen || formData.type === 'OP'}
                      value={formData.entityType || '-'}
                      onChange={(e) => setFormData({ ...formData, entityType: e.target.value as any })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 disabled:bg-slate-100"
                    >
                      <option value="-">- (Khusus OP)</option>
                      <option value="PT">PT (Perseroan Terbatas)</option>
                      <option value="CV">CV (Commanditaire Vennootschap)</option>
                      <option value="Firma">Firma</option>
                      <option value="Lainnya">Lainnya</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-600 font-medium mb-1">Kategori Penanaman Modal</label>
                    <select
                      disabled={!isEditMode && !isAddModalOpen}
                      value={formData.investmentCategory || 'Belum Ditentukan'}
                      onChange={(e) => setFormData({ ...formData, investmentCategory: e.target.value as Client['investmentCategory'] })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 disabled:bg-slate-100"
                    >
                      <option value="Belum Ditentukan">Belum Ditentukan</option>
                      <option value="PMA">PMA</option>
                      <option value="PMDN">PMDN</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-600 font-medium mb-1">Jenis Data Klien</label>
                    <select
                      disabled={!isEditMode && !isAddModalOpen}
                      value={formData.dataType || 'Belum Diatur'}
                      onChange={(e) => setFormData({ ...formData, dataType: e.target.value as Client['dataType'] })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 disabled:bg-slate-100"
                    >
                      <option value="Real">Real</option>
                      <option value="Simulasi">Simulasi</option>
                      <option value="Belum Diatur">Belum Diatur</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-600 font-medium mb-1">NPWP 16 Digit</label>
                    <input
                      type="text"
                      disabled={!isEditMode && !isAddModalOpen}
                      value={formData.npwp || ''}
                      onChange={(e) => setFormData({ ...formData, npwp: e.target.value })}
                      placeholder="00.000.000.0-000.000"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 disabled:bg-slate-100 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-600 font-medium mb-1">Status Klien</label>
                    <select
                      disabled={!isEditMode && !isAddModalOpen}
                      value={formData.status || 'Aktif'}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 disabled:bg-slate-100"
                    >
                      <option value="Aktif">Aktif</option>
                      <option value="Tidak Aktif">Tidak Aktif</option>
                    </select>
                  </div>
                </div>
              </div>

              {formData.type !== 'OP' && (
                <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="client-capital-title">
                  <div className="border-b border-slate-100 pb-2">
                    <h4 id="client-capital-title" className="text-xs font-bold uppercase tracking-wider text-slate-900">Data akta & permodalan</h4>
                    <p className="mt-1 text-[11px] leading-5 text-slate-500">Opsional. Persentase setoran dihitung dari modal disetor dibanding modal dasar yang tercantum dalam akta.</p>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="client-deed-number" className="mb-1 block font-medium text-slate-600">Nomor akta terakhir</label>
                      <input id="client-deed-number" type="text" maxLength={100} disabled={!isEditMode && !isAddModalOpen} value={formData.deedNumber || ''} onChange={(event) => setFormData({ ...formData, deedNumber: event.target.value })} placeholder="Nomor akta" className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-900 disabled:bg-slate-100" />
                    </div>
                    <div>
                      <label htmlFor="client-deed-date" className="mb-1 block font-medium text-slate-600">Tanggal akta</label>
                      <input id="client-deed-date" type="date" disabled={!isEditMode && !isAddModalOpen} value={formData.deedDate || ''} onChange={(event) => setFormData({ ...formData, deedDate: event.target.value })} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-900 disabled:bg-slate-100" />
                    </div>
                    {([
                      { key: 'authorizedCapital' as const, label: 'Modal dasar sesuai akta' },
                      { key: 'issuedCapital' as const, label: 'Modal ditempatkan' },
                      { key: 'paidUpCapital' as const, label: 'Modal disetor' },
                    ]).map(({ key, label }) => (
                      <div key={key}>
                        <label htmlFor={`client-${key}`} className="mb-1 block font-medium text-slate-600">{label} (Rp)</label>
                        <input id={`client-${key}`} type="text" inputMode="numeric" disabled={!isEditMode && !isAddModalOpen} value={formatCapitalInput(formData[key])} onChange={(event) => setFormData({ ...formData, [key]: parseCapitalInput(event.target.value) })} placeholder="Belum diisi" className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-right tabular-nums text-slate-900 disabled:bg-slate-100" />
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* PEMBAGIAN 4 PIC KLIEN (Section 3 Prompt 2) */}
              <div className="space-y-4 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="flex items-center justify-between pb-1 border-b border-slate-200">
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-amber-600" />
                    <span>2. PIC Utama dan Reviewer per Divisi</span>
                  </h4>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      isPicAssignmentComplete
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-900'
                    }`}
                  >
                    Status: {isPicAssignmentComplete ? 'Lengkap' : 'Belum Lengkap'}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">
                      PIC Utama Accounting
                    </label>
                    <label className="mb-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">
                      <input
                        type="checkbox"
                        checked={Boolean(formData.accountingSpvIsPic)}
                        disabled={(!isEditMode && !isAddModalOpen) || (!isAdmin && !isAddModalOpen)}
                        onChange={(event) => setFormData({
                          ...formData,
                          accountingSpvIsPic: event.target.checked,
                          accountingStaffPicId: event.target.checked ? '' : formData.accountingStaffPicId,
                          accountingStaffPicName: event.target.checked ? '' : formData.accountingStaffPicName,
                        })}
                        className="mt-0.5 accent-amber-600"
                      />
                      <span>SPV Accounting menjadi PIC utama dan yang menangani klien ini; bukan staff.</span>
                    </label>
                    <select
                      disabled={Boolean(formData.accountingSpvIsPic) || (!isEditMode && !isAddModalOpen) || (!isAdmin && !isAddModalOpen)}
                      value={formData.accountingStaffPicId || ''}
                      onChange={(e) => {
                        const user = users.find((candidate) => candidate.id === e.target.value);
                        setFormData({
                          ...formData,
                          accountingStaffPicId: user?.id || '',
                          accountingStaffPicName: user?.name || '',
                        });
                      }}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 font-medium disabled:bg-slate-100"
                    >
                      <option value="">Pilih Staff Accounting</option>
                      {formData.accountingStaffPicId && !users.some((user) => user.id === formData.accountingStaffPicId && user.active && user.role === 'Staff Accounting') && (
                        <option value={formData.accountingStaffPicId}>{formData.accountingStaffPicName || 'PIC lama'} (perlu diperbarui)</option>
                      )}
                      {users.filter((user) => user.active && user.role === 'Staff Accounting').map((user) => (
                        <option key={user.id} value={user.id}>{user.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">
                      PIC Utama Tax
                    </label>
                    <label className="mb-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">
                      <input
                        type="checkbox"
                        checked={Boolean(formData.taxSpvIsPic)}
                        disabled={(!isEditMode && !isAddModalOpen) || (!isAdmin && !isAddModalOpen)}
                        onChange={(event) => setFormData({
                          ...formData,
                          taxSpvIsPic: event.target.checked,
                          taxStaffPicId: event.target.checked ? '' : formData.taxStaffPicId,
                          taxStaffPicName: event.target.checked ? '' : formData.taxStaffPicName,
                        })}
                        className="mt-0.5 accent-amber-600"
                      />
                      <span>SPV Tax menjadi PIC utama dan yang menangani klien ini; bukan staff.</span>
                    </label>
                    <select
                      disabled={Boolean(formData.taxSpvIsPic) || (!isEditMode && !isAddModalOpen) || (!isAdmin && !isAddModalOpen)}
                      value={formData.taxStaffPicId || ''}
                      onChange={(e) => {
                        const user = users.find((candidate) => candidate.id === e.target.value);
                        setFormData({
                          ...formData,
                          taxStaffPicId: user?.id || '',
                          taxStaffPicName: user?.name || '',
                        });
                      }}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 font-medium disabled:bg-slate-100"
                    >
                      <option value="">Pilih Staff Tax</option>
                      {formData.taxStaffPicId && !users.some((user) => user.id === formData.taxStaffPicId && user.active && user.role === 'Staff Tax') && (
                        <option value={formData.taxStaffPicId}>{formData.taxStaffPicName || 'PIC lama'} (perlu diperbarui)</option>
                      )}
                      {users.filter((user) => user.active && user.role === 'Staff Tax').map((user) => (
                        <option key={user.id} value={user.id}>{user.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">
                      SPV Accounting (Reviewer dan PIC jika dipilih)
                    </label>
                    <select
                      disabled={(!isEditMode && !isAddModalOpen) || (!isAdmin && !isAddModalOpen)}
                      value={formData.accountingSpvId || ''}
                      onChange={(e) => {
                        const user = users.find((candidate) => candidate.id === e.target.value);
                        setFormData({
                          ...formData,
                          accountingSpvId: user?.id || '',
                          accountingSpvName: user?.name || '',
                        });
                      }}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 font-medium disabled:bg-slate-100"
                    >
                      <option value="">Pilih SPV Accounting</option>
                      {formData.accountingSpvId && !users.some((user) => user.id === formData.accountingSpvId && user.active && user.role === 'SPV Accounting') && (
                        <option value={formData.accountingSpvId}>{formData.accountingSpvName || 'PIC lama'} (perlu diperbarui)</option>
                      )}
                      {users.filter((user) => user.active && user.role === 'SPV Accounting').map((user) => (
                        <option key={user.id} value={user.id}>{user.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-700 font-semibold mb-1">
                      SPV Tax (Reviewer dan PIC jika dipilih)
                    </label>
                    <select
                      disabled={(!isEditMode && !isAddModalOpen) || (!isAdmin && !isAddModalOpen)}
                      value={formData.taxSpvId || ''}
                      onChange={(e) => {
                        const user = users.find((candidate) => candidate.id === e.target.value);
                        setFormData({
                          ...formData,
                          taxSpvId: user?.id || '',
                          taxSpvName: user?.name || '',
                        });
                      }}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 font-medium disabled:bg-slate-100"
                    >
                      <option value="">Pilih SPV Tax</option>
                      {formData.taxSpvId && !users.some((user) => user.id === formData.taxSpvId && user.active && user.role === 'SPV Tax') && (
                        <option value={formData.taxSpvId}>{formData.taxSpvName || 'PIC lama'} (perlu diperbarui)</option>
                      )}
                      {users.filter((user) => user.active && user.role === 'SPV Tax').map((user) => (
                        <option key={user.id} value={user.id}>{user.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* PIC change note if editing */}
                {isEditMode && (
                  <div>
                    <label className="block text-slate-600 font-medium mb-1">
                      Catatan Perubahan PIC (Opsional untuk riwayat audit):
                    </label>
                    <input
                      type="text"
                      value={picChangeNote}
                      onChange={(e) => setPicChangeNote(e.target.value)}
                      placeholder="Alasan pergantian atau penugasan PIC baru..."
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded text-xs"
                    />
                  </div>
                )}

                {/* Riwayat Penugasan PIC */}
                {selectedClient?.picHistory && selectedClient.picHistory.length > 0 && (
                  <div className="pt-2 border-t border-slate-200">
                    <span className="text-[11px] font-bold text-slate-700 block mb-1.5">
                      Riwayat Perubahan Penugasan PIC:
                    </span>
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {selectedClient.picHistory.map((h) => (
                        <div key={h.id} className="p-2 bg-white border border-slate-200 rounded text-[10px]">
                          <div className="flex justify-between text-slate-400 mb-0.5">
                            <span>Oleh: {h.changedBy}</span>
                            <span className="font-mono">{h.timestamp?.split('T')[0]}</span>
                          </div>
                          <p className="text-slate-700 font-medium">
                            Acc PIC: {h.accountingSpvIsPic ? `${h.accountingSpv} (SPV)` : h.accountingStaff} (Reviewer: {h.accountingSpv}) | Tax PIC: {h.taxSpvIsPic ? `${h.taxSpv} (SPV)` : h.taxStaff} (Reviewer: {h.taxSpv})
                          </p>
                          {h.notes && <p className="text-slate-500 italic mt-0.5">{h.notes}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Tax Profile Section */}
              <div className="space-y-4">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider pb-1 border-b border-slate-100">
                  3. Profil Perpajakan (PKP & Rezim PPh Terpisah)
                </h4>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-slate-600 font-medium mb-1">Status PKP</label>
                    <select
                      disabled={!isEditMode && !isAddModalOpen}
                      value={formData.pkpStatus || 'Belum Diisi'}
                      onChange={(e) => setFormData({ ...formData, pkpStatus: e.target.value as any })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-semibold disabled:bg-slate-100"
                    >
                      <option value="PKP">PKP (Pengusaha Kena Pajak)</option>
                      <option value="Non-PKP">Non-PKP</option>
                      <option value="Belum Diisi">Belum Diisi</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-600 font-medium mb-1">Rezim PPh</label>
                    <select
                      disabled={!isEditMode && !isAddModalOpen}
                      value={formData.pphRegime || 'Belum Ditentukan'}
                      onChange={(e) => setFormData({ ...formData, pphRegime: e.target.value as any })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-semibold disabled:bg-slate-100"
                    >
                      <option value="PPh Final UMKM">PPh Final UMKM (PP 55/2022)</option>
                      <option value="PPh Badan Tarif Umum">PPh Badan Tarif Umum</option>
                      <option value="PPh OP Tarif Umum">PPh OP Tarif Umum</option>
                      <option value="PPh Final Lainnya">PPh Final Lainnya</option>
                      <option value="Belum Ditentukan">Belum Ditentukan</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-600 font-medium mb-1">Tahun Pajak Berlaku</label>
                    <input
                      type="number"
                      disabled={!isEditMode && !isAddModalOpen}
                      value={formData.taxYearEffective || 2026}
                      onChange={(e) => setFormData({ ...formData, taxYearEffective: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 disabled:bg-slate-100 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-600 font-medium mb-1">Tahun Akhir Fasilitas UMKM</label>
                    <input
                      type="number"
                      disabled={!isEditMode && !isAddModalOpen}
                      value={formData.umkmFacilityEndYear || ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          umkmFacilityEndYear: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      placeholder="Contoh: 2026"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 disabled:bg-slate-100 font-mono"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-slate-600 font-medium mb-1">Catatan & Sumber Data Pajak</label>
                    <textarea
                      rows={2}
                      disabled={!isEditMode && !isAddModalOpen}
                      value={formData.taxProfileNotes || ''}
                      onChange={(e) => setFormData({ ...formData, taxProfileNotes: e.target.value })}
                      placeholder="Dasar data penetapan rezim..."
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 disabled:bg-slate-100"
                    />
                  </div>
                </div>
              </div>

              {/* Separate Risk Assessment */}
              <div className="space-y-4">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider pb-1 border-b border-slate-100">
                  4. Penilaian Risiko Accounting & Tax (Terpisah)
                </h4>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {/* Accounting Risk */}
                  <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="accounting-risk-level" className="block text-xs font-semibold text-slate-700">Tingkat Risiko Accounting</label>
                      <select
                        id="accounting-risk-level"
                        disabled={(!isEditMode && !isAddModalOpen) || (!isAddModalOpen && !isAdmin && currentUser.role !== 'SPV Accounting')}
                        value={formData.accountingRisk || 'Not Assessed'}
                        onChange={(e) => setFormData({ ...formData, accountingRisk: e.target.value as any })}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 disabled:bg-slate-100"
                      >
                        <option value="Not Assessed">Not Assessed</option>
                        <option value="Low">Low (Rendah)</option>
                        <option value="Medium">Medium (Sedang)</option>
                        <option value="High">High (Tinggi)</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="accounting-risk-reason" className="block text-xs font-semibold text-slate-700">Alasan Risiko Accounting</label>
                      <textarea
                        id="accounting-risk-reason"
                        rows={9}
                        disabled={(!isEditMode && !isAddModalOpen) || (!isAddModalOpen && !isAdmin && currentUser.role !== 'SPV Accounting')}
                        value={formData.accountingRiskReason || ''}
                        onChange={(e) => setFormData({ ...formData, accountingRiskReason: e.target.value })}
                        placeholder="Jelaskan faktor utama yang mendasari tingkat risiko..."
                        className="min-h-56 w-full resize-y rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm leading-7 text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none disabled:bg-slate-100"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="accounting-risk-recommendation" className="block text-xs font-semibold text-slate-700">Saran / Plan Accounting</label>
                      <textarea
                        id="accounting-risk-recommendation"
                        rows={5}
                        disabled={(!isEditMode && !isAddModalOpen) || (!isAddModalOpen && !isAdmin && currentUser.role !== 'SPV Accounting')}
                        value={formData.accountingRiskRecommendation || ''}
                        onChange={(e) => setFormData({ ...formData, accountingRiskRecommendation: e.target.value })}
                        placeholder="Tuliskan saran atau rencana tindak lanjut..."
                        className="min-h-32 w-full resize-y rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none disabled:bg-slate-100"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="accounting-risk-review-date" className="block text-xs font-semibold text-slate-700">Tanggal Review Berikutnya</label>
                      <input
                        id="accounting-risk-review-date"
                        type="date"
                        disabled={(!isEditMode && !isAddModalOpen) || (!isAddModalOpen && !isAdmin && currentUser.role !== 'SPV Accounting')}
                        value={formData.accountingRiskReviewDate || ''}
                        onChange={(e) => setFormData({ ...formData, accountingRiskReviewDate: e.target.value })}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 disabled:bg-slate-100"
                      />
                    </div>
                  </div>

                  {/* Tax Risk */}
                  <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="tax-risk-level" className="block text-xs font-semibold text-slate-700">Tingkat Risiko Tax</label>
                      <select
                        id="tax-risk-level"
                        disabled={(!isEditMode && !isAddModalOpen) || (!isAddModalOpen && !isAdmin && currentUser.role !== 'SPV Tax')}
                        value={formData.taxRisk || 'Not Assessed'}
                        onChange={(e) => setFormData({ ...formData, taxRisk: e.target.value as any })}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 disabled:bg-slate-100"
                      >
                        <option value="Not Assessed">Not Assessed</option>
                        <option value="Low">Low (Rendah)</option>
                        <option value="Medium">Medium (Sedang)</option>
                        <option value="High">High (Tinggi)</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="tax-risk-reason" className="block text-xs font-semibold text-slate-700">Alasan Risiko Tax</label>
                      <textarea
                        id="tax-risk-reason"
                        rows={9}
                        disabled={(!isEditMode && !isAddModalOpen) || (!isAddModalOpen && !isAdmin && currentUser.role !== 'SPV Tax')}
                        value={formData.taxRiskReason || ''}
                        onChange={(e) => setFormData({ ...formData, taxRiskReason: e.target.value })}
                        placeholder="Jelaskan faktor utama yang mendasari tingkat risiko..."
                        className="min-h-56 w-full resize-y rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm leading-7 text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none disabled:bg-slate-100"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="tax-risk-recommendation" className="block text-xs font-semibold text-slate-700">Saran / Plan Tax</label>
                      <textarea
                        id="tax-risk-recommendation"
                        rows={5}
                        disabled={(!isEditMode && !isAddModalOpen) || (!isAddModalOpen && !isAdmin && currentUser.role !== 'SPV Tax')}
                        value={formData.taxRiskRecommendation || ''}
                        onChange={(e) => setFormData({ ...formData, taxRiskRecommendation: e.target.value })}
                        placeholder="Tuliskan saran atau rencana tindak lanjut..."
                        className="min-h-32 w-full resize-y rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none disabled:bg-slate-100"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="tax-risk-review-date" className="block text-xs font-semibold text-slate-700">Tanggal Review Berikutnya</label>
                      <input
                        id="tax-risk-review-date"
                        type="date"
                        disabled={(!isEditMode && !isAddModalOpen) || (!isAddModalOpen && !isAdmin && currentUser.role !== 'SPV Tax')}
                        value={formData.taxRiskReviewDate || ''}
                        onChange={(e) => setFormData({ ...formData, taxRiskReviewDate: e.target.value })}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 disabled:bg-slate-100"
                      />
                    </div>
                  </div>
                </div>

                {/* Risk History Timeline */}
                {selectedClient?.riskHistory && selectedClient.riskHistory.length > 0 && (
                  <div className="pt-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 mb-2">
                      <History className="w-3.5 h-3.5 text-amber-600" />
                      <span>Riwayat Perubahan Penilaian Risiko:</span>
                    </div>
                    <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                      {selectedClient.riskHistory.map((item) => (
                        <div
                          key={item.id}
                          className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm"
                        >
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-slate-500">
                            <span className="font-semibold text-slate-800">
                              {item.division}: {item.previousLevel} → {item.newLevel}
                            </span>
                            <span className="font-mono tabular-nums">{item.date}</span>
                          </div>
                          <p className="whitespace-pre-wrap leading-7 text-slate-700">{item.reason}</p>
                          <p className="mt-1 text-xs text-slate-400">Penilai: {item.assessedBy}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {selectedClient && !isEditMode && !isAddModalOpen && <section aria-labelledby="client-cases-title" className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><h4 id="client-cases-title" className="text-sm font-semibold text-slate-900">Case Register terkait</h4><p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">Daftar case operasional yang tercatat untuk klien ini.</p></div>
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-600">{selectedClientCases.length} case</span>
                </div>
                {selectedClientCases.length ? <div className="flex flex-col gap-2">{selectedClientCases.map((item) => <article key={item.id} className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-1.5"><span className="font-mono text-[10px] font-semibold text-slate-400">{item.id}</span><span className="text-slate-300">·</span><span className="text-[10px] font-medium text-slate-600">{item.division}</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold text-slate-700">{item.status}</span><span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-semibold text-amber-800">Prioritas {item.priority}</span></div>
                  <h5 className="mt-2 break-words text-xs font-semibold text-slate-800">{item.title}</h5>
                  {item.description && <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-600">{item.description}</p>}
                  <div className="mt-2 grid grid-cols-1 gap-2 border-t border-slate-100 pt-2 sm:grid-cols-2"><div><p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">PIC Case</p><p className="mt-0.5 break-words text-[10px] text-slate-700">{item.picName || 'Belum ditentukan'}</p></div><div><p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">PIC Tindak Lanjut</p><p className="mt-0.5 break-words text-[10px] text-slate-700">{item.followUpPicName || 'Belum ditentukan'}</p></div><div><p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Rencana tindak lanjut</p><p className="mt-0.5 whitespace-pre-wrap break-words text-[10px] leading-relaxed text-slate-700">{item.followUpPlan || 'Belum dicatat'}</p></div><div><p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Jadwal berikutnya</p><p className="mt-0.5 text-[10px] text-slate-700">{item.nextFollowUpDate || 'Belum dijadwalkan'}</p></div></div>
                  {item.latestProgress && <p className="mt-2 rounded-md bg-slate-50 p-2 text-[10px] leading-relaxed text-slate-600"><span className="font-semibold text-slate-700">Progres terakhir: </span>{item.latestProgress}</p>}
                </article>)}</div> : <p className="rounded-lg border border-dashed border-slate-200 bg-white/70 p-3 text-xs text-slate-500">Belum ada case yang terdaftar untuk klien ini.</p>}
              </section>}

            </div>

            {/* Client form actions */}
            {(isEditMode || isAddModalOpen) && (
              <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:gap-3 sm:p-4">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedClient(null);
                    setIsAddModalOpen(false);
                  }}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 transition-colors font-medium text-xs"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleSaveClient}
                  disabled={saving}
                  className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-amber-500 disabled:opacity-50 sm:min-h-10"
                >
                  <Save className="w-4 h-4" />
                  <span>
                    {saving
                      ? 'Menyimpan ke Database...'
                      : isEditMode
                      ? 'Simpan Perubahan (Update)'
                      : 'Simpan Klien Baru (Save)'}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Konfirmasi Putus Kontrak */}
      {clientToTerminate && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-amber-50/60">
              <div className="flex items-center gap-2 text-amber-900 font-bold text-sm">
                <UserX className="w-5 h-5 text-amber-700" />
                <span>Konfirmasi Putus Kontrak Klien</span>
              </div>
              <button
                onClick={() => setClientToTerminate(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <p className="font-semibold text-slate-800 text-sm">{clientToTerminate.name}</p>
                <p className="text-slate-500 font-mono text-[11px]">{clientToTerminate.id} · Bentuk: {clientToTerminate.entityType}</p>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Tanggal Pemutusan Kontrak</label>
                <input
                  type="date"
                  value={terminationDate}
                  onChange={(e) => setTerminationDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Alasan Pemutusan Hubungan Kerja Sama</label>
                <textarea
                  rows={3}
                  value={terminationReason}
                  onChange={(e) => setTerminationReason(e.target.value)}
                  placeholder="Contoh: Klien beralih ke in-house accounting / penyelesaian kewajiban..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 text-[11px] flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p>Status klien akan diubah menjadi <strong>Putus Kontrak</strong> dan dicatat ke log audit. Seluruh riwayat data tetap tersimpan aman di database.</p>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setClientToTerminate(null)}
                disabled={terminating}
                className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-100 font-medium"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmTerminate}
                disabled={terminating}
                className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-semibold disabled:opacity-50 shadow-sm"
              >
                <UserX className="w-4 h-4" />
                <span>{terminating ? 'Memproses...' : 'Ubah Menjadi Putus Kontrak'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Konfirmasi Hapus Klien (Permanen) */}
      {clientToDelete && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-rose-100 flex items-center justify-between bg-rose-50/60">
              <div className="flex items-center gap-2 text-rose-900 font-bold text-sm">
                <AlertOctagon className="w-5 h-5 text-rose-600" />
                <span>Hapus Klien Permanen</span>
              </div>
              <button
                onClick={() => setClientToDelete(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="p-3 bg-rose-50/50 border border-rose-200 rounded-xl space-y-1">
                <p className="font-bold text-slate-900 text-sm">{clientToDelete.name}</p>
                <p className="text-slate-500 font-mono text-[11px]">{clientToDelete.id} · Bentuk: {clientToDelete.entityType}</p>
              </div>

              <div className="p-3 bg-rose-50 border border-rose-300 rounded-xl text-rose-900 text-[11px] flex items-start gap-2">
                <AlertOctagon className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-rose-800">PERINGATAN: Tindakan Ini Tidak Dapat Dibatalkan!</p>
                  <p className="text-slate-700 mt-1">Data master klien akan dihapus secara permanen dari database server. Jika Anda hanya ingin menghentikan layanan konsultasi, disarankan menggunakan fitur <strong>Putus Kontrak</strong>.</p>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setClientToDelete(null)}
                disabled={deleting}
                className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-100 font-medium"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-semibold disabled:opacity-50 shadow-sm"
              >
                <Trash2 className="w-4 h-4" />
                <span>{deleting ? 'Menghapus...' : 'Ya, Hapus Permanen'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
