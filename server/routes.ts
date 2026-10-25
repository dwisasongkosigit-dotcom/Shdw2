import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import ExcelJS from 'exceljs';
import path from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  getDb,
  mutateDb,
  getDbHealthInfo,
  createBackupSnapshot,
  restoreFromSnapshot,
  getBackupSnapshot,
  logAudit,
  DEFAULT_LOGO_PATH,
} from './db.ts';
import {
  authenticateToken,
  requireRole,
  requireWritable,
  createSession,
  destroySession,
  verifyPassword,
  hashPassword,
  type AuthenticatedRequest,
} from './auth.ts';
import type {
  Client,
  Job,
  MonthlyJobTemplate,
  Case,
  DailyActivity,
  User,
  JobStatus,
  JobHandoverDirection,
  JobHandoverRecord,
  RiskLevel,
  RiskHistoryItem,
  PicHistoryItem,
  ClientSuggestion,
  SuggestionStatus,
  MeetingMinute,
  MeetingActionItem,
  TeamAgendaEntry,
  AgendaStatus,
  AgendaDivision,
} from './types.ts';

export const apiRouter = Router();

function hasDivisionAccess(role: string, division: string) {
  return role === 'Admin' ||
    (role.includes('Accounting') && division === 'Accounting') ||
    (role.includes('Tax') && division === 'Tax');
}

// Forward async handler rejections to the Express error middleware
function asyncHandler<R extends Request>(fn: (req: R, res: Response, next: NextFunction) => Promise<void>) {
  return (req: R, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

function normalizeMeetingMinute(data: any, users: User[]) {
  const text = (value: unknown, maxLength = 1000) =>
    typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
  const validStatuses: MeetingActionItem['status'][] = ['Belum Dimulai', 'Dalam Proses', 'Selesai'];
  const attendeeUserIds: string[] = Array.isArray(data?.attendeeUserIds)
    ? [...new Set<string>(data.attendeeUserIds.slice(0, 50).map((id: unknown) => text(id, 80)).filter((id: string) => Boolean(id)))]
    : [];
  const externalAttendees = Array.isArray(data?.externalAttendees)
    ? data.externalAttendees.slice(0, 50).map((name: unknown) => text(name, 120)).filter(Boolean)
    : [];
  const hasStructuredAttendees = Array.isArray(data?.attendeeUserIds) || Array.isArray(data?.externalAttendees);
  const attendees = hasStructuredAttendees
    ? [...attendeeUserIds.map((id: string) => users.find((user) => user.id === id)?.name).filter((name): name is string => Boolean(name)), ...externalAttendees]
    : Array.isArray(data?.attendees)
      ? data.attendees.slice(0, 40).map((name: unknown) => text(name, 120)).filter(Boolean)
      : [];

  return {
    title: text(data?.title, 180),
    meetingDate: text(data?.meetingDate, 10),
    startTime: text(data?.startTime, 5),
    endTime: text(data?.endTime, 5),
    meetingType: text(data?.meetingType, 80) || 'Rapat Manajemen',
    location: text(data?.location, 180),
    chairperson: text(data?.chairperson, 120),
    recorder: text(data?.recorder, 120),
    attendees,
    ...(hasStructuredAttendees ? { attendeeUserIds, externalAttendees } : {}),
    agendaItems: Array.isArray(data?.agendaItems)
      ? data.agendaItems.slice(0, 40).map((item: any) => ({
          id: text(item?.id, 80) || randomUUID(),
          topic: text(item?.topic, 180),
          discussion: text(item?.discussion, 3000),
          decision: text(item?.decision, 2000),
        })).filter((item: { topic: string }) => item.topic)
      : [],
    actionItems: Array.isArray(data?.actionItems)
      ? data.actionItems.slice(0, 60).map((item: any) => ({
          id: text(item?.id, 80) || randomUUID(),
          description: text(item?.description, 300),
          owner: users.find((user) => user.id === item?.ownerUserId)?.name || text(item?.owner, 120),
          ownerUserId: item?.ownerUserId === null ? null : text(item?.ownerUserId, 80) || undefined,
          deadline: text(item?.deadline, 10),
          status: validStatuses.includes(item?.status) ? item.status : 'Belum Dimulai',
        })).filter((item: { description: string }) => item.description)
      : [],
    nextMeetingDate: text(data?.nextMeetingDate, 10),
  };
}

function normalizeAgendaEntry(data: any, users: User[]) {
  const text = (value: unknown, maxLength = 1000) =>
    typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
  const validDivisions: AgendaDivision[] = ['Lintas Divisi', 'Accounting', 'Tax'];
  const validStatuses: AgendaStatus[] = ['Terjadwal', 'Selesai', 'Dibatalkan'];
  const participantUserIds: string[] = Array.isArray(data?.participantUserIds)
    ? [...new Set<string>(data.participantUserIds.slice(0, 50).map((id: unknown) => text(id, 80)).filter((id: string) => Boolean(id)))]
    : [];
  const externalParticipants = Array.isArray(data?.externalParticipants)
    ? data.externalParticipants.slice(0, 50).map((name: unknown) => text(name, 120)).filter(Boolean)
    : [];
  const hasStructuredParticipants = Array.isArray(data?.participantUserIds) || Array.isArray(data?.externalParticipants);
  const participants = hasStructuredParticipants
    ? [...participantUserIds.map((id: string) => users.find((user) => user.id === id)?.name).filter((name): name is string => Boolean(name)), ...externalParticipants]
    : Array.isArray(data?.participants)
      ? data.participants.slice(0, 50).map((name: unknown) => text(name, 120)).filter(Boolean)
      : [];

  return {
    title: text(data?.title, 180),
    date: text(data?.date, 10),
    startTime: text(data?.startTime, 5),
    endTime: text(data?.endTime, 5),
    meetingType: text(data?.meetingType, 80) || 'Koordinasi Internal',
    division: validDivisions.includes(data?.division) ? data.division : 'Lintas Divisi',
    location: text(data?.location, 180),
    clientId: text(data?.clientId, 80),
    jobId: text(data?.jobId, 80),
    participants,
    ...(hasStructuredParticipants ? { participantUserIds, externalParticipants } : {}),
    notes: text(data?.notes, 3000),
    status: validStatuses.includes(data?.status) ? data.status : 'Terjadwal',
  };
}

function hasUnknownUserIds(ids: string[], users: User[]) {
  return ids.some((id) => !users.some((user) => user.id === id));
}

function validateAgendaEntry(entry: ReturnType<typeof normalizeAgendaEntry>) {
  const parsedDate = new Date(`${entry.date}T00:00:00.000Z`);
  const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(entry.date) &&
    !Number.isNaN(parsedDate.getTime()) &&
    parsedDate.toISOString().slice(0, 10) === entry.date;
  const isValidTime = (value: string) => !value || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

  if (!entry.title) return 'Judul agenda wajib diisi.';
  if (!isValidDate) return 'Tanggal agenda tidak valid.';
  if (!isValidTime(entry.startTime) || !isValidTime(entry.endTime)) return 'Waktu agenda tidak valid.';
  if (entry.startTime && entry.endTime && entry.endTime <= entry.startTime) return 'Waktu selesai harus setelah waktu mulai.';
  return null;
}

function validateMeetingMinute(meeting: ReturnType<typeof normalizeMeetingMinute>) {
  const isValidDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };

  if (!meeting.title) return 'Judul rapat wajib diisi.';
  if (!isValidDate(meeting.meetingDate)) return 'Tanggal rapat tidak valid.';
  if (meeting.startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(meeting.startTime)) return 'Waktu mulai tidak valid.';
  if (meeting.endTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(meeting.endTime)) return 'Waktu selesai tidak valid.';
  if (meeting.nextMeetingDate && !isValidDate(meeting.nextMeetingDate)) return 'Tanggal rapat berikutnya tidak valid.';
  if (!meeting.agendaItems.length) return 'Tambahkan minimal satu topik agenda.';
  if (meeting.actionItems.some((item: MeetingActionItem) => item.deadline && !isValidDate(item.deadline))) return 'Salah satu tenggat tindak lanjut tidak valid.';
  return null;
}

// ==========================================
// 1. HEALTH & PERSISTENCE VERIFICATION
// ==========================================
apiRouter.get('/health', (req: Request, res: Response) => {
  try {
    const health = getDbHealthInfo();
    res.json(health);
  } catch (err: any) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ==========================================
// 2. AUTHENTICATION (Login, Me, Change Password, Logout)
// ==========================================
apiRouter.post('/auth/login', asyncHandler(async (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: 'Username dan kata sandi wajib diisi.' });
    return;
  }

  const db = getDb();
  const user = db.users.find(
    (u) => u.username.toLowerCase() === username.trim().toLowerCase()
  );

  if (!user) {
    res.status(401).json({ error: 'Username atau kata sandi tidak cocok.' });
    return;
  }

  if (!user.active) {
    res.status(403).json({ error: 'Akun ini telah dinonaktifkan oleh Admin. Hubungi administrator.' });
    return;
  }

  const isValid = verifyPassword(password, user.passwordHash, user.salt);
  if (!isValid) {
    res.status(401).json({ error: 'Username atau kata sandi tidak cocok.' });
    return;
  }

  const session = await createSession(user);

  logAudit(
    'USER_LOGIN',
    'Auth',
    `Pengguna ${user.name} (${user.role}) berhasil masuk ke sistem.`,
    { userId: user.id, name: user.name, role: user.role }
  );

  res.json({
    token: session.token,
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
      email: user.email,
      mustChangePassword: user.mustChangePassword || false,
    },
    branding: db.branding,
  });
}));

apiRouter.get('/auth/me', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Tidak terautentikasi' });
    return;
  }
  const db = getDb();
  const user = db.users.find((u) => u.id === req.user?.userId);
  if (!user || !user.active) {
    res.status(401).json({ error: 'Pengguna tidak ditemukan atau dinonaktifkan.' });
    return;
  }

  res.json({
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
      email: user.email,
      mustChangePassword: user.mustChangePassword || false,
    },
    branding: db.branding,
  });
});

apiRouter.post('/auth/change-password', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'Kata sandi saat ini dan kata sandi baru wajib diisi.' });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: 'Kata sandi baru minimal 8 karakter.' });
    return;
  }

  const currentUser = req.user!;
  mutateDb((database) => {
    const user = database.users.find((u) => u.id === currentUser.userId);
    if (!user) throw new Error('Pengguna tidak ditemukan.');

    const isValid = verifyPassword(currentPassword, user.passwordHash, user.salt);
    if (!isValid) throw new Error('Kata sandi saat ini tidak cocok.');

    const { hash, salt } = hashPassword(newPassword);
    user.passwordHash = hash;
    user.salt = salt;
    user.mustChangePassword = false;
    user.updatedAt = new Date().toISOString();

    logAudit(
      'PASSWORD_CHANGED',
      'Auth',
      `Kata sandi diperbarui oleh ${user.name}.`,
      { userId: user.id, name: user.name, role: user.role }
    );
  });

  res.json({ success: true, message: 'Kata sandi berhasil diperbarui.' });
});

apiRouter.post('/auth/logout', asyncHandler(async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.substring(7)
    : (req.headers['x-session-token'] as string | undefined);
  if (token) {
    await destroySession(token);
  }
  res.json({ success: true, message: 'Berhasil keluar.' });
}));

// ==========================================
// 3. BRANDING SETTINGS (Admin Only)
// ==========================================
apiRouter.get('/branding', (req: Request, res: Response) => {
  const db = getDb();
  res.json(db.branding);
});

apiRouter.put(
  '/branding',
  authenticateToken,
  requireRole('Admin'),
  requireWritable,
  (req: AuthenticatedRequest, res: Response) => {
    const { appName, companyName, subtitle, logoUrl, faviconUrl, resetToDefault } = req.body;
    const currentUser = req.user!;

    mutateDb((db) => {
      if (resetToDefault) {
        db.branding = {
          appName: 'TMM/BMA Client Control Center',
          companyName: 'TMM & BMA Advisory',
          subtitle: 'Tax & Accounting Client Control Center',
          logoUrl: DEFAULT_LOGO_PATH,
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser.name,
        };
      } else {
        if (appName !== undefined) db.branding.appName = String(appName).trim();
        if (companyName !== undefined) db.branding.companyName = String(companyName).trim();
        if (subtitle !== undefined) db.branding.subtitle = String(subtitle).trim();
        if (logoUrl !== undefined) {
          if (typeof logoUrl === 'string' && logoUrl.startsWith('data:')) {
            const isImage = /^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,/.test(logoUrl);
            if (!isImage) {
              throw new Error('Format file logo tidak valid. Harap gunakan file PNG, JPG, WebP, atau SVG.');
            }
          }
          db.branding.logoUrl = logoUrl;
        }
        if (faviconUrl !== undefined) db.branding.faviconUrl = faviconUrl;
        db.branding.updatedAt = new Date().toISOString();
        db.branding.updatedBy = currentUser.name;
      }

      logAudit(
        'BRANDING_UPDATED',
        'Branding',
        resetToDefault ? 'Branding dikembalikan ke default.' : 'Konfigurasi judul dan logo diperbarui.',
        { userId: currentUser.userId, name: currentUser.name, role: currentUser.role }
      );
    });

    const updated = getDb().branding;
    res.json({ success: true, branding: updated, message: 'Pengaturan branding tersimpan sementara di memori server.' });
  }
);

// ==========================================
// 4. USER MANAGEMENT (Admin Only)
// ==========================================
apiRouter.get(
  '/users',
  authenticateToken,
  (req: AuthenticatedRequest, res: Response) => {
    const db = getDb();
    const sanitized = db.users.map((u) => ({
      id: u.id,
      name: u.name,
      username: u.username,
      role: u.role,
      email: u.email,
      active: u.active,
      mustChangePassword: u.mustChangePassword || false,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }));
    res.json(sanitized);
  }
);

apiRouter.post(
  '/users',
  authenticateToken,
  requireRole('Admin'),
  requireWritable,
  (req: AuthenticatedRequest, res: Response) => {
    const { name, username, role, email, password, mustChangePassword } = req.body;
    if (!name || !username || !role || !password) {
      res.status(400).json({ error: 'Nama, username, peran, dan kata sandi wajib diisi.' });
      return;
    }

    const validRoles = [
      'Owner',
      'Manager',
      'Admin',
      'SPV Accounting',
      'SPV Tax',
      'Staff Accounting',
      'Staff Tax',
    ];
    if (!validRoles.includes(role)) {
      res.status(400).json({ error: 'Peran pengguna tidak valid.' });
      return;
    }

    const db = getDb();
    const existing = db.users.find((u) => u.username.toLowerCase() === username.trim().toLowerCase());
    if (existing) {
      res.status(400).json({ error: `Username '${username}' sudah digunakan.` });
      return;
    }

    const { hash, salt } = hashPassword(password);
    const newId = `USR-${Date.now().toString(36).toUpperCase()}`;
    const newUser: User = {
      id: newId,
      name: name.trim(),
      username: username.trim().toLowerCase(),
      role,
      email: (email || '').trim(),
      passwordHash: hash,
      salt,
      active: true,
      mustChangePassword: Boolean(mustChangePassword),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    mutateDb((database) => {
      database.users.push(newUser);
      logAudit(
        'USER_CREATED',
        'User',
        `Pengguna baru ${newUser.name} (${newUser.username}) dengan role ${newUser.role} dibuat.`,
        { userId: req.user!.userId, name: req.user!.name, role: req.user!.role },
        newUser.id,
        newUser.name
      );
    });

    res.status(201).json({
      success: true,
      user: {
        id: newUser.id,
        name: newUser.name,
        username: newUser.username,
        role: newUser.role,
        email: newUser.email,
        active: newUser.active,
        mustChangePassword: newUser.mustChangePassword,
        createdAt: newUser.createdAt,
      },
      message: 'Pengguna berhasil dibuat dan disimpan.',
    });
  }
);

apiRouter.put(
  '/users/:id',
  authenticateToken,
  requireRole('Admin'),
  requireWritable,
  (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { name, role, email, active, password, mustChangePassword } = req.body;
    let updatedUser: User | null = null;

    mutateDb((database) => {
      const target = database.users.find((u) => u.id === id);
      if (!target) throw new Error('Pengguna tidak ditemukan.');

      if (name !== undefined) target.name = name.trim();
      if (role !== undefined) target.role = role;
      if (email !== undefined) target.email = email.trim();
      if (active !== undefined) target.active = Boolean(active);
      if (mustChangePassword !== undefined) target.mustChangePassword = Boolean(mustChangePassword);
      if (password) {
        const { hash, salt } = hashPassword(password);
        target.passwordHash = hash;
        target.salt = salt;
      }
      target.updatedAt = new Date().toISOString();
      updatedUser = target;

      logAudit(
        'USER_UPDATED',
        'User',
        `Data pengguna ${target.name} (${target.username}) diperbarui oleh Admin.`,
        { userId: req.user!.userId, name: req.user!.name, role: req.user!.role },
        target.id,
        target.name
      );
    });

    res.json({
      success: true,
      user: updatedUser,
      message: 'Data pengguna berhasil diperbarui.',
    });
  }
);

// ==========================================
// 5. MASTER KLIEN & PEMBAGIAN PIC KLIEN
// ==========================================
apiRouter.get('/clients', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const db = getDb();
  let results = [...db.clients];

  const {
    type,
    entityType,
    pkpStatus,
    pphRegime,
    accRisk,
    taxRisk,
    status,
    picStatus,
    search,
    picId,
    spvId,
  } = req.query;

  if (type) results = results.filter((c) => c.type === type);
  if (entityType) results = results.filter((c) => c.entityType === entityType);
  if (pkpStatus) results = results.filter((c) => c.pkpStatus === pkpStatus);
  if (pphRegime) results = results.filter((c) => c.pphRegime === pphRegime);
  if (accRisk) results = results.filter((c) => c.accountingRisk === accRisk);
  if (taxRisk) results = results.filter((c) => c.taxRisk === taxRisk);
  if (status) results = results.filter((c) => c.status === status);
  if (picStatus) results = results.filter((c) => c.picAssignmentStatus === picStatus);

  if (picId) {
    results = results.filter(
      (c) =>
        c.accountingStaffPicId === picId ||
        c.taxStaffPicId === picId ||
        c.accountingSpvId === picId ||
        c.taxSpvId === picId
    );
  }
  if (spvId) {
    results = results.filter((c) => c.accountingSpvId === spvId || c.taxSpvId === spvId);
  }

  if (search && typeof search === 'string') {
    const q = search.toLowerCase();
    results = results.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        (c.npwp && c.npwp.toLowerCase().includes(q)) ||
        (c.accountingStaffPicName && c.accountingStaffPicName.toLowerCase().includes(q)) ||
        (c.taxStaffPicName && c.taxStaffPicName.toLowerCase().includes(q)) ||
        (c.accountingSpvName && c.accountingSpvName.toLowerCase().includes(q)) ||
        (c.taxSpvName && c.taxSpvName.toLowerCase().includes(q)) ||
        (c.notes && c.notes.toLowerCase().includes(q))
    );
  }

  res.json(results);
});

