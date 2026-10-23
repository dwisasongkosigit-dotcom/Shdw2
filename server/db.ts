import { AsyncLocalStorage } from 'node:async_hooks';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { db as pg } from '../db/index.ts';
import { appState, backupSnapshots } from '../db/schema.ts';
import { getInitialSeedData } from './seed.ts';
import { hashPassword } from './auth.ts';
import initialData from '../data/tmm_bma_database.json' with { type: 'json' };
import type { DatabaseSchema, BackupInfo, AuditLog } from './types.ts';

const STATE_ID = 'main';
const MAX_BACKUPS = 35;

// Legacy asset paths that only worked with the Vite dev server
const LEGACY_LOGO_PATH = '/src/assets/images/tmm_bma_logo_1792761458459.jpg';
export const DEFAULT_LOGO_PATH = '/images/tmm_bma_logo_1792761458459.jpg';

// Request-scoped copy of the dataset. Each request loads the latest state from
// Netlify Database, mutates it in memory, and persists it once before responding.
interface DbContext {
  data: DatabaseSchema | null;
  loadedVersion: number;
  dirty: boolean;
  poisoned: boolean;
}

const storage = new AsyncLocalStorage<DbContext>();

function ctx(): DbContext {
  const context = storage.getStore();
  if (!context) throw new Error('Konteks database tidak tersedia untuk permintaan ini.');
  return context;
}

export function runWithDb<T>(fn: () => T): T {
  return storage.run({ data: null, loadedVersion: 0, dirty: false, poisoned: false }, fn);
}

