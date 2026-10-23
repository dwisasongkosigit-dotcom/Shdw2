import type { Config } from '@netlify/functions';
import { runScheduledBackup } from '../../server/db.ts';

// Automatic daily backup at 23:00 WIB (16:00 UTC)
export default async () => {
  const info = await runScheduledBackup();
  console.log(`[Backup Scheduler] Cadangan otomatis harian dibuat: ${info.filename}`);
};

export const config: Config = {
  schedule: '0 16 * * *',
};