apiRouter.get('/clients/:id', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const db = getDb();
  const client = db.clients.find((c) => c.id === req.params.id);
  if (!client) {
    res.status(404).json({ error: 'Klien tidak ditemukan.' });
    return;
  }
  res.json(client);
});

apiRouter.post(
  '/clients',
  authenticateToken,
  requireRole('Admin', 'SPV Accounting', 'SPV Tax'),
  requireWritable,
  (req: AuthenticatedRequest, res: Response) => {
    const data = req.body;
    if (!data.name || !data.type) {
      res.status(400).json({ error: 'Nama klien dan jenis klien (OP/Badan) wajib diisi.' });
      return;
    }
    if (data.investmentCategory !== undefined && !['PMA', 'PMDN', 'Belum Ditentukan'].includes(data.investmentCategory)) {
      res.status(400).json({ error: 'Kategori investasi klien tidak valid.' });
      return;
    }
    if (data.dataType !== undefined && !['Real', 'Simulasi', 'Belum Diatur'].includes(data.dataType)) {
      res.status(400).json({ error: 'Jenis data klien tidak valid.' });
      return;
    }
    const capitalFields = ['authorizedCapital', 'issuedCapital', 'paidUpCapital'] as const;
    if (capitalFields.some((field) => data[field] !== undefined && data[field] !== null && (typeof data[field] !== 'number' || !Number.isSafeInteger(data[field]) || data[field] < 0))) {
      res.status(400).json({ error: 'Nilai modal harus berupa angka rupiah bulat nol atau lebih.' });
      return;
    }
    if (data.deedNumber !== undefined && (typeof data.deedNumber !== 'string' || data.deedNumber.length > 100)) {
      res.status(400).json({ error: 'Nomor akta tidak valid.' });
      return;
    }
    if (data.deedDate !== undefined && (typeof data.deedDate !== 'string' || (data.deedDate && !/^\d{4}-\d{2}-\d{2}$/.test(data.deedDate)))) {
      res.status(400).json({ error: 'Tanggal akta tidak valid.' });
      return;
    }

    if (data.accountingSpvIsPic !== undefined && typeof data.accountingSpvIsPic !== 'boolean') {
      res.status(400).json({ error: 'Pilihan PIC SPV Accounting tidak valid.' });
      return;
    }
    if (data.taxSpvIsPic !== undefined && typeof data.taxSpvIsPic !== 'boolean') {
      res.status(400).json({ error: 'Pilihan PIC SPV Tax tidak valid.' });
      return;
    }

    const accountingSpvIsPic = data.accountingSpvIsPic === true;
    const taxSpvIsPic = data.taxSpvIsPic === true;
    const db = getDb();
    const nextNumber = db.clients.length + 1;
    const newId = `CLI-${String(nextNumber).padStart(3, '0')}`;

    const resolveAssignment = (userId: string | undefined, role: User['role']) => {
      if (!userId) return { id: '', name: '-' };
      const user = db.users.find((candidate) => candidate.id === userId && candidate.active && candidate.role === role);
      return user ? { id: user.id, name: user.name } : null;
    };
    const accountingStaff = accountingSpvIsPic
      ? { id: '', name: '-' }
      : resolveAssignment(data.accountingStaffPicId, 'Staff Accounting');
    const taxStaff = taxSpvIsPic
      ? { id: '', name: '-' }
      : resolveAssignment(data.taxStaffPicId, 'Staff Tax');
    const accountingSpv = resolveAssignment(data.accountingSpvId, 'SPV Accounting');
    const taxSpv = resolveAssignment(data.taxSpvId, 'SPV Tax');
    if (!accountingStaff || !taxStaff || !accountingSpv || !taxSpv) {
      res.status(400).json({ error: 'PIC harus dipilih dari pengguna aktif dengan peran divisi yang sesuai.' });
      return;
    }

    const accStaffId = accountingStaff.id;
    const accStaffName = accountingStaff.name;
    const taxStaffId = taxStaff.id;
    const taxStaffName = taxStaff.name;
    const accSpvId = accountingSpv.id;
    const accSpvName = accountingSpv.name;
    const taxSpvId = taxSpv.id;
    const taxSpvName = taxSpv.name;

    const accountingOwner = accountingSpvIsPic ? accSpvName : accStaffName;
    const taxOwner = taxSpvIsPic ? taxSpvName : taxStaffName;
    const isComplete =
      Boolean(accountingOwner && accountingOwner !== '-' && accountingOwner.trim()) &&
      Boolean(taxOwner && taxOwner !== '-' && taxOwner.trim()) &&
      Boolean(accSpvName && accSpvName !== '-' && accSpvName.trim()) &&
      Boolean(taxSpvName && taxSpvName !== '-' && taxSpvName.trim());

    const initialPicHistory: PicHistoryItem[] = [
      {
        id: `PICH-${newId}-INIT`,
        timestamp: new Date().toISOString(),
        changedBy: req.user?.name || 'Admin',
        accountingStaff: accStaffName,
        taxStaff: taxStaffName,
        accountingSpv: accSpvName,
        taxSpv: taxSpvName,
        accountingSpvIsPic,
        taxSpvIsPic,
        notes: isComplete ? 'PIC utama dan reviewer ditetapkan saat pembuatan klien.' : 'PIC utama atau reviewer masih belum lengkap.'
      },
    ];

    const newClient: Client = {
      id: newId,
      name: data.name.trim(),
      type: data.type,
      entityType: data.type === 'OP' ? '-' : data.entityType || 'PT',
      accountingStaffPicId: accStaffId,
      accountingStaffPicName: accStaffName,
      taxStaffPicId: taxStaffId,
      taxStaffPicName: taxStaffName,
      accountingSpvIsPic,
      taxSpvIsPic,
      accountingSpvId: accSpvId,
      accountingSpvName: accSpvName,
      taxSpvId: taxSpvId,
      taxSpvName: taxSpvName,
      picAssignmentStatus: isComplete ? 'Lengkap' : 'Belum Lengkap',
      picHistory: initialPicHistory,

      accountingPicId: accountingSpvIsPic ? accSpvId : accStaffId,
      accountingPicName: accountingSpvIsPic ? accSpvName : accStaffName,
      taxPicId: taxSpvIsPic ? taxSpvId : taxStaffId,
      taxPicName: taxSpvIsPic ? taxSpvName : taxStaffName,
      spvId: accSpvId,
      spvName: accSpvName,

      status: data.status || 'Aktif',
      investmentCategory: data.investmentCategory || 'Belum Ditentukan',
      deedNumber: typeof data.deedNumber === 'string' ? data.deedNumber.trim() : '',
      deedDate: typeof data.deedDate === 'string' ? data.deedDate : '',
      authorizedCapital: data.authorizedCapital ?? null,
      issuedCapital: data.issuedCapital ?? null,
      paidUpCapital: data.paidUpCapital ?? null,
      dataType: data.dataType || 'Real',
      suggestions: [],
      monthlyJobTemplateIds: [],
      notes: data.notes || '',
      npwp: data.npwp || '',
      address: data.address || '',
      contactPerson: data.contactPerson || '',
      contactPhone: data.contactPhone || '',
      pkpStatus: data.pkpStatus || 'Belum Diisi',
      pphRegime: data.pphRegime || 'Belum Ditentukan',
      taxYearEffective: data.taxYearEffective || new Date().getFullYear(),
      umkmFacilityStartYear: data.umkmFacilityStartYear || null,
      umkmFacilityEndYear: data.umkmFacilityEndYear || null,
      taxProfileNotes: data.taxProfileNotes || '',
      taxProfileSource: data.taxProfileSource || '',
      accountingRisk: data.accountingRisk || 'Not Assessed',
      accountingRiskReason: data.accountingRiskReason || '',
      accountingRiskRecommendation: data.accountingRiskRecommendation || '',
      accountingRiskDate: data.accountingRisk ? new Date().toISOString().split('T')[0] : '',
      accountingRiskReviewDate: data.accountingRiskReviewDate || '',
      accountingRiskAssessedBy: data.accountingRisk ? (req.user?.name || '') : '',
      taxRisk: data.taxRisk || 'Not Assessed',
      taxRiskReason: data.taxRiskReason || '',
      taxRiskRecommendation: data.taxRiskRecommendation || '',
      taxRiskDate: data.taxRisk ? new Date().toISOString().split('T')[0] : '',
      taxRiskReviewDate: data.taxRiskReviewDate || '',
      taxRiskAssessedBy: data.taxRisk ? (req.user?.name || '') : '',
      riskHistory: [],
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: req.user?.name,
    };

    mutateDb((database) => {
      database.clients.unshift(newClient);
      logAudit(
        'CLIENT_CREATED',
        'Client',
        `Klien baru ${newClient.name} (${newClient.id}) ditambahkan dengan status PIC utama: ${newClient.picAssignmentStatus}.`,
        { userId: req.user!.userId, name: req.user!.name, role: req.user!.role },
        newClient.id,
        newClient.name
      );
    });

    res.status(201).json({
      success: true,
      client: newClient,
      message: 'Klien baru berhasil ditambahkan ke memori server sementara.',
    });
  }
);

apiRouter.put(
  '/clients/:id',
  authenticateToken,
  requireWritable,
  (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const updates = req.body;
    let savedClient: Client | null = null;

    mutateDb((database) => {
      const client = database.clients.find((c) => c.id === id);
      if (!client) throw new Error('Klien tidak ditemukan.');
      const currentUser = req.user!;
      if (updates.monthlyJobTemplateIds !== undefined && JSON.stringify(updates.monthlyJobTemplateIds) !== JSON.stringify(client.monthlyJobTemplateIds || [])) {
        throw new Error('Penugasan job rutin harus disimpan melalui pengaturan Job rutin bulanan.');
      }
      if (currentUser.role !== 'Admin' && !currentUser.role.startsWith('SPV')) {
        throw new Error('Akses ditolak: hanya Admin atau supervisor yang dapat mengubah master klien.');
      }
      if (currentUser.role === 'SPV Accounting' && client.accountingSpvId !== currentUser.userId) {
        throw new Error('Akses ditolak: klien ini bukan tanggung jawab SPV Accounting Anda.');
      }
      if (currentUser.role === 'SPV Tax' && client.taxSpvId !== currentUser.userId) {
        throw new Error('Akses ditolak: klien ini bukan tanggung jawab SPV Tax Anda.');
      }
      if (currentUser.role.startsWith('SPV')) {
        const crossDivisionKeys = currentUser.role === 'SPV Accounting'
          ? ['taxRisk', 'taxRiskReason', 'taxRiskRecommendation', 'taxRiskReviewDate', 'taxRiskDate', 'taxRiskAssessedBy', 'taxSpvId', 'taxStaffPicId', 'taxSpvIsPic']
          : ['accountingRisk', 'accountingRiskReason', 'accountingRiskRecommendation', 'accountingRiskReviewDate', 'accountingRiskDate', 'accountingRiskAssessedBy', 'accountingSpvId', 'accountingStaffPicId', 'accountingSpvIsPic'];
        if (crossDivisionKeys.some((key) => updates[key] !== undefined && updates[key] !== (client as any)[key])) {
          throw new Error('Akses ditolak: supervisor hanya dapat mengubah penilaian dan PIC divisinya sendiri.');
        }
        const picAssignmentFields = [
          'accountingStaffPicId', 'accountingStaffPicName', 'taxStaffPicId', 'taxStaffPicName',
          'accountingSpvIsPic', 'taxSpvIsPic',
          'accountingSpvId', 'accountingSpvName', 'taxSpvId', 'taxSpvName',
          'accountingPicId', 'accountingPicName', 'taxPicId', 'taxPicName', 'spvId', 'spvName',
        ];
        if (picAssignmentFields.some((key) => updates[key] !== undefined && updates[key] !== (client as any)[key])) {
          throw new Error('Perubahan penugasan PIC hanya dapat dilakukan Admin.');
        }
      }

      // Optimistic concurrency check if expectedVersion provided
      if (updates.expectedVersion !== undefined && client.version !== updates.expectedVersion) {
        throw new Error(
          `Konflik Perubahan: Data klien ini telah diperbarui oleh pengguna lain (Versi ${client.version}). Muat ulang data terbaru terlebih dahulu sebelum menyimpan.`
        );
      }

      if (updates.accountingSpvIsPic === true) {
        updates.accountingStaffPicId = '';
        updates.accountingStaffPicName = '-';
      }
      if (updates.taxSpvIsPic === true) {
        updates.taxStaffPicId = '';
        updates.taxStaffPicName = '-';
      }

      const picDefinitions = [
        { idField: 'accountingStaffPicId', nameField: 'accountingStaffPicName', role: 'Staff Accounting' },
        { idField: 'taxStaffPicId', nameField: 'taxStaffPicName', role: 'Staff Tax' },
        { idField: 'accountingSpvId', nameField: 'accountingSpvName', role: 'SPV Accounting' },
        { idField: 'taxSpvId', nameField: 'taxSpvName', role: 'SPV Tax' },
      ] as const;
      for (const assignment of picDefinitions) {
        const requestedId = updates[assignment.idField];
        if (requestedId === undefined) {
          delete updates[assignment.nameField];
          continue;
        }
        if (requestedId === client[assignment.idField]) {
          const currentUser = database.users.find((user) =>
            user.id === requestedId && user.active && user.role === assignment.role
          );
          updates[assignment.nameField] = currentUser?.name || client[assignment.nameField];
          continue;
        }
        const selectedUser = database.users.find((user) =>
          user.id === requestedId && user.active && user.role === assignment.role
        );
        if (requestedId && !selectedUser) {
          throw new Error(`PIC ${assignment.role} harus dipilih dari pengguna aktif dengan peran yang sesuai.`);
        }
        updates[assignment.nameField] = selectedUser?.name || '-';
      }

      // Check for PIC Assignment Changes
      for (const field of ['accountingSpvIsPic', 'taxSpvIsPic'] as const) {
        if (updates[field] !== undefined && typeof updates[field] !== 'boolean') {
          throw new Error('Pilihan PIC SPV tidak valid.');
        }
      }

      const picChanged =
        (updates.accountingStaffPicId !== undefined && updates.accountingStaffPicId !== client.accountingStaffPicId) ||
        (updates.taxStaffPicId !== undefined && updates.taxStaffPicId !== client.taxStaffPicId) ||
        (updates.accountingSpvId !== undefined && updates.accountingSpvId !== client.accountingSpvId) ||
        (updates.taxSpvId !== undefined && updates.taxSpvId !== client.taxSpvId) ||
        (updates.accountingStaffPicName !== undefined && updates.accountingStaffPicName !== client.accountingStaffPicName) ||
        (updates.taxStaffPicName !== undefined && updates.taxStaffPicName !== client.taxStaffPicName) ||
        (updates.accountingSpvName !== undefined && updates.accountingSpvName !== client.accountingSpvName) ||
        (updates.taxSpvName !== undefined && updates.taxSpvName !== client.taxSpvName) ||
        (updates.accountingSpvIsPic !== undefined && updates.accountingSpvIsPic !== client.accountingSpvIsPic) ||
        (updates.taxSpvIsPic !== undefined && updates.taxSpvIsPic !== client.taxSpvIsPic);

      if (picChanged) {
        const newAccStaff = updates.accountingStaffPicName ?? client.accountingStaffPicName;
        const newTaxStaff = updates.taxStaffPicName ?? client.taxStaffPicName;
        const newAccSpv = updates.accountingSpvName ?? client.accountingSpvName;
        const newTaxSpv = updates.taxSpvName ?? client.taxSpvName;
        const newAccountingSpvIsPic = updates.accountingSpvIsPic ?? client.accountingSpvIsPic ?? false;
        const newTaxSpvIsPic = updates.taxSpvIsPic ?? client.taxSpvIsPic ?? false;
        const accountingOwner = newAccountingSpvIsPic ? newAccSpv : newAccStaff;
        const taxOwner = newTaxSpvIsPic ? newTaxSpv : newTaxStaff;

        const isComplete =
          Boolean(accountingOwner && accountingOwner !== '-' && accountingOwner.trim()) &&
          Boolean(taxOwner && taxOwner !== '-' && taxOwner.trim()) &&
          Boolean(newAccSpv && newAccSpv !== '-' && newAccSpv.trim()) &&
          Boolean(newTaxSpv && newTaxSpv !== '-' && newTaxSpv.trim());

        client.picAssignmentStatus = isComplete ? 'Lengkap' : 'Belum Lengkap';

        const picHistoryItem: PicHistoryItem = {
          id: `PICH-${id}-${Date.now()}`,
          timestamp: new Date().toISOString(),
          changedBy: req.user?.name || 'User',
          accountingStaff: newAccStaff,
          taxStaff: newTaxStaff,
          accountingSpv: newAccSpv,
          taxSpv: newTaxSpv,
          accountingSpvIsPic: newAccountingSpvIsPic,
          taxSpvIsPic: newTaxSpvIsPic,
          notes: updates.picChangeNotes || 'Perubahan susunan PIC klien.',
        };
        client.picHistory = client.picHistory || [];
        client.picHistory.unshift(picHistoryItem);

        logAudit(
          'PIC_ASSIGNMENT_UPDATED',
          'Client',
          `Perubahan penugasan PIC klien ${client.name}: Acc (${accountingOwner}), Tax (${taxOwner}), Acc SPV (${newAccSpv}), Tax SPV (${newTaxSpv}). Status: ${client.picAssignmentStatus}.`,
          { userId: req.user!.userId, name: req.user!.name, role: req.user!.role },
          client.id,
          client.name
        );
      }

      // Risk Changes
      if (updates.accountingRisk && updates.accountingRisk !== client.accountingRisk) {
        const historyItem: RiskHistoryItem = {
          id: `RSH-${id}-ACC-${Date.now()}`,
          date: new Date().toISOString().split('T')[0],
          division: 'Accounting',
          previousLevel: client.accountingRisk,
          newLevel: updates.accountingRisk,
          reason: updates.accountingRiskReason || client.accountingRiskReason || 'Pembaruan penilaian risiko Accounting',
          recommendation: updates.accountingRiskRecommendation || client.accountingRiskRecommendation || '',
          assessedBy: req.user?.name || 'User',
        };
        client.riskHistory = client.riskHistory || [];
        client.riskHistory.unshift(historyItem);
        client.accountingRisk = updates.accountingRisk;
        client.accountingRiskDate = new Date().toISOString().split('T')[0];
        client.accountingRiskAssessedBy = req.user?.name || 'User';
      }

      if (updates.taxRisk && updates.taxRisk !== client.taxRisk) {
        const historyItem: RiskHistoryItem = {
          id: `RSH-${id}-TAX-${Date.now()}`,
          date: new Date().toISOString().split('T')[0],
          division: 'Tax',
          previousLevel: client.taxRisk,
          newLevel: updates.taxRisk,
          reason: updates.taxRiskReason || client.taxRiskReason || 'Pembaruan penilaian risiko Tax',
          recommendation: updates.taxRiskRecommendation || client.taxRiskRecommendation || '',
          assessedBy: req.user?.name || 'User',
        };
        client.riskHistory = client.riskHistory || [];
        client.riskHistory.unshift(historyItem);
        client.taxRisk = updates.taxRisk;
        client.taxRiskDate = new Date().toISOString().split('T')[0];
        client.taxRiskAssessedBy = req.user?.name || 'User';
      }

      if (updates.investmentCategory !== undefined && !['PMA', 'PMDN', 'Belum Ditentukan'].includes(updates.investmentCategory)) {
        throw new Error('Kategori investasi klien tidak valid.');
      }
      if (updates.dataType !== undefined && !['Real', 'Simulasi', 'Belum Diatur'].includes(updates.dataType)) {
        throw new Error('Jenis data klien tidak valid.');
      }
      const capitalFields = ['authorizedCapital', 'issuedCapital', 'paidUpCapital'] as const;
      if (capitalFields.some((field) => updates[field] !== undefined && updates[field] !== null && (typeof updates[field] !== 'number' || !Number.isSafeInteger(updates[field]) || updates[field] < 0))) {
        throw new Error('Nilai modal harus berupa angka rupiah bulat nol atau lebih.');
      }
      if (updates.deedNumber !== undefined) {
        if (typeof updates.deedNumber !== 'string' || updates.deedNumber.length > 100) throw new Error('Nomor akta tidak valid.');
        updates.deedNumber = updates.deedNumber.trim();
      }
      if (updates.deedDate !== undefined && (typeof updates.deedDate !== 'string' || (updates.deedDate && !/^\d{4}-\d{2}-\d{2}$/.test(updates.deedDate)))) {
        throw new Error('Tanggal akta tidak valid.');
      }

      // Synchronize backward-compatible PIC aliases with the effective owner.
      if (['accountingStaffPicId', 'accountingStaffPicName', 'accountingSpvIsPic', 'accountingSpvId', 'accountingSpvName'].some((key) => updates[key] !== undefined)) {
        const spvIsPic = updates.accountingSpvIsPic ?? client.accountingSpvIsPic ?? false;
        updates.accountingPicId = spvIsPic
          ? updates.accountingSpvId ?? client.accountingSpvId
          : updates.accountingStaffPicId ?? client.accountingStaffPicId;
        updates.accountingPicName = spvIsPic
          ? updates.accountingSpvName ?? client.accountingSpvName
          : updates.accountingStaffPicName ?? client.accountingStaffPicName;
      }
      if (['taxStaffPicId', 'taxStaffPicName', 'taxSpvIsPic', 'taxSpvId', 'taxSpvName'].some((key) => updates[key] !== undefined)) {
        const spvIsPic = updates.taxSpvIsPic ?? client.taxSpvIsPic ?? false;
        updates.taxPicId = spvIsPic
          ? updates.taxSpvId ?? client.taxSpvId
          : updates.taxStaffPicId ?? client.taxStaffPicId;
        updates.taxPicName = spvIsPic
          ? updates.taxSpvName ?? client.taxSpvName
          : updates.taxStaffPicName ?? client.taxStaffPicName;
      }
      if (updates.accountingSpvId !== undefined) updates.spvId = updates.accountingSpvId;
      if (updates.accountingSpvName !== undefined) updates.spvName = updates.accountingSpvName;

      // Update version and timestamp
      client.version = (client.version || 1) + 1;
      client.updatedAt = new Date().toISOString();
      client.updatedBy = req.user?.name;

      Object.assign(client, updates, {
        riskHistory: client.riskHistory,
        picHistory: client.picHistory,
        version: client.version,
        updatedAt: client.updatedAt,
        updatedBy: client.updatedBy,
      });

      savedClient = client;

      logAudit(
        'CLIENT_UPDATED',
        'Client',
        `Data klien ${client.name} (${client.id}) diperbarui ke versi ${client.version}.`,
        { userId: req.user!.userId, name: req.user!.name, role: req.user!.role },
        client.id,
        client.name
      );
    });

    res.json({
      success: true,
      client: savedClient,
      message: 'Data klien berhasil diperbarui di memori server sementara.',
    });
  }
);

