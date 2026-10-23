import { useState, useRef, useEffect } from 'react';
import { Download, FileSpreadsheet, FileText, Copy, ChevronDown, Check } from 'lucide-react';
import { exportToExcel, exportToCleanCsv, copyTableToClipboard, type ColumnDef } from '../lib/exportUtils';
import { useToast } from './Toast';

interface ExportDropdownProps<T> {
  filename: string;
  sheetName?: string;
  title?: string;
  subtitle?: string;
  columns: ColumnDef<T>[];
  data: T[];
  label?: string;
  className?: string;
}

export function ExportDropdown<T>({
  filename,
  sheetName = 'Rekap Data',
  title,
  subtitle,
  columns,
  data,
  label = 'Ekspor & Copas',
  className = '',
}: ExportDropdownProps<T>) {
  const { success, error } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleExportExcel = async () => {
    if (data.length === 0) {
      error('Data Kosong', 'Tidak ada data untuk diekspor.');
      return;
    }
    setExportingExcel(true);
    try {
      await exportToExcel({
        filename,
        sheetName,
        title: title || `TMM/BMA CONTROL CENTER - ${sheetName.toUpperCase()}`,
        subtitle: subtitle || `Dihasilkan pada: ${new Date().toLocaleString('id-ID')} | Total: ${data.length} baris data`,
        columns,
        data,
      });
      success('Excel Siap', `File ${filename}.xlsx berhasil diunduh dengan tata letak kolom rapi.`);
      setIsOpen(false);
    } catch (err: any) {
      error('Gagal Ekspor Excel', err.message);
    } finally {
      setExportingExcel(false);
    }
  };

  const handleExportCsv = () => {
    if (data.length === 0) {
      error('Data Kosong', 'Tidak ada data untuk diekspor.');
      return;
    }
    try {
      exportToCleanCsv({
        filename,
        columns,
        data,
      });
      success('CSV Siap', `File ${filename}.csv dengan format kolom rapi (Excel Ready) berhasil diunduh.`);
      setIsOpen(false);
    } catch (err: any) {
      error('Gagal Ekspor CSV', err.message);
    }
  };

  const handleCopyClipboard = async () => {
    if (data.length === 0) {
      error('Data Kosong', 'Tidak ada data untuk disalin.');
      return;
    }
    try {
      const count = await copyTableToClipboard({ columns, data });
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      success(
        'Berhasil Disalin!',
        `${count} baris data berhasil disalin ke clipboard dalam format kolom. Silakan buka Excel atau Google Sheets lalu tekan Ctrl+V (Paste).`
      );
      setIsOpen(false);
    } catch (err: any) {
      error('Gagal Menyalin', err.message);
    }
  };

  return (
    <div className={`relative inline-block text-left ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-amber-500/50"
      >
        <Download className="w-3.5 h-3.5 text-amber-400" />
        <span>{label}</span>
        <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1.5 w-72 bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
              Pilihan Format Ekspor
            </span>
            <span className="text-[10px] font-mono text-slate-400">{data.length} Baris</span>
          </div>

          <div className="p-1.5 space-y-1 text-xs">
            {/* 1. Unduh Excel (.xlsx) */}
            <button
              onClick={handleExportExcel}
              disabled={exportingExcel}
              className="w-full flex items-start gap-2.5 p-2 rounded-lg hover:bg-emerald-50 text-left transition-colors group"
            >
              <div className="p-1.5 bg-emerald-100 text-emerald-700 rounded-md shrink-0 mt-0.5 group-hover:bg-emerald-200">
                <FileSpreadsheet className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-slate-900 group-hover:text-emerald-900 flex items-center gap-1">
                  <span>Unduh Excel (.xlsx)</span>
                  <span className="text-[9px] px-1 py-0.2 bg-emerald-100 text-emerald-800 rounded font-semibold">Elegan</span>
                </p>
                <p className="text-[11px] text-slate-500 line-clamp-1">
                  Format tabel siap presentasi, kolom pas & bergaris rapi
                </p>
              </div>
            </button>

            {/* 2. Salin Tabel (Copas ke Excel) */}
            <button
              onClick={handleCopyClipboard}
              className="w-full flex items-start gap-2.5 p-2 rounded-lg hover:bg-amber-50 text-left transition-colors group"
            >
              <div className="p-1.5 bg-amber-100 text-amber-700 rounded-md shrink-0 mt-0.5 group-hover:bg-amber-200">
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              </div>
              <div className="min-w-0">
                <p className="font-bold text-slate-900 group-hover:text-amber-900 flex items-center gap-1">
                  <span>Salin Tabel (Tinggal Copas)</span>
                  <span className="text-[9px] px-1 py-0.2 bg-amber-100 text-amber-800 rounded font-semibold">Praktis</span>
                </p>
                <p className="text-[11px] text-slate-500 line-clamp-1">
                  Tinggal Ctrl+V di Excel/Spreadsheet langsung jadi kolom
                </p>
              </div>
            </button>

            {/* 3. Unduh CSV (Excel-Ready) */}
            <button
              onClick={handleExportCsv}
              className="w-full flex items-start gap-2.5 p-2 rounded-lg hover:bg-slate-100 text-left transition-colors group"
            >
              <div className="p-1.5 bg-slate-100 text-slate-600 rounded-md shrink-0 mt-0.5 group-hover:bg-slate-200">
                <FileText className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-slate-900 group-hover:text-slate-900 flex items-center gap-1">
                  <span>Unduh CSV (Excel Ready)</span>
                </p>
                <p className="text-[11px] text-slate-500 line-clamp-1">
                  Dengan UTF-8 BOM otomatis terpisah kolom di Excel
                </p>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
