import type { MeetingMinute } from './api';

function safeFileName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'Minutes_of_Meeting';
}

function formatDate(value: string) {
  if (!value) return 'Belum dijadwalkan';
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] || character);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadMeetingMinuteWord(meeting: MeetingMinute, companyName: string) {
  const {
    AlignmentType,
    Document,
    HeadingLevel,
    Packer,
    Paragraph,
    TextRun,
    Footer,
  } = await import('docx');

  const label = (title: string, value: string) => new Paragraph({
    children: [
      new TextRun({ text: `${title}  `, bold: true, color: '334155' }),
      new TextRun({ text: value || '—', color: '475569' }),
    ],
    spacing: { after: 100 },
  });
  const sectionTitle = (title: string) => new Paragraph({
    text: title,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 120 },
  });
  const children = [
    new Paragraph({
      children: [new TextRun({ text: companyName || 'TMM & BMA Advisory', bold: true, size: 20, color: 'A66A12', characterSpacing: 30 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 140 },
    }),
    new Paragraph({
      text: 'MINUTES OF MEETING',
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: meeting.title, bold: true, size: 25, color: '101B34' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `${meeting.id}  ·  ${formatDate(meeting.meetingDate)}`, color: '64748B', size: 19 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
    }),
    sectionTitle('Informasi Rapat'),
    label('Jenis rapat', meeting.meetingType),
    label('Tanggal', formatDate(meeting.meetingDate)),
    label('Waktu', `${meeting.startTime || '—'}${meeting.endTime ? ` – ${meeting.endTime}` : ''}`),
    label('Lokasi', meeting.location),
    label('Pimpinan rapat', meeting.chairperson),
    label('Notulis', meeting.recorder),
    label('Peserta', meeting.attendees.join(', ')),
    sectionTitle('Agenda dan Keputusan'),
    ...(meeting.agendaItems.length
      ? meeting.agendaItems.flatMap((item, index) => [
          new Paragraph({
            children: [new TextRun({ text: `${String(index + 1).padStart(2, '0')}  ${item.topic}`, bold: true, color: '101B34' })],
            spacing: { before: 160, after: 80 },
          }),
          ...(item.discussion ? [label('Pembahasan', item.discussion)] : []),
          ...(item.decision ? [label('Keputusan', item.decision)] : []),
        ])
      : [new Paragraph({ text: 'Tidak ada agenda yang dicatat.', spacing: { after: 100 } })]),
    sectionTitle('Daftar Tindak Lanjut'),
    ...(meeting.actionItems.length
      ? meeting.actionItems.flatMap((item, index) => [
          new Paragraph({
            children: [new TextRun({ text: `${String(index + 1).padStart(2, '0')}  ${item.description}`, bold: true, color: '101B34' })],
            spacing: { before: 140, after: 70 },
          }),
          label('Penanggung jawab', item.owner),
          label('Tenggat', formatDate(item.deadline)),
          label('Status', item.status),
        ])
      : [new Paragraph({ text: 'Tidak ada tindak lanjut khusus yang ditetapkan.', spacing: { after: 100 } })]),
    sectionTitle('Jadwal Berikutnya'),
    new Paragraph({ text: formatDate(meeting.nextMeetingDate), spacing: { after: 200 } }),
  ];

  const documentFile = new Document({
    creator: companyName || 'TMM & BMA Advisory',
    title: meeting.title,
    subject: `Minutes of Meeting ${meeting.id}`,
    styles: {
      default: {
        document: {
          run: { font: 'Aptos', size: 21, color: '334155' },
          paragraph: { spacing: { line: 300 } },
        },
        heading1: { run: { font: 'Aptos Display', size: 34, bold: true, color: '101B34' }, paragraph: { spacing: { before: 180, after: 120 } } },
        heading2: { run: { font: 'Aptos', size: 24, bold: true, color: '101B34' }, paragraph: { spacing: { before: 260, after: 120 } } },
      },
    },
    sections: [{
      properties: { page: { margin: { top: 900, right: 1000, bottom: 900, left: 1000 } } },
      footers: {
        default: new Footer({ children: [new Paragraph({
          children: [new TextRun({ text: `${companyName || 'TMM & BMA Advisory'}  ·  Dokumen internal  ·  ${meeting.id}`, size: 16, color: '64748B' })],
          alignment: AlignmentType.CENTER,
        })] }),
      },
      children,
    }],
  });

  const blob = await Packer.toBlob(documentFile);
  downloadBlob(blob, `${safeFileName(meeting.id)}_${safeFileName(meeting.title)}.docx`);
}

export function printMeetingMinutePdf(meeting: MeetingMinute, companyName: string) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) throw new Error('Jendela cetak terblokir. Izinkan pop-up untuk mengekspor PDF.');

  const agenda = meeting.agendaItems.map((item, index) => `
    <section class="agenda-item">
      <h3><span>${String(index + 1).padStart(2, '0')}</span>${escapeHtml(item.topic)}</h3>
      ${item.discussion ? `<div class="copy"><strong>Pembahasan</strong><p>${escapeHtml(item.discussion).replace(/\n/g, '<br>')}</p></div>` : ''}
      ${item.decision ? `<div class="decision"><strong>Keputusan</strong><p>${escapeHtml(item.decision).replace(/\n/g, '<br>')}</p></div>` : ''}
    </section>`).join('') || '<p class="muted">Tidak ada agenda yang dicatat.</p>';
  const actions = meeting.actionItems.map((item, index) => `
    <tr><td>${String(index + 1).padStart(2, '0')}</td><td>${escapeHtml(item.description)}</td><td>${escapeHtml(item.owner || 'Belum ditentukan')}</td><td>${escapeHtml(formatDate(item.deadline))}</td><td>${escapeHtml(item.status)}</td></tr>`).join('');
  const attendees = meeting.attendees.length
    ? meeting.attendees.map((person) => `<span class="attendee">${escapeHtml(person)}</span>`).join('')
    : '<span class="muted">Belum ada peserta dicatat.</span>';

  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
    <html lang="id"><head><meta charset="utf-8"><title>${escapeHtml(meeting.id)} - ${escapeHtml(meeting.title)}</title>
    <style>
      @page { size: A4; margin: 18mm 17mm 17mm; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #263246; font: 10pt/1.6 Arial, sans-serif; }
      .brand { color: #a66a12; font-size: 9pt; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; }
      header { border-bottom: 2px solid #d4a64e; padding-bottom: 18px; }
      h1 { color: #101b34; font-size: 25pt; line-height: 1.15; margin: 18px 0 5px; }
      .subtitle { color: #475569; font-size: 12pt; font-weight: 600; margin: 0; }
      .ref { color: #64748b; font: 9pt monospace; margin: 10px 0 0; }
      .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 20px; margin: 18px 0 24px; padding: 15px; background: #f7f8fa; border: 1px solid #e2e8f0; border-radius: 8px; }
      .meta dt { color: #7c8797; font-size: 7pt; font-weight: 700; letter-spacing: 1px; margin: 0 0 3px; text-transform: uppercase; }
      .meta dd { color: #263246; font-size: 9pt; font-weight: 600; margin: 0; overflow-wrap: anywhere; }
      h2 { border-bottom: 1px solid #dce1e8; color: #101b34; font-size: 13pt; margin: 24px 0 12px; padding-bottom: 7px; }
      h2 span { color: #a66a12; font-size: 8pt; letter-spacing: 1px; margin-right: 8px; }
      .attendees { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 7px; }
      .attendee { background: #f1f4f7; border-radius: 20px; color: #475569; font-size: 8pt; padding: 4px 9px; }
      .agenda-item { break-inside: avoid; margin: 0 0 12px; padding: 13px 14px; border: 1px solid #e2e8f0; border-radius: 7px; }
      h3 { align-items: flex-start; color: #101b34; display: flex; font-size: 10pt; gap: 9px; margin: 0; }
      h3 span { color: #a66a12; font: 8pt monospace; padding-top: 2px; }
      .copy, .decision { margin: 10px 0 0 25px; }
      .copy strong, .decision strong { color: #778396; display: block; font-size: 7pt; letter-spacing: .7px; text-transform: uppercase; }
      .decision { background: #fbf6eb; border-left: 2px solid #c28a2c; padding: 8px 10px; }
      p { margin: 3px 0 0; white-space: normal; overflow-wrap: anywhere; }
      .muted { color: #8490a0; font-size: 9pt; }
      table { border-collapse: collapse; font-size: 8pt; width: 100%; }
      th { background: #101b34; color: #fff; font-size: 7pt; letter-spacing: .4px; text-align: left; text-transform: uppercase; }
      th, td { border: 1px solid #e2e8f0; padding: 8px 7px; vertical-align: top; overflow-wrap: anywhere; }
      tr { break-inside: avoid; }
      footer { border-top: 1px solid #e2e8f0; color: #8490a0; font-size: 7pt; margin-top: 26px; padding-top: 9px; }
      @media screen { body { margin: 20px auto; max-width: 780px; padding: 40px 48px; box-shadow: 0 4px 30px #101b3418; } }
    </style></head><body>
      <header><div class="brand">${escapeHtml(companyName || 'TMM & BMA Advisory')} · Management Office</div><h1>Minutes of Meeting</h1><p class="subtitle">${escapeHtml(meeting.title)}</p><p class="ref">${escapeHtml(meeting.id)}　·　${escapeHtml(formatDate(meeting.meetingDate))}</p></header>
      <dl class="meta">
        <div><dt>Jenis rapat</dt><dd>${escapeHtml(meeting.meetingType || '—')}</dd></div>
        <div><dt>Tanggal & waktu</dt><dd>${escapeHtml(formatDate(meeting.meetingDate))}　${escapeHtml(meeting.startTime || '—')}${meeting.endTime ? `–${escapeHtml(meeting.endTime)}` : ''}</dd></div>
        <div><dt>Lokasi</dt><dd>${escapeHtml(meeting.location || '—')}</dd></div>
        <div><dt>Pimpinan rapat</dt><dd>${escapeHtml(meeting.chairperson || '—')}</dd></div>
        <div><dt>Notulis</dt><dd>${escapeHtml(meeting.recorder || '—')}</dd></div>
        <div><dt>Rapat berikutnya</dt><dd>${escapeHtml(formatDate(meeting.nextMeetingDate))}</dd></div>
        <div style="grid-column:1/-1"><dt>Peserta (${meeting.attendees.length})</dt><dd><div class="attendees">${attendees}</div></dd></div>
      </dl>
      <h2><span>01</span>Agenda &amp; Keputusan</h2>${agenda}
      <h2><span>02</span>Daftar Tindak Lanjut</h2>
      ${actions ? `<table><thead><tr><th>No.</th><th>Tindakan</th><th>Penanggung jawab</th><th>Tenggat</th><th>Status</th></tr></thead><tbody>${actions}</tbody></table>` : '<p class="muted">Tidak ada tindak lanjut khusus yang ditetapkan.</p>'}
      <footer>${escapeHtml(companyName || 'TMM & BMA Advisory')}　·　Dokumen internal　·　${escapeHtml(meeting.id)}</footer>
      <script>window.addEventListener('load', () => setTimeout(() => window.print(), 250));</script>
    </body></html>`);
  printWindow.document.close();
}
