import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Client } from '../lib/api';

interface ClientSegmentationChartProps {
  clients: Client[];
  dataType: 'Real' | 'Simulasi' | 'Semua';
}

const palette = {
  PMA: '#c8872e',
  PMDN: '#496f91',
  High: '#dc6b63',
  Medium: '#e58a2b',
  Low: '#d5a21d',
  'Belum Dinilai': '#94a3b8',
};

function HorizontalBarChart({
  title,
  description,
  data,
}: {
  title: string;
  description: string;
  data: Array<{ name: string; jumlah: number; color: string }>;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-label={title}>
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="mt-1 text-xs text-slate-500">{description}</p>
      </div>
      <div className="h-52 w-full" role="img" aria-label={`${title}: ${data.map((item) => `${item.name} ${item.jumlah} klien`).join(', ')}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 18, bottom: 4, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} />
            <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10 }} />
            <Tooltip
              cursor={{ fill: '#f8fafc' }}
              contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 12 }}
              formatter={(value) => [`${value ?? 0} klien`, 'Jumlah']}
            />
            <Bar dataKey="jumlah" radius={[7, 7, 0, 0]} maxBarSize={42}>
              {data.map((item) => <Cell key={item.name} fill={item.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2" aria-hidden="true">
        {data.map((item) => (
          <span key={item.name} className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
            <span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
            {item.name}: <strong className="font-semibold text-slate-700">{item.jumlah}</strong>
          </span>
        ))}
      </div>
    </section>
  );
}

export function ClientSegmentationChart({ clients, dataType }: ClientSegmentationChartProps) {
  const sourceClients = clients.filter((client) =>
    client.status === 'Aktif' && (dataType === 'Semua' || client.dataType === dataType)
  );

  const investmentData = (['PMA', 'PMDN'] as const).map((name) => ({
    name,
    jumlah: sourceClients.filter((client) => client.investmentCategory === name).length,
    color: palette[name],
  }));

  const riskData = (['High', 'Medium', 'Low', 'Belum Dinilai'] as const).map((name) => ({
    name,
    jumlah: sourceClients.filter((client) => {
      const risks = [client.accountingRisk, client.taxRisk];
      const overall = risks.includes('High') ? 'High'
        : risks.includes('Medium') ? 'Medium'
        : risks.includes('Low') ? 'Low'
        : 'Belum Dinilai';
      return overall === name;
    }).length,
    color: palette[name],
  }));

  const unclassifiedCount = sourceClients.filter((client) => client.investmentCategory === 'Belum Ditentukan').length;
  const simulationCount = clients.filter((client) => client.status === 'Aktif' && client.dataType === 'Simulasi').length;
  const unassignedTypeCount = clients.filter((client) => client.status === 'Aktif' && client.dataType === 'Belum Diatur').length;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <HorizontalBarChart
        title="Jenis Penanaman Modal"
        description="Jumlah klien aktif berdasarkan kategori PMA dan PMDN."
        data={investmentData}
      />
      <HorizontalBarChart
        title="Tingkat Risiko Klien"
        description="Risiko tertinggi antara Accounting dan Tax menjadi kategori ringkasan."
        data={riskData}
      />
      {(unclassifiedCount > 0 || (dataType !== 'Simulasi' && (simulationCount > 0 || unassignedTypeCount > 0))) && (
        <p className="text-xs leading-relaxed text-slate-500 lg:col-span-2">
          {unclassifiedCount > 0 && <>{unclassifiedCount} klien belum diklasifikasikan PMA/PMDN. </>}
          {dataType !== 'Simulasi' && simulationCount > 0 && <>{simulationCount} klien simulasi disembunyikan dari grafik. </>}
          {dataType !== 'Simulasi' && unassignedTypeCount > 0 && <>{unassignedTypeCount} klien belum ditandai Real/Simulasi.</>}
        </p>
      )}
    </div>
  );
}
