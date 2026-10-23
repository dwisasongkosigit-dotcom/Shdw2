import type { Config } from '@netlify/functions';

// Scheduled backups are intentionally skipped in temporary in-memory preview mode.
export default async () => {
  console.log('[Backup Scheduler] Dilewati: penyimpanan persisten tidak dikonfigurasi.');
};

export const config: Config = {
  schedule: '0 16 * * *',
};
