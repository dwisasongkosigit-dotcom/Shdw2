import { ClipboardList, Menu, RefreshCw, Database, Shield, Moon, Sun } from 'lucide-react';
import type { CurrentUser, BrandingConfig } from '../lib/api';

interface HeaderProps {
  currentTab: string;
  onToggleMobileSidebar: () => void;
  onNavigateToMom: () => void;
  mobileMenuOpen: boolean;
  currentUser: CurrentUser;
  branding: BrandingConfig;
  onRefreshData: () => void;
  isRefreshing?: boolean;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

const TAB_TITLES: Record<string, { title: string; subtitle: string }> = {
  dashboard: { title: 'Dashboard Eksekutif', subtitle: 'Kendali operasional & matriks risiko klien terkini' },
  clients: { title: 'Master Klien', subtitle: 'Kelola basis 50+ klien, profil PKP, rezim PPh & asesmen risiko' },
  jobs: { title: 'Job Management', subtitle: 'Pendelegasian, tracking progres, dan alur approval SPV' },
  cases: { title: 'Case Register', subtitle: 'Pencatatan masalah, akar penyebab, dan kronologi penanganan' },
  followup: { title: 'Follow-up Tracker', subtitle: 'Pengawasan tindak lanjut jatuh tempo & mitigasi keterlambatan' },
  activities: { title: 'Daily Activity Log', subtitle: 'Jurnal harian penanganan pekerjaan staf akuntansi dan pajak' },
  mom: { title: 'Minutes of Meeting', subtitle: 'Notulen rapat, keputusan, dan tindak lanjut manajemen' },
  agenda: { title: 'Agenda Tim', subtitle: 'Jadwal meeting, peserta, lokasi, dan konteks agenda' },
  'executive-summary': { title: 'Executive Summary', subtitle: 'Ringkasan risiko, progres, hambatan, dan agenda prioritas' },
  reports: { title: 'Laporan & Rekapitulasi', subtitle: 'Audit kepatuhan, pemenuhan SLA, dan eksposur risiko fiskal' },
  backup: { title: 'Cadangan & Pemulihan Data', subtitle: 'Manajemen snapshot database, retensi 30 hari & restorasi aman' },
  audit: { title: 'Audit Log Sistem Terpadu', subtitle: 'Rekam jejak mutasi data, login, dan aktivitas operasional staf' },
  branding: { title: 'Pengaturan Aplikasi & Branding', subtitle: 'Kustomisasi judul, logo, dan identitas perusahaan konsultan' },
  users: { title: 'Manajemen Pengguna & Hak Akses', subtitle: 'Pengaturan akun, peran (RBAC), dan otorisasi sistem' },
};

export function Header({
  currentTab,
  onToggleMobileSidebar,
  onNavigateToMom,
  mobileMenuOpen,
  currentUser,
  branding,
  onRefreshData,
  isRefreshing = false,
  theme,
  onToggleTheme,
}: HeaderProps) {
  const meta = TAB_TITLES[currentTab] || { title: 'Control Center', subtitle: 'Sistem Terpadu' };

  const todayStr = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());

  return (
    <header className="sticky top-0 z-30 h-16 bg-white border-b border-slate-200/80 px-4 sm:px-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onToggleMobileSidebar}
          className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 lg:hidden"
          aria-label="Menu navigasi"
          aria-controls="primary-navigation"
          aria-expanded={mobileMenuOpen}
        >
          <Menu className="h-5 w-5" />
          <span className="text-xs font-semibold sm:hidden">Menu</span>
        </button>

        {branding.logoUrl && (
          <img src={branding.logoUrl} alt="" aria-hidden="true" onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} className="hidden size-8 shrink-0 rounded-md object-contain sm:block lg:hidden" />
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight truncate">
              {meta.title}
            </h2>
            <span className="hidden md:inline-block text-xs text-slate-300 font-normal">|</span>
            <span className="hidden md:inline-block text-xs text-slate-500 font-normal truncate">
              {meta.subtitle}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <button
          type="button"
          onClick={onNavigateToMom}
          title="Buka Minutes of Meeting"
          aria-label="Buka Minutes of Meeting"
          className="hidden items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 sm:inline-flex lg:hidden"
        >
          <ClipboardList className="h-4 w-4 text-amber-700" />
          <span>MoM</span>
        </button>

        {/* Date display */}
        <div className="hidden sm:flex items-center text-xs text-slate-500 font-medium">
          {todayStr}
        </div>

        {/* Database Live Persistence Indicator */}
        <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-[11px] font-medium text-slate-700">
          <Database className="w-3.5 h-3.5 text-emerald-600" />
          <span>Server DB: Tersimpan</span>
        </div>

        {/* Role Tag & Read-Only Badge */}
        <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 text-[11px] font-semibold text-amber-900">
          <Shield className="w-3.5 h-3.5 text-amber-600" />
          <span>{currentUser.role}</span>
          {(currentUser.role === 'Owner' || currentUser.role === 'Manager') && (
            <span className="ml-1 px-1.5 py-0.2 rounded bg-amber-200 text-amber-900 text-[9px] font-bold">
              Read-Only
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Aktifkan mode terang' : 'Aktifkan mode gelap'}
          title={theme === 'dark' ? 'Mode terang' : 'Mode gelap'}
          className="min-h-11 min-w-11 rounded-lg border border-slate-200 p-2 text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
        >
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>

        {/* Refresh Data Button */}
        <button
          onClick={onRefreshData}
          disabled={isRefreshing}
          title="Sinkronkan data dengan database server"
          aria-label="Muat ulang data"
          className="min-h-11 min-w-11 rounded-lg border border-slate-200 p-2 text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-amber-600' : ''}`} />
        </button>
      </div>
    </header>
  );
}
