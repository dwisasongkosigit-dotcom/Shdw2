import { Suspense, lazy, useState, useEffect, useCallback, useRef } from 'react';
import {
  api,
  removeToken,
  type CurrentUser,
  type BrandingConfig,
  type Client,
  type Job,
  type Case,
  type DailyActivity,
  type MeetingMinute,
  type TeamAgendaEntry,
  type UserAccount,
  type MonthlyJobTemplate,
  type JobHandoverRecord,
  type ProfileAssignmentHandoverRecord,
} from './lib/api';
import { ToastProvider, useToast } from './components/Toast';
import { Sidebar, type NavTab } from './components/Sidebar';
import { Header } from './components/Header';
import { LoginView } from './components/LoginView';
const DashboardView = lazy(() => import('./components/DashboardView').then(({ DashboardView }) => ({ default: DashboardView })));
const ClientsView = lazy(() => import('./components/ClientsView').then(({ ClientsView }) => ({ default: ClientsView })));
const JobsView = lazy(() => import('./components/JobsView').then(({ JobsView }) => ({ default: JobsView })));
const HandoverView = lazy(() => import('./components/HandoverView').then(({ HandoverView }) => ({ default: HandoverView })));
const CasesView = lazy(() => import('./components/CasesView').then(({ CasesView }) => ({ default: CasesView })));
const FollowUpView = lazy(() => import('./components/FollowUpView').then(({ FollowUpView }) => ({ default: FollowUpView })));
const DailyActivitiesView = lazy(() => import('./components/DailyActivitiesView').then(({ DailyActivitiesView }) => ({ default: DailyActivitiesView })));
const MeetingMinutesView = lazy(() => import('./components/MeetingMinutesView').then(({ MeetingMinutesView }) => ({ default: MeetingMinutesView })));
const TeamAgendaView = lazy(() => import('./components/TeamAgendaView').then(({ TeamAgendaView }) => ({ default: TeamAgendaView })));
const ExecutiveSummaryView = lazy(() => import('./components/ExecutiveSummaryView').then(({ ExecutiveSummaryView }) => ({ default: ExecutiveSummaryView })));
const ReportsView = lazy(() => import('./components/ReportsView').then(({ ReportsView }) => ({ default: ReportsView })));
const BackupRestoreView = lazy(() => import('./components/BackupRestoreView').then(({ BackupRestoreView }) => ({ default: BackupRestoreView })));
const AuditLogView = lazy(() => import('./components/AuditLogView').then(({ AuditLogView }) => ({ default: AuditLogView })));
const BrandingSettingsView = lazy(() => import('./components/BrandingSettingsView').then(({ BrandingSettingsView }) => ({ default: BrandingSettingsView })));
const UserManagementView = lazy(() => import('./components/UserManagementView').then(({ UserManagementView }) => ({ default: UserManagementView })));
import { AlertCircle, RefreshCw, Database } from 'lucide-react';

