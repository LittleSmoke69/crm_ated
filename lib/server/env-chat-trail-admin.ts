/**
 * Admin da 1ª etapa na trilha (Gestão do Chat).
 *
 * CHAT_TRAIL_ADMIN_LABEL — texto exibido na coluna/trilha (default: Administrador)
 * CHAT_TRAIL_ADMIN_USERNAMES — usernames/e-mails que contam como admin da 1ª etapa
 *   (além de profiles com status admin/super_admin). Separados por vírgula.
 *   Ex.: CHAT_TRAIL_ADMIN_USERNAMES=administrador,franklin
 */

import { getEnvSuperAdminIdentifiers } from '@/lib/server/env-super-admins';

export function getChatTrailAdminLabel(): string {
  const label = process.env.CHAT_TRAIL_ADMIN_LABEL?.trim();
  return label || 'Administrador';
}

export function getChatTrailAdminUsernames(): string[] {
  const raw = process.env.CHAT_TRAIL_ADMIN_USERNAMES?.trim() || '';
  const fromTrail = raw
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/^@+/, ''))
    .filter(Boolean);

  const merged = new Set<string>([...fromTrail, ...getEnvSuperAdminIdentifiers()]);
  // fallback mínimo se nada estiver configurado
  if (merged.size === 0) {
    merged.add('administrador');
    merged.add('franklin');
  }
  return [...merged];
}

export function profileMatchesTrailAdmin(
  username?: string | null,
  email?: string | null
): boolean {
  const list = getChatTrailAdminUsernames();
  if (list.length === 0) return false;
  const u = String(username || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '');
  const e = String(email || '')
    .trim()
    .toLowerCase();
  if (u && list.includes(u)) return true;
  if (e && list.includes(e)) return true;
  if (e.includes('@')) {
    const local = e.split('@')[0];
    if (local && list.includes(local)) return true;
  }
  return false;
}
