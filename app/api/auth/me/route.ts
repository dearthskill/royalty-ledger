import { ALL_ROLES, json, route } from '@/lib/http';

export const GET = route(ALL_ROLES, async ({ session }) => json({ user: session }));
