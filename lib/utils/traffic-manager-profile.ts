/**
 * Gestor de tráfego formal (`gestor`), `admin` ou `super_admin` vinculado à banca
 * como responsável por tráfego/Meta/Zaplink (mesmo vínculo em `user_bancas`).
 */
export function isTrafficManagerProfileStatus(status: string | null | undefined): boolean {
  const s = String(status ?? '').trim().toLowerCase();
  return s === 'gestor' || s === 'admin' || s === 'super_admin';
}
