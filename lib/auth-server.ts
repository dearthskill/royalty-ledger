// Session lookup for server components and pages.
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySessionToken, type Session } from './session';

export async function currentSession(): Promise<Session | null> {
  return verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
}
