import { useMemo, useState } from 'react';
import {
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Download,
  FileText,
  MapPin,
  Plus,
  Printer,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  api,
  type CurrentUser,
  type MeetingActionItem,
  type MeetingAgendaItem,
  type MeetingMinute,
} from '../lib/api';
import { useToast } from './Toast';
import { downloadMeetingMinuteWord, printMeetingMinutePdf } from '../lib/meetingExport';

interface MeetingMinutesViewProps {
  meetings: MeetingMinute[];
  currentUser: CurrentUser;
  companyName: string;
  onRefresh: () => void;
}

type MeetingDraft = Omit<MeetingMinute, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>;

const actionStatuses: MeetingActionItem['status'][] = ['Belum Dimulai', 'Dalam Proses', 'Selesai'];
const meetingTypes = ['Rapat Manajemen', 'Tinjauan Operasional', 'Koordinasi Internal', 'Lainnya'];

function newItemId() {
  return globalThis.crypto?.randomUUID?.() || `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createDraft(meeting?: MeetingMinute): MeetingDraft {
  if (meeting) {
    return {
      title: meeting.title,
      meetingDate: meeting.meetingDate,
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      meetingType: meeting.meetingType,
      location: meeting.location,
      chairperson: meeting.chairperson,
      recorder: meeting.recorder,
      attendees: [...meeting.attendees],
      agendaItems: meeting.agendaItems.map((item) => ({ ...item })),
      actionItems: meeting.actionItems.map((item) => ({ ...item })),
      nextMeetingDate: meeting.nextMeetingDate,
    };
  }

  return {
    title: '',
    meetingDate: new Date().toISOString().slice(0, 10),
    startTime: '09:00',
    endTime: '10:00',
    meetingType: 'Rapat Manajemen',
    location: '',
    chairperson: '',
    recorder: '',
    attendees: [],
    agendaItems: [{ id: newItemId(), topic: '', discussion: '', decision: '' }],
    actionItems: [],
    nextMeetingDate: '',
  };
}

function formatDate(value: string, options: Intl.DateTimeFormatOptions = {}) {
  if (!value) return 'Belum dijadwalkan';
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC', ...options }).format(date);
}

function formatShortDate(value: string) {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function isReadOnly(user: CurrentUser) {
  return user.role === 'Owner' || user.role === 'Manager';
}

export function MeetingMinutesView({ meetings, currentUser, companyName, onRefresh }: MeetingMinutesViewProps) {
  const { success, error } = useToast();
  const [query, setQuery] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<MeetingMinute | null>(null);
  const [draft, setDraft] = useState<MeetingDraft>(() => createDraft());
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<'word' | 'pdf' | null>(null);

  const sortedMeetings = useMemo(
    () => [...meetings].sort((a, b) => `${b.meetingDate}${b.startTime}`.localeCompare(`${a.meetingDate}${a.startTime}`)),
    [meetings]
  );
  const filteredMeetings = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return sortedMeetings.filter((meeting) => {
      if (dateFilter && meeting.meetingDate.slice(0, 7) !== dateFilter) return false;
      if (!normalizedQuery) return true;
      return [meeting.title, meeting.id, meeting.location, meeting.chairperson, ...meeting.attendees]
        .some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [dateFilter, query, sortedMeetings]);

  const selectedMeeting = meetings.find((meeting) => meeting.id === selectedId) || filteredMeetings[0] || sortedMeetings[0] || null;
  const actionSummary = useMemo(() => {
    const actions = meetings.flatMap((meeting) => meeting.actionItems);
    return {
      total: actions.length,
      open: actions.filter((action) => action.status !== 'Selesai').length,
      completed: actions.filter((action) => action.status === 'Selesai').length,
    };
  }, [meetings]);

  const openEditor = (meeting?: MeetingMinute) => {
    setEditingMeeting(meeting || null);
    setDraft(createDraft(meeting));
    setEditorOpen(true);
  };

  const updateDraft = <K extends keyof MeetingDraft>(key: K, value: MeetingDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const updateAgenda = (id: string, key: keyof MeetingAgendaItem, value: string) => {
    updateDraft('agendaItems', draft.agendaItems.map((item) => item.id === id ? { ...item, [key]: value } : item));
  };

  const updateAction = (id: string, key: keyof MeetingActionItem, value: string) => {
    updateDraft('actionItems', draft.actionItems.map((item) => item.id === id ? { ...item, [key]: value } : item));
  };

  const saveMeeting = async () => {
    const agendaItems = draft.agendaItems.filter((item) => item.topic.trim());
    if (!draft.title.trim() || !draft.meetingDate) {
      error('Data belum lengkap', 'Judul dan tanggal rapat wajib diisi.');
      return;
    }
    if (!agendaItems.length) {
      error('Agenda diperlukan', 'Tambahkan minimal satu topik pembahasan sebelum menyimpan MoM.');
      return;
    }

    setSaving(true);
    const payload: MeetingDraft = {
      ...draft,
      title: draft.title.trim(),
      attendees: draft.attendees.map((name) => name.trim()).filter(Boolean),
      agendaItems,
      actionItems: draft.actionItems.filter((item) => item.description.trim()).map((item) => ({
        ...item,
        description: item.description.trim(),
        owner: item.owner.trim(),
      })),
    };

    try {
      const response = editingMeeting
        ? await api.updateMeetingMinute(editingMeeting.id, payload)
        : await api.createMeetingMinute(payload);
      setSelectedId(response.meeting.id);
      setEditorOpen(false);
      success(editingMeeting ? 'MoM diperbarui' : 'MoM tersimpan', 'Catatan rapat berhasil disimpan ke database.');
      onRefresh();
    } catch (err) {
      error('Gagal menyimpan MoM', err instanceof Error ? err.message : 'Silakan coba kembali.');
    } finally {
      setSaving(false);
    }
  };

  const deleteMeeting = async () => {
    if (!selectedMeeting || !window.confirm(`Hapus notulen ${selectedMeeting.id}? Tindakan ini tidak dapat dibatalkan.`)) return;
    try {
      await api.deleteMeetingMinute(selectedMeeting.id);
      setSelectedId(null);
      success('Notulen dihapus', `${selectedMeeting.id} berhasil dihapus dari arsip.`);
      onRefresh();
    } catch (err) {
      error('Gagal menghapus notulen', err instanceof Error ? err.message : 'Silakan coba kembali.');
    }
  };

  const exportMeeting = async (format: 'word' | 'pdf') => {
    if (!selectedMeeting) return;
    setExporting(format);
    try {
      if (format === 'word') {
        await downloadMeetingMinuteWord(selectedMeeting, companyName);
      } else {
        printMeetingMinutePdf(selectedMeeting, companyName);
      }
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
        <div className="pointer-events-none absolute -right-2 -top-14 size-52 rounded-full border border-amber-300/10" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300">
              <span className="size-1.5 rounded-full bg-amber-300" />
              <span>{companyName || 'TMM & BMA Advisory'} · Management Office</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Minutes of Meeting</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
              Catatan rapat resmi, keputusan, dan tindak lanjut dalam satu ruang kerja yang siap dibagikan kepada manajemen.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3.5 py-2.5 text-xs text-slate-200 backdrop-blur">
            <ShieldCheck className="size-4 text-amber-300" />
            Tersimpan di database bersama
          </div>
        </div>
      </section>

      <section aria-label="Ringkasan notulen" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard label="Total rapat" value={meetings.length} icon={<CalendarDays />} detail="Seluruh notulen tersimpan" />
        <SummaryCard label="Tindak lanjut terbuka" value={actionSummary.open} icon={<Clock3 />} detail={`${actionSummary.total} butir tindak lanjut`} accent={actionSummary.open > 0} />
        <SummaryCard label="Tindak lanjut selesai" value={actionSummary.completed} icon={<Check />} detail="Keputusan yang telah dijalankan" />
      </section>

      <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative min-w-0 flex-1 sm:max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Cari notulen rapat"
            placeholder="Cari judul, ID, lokasi, atau peserta..."
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-800 shadow-sm outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="mom-month-filter">Filter bulan rapat</label>
          <input
            id="mom-month-filter"
            type="month"
            value={dateFilter}
            onChange={(event) => setDateFilter(event.target.value)}
            className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-700 shadow-sm outline-none focus:border-amber-500"
          />
          {isReadOnly(currentUser) ? (
            <span className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-600">
              <ShieldCheck className="size-4 text-amber-600" /> Read-only
            </span>
          ) : (
            <button
              type="button"
              onClick={() => openEditor()}
              className="flex shrink-0 items-center gap-2 rounded-xl bg-amber-600 px-3.5 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
            >
              <Plus className="size-4" /> Buat MoM
            </button>
          )}
        </div>
      </section>

      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[310px_minmax(0,1fr)]">
        <aside className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Arsip rapat</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">{filteredMeetings.length} notulen ditampilkan</p>
            </div>
            <FileText className="size-4 text-slate-400" />
          </div>
          {filteredMeetings.length ? (
            <ul className="max-h-[540px] divide-y divide-slate-100 overflow-y-auto">
              {filteredMeetings.map((meeting) => {
                const active = selectedMeeting?.id === meeting.id;
                return (
                  <li key={meeting.id}>
                    <button
                      type="button"
                      aria-current={active ? 'true' : undefined}
                      onClick={() => setSelectedId(meeting.id)}
                      className={`group flex w-full items-start gap-3 px-4 py-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500 ${active ? 'bg-amber-50/70' : 'hover:bg-slate-50'}`}
                    >
                      <div className={`flex w-12 shrink-0 flex-col items-center rounded-lg border py-1.5 ${active ? 'border-amber-200 bg-white text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                        <span className="text-[9px] font-semibold uppercase tracking-wider">{formatShortDate(meeting.meetingDate).split(' ')[1]?.replace('.', '') || '—'}</span>
                        <span className="text-base font-semibold leading-5">{meeting.meetingDate.slice(8, 10)}</span>
                      </div>
                      <span className="min-w-0 flex-1">
                        <span className="mb-1 block truncate text-[10px] font-semibold tracking-wide text-slate-400">{meeting.id}</span>
                        <span className="block line-clamp-2 text-sm font-semibold leading-5 text-slate-800">{meeting.title}</span>
                        <span className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-500">
                          <Clock3 className="size-3 shrink-0" /> {meeting.startTime || '—'}{meeting.endTime ? `–${meeting.endTime}` : ''}
                        </span>
                      </span>
                      <ChevronRight className={`mt-5 size-4 shrink-0 ${active ? 'text-amber-600' : 'text-slate-300 group-hover:text-slate-500'}`} />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-5 py-12 text-center">
              <CalendarDays className="mx-auto size-8 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-700">Belum ada notulen</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{meetings.length ? 'Coba ubah kata kunci atau filter bulan.' : 'Catat rapat pertama untuk mulai membangun arsip keputusan.'}</p>
            </div>
          )}
        </aside>

        <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-live="polite">
          {selectedMeeting ? (
            <MeetingDetail
              meeting={selectedMeeting}
              companyName={companyName}
              canEdit={!isReadOnly(currentUser)}
              exporting={exporting}
              onEdit={() => openEditor(selectedMeeting)}
              onDelete={deleteMeeting}
              onExport={exportMeeting}
            />
          ) : (
            <div className="flex min-h-[340px] flex-col items-center justify-center px-6 py-12 text-center">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-700"><FileText className="size-6" /></div>
              <h2 className="mt-4 text-base font-semibold text-slate-900">Ruang notulen siap digunakan</h2>
              <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">Pilih notulen dari arsip atau buat catatan rapat baru beserta keputusan dan pemilik tindak lanjutnya.</p>
              {!isReadOnly(currentUser) && (
                <button type="button" onClick={() => openEditor()} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#101b34] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-[#1c2a48]">
                  <Plus className="size-4" /> Buat notulen pertama
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      {editorOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditorOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="mom-editor-title" className="flex max-h-[94dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-[#0d1830] px-5 py-4 text-white sm:px-7">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300">Management Office · Catatan resmi</p>
                <h2 id="mom-editor-title" className="mt-1 text-lg font-semibold">{editingMeeting ? 'Perbarui notulen rapat' : 'Buat notulen rapat'}</h2>
              </div>
              <button type="button" aria-label="Tutup formulir" onClick={() => setEditorOpen(false)} className="rounded-lg p-2 text-slate-300 transition hover:bg-white/10 hover:text-white"><X className="size-4" /></button>
            </header>
            <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
              <div className="flex flex-col gap-7">
                <EditorSection number="01" title="Informasi rapat" description="Identitas dan penyelenggaraan rapat.">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Judul rapat" required className="sm:col-span-2"><input autoFocus value={draft.title} onChange={(event) => updateDraft('title', event.target.value)} maxLength={180} placeholder="Contoh: Management Review · Oktober 2026" className={inputClass} /></Field>
                    <Field label="Jenis rapat"><select value={draft.meetingType} onChange={(event) => updateDraft('meetingType', event.target.value)} className={inputClass}>{meetingTypes.map((type) => <option key={type}>{type}</option>)}</select></Field>
                    <Field label="Tanggal rapat" required><input type="date" value={draft.meetingDate} onChange={(event) => updateDraft('meetingDate', event.target.value)} className={inputClass} /></Field>
                    <Field label="Waktu mulai"><input type="time" value={draft.startTime} onChange={(event) => updateDraft('startTime', event.target.value)} className={inputClass} /></Field>
                    <Field label="Waktu selesai"><input type="time" value={draft.endTime} onChange={(event) => updateDraft('endTime', event.target.value)} className={inputClass} /></Field>
                    <Field label="Lokasi / tautan rapat"><input value={draft.location} onChange={(event) => updateDraft('location', event.target.value)} maxLength={180} placeholder="Ruang rapat / tautan konferensi" className={inputClass} /></Field>
                    <Field label="Rapat berikutnya"><input type="date" value={draft.nextMeetingDate} onChange={(event) => updateDraft('nextMeetingDate', event.target.value)} className={inputClass} /></Field>
                    <Field label="Pimpinan rapat"><input value={draft.chairperson} onChange={(event) => updateDraft('chairperson', event.target.value)} maxLength={120} placeholder="Nama pimpinan rapat" className={inputClass} /></Field>
                    <Field label="Notulis"><input value={draft.recorder} onChange={(event) => updateDraft('recorder', event.target.value)} maxLength={120} placeholder="Nama pencatat" className={inputClass} /></Field>
                    <Field label="Peserta rapat" hint="Satu nama per baris." className="sm:col-span-2"><textarea rows={3} value={draft.attendees.join('\n')} onChange={(event) => updateDraft('attendees', event.target.value.split('\n'))} maxLength={2400} placeholder={'Nama peserta 1\nNama peserta 2'} className={`${inputClass} resize-y`} /></Field>
                  </div>
                </EditorSection>

                <EditorSection number="02" title="Agenda & keputusan" description="Catat inti pembahasan dan keputusan yang disepakati bersama.">
                  <div className="flex flex-col gap-3">
                    {draft.agendaItems.map((item, index) => (
                      <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <p className="text-xs font-semibold text-slate-700">Agenda {String(index + 1).padStart(2, '0')}</p>
                          <button type="button" onClick={() => updateDraft('agendaItems', draft.agendaItems.filter((entry) => entry.id !== item.id))} aria-label={`Hapus agenda ${index + 1}`} className="rounded-md p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"><X className="size-4" /></button>
                        </div>
                        <div className="flex flex-col gap-3">
                          <Field label="Topik"><input value={item.topic} onChange={(event) => updateAgenda(item.id, 'topic', event.target.value)} maxLength={180} placeholder="Topik yang dibahas" className={inputClass} /></Field>
                          <Field label="Pembahasan"><textarea rows={3} value={item.discussion} onChange={(event) => updateAgenda(item.id, 'discussion', event.target.value)} maxLength={3000} placeholder="Ringkas poin penting, konteks, dan masukan peserta..." className={`${inputClass} resize-y`} /></Field>
                          <Field label="Keputusan"><textarea rows={2} value={item.decision} onChange={(event) => updateAgenda(item.id, 'decision', event.target.value)} maxLength={2000} placeholder="Keputusan atau kesimpulan yang disepakati..." className={`${inputClass} resize-y`} /></Field>
                        </div>
                      </div>
                    ))}
                    <button type="button" onClick={() => updateDraft('agendaItems', [...draft.agendaItems, { id: newItemId(), topic: '', discussion: '', decision: '' }])} className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-amber-400 hover:bg-amber-50 hover:text-amber-800"><Plus className="size-3.5" /> Tambah agenda</button>
                  </div>
                </EditorSection>

                <EditorSection number="03" title="Tindak lanjut" description="Tetapkan pemilik dan tenggat agar setiap keputusan dapat dipantau.">
                  <div className="flex flex-col gap-3">
                    {draft.actionItems.map((item, index) => (
                      <div key={item.id} className="grid grid-cols-1 items-end gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(130px,0.7fr)_145px_155px_auto]">
                        <Field label={`Tindak lanjut ${String(index + 1).padStart(2, '0')}`}><input value={item.description} onChange={(event) => updateAction(item.id, 'description', event.target.value)} maxLength={300} placeholder="Uraian tindakan" className={inputClass} /></Field>
                        <Field label="Penanggung jawab"><input value={item.owner} onChange={(event) => updateAction(item.id, 'owner', event.target.value)} maxLength={120} placeholder="Nama PIC" className={inputClass} /></Field>
                        <Field label="Tenggat"><input type="date" value={item.deadline} onChange={(event) => updateAction(item.id, 'deadline', event.target.value)} className={inputClass} /></Field>
                        <Field label="Status"><select value={item.status} onChange={(event) => updateAction(item.id, 'status', event.target.value)} className={inputClass}>{actionStatuses.map((status) => <option key={status}>{status}</option>)}</select></Field>
                        <button type="button" onClick={() => updateDraft('actionItems', draft.actionItems.filter((entry) => entry.id !== item.id))} aria-label={`Hapus tindak lanjut ${index + 1}`} className="mb-0.5 rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"><X className="size-4" /></button>
                      </div>
                    ))}
                    <button type="button" onClick={() => updateDraft('actionItems', [...draft.actionItems, { id: newItemId(), description: '', owner: '', deadline: '', status: 'Belum Dimulai' }])} className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-amber-400 hover:bg-amber-50 hover:text-amber-800"><Plus className="size-3.5" /> Tambah tindak lanjut</button>
                  </div>
                </EditorSection>
              </div>
            </div>
            <footer className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3.5 sm:px-7">
              <p className="hidden text-[11px] text-slate-500 sm:block">Notulen dapat diekspor sebagai Word atau PDF.</p>
              <div className="ml-auto flex items-center gap-2">
                <button type="button" onClick={() => setEditorOpen(false)} className="rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100">Batal</button>
                <button type="button" onClick={saveMeeting} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60">
                  <Check className="size-4" /> {saving ? 'Menyimpan...' : editingMeeting ? 'Simpan perubahan' : 'Simpan MoM'}
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, icon, detail, accent = false }: { label: string; value: number; icon: React.ReactNode; detail: string; accent?: boolean }) {
  return (
    <article className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm">
      <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${accent ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-slate-500">{label}</p>
        <p className="mt-0.5 flex items-baseline gap-2"><span className="text-xl font-semibold tabular-nums text-slate-900">{value}</span><span className="truncate text-[10px] text-slate-400">{detail}</span></p>
      </div>
    </article>
  );
}

function Field({ label, required = false, hint, className = '', children }: { label: string; required?: boolean; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <span className="text-xs font-semibold text-slate-700">{label}{required && <span className="ml-1 text-amber-700" aria-hidden="true">*</span>}</span>
      {children}
      {hint && <span className="text-[10px] text-slate-500">{hint}</span>}
    </label>
  );
}

const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-100';

function EditorSection({ number, title, description, children }: { number: string; title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start gap-3 border-b border-slate-100 pb-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-[11px] font-bold text-amber-800">{number}</span>
        <div><h3 className="text-sm font-semibold text-slate-900">{title}</h3><p className="mt-0.5 text-xs text-slate-500">{description}</p></div>
      </div>
      {children}
    </section>
  );
}

function MeetingDetail({ meeting, companyName, canEdit, exporting, onEdit, onDelete, onExport }: {
  meeting: MeetingMinute;
  companyName: string;
  canEdit: boolean;
  exporting: 'word' | 'pdf' | null;
  onEdit: () => void;
  onDelete: () => void;
  onExport: (format: 'word' | 'pdf') => void;
}) {
  const completedActions = meeting.actionItems.filter((item) => item.status === 'Selesai').length;

  return (
    <article>
      <header className="border-b border-slate-200 bg-gradient-to-b from-white to-slate-50/70 px-5 py-5 sm:px-7">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-[#101b34] px-2 py-1 font-mono text-[10px] font-semibold tracking-wide text-white">{meeting.id}</span>
          <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800">{meeting.meetingType}</span>
          <span className="text-[11px] text-slate-500">{formatDate(meeting.meetingDate)}</span>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{companyName || 'TMM & BMA Advisory'}</p>
            <h2 className="mt-1.5 break-words text-xl font-semibold leading-7 tracking-tight text-slate-900 sm:text-2xl">{meeting.title}</h2>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5 text-slate-400" />{meeting.startTime || '—'}{meeting.endTime ? `–${meeting.endTime}` : ''}</span>
              {meeting.location && <span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5 text-slate-400" /><span className="break-all">{meeting.location}</span></span>}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button type="button" onClick={() => onExport('word')} disabled={exporting !== null} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-amber-300 hover:bg-amber-50 disabled:opacity-60">
              <Download className="size-3.5" /> {exporting === 'word' ? 'Menyiapkan...' : 'Word'}
            </button>
            <button type="button" onClick={() => onExport('pdf')} disabled={exporting !== null} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-amber-300 hover:bg-amber-50 disabled:opacity-60">
              <Printer className="size-3.5" /> {exporting === 'pdf' ? 'Membuka...' : 'PDF'}
            </button>
            {canEdit && <button type="button" onClick={onEdit} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-amber-700"><FileText className="size-3.5" /> Edit</button>}
            {canEdit && <button type="button" onClick={onDelete} aria-label="Hapus notulen" className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"><Trash2 className="size-3.5" /> Hapus</button>}
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-6 px-5 py-5 sm:px-7 sm:py-6">
        <section aria-label="Informasi peserta" className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
          <DetailItem label="Pimpinan rapat" value={meeting.chairperson || 'Belum dicatat'} />
          <DetailItem label="Notulis" value={meeting.recorder || 'Belum dicatat'} />
          <div className="sm:col-span-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Peserta ({meeting.attendees.length})</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {meeting.attendees.length ? meeting.attendees.map((attendee, index) => <span key={`${attendee}-${index}`} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700"><Users className="size-3 text-slate-400" />{attendee}</span>) : <span className="text-xs text-slate-500">Belum ada peserta dicatat.</span>}
            </div>
          </div>
        </section>

        <section>
          <SectionHeading eyebrow="01 · Rangkaian rapat" title="Agenda & keputusan" detail={`${meeting.agendaItems.length} topik tercatat`} />
          {meeting.agendaItems.length ? (
            <ol className="mt-4 flex flex-col gap-3">
              {meeting.agendaItems.map((item, index) => (
                <li key={item.id} className="relative rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                  <div className="flex items-start gap-3">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 font-mono text-[10px] font-semibold text-slate-600">{String(index + 1).padStart(2, '0')}</span>
                    <div className="min-w-0 flex-1">
                      <h3 className="break-words text-sm font-semibold text-slate-900">{item.topic}</h3>
                      {item.discussion && <div className="mt-2.5"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Ringkasan pembahasan</p><p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-slate-600">{item.discussion}</p></div>}
                      {item.decision && <div className="mt-3 rounded-lg border-l-2 border-amber-500 bg-amber-50/70 px-3 py-2.5"><p className="text-[10px] font-semibold uppercase tracking-wide text-amber-900">Keputusan</p><p className="mt-1 whitespace-pre-wrap break-words text-xs font-medium leading-5 text-slate-700">{item.decision}</p></div>}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          ) : <p className="mt-3 rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">Belum ada topik agenda yang dicatat.</p>}
        </section>

        <section>
          <SectionHeading eyebrow="02 · Akuntabilitas" title="Tindak lanjut" detail={`${completedActions} dari ${meeting.actionItems.length} selesai`} />
          {meeting.actionItems.length ? (
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="divide-y divide-slate-100">
                {meeting.actionItems.map((item, index) => (
                  <div key={item.id} className="flex flex-col gap-2.5 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100 font-mono text-[9px] font-semibold text-slate-500">{String(index + 1).padStart(2, '0')}</span>
                      <div className="min-w-0"><p className="break-words text-xs font-semibold leading-5 text-slate-800">{item.description}</p><p className="mt-0.5 text-[11px] text-slate-500">PIC: <span className="font-medium text-slate-700">{item.owner || 'Belum ditentukan'}</span>{item.deadline && <span> · Tenggat {formatShortDate(item.deadline)}</span>}</p></div>
                    </div>
                    <span className={`inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${item.status === 'Selesai' ? 'bg-emerald-50 text-emerald-800' : item.status === 'Dalam Proses' ? 'bg-sky-50 text-sky-800' : 'bg-slate-100 text-slate-600'}`}><span className={`size-1.5 rounded-full ${item.status === 'Selesai' ? 'bg-emerald-500' : item.status === 'Dalam Proses' ? 'bg-sky-500' : 'bg-slate-400'}`} />{item.status}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <p className="mt-3 rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">Tidak ada tindak lanjut khusus yang ditetapkan.</p>}
        </section>

        <footer className="flex flex-col gap-2 border-t border-slate-100 pt-4 text-[10px] text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <span>MoM {meeting.id} · Dokumen internal {companyName || 'TMM & BMA Advisory'}</span>
          <span>{meeting.nextMeetingDate ? `Rapat berikutnya · ${formatDate(meeting.nextMeetingDate)}` : 'Rapat berikutnya belum dijadwalkan'}</span>
        </footer>
      </div>
    </article>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 break-words text-xs font-medium text-slate-700">{value}</p></div>;
}

function SectionHeading({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return <div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-[9px] font-bold uppercase tracking-[0.16em] text-amber-700">{eyebrow}</p><h3 className="mt-1 text-base font-semibold text-slate-900">{title}</h3></div><span className="text-[10px] text-slate-400">{detail}</span></div>;
}