apiRouter.post(
  '/clients/:id/suggestions',
  authenticateToken,
  requireWritable,
  (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const currentUser = req.user!;
    const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
    const requestedDivision = req.body.division as Job['division'];
    if (!content || content.length > 2000) {
      res.status(400).json({ error: 'Saran wajib diisi dan maksimal 2.000 karakter.' });
      return;
    }
    if (requestedDivision !== 'Accounting' && requestedDivision !== 'Tax') {
      res.status(400).json({ error: 'Divisi saran tidak valid.' });
      return;
    }

    let savedClient: Client | undefined;
    mutateDb((database) => {
      const client = database.clients.find((candidate) => candidate.id === id);
      if (!client) throw new Error('Klien tidak ditemukan.');
      const canWrite = currentUser.role === 'Admin' ||
        (requestedDivision === 'Accounting' && currentUser.role === 'SPV Accounting' && client.accountingSpvId === currentUser.userId) ||
        (requestedDivision === 'Tax' && currentUser.role === 'SPV Tax' && client.taxSpvId === currentUser.userId) ||
        (requestedDivision === 'Accounting' && currentUser.role === 'Staff Accounting' && client.accountingStaffPicId === currentUser.userId) ||
        (requestedDivision === 'Tax' && currentUser.role === 'Staff Tax' && client.taxStaffPicId === currentUser.userId);
      if (!canWrite) throw new Error('Hanya PIC atau supervisor divisi yang ditugaskan pada klien ini yang dapat menambahkan saran.');

      const suggestion: ClientSuggestion = {
        id: `SUG-${randomUUID()}`,
        division: requestedDivision,
        content,
        status: 'Terbuka',
        createdById: currentUser.userId,
        createdByName: currentUser.name,
        createdAt: new Date().toISOString(),
        dueDate: typeof req.body.dueDate === 'string' ? req.body.dueDate : undefined,
      };
      client.suggestions = client.suggestions || [];
      client.suggestions.unshift(suggestion);
      client.version = (client.version || 1) + 1;
      client.updatedAt = new Date().toISOString();
      client.updatedBy = currentUser.name;
      savedClient = client;
      logAudit('CLIENT_SUGGESTION_CREATED', 'Client', `Saran ${requestedDivision} ditambahkan untuk klien ${client.name}.`, { userId: currentUser.userId, name: currentUser.name, role: currentUser.role }, client.id, client.name);
    });

    res.status(201).json({ success: true, client: savedClient, message: 'Saran berhasil dicatat.' });
  }
);

apiRouter.put(
  '/clients/:id/suggestions/:suggestionId',
  authenticateToken,
  requireWritable,
  (req: AuthenticatedRequest, res: Response) => {
    const { id, suggestionId } = req.params;
    const currentUser = req.user!;
    const status = req.body.status as SuggestionStatus;
    if (!['Terbuka', 'Dalam Tindak Lanjut', 'Selesai'].includes(status)) {
      res.status(400).json({ error: 'Status saran tidak valid.' });
      return;
    }

    let savedClient: Client | undefined;
    mutateDb((database) => {
      const client = database.clients.find((candidate) => candidate.id === id);
      if (!client) throw new Error('Klien tidak ditemukan.');
      const suggestion = (client.suggestions || []).find((candidate) => candidate.id === suggestionId);
      if (!suggestion) throw new Error('Saran tidak ditemukan.');
      const canWrite = currentUser.role === 'Admin' ||
        (suggestion.division === 'Accounting' && currentUser.role === 'SPV Accounting' && client.accountingSpvId === currentUser.userId) ||
        (suggestion.division === 'Tax' && currentUser.role === 'SPV Tax' && client.taxSpvId === currentUser.userId) ||
        (suggestion.division === 'Accounting' && currentUser.role === 'Staff Accounting' && client.accountingStaffPicId === currentUser.userId) ||
        (suggestion.division === 'Tax' && currentUser.role === 'Staff Tax' && client.taxStaffPicId === currentUser.userId);
      if (!canWrite) throw new Error('Hanya PIC atau supervisor divisi yang ditugaskan yang dapat mengubah status saran.');

      suggestion.status = status;
      suggestion.updatedBy = currentUser.name;
      suggestion.updatedAt = new Date().toISOString();
      client.version = (client.version || 1) + 1;
      client.updatedAt = suggestion.updatedAt;
      client.updatedBy = currentUser.name;
      savedClient = client;
      logAudit('CLIENT_SUGGESTION_UPDATED', 'Client', `Status saran ${suggestionId} untuk klien ${client.name} diubah menjadi ${status}.`, { userId: currentUser.userId, name: currentUser.name, role: currentUser.role }, client.id, client.name);
    });

    res.json({ success: true, client: savedClient, message: 'Status saran diperbarui.' });
  }
);

// Putus Kontrak Klien (Admin, SPV Accounting, SPV Tax)
apiRouter.post(
  '/clients/:id/terminate',
  authenticateToken,
  requireRole('Admin', 'SPV Accounting', 'SPV Tax'),
  requireWritable,
  (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { terminationReason, terminationDate } = req.body;
    let savedClient: any = null;

    mutateDb((database) => {
      const client = database.clients.find((c) => c.id === id);
      if (!client) throw new Error('Klien tidak ditemukan.');
      if (req.user?.role === 'SPV Accounting' && client.accountingSpvId !== req.user.userId) {
        throw new Error('Akses ditolak: klien ini bukan tanggung jawab SPV Accounting Anda.');
      }
      if (req.user?.role === 'SPV Tax' && client.taxSpvId !== req.user.userId) {
        throw new Error('Akses ditolak: klien ini bukan tanggung jawab SPV Tax Anda.');
      }

      client.status = 'Putus Kontrak';
      client.terminationDate = terminationDate || new Date().toISOString().split('T')[0];
      client.terminationReason = terminationReason?.trim() || 'Klien memutuskan kontrak kerja sama jasa konsultasi.';
      client.version = (client.version || 1) + 1;
      client.updatedAt = new Date().toISOString();
      client.updatedBy = req.user?.name;

      savedClient = client;

      logAudit(
        'CLIENT_TERMINATED',
        'Client',
        `Klien ${client.name} (${client.id}) diubah status menjadi Putus Kontrak. Alasan: ${client.terminationReason}.`,
        { userId: req.user!.userId, name: req.user!.name, role: req.user!.role },
        client.id,
        client.name
      );
    });

    res.json({
      success: true,
      client: savedClient,
      message: `Status klien '${savedClient?.name}' berhasil diubah menjadi Putus Kontrak.`,
    });
  }
);

// Hapus Klien (Hanya Admin)
apiRouter.delete(
  '/clients/:id',
  authenticateToken,
  requireRole('Admin'),
  requireWritable,
  (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    let deletedClientName = '';

    mutateDb((database) => {
      const idx = database.clients.findIndex((c) => c.id === id);
      if (idx === -1) throw new Error('Klien tidak ditemukan.');

      const deleted = database.clients.splice(idx, 1)[0];
      deletedClientName = deleted.name;

      logAudit(
        'CLIENT_DELETED',
        'Client',
        `Klien '${deleted.name}' (${deleted.id}) dihapus permanen dari sistem oleh Admin.`,
        { userId: req.user!.userId, name: req.user!.name, role: req.user!.role },
        deleted.id,
        deleted.name
      );
    });

    res.json({
      success: true,
      message: `Klien '${deletedClientName}' (${id}) berhasil dihapus dari memori server sementara.`,
    });
  }
);

// ==========================================
// 6. JOB MANAGEMENT & SPV APPROVAL
// ==========================================
function validateMonthlyJobTemplate(data: any) {
  const title = typeof data?.title === 'string' ? data.title.trim() : '';
  const division = data?.division;
  const description = typeof data?.description === 'string' ? data.description.trim() : '';
  const priority = data?.priority || 'Sedang';
  const deadlineDay = Number(data?.deadlineDay);
  if (!title || title.length > 200) return { error: 'Nama template wajib diisi dan maksimal 200 karakter.' } as const;
  if (division !== 'Accounting' && division !== 'Tax') return { error: 'Divisi template tidak valid.' } as const;
  if (!['Rendah', 'Sedang', 'Tinggi', 'Mendesak'].includes(priority)) return { error: 'Prioritas template tidak valid.' } as const;
  if (!Number.isInteger(deadlineDay) || deadlineDay < 1 || deadlineDay > 31) return { error: 'Tanggal deadline harus antara 1 dan 31.' } as const;
  if (description.length > 2000) return { error: 'Deskripsi template maksimal 2.000 karakter.' } as const;
  return { value: { title, division, description, priority, deadlineDay } } as const;
}

apiRouter.get('/job-templates', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const templates = getDb().monthlyJobTemplates || [];
  if (req.user?.role === 'Admin') {
    res.json(templates);
    return;
  }
  const division = req.user?.role.includes('Accounting') ? 'Accounting' : req.user?.role.includes('Tax') ? 'Tax' : null;
  res.json(templates.filter((template) => template.active && (!division || template.division === division)));
});

