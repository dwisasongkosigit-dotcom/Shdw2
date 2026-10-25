import { AsyncLocalStorage } from 'node:async_hooks';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { appState, backupSnapshots } from '../db/schema.ts';
import { db as postgres } from '../db/index.ts';
import { getInitialSeedData } from './seed.ts';
import { hashPassword } from './auth.ts';
import { calculateClientPicAssignmentStatus, SERVICE_RESPONSIBILITY_OPTIONS } from './types.ts';
import initialData from '../data/tmm_bma_database.json' with { type: 'json' };
import type { DatabaseSchema, BackupInfo, AuditLog } from './types.ts';

const MAX_BACKUPS = 35;
const APP_STATE_ID = 'main';

// Legacy asset paths that only worked with the Vite dev server
const LEGACY_LOGO_PATH = '/src/assets/images/tmm_bma_logo_1792761458459.jpg';
export const DEFAULT_LOGO_PATH = '/images/tmm_bma_logo_1792761458459.jpg';

// Request-scoped copy of the dataset. Writes use a database version check so
// concurrent serverless requests cannot silently overwrite one another.
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
  if (!Array.isArray(db.meetingMinutes)) db.meetingMinutes = [];
  if (!Array.isArray(db.agendaEntries)) db.agendaEntries = [];
  if (!Array.isArray(db.auditLogs)) db.auditLogs = [];
  if (!Array.isArray(db.backups)) db.backups = [];
  if (!Array.isArray(db.monthlyJobTemplates)) db.monthlyJobTemplates = [];
  if (!Array.isArray(db.handoverRecords)) db.handoverRecords = [];
  if (!Array.isArray(db.hiddenHandoverJobIds)) db.hiddenHandoverJobIds = [];
  if (!Array.isArray(db.profileAssignmentHandoverRecords)) db.profileAssignmentHandoverRecords = [];
  if (!Array.isArray(db.notifications)) db.notifications = [];
  db.clients.forEach((client: any) => {
    if (!Array.isArray(client.monthlyJobTemplateIds)) client.monthlyJobTemplateIds = [];
  });

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

  // Ensure PIC ownership and reviewer assignment fields exist on each client
  db.clients.forEach((c: any) => {
    if (!SERVICE_RESPONSIBILITY_OPTIONS.includes(c.accountingServiceResponsibility)) c.accountingServiceResponsibility = 'Tim 3';
    if (!SERVICE_RESPONSIBILITY_OPTIONS.includes(c.taxServiceResponsibility)) c.taxServiceResponsibility = 'Tim 3';
    if (!c.version) c.version = 1;
    if (!c.picHistory) c.picHistory = [];
    if (!c.suggestions) c.suggestions = [];
    if (!c.investmentCategory) c.investmentCategory = 'Belum Ditentukan';
    if (!c.dataType) c.dataType = 'Belum Diatur';
    if (!c.accountingRiskReviewDate) c.accountingRiskReviewDate = '';
    if (!c.taxRiskReviewDate) c.taxRiskReviewDate = '';

    // Ensure 4 distinct PIC roles:
    if (!c.accountingStaffPicId) c.accountingStaffPicId = c.accountingPicId || 'USR-STF-ACC';
    if (!c.accountingStaffPicName) c.accountingStaffPicName = c.accountingPicName || 'Budi Pratama, S.Ak.';
    if (typeof c.accountingSpvIsPic !== 'boolean') c.accountingSpvIsPic = false;
    if (typeof c.taxSpvIsPic !== 'boolean') c.taxSpvIsPic = false;
    if (!c.taxStaffPicId) c.taxStaffPicId = c.taxPicId || 'USR-STF-TAX';
    if (!c.taxStaffPicName) c.taxStaffPicName = c.taxPicName || 'Dewi Lestari, S.Tr.Akt.';
    if (!c.accountingSpvId) c.accountingSpvId = 'USR-SPV-ACC';
    if (!c.accountingSpvName) c.accountingSpvName = 'Hendra Wijaya, SE, Ak., CA';
    if (!c.taxSpvId) c.taxSpvId = 'USR-SPV-TAX';
    if (!c.taxSpvName) c.taxSpvName = 'Ratna Kartika, SE, BKP';

    c.picAssignmentStatus = calculateClientPicAssignmentStatus(c);

    // Synchronize backward-compat fields
    c.accountingPicId = c.accountingSpvIsPic ? c.accountingSpvId : c.accountingStaffPicId;
    c.accountingPicName = c.accountingSpvIsPic ? c.accountingSpvName : c.accountingStaffPicName;
    c.taxPicId = c.taxSpvIsPic ? c.taxSpvId : c.taxStaffPicId;
    c.taxPicName = c.taxSpvIsPic ? c.taxSpvName : c.taxStaffPicName;
    c.spvId = c.accountingSpvId;
    c.spvName = c.accountingSpvName;
  });

  // Preserve existing jobs as Tim 3 work unless they inherit a client-level assignment.
  const serviceResponsibilityByClientId = new Map<string, Record<string, string>>(
    db.clients.map((client: any) => [client.id, {
      Accounting: client.accountingServiceResponsibility || 'Tim 3',
      Tax: client.taxServiceResponsibility || 'Tim 3',
    }] as [string, Record<string, string>])
  );
  db.jobs.forEach((j: any) => {
    if (!SERVICE_RESPONSIBILITY_OPTIONS.includes(j.serviceResponsibility)) {
      j.serviceResponsibility = serviceResponsibilityByClientId.get(j.clientId)?.[j.division] || 'Tim 3';
    }
    if (!j.version) j.version = 1;
  });

  // Ensure case versions
  db.cases.forEach((c: any) => {
    if (!c.version) c.version = 1;
  });

  return db;
}

