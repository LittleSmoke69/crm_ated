/** Sufixo de e-mail dos clientes gerados na compra de combo sem login (CRM Avulsos). */
export const COMBO_AVULSO_EMAIL_MARKER = '@combo.avulso';

export function isComboAvulsoEmail(email: string | null | undefined): boolean {
  const e = String(email ?? '').trim().toLowerCase();
  return e.includes(COMBO_AVULSO_EMAIL_MARKER);
}