apiRouter.post('/job-templates', authenticateToken, requireRole('Admin'), requireWritable, (req: AuthenticatedRequest, res: Response) => {
  const validated = validateMonthlyJobTemplate(req.body);
  if ('error' in validated) {
    res.status(400).json({ error: validated.error });
    return;
  }
  const now = new Date().toISOString();
  const template: MonthlyJobTemplate = {
    id: `JBT-${randomUUID().toUpperCase()}`,
    ...validated.value,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  mutateDb((database) => {
    database.monthlyJobTemplates = database.monthlyJobTemplates || [];
    database.monthlyJobTemplates.unshift(template);
    logAudit('MONTHLY_JOB_TEMPLATE_CREATED', 'Job', `Template job bulanan '${template.title}' dibuat untuk divisi ${template.division}.`, { userId: req.user!.userId, name: req.user!.name, role: req.user!.role }, template.id, template.title);
  });
  res.status(201).json({ success: true, template, message: 'Template job bulanan berhasil dibuat.' });
});

apiRouter.put('/job-templates/:id', authenticateToken, requireRole('Admin'), requireWritable, (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  let savedTemplate: MonthlyJobTemplate | null = null;
  mutateDb((database) => {
    const template = (database.monthlyJobTemplates || []).find((item) => item.id === id);
    if (!template) throw new Error('Template job bulanan tidak ditemukan.');
    const candidate = { ...template, ...req.body };
    const validated = validateMonthlyJobTemplate(candidate);
    if ('error' in validated) throw new Error(validated.error);
    if (req.body.active !== undefined && typeof req.body.active !== 'boolean') throw new Error('Status aktif template tidak valid.');
    Object.assign(template, validated.value, req.body.active === undefined ? {} : { active: req.body.active }, { updatedAt: new Date().toISOString() });
    savedTemplate = template;
    logAudit('MONTHLY_JOB_TEMPLATE_UPDATED', 'Job', `Template job bulanan '${template.title}' diperbarui.`, { userId: req.user!.userId, name: req.user!.name, role: req.user!.role }, template.id, template.title);
  });
  res.json({ success: true, template: savedTemplate, message: 'Template job bulanan berhasil diperbarui.' });
});

apiRouter.put('/clients/:id/monthly-jobs', authenticateToken, requireRole('Admin', 'SPV Accounting', 'SPV Tax'), requireWritable, (req: AuthenticatedRequest, res: Response) => {
  const templateIds = req.body?.templateIds;
  if (!Array.isArray(templateIds) || templateIds.length > 100 || templateIds.some((id: unknown) => typeof id !== 'string')) {
    res.status(400).json({ error: 'Daftar template job bulanan tidak valid.' });
    return;
  }
  const currentUser = req.user!;
  let savedClient: Client | null = null;
  mutateDb((database) => {
    const client = database.clients.find((item) => item.id === req.params.id);
    if (!client) throw new Error('Klien tidak ditemukan.');
    if (currentUser.role === 'SPV Accounting' && client.accountingSpvId !== currentUser.userId) throw new Error('SPV Accounting hanya dapat mendelegasikan job pada klien yang menjadi tanggung jawabnya.');
    if (currentUser.role === 'SPV Tax' && client.taxSpvId !== currentUser.userId) throw new Error('SPV Tax hanya dapat mendelegasikan job pada klien yang menjadi tanggung jawabnya.');
    const uniqueIds = [...new Set<string>(templateIds)];
    const templates = database.monthlyJobTemplates || [];
    for (const templateId of uniqueIds) {
      const template = templates.find((item) => item.id === templateId && item.active);
      if (!template) throw new Error('Template aktif tidak ditemukan. Muat ulang daftar template lalu coba lagi.');
      if (currentUser.role === 'SPV Accounting' && template.division !== 'Accounting') throw new Error('SPV Accounting hanya dapat memilih template Accounting.');
      if (currentUser.role === 'SPV Tax' && template.division !== 'Tax') throw new Error('SPV Tax hanya dapat memilih template Tax.');
    }
    const assignedIds = currentUser.role === 'SPV Accounting' || currentUser.role === 'SPV Tax'
      ? [
          ...(client.monthlyJobTemplateIds || []).filter((id) => {
            const existing = templates.find((template) => template.id === id);
            return existing && existing.division !== (currentUser.role === 'SPV Accounting' ? 'Accounting' : 'Tax');
          }),
          ...uniqueIds,
        ]
      : uniqueIds;
    client.monthlyJobTemplateIds = [...new Set(assignedIds)];
    client.version = (client.version || 1) + 1;
    client.updatedAt = new Date().toISOString();
    client.updatedBy = currentUser.name;
    savedClient = client;
    logAudit('CLIENT_MONTHLY_JOBS_UPDATED', 'Client', `Penugasan template job bulanan klien ${client.name} diperbarui (${uniqueIds.length} template aktif).`, { userId: currentUser.userId, name: currentUser.name, role: currentUser.role }, client.id, client.name);
  });
  res.json({ success: true, client: savedClient, message: 'Job rutin bulanan klien berhasil disimpan.' });
});

function getJakartaMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const monthKey = `${values.year}-${values.month}`;
  return { year: Number(values.year), month: Number(values.month), monthKey, firstDay: `${monthKey}-01` };
}

function createCurrentMonthRecurringJobs() {
  const db = getDb();
  const { year, month, monthKey, firstDay } = getJakartaMonth();
  const now = new Date().toISOString();
  const templates = (db.monthlyJobTemplates || []).filter((template) => template.active);
  const newJobs: Job[] = [];
  let sequence = db.jobs.length + 1;
  const nextId = () => {
    let id = '';
    do {
      id = `JOB-${year}-${String(sequence++).padStart(3, '0')}`;
    } while (db.jobs.some((job) => job.id === id) || newJobs.some((job) => job.id === id));
    return id;
  };

  for (const client of db.clients) {
    if (client.status !== 'Aktif') continue;
    const assignedTemplateIds = new Set(client.monthlyJobTemplateIds || []);
    for (const template of templates) {
      if (!assignedTemplateIds.has(template.id)) continue;
      if (db.jobs.some((job) => job.recurringTemplateId === template.id && job.clientId === client.id && job.recurringMonth === monthKey)) continue;
      const division = template.division;
      const isAccounting = division === 'Accounting';
      const spvId = isAccounting ? client.accountingSpvId : client.taxSpvId;
      const spvRole = isAccounting ? 'SPV Accounting' : 'SPV Tax';
      const staffRole = isAccounting ? 'Staff Accounting' : 'Staff Tax';
      const spvIsPic = isAccounting ? client.accountingSpvIsPic : client.taxSpvIsPic;
      const picId = spvIsPic ? spvId : isAccounting ? client.accountingStaffPicId : client.taxStaffPicId;
      const picRole = spvIsPic ? spvRole : staffRole;
      const pic = db.users.find((user) => user.id === picId && user.active && user.role === picRole);
      const reviewer = db.users.find((user) => user.id === spvId && user.active && user.role === spvRole);
      if (!pic || !reviewer) continue;
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const deadline = `${monthKey}-${String(Math.min(template.deadlineDay, daysInMonth)).padStart(2, '0')}`;
      newJobs.push({
        id: nextId(),
        clientId: client.id,
        clientName: client.name,
        division,
        title: template.title,
        picId: pic.id,
        picName: pic.name,
        spvId: reviewer.id,
        spvName: reviewer.name,
        createdAt: now,
        startDate: firstDay,
        deadline,
        priority: template.priority,
        description: template.description,
        notes: `Job rutin ${monthKey} dibuat otomatis dari template ${template.title}.`,
        status: 'Belum Dimulai',
        progressPercent: 0,
        jobType: 'Continuing',
        recurringTemplateId: template.id,
        recurringMonth: monthKey,
        version: 1,
        history: [{
          id: `JH-${randomUUID().slice(0, 12)}`,
          timestamp: now,
          userId: 'SYSTEM',
          userName: 'Sistem Otomatis',
          action: `Job rutin bulanan ${monthKey} dibuat otomatis`,
          toStatus: 'Belum Dimulai',
          notes: `Ditugaskan kepada ${pic.name} (Reviewer: ${reviewer.name}).`,
        }],
        updatedAt: now,
        updatedBy: 'Sistem Otomatis',
      });
    }
  }

  if (newJobs.length) {
    mutateDb((database) => {
      database.jobs.unshift(...newJobs);
      for (const job of newJobs) {
        logAudit('MONTHLY_JOB_GENERATED', 'Job', `Job rutin ${job.id} (${job.title}) dibuat untuk ${job.clientName} pada ${monthKey}.`, { userId: 'SYSTEM', name: 'Sistem Otomatis', role: 'Admin' }, job.id, job.title);
      }
    });
  }
}

apiRouter.get('/cron/monthly-jobs', (req: Request, res: Response) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    res.status(503).json({ error: 'Jadwal job bulanan belum dikonfigurasi.' });
    return;
  }

  const provided = Buffer.from(typeof req.headers.authorization === 'string' ? req.headers.authorization : '');
  const expected = Buffer.from(`Bearer ${secret}`);
  const isAuthorized = provided.length === expected.length && timingSafeEqual(provided, expected);
  if (!isAuthorized) {
    res.status(401).json({ error: 'Akses jadwal tidak valid.' });
    return;
  }

  createCurrentMonthRecurringJobs();
  res.json({ success: true, month: getJakartaMonth().monthKey });
});

apiRouter.get('/jobs', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const db = getDb();
  let results = [...db.jobs];
  const { division, status, picId, spvId, clientId, priority, jobType, recurringMonth } = req.query;

  if (division) results = results.filter((j) => j.division === division);
  if (status) results = results.filter((j) => j.status === status);
  if (picId) results = results.filter((j) => j.picId === picId);
  if (spvId) results = results.filter((j) => j.spvId === spvId);
  if (clientId) results = results.filter((j) => j.clientId === clientId);
  if (priority) results = results.filter((j) => j.priority === priority);
  if (jobType) results = results.filter((j) => (j.jobType || 'Additional') === jobType);
  if (recurringMonth) results = results.filter((j) => j.recurringMonth === recurringMonth);

  res.json(results);
});

apiRouter.get('/handovers', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const db = getDb();
  const currentUser = req.user!;
  const visibleJobIds = new Set(db.jobs.filter((job) => {
    if (currentUser.role === 'Admin' || currentUser.role === 'Owner' || currentUser.role === 'Manager') return true;
    if (currentUser.role === `Staff ${job.division}`) return job.picId === currentUser.userId;
    if (currentUser.role === `SPV ${job.division}`) return job.spvId === currentUser.userId;
    return false;
  }).map((job) => job.id));

  res.json((db.handoverRecords || []).filter((record) => visibleJobIds.has(record.jobId)));
});

apiRouter.post(
  '/jobs/:id/handovers',
  authenticateToken,
  requireWritable,
  (req: AuthenticatedRequest, res: Response) => {
    const currentUser = req.user!;
    const db = getDb();
    const job = db.jobs.find((candidate) => candidate.id === req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Pekerjaan tidak ditemukan.' });
      return;
    }

    const validDirections: JobHandoverDirection[] = [
      'staff-to-client',
      'spv-to-client',
      'tax-to-accounting',
      'tax-to-client',
    ];
    const direction = req.body?.direction as JobHandoverDirection;
    if (!validDirections.includes(direction)) {
      res.status(400).json({ error: 'Tujuan serah terima tidak valid.' });
      return;
    }

    const isAssignedStaff = currentUser.role === `Staff ${job.division}` && job.picId === currentUser.userId;
    const isAssignedReviewer = currentUser.role === `SPV ${job.division}` && job.spvId === currentUser.userId;
    const isAssignedTaxTeamMember = job.division === 'Tax' && (
      (currentUser.role === 'Staff Tax' && job.picId === currentUser.userId) ||
      (currentUser.role === 'SPV Tax' && job.spvId === currentUser.userId)
    );
    const isTaxDirection = direction === 'tax-to-accounting' || direction === 'tax-to-client';
    const canRecord = currentUser.role === 'Admin'
      ? !isTaxDirection || job.division === 'Tax'
      : direction === 'staff-to-client'
        ? isAssignedStaff
        : direction === 'spv-to-client'
          ? isAssignedReviewer
          : isAssignedTaxTeamMember;

    if (!canRecord) {
      res.status(403).json({ error: 'Akses ditolak: hanya PIC atau SPV yang ditugaskan sesuai tujuan serah terima yang dapat mencatat pengiriman.' });
      return;
    }
    if (job.status !== 'Selesai') {
      res.status(409).json({ error: 'Checklist baru aktif setelah review SPV disetujui dan status pekerjaan menjadi Selesai.' });
      return;
    }

    const existingRecord = (db.handoverRecords || []).find((record) => record.jobId === job.id && record.direction === direction && !record.canceledAt);
    if (existingRecord) {
      res.json({ success: true, record: existingRecord, message: 'Serah terima ini sudah pernah dicatat.' });
      return;
    }

    const record: JobHandoverRecord = {
      id: `HDO-${randomUUID()}`,
      jobId: job.id,
      direction,
      sentAt: new Date().toISOString(),
      sentById: currentUser.userId,
      sentByName: currentUser.name,
      sentByRole: currentUser.role,
    };
    const directionLabels: Record<JobHandoverDirection, string> = {
      'staff-to-client': 'Staff → Klien',
      'spv-to-client': 'SPV → Klien',
      'tax-to-accounting': 'Tim Tax → Accounting',
      'tax-to-client': 'Tim Tax → Klien',
    };

    mutateDb((database) => {
      database.handoverRecords = database.handoverRecords || [];
      database.handoverRecords.push(record);
      logAudit(
        'JOB_HANDOVER_RECORDED',
        'Job',
        `${directionLabels[direction]} dicatat untuk pekerjaan ${job.id} (${job.title}) setelah review SPV selesai.`,
        { userId: currentUser.userId, name: currentUser.name, role: currentUser.role },
        job.id,
        job.title
      );
    });

    res.status(201).json({ success: true, record, message: `${directionLabels[direction]} berhasil dicatat.` });
  }
);

apiRouter.post(
  '/jobs/:id/handovers/:recordId/cancel',
  authenticateToken,
  requireWritable,
  (req: AuthenticatedRequest, res: Response) => {
    const currentUser = req.user!;
    const db = getDb();
    const job = db.jobs.find((candidate) => candidate.id === req.params.id);
    const record = (db.handoverRecords || []).find((candidate) => candidate.id === req.params.recordId && candidate.jobId === req.params.id);

    if (!job || !record) {
      res.status(404).json({ error: 'Catatan serah terima tidak ditemukan.' });
      return;
    }
    if (record.canceledAt) {
      res.status(409).json({ error: 'Catatan serah terima ini sudah dibatalkan.' });
      return;
    }

    const isAssignedReviewer = currentUser.role === `SPV ${job.division}` && job.spvId === currentUser.userId;
    if (currentUser.role !== 'Admin' && record.sentById !== currentUser.userId && !isAssignedReviewer) {
      res.status(403).json({ error: 'Akses ditolak: hanya pencatat awal, SPV reviewer yang ditugaskan, atau Admin yang dapat membatalkan catatan ini.' });
      return;
    }

    const canceledAt = new Date().toISOString();
    let canceledRecord: JobHandoverRecord | undefined;
    const directionLabels: Record<JobHandoverDirection, string> = {
      'staff-to-client': 'Staff → Klien',
      'spv-to-client': 'SPV → Klien',
      'tax-to-accounting': 'Tim Tax → Accounting',
      'tax-to-client': 'Tim Tax → Klien',
    };

    mutateDb((database) => {
      const storedRecord = (database.handoverRecords || []).find((candidate) => candidate.id === record.id);
      if (!storedRecord || storedRecord.canceledAt) throw new Error('Catatan serah terima ini sudah dibatalkan.');
      storedRecord.canceledAt = canceledAt;
      storedRecord.canceledById = currentUser.userId;
      storedRecord.canceledByName = currentUser.name;
      storedRecord.canceledByRole = currentUser.role;
      canceledRecord = { ...storedRecord };
      logAudit(
        'JOB_HANDOVER_CANCELED',
        'Job',
        `${directionLabels[storedRecord.direction]} untuk pekerjaan ${job.id} (${job.title}) dibatalkan. Catatan pengiriman awal tetap disimpan.`,
        { userId: currentUser.userId, name: currentUser.name, role: currentUser.role },
        job.id,
        job.title
      );
    });

    if (!canceledRecord) {
      res.status(500).json({ error: 'Gagal menyimpan pembatalan serah terima.' });
      return;
    }
    res.json({ success: true, record: canceledRecord, message: 'Catatan dibatalkan tanpa menghapus riwayat awal.' });
  }
);

