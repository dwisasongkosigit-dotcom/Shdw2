import { useMemo, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  MapPin,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  api,
  type AgendaDivision,
  type AgendaStatus,
  type Client,
  type CurrentUser,
  type Job,
  type TeamAgendaEntry,
  type UserAccount,
} from '../lib/api';
import { MeetingParticipantsField, getParticipantSelection } from './MeetingParticipantsField';
import { exportToExcel } from '../lib/exportUtils';
import { useToast } from './Toast';

interface TeamAgendaViewProps {
  entries: TeamAgendaEntry[];
  clients: Client[];
  jobs: Job[];
  users: UserAccount[];
  currentUser: CurrentUser;
  onRefresh: () => void;
}

type AgendaDraft = Omit<TeamAgendaEntry, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'clientName' | 'jobTitle'>;

const divisionOptions: AgendaDivision[] = ['Lintas Divisi', 'Accounting', 'Tax'];
const statusOptions: AgendaStatus[] = ['Terjadwal', 'Selesai', 'Dibatalkan'];
const typeOptions = ['Koordinasi Internal', 'Meeting Klien', 'Review Pekerjaan', 'Rapat Manajemen', 'Lainnya'];
const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-100';

function emptyDraft(): AgendaDraft {
  return {
    title: '',
    date: new Date().toISOString().slice(0, 10),
    startTime: '09:00',
    endTime: '10:00',
    meetingType: 'Koordinasi Internal',
    division: 'Lintas Divisi',
    location: '',
    clientId: '',
    jobId: '',
    participants: [],
    participantUserIds: [],
    externalParticipants: [],
    notes: '',
    status: 'Terjadwal',
  };
}

function dateLabel(value: string, options: Intl.DateTimeFormatOptions = {}) {
  if (!value) return 'Belum dijadwalkan';
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC', ...options }).format(date);
}

function isReadOnly(user: CurrentUser) {
  return user.role === 'Owner' || user.role === 'Manager';
}

function statusStyle(status: AgendaStatus) {
  if (status === 'Selesai') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'Dibatalkan') return 'border-slate-200 bg-slate-100 text-slate-500';
  return 'border-sky-200 bg-sky-50 text-sky-700';
}

