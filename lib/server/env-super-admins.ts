/**
 * Usernames (ou e-mails) listados em SUPER_ADMIN_USERNAMES passam a ter cargo super_admin
 * em runtime (e são persistidos no login). Separados por vírgula; @ é opcional.
 * Ex.: SUPER_ADMIN_USERNAMES=carlinhosbig,@outro
 */
export function getEnvSuperAdminIdentifiers(): string[] {
  const raw = process.env.SUPER_ADMIN_USERNAMES?.trim() || '';
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/^@+/, ''))
    .filter(Boolean);
}

export function isEnvSuperAdmin(username?: string | null, email?: string | null): boolean {
  const list = getEnvSuperAdminIdentifiers();
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
  // permite listar só a parte local do e-mail (ex.: carlinhosbigdata)
  if (e.includes('@')) {
    const local = e.split('@')[0];
    if (local && list.includes(local)) return true;
  }
  return false;
}

export function applyEnvSuperAdminStatus<T extends string | null | undefined>(
  status: T,
  username?: string | null,
  email?: string | null
): T | 'super_admin' {
  if (isEnvSuperAdmin(username, email)) return 'super_admin';
  return status;
}