apiRouter.post(
  '/jobs',
  authenticateToken,
  requireRole('Admin', 'SPV Accounting', 'SPV Tax'),
  requireWritable,
  (req: AuthenticatedRequest, res: Response) => {
    const data = req.body;
    if (!data.clientId || !data.title?.trim() || !data.division || !data.deadline) {
      res.status(400).json({ error: 'Klien, judul pekerjaan, divisi, dan deadline wajib diisi.' });
      return;
    }

    const selectedDivisions: Job['division'][] = data.division === 'Both'
      ? ['Accounting', 'Tax']
      : [data.division];
    if (selectedDivisions.some((division) => division !== 'Accounting' && division !== 'Tax')) {
      res.status(400).json({ error: 'Divisi pekerjaan tidak valid.' });
      return;
    }

    const currentUser = req.user!;
    if (currentUser.role !== 'Admin' && selectedDivisions.some((division) =>
      (currentUser.role === 'SPV Accounting' && division !== 'Accounting') ||
      (currentUser.role === 'SPV Tax' && division !== 'Tax')
    )) {
      res.status(403).json({ error: 'SPV hanya dapat membuat pekerjaan untuk divisinya sendiri.' });
      return;
    }

    const db = getDb();
    const client = db.clients.find((candidate) => candidate.id === data.clientId);
      if (!client) {
        res.status(404).json({ error: 'Klien tidak ditemukan.' });
        return;
      }
      if (currentUser.role === 'SPV Accounting' && client.accountingSpvId !== currentUser.userId) {
        res.status(403).json({ error: 'SPV Accounting hanya dapat membuat pekerjaan untuk klien yang ditugaskan kepadanya.' });
        return;
      }
      if (currentUser.role === 'SPV Tax' && client.taxSpvId !== currentUser.userId) {
        res.status(403).json({ error: 'SPV Tax hanya dapat membuat pekerjaan untuk klien yang ditugaskan kepadanya.' });
        return;
      }

      const now = new Date().toISOString();
    const year = new Date().getFullYear();
    const createdJobs: Job[] = [];

    for (const [index, division] of selectedDivisions.entries()) {
      const staffRole = division === 'Accounting' ? 'Staff Accounting' : 'Staff Tax';
      const spvRole = division === 'Accounting' ? 'SPV Accounting' : 'SPV Tax';
      const spvIsPic = division === 'Accounting' ? client.accountingSpvIsPic : client.taxSpvIsPic;
      const defaultStaffPicId = division === 'Accounting' ? client.accountingStaffPicId : client.taxStaffPicId;
      const defaultSpvId = division === 'Accounting' ? client.accountingSpvId : client.taxSpvId;
      const expectedPicRole = spvIsPic ? spvRole : staffRole;
      const defaultPicId = spvIsPic ? defaultSpvId : defaultStaffPicId;
      const requestedPicId = data.picAssignments?.[division]?.picId || defaultPicId;
      const assignedPic = db.users.find((user) =>
        user.id === requestedPicId &&
        user.active &&
        user.role === expectedPicRole &&
        (!spvIsPic || user.id === defaultSpvId)
      );
      const assignedSpv = db.users.find((user) => user.id === defaultSpvId && user.active && user.role === spvRole);

      if (!assignedPic) {
        res.status(400).json({ error: `Pilih PIC aktif dengan peran ${expectedPicRole} untuk divisi ${division}.` });
        return;
      }
      if (!assignedSpv) {
        res.status(400).json({ error: `Belum ada SPV aktif untuk divisi ${division}.` });
        return;
      }

      const newJob: Job = {
        id: `JOB-${year}-${String(db.jobs.length + index + 1).padStart(3, '0')}`,
        clientId: client.id,
        clientName: client.name,
        division,
        title: data.title.trim(),
        picId: assignedPic.id,
        picName: assignedPic.name,
        spvId: assignedSpv.id,
        spvName: assignedSpv.name,
        createdAt: now,
        startDate: data.startDate || now.split('T')[0],
        deadline: data.deadline,
        priority: data.priority || 'Sedang',
        description: data.description || '',
        notes: data.notes || '',
        status: 'Belum Dimulai',
        progressPercent: 0,
        jobType: 'Additional',
        version: 1,
        history: [{
          id: `JH-${Date.now()}-${index + 1}`,
          timestamp: now,
          userId: currentUser.userId,
          userName: currentUser.name,
          action: 'Pekerjaan Dibuat dan Ditugaskan ke PIC Divisi',
          toStatus: 'Belum Dimulai',
          notes: data.notes || `Ditugaskan kepada ${assignedPic.name} (Reviewer: ${assignedSpv.name}).`,
        }],
        updatedAt: now,
        updatedBy: currentUser.name,
      };
      createdJobs.push(newJob);
    }

    mutateDb((database) => {
      database.jobs.unshift(...createdJobs);
      for (const job of createdJobs) {
        logAudit(
          'JOB_CREATED',
          'Job',
          `Pekerjaan ${job.id} (${job.title}) dibuat untuk ${job.clientName}, Divisi ${job.division} (PIC: ${job.picName}, SPV: ${job.spvName}).`,
          { userId: currentUser.userId, name: currentUser.name, role: currentUser.role },
          job.id,
          job.title
        );
      }
    });

    res.status(201).json({
      success: true,
      job: createdJobs[0],
      jobs: createdJobs,
      message: createdJobs.length === 2
        ? 'Pekerjaan Accounting dan Tax berhasil dibuat sebagai dua tugas terpisah.'
        : 'Pekerjaan berhasil dibuat dan ditugaskan kepada PIC divisi.',
    });
  }
);

apiRouter.put(
  '/jobs/:id',
  authenticateToken,
  requireWritable,
  (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const updates = req.body;
    const currentUser = req.user!;

    let savedJob: Job | null = null;

    mutateDb((database) => {
      const job = database.jobs.find((j) => j.id === id);
      if (!job) throw new Error('Pekerjaan tidak ditemukan.');

      if (currentUser.role === 'Staff Accounting' && (job.division !== 'Accounting' || job.picId !== currentUser.userId)) {
        throw new Error('Akses ditolak: pekerjaan ini bukan tugas Accounting yang ditugaskan kepada Anda.');
      }
      if (currentUser.role === 'Staff Tax' && (job.division !== 'Tax' || job.picId !== currentUser.userId)) {
        throw new Error('Akses ditolak: pekerjaan ini bukan tugas Tax yang ditugaskan kepada Anda.');
      }
      if (currentUser.role === 'SPV Accounting' && (job.division !== 'Accounting' || job.spvId !== currentUser.userId)) {
        throw new Error('Akses ditolak: hanya SPV Accounting yang ditugaskan sebagai reviewer dapat memperbarui pekerjaan ini.');
      }
      if (currentUser.role === 'SPV Tax' && (job.division !== 'Tax' || job.spvId !== currentUser.userId)) {
        throw new Error('Akses ditolak: hanya SPV Tax yang ditugaskan sebagai reviewer dapat memperbarui pekerjaan ini.');
      }
      const isAssignedReviewer = currentUser.role === 'Admin' ||
        (currentUser.role.startsWith('SPV') && job.spvId === currentUser.userId);
      const protectedFields = ['title', 'priority', 'startDate', 'deadline', 'description', 'picId', 'picName', 'spvId', 'spvName'];
      if (!isAssignedReviewer && protectedFields.some((field) => updates[field] !== undefined && updates[field] !== (job as any)[field])) {
        throw new Error('Akses ditolak: hanya Admin atau reviewer tugas yang dapat mengubah detail pekerjaan.');
      }
      if (currentUser.role !== 'Admin' && (updates.spvId !== undefined || updates.spvName !== undefined)) {
        throw new Error('Penggantian reviewer tugas hanya dapat dilakukan Admin.');
      }

      const isValidDate = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
      if (updates.title !== undefined && (typeof updates.title !== 'string' || !updates.title.trim() || updates.title.trim().length > 200)) {
        throw new Error('Judul pekerjaan wajib diisi dan maksimal 200 karakter.');
      }
      if (updates.priority !== undefined && !['Rendah', 'Sedang', 'Tinggi', 'Mendesak'].includes(updates.priority)) {
        throw new Error('Prioritas pekerjaan tidak valid.');
      }
      if (updates.startDate !== undefined && !isValidDate(updates.startDate)) throw new Error('Tanggal mulai harus berformat YYYY-MM-DD.');
      if (updates.deadline !== undefined && !isValidDate(updates.deadline)) throw new Error('Deadline harus berformat YYYY-MM-DD.');
      if (updates.progressPercent !== undefined && (!Number.isInteger(Number(updates.progressPercent)) || Number(updates.progressPercent) < 0 || Number(updates.progressPercent) > 100)) {
        throw new Error('Progres pekerjaan harus berupa bilangan bulat 0–100.');
      }
      if (updates.status !== undefined && !['Belum Dimulai', 'Dalam Proses', 'Menunggu Klien', 'Siap Direview', 'Perlu Revisi', 'Selesai'].includes(updates.status)) {
        throw new Error('Status pekerjaan tidak valid.');
      }

      // Concurrency version check
      if (updates.expectedVersion !== undefined && job.version !== updates.expectedVersion) {
        throw new Error(
          `Konflik Perubahan: Pekerjaan ini telah diperbarui oleh pengguna lain (Versi ${job.version}). Muat ulang data terbaru terlebih dahulu.`
        );
      }

      // CRITICAL RBAC CHECK: only the assigned reviewer may approve the job.
      if (updates.status === 'Selesai' && job.status !== 'Selesai') {
        const isAuthorizedReviewer = currentUser.role === 'Admin' ||
          (currentUser.role.startsWith('SPV') && job.spvId === currentUser.userId &&
            ((currentUser.role === 'SPV Accounting' && job.division === 'Accounting') ||
              (currentUser.role === 'SPV Tax' && job.division === 'Tax')));

        if (!isAuthorizedReviewer) {
          throw new Error(
            'HAK AKSES DITOLAK: Staff atau SPV lintas divisi tidak dapat menyetujui pekerjaan (status Selesai). Persetujuan hanya dapat dilakukan oleh SPV divisi terkait atau Admin.'
          );
        }

        if (currentUser.role !== 'Admin' && job.status !== 'Siap Direview') {
          throw new Error('SPV hanya dapat menyelesaikan pekerjaan yang sudah diajukan untuk review.');
        }
        job.completedAt = new Date().toISOString();
        job.approvedBy = currentUser.name;
      }

      // Check if assigned reviewer requests a revision.
      if (updates.status === 'Perlu Revisi' && job.status !== 'Perlu Revisi') {
        const isAuthorizedReviewer = currentUser.role === 'Admin' ||
          (currentUser.role.startsWith('SPV') && job.spvId === currentUser.userId &&
            ((currentUser.role === 'SPV Accounting' && job.division === 'Accounting') ||
              (currentUser.role === 'SPV Tax' && job.division === 'Tax')));

        if (!isAuthorizedReviewer) {
          throw new Error('Hanya SPV penanggung jawab atau Admin yang dapat meminta revisi pekerjaan.');
        }

        if (currentUser.role !== 'Admin' && job.status !== 'Siap Direview') {
          throw new Error('SPV hanya dapat meminta revisi setelah pekerjaan diajukan untuk review.');
        }
        if (!updates.reviewNotes && !updates.notes) {
          throw new Error('Catatan evaluasi/revisi dari SPV wajib dicantumkan saat meminta revisi.');
        }
      }

      // Record History item
      const statusChanged = updates.status && updates.status !== job.status;
      const detailChanged = ['title', 'priority', 'startDate', 'deadline', 'description', 'spvId']
        .some((field) => updates[field] !== undefined && updates[field] !== (job as any)[field]);
      const historyAction = statusChanged
        ? updates.status === 'Selesai'
          ? 'Persetujuan Selesai oleh SPV'
          : updates.status === 'Perlu Revisi'
          ? 'Permintaan Revisi oleh SPV'
          : updates.status === 'Siap Direview'
          ? 'Pengajuan Review ke SPV'
          : `Perubahan Status ke ${updates.status}`
        : detailChanged ? 'Pembaruan Detail Tugas' : 'Pembaruan Progres / Catatan';

      const historyItem = {
        id: `JH-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        timestamp: new Date().toISOString(),
        userId: currentUser.userId,
        userName: currentUser.name,
        action: historyAction,
        fromStatus: job.status,
        toStatus: updates.status || job.status,
        notes: updates.historyNote || updates.reviewNotes || updates.notes || `Progres: ${updates.progressPercent ?? job.progressPercent}%`,
      };

      job.history = job.history || [];
      job.history.push(historyItem);

      // Increment version
      job.version = (job.version || 1) + 1;
      job.updatedAt = new Date().toISOString();
      job.updatedBy = currentUser.name;

      // Apply updates
      if (updates.title !== undefined) job.title = String(updates.title).trim();
      if (updates.priority !== undefined) job.priority = updates.priority;
      if (updates.startDate !== undefined) job.startDate = updates.startDate;
      if (updates.deadline !== undefined) job.deadline = updates.deadline;
      if (updates.description !== undefined) job.description = updates.description;
      if (updates.spvId !== undefined) {
        const reviewerRole = job.division === 'Accounting' ? 'SPV Accounting' : 'SPV Tax';
        const reviewer = database.users.find((user) => user.id === updates.spvId && user.active && user.role === reviewerRole);
        if (!reviewer) throw new Error(`Reviewer aktif dengan peran ${reviewerRole} wajib dipilih.`);
        job.spvId = reviewer.id;
        job.spvName = reviewer.name;
      }
      if (updates.notes !== undefined) job.notes = updates.notes;
      if (updates.picId !== undefined) job.picId = updates.picId;
      if (updates.picName !== undefined) job.picName = updates.picName;
      if (updates.progressPercent !== undefined) job.progressPercent = Number(updates.progressPercent);
      if (updates.status !== undefined) job.status = updates.status;
      if (updates.reviewNotes !== undefined) job.reviewNotes = updates.reviewNotes;

      savedJob = job;

      logAudit(
        'JOB_UPDATED',
        'Job',
        `Pekerjaan ${job.id} diperbarui: ${historyAction}. Status saat ini: ${job.status}.`,
        { userId: currentUser.userId, name: currentUser.name, role: currentUser.role },
        job.id,
        job.title
      );
    });

    res.json({
      success: true,
      job: savedJob,
      message: 'Pekerjaan berhasil diperbarui di memori server sementara.',
    });
  }
);

// Hapus Pekerjaan (Admin, SPV Accounting, SPV Tax)
apiRouter.delete(
  '/jobs/:id',
  authenticateToken,
  requireRole('Admin', 'SPV Accounting', 'SPV Tax'),
  requireWritable,
  (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    let deletedTitle = '';

    mutateDb((database) => {
      const idx = database.jobs.findIndex((j) => j.id === id);
      if (idx === -1) throw new Error('Pekerjaan tidak ditemukan.');

      const target = database.jobs[idx];
      // Role scope check
      if (req.user?.role === 'SPV Accounting' && (target.division !== 'Accounting' || target.spvId !== req.user.userId)) {
        throw new Error('SPV Accounting hanya dapat menghapus pekerjaan yang menjadi tanggung jawab review-nya.');
      }
      if (req.user?.role === 'SPV Tax' && (target.division !== 'Tax' || target.spvId !== req.user.userId)) {
        throw new Error('SPV Tax hanya dapat menghapus pekerjaan yang menjadi tanggung jawab review-nya.');
      }

      const deleted = database.jobs.splice(idx, 1)[0];
      deletedTitle = deleted.title;

      logAudit(
        'JOB_DELETED',
        'Job',
        `Pekerjaan '${deleted.title}' (${deleted.id}) untuk klien ${deleted.clientName} dihapus oleh ${req.user?.name}.`,
        { userId: req.user!.userId, name: req.user!.name, role: req.user!.role },
        deleted.id,
        deleted.title
      );
    });

    res.json({
      success: true,
      message: `Pekerjaan '${deletedTitle}' (${id}) berhasil dihapus dari database.`,
    });
  }
);

// ==========================================
// 7. CASE REGISTER & FOLLOW-UP TRACKER
// ==========================================
apiRouter.get('/cases', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const db = getDb();
  let results = [...db.cases];
  const { division, status, priority, clientId, picId } = req.query;

  if (division) results = results.filter((c) => c.division === division);
  if (status) results = results.filter((c) => c.status === status);
  if (priority) results = results.filter((c) => c.priority === priority);
  if (clientId) results = results.filter((c) => c.clientId === clientId);
  if (picId) results = results.filter((c) => c.picId === picId || c.followUpPicId === picId);

  res.json(results);
});

apiRouter.post(
  '/cases',
  authenticateToken,
  requireWritable,
  (req: AuthenticatedRequest, res: Response) => {
    const data = req.body;
    if (!data.clientId || !data.title || !data.division || !data.description) {
      res.status(400).json({ error: 'Klien, judul, divisi, dan uraian masalah wajib diisi.' });
      return;
    }
    if (!['Accounting', 'Tax'].includes(data.division)) {
      res.status(400).json({ error: 'Divisi kasus tidak valid.' });
      return;
    }
    if (!hasDivisionAccess(req.user!.role, data.division)) {
      res.status(403).json({ error: 'Anda hanya dapat membuat kasus untuk divisi sendiri.' });
      return;
    }

    const db = getDb();
    const client = db.clients.find((candidate) => candidate.id === data.clientId);
    if (!client) {
      res.status(404).json({ error: 'Klien tidak ditemukan.' });
      return;
    }
    const spvIsPic = data.division === 'Accounting' ? client.accountingSpvIsPic : client.taxSpvIsPic;
    const expectedPicRole = spvIsPic ? `SPV ${data.division}` : `Staff ${data.division}`;
    const expectedOwnerId = spvIsPic
      ? data.division === 'Accounting' ? client.accountingSpvId : client.taxSpvId
      : undefined;
    const assignedPic = db.users.find((user) =>
      user.id === data.picId &&
      user.active &&
      user.role === expectedPicRole &&
      (!expectedOwnerId || user.id === expectedOwnerId)
    );
    if (!assignedPic) {
      res.status(400).json({ error: 'PIC harus sesuai dengan penanggung jawab utama klien dan divisinya.' });
      return;
    }

    const year = new Date().getFullYear();
    const nextNumber = db.cases.length + 1;
    const newId = `CAS-${year}-${String(nextNumber).padStart(3, '0')}`;

    const newCase: Case = {
      id: newId,
      createdAt: new Date().toISOString(),
      clientId: data.clientId,
      clientName: data.clientName || 'Klien',
      division: data.division,
      title: data.title.trim(),
      description: data.description.trim(),
      priority: data.priority || 'Sedang',
      picId: assignedPic.id,
      picName: assignedPic.name,
      rootCause: data.rootCause || '',
      actionsTaken: data.actionsTaken || '',
      latestProgress: data.latestProgress || '',
      status: data.status || 'Open',
      followUpPlan: data.followUpPlan || '',
      nextFollowUpDate: data.nextFollowUpDate || new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
      followUpPicId: data.followUpPicId || data.picId || req.user?.userId || '',
      followUpPicName: data.followUpPicName || data.picName || req.user?.name || '',
      version: 1,
      timeline: [
        {
          id: `CTL-${Date.now()}-1`,
          date: new Date().toISOString().split('T')[0],
          userId: req.user?.userId || '',
          userName: req.user?.name || '',
          activity: 'Pencatatan awal kasus baru.',
          notes: data.description,
          nextStep: data.followUpPlan || 'Analisis dokumen pendukung.',
        },
      ],
      updatedAt: new Date().toISOString(),
      updatedBy: req.user?.name,
    };

    mutateDb((database) => {
      database.cases.unshift(newCase);
      logAudit(
        'CASE_CREATED',
        'Case',
        `Kasus baru ${newCase.id} (${newCase.title}) dicatat untuk ${newCase.clientName}.`,
        { userId: req.user!.userId, name: req.user!.name, role: req.user!.role },
        newCase.id,
        newCase.title
      );
    });

    res.status(201).json({
      success: true,
      case: newCase,
      message: 'Kasus berhasil dicatat di Case Register dan tersimpan sementara di memori server.',
    });
  }
);

apiRouter.put(
  '/cases/:id',
  authenticateToken,
  requireWritable,
  (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const updates = req.body;
    const targetCase = getDb().cases.find((item) => item.id === id);
    if (!targetCase) {
      res.status(404).json({ error: 'Kasus tidak ditemukan.' });
      return;
    }
    const user = req.user!;
    const isAssignedStaff = !user.role.startsWith('Staff') ||
      targetCase.picId === user.userId || targetCase.followUpPicId === user.userId;
    if (!hasDivisionAccess(user.role, targetCase.division) || !isAssignedStaff ||
        (updates.division && updates.division !== targetCase.division && user.role !== 'Admin')) {
      res.status(403).json({ error: 'Anda tidak memiliki izin mengubah kasus di divisi ini.' });
      return;
    }
    let savedCase: Case | null = null;

    mutateDb((database) => {
      const item = database.cases.find((c) => c.id === id);
      if (!item) throw new Error('Kasus tidak ditemukan.');

      if (updates.status === 'Resolved' && item.status !== 'Resolved') {
        item.resolvedAt = new Date().toISOString();
        item.resolutionNotes = updates.resolutionNotes || 'Kasus diselesaikan oleh tim konsultasi.';
      }

      item.version = (item.version || 1) + 1;
      item.updatedAt = new Date().toISOString();
      item.updatedBy = req.user?.name;

      Object.assign(item, updates, {
        version: item.version,
        updatedAt: item.updatedAt,
        updatedBy: item.updatedBy,
      });

      savedCase = item;

      logAudit(
        'CASE_UPDATED',
        'Case',
        `Kasus ${item.id} diperbarui. Status: ${item.status}. Follow-up berikutnya: ${item.nextFollowUpDate}.`,
        { userId: req.user!.userId, name: req.user!.name, role: req.user!.role },
        item.id,
        item.title
      );
    });

    res.json({
      success: true,
      case: savedCase,
      message: 'Kasus berhasil diperbarui dan disimpan di database.',
    });
  }
);

apiRouter.post(
  '/cases/:id/timeline',
  authenticateToken,
  requireWritable,
  (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { activity, notes, nextStep, date } = req.body;

    if (!activity) {
      res.status(400).json({ error: 'Uraian aktivitas tindakan kasus wajib diisi.' });
      return;
    }

    const targetCase = getDb().cases.find((item) => item.id === id);
    if (!targetCase) {
      res.status(404).json({ error: 'Kasus tidak ditemukan.' });
      return;
    }
    const user = req.user!;
    const isAssignedStaff = !user.role.startsWith('Staff') ||
      targetCase.picId === user.userId || targetCase.followUpPicId === user.userId;
    if (!hasDivisionAccess(user.role, targetCase.division) || !isAssignedStaff) {
      res.status(403).json({ error: 'Anda tidak memiliki izin menambahkan tindakan pada kasus ini.' });
      return;
    }
    let updatedCase: Case | null = null;

    mutateDb((database) => {
      const item = database.cases.find((c) => c.id === id);
      if (!item) throw new Error('Kasus tidak ditemukan.');

      const timelineItem = {
        id: `CTL-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        date: date || new Date().toISOString().split('T')[0],
        userId: req.user?.userId || '',
        userName: req.user?.name || '',
        activity: activity.trim(),
        notes: notes || '',
        nextStep: nextStep || '',
      };

      item.timeline = item.timeline || [];
      item.timeline.push(timelineItem);
      item.latestProgress = activity.trim();
      if (nextStep) item.followUpPlan = nextStep;
      item.version = (item.version || 1) + 1;
      item.updatedAt = new Date().toISOString();
      item.updatedBy = req.user?.name;
      updatedCase = item;

      logAudit(
        'CASE_TIMELINE_ADDED',
        'Case',
        `Aktivitas baru ditambahkan pada Kasus ${item.id}: ${activity.trim()}`,
        { userId: req.user!.userId, name: req.user!.name, role: req.user!.role },
        item.id,
        item.title
      );
    });

    res.status(201).json({
      success: true,
      case: updatedCase,
      message: 'Catatan tindakan kasus berhasil ditambahkan ke memori server sementara.',
    });
  }
);

