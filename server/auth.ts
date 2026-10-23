import crypto from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { sessions } from '../db/schema.ts';
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

const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

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
  const tokenHash = hashSessionToken(token);
  await db.delete(sessions).where(lt(sessions.expiresAt, Date.now()));
  await db.insert(sessions).values({
    token: tokenHash,
    userId: sessionInfo.userId,
    username: sessionInfo.username,
    name: sessionInfo.name,
    role: sessionInfo.role,
    expiresAt,
  });
  return sessionInfo;
}

export async function getSession(token?: string): Promise<SessionInfo | null> {
  if (!token) return null;
  const [stored] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.token, hashSessionToken(token)))
    .limit(1);
  if (!stored) return null;
  if (Date.now() > stored.expiresAt) {
    await db.delete(sessions).where(eq(sessions.token, stored.token));
    return null;
  }
  return {
    token,
    userId: stored.userId,
    username: stored.username,
    name: stored.name,
    role: stored.role as UserRole,
    expiresAt: stored.expiresAt,
  };
}

export async function destroySession(token?: string): Promise<boolean> {
  if (!token) return false;
  const deleted = await db
    .delete(sessions)
    .where(eq(sessions.token, hashSessionToken(token)))
    .returning({ token: sessions.token });
  return deleted.length > 0;
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
