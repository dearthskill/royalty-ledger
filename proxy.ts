// Request guard for pages (API routes check roles themselves via lib/http.ts route()).
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken, type Role } from './lib/session';

const RULES: [prefix: string, roles: Role[]][] = [
  ['/admin', ['admin']],
  ['/me', ['artist']],
  ['/audit', ['auditor', 'admin']],
];

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === '/login') {
    return session ? NextResponse.redirect(new URL('/', req.url)) : NextResponse.next();
  }
  if (!session) {
    const login = new URL('/login', req.url);
    login.searchParams.set('next', pathname + search);
    return NextResponse.redirect(login);
  }
  const rule = RULES.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix + '/'));
  if (rule && !rule[1].includes(session.role)) {
    return NextResponse.rewrite(new URL('/forbidden', req.url), { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
