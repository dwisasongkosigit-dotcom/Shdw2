import { useState, useMemo } from 'react';
import {
  Clock,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Building2,
  Search,
  ArrowRight,
  Check,
  Trash2,
  Download,
  AlertOctagon,
  X,
  CalendarX,
} from 'lucide-react';
import { api, type Case, type CurrentUser } from '../lib/api';
import { useToast } from './Toast';
import { ExportDropdown } from './ExportDropdown';
import type { ColumnDef } from '../lib/exportUtils';

interface FollowUpViewProps {
  cases: Case[];
  currentUser: CurrentUser;
  onRefresh: () => void;
  onOpenCaseDetail: (item: Case) => void;
}

export function FollowUpView({
  cases,
  currentUser,
  onRefresh,
  onOpenCaseDetail,
}: FollowUpViewProps) {
  const { success, error } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [viewFilter, setViewFilter] = useState<'All' | 'Overdue' | 'Upcoming'>('All');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // Follow-up & Case delete states
  const [caseToDeleteFromFollowUp, setCaseToDeleteFromFollowUp] = useState<Case | null>(null);
  const [deletingCase, setDeletingCase] = useState(false);
  const [caseToClearFollowUp, setCaseToClearFollowUp] = useState<Case | null>(null);
  const [clearingFollowUp, setClearingFollowUp] = useState(false);

  const isReadOnly = currentUser.role === 'Owner' || currentUser.role === 'Manager';

  const today = new Date().toISOString().split('T')[0];

  const activeCasesWithFollowUp = useMemo(() => {
    return cases.filter(
      (c) => c.status !== 'Resolved' && c.status !== 'Closed' && c.nextFollowUpDate
    );
  }, [cases]);

  const { overdueList, upcomingList } = useMemo(() => {
    const overdue: Case[] = [];
    const upcoming: Case[] = [];

    activeCasesWithFollowUp.forEach((c) => {
      if (c.nextFollowUpDate < today) {
        overdue.push(c);
      } else {
        upcoming.push(c);
      }
    });

    // Sort by follow-up date
    overdue.sort((a, b) => a.nextFollowUpDate.localeCompare(b.nextFollowUpDate));
    upcoming.sort((a, b) => a.nextFollowUpDate.localeCompare(b.nextFollowUpDate));

    return { overdueList: overdue, upcomingList: upcoming };
  }, [activeCasesWithFollowUp, today]);

  const displayedCases = useMemo(() => {
    let list =
      viewFilter === 'Overdue'
        ? overdueList
        : viewFilter === 'Upcoming'
        ? upcomingList
        : [...overdueList, ...upcomingList];

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.clientName.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q) ||
          c.picName.toLowerCase().includes(q)
      );
    }
    return list;
  }, [viewFilter, overdueList, upcomingList, searchTerm]);

  // Quick postpone / update next follow up
  const handleQuickExtend = async (caseItem: Case, days: number) => {
    setUpdatingId(caseItem.id);
    const targetDate = new Date(Date.now() + days * 86400000).toISOString().split('T')[0];
    try {
      await api.updateCase(caseItem.id, {
        nextFollowUpDate: targetDate,
      });
      success('Jadwal Diperbarui', `Follow-up untuk ${caseItem.clientName} dijadwalkan ulang ke ${targetDate}.`);
      onRefresh();
    } catch (err: any) {
      error('Gagal Memperbarui', err.message);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleConfirmClearFollowUp = async () => {
    if (!caseToClearFollowUp) return;
    setClearingFollowUp(true);
    try {
      await api.updateCase(caseToClearFollowUp.id, {
        nextFollowUpDate: '',
      });
      success('Follow-up Selesai', `Jadwal tindak lanjut untuk ${caseToClearFollowUp.clientName} berhasil diselesaikan.`);
      setCaseToClearFollowUp(null);
      onRefresh();
    } catch (err: any) {
      error('Gagal Menyelesaikan Follow-up', err.message);
    } finally {
      setClearingFollowUp(false);
    }
  };

  const handleConfirmDeleteCaseFromFollowUp = async () => {
    if (!caseToDeleteFromFollowUp) return;
    setDeletingCase(true);
    try {
      await api.deleteCase(caseToDeleteFromFollowUp.id);
      success('Kasus Dihapus', `Kasus '${caseToDeleteFromFollowUp.title}' (${caseToDeleteFromFollowUp.id}) berhasil dihapus.`);
      setCaseToDeleteFromFollowUp(null);
      onRefresh();
    } catch (err: any) {
      error('Gagal Menghapus Kasus', err.message);
    } finally {
      setDeletingCase(false);
    }
  };

  const followUpExportColumns: ColumnDef<Case>[] = useMemo(
    () => [
      { header: 'No', key: 'no', width: 6, align: 'center', render: (c) => displayedCases.indexOf(c) + 1 },
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
    [displayedCases, today]
  );

  return (
    <div className="space-y-6">
      {/* Top Header & Filter */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pb-2">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">
            Pusat Pengawasan Follow-up Kasus
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Daftar komitmen tindak lanjut dan penanganan risiko klien yang jatuh tempo
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          {/* View toggle */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs">
            <button
              onClick={() => setViewFilter('All')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                viewFilter === 'All' ? 'bg-white text-slate-900 shadow-sm font-semibold' : 'text-slate-600'
              }`}
            >
              Semua ({activeCasesWithFollowUp.length})
            </button>
            <button
              onClick={() => setViewFilter('Overdue')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                viewFilter === 'Overdue'
                  ? 'bg-rose-50 text-rose-700 shadow-sm font-semibold'
                  : 'text-slate-600'
              }`}
            >
              Terlambat ({overdueList.length})
            </button>
            <button
              onClick={() => setViewFilter('Upcoming')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                viewFilter === 'Upcoming' ? 'bg-white text-slate-900 shadow-sm font-semibold' : 'text-slate-600'
              }`}
            >
              Mendatang ({upcomingList.length})
            </button>
          </div>

          <ExportDropdown
            filename="Follow_Up_Kasus_TMM_BMA"
            sheetName="Follow-up"
            title="PENGAWASAN TINDAK LANJUT KASUS JATUH TEMPO (FOLLOW-UP)"
            subtitle={`Filter: ${viewFilter} | Total: ${displayedCases.length} kasus follow-up`}
            columns={followUpExportColumns}
            data={displayedCases}
            label="Ekspor & Copas"
          />
        </div>
      </div>

      {/* Overdue Alert Banner if any */}
      {overdueList.length > 0 && viewFilter !== 'Upcoming' && (
        <div className="p-4 bg-rose-50/80 border border-rose-200 rounded-xl flex items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
            <div>
              <p className="font-bold text-rose-900">
                Perhatian: Terdapat {overdueList.length} tindak lanjut yang melewati batas tanggal!
              </p>
              <p className="text-rose-700 mt-0.5">
                Segera lakukan kontak klien atau perbarui status progres penanganan masalah.
              </p>
            </div>
          </div>
          <button
            onClick={() => setViewFilter('Overdue')}
            className="px-3 py-1.5 bg-rose-600 text-white font-semibold rounded-lg shrink-0 text-xs hover:bg-rose-500"
          >
            Tampilkan Terlambat
          </button>
        </div>
      )}

      {/* Search Input */}
      <div className="relative max-w-md">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Cari klien, judul kasus, atau PIC..."
          className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg placeholder-slate-400 focus:outline-none focus:border-amber-500"
        />
      </div>

      {/* Follow-up Cards */}
      <div className="space-y-3">
        {displayedCases.length === 0 ? (
          <div className="p-12 text-center text-slate-400 bg-white border border-slate-200 rounded-xl text-xs">
            Tidak ada tindak lanjut aktif pada kategori ini.
          </div>
        ) : (
          displayedCases.map((item) => {
            const isOverdue = item.nextFollowUpDate < today;

            return (
              <div
                key={item.id}
                className={`p-4 bg-white border rounded-xl shadow-sm transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                  isOverdue ? 'border-rose-300 bg-rose-50/20' : 'border-slate-200'
                }`}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-slate-500">{item.id}</span>
                    <span className="text-slate-300">·</span>
                    <span className="text-xs font-semibold text-amber-700">{item.division}</span>
                    <span className="text-slate-300">·</span>
                    <span className="text-xs font-bold text-slate-900">{item.clientName}</span>
                  </div>

                  <h4 className="text-sm font-semibold text-slate-900 line-clamp-1">{item.title}</h4>

                  <p className="text-xs text-slate-600 line-clamp-1">
                    <strong>Rencana Tindak Lanjut:</strong> {item.followUpPlan || item.latestProgress || 'Menunggu tindak lanjut staf.'}
                  </p>

                  <div className="flex items-center gap-3 text-[11px] text-slate-500 pt-1">
                    <span>PIC: {item.picName}</span>
                    <span>·</span>
                    <span>Status: {item.status}</span>
                  </div>
                </div>

                {/* Right Date & Quick Actions */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100">
                  <div className="text-left md:text-right">
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">
                      Jatuh Tempo Follow-up
                    </div>
                    <div
                      className={`text-sm font-mono font-bold tabular-nums ${
                        isOverdue ? 'text-rose-600' : 'text-slate-800'
                      }`}
                    >
                      {item.nextFollowUpDate}
                    </div>
                    {isOverdue && (
                      <span className="text-[10px] font-semibold text-rose-500">
                        Lewat Batas Waktu
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    <button
                      onClick={() => handleQuickExtend(item, 7)}
                      disabled={updatingId === item.id}
                      className="px-2 py-1.5 border border-slate-200 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-50 text-xs font-medium transition-colors"
                      title="Perpanjang 7 hari"
                    >
                      +7 Hari
                    </button>
                    {!isReadOnly && (
                      <button
                        onClick={() => setCaseToClearFollowUp(item)}
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg text-xs font-semibold transition-colors"
                        title="Tandai tindak lanjut selesai"
                      >
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Selesai</span>
                      </button>
                    )}
                    {(currentUser.role === 'Admin' ||
                      (currentUser.role === 'SPV Accounting' && item.division === 'Accounting') ||
                      (currentUser.role === 'SPV Tax' && item.division === 'Tax')) && (
                      <button
                        onClick={() => setCaseToDeleteFromFollowUp(item)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                        title="Hapus Kasus"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => onOpenCaseDetail(item)}
                      className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-colors"
                    >
                      Buka Kasus
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal Konfirmasi Selesaikan Follow-up */}
      {caseToClearFollowUp && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-emerald-100 flex items-center justify-between bg-emerald-50/60">
              <div className="flex items-center gap-2 text-emerald-900 font-bold text-sm">
                <Check className="w-5 h-5 text-emerald-600" />
                <span>Selesaikan Tindak Lanjut</span>
              </div>
              <button
                onClick={() => setCaseToClearFollowUp(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <p className="font-bold text-slate-900 text-sm">{caseToClearFollowUp.title}</p>
                <p className="text-slate-500 font-mono text-[11px]">{caseToClearFollowUp.id} · Klien: {caseToClearFollowUp.clientName}</p>
              </div>

              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 text-[11px] flex items-start gap-2">
                <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-emerald-800">Tandai follow-up untuk kasus ini telah tuntas?</p>
                  <p className="text-slate-700 mt-1">Jadwal follow-up akan dihapus dari daftar pengawasan. Kasus tetap tercatat di Case Register.</p>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setCaseToClearFollowUp(null)}
                disabled={clearingFollowUp}
                className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-100 font-medium"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmClearFollowUp}
                disabled={clearingFollowUp}
                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold disabled:opacity-50 shadow-sm"
              >
                <Check className="w-4 h-4" />
                <span>{clearingFollowUp ? 'Memproses...' : 'Ya, Selesaikan Follow-up'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Konfirmasi Hapus Kasus dari Follow-up */}
      {caseToDeleteFromFollowUp && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-rose-100 flex items-center justify-between bg-rose-50/60">
              <div className="flex items-center gap-2 text-rose-900 font-bold text-sm">
                <AlertOctagon className="w-5 h-5 text-rose-600" />
                <span>Konfirmasi Hapus Kasus</span>
              </div>
              <button
                onClick={() => setCaseToDeleteFromFollowUp(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <p className="font-bold text-slate-900 text-sm">{caseToDeleteFromFollowUp.title}</p>
                <p className="text-slate-500 font-mono text-[11px]">{caseToDeleteFromFollowUp.id} · Klien: {caseToDeleteFromFollowUp.clientName}</p>
              </div>

              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 text-[11px] flex items-start gap-2">
                <AlertOctagon className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-rose-800">Apakah Anda yakin ingin menghapus kasus ini?</p>
                  <p className="text-slate-700 mt-1">Kasus dan seluruh jadwal follow-up terkait akan dihapus secara permanen dari server.</p>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setCaseToDeleteFromFollowUp(null)}
                disabled={deletingCase}
                className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-100 font-medium"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteCaseFromFollowUp}
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