// Bootstrap once from the bundled export when Neon has no app-state record.
function buildInitialData(): DatabaseSchema {
  const imported = structuredClone(initialData) as unknown as DatabaseSchema;
  if (imported && Array.isArray(imported.clients) && Array.isArray(imported.users)) {
    // Legacy disk snapshots are not imported during the one-time bootstrap.
    imported.backups = [];
    return upgradeSchema(imported);
  }
  return upgradeSchema(getInitialSeedData());
}

// Load the shared dataset from Neon, creating the initial record once if needed.
export async function loadDatabase(): Promise<DatabaseSchema> {
  const context = ctx();
  let [record] = await postgres
    .select({ data: appState.data, version: appState.version })
    .from(appState)
    .where(eq(appState.id, APP_STATE_ID))
    .limit(1);

  if (!record) {
    await postgres
      .insert(appState)
      .values({ id: APP_STATE_ID, data: buildInitialData(), version: 1 })
      .onConflictDoNothing({ target: appState.id });

    [record] = await postgres
      .select({ data: appState.data, version: appState.version })
      .from(appState)
      .where(eq(appState.id, APP_STATE_ID))
      .limit(1);
  }

  if (!record) throw new Error('Data aplikasi belum dapat dibuat di database Neon.');

  context.data = upgradeSchema(structuredClone(record.data as DatabaseSchema));
  context.loadedVersion = record.version;
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

// Commit with an atomic optimistic-version check to protect shared edits.
export async function persistDatabase(): Promise<void> {
  const context = ctx();
  if (!context.dirty || context.poisoned || !context.data) return;

  context.data.lastSaved = new Date().toISOString();
  const [saved] = await postgres
    .update(appState)
    .set({
      data: context.data,
      version: sql`${appState.version} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(appState.id, APP_STATE_ID), eq(appState.version, context.loadedVersion)))
    .returning({ version: appState.version });

  if (!saved) {
    throw new Error('Data telah diubah oleh pengguna lain secara bersamaan. Silakan muat ulang halaman dan coba lagi.');
  }

  context.loadedVersion = saved.version;
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
  await postgres
    .insert(backupSnapshots)
    .values({ filename, data: snapshot, createdAt: now })
    .onConflictDoUpdate({
      target: backupSnapshots.filename,
      set: { data: snapshot, createdAt: now },
    });

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

  // Keep the snapshot table aligned with the retained backup catalogue.
  const keptFilenames = db.backups.map((backup) => backup.filename);
  if (keptFilenames.length) {
    await postgres.delete(backupSnapshots).where(notInArray(backupSnapshots.filename, keptFilenames));
  }

  return backupInfo;
}

export async function getBackupSnapshot(filename: string): Promise<DatabaseSchema | null> {
  const [record] = await postgres
    .select({ data: backupSnapshots.data })
    .from(backupSnapshots)
    .where(eq(backupSnapshots.filename, filename))
    .limit(1);
  return record ? structuredClone(record.data as DatabaseSchema) : null;
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
    status: 'persistent',
    storageEngine: 'Neon PostgreSQL',
    databaseFilePath: null,
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