// Hapus Kasus (Admin, SPV Accounting, SPV Tax)
apiRouter.delete(
  '/cases/:id',
  authenticateToken,
  requireRole('Admin', 'SPV Accounting', 'SPV Tax'),
  requireWritable,
  (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    let deletedTitle = '';

    mutateDb((database) => {
      const idx = database.cases.findIndex((c) => c.id === id);
      if (idx === -1) throw new Error('Kasus tidak ditemukan.');

      const target = database.cases[idx];
      // Role scope check
      if (req.user?.role === 'SPV Accounting' && target.division !== 'Accounting') {
        throw new Error('SPV Accounting hanya dapat menghapus kasus divisi Accounting.');
      }
      if (req.user?.role === 'SPV Tax' && target.division !== 'Tax') {
        throw new Error('SPV Tax hanya dapat menghapus kasus divisi Tax.');
      }

      const deleted = database.cases.splice(idx, 1)[0];
      deletedTitle = deleted.title;

      logAudit(
        'CASE_DELETED',
        'Case',
        `Kasus '${deleted.title}' (${deleted.id}) untuk klien ${deleted.clientName} dihapus oleh ${req.user?.name}.`,
        { userId: req.user!.userId, name: req.user!.name, role: req.user!.role },
        deleted.id,
        deleted.title
      );
    });

    res.json({
      success: true,
      message: `Kasus '${deletedTitle}' (${id}) berhasil dihapus dari Case Register.`,
    });
  }
);

// Hapus Item Tindakan Timeline Kasus (Follow-up item)
apiRouter.delete(
  '/cases/:id/timeline/:timelineId',
  authenticateToken,
  requireWritable,
  (req: AuthenticatedRequest, res: Response) => {
    const { id, timelineId } = req.params;
    let updatedCase: Case | null = null;

    mutateDb((database) => {
      const targetCase = database.cases.find((c) => c.id === id);
      if (!targetCase) throw new Error('Kasus tidak ditemukan.');
      if (!hasDivisionAccess(req.user!.role, targetCase.division)) {
        throw new Error('Anda tidak memiliki izin mengubah kasus di divisi ini.');
      }

      targetCase.timeline = targetCase.timeline || [];
      const itemIdx = targetCase.timeline.findIndex((t) => t.id === timelineId);
      if (itemIdx === -1) throw new Error('Catatan tindakan tidak ditemukan.');

      // Check author or SPV/Admin
      const item = targetCase.timeline[itemIdx];
      const isPrivileged =
        req.user?.role === 'Admin' ||
        req.user?.role === 'SPV Accounting' ||
        req.user?.role === 'SPV Tax';

      if (!isPrivileged && item.userId && item.userId !== req.user?.userId) {
        throw new Error('Hanya pembuat catatan atau SPV/Admin yang dapat menghapus catatan ini.');
      }

      targetCase.timeline.splice(itemIdx, 1);
      targetCase.version = (targetCase.version || 1) + 1;
      targetCase.updatedAt = new Date().toISOString();
      targetCase.updatedBy = req.user?.name;
      updatedCase = targetCase;

      logAudit(
        'CASE_TIMELINE_DELETED',
        'Case',
        `Catatan timeline tindakan pada Kasus ${targetCase.id} dihapus oleh ${req.user?.name}.`,
        { userId: req.user!.userId, name: req.user!.name, role: req.user!.role },
        targetCase.id,
        targetCase.title
      );
    });

    res.json({
      success: true,
      case: updatedCase,
      message: 'Catatan tindakan berhasil dihapus dari riwayat kasus.',
    });
  }
);

// ==========================================
// 8. DAILY ACTIVITY LOG
// ==========================================
apiRouter.get('/daily-activities', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const db = getDb();
  let results = [...db.activities];
  const { date, division, picId, clientId, jobId, caseId } = req.query;

  if (date) results = results.filter((a) => a.date === date);
  if (division) results = results.filter((a) => a.division === division);
  if (picId) results = results.filter((a) => a.picId === picId);
  if (clientId) results = results.filter((a) => a.clientId === clientId);
  if (jobId) results = results.filter((a) => a.jobId === jobId);
  if (caseId) results = results.filter((a) => a.caseId === caseId);

  res.json(results);
});

apiRouter.post(
  '/daily-activities',
  authenticateToken,
  requireWritable,
  (req: AuthenticatedRequest, res: Response) => {
    const data = req.body;
    if (!data.clientId || !data.description || !data.division) {
      res.status(400).json({ error: 'Klien, divisi, dan deskripsi aktivitas wajib diisi.' });
      return;
    }
    if (!['Accounting', 'Tax'].includes(data.division)) {
      res.status(400).json({ error: 'Divisi aktivitas tidak valid.' });
      return;
    }
    if (!hasDivisionAccess(req.user!.role, data.division)) {
      res.status(403).json({ error: 'Anda hanya dapat mencatat aktivitas untuk divisi sendiri.' });
      return;
    }

    const db = getDb();
    const nextNumber = db.activities.length + 1;
    const newId = `ACT-${new Date().getFullYear()}-${String(nextNumber).padStart(3, '0')}`;

    const newActivity: DailyActivity = {
      id: newId,
      date: data.date || new Date().toISOString().split('T')[0],
      clientId: data.clientId,
      clientName: data.clientName || 'Klien',
      division: data.division,
      picId: req.user?.userId || data.picId || '',
      picName: req.user?.name || data.picName || '',
      picRole: req.user?.role || '',
      jobId: data.jobId || undefined,
      caseId: data.caseId || undefined,
      description: data.description.trim(),
      resultProgress: data.resultProgress || '',
      obstacles: data.obstacles || '',
      followUp: data.followUp || '',
      status: data.status || 'Selesai',
      durationMinutes: Number(data.durationMinutes) || 60,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: req.user?.name,
    };

    mutateDb((database) => {
      database.activities.unshift(newActivity);
      logAudit(
        'ACTIVITY_LOGGED',
        'Activity',
        `Log aktivitas ${newActivity.id} dicatat oleh ${newActivity.picName} untuk ${newActivity.clientName}.`,
        { userId: req.user!.userId, name: req.user!.name, role: req.user!.role },
        newActivity.id
      );
    });

    res.status(201).json({
      success: true,
      activity: newActivity,
      message: 'Aktivitas harian berhasil dicatat dan disimpan di database.',
    });
  }
);

apiRouter.put(
  '/daily-activities/:id',
  authenticateToken,
  requireWritable,
  (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const updates = req.body;
    let saved: DailyActivity | null = null;

    mutateDb((database) => {
      const act = database.activities.find((a) => a.id === id);
      if (!act) throw new Error('Aktivitas tidak ditemukan.');

      const user = req.user!;
      if (!hasDivisionAccess(user.role, act.division) ||
          (user.role.startsWith('Staff') && act.picId !== user.userId) ||
          (updates.division && updates.division !== act.division && user.role !== 'Admin')) {
        throw new Error('Anda tidak memiliki izin memperbarui aktivitas di divisi ini.');
      }

      Object.assign(act, updates, {
        updatedAt: new Date().toISOString(),
        updatedBy: req.user?.name,
      });
      saved = act;
    });

    res.json({
      success: true,
      activity: saved,
      message: 'Aktivitas harian berhasil diperbarui.',
    });
  }
);

apiRouter.delete(
  '/daily-activities/:id',
  authenticateToken,
  requireWritable,
  (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    mutateDb((database) => {
      const index = database.activities.findIndex((a) => a.id === id);
      if (index === -1) throw new Error('Aktivitas tidak ditemukan.');

      const user = req.user!;
      const activity = database.activities[index];
      if (!hasDivisionAccess(user.role, activity.division) ||
          (user.role.startsWith('Staff') && activity.picId !== user.userId)) {
        throw new Error('Anda tidak memiliki izin menghapus aktivitas di divisi ini.');
      }

      const deleted = database.activities.splice(index, 1)[0];
      logAudit(
        'ACTIVITY_DELETED',
        'Activity',
        `Log aktivitas ${deleted.id} dihapus oleh ${req.user?.name}.`,
        { userId: req.user!.userId, name: req.user!.name, role: req.user!.role },
        deleted.id
      );
    });

    res.json({ success: true, message: 'Log aktivitas berhasil dihapus.' });
  }
);

// ==========================================
// 9. TEAM AGENDA
// ==========================================
apiRouter.get('/agenda', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const entries = [...(getDb().agendaEntries || [])].sort((a, b) =>
    `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`)
  );
  res.json(entries);
});

apiRouter.post(
  '/agenda',
  authenticateToken,
  requireWritable,
  (req: AuthenticatedRequest, res: Response) => {
    const database = getDb();
    const data = normalizeAgendaEntry(req.body, database.users);
    if (hasUnknownUserIds(data.participantUserIds || [], database.users)) {
      res.status(400).json({ error: 'Salah satu peserta internal tidak ditemukan.' });
      return;
    }
    const validationError = validateAgendaEntry(data);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const client = data.clientId ? database.clients.find((item) => item.id === data.clientId) : undefined;
    const job = data.jobId ? database.jobs.find((item) => item.id === data.jobId) : undefined;
    if (data.clientId && !client) {
      res.status(400).json({ error: 'Klien terkait tidak ditemukan.' });
      return;
    }
    if (data.jobId && (!job || (client && job.clientId !== client.id))) {
      res.status(400).json({ error: 'Pekerjaan tidak ditemukan atau tidak terkait dengan klien yang dipilih.' });
      return;
    }

    const linkedClient = client || (job ? database.clients.find((item) => item.id === job.clientId) : undefined);
    const year = data.date.slice(0, 4);
    const nextNumber = database.agendaEntries
      .map((entry) => entry.id.match(new RegExp(`^AGD-${year}-(\\d+)$`)))
      .reduce((highest, match) => Math.max(highest, Number(match?.[1] || 0)), 0) + 1;
    const now = new Date().toISOString();
    const newEntry: TeamAgendaEntry = {
      ...data,
      clientId: linkedClient?.id,
      clientName: linkedClient?.name,
      jobId: job?.id,
      jobTitle: job?.title,
      id: `AGD-${year}-${String(nextNumber).padStart(3, '0')}`,
      createdAt: now,
      updatedAt: now,
      createdBy: req.user!.userId,
      updatedBy: req.user!.name,
    };

    mutateDb((db) => {
      db.agendaEntries.unshift(newEntry);
      logAudit(
        'AGENDA_CREATED',
        'Meeting',
        `Agenda ${newEntry.id} dicatat oleh ${req.user!.name}.`,
        { userId: req.user!.userId, name: req.user!.name, role: req.user!.role },
        newEntry.id,
        newEntry.title
      );
    });

    res.status(201).json({ success: true, agenda: newEntry, message: 'Agenda berhasil disimpan.' });
  }
);

apiRouter.put(
  '/agenda/:id',
  authenticateToken,
  requireWritable,
  (req: AuthenticatedRequest, res: Response) => {
    const database = getDb();
    const data = normalizeAgendaEntry(req.body, database.users);
    if (hasUnknownUserIds(data.participantUserIds || [], database.users)) {
      res.status(400).json({ error: 'Salah satu peserta internal tidak ditemukan.' });
      return;
    }
    const validationError = validateAgendaEntry(data);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const client = data.clientId ? database.clients.find((item) => item.id === data.clientId) : undefined;
    const job = data.jobId ? database.jobs.find((item) => item.id === data.jobId) : undefined;
    if (data.clientId && !client) {
      res.status(400).json({ error: 'Klien terkait tidak ditemukan.' });
      return;
    }
    if (data.jobId && (!job || (client && job.clientId !== client.id))) {
      res.status(400).json({ error: 'Pekerjaan tidak ditemukan atau tidak terkait dengan klien yang dipilih.' });
      return;
    }

    let saved: TeamAgendaEntry | null = null;
    mutateDb((db) => {
      const entry = db.agendaEntries.find((item) => item.id === req.params.id);
      if (!entry) throw new Error('Agenda tidak ditemukan.');
      const linkedClient = client || (job ? db.clients.find((item) => item.id === job.clientId) : undefined);
      Object.assign(entry, data, {
        clientId: linkedClient?.id,
        clientName: linkedClient?.name,
        jobId: job?.id,
        jobTitle: job?.title,
        updatedAt: new Date().toISOString(),
        updatedBy: req.user!.name,
      });
      saved = entry;
      logAudit(
        'AGENDA_UPDATED',
        'Meeting',
        `Agenda ${entry.id} diperbarui oleh ${req.user!.name}.`,
        { userId: req.user!.userId, name: req.user!.name, role: req.user!.role },
        entry.id,
        entry.title
      );
    });

    res.json({ success: true, agenda: saved, message: 'Agenda berhasil diperbarui.' });
  }
);

apiRouter.delete(
  '/agenda/:id',
  authenticateToken,
  requireWritable,
  (req: AuthenticatedRequest, res: Response) => {
    let deleted: TeamAgendaEntry | undefined;
    mutateDb((db) => {
      const index = db.agendaEntries.findIndex((item) => item.id === req.params.id);
      if (index === -1) throw new Error('Agenda tidak ditemukan.');
      deleted = db.agendaEntries.splice(index, 1)[0];
      logAudit(
        'AGENDA_DELETED',
        'Meeting',
        `Agenda ${deleted.id} dihapus oleh ${req.user!.name}.`,
        { userId: req.user!.userId, name: req.user!.name, role: req.user!.role },
        deleted.id,
        deleted.title
      );
    });

    res.json({ success: true, message: 'Agenda berhasil dihapus.' });
  }
);