export function TeamAgendaView({ entries, clients, jobs, users, currentUser, onRefresh }: TeamAgendaViewProps) {
  const { success, error } = useToast();
  const [query, setQuery] = useState('');
  const [month, setMonth] = useState('');
  const [statusFilter, setStatusFilter] = useState<'Semua' | AgendaStatus>('Semua');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TeamAgendaEntry | null>(null);
  const [draft, setDraft] = useState<AgendaDraft>(emptyDraft);
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<string[]>([]);
  const [externalParticipantNames, setExternalParticipantNames] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`)),
    [entries]
  );
  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return sortedEntries.filter((entry) => {
      if (month && entry.date.slice(0, 7) !== month) return false;
      if (statusFilter !== 'Semua' && entry.status !== statusFilter) return false;
      if (!normalizedQuery) return true;
      return [entry.title, entry.id, entry.meetingType, entry.location, entry.clientName || '', entry.jobTitle || '', ...entry.participants]
        .some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [month, query, sortedEntries, statusFilter]);
  const selectedEntry = entries.find((entry) => entry.id === selectedId) || filteredEntries[0] || sortedEntries[0] || null;
  const upcoming = entries.filter((entry) => entry.status === 'Terjadwal' && entry.date >= today).length;
  const thisMonth = entries.filter((entry) => entry.date.slice(0, 7) === today.slice(0, 7) && entry.status === 'Terjadwal').length;
  const completed = entries.filter((entry) => entry.status === 'Selesai').length;

  const openEditor = (entry?: TeamAgendaEntry) => {
    const selection = entry
      ? getParticipantSelection(entry.participants, entry.participantUserIds, entry.externalParticipants, users)
      : { userIds: [], externalNames: [] };
    const nextDraft: AgendaDraft = entry
      ? {
          title: entry.title,
          date: entry.date,
          startTime: entry.startTime,
          endTime: entry.endTime,
          meetingType: entry.meetingType,
          division: entry.division,
          location: entry.location,
          clientId: entry.clientId || '',
          jobId: entry.jobId || '',
          participants: [...entry.participants],
          participantUserIds: selection.userIds,
          externalParticipants: selection.externalNames,
          notes: entry.notes,
          status: entry.status,
        }
      : emptyDraft();
    setEditingEntry(entry || null);
    setDraft(nextDraft);
    setSelectedParticipantIds(selection.userIds);
    setExternalParticipantNames(selection.externalNames);
    setEditorOpen(true);
  };

  const updateDraft = <K extends keyof AgendaDraft>(key: K, value: AgendaDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const saveEntry = async () => {
    if (!draft.title.trim() || !draft.date) {
      error('Data belum lengkap', 'Judul dan tanggal agenda wajib diisi.');
      return;
    }
    if (draft.startTime && draft.endTime && draft.endTime <= draft.startTime) {
      error('Waktu tidak valid', 'Waktu selesai harus setelah waktu mulai.');
      return;
    }

    setSaving(true);
    const payload: AgendaDraft = {
      ...draft,
      title: draft.title.trim(),
      location: draft.location.trim(),
      clientId: draft.clientId || undefined,
      jobId: draft.jobId || undefined,
      participants: [
        ...users.filter((user) => selectedParticipantIds.includes(user.id)).map((user) => user.name),
        ...externalParticipantNames,
      ].slice(0, 50),
      participantUserIds: selectedParticipantIds,
      externalParticipants: externalParticipantNames,
      notes: draft.notes.trim(),
    };

    try {
      const response = editingEntry
        ? await api.updateAgendaEntry(editingEntry.id, payload)
        : await api.createAgendaEntry(payload);
      setSelectedId(response.agenda.id);
      setEditorOpen(false);
      success(editingEntry ? 'Agenda diperbarui' : 'Agenda tersimpan', 'Perubahan tersimpan ke database bersama.');
      onRefresh();
    } catch (err) {
      error('Gagal menyimpan agenda', err instanceof Error ? err.message : 'Silakan coba kembali.');
    } finally {
      setSaving(false);
    }
  };

  const deleteEntry = async () => {
    if (!selectedEntry || !window.confirm(`Hapus agenda “${selectedEntry.title}”? Tindakan ini tidak dapat dibatalkan.`)) return;
    try {
      await api.deleteAgendaEntry(selectedEntry.id);
      setSelectedId(null);
      success('Agenda dihapus', `${selectedEntry.id} berhasil dihapus.`);
      onRefresh();
    } catch (err) {
      error('Gagal menghapus agenda', err instanceof Error ? err.message : 'Silakan coba kembali.');
    }
  };

  const exportAgenda = async () => {
    if (!filteredEntries.length) {
      error('Tidak ada data untuk diekspor', 'Ubah filter atau tambahkan agenda terlebih dahulu.');
      return;
    }
    setExporting(true);
    try {
      await exportToExcel({
        filename: 'Agenda_Tim_3',
        sheetName: 'Agenda Tim 3',
        title: 'Agenda Meeting Tim 3',
        subtitle: `Diekspor ${new Intl.DateTimeFormat('id-ID', { dateStyle: 'long' }).format(new Date())} · ${filteredEntries.length} agenda`,
        columns: [
          { header: 'ID Agenda', key: 'id', width: 18 },
          { header: 'Tanggal', key: 'date', width: 16 },
          { header: 'Mulai', key: 'startTime', width: 10 },
          { header: 'Selesai', key: 'endTime', width: 10 },
          { header: 'Judul', key: 'title', width: 32 },
          { header: 'Jenis', key: 'meetingType', width: 22 },
          { header: 'Divisi', key: 'division', width: 16 },
          { header: 'Klien', key: 'clientName', width: 30 },
          { header: 'Pekerjaan', key: 'jobTitle', width: 30 },
          { header: 'Lokasi / Link', key: 'location', width: 28 },
          { header: 'Peserta', key: 'participants', width: 38, render: (entry) => entry.participants.join(', ') || '-' },
          { header: 'Catatan', key: 'notes', width: 42 },
          { header: 'Status', key: 'status', width: 16 },
        ],
        data: filteredEntries,
      });
    } catch (err) {
      error('Ekspor belum berhasil', err instanceof Error ? err.message : 'Silakan coba kembali.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 pb-8">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0a1128] via-[#111d39] to-[#1b2a48] px-5 py-6 text-white shadow-lg sm:px-7 sm:py-7">
        <div className="pointer-events-none absolute -right-12 -top-24 size-72 rounded-full border border-amber-300/10" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300">
              <span className="size-1.5 rounded-full bg-amber-300" /> Ruang kerja Tim 3 · Management Office
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Agenda Meeting</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">Jadwal koordinasi tim dan meeting klien—terpisah dari pekerjaan, lengkap dengan peserta, konteks, dan ekspor Excel.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={exportAgenda} disabled={exporting || !filteredEntries.length} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-3.5 py-2.5 text-xs font-semibold text-white transition hover:bg-white/[0.13] disabled:cursor-not-allowed disabled:opacity-50">
              <Download className="size-4" /> {exporting ? 'Menyiapkan…' : 'Ekspor Excel'}
            </button>
            {isReadOnly(currentUser) ? (
              <span className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-3.5 py-2.5 text-xs font-semibold text-slate-200"><ShieldCheck className="size-4 text-amber-300" /> Read-only</span>
            ) : (
              <button type="button" onClick={() => openEditor()} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-amber-500 px-3.5 py-2.5 text-xs font-semibold text-slate-950 transition hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111d39]"><Plus className="size-4" /> Tambah agenda</button>
            )}
          </div>
        </div>
      </section>

      <section aria-label="Ringkasan agenda" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard label="Agenda mendatang" value={upcoming} detail="Belum selesai dan belum dibatalkan" icon={<CalendarDays />} tone="sky" />
        <SummaryCard label="Terjadwal bulan ini" value={thisMonth} detail={new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date())} icon={<Clock3 />} tone="amber" />
        <SummaryCard label="Meeting selesai" value={completed} detail="Seluruh arsip agenda" icon={<CheckCircle2 />} tone="emerald" />
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:p-4">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Cari agenda" placeholder="Cari judul, klien, pekerjaan, atau peserta…" className={`${inputClass} pl-9`} />
        </div>
        <label className="sr-only" htmlFor="agenda-month-filter">Filter bulan agenda</label>
        <input id="agenda-month-filter" type="month" value={month} onChange={(event) => setMonth(event.target.value)} className={`${inputClass} sm:w-auto`} />
        <label className="sr-only" htmlFor="agenda-status-filter">Filter status agenda</label>
        <select id="agenda-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'Semua' | AgendaStatus)} className={`${inputClass} sm:w-auto`}>
          <option value="Semua">Semua status</option>
          {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
      </section>

      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-4 sm:px-5">
            <div><h2 className="text-sm font-semibold text-slate-900">Daftar agenda</h2><p className="mt-0.5 text-[11px] text-slate-500">{filteredEntries.length} agenda ditampilkan</p></div>
            <CalendarDays className="size-4 text-slate-400" />
          </div>
          {filteredEntries.length ? (
            <ul className="divide-y divide-slate-100">
              {filteredEntries.map((entry) => {
                const active = selectedEntry?.id === entry.id;
                return (
                  <li key={entry.id}>
                    <button type="button" aria-current={active ? 'true' : undefined} onClick={() => setSelectedId(entry.id)} className={`flex w-full items-start gap-3 px-4 py-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500 sm:px-5 ${active ? 'bg-amber-50/70' : 'hover:bg-slate-50'}`}>
                      <div className={`flex w-12 shrink-0 flex-col items-center rounded-lg border py-1.5 ${active ? 'border-amber-200 bg-white text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                        <span className="text-[9px] font-semibold uppercase tracking-wider">{dateLabel(entry.date, { month: 'short' }).replace('.', '')}</span>
                        <span className="text-base font-semibold leading-5">{entry.date.slice(8, 10)}</span>
                      </div>
                      <span className="min-w-0 flex-1">
                        <span className="mb-1 flex flex-wrap items-center gap-2"><span className="text-[10px] font-semibold tracking-wide text-slate-400">{entry.id}</span><span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${statusStyle(entry.status)}`}>{entry.status}</span></span>
                        <span className="block line-clamp-2 text-sm font-semibold leading-5 text-slate-800">{entry.title}</span>
                        <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500"><span className="inline-flex items-center gap-1"><Clock3 className="size-3" />{entry.startTime || '—'}{entry.endTime ? `–${entry.endTime}` : ''}</span><span>{entry.meetingType}</span>{entry.clientName && <span className="truncate">{entry.clientName}</span>}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-5 py-14 text-center"><CalendarDays className="mx-auto size-9 text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-700">Belum ada agenda</p><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-slate-500">{entries.length ? 'Coba ubah kata kunci atau filter yang dipilih.' : 'Buat jadwal meeting pertama agar semua orang tahu waktu, peserta, dan konteksnya.'}</p></div>
          )}
        </section>

        <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-live="polite">
          {selectedEntry ? (
            <div>
              <header className="border-b border-slate-100 px-5 py-5 sm:px-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[10px] font-semibold text-slate-400">{selectedEntry.id}</span><span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${statusStyle(selectedEntry.status)}`}>{selectedEntry.status}</span></div><h2 className="mt-2 break-words text-lg font-semibold leading-6 text-slate-900">{selectedEntry.title}</h2></div>
                  {!isReadOnly(currentUser) && <div className="flex shrink-0 gap-1"><button type="button" aria-label="Edit agenda" onClick={() => openEditor(selectedEntry)} className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"><Pencil className="size-4" /></button><button type="button" aria-label="Hapus agenda" onClick={deleteEntry} className="rounded-lg p-2 text-slate-500 transition hover:bg-rose-50 hover:text-rose-600"><Trash2 className="size-4" /></button></div>}
                </div>
              </header>
              <div className="space-y-5 px-5 py-5 sm:px-6">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <DetailItem icon={<CalendarDays />} label="Tanggal" value={dateLabel(selectedEntry.date)} />
                  <DetailItem icon={<Clock3 />} label="Waktu" value={`${selectedEntry.startTime || '—'}${selectedEntry.endTime ? `–${selectedEntry.endTime}` : ''}`} />
                  <DetailItem icon={<Users />} label="Jenis & divisi" value={`${selectedEntry.meetingType} · ${selectedEntry.division}`} />
                  <DetailItem icon={<MapPin />} label="Lokasi / tautan" value={selectedEntry.location || 'Belum ditentukan'} />
                  {selectedEntry.clientName && <DetailItem icon={<Users />} label="Klien terkait" value={selectedEntry.clientName} />}
                  {selectedEntry.jobTitle && <DetailItem icon={<CheckCircle2 />} label="Pekerjaan terkait" value={selectedEntry.jobTitle} />}
                </div>
                <div><h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Peserta</h3><div className="mt-2 flex flex-wrap gap-1.5">{selectedEntry.participants.length ? selectedEntry.participants.map((person) => <span key={person} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700">{person}</span>) : <span className="text-xs text-slate-500">Belum ada peserta dicatat.</span>}</div></div>
                <div><h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Catatan / persiapan</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{selectedEntry.notes || 'Belum ada catatan tambahan.'}</p></div>
                <div className="border-t border-slate-100 pt-3 text-[10px] text-slate-400">Diperbarui {new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(selectedEntry.updatedAt))}</div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[320px] flex-col items-center justify-center px-6 py-12 text-center"><div className="flex size-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-700"><CalendarDays className="size-6" /></div><h2 className="mt-4 text-base font-semibold text-slate-900">Ruang agenda siap digunakan</h2><p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">Pilih agenda dari daftar atau jadwalkan meeting baru untuk tim.</p>{!isReadOnly(currentUser) && <button type="button" onClick={() => openEditor()} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#101b34] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-[#1c2a48]"><Plus className="size-4" /> Buat agenda pertama</button>}</div>
          )}
        </section>
      </div>

      {editorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditorOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="agenda-editor-title" className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:max-h-[calc(100dvh-2.5rem)]">
            <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-[#0d1830] px-5 py-4 text-white sm:px-7">
              <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300">Management Office · Agenda Tim 3</p><h2 id="agenda-editor-title" className="mt-1 text-lg font-semibold">{editingEntry ? 'Perbarui agenda' : 'Jadwalkan meeting'}</h2></div>
              <button type="button" aria-label="Tutup formulir agenda" onClick={() => setEditorOpen(false)} className="rounded-lg p-2 text-slate-300 transition hover:bg-white/10 hover:text-white"><X className="size-4" /></button>
            </header>
            <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Judul meeting" required className="sm:col-span-2"><input autoFocus value={draft.title} onChange={(event) => updateDraft('title', event.target.value)} maxLength={180} placeholder="Contoh: Review bulanan portofolio klien" className={inputClass} /></Field>
                <Field label="Tanggal" required><input type="date" value={draft.date} onChange={(event) => updateDraft('date', event.target.value)} className={inputClass} /></Field>
                <Field label="Jenis meeting"><select value={draft.meetingType} onChange={(event) => updateDraft('meetingType', event.target.value)} className={inputClass}>{typeOptions.map((type) => <option key={type}>{type}</option>)}</select></Field>
                <Field label="Waktu mulai"><input type="time" value={draft.startTime} onChange={(event) => updateDraft('startTime', event.target.value)} className={inputClass} /></Field>
                <Field label="Waktu selesai"><input type="time" value={draft.endTime} onChange={(event) => updateDraft('endTime', event.target.value)} className={inputClass} /></Field>
                <Field label="Divisi"><select value={draft.division} onChange={(event) => updateDraft('division', event.target.value as AgendaDivision)} className={inputClass}>{divisionOptions.map((division) => <option key={division}>{division}</option>)}</select></Field>
                <Field label="Status"><select value={draft.status} onChange={(event) => updateDraft('status', event.target.value as AgendaStatus)} className={inputClass}>{statusOptions.map((status) => <option key={status}>{status}</option>)}</select></Field>
                <Field label="Klien terkait"><select value={draft.clientId || ''} onChange={(event) => setDraft((current) => ({ ...current, clientId: event.target.value, jobId: '' }))} className={inputClass}><option value="">Tidak terkait klien</option>{clients.filter((client) => client.status === 'Aktif').sort((a, b) => a.name.localeCompare(b.name)).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></Field>
                <Field label="Pekerjaan terkait"><select value={draft.jobId || ''} onChange={(event) => updateDraft('jobId', event.target.value)} className={inputClass}><option value="">Tidak terkait pekerjaan</option>{jobs.filter((job) => !draft.clientId || job.clientId === draft.clientId).sort((a, b) => a.title.localeCompare(b.title)).map((job) => <option key={job.id} value={job.id}>{job.id} · {job.title}</option>)}</select></Field>
                <Field label="Lokasi / tautan meeting" className="sm:col-span-2"><input value={draft.location} onChange={(event) => updateDraft('location', event.target.value)} maxLength={180} placeholder="Ruang rapat atau tautan konferensi" className={inputClass} /></Field>
                <MeetingParticipantsField users={users} selectedUserIds={selectedParticipantIds} onSelectedUserIdsChange={setSelectedParticipantIds} externalNames={externalParticipantNames} onExternalNamesChange={setExternalParticipantNames} />
                <Field label="Catatan / persiapan" className="sm:col-span-2"><textarea value={draft.notes} onChange={(event) => updateDraft('notes', event.target.value)} rows={4} maxLength={3000} placeholder="Konteks rapat, bahan yang perlu disiapkan, atau pengingat…" className={`${inputClass} resize-y`} /></Field>
              </div>
            </div>
            <footer className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end sm:px-7">
              <button type="button" onClick={() => setEditorOpen(false)} className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100">Batal</button>
              <button type="button" onClick={saveEntry} disabled={saving} className="rounded-lg bg-amber-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-amber-700 disabled:cursor-wait disabled:opacity-60">{saving ? 'Menyimpan…' : editingEntry ? 'Simpan perubahan' : 'Simpan agenda'}</button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, detail, icon, tone }: { label: string; value: number; detail: string; icon: React.ReactNode; tone: 'sky' | 'amber' | 'emerald' }) {
  const tones = { sky: 'bg-sky-50 text-sky-700', amber: 'bg-amber-50 text-amber-700', emerald: 'bg-emerald-50 text-emerald-700' };
  return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between"><span className="text-xs font-medium text-slate-500">{label}</span><span className={`rounded-lg p-2 ${tones[tone]}`}>{icon}</span></div><p className="mt-3 text-2xl font-semibold tabular-nums text-slate-900">{value}</p><p className="mt-1 text-[11px] text-slate-500">{detail}</p></div>;
}

function DetailItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/70 p-3"><div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400"><span className="text-slate-400">{icon}</span>{label}</div><p className="mt-1.5 break-words text-xs font-medium leading-5 text-slate-800">{value}</p></div>;
}

function Field({ label, required, description, className = '', children }: { label: string; required?: boolean; description?: string; className?: string; children: React.ReactNode }) {
  return <label className={`block min-w-0 ${className}`}><span className="mb-1.5 block text-xs font-semibold text-slate-700">{label}{required && <span className="ml-1 text-rose-600">*</span>}</span>{children}{description && <span className="mt-1 block text-[10px] leading-4 text-slate-500">{description}</span>}</label>;
}
