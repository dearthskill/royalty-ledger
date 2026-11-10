import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { findLogin } from '@/lib/db';
import { errorResponse, HttpError, json, parseBody } from '@/lib/http';
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE, type Session } from '@/lib/session';

const Body = z.object({ email: z.string().trim().pipe(z.email()), password: z.string().min(1) });

// Compared against when the e-mail is unknown, so both failures take the same time.
const DUMMY_HASH = '$2b$10$LId2m1dwvdLd0gZY5o6qe.Jhvg0hJ1QqqcbsmDYaRaQMMmLJQ9Jja';

export async function POST(req: Request) {
  try {
    const { email, password } = await parseBody(req, Body);
    const login = await findLogin(email);
    const ok = await bcrypt.compare(password, login?.password_hash ?? DUMMY_HASH);
    if (!login || !ok) throw new HttpError(401, 'Invalid email or password');

    const user: Session = { user_id: login.user_id, email: login.email, role: login.role, artist_id: login.artist_id };
    const res = json({ user });
    res.cookies.set(SESSION_COOKIE, await createSessionToken(user), {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: SESSION_MAX_AGE,
    });
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