// ==========================================
// 10. MINUTES OF MEETING
// ==========================================
apiRouter.get('/meeting-minutes', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const meetings = [...(getDb().meetingMinutes || [])].sort((a, b) =>
    `${b.meetingDate}${b.startTime}`.localeCompare(`${a.meetingDate}${a.startTime}`)
  );
  res.json(meetings);
});

apiRouter.post(
  '/meeting-minutes',
  authenticateToken,
  requireWritable,
  (req: AuthenticatedRequest, res: Response) => {
    const database = getDb();
    const data = normalizeMeetingMinute(req.body, database.users);
    const referencedUserIds = [
      ...(data.attendeeUserIds || []),
      ...data.actionItems.flatMap((item: MeetingActionItem) => item.ownerUserId ? [item.ownerUserId] : []),
    ];
    if (hasUnknownUserIds(referencedUserIds, database.users)) {
      res.status(400).json({ error: 'Salah satu peserta atau penanggung jawab internal tidak ditemukan.' });
      return;
    }
    const validationError = validateMeetingMinute(data);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const year = data.meetingDate.slice(0, 4);
    const nextNumber = database.meetingMinutes
      .map((meeting) => meeting.id.match(new RegExp(`^MOM-${year}-(\\d+)$`)))
      .reduce((highest, match) => Math.max(highest, Number(match?.[1] || 0)), 0) + 1;
    const now = new Date().toISOString();
    const newMeeting: MeetingMinute = {
      ...data,
      id: `MOM-${year}-${String(nextNumber).padStart(3, '0')}`,
      createdAt: now,
      updatedAt: now,
      createdBy: req.user!.userId,
      updatedBy: req.user!.name,
    };

    mutateDb((db) => {
      db.meetingMinutes.unshift(newMeeting);
      logAudit(
        'MEETING_CREATED',
        'Meeting',
        `Notulen ${newMeeting.id} dicatat oleh ${req.user!.name}.`,
        { userId: req.user!.userId, name: req.user!.name, role: req.user!.role },
        newMeeting.id,
        newMeeting.title
      );
    });

    res.status(201).json({ success: true, meeting: newMeeting, message: 'Notulen rapat berhasil disimpan.' });
  }
);

apiRouter.put(
  '/meeting-minutes/:id',
  authenticateToken,
  requireWritable,
  (req: AuthenticatedRequest, res: Response) => {
    const database = getDb();
    const data = normalizeMeetingMinute(req.body, database.users);
    const referencedUserIds = [
      ...(data.attendeeUserIds || []),
      ...data.actionItems.flatMap((item: MeetingActionItem) => item.ownerUserId ? [item.ownerUserId] : []),
    ];
    if (hasUnknownUserIds(referencedUserIds, database.users)) {
      res.status(400).json({ error: 'Salah satu peserta atau penanggung jawab internal tidak ditemukan.' });
      return;
    }
    const validationError = validateMeetingMinute(data);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    let saved: MeetingMinute | null = null;
    mutateDb((db) => {
      const meeting = db.meetingMinutes.find((item) => item.id === req.params.id);
      if (!meeting) throw new Error('Notulen rapat tidak ditemukan.');

      Object.assign(meeting, data, {
        updatedAt: new Date().toISOString(),
        updatedBy: req.user!.name,
      });
      saved = meeting;
      logAudit(
        'MEETING_UPDATED',
        'Meeting',
        `Notulen ${meeting.id} diperbarui oleh ${req.user!.name}.`,
        { userId: req.user!.userId, name: req.user!.name, role: req.user!.role },
        meeting.id,
        meeting.title
      );
    });

    res.json({ success: true, meeting: saved, message: 'Notulen rapat berhasil diperbarui.' });
  }
);

apiRouter.delete(
  '/meeting-minutes/:id',
  authenticateToken,
  requireWritable,
  (req: AuthenticatedRequest, res: Response) => {
    let deleted: MeetingMinute | undefined;
    mutateDb((db) => {
      const index = db.meetingMinutes.findIndex((item) => item.id === req.params.id);
      if (index === -1) throw new Error('Notulen rapat tidak ditemukan.');
      deleted = db.meetingMinutes.splice(index, 1)[0];
      logAudit(
        'MEETING_DELETED',
        'Meeting',
        `Notulen ${deleted.id} dihapus oleh ${req.user!.name}.`,
        { userId: req.user!.userId, name: req.user!.name, role: req.user!.role },
        deleted.id,
        deleted.title
      );
    });

    res.json({ success: true, message: 'Notulen rapat berhasil dihapus.' });
  }
);

// ==========================================
// 10. DASHBOARD STATS AGGREGATOR
// ==========================================
apiRouter.get('/stats', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const db = getDb();
  const currentUser = req.user!;
  const today = new Date().toISOString().split('T')[0];
  const requestedDivision = req.query.division === 'Accounting' || req.query.division === 'Tax'
    ? req.query.division
    : undefined;
  const roleDivision = currentUser.role.includes('Accounting')
    ? 'Accounting'
    : currentUser.role.includes('Tax')
      ? 'Tax'
      : undefined;
  const division = roleDivision || requestedDivision;
  const isAccountingStaff = currentUser.role === 'Staff Accounting';
  const isTaxStaff = currentUser.role === 'Staff Tax';
  const isStaff = isAccountingStaff || isTaxStaff;

  const visibleJobs = db.jobs.filter((job) => {
    if (division && job.division !== division) return false;
    if (isStaff && job.picId !== currentUser.userId) return false;
    return true;
  });
  const directlyAssignedClients = db.clients.filter((client) => {
    if (isAccountingStaff) return client.accountingStaffPicId === currentUser.userId;
    if (isTaxStaff) return client.taxStaffPicId === currentUser.userId;
    if (currentUser.role === 'SPV Accounting') return client.accountingSpvId === currentUser.userId;
    if (currentUser.role === 'SPV Tax') return client.taxSpvId === currentUser.userId;
    return true;
  });
  const visibleClientIds = new Set([
    ...directlyAssignedClients.map((client) => client.id),
    ...visibleJobs.map((job) => job.clientId),
  ]);
  const dashboardClients = db.clients.filter((client) => visibleClientIds.has(client.id));
  const visibleCases = db.cases.filter((item) =>
    (!division || item.division === division) &&
    (!isStaff || item.picId === currentUser.userId || item.followUpPicId === currentUser.userId)
  );
  const visibleActivities = db.activities.filter((item) =>
    (!division || item.division === division) &&
    (!isStaff || item.picId === currentUser.userId)
  );

  const activeClients = dashboardClients.filter((client) => client.status === 'Aktif').length;
  const badanClients = dashboardClients.filter((client) => client.type === 'Badan').length;
  const opClients = dashboardClients.filter((client) => client.type === 'OP').length;
  const pkpCount = dashboardClients.filter((client) => client.pkpStatus === 'PKP').length;
  const nonPkpCount = dashboardClients.filter((client) => client.pkpStatus === 'Non-PKP').length;
  const unassignedPkp = dashboardClients.filter((client) => client.pkpStatus === 'Belum Diisi').length;
  const completePicCount = dashboardClients.filter((client) => client.picAssignmentStatus === 'Lengkap').length;
  const incompletePicCount = dashboardClients.filter((client) => client.picAssignmentStatus === 'Belum Lengkap').length;

  const pphRegimes: Record<string, number> = {};
  dashboardClients.forEach((client) => {
    pphRegimes[client.pphRegime] = (pphRegimes[client.pphRegime] || 0) + 1;
  });

  const accRisks = {
    High: dashboardClients.filter((client) => client.accountingRisk === 'High').length,
    Medium: dashboardClients.filter((client) => client.accountingRisk === 'Medium').length,
    Low: dashboardClients.filter((client) => client.accountingRisk === 'Low').length,
    NotAssessed: dashboardClients.filter((client) => client.accountingRisk === 'Not Assessed').length,
  };
  const taxRisks = {
    High: dashboardClients.filter((client) => client.taxRisk === 'High').length,
    Medium: dashboardClients.filter((client) => client.taxRisk === 'Medium').length,
    Low: dashboardClients.filter((client) => client.taxRisk === 'Low').length,
    NotAssessed: dashboardClients.filter((client) => client.taxRisk === 'Not Assessed').length,
  };

  const completedJobs = visibleJobs.filter((job) => job.status === 'Selesai').length;
  const readyForReviewJobs = visibleJobs.filter((job) => job.status === 'Siap Direview').length;
  const needsRevisionJobs = visibleJobs.filter((job) => job.status === 'Perlu Revisi').length;
  const inProgressJobs = visibleJobs.filter((job) => job.status === 'Dalam Proses').length;
  const overdueJobs = visibleJobs.filter((job) => job.status !== 'Selesai' && job.deadline < today);
  const openCases = visibleCases.filter((item) => item.status !== 'Resolved' && item.status !== 'Closed').length;
  const overdueFollowUps = visibleCases.filter(
    (item) => item.status !== 'Resolved' && item.status !== 'Closed' && item.nextFollowUpDate < today
  ).length;
  const casesAssignedToCurrentUser = visibleCases.filter((item) =>
    (item.picId === currentUser.userId || item.followUpPicId === currentUser.userId) &&
    item.status !== 'Resolved' && item.status !== 'Closed'
  );

  const workloadByPic: Record<string, { name: string; activeJobs: number; readyReview: number; overdue: number }> = {};
  visibleJobs.forEach((job) => {
    if (job.status === 'Selesai') return;
    const picKey = job.picId || job.picName || 'Unassigned';
    if (!workloadByPic[picKey]) {
      workloadByPic[picKey] = { name: job.picName || 'Unassigned', activeJobs: 0, readyReview: 0, overdue: 0 };
    }
    workloadByPic[picKey].activeJobs += 1;
    if (job.status === 'Siap Direview') workloadByPic[picKey].readyReview += 1;
    if (job.deadline < today) workloadByPic[picKey].overdue += 1;
  });

  res.json({
    clients: {
      total: dashboardClients.length,
      active: activeClients,
      badan: badanClients,
      op: opClients,
      pkp: pkpCount,
      nonPkp: nonPkpCount,
      unassignedPkp,
      completePicCount,
      incompletePicCount,
      pphRegimes,
      accRisks,
      taxRisks,
    },
    jobs: {
      total: visibleJobs.length,
      completed: completedJobs,
      readyForReview: readyForReviewJobs,
      needsRevision: needsRevisionJobs,
      inProgress: inProgressJobs,
      overdue: overdueJobs.length,
      overdueList: overdueJobs.slice(0, 5),
    },
    cases: {
      open: openCases,
      overdueFollowUps,
      total: visibleCases.length,
      assignedCount: casesAssignedToCurrentUser.length,
      assigned: casesAssignedToCurrentUser
        .sort((a, b) => a.nextFollowUpDate.localeCompare(b.nextFollowUpDate))
        .slice(0, 6)
        .map(({ id, title, clientName, division, priority, status, nextFollowUpDate }) => ({
          id, title, clientName, division, priority, status, nextFollowUpDate,
        })),
    },
    activities: {
      todayCount: visibleActivities.filter((activity) => activity.date === today).length,
      total: visibleActivities.length,
    },
    workload: Object.values(workloadByPic),
  });
});

// ==========================================
// 10. BACKUP & RESTORE (Admin Only)
// ==========================================
apiRouter.post(
  '/backup/now',
  authenticateToken,
  requireRole('Admin'),
  requireWritable,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { notes } = req.body;
    const backupInfo = await createBackupSnapshot('manual', notes, {
      userId: req.user!.userId,
      name: req.user!.name,
      role: req.user!.role,
    });
    res.json({
      success: true,
      backup: backupInfo,
      message: `Cadangan data manual '${backupInfo.filename}' berhasil dibuat dan diverifikasi di server.`,
    });
  })
);

apiRouter.get(
  '/backup/list',
  authenticateToken,
  requireRole('Admin'),
  (req: AuthenticatedRequest, res: Response) => {
    const db = getDb();
    res.json(db.backups || []);
  }
);

apiRouter.get(
  '/backup/download/:filename',
  authenticateToken,
  requireRole('Admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { filename } = req.params;
    const cleanFilename = path.basename(filename);
    const snapshot = await getBackupSnapshot(cleanFilename);

    if (!snapshot) {
      res.status(404).json({ error: 'Berkas cadangan tidak ditemukan di server.' });
      return;
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${cleanFilename}"`);
    res.send(JSON.stringify(snapshot, null, 2));
  })
);

apiRouter.post(
  '/backup/restore',
  authenticateToken,
  requireRole('Admin'),
  requireWritable,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { filename } = req.body;
    if (!filename) {
      res.status(400).json({ error: 'Nama berkas cadangan wajib disertakan untuk restore.' });
      return;
    }

    const cleanFilename = path.basename(filename);
    const result = await restoreFromSnapshot(cleanFilename, {
      userId: req.user!.userId,
      name: req.user!.name,
      role: req.user!.role,
    });

    res.json(result);
  })
);

// ==========================================
// 11. AUDIT LOGS (Admin, Owner, Manager)
// ==========================================
apiRouter.get(
  '/audit-logs',
  authenticateToken,
  requireRole('Admin', 'Owner', 'Manager'),
  (req: AuthenticatedRequest, res: Response) => {
    const db = getDb();
    const limit = Number(req.query.limit) || 200;
    res.json((db.auditLogs || []).slice(0, limit));
  }
);

// ==========================================
// 12. DAILY MANAGEMENT ACTIVITY EXPORT
// ==========================================
apiRouter.get(
  '/reports/daily-activities',
  authenticateToken,
  requireRole('Admin', 'Owner', 'Manager'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const reportDate = typeof req.query.date === 'string' ? req.query.date : '';
    const parsedDate = Date.parse(`${reportDate}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(reportDate) ||
      Number.isNaN(parsedDate) ||
      new Date(parsedDate).toISOString().slice(0, 10) !== reportDate
    ) {
      res.status(400).json({ error: 'Tanggal laporan harus menggunakan format YYYY-MM-DD yang valid.' });
      return;
    }

    const db = getDb();
    const formatJakartaDate = (value: string) => {
      const timestamp = Date.parse(value);
      return Number.isNaN(timestamp)
        ? ''
        : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(timestamp);
    };
    const formatJakartaTime = (value: string) => {
      const timestamp = Date.parse(value);
      return Number.isNaN(timestamp)
        ? '-'
        : new Intl.DateTimeFormat('id-ID', {
            timeZone: 'Asia/Jakarta',
            dateStyle: 'short',
            timeStyle: 'medium',
          }).format(timestamp);
    };
    const userRoles = new Map(db.users.map((user) => [user.id, user.role]));
    const activities = db.activities
      .filter((activity) => activity.date === reportDate)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const operationalTargets = new Set(['Client', 'Job', 'Case', 'Activity', 'Meeting']);
    const events = (db.auditLogs || [])
      .filter((log) => operationalTargets.has(log.targetType) && formatJakartaDate(log.timestamp) === reportDate)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'TMM/BMA Client Control Center';
    workbook.lastModifiedBy = req.user?.name || 'Management';
    workbook.created = new Date();
    workbook.modified = new Date();

    type ReportColumn = { header: string; width: number };
    type ReportValue = string | number;
    const addReportSheet = (
      name: string,
      title: string,
      columns: ReportColumn[],
      rows: ReportValue[][]
    ) => {
      const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', xSplit: 0, ySplit: 3 }] });
      sheet.columns = columns.map((column) => ({ width: column.width }));
      sheet.mergeCells(1, 1, 1, columns.length);
      sheet.getCell(1, 1).value = title;
      sheet.getCell(1, 1).font = { name: 'Arial', bold: true, size: 14, color: { argb: 'FF0F172A' } };
      sheet.getCell(1, 1).alignment = { vertical: 'middle' };
      sheet.getRow(1).height = 26;
      sheet.mergeCells(2, 1, 2, columns.length);
      sheet.getCell(2, 1).value = `Tanggal laporan: ${reportDate} (WIB) · Dibuat oleh ${req.user?.name} (${req.user?.role})`;
      sheet.getCell(2, 1).font = { name: 'Arial', italic: true, size: 9, color: { argb: 'FF64748B' } };
      sheet.getRow(2).height = 20;

      const headerRow = sheet.getRow(3);
      columns.forEach((column, index) => {
        const cell = headerRow.getCell(index + 1);
        cell.value = column.header;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
        cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF334155' } },
          bottom: { style: 'medium', color: { argb: 'FFD97706' } },
          left: { style: 'thin', color: { argb: 'FF334155' } },
          right: { style: 'thin', color: { argb: 'FF334155' } },
        };
      });
      headerRow.height = 28;
      sheet.autoFilter = {
        from: { row: 3, column: 1 },
        to: { row: Math.max(3, rows.length + 3), column: columns.length },
      };

      if (rows.length === 0) {
        const emptyRow = sheet.addRow(['Tidak ada aktivitas untuk tanggal ini.']);
        if (columns.length > 1) sheet.mergeCells(emptyRow.number, 1, emptyRow.number, columns.length);
        emptyRow.getCell(1).font = { name: 'Arial', italic: true, size: 10, color: { argb: 'FF64748B' } };
      } else {
        rows.forEach((values, index) => {
          const row = sheet.addRow(values);
          row.height = 24;
          row.eachCell((cell) => {
            cell.font = { name: 'Arial', size: 9, color: { argb: 'FF1E293B' } };
            cell.alignment = { vertical: 'middle', wrapText: true };
            cell.border = {
              top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
              bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
              left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
              right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            };
            if (index % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
          });
        });
      }
    };

    addReportSheet(
      'Aktivitas Harian',
      'CATATAN AKTIVITAS HARIAN STAFF & SPV',
      [
        { header: 'ID Aktivitas', width: 17 },
        { header: 'Jam Dicatat (WIB)', width: 23 },
        { header: 'Nama Pelaksana', width: 25 },
        { header: 'Peran', width: 20 },
        { header: 'Divisi', width: 14 },
        { header: 'Klien', width: 30 },
        { header: 'Referensi Job/Case', width: 20 },
        { header: 'Kegiatan yang Dikerjakan', width: 46 },
        { header: 'Hasil / Progres', width: 35 },
        { header: 'Kendala', width: 30 },
        { header: 'Tindak Lanjut', width: 32 },
        { header: 'Status', width: 18 },
        { header: 'Durasi (Menit)', width: 16 },
      ],
      activities.map((activity) => [
        activity.id,
        formatJakartaTime(activity.createdAt),
        activity.picName,
        activity.picRole || userRoles.get(activity.picId) || 'Tidak diketahui',
        activity.division,
        activity.clientName,
        activity.jobId ? `Job ${activity.jobId}` : activity.caseId ? `Case ${activity.caseId}` : '-',
        activity.description,
        activity.resultProgress || '-',
        activity.obstacles || '-',
        activity.followUp || '-',
        activity.status,
        activity.durationMinutes || 60,
      ])
    );

    addReportSheet(
      'Jejak Operasional',
      'JEJAK AKSI OPERASIONAL PENGGUNA',
      [
        { header: 'Waktu (WIB)', width: 23 },
        { header: 'Nama Pengguna', width: 25 },
        { header: 'Peran', width: 20 },
        { header: 'Aksi', width: 30 },
        { header: 'Jenis Data', width: 16 },
        { header: 'Klien / Referensi', width: 32 },
        { header: 'Rincian Aktivitas', width: 60 },
      ],
      events.map((event) => [
        formatJakartaTime(event.timestamp),
        event.userName,
        event.userRole,
        event.action,
        event.targetType,
        event.targetName || event.target || event.targetId || '-',
        typeof event.details === 'string' ? event.details : JSON.stringify(event.details ?? '-'),
      ])
    );

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="TMM_BMA_Aktivitas_Management_${reportDate}.xlsx"`);
    const buffer = await workbook.xlsx.writeBuffer();
    res.send(Buffer.from(buffer));
  })
);

