import crypto from 'crypto';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from './pool';
import type { StaffRole } from '../types';
import { normalizeStaffRole } from '../utils/rbac';

export interface DbAdminUserRow {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: string;
  role_code?: string | null;
  avatar_url: string | null;
  active: boolean;
  token_version?: number;
  last_login_at: Date | null;
  created_at: Date;
}

export interface PublicAdminUser {
  id: number;
  name: string;
  email: string;
  role: string;
  roleCode: StaffRole;
  avatarUrl: string | null;
  active?: boolean;
  tokenVersion?: number;
  lastLoginAt?: string | null;
}

export interface SessionJwtPayload {
  sub: number;
  email: string;
  name: string;
  role: string;
  roleCode?: StaffRole;
  tv?: number;
  iat?: number;
  exp?: number;
}

export const SESSION_COOKIE_NAME = 'armazem_session';
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 horas

function getJwtSecret(): string {
  const configured = process.env.JWT_SECRET?.trim();
  if (!configured || configured === 'MY_JWT_SECRET') {
    throw new Error(
      'Variável de ambiente JWT_SECRET não configurada. Defina-a em .env.local ou no painel de variáveis da Vercel.'
    );
  }
  return configured;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;

  const keyBuffer = Buffer.from(keyHex, 'hex');
  const derivedBuffer = crypto.scryptSync(password, salt, 64);
  if (keyBuffer.length !== derivedBuffer.length) return false;

  return crypto.timingSafeEqual(keyBuffer, derivedBuffer);
}

export function signSessionToken(user: PublicAdminUser): string {
  const resolvedRoleCode = normalizeStaffRole(user.roleCode, user.role);
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      roleCode: resolvedRoleCode,
      tv: Number.isFinite(user.tokenVersion) ? user.tokenVersion : 1,
    },
    getJwtSecret(),
    {
      algorithm: 'HS256',
      expiresIn: SESSION_TTL_SECONDS,
    }
  );
}

export function verifySessionToken(token: string): SessionJwtPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), {
      algorithms: ['HS256'],
    });
    if (
      !decoded ||
      typeof decoded === 'string' ||
      typeof decoded.sub !== 'number'
    ) {
      return null;
    }
    return decoded as unknown as SessionJwtPayload;
  } catch {
    return null;
  }
}

export function signPublicLeadChatToken(leadId: number): string {
  return crypto
    .createHmac('sha256', getJwtSecret())
    .update(`public_lead_chat:${leadId}`)
    .digest('hex');
}

export function verifyPublicLeadChatToken(leadId: number, token: string): boolean {
  if (!token) return false;
  const expected = signPublicLeadChatToken(leadId);
  const actualBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  for (const part of cookieHeader.split(';')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = part.slice(0, eqIndex).trim();
    const val = part.slice(eqIndex + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(val);
    } catch {
      cookies[key] = val;
    }
  }
  return cookies;
}

function isHttpsRequest(req: Request): boolean {
  if (req.secure) return true;
  const forwardedProto = req.headers['x-forwarded-proto'];
  if (typeof forwardedProto === 'string') {
    if (forwardedProto.split(',')[0].trim().toLowerCase() === 'https') {
      return true;
    }
  }
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.startsWith('https://')) {
    return true;
  }
  const referer = req.headers.referer;
  if (typeof referer === 'string' && referer.startsWith('https://')) {
    return true;
  }
  return false;
}

export function buildSessionCookieHeader(req: Request, token: string): string {
  const attrs = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (isHttpsRequest(req)) {
    attrs.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    attrs.push('SameSite=Lax');
  }
  return attrs.join('; ');
}

export function buildClearSessionCookieHeader(req: Request): string {
  const attrs = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
  ];
  if (isHttpsRequest(req)) {
    attrs.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    attrs.push('SameSite=Lax');
  }
  return attrs.join('; ');
}

export async function ensureAdminUsersSchemaAndSeed(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        email VARCHAR(200) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role VARCHAR(80) NOT NULL DEFAULT 'Administrador',
        role_code VARCHAR(40) NOT NULL DEFAULT 'administrador',
        avatar_url TEXT,
        active BOOLEAN NOT NULL DEFAULT true,
        token_version INTEGER NOT NULL DEFAULT 1,
        last_login_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      ALTER TABLE admin_users
        ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1
    `);

    // Secure first-run bootstrap ONLY via explicit server environment variables when no user exists.
    // Never creates hardcoded demo credentials.
    const countRes = await client.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM admin_users'
    );

    if ((countRes.rows[0]?.count ?? 0) === 0) {
      const bootstrapEmail = (process.env.ADMIN_BOOTSTRAP_EMAIL || '').trim().toLowerCase();
      const bootstrapPassword = (process.env.ADMIN_BOOTSTRAP_PASSWORD || '').trim();
      const bootstrapName = (process.env.ADMIN_BOOTSTRAP_NAME || 'Administrador').trim();
      if (bootstrapEmail && bootstrapPassword.length >= 10) {
        const passwordHash = hashPassword(bootstrapPassword);
        await client.query(
          `INSERT INTO admin_users (name, email, password_hash, role, role_code, active, token_version)
           VALUES ($1, $2, $3, 'Administrador', 'administrador', true, 1)
           ON CONFLICT (email) DO NOTHING`,
          [bootstrapName, bootstrapEmail, passwordHash]
        );
      }
    }
  } finally {
    client.release();
  }
}
