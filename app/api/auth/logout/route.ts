import { NextResponse } from 'next/server';
import { clearSessionCookies } from '@/lib/server/session-token';
import { successResponse } from '@/lib/utils/response';

/**
 * POST /api/auth/logout — invalida cookies de sessão no servidor.
 */
export async function POST() {
  const res = successResponse({ ok: true });
  clearSessionCookies(res);
  return res;
}