// ==========================================
// 13. EXCEL EXPORT (TMM/BMA Management Activity Report)
// ==========================================
apiRouter.get(
  '/reports/excel',
  authenticateToken,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const db = getDb();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'TMM/BMA Client Control Center';
    workbook.lastModifiedBy = req.user?.name || 'Administrator';
    workbook.created = new Date();
    workbook.modified = new Date();

    const todayStr = new Date().toISOString().split('T')[0];

    // Helper for header styling
    const applyHeaderStyle = (row: ExcelJS.Row) => {
      row.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      row.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0B132B' }, // Dark Navy
      };
      row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      row.height = 26;
    };

    // -----------------------------------------------------------------
    // Sheet 1: Executive Summary
    // -----------------------------------------------------------------
    const ws1 = workbook.addWorksheet('Executive Summary', {
      views: [{ state: 'frozen', xSplit: 0, ySplit: 5 }],
    });

    ws1.columns = [
      { width: 32 },
      { width: 18 },
      { width: 35 },
      { width: 22 },
    ];

    ws1.mergeCells('A1:D1');
    ws1.getCell('A1').value = 'TMM/BMA MANAGEMENT ACTIVITY REPORT - EXECUTIVE SUMMARY';
    ws1.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF0B132B' } };
    ws1.getCell('A1').alignment = { vertical: 'middle' };

    ws1.mergeCells('A2:D2');
    ws1.getCell('A2').value = `Waktu Ekspor: ${new Date().toLocaleString('id-ID')} | Dicetak oleh: ${req.user?.name} (${req.user?.role})`;
    ws1.getCell('A2').font = { italic: true, size: 9, color: { argb: 'FF64748B' } };

    ws1.addRow([]);

    const summaryHeader = ws1.addRow(['Kategori Matriks', 'Nilai Terdata', 'Uraian Komposisi', 'Status Kepatuhan']);
    applyHeaderStyle(summaryHeader);

    const activeClients = db.clients.filter((c) => c.status === 'Aktif').length;
    const badanCount = db.clients.filter((c) => c.type === 'Badan').length;
    const opCount = db.clients.filter((c) => c.type === 'OP').length;
    const pkpCount = db.clients.filter((c) => c.pkpStatus === 'PKP').length;
    const nonPkpCount = db.clients.filter((c) => c.pkpStatus === 'Non-PKP').length;
    const completePicCount = db.clients.filter((c) => c.picAssignmentStatus === 'Lengkap').length;
    const incompletePicCount = db.clients.filter((c) => c.picAssignmentStatus === 'Belum Lengkap').length;

    const completedJobs = db.jobs.filter((j) => j.status === 'Selesai').length;
    const overdueJobs = db.jobs.filter((j) => j.status !== 'Selesai' && j.deadline < todayStr).length;
    const openCases = db.cases.filter((c) => c.status !== 'Resolved' && c.status !== 'Closed').length;
    const highRiskCount = db.clients.filter((c) => c.taxRisk === 'High' || c.accountingRisk === 'High').length;

    const summaryRows = [
      ['Total Klien Terdaftar', db.clients.length, `${activeClients} Klien Aktif, ${db.clients.length - activeClients} Tidak Aktif`, 'Tersinkronisasi'],
      ['Segmentasi Badan vs OP', `${badanCount} Badan / ${opCount} OP`, `${Math.round((badanCount / (db.clients.length || 1)) * 100)}% Badan Usaha`, 'Valid'],
      ['Kepatuhan Pengusaha Kena Pajak (PKP)', `${pkpCount} PKP / ${nonPkpCount} Non-PKP`, `${Math.round((pkpCount / (db.clients.length || 1)) * 100)}% Terdaftar PKP`, 'Sesuai SKT'],
      ['Status PIC Utama Klien', `${completePicCount} Lengkap / ${incompletePicCount} Belum`, 'PIC utama Accounting dan Tax beserta SPV reviewer', incompletePicCount > 0 ? 'Perlu Dilengkapi' : 'Lengkap 100%'],
      ['Total Pekerjaan (Jobs)', db.jobs.length, `${completedJobs} Selesai, ${overdueJobs} Terlambat`, overdueJobs > 0 ? 'Ada Keterlambatan' : 'Sesuai SLA'],
      ['Kasus Perpajakan & Akuntansi Terbuka', openCases, `${openCases} Case Aktif dalam Penanganan`, openCases > 0 ? 'Monitoring Aktif' : 'Nihil Kasus'],
      ['Eksposur Klien Risiko Tinggi (High Risk)', highRiskCount, `${highRiskCount} Klien Berisiko Pajak/Akuntansi Tinggi`, 'Mitigasi Berjalan'],
      ['Total Log Aktivitas Harian', db.activities.length, 'Catatan riil pekerjaan operasional konsultan', 'Aktif Harian'],
    ];

    summaryRows.forEach((r) => {
      const row = ws1.addRow(r);
      row.alignment = { vertical: 'middle' };
      row.getCell(2).alignment = { horizontal: 'center' };
      row.getCell(4).alignment = { horizontal: 'center' };
    });

    // -----------------------------------------------------------------
    // Sheet 2: Daily Activity
    // -----------------------------------------------------------------
    const ws2 = workbook.addWorksheet('Daily Activity', {
      views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
    });

    ws2.columns = [
      { header: 'Activity ID', key: 'id', width: 16 },
      { header: 'Tanggal', key: 'date', width: 14 },
      { header: 'Nama Klien', key: 'clientName', width: 30 },
      { header: 'Divisi', key: 'division', width: 14 },
      { header: 'PIC Pelaksana', key: 'picName', width: 24 },
      { header: 'Ref Job/Case', key: 'ref', width: 18 },
      { header: 'Deskripsi Aktivitas Nyata', key: 'description', width: 45 },
      { header: 'Hasil & Progres', key: 'resultProgress', width: 35 },
      { header: 'Kendala Ditemui', key: 'obstacles', width: 30 },
      { header: 'Rencana Tindak Lanjut', key: 'followUp', width: 30 },
      { header: 'Status', key: 'status', width: 16 },
      { header: 'Durasi (Menit)', key: 'durationMinutes', width: 15 },
    ];
    applyHeaderStyle(ws2.getRow(1));

    db.activities.forEach((act) => {
      const row = ws2.addRow({
        id: act.id,
        date: act.date,
        clientName: act.clientName,
        division: act.division,
        picName: act.picName,
        ref: act.jobId || act.caseId || '-',
        description: act.description,
        resultProgress: act.resultProgress || '-',
        obstacles: act.obstacles || '-',
        followUp: act.followUp || '-',
        status: act.status,
        durationMinutes: act.durationMinutes || 60,
      });
      row.alignment = { vertical: 'middle', wrapText: true };
      row.getCell('durationMinutes').alignment = { horizontal: 'center' };
    });

    // -----------------------------------------------------------------
    // Sheet 3: Case Register
    // -----------------------------------------------------------------
    const ws3 = workbook.addWorksheet('Case Register', {
      views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
    });

    ws3.columns = [
      { header: 'Case ID', key: 'id', width: 16 },
      { header: 'Tanggal Dibuat', key: 'createdAt', width: 15 },
      { header: 'Klien', key: 'clientName', width: 30 },
      { header: 'Divisi', key: 'division', width: 14 },
      { header: 'Judul Masalah', key: 'title', width: 35 },
      { header: 'Prioritas / Risiko', key: 'priority', width: 18 },
      { header: 'PIC Penanggung Jawab', key: 'picName', width: 24 },
      { header: 'Uraian Kasus & Temuan', key: 'description', width: 45 },
      { header: 'Akar Masalah (Root Cause)', key: 'rootCause', width: 35 },
      { header: 'Tindakan yang Dilakukan', key: 'actionsTaken', width: 35 },
      { header: 'Progres Terkini', key: 'latestProgress', width: 35 },
      { header: 'Status Kasus', key: 'status', width: 18 },
      { header: 'Target Follow-up', key: 'nextFollowUpDate', width: 16 },
      { header: 'Catatan Penyelesaian', key: 'resolutionNotes', width: 35 },
    ];
    applyHeaderStyle(ws3.getRow(1));

    db.cases.forEach((c) => {
      const row = ws3.addRow({
        id: c.id,
        createdAt: c.createdAt?.split('T')[0] || '-',
        clientName: c.clientName,
        division: c.division,
        title: c.title,
        priority: c.priority,
        picName: c.picName,
        description: c.description,
        rootCause: c.rootCause || '-',
        actionsTaken: c.actionsTaken || '-',
        latestProgress: c.latestProgress || '-',
        status: c.status,
        nextFollowUpDate: c.nextFollowUpDate || '-',
        resolutionNotes: c.resolutionNotes || '-',
      });
      row.alignment = { vertical: 'middle', wrapText: true };
    });

    // -----------------------------------------------------------------
    // Sheet 4: Pending Follow Up
    // -----------------------------------------------------------------
    const ws4 = workbook.addWorksheet('Pending Follow Up', {
      views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
    });

    ws4.columns = [
      { header: 'Case ID', key: 'id', width: 16 },
      { header: 'Klien', key: 'clientName', width: 30 },
      { header: 'Divisi', key: 'division', width: 14 },
      { header: 'Judul Permasalahan', key: 'title', width: 35 },
      { header: 'Prioritas', key: 'priority', width: 15 },
      { header: 'Jatuh Tempo Follow-up', key: 'nextFollowUpDate', width: 22 },
      { header: 'Status Keterlambatan', key: 'overdueStatus', width: 22 },
      { header: 'PIC Penanggung Jawab', key: 'followUpPicName', width: 25 },
      { header: 'Rencana Tindak Lanjut', key: 'followUpPlan', width: 45 },
      { header: 'Status Kasus Saat Ini', key: 'status', width: 18 },
    ];
    applyHeaderStyle(ws4.getRow(1));

    const activeCases = db.cases.filter((c) => c.status !== 'Resolved' && c.status !== 'Closed');
    activeCases.forEach((c) => {
      const isOverdue = c.nextFollowUpDate && c.nextFollowUpDate < todayStr;
      const row = ws4.addRow({
        id: c.id,
        clientName: c.clientName,
        division: c.division,
        title: c.title,
        priority: c.priority,
        nextFollowUpDate: c.nextFollowUpDate || '-',
        overdueStatus: isOverdue ? 'TERLAMBAT (Lewat Batas)' : 'Sesuai Jadwal (Aktif)',
        followUpPicName: c.followUpPicName || c.picName,
        followUpPlan: c.followUpPlan || c.latestProgress || '-',
        status: c.status,
      });
      row.alignment = { vertical: 'middle', wrapText: true };
      if (isOverdue) {
        row.getCell('overdueStatus').font = { bold: true, color: { argb: 'FFDC2626' } };
      }
    });

    // -----------------------------------------------------------------
    // Sheet 5: Job Management
    // -----------------------------------------------------------------
    const ws5 = workbook.addWorksheet('Job Management', {
      views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
    });

    ws5.columns = [
      { header: 'Job ID', key: 'id', width: 16 },
      { header: 'Nama Klien', key: 'clientName', width: 30 },
      { header: 'Divisi', key: 'division', width: 14 },
      { header: 'Judul Pekerjaan', key: 'title', width: 35 },
      { header: 'Prioritas', key: 'priority', width: 14 },
      { header: 'PIC Penanggung Jawab', key: 'picName', width: 24 },
      { header: 'SPV Reviewer', key: 'spvName', width: 24 },
      { header: 'Tgl Mulai', key: 'startDate', width: 14 },
      { header: 'Deadline', key: 'deadline', width: 14 },
      { header: 'Progres', key: 'progressPercent', width: 12 },
      { header: 'Status Pekerjaan', key: 'status', width: 18 },
      { header: 'Catatan Review SPV', key: 'reviewNotes', width: 35 },
    ];
    applyHeaderStyle(ws5.getRow(1));

    db.jobs.forEach((job) => {
      const row = ws5.addRow({
        id: job.id,
        clientName: job.clientName,
        division: job.division,
        title: job.title,
        priority: job.priority,
        picName: job.picName,
        spvName: job.spvName,
        startDate: job.startDate,
        deadline: job.deadline,
        progressPercent: `${job.progressPercent}%`,
        status: job.status,
        reviewNotes: job.reviewNotes || '-',
      });
      row.alignment = { vertical: 'middle', wrapText: true };
      row.getCell('progressPercent').alignment = { horizontal: 'center' };
    });

    // -----------------------------------------------------------------
    // Sheet 6: Master Klien & Profil Pajak
    // -----------------------------------------------------------------
    const ws6 = workbook.addWorksheet('Master Klien & Pajak', {
      views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
    });

    ws6.columns = [
      { header: 'Client ID', key: 'id', width: 14 },
      { header: 'Nama Klien', key: 'name', width: 32 },
      { header: 'Tipe', key: 'type', width: 10 },
      { header: 'Bentuk Usaha', key: 'entityType', width: 14 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Status PKP', key: 'pkpStatus', width: 14 },
      { header: 'Rezim PPh', key: 'pphRegime', width: 24 },
      { header: 'Tahun Pajak', key: 'taxYearEffective', width: 12 },
      { header: 'Fasilitas UMKM', key: 'umkm', width: 18 },
      { header: 'PIC Accounting', key: 'accountingStaffPicName', width: 22 },
      { header: 'PIC Tax', key: 'taxStaffPicName', width: 22 },
      { header: 'SPV Reviewer Acc', key: 'accountingSpvName', width: 22 },
      { header: 'SPV Reviewer Tax', key: 'taxSpvName', width: 22 },
      { header: 'Status PIC', key: 'picAssignmentStatus', width: 16 },
      { header: 'Risiko Acc', key: 'accountingRisk', width: 14 },
      { header: 'Risiko Tax', key: 'taxRisk', width: 14 },
      { header: 'Alasan Risiko', key: 'riskReason', width: 35 },
    ];
    applyHeaderStyle(ws6.getRow(1));

    db.clients.forEach((c) => {
      const row = ws6.addRow({
        id: c.id,
        name: c.name,
        type: c.type,
        entityType: c.entityType,
        status: c.status,
        pkpStatus: c.pkpStatus,
        pphRegime: c.pphRegime,
        taxYearEffective: c.taxYearEffective,
        umkm: c.umkmFacilityEndYear ? `s/d ${c.umkmFacilityEndYear}` : '-',
        accountingStaffPicName: c.accountingSpvIsPic ? c.accountingSpvName || '-' : c.accountingStaffPicName || '-',
        taxStaffPicName: c.taxSpvIsPic ? c.taxSpvName || '-' : c.taxStaffPicName || '-',
        accountingSpvName: c.accountingSpvName || '-',
        taxSpvName: c.taxSpvName || '-',
        picAssignmentStatus: c.picAssignmentStatus,
        accountingRisk: c.accountingRisk,
        taxRisk: c.taxRisk,
        riskReason: c.taxRiskReason || c.accountingRiskReason || '-',
      });
      row.alignment = { vertical: 'middle', wrapText: true };
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="TMM_BMA_Management_Activity_Report_${Date.now()}.xlsx"`
    );

    const buffer = await workbook.xlsx.writeBuffer();
    res.send(Buffer.from(buffer));
  })
);