// Migrate/upgrade in-memory schema safely to ensure Prompt 2 compatibility
function upgradeSchema(db: DatabaseSchema): DatabaseSchema {
  if (!Array.isArray(db.auditLogs)) db.auditLogs = [];
  if (!Array.isArray(db.backups)) db.backups = [];

  if (db.branding && (!db.branding.logoUrl || db.branding.logoUrl === LEGACY_LOGO_PATH)) {
    db.branding.logoUrl = DEFAULT_LOGO_PATH;
  }

  // Ensure Owner and Manager users exist
  const hasOwner = db.users.some((u) => u.role === 'Owner');
  if (!hasOwner) {
    const ownerPass = hashPassword('OwnerPass2026!');
    db.users.push({
      id: 'USR-OWN01',
      name: 'Bambang M. Adisurya, MBA (Owner)',
      username: 'owner',
      role: 'Owner',
      passwordHash: ownerPass.hash,
      salt: ownerPass.salt,
      email: 'owner@tmm-bma.id',
      active: true,
      mustChangePassword: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  const hasManager = db.users.some((u) => u.role === 'Manager');
  if (!hasManager) {
    const mgrPass = hashPassword('ManagerPass2026!');
    db.users.push({
      id: 'USR-MGR01',
      name: 'Kartika Sari, SE, M.Ak (Manager)',
      username: 'manager',
      role: 'Manager',
      passwordHash: mgrPass.hash,
      salt: mgrPass.salt,
      email: 'manager@tmm-bma.id',
      active: true,
      mustChangePassword: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  // Ensure 4 PIC assignment fields exist on each client
  db.clients.forEach((c: any) => {
    if (!c.version) c.version = 1;
    if (!c.picHistory) c.picHistory = [];

    // Ensure 4 distinct PIC roles:
    if (!c.accountingStaffPicId) c.accountingStaffPicId = c.accountingPicId || 'USR-STF-ACC';
    if (!c.accountingStaffPicName) c.accountingStaffPicName = c.accountingPicName || 'Budi Pratama, S.Ak.';
    if (!c.taxStaffPicId) c.taxStaffPicId = c.taxPicId || 'USR-STF-TAX';
    if (!c.taxStaffPicName) c.taxStaffPicName = c.taxPicName || 'Dewi Lestari, S.Tr.Akt.';
    if (!c.accountingSpvId) c.accountingSpvId = 'USR-SPV-ACC';
    if (!c.accountingSpvName) c.accountingSpvName = 'Hendra Wijaya, SE, Ak., CA';
    if (!c.taxSpvId) c.taxSpvId = 'USR-SPV-TAX';
    if (!c.taxSpvName) c.taxSpvName = 'Ratna Kartika, SE, BKP';

    // Verification of completeness: all 4 must be valid non-empty
    const isComplete =
      Boolean(c.accountingStaffPicName && c.accountingStaffPicName !== '-' && c.accountingStaffPicName.trim()) &&
      Boolean(c.taxStaffPicName && c.taxStaffPicName !== '-' && c.taxStaffPicName.trim()) &&
      Boolean(c.accountingSpvName && c.accountingSpvName !== '-' && c.accountingSpvName.trim()) &&
      Boolean(c.taxSpvName && c.taxSpvName !== '-' && c.taxSpvName.trim());

    c.picAssignmentStatus = isComplete ? 'Lengkap' : 'Belum Lengkap';

    // Synchronize backward-compat fields
    c.accountingPicId = c.accountingStaffPicId;
    c.accountingPicName = c.accountingStaffPicName;
    c.taxPicId = c.taxStaffPicId;
    c.taxPicName = c.taxStaffPicName;
    c.spvId = c.accountingSpvId;
    c.spvName = c.accountingSpvName;
  });

  // Ensure job versions
  db.jobs.forEach((j: any) => {
    if (!j.version) j.version = 1;
  });

  // Ensure case versions
  db.cases.forEach((c: any) => {
    if (!c.version) c.version = 1;
  });

  return db;
}

// Initial dataset: the bundled data export if valid, otherwise the built-in seed
function buildInitialData(): DatabaseSchema {
  const imported = structuredClone(initialData) as unknown as DatabaseSchema;
  if (imported && Array.isArray(imported.clients) && Array.isArray(imported.users)) {
    // Snapshot files from the old disk storage are not available here
    imported.backups = [];
    return upgradeSchema(imported);
  }
  return upgradeSchema(getInitialSeedData());
}

// Load the latest dataset for the current request, creating it on first use
export async function loadDatabase(): Promise<DatabaseSchema> {
  const context = ctx();

  let [row] = await pg.select().from(appState).where(eq(appState.id, STATE_ID));
  if (!row) {
    console.log('[DB] Inisialisasi database baru TMM/BMA...');
    await pg
      .insert(appState)
      .values({ id: STATE_ID, data: buildInitialData(), version: 1 })
      .onConflictDoNothing();
    [row] = await pg.select().from(appState).where(eq(appState.id, STATE_ID));
  }

  context.data = upgradeSchema(row.data as DatabaseSchema);
  context.loadedVersion = row.version;
  context.dirty = false;
  context.poisoned = false;
  return context.data;
}

export function getDb(): DatabaseSchema {
  const context = ctx();
  if (!context.data) throw new Error('Database belum dimuat.');
  return context.data;
}

export function isDbDirty(): boolean {
  const context = storage.getStore();
  return Boolean(context && context.dirty && !context.poisoned);
}

export function mutateDb(mutator: (db: DatabaseSchema) => void): DatabaseSchema {
  const context = ctx();
  const db = getDb();
  try {
    mutator(db);
  } catch (err) {
    // A failed mutation may leave partial changes in memory; never persist them
    context.poisoned = true;
    throw err;
  }
  db.lastSaved = new Date().toISOString();
  db.version = (db.version || 1) + 1;
  context.dirty = true;
  return db;
}

// Persist pending changes; rejects if another request saved in the meantime
export async function persistDatabase(): Promise<void> {
  const context = ctx();
  if (!context.dirty || context.poisoned || !context.data) return;

  const updated = await pg
    .update(appState)
    .set({ data: context.data, version: sql`${appState.version} + 1`, updatedAt: new Date() })
    .where(and(eq(appState.id, STATE_ID), eq(appState.version, context.loadedVersion)))
    .returning({ version: appState.version });

  if (updated.length === 0) {
    throw new Error('Data telah diubah oleh pengguna lain secara bersamaan. Silakan muat ulang halaman dan coba lagi.');
  }

  context.loadedVersion = updated[0].version;
  context.dirty = false;
}

// Log audit trail
export function logAudit(
  action: string,
  targetType: AuditLog['targetType'],
  details: string,
  user: { userId: string; name: string; role: string },
  targetId?: string,
  targetName?: string,
  ip?: string
): void {
  try {
    const db = getDb();
    const auditItem: AuditLog = {
      id: `AUD-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      userId: user.userId,
      userName: user.name,
      userRole: user.role,
      action,
      targetType,
      targetId,
      targetName,
      details,
      ip,
    };
    db.auditLogs = db.auditLogs || [];
    db.auditLogs.unshift(auditItem);
    // Keep max 5000 audit records
    if (db.auditLogs.length > 5000) {
      db.auditLogs = db.auditLogs.slice(0, 5000);
    }
    ctx().dirty = true;
  } catch (err) {
    console.error('[Audit] Gagal mencatat audit log:', err);
  }
}

// Manual or Scheduled Backup Snapshot creation
export async function createBackupSnapshot(
  type: 'manual' | 'scheduled',
  notes?: string,
  user?: { userId: string; name: string; role: string }
): Promise<BackupInfo> {
  const db = getDb();
  const now = new Date();
  const timestampStr = now.toISOString().replace(/[:.]/g, '-');
  const filename = `tmm_bma_backup_${type}_${timestampStr}.json`;

  const snapshot = structuredClone(db);
  const sizeBytes = Buffer.byteLength(JSON.stringify(snapshot, null, 2), 'utf-8');
  await pg.insert(backupSnapshots).values({ filename, data: snapshot });

  const backupInfo: BackupInfo = {
    id: `BKP-${Date.now()}`,
    filename,
    timestamp: now.toISOString(),
    sizeBytes,
    type,
    recordsCount: {
      clients: db.clients.length,
      jobs: db.jobs.length,
      cases: db.cases.length,
      activities: db.activities.length,
      users: db.users.length,
    },
    status: 'valid',
    notes: notes || (type === 'manual' ? 'Cadangan data manual dibuat pengguna' : 'Cadangan otomatis sistem 23:00 WIB'),
  };

  mutateDb((database) => {
    database.backups = database.backups || [];
    database.backups.unshift(backupInfo);

    // Retain up to 30 days of snapshots
    if (database.backups.length > MAX_BACKUPS) {
      database.backups.splice(MAX_BACKUPS);
    }

    // Log to audit trail
    const auditUser = user || { userId: 'SYSTEM', name: 'Sistem Otomatis', role: 'Admin' };
    logAudit(
      type === 'manual' ? 'MANUAL_BACKUP_CREATED' : 'SCHEDULED_BACKUP_CREATED',
      'Backup',
      `Berhasil membuat backup berkas ${filename} (${(sizeBytes / 1024).toFixed(1)} KB) mencakup ${db.clients.length} klien dan ${db.jobs.length} pekerjaan.`,
      auditUser,
      backupInfo.id,
      filename
    );
  });

  // Drop stored snapshots that fell out of the retention window
  const kept = db.backups.map((b) => b.filename);
  await pg.delete(backupSnapshots).where(notInArray(backupSnapshots.filename, kept));

  return backupInfo;
}

export async function getBackupSnapshot(filename: string): Promise<DatabaseSchema | null> {
  const [row] = await pg.select().from(backupSnapshots).where(eq(backupSnapshots.filename, filename));
  return row ? (row.data as DatabaseSchema) : null;
}

// Restore database from a verified backup snapshot (Admin only)
export async function restoreFromSnapshot(
  backupFilename: string,
  user: { userId: string; name: string; role: string }
): Promise<{ success: boolean; message: string; version: number }> {
  const restoredData = await getBackupSnapshot(backupFilename);
  if (!restoredData) {
    throw new Error(`Berkas cadangan '${backupFilename}' tidak ditemukan di penyimpanan server.`);
  }

  // Pre-validate snapshot
  if (!Array.isArray(restoredData.clients) || !Array.isArray(restoredData.users)) {
    throw new Error('Validasi berkas cadangan gagal: Struktur berkas cadangan tidak valid atau rusak.');
  }

  // Create safety pre-restore backup of current state
  await createBackupSnapshot('manual', 'Pre-restore Safety Auto-Backup', user);

  // Apply restoration, keeping the current backup catalogue so snapshots stay listed
  const context = ctx();
  const currentBackups = getDb().backups;
  const restored = upgradeSchema(restoredData);
  restored.backups = currentBackups;
  restored.lastSaved = new Date().toISOString();
  restored.version = (restored.version || 1) + 1;
  context.data = restored;
  context.dirty = true;

  logAudit(
    'DATABASE_RESTORE_EXECUTED',
    'Backup',
    `Database berhasil dipulihkan dari berkas cadangan '${backupFilename}' oleh ${user.name} (${user.role}).`,
    user,
    backupFilename,
    backupFilename
  );

  return {
    success: true,
    message: `Database berhasil dipulihkan dari '${backupFilename}'.`,
    version: restored.version,
  };
}

// Automatic daily backup (invoked by the scheduled function at 23:00 WIB / 16:00 UTC)
export async function runScheduledBackup(): Promise<BackupInfo> {
  return runWithDb(async () => {
    await loadDatabase();
    const info = await createBackupSnapshot('scheduled', 'Backup harian otomatis 23:00 WIB');
    await persistDatabase();
    return info;
  });
}

export function getDbHealthInfo() {
  const db = getDb();
  const fileSizeBytes = Buffer.byteLength(JSON.stringify(db), 'utf-8');

  return {
    status: 'connected',
    storageEngine: 'Netlify Database (Postgres JSONB, optimistic locking)',
    databaseFilePath: 'netlify-database://app_state/main',
    existsOnDisk: true,
    fileSizeBytes,
    lastSaved: db.lastSaved,
    version: db.version,
    counts: {
      users: db.users.length,
      clients: db.clients.length,
      activeClients: db.clients.filter((c) => c.status === 'Aktif').length,
      jobs: db.jobs.length,
      cases: db.cases.length,
      activities: db.activities.length,
      auditLogs: db.auditLogs?.length || 0,
      backups: db.backups?.length || 0,
    },
  };
}
