import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { User, UserRole } from './types.ts';

export interface SessionInfo {
  token: string;
  userId: string;
  username: string;
  name: string;
  role: UserRole;
  expiresAt: number;
}

// Sessions live in memory and are cleared whenever the server process restarts.
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const inMemorySessions = new Map<string, SessionInfo>();

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, actualSalt, 100000, 64, 'sha512').toString('hex');
  return { hash, salt: actualSalt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const check = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(check, 'hex'), Buffer.from(hash, 'hex'));
}

export async function createSession(user: User): Promise<SessionInfo> {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  const sessionInfo: SessionInfo = {
    token,
    userId: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    expiresAt,
  };
  // Opportunistically clear expired sessions
  for (const [sessionToken, session] of inMemorySessions) {
    if (session.expiresAt < Date.now()) inMemorySessions.delete(sessionToken);
  }
  inMemorySessions.set(token, sessionInfo);
  return sessionInfo;
}

export async function getSession(token?: string): Promise<SessionInfo | null> {
  if (!token) return null;
  const session = inMemorySessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    inMemorySessions.delete(token);
    return null;
  }
  return { ...session, role: session.role as UserRole };
}

export async function destroySession(token?: string): Promise<boolean> {
  if (!token) return false;
  return inMemorySessions.delete(token);
}

// Express extended request interface
export interface AuthenticatedRequest extends Request {
  user?: SessionInfo;
}

// Auth Middleware: extracts token from Authorization: Bearer <token> or X-Session-Token
export async function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.substring(7)
    : (req.headers['x-session-token'] as string | undefined);

  if (!token) {
    res.status(401).json({ error: 'Sesi tidak ditemukan. Silakan login kembali.' });
    return;
  }

  let session: SessionInfo | null;
  try {
    session = await getSession(token);
  } catch (err) {
    next(err);
    return;
  }
  if (!session) {
    res.status(401).json({ error: 'Sesi kedaluwarsa atau tidak valid. Silakan login kembali.' });
    return;
  }

  req.user = session;
  next();
}

// Role Guard Middleware
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Akses ditolak: belum terautentikasi.' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: `Akses ditolak: Peran '${req.user.role}' tidak memiliki izin untuk tindakan ini. Diperlukan salah satu dari: ${allowedRoles.join(', ')}`,
      });
      return;
    }

    next();
  };
}

// Read-only Enforcement: Owner & Manager can never write/modify data
export function requireWritable(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Akses ditolak: belum terautentikasi.' });
    return;
  }

  if (req.user.role === 'Owner' || req.user.role === 'Manager') {
    res.status(403).json({
      error: `HAK AKSES DITOLAK: Peran '${req.user.role}' bersifat Read-Only (Hanya Lihat). Anda tidak memiliki izin untuk menambah, mengubah, menyetujui, atau menghapus data.`,
    });
    return;
  }

  next();
}