function MainApp() {
  const { error, success } = useToast();

  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [branding, setBranding] = useState<BrandingConfig>({
    appName: 'TMM/BMA Client Control Center',
    companyName: 'TMM & BMA Advisory',
    subtitle: 'Tax & Accounting Client Control Center',
    logoUrl: '/images/tmm_bma_logo_1792761458459.jpg',
    updatedAt: new Date().toISOString(),
    updatedBy: 'System',
  });

  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    const savedTheme = window.localStorage.getItem('tmm-bma-theme');
    if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  // Core Data
  const [clients, setClients] = useState<Client[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [handoverRecords, setHandoverRecords] = useState<JobHandoverRecord[]>([]);
  const [profileAssignmentHandoverRecords, setProfileAssignmentHandoverRecords] = useState<ProfileAssignmentHandoverRecord[]>([]);
  const [monthlyJobTemplates, setMonthlyJobTemplates] = useState<MonthlyJobTemplate[]>([]);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [cases, setCases] = useState<Case[]>([]);
  const [activities, setActivities] = useState<DailyActivity[]>([]);
  const [meetingMinutes, setMeetingMinutes] = useState<MeetingMinute[]>([]);
  const [agendaEntries, setAgendaEntries] = useState<TeamAgendaEntry[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [dbHealth, setDbHealth] = useState<any>(null);

  // States
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0b1220' : '#f8fafc');
    window.localStorage.setItem('tmm-bma-theme', theme);
  }, [theme]);

  // Check the session first so authenticated users reuse the branding returned by /me.
  const initializeAuthAndBranding = useCallback(async () => {
    try {
      const meRes = await api.getMe().catch(() => null);
      if (meRes?.user) {
        setCurrentUser(meRes.user);
        if (meRes.branding) setBranding(meRes.branding);
      } else {
        const brandData = await api.getBranding().catch(() => null);
        if (brandData) setBranding(brandData);
      }
    } catch {
      setCurrentUser(null);
    } finally {
      setLoadingInitial(false);
    }
  }, []);

  // Fetch business data from the server's temporary in-memory store
  const loadAllBusinessData = useCallback(async (statsDivision: 'All' | 'Accounting' | 'Tax' = 'All') => {
    if (!currentUser) return;
    setIsRefreshing(true);
    setConnectionError(null);

    try {
      const [clientsData, jobsData, casesData, activitiesData, meetingMinutesData, agendaData, statsData, healthData, usersData, monthlyTemplatesData, handoverData] =
        await Promise.all([
          api.getClients(),
          api.getJobs(),
          api.getCases(),
          api.getDailyActivities(),
          api.getMeetingMinutes(),
          api.getAgendaEntries(),
          api.getStats(statsDivision === 'All' ? undefined : { division: statsDivision }),
          api.getHealth(),
          api.getUsers(),
          api.getMonthlyJobTemplates(),
          api.getHandovers(),
        ]);

      setClients(clientsData);
      setJobs(jobsData);
      setHandoverRecords(handoverData.jobRecords);
      setProfileAssignmentHandoverRecords(handoverData.profileAssignmentRecords);
      setMonthlyJobTemplates(monthlyTemplatesData);
      setUsers(usersData);
      setCases(casesData);
      setActivities(activitiesData);
      setMeetingMinutes(meetingMinutesData);
      setAgendaEntries(agendaData);
      setStats(statsData);
      setDbHealth(healthData);
    } catch (err: any) {
      console.error('[App] Gagal memuat data dari database server:', err);
      setConnectionError(
        err.message || 'Data sementara tidak dapat dimuat dari server.'
      );
    } finally {
      setIsRefreshing(false);
    }
  }, [currentUser]);

  const loadSequence = useRef(0);
  const loadTabData = useCallback(async (
    tab: NavTab,
    statsDivision: 'All' | 'Accounting' | 'Tax' = 'All'
  ) => {
    if (!currentUser) return;
    const requestId = ++loadSequence.current;
    setIsRefreshing(true);
    setConnectionError(null);

    try {
      switch (tab) {
        case 'dashboard': {
          const dashboardData = await api.getDashboardData(
            statsDivision === 'All' ? undefined : { division: statsDivision }
          );
          setJobs(dashboardData.jobs);
          setCases(dashboardData.cases);
          setAgendaEntries(dashboardData.agendaEntries);
          setMeetingMinutes(dashboardData.meetingMinutes);
          setStats(dashboardData.stats);
          setDbHealth(dashboardData.health);
          break;
        }
        case 'clients': {
          const [clientsData, casesData, usersData, templatesData] = await Promise.all([
            api.getClients(), api.getCases(), api.getUsers(), api.getMonthlyJobTemplates(),
          ]);
          setClients(clientsData);
          setCases(casesData);
          setUsers(usersData);
          setMonthlyJobTemplates(templatesData);
          break;
        }
        case 'jobs': {
          const [jobsData, clientsData, usersData, templatesData] = await Promise.all([
            api.getJobs(), api.getClients(), api.getUsers(), api.getMonthlyJobTemplates(),
          ]);
          setJobs(jobsData);
          setClients(clientsData);
          setUsers(usersData);
          setMonthlyJobTemplates(templatesData);
          break;
        }
        case 'handover': {
          const [jobsData, clientsData, handoverData] = await Promise.all([
            api.getJobs(), api.getClients(), api.getHandovers(),
          ]);
          setJobs(jobsData);
          setClients(clientsData);
          setHandoverRecords(handoverData.jobRecords);
          setProfileAssignmentHandoverRecords(handoverData.profileAssignmentRecords);
          break;
        }
        case 'cases': {
          const [casesData, clientsData, usersData] = await Promise.all([
            api.getCases(), api.getClients(), api.getUsers(),
          ]);
          setCases(casesData);
          setClients(clientsData);
          setUsers(usersData);
          break;
        }
        case 'followup':
          setCases(await api.getCases());
          break;
        case 'activities': {
          const [activitiesData, clientsData, jobsData, casesData] = await Promise.all([
            api.getDailyActivities(), api.getClients(), api.getJobs(), api.getCases(),
          ]);
          setActivities(activitiesData);
          setClients(clientsData);
          setJobs(jobsData);
          setCases(casesData);
          break;
        }
        case 'mom': {
          const [meetingMinutesData, usersData] = await Promise.all([
            api.getMeetingMinutes(), api.getUsers(),
          ]);
          setMeetingMinutes(meetingMinutesData);
          setUsers(usersData);
          break;
        }
        case 'agenda': {
          const [agendaData, clientsData, jobsData, usersData] = await Promise.all([
            api.getAgendaEntries(), api.getClients(), api.getJobs(), api.getUsers(),
          ]);
          setAgendaEntries(agendaData);
          setClients(clientsData);
          setJobs(jobsData);
          setUsers(usersData);
          break;
        }
        case 'executive-summary': {
          const [clientsData, jobsData, casesData, activitiesData, agendaData, healthData] = await Promise.all([
            api.getClients(), api.getJobs(), api.getCases(), api.getDailyActivities(), api.getAgendaEntries(), api.getHealth(),
          ]);
          setClients(clientsData);
          setJobs(jobsData);
          setCases(casesData);
          setActivities(activitiesData);
          setAgendaEntries(agendaData);
          setDbHealth(healthData);
          break;
        }
        case 'reports': {
          const [clientsData, jobsData, casesData, activitiesData] = await Promise.all([
            api.getClients(), api.getJobs(), api.getCases(), api.getDailyActivities(),
          ]);
          setClients(clientsData);
          setJobs(jobsData);
          setCases(casesData);
          setActivities(activitiesData);
          break;
        }
        default:
          break;
      }
      if (requestId === loadSequence.current) setConnectionError(null);
    } catch (err: any) {
      console.error(`[App] Gagal memuat data halaman ${tab}:`, err);
      if (requestId === loadSequence.current) {
        setConnectionError(err.message || 'Data halaman tidak dapat dimuat dari server.');
      }
    } finally {
      if (requestId === loadSequence.current) setIsRefreshing(false);
    }
  }, [currentUser]);

  useEffect(() => {
    initializeAuthAndBranding();
  }, [initializeAuthAndBranding]);

  useEffect(() => {
    if (currentUser) void loadTabData(currentTab);
  }, [currentUser, currentTab, loadTabData]);

  const handleLoginSuccess = (user: CurrentUser, brandData: BrandingConfig) => {
    setCurrentUser(user);
    if (brandData) setBranding(brandData);
    success('Login Berhasil', `Selamat datang kembali, ${user.name} (${user.role}).`);
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    removeToken();
    setCurrentUser(null);
    setCurrentTab('dashboard');
    success('Logout Berhasil', 'Sesi Anda telah aman ditutup.');
  };

  // Initial loading screen
  if (loadingInitial) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center text-slate-900">
        <div className="w-10 h-10 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mb-4" />
        <h2 className="text-base font-bold tracking-tight">Menghubungkan ke Database...</h2>
        <p className="text-xs text-slate-500 mt-1">TMM/BMA Client Control Center</p>
      </div>
    );
  }

  // Not logged in: Show luxury login view
  if (!currentUser) {
    return <LoginView branding={branding} theme={theme} onToggleTheme={() => setTheme((current) => current === 'light' ? 'dark' : 'light')} onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        currentUser={currentUser}
        branding={branding}
        onLogout={handleLogout}
        dbStatus={dbHealth}
        isOpenMobile={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      {/* Main Viewport */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-72 transition-all">
        {/* Header */}
        <Header
          currentTab={currentTab}
          onToggleMobileSidebar={() => setMobileSidebarOpen((open) => !open)}
          onNavigateToMom={() => setCurrentTab('mom')}
          mobileMenuOpen={mobileSidebarOpen}
          currentUser={currentUser}
          branding={branding}
          onRefreshData={() => currentTab === 'backup' ? loadAllBusinessData() : loadTabData(currentTab)}
          isRefreshing={isRefreshing}
          theme={theme}
          onToggleTheme={() => setTheme((current) => current === 'light' ? 'dark' : 'light')}
        />

        {/* Connection Failure Error Banner (Rule I.4) */}
        {connectionError && (
          <div className="m-4 p-4 rounded-xl bg-rose-50 border border-rose-300 text-rose-900 flex items-center justify-between gap-4 text-xs shadow-sm">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
              <div>
                <p className="font-bold text-sm">Gagal Mengakses Database Server</p>
                <p className="text-slate-700 mt-0.5">{connectionError}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Sistem tidak akan menimpa data yang tersimpan. Harap klik Coba Lagi untuk menyambung kembali.
                </p>
              </div>
            </div>
            <button
              onClick={() => currentTab === 'backup' ? loadAllBusinessData() : loadTabData(currentTab)}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-700 hover:bg-rose-600 text-white rounded-lg font-semibold shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>Coba Lagi</span>
            </button>
          </div>
        )}

        {/* Viewport Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          <Suspense fallback={<div role="status" aria-live="polite" className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">Memuat halaman…</div>}>
          {currentTab === 'dashboard' && (
            <DashboardView
              stats={stats}
              jobs={jobs}
              cases={cases}
              agendaEntries={agendaEntries}
              meetingMinutes={meetingMinutes}
              currentUser={currentUser}
              onNavigateTab={(tab) => setCurrentTab(tab)}
              onRefresh={(division) => loadTabData('dashboard', division)}
              onDivisionChange={async (division) => {
                try {
                  const nextStats = await api.getStats(division === 'All' ? undefined : { division });
                  setStats(nextStats);
                  setConnectionError(null);
                } catch (err: any) {
                  setConnectionError(err.message || 'Metrik dashboard gagal diperbarui.');
                }
              }}
            />
          )}

          {currentTab === 'clients' && (
            <ClientsView
              clients={clients}
              cases={cases}
              users={users}
              monthlyJobTemplates={monthlyJobTemplates}
              currentUser={currentUser}
              onRefresh={() => loadTabData('clients')}
            />
          )}

          {currentTab === 'jobs' && (
            <JobsView
              jobs={jobs}
              clients={clients}
              users={users}
              monthlyJobTemplates={monthlyJobTemplates}
              currentUser={currentUser}
              onRefresh={() => loadTabData('jobs')}
            />
          )}

          {currentTab === 'handover' && (
            <HandoverView
              jobs={jobs}
              clients={clients}
              records={handoverRecords}
              profileAssignmentRecords={profileAssignmentHandoverRecords}
              currentUser={currentUser}
              onRefresh={() => loadTabData('handover')}
            />
          )}

          {currentTab === 'cases' && (
            <CasesView
              cases={cases}
              clients={clients}
              users={users}
              currentUser={currentUser}
              onRefresh={() => loadTabData('cases')}
            />
          )}

          {currentTab === 'followup' && (
            <FollowUpView
              cases={cases}
              currentUser={currentUser}
              onRefresh={() => loadTabData('followup')}
              onOpenCaseDetail={() => setCurrentTab('cases')}
            />
          )}

          {currentTab === 'activities' && (
            <DailyActivitiesView
              activities={activities}
              clients={clients}
              jobs={jobs}
              cases={cases}
              currentUser={currentUser}
              onRefresh={() => loadTabData('activities')}
            />
          )}

          {currentTab === 'mom' && (
            <MeetingMinutesView
              meetings={meetingMinutes}
              users={users}
              currentUser={currentUser}
              companyName={branding.companyName}
              onRefresh={() => loadTabData('mom')}
            />
          )}

          {currentTab === 'agenda' && (
            <TeamAgendaView
              entries={agendaEntries}
              clients={clients}
              jobs={jobs}
              users={users}
              currentUser={currentUser}
              onRefresh={() => loadTabData('agenda')}
            />
          )}

          {currentTab === 'executive-summary' && (
            <ExecutiveSummaryView
              clients={clients}
              jobs={jobs}
              cases={cases}
              activities={activities}
              agendaEntries={agendaEntries}
              currentUser={currentUser}
              lastUpdated={dbHealth?.lastSaved}
              onNavigateTab={(tab) => setCurrentTab(tab)}
            />
          )}

          {currentTab === 'reports' && (
            <ReportsView
              clients={clients}
              jobs={jobs}
              cases={cases}
              activities={activities}
              currentUser={currentUser}
            />
          )}

          {currentTab === 'backup' && currentUser.role === 'Admin' && (
            <BackupRestoreView
              currentUser={currentUser}
              onRefreshAllData={() => loadAllBusinessData()}
            />
          )}

          {currentTab === 'audit' &&
            (currentUser.role === 'Admin' ||
              currentUser.role === 'Owner' ||
              currentUser.role === 'Manager') && (
              <AuditLogView currentUser={currentUser} />
            )}

          {currentTab === 'branding' && currentUser.role === 'Admin' && (
            <BrandingSettingsView
              branding={branding}
              onBrandingUpdated={(newB) => setBranding(newB)}
            />
          )}

          {currentTab === 'users' && currentUser.role === 'Admin' && (
            <UserManagementView currentUser={currentUser} />
          )}
          </Suspense>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <MainApp />
    </ToastProvider>
  );
}
