import { useState } from 'react';
import { CalendarDays, Check, Edit3, Plus, Power, Save, X } from 'lucide-react';
import { api, type JobDivision, type JobPriority, type MonthlyJobTemplate } from '../lib/api';
import { useToast } from './Toast';

interface MonthlyJobTemplatesPanelProps {
  templates: MonthlyJobTemplate[];
  onRefresh: () => void;
}

type TemplateForm = Pick<MonthlyJobTemplate, 'title' | 'division' | 'description' | 'priority' | 'deadlineDay'>;

const emptyForm: TemplateForm = {
  title: '',
  division: 'Accounting',
  description: '',
  priority: 'Sedang',
  deadlineDay: 25,
};

export function MonthlyJobTemplatesPanel({ templates, onRefresh }: MonthlyJobTemplatesPanelProps) {
  const { success, error } = useToast();
  const [form, setForm] = useState<TemplateForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.title.trim()) {
      error('Nama job wajib diisi', 'Tambahkan nama template sebelum menyimpan.');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await api.updateMonthlyJobTemplate(editingId, form);
        success('Template diperbarui', 'Perubahan template job bulanan sudah disimpan.');
      } else {
        await api.createMonthlyJobTemplate(form);
        success('Template ditambahkan', 'Template job bulanan siap ditugaskan dari Master Klien.');
      }
      resetForm();
      onRefresh();
    } catch (cause: any) {
      error('Gagal menyimpan template', cause.message || 'Periksa data lalu coba lagi.');
    } finally {
      setSaving(false);
    }
  };

  const beginEdit = (template: MonthlyJobTemplate) => {
    setEditingId(template.id);
    setForm({
      title: template.title,
      division: template.division,
      description: template.description,
      priority: template.priority,
      deadlineDay: template.deadlineDay,
    });
  };

  const toggleActive = async (template: MonthlyJobTemplate) => {
    try {
      await api.updateMonthlyJobTemplate(template.id, { active: !template.active });
      success(template.active ? 'Template dinonaktifkan' : 'Template diaktifkan', template.active
        ? 'Template tidak lagi tersedia untuk penugasan job rutin baru.'
        : 'Template tersedia kembali di Master Klien.');
      onRefresh();
    } catch (cause: any) {
      error('Gagal memperbarui template', cause.message || 'Coba lagi.');
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="monthly-template-heading">
        <div className="mb-4 flex items-start gap-3 border-b border-slate-100 pb-4">
          <span className="rounded-xl bg-amber-50 p-2.5 text-amber-700"><CalendarDays className="size-4" /></span>
          <div>
            <h2 id="monthly-template-heading" className="text-sm font-semibold text-slate-900">{editingId ? 'Edit template job rutin' : 'Database job bulanan'}</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">Template aktif bisa dipilih SPV dari Master Klien dan dibuat otomatis setiap awal bulan.</p>
          </div>
        </div>
        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label htmlFor="monthly-template-title" className="mb-1 block text-xs font-medium text-slate-700">Nama pekerjaan</label>
            <input id="monthly-template-title" required maxLength={200} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Contoh: Pembukuan bulanan" className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="monthly-template-division" className="mb-1 block text-xs font-medium text-slate-700">Divisi</label>
              <select id="monthly-template-division" value={form.division} onChange={(event) => setForm({ ...form, division: event.target.value as JobDivision })} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900">
                <option value="Accounting">Accounting</option>
                <option value="Tax">Tax</option>
              </select>
            </div>
            <div>
              <label htmlFor="monthly-template-priority" className="mb-1 block text-xs font-medium text-slate-700">Prioritas</label>
              <select id="monthly-template-priority" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as JobPriority })} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900">
                {(['Rendah', 'Sedang', 'Tinggi', 'Mendesak'] as const).map((priority) => <option key={priority} value={priority}>{priority}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="monthly-template-deadline" className="mb-1 block text-xs font-medium text-slate-700">Tanggal deadline</label>
              <input id="monthly-template-deadline" type="number" min={1} max={31} required value={form.deadlineDay} onChange={(event) => setForm({ ...form, deadlineDay: Number(event.target.value) as MonthlyJobTemplate['deadlineDay'] })} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900" />
            </div>
          </div>
          <div>
            <label htmlFor="monthly-template-description" className="mb-1 block text-xs font-medium text-slate-700">Deskripsi / instruksi</label>
            <textarea id="monthly-template-description" rows={3} maxLength={2000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Ruang lingkup atau dokumen yang perlu disiapkan..." className="w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900" />
          </div>
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            {editingId && <button type="button" onClick={resetForm} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700"><X className="size-3.5" /> Batal</button>}
            <button type="submit" disabled={saving} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-60">
              {editingId ? <Save className="size-3.5" /> : <Plus className="size-3.5" />}{saving ? 'Menyimpan…' : editingId ? 'Simpan perubahan' : 'Tambah template'}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-label="Daftar template aktif dan nonaktif">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Template terdaftar</h2>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">{templates.filter((template) => template.active).length} aktif</span>
        </div>
        {templates.length ? <ul className="divide-y divide-slate-100">
          {templates.map((template) => <li key={template.id} className="py-3 first:pt-1 last:pb-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800">{template.title}</p>
                <p className="mt-1 text-xs text-slate-500">{template.division} · {template.priority} · Deadline tanggal {template.deadlineDay}</p>
                {template.description && <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{template.description}</p>}
                <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${template.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{template.active ? 'Aktif' : 'Nonaktif'}</span>
              </div>
              <div className="flex shrink-0 gap-1">
                <button type="button" onClick={() => beginEdit(template)} aria-label={`Edit ${template.title}`} className="inline-flex size-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"><Edit3 className="size-4" /></button>
                <button type="button" onClick={() => toggleActive(template)} aria-label={`${template.active ? 'Nonaktifkan' : 'Aktifkan'} ${template.title}`} className={`inline-flex size-9 items-center justify-center rounded-lg ${template.active ? 'text-emerald-700 hover:bg-emerald-50' : 'text-slate-500 hover:bg-slate-100'}`}>{template.active ? <Check className="size-4" /> : <Power className="size-4" />}</button>
              </div>
            </div>
          </li>)}
        </ul> : <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center">
          <CalendarDays className="mx-auto size-6 text-slate-400" />
          <p className="mt-2 text-xs font-semibold text-slate-700">Belum ada template</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">Tambahkan job rutin yang berlaku untuk klien TMM/BMA.</p>
        </div>}
      </section>
    </div>
  );
}
