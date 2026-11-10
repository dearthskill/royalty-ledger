// Sessions: an HS256 JWT in an httpOnly cookie. Signed with AUTH_SECRET.
import { SignJWT, jwtVerify } from 'jose';
import { HttpError } from './errors';

export type Role = 'admin' | 'artist' | 'auditor';
export type Session = { user_id: number; email: string; role: Role; artist_id: number | null };

export const SESSION_COOKIE = 'rl_session';
export const SESSION_MAX_AGE = 8 * 60 * 60; // seconds

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error('AUTH_SECRET must be set (at least 32 characters)');
  return new TextEncoder().encode(s);
}

export async function createSessionToken(s: Session): Promise<string> {
  return new SignJWT({ email: s.email, role: s.role, artist_id: s.artist_id })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(s.user_id))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secret());
}

export async function verifySessionToken(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    const role = payload.role as Role;
    if (!['admin', 'artist', 'auditor'].includes(role)) return null;
    return {
      user_id: Number(payload.sub),
      email: String(payload.email),
      role,
      artist_id: payload.artist_id == null ? null : Number(payload.artist_id),
    };
  } catch {
    return null; // expired, tampered or signed with another secret
  }
}

// Reads the session from a request's cookie header.
export async function sessionFromRequest(req: Request): Promise<Session | null> {
  const cookie = req.headers.get('cookie') ?? '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return verifySessionToken(m ? decodeURIComponent(m[1]) : undefined);
}

// 401 without a session, 403 when the role is not allowed.
export function requireRole(session: Session | null, roles: readonly Role[]): Session {
  if (!session) throw new HttpError(401, 'Not logged in');
  if (!roles.includes(session.role)) throw new HttpError(403, 'Forbidden');
  return session;
}
