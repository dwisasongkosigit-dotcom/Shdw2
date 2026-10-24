import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface ClientPicWorkloadItem {
  id: string;
  name: string;
  role: string;
  totalClients: number;
  accountingClients: number;
  taxClients: number;
}

interface ClientPicWorkloadChartProps {
  data: ClientPicWorkloadItem[];
  dataType: 'Real' | 'Simulasi' | 'Semua';
}

export function ClientPicWorkloadChart({ data, dataType }: ClientPicWorkloadChartProps) {
  const sortedData = [...data].sort((a, b) => b.totalClients - a.totalClients || a.name.localeCompare(b.name));
  const chartHeight = Math.max(180, sortedData.length * 36);
  const highestWorkload = sortedData[0]?.totalClients ?? 0;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="pic-workload-heading">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 id="pic-workload-heading" className="text-sm font-semibold text-slate-900">Perbandingan beban PIC utama</h3>
          <p className="mt-1 text-xs text-slate-500">
            Klien aktif {dataType === 'Semua' ? 'semua tipe data' : dataType.toLowerCase()}; total menghitung klien unik.
          </p>
        </div>
        <p className="text-[11px] text-slate-500">Rincian Accounting dan Tax bisa mencakup klien yang sama.</p>
      </div>

      {sortedData.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-xs text-slate-500">
          Belum ada PIC aktif untuk dibandingkan.
        </div>
      ) : highestWorkload === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-xs text-slate-500">
          Belum ada klien aktif pada tipe data ini.
        </div>
      ) : (
        <div className="max-h-80 overflow-y-auto" role="img" aria-label={`Perbandingan klien unik per PIC utama: ${sortedData.map((item) => `${item.name}, ${item.totalClients} klien`).join('; ')}`}>
          <div style={{ height: chartHeight, minWidth: 340 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sortedData} layout="vertical" margin={{ top: 4, right: 28, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} vertical stroke="#e2e8f0" />
                <XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 10 }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={138}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#334155', fontSize: 10 }}
                  tickFormatter={(value: string) => value.length > 22 ? `${value.slice(0, 20)}…` : value}
                />
                <Tooltip
                  cursor={{ fill: '#f8fafc' }}
                  contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 12 }}
                  formatter={(value, _name, item) => [
                    `${value ?? 0} klien unik · Accounting ${item.payload.accountingClients} · Tax ${item.payload.taxClients}`,
                    'PIC utama',
                  ]}
                  labelFormatter={(label, items) => `${label} · ${items[0]?.payload.role ?? ''}`}
                />
                <Bar dataKey="totalClients" name="Klien unik" fill="#c8872e" radius={[0, 6, 6, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-100 pt-3" aria-label="Rincian klien per PIC">
        {sortedData.map((item) => (
          <span key={item.id} className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
            <span className="font-medium text-slate-700">{item.name}</span>
            <span>{item.totalClients} klien</span>
            <span className="text-slate-400">(Acc {item.accountingClients} · Tax {item.taxClients})</span>
          </span>
        ))}
      </div>
    </section>
  );
}
