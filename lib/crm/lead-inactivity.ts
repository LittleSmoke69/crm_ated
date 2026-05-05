import type { Lead } from '@/components/CRM/types';

/** Prazo em dias desde o último depósito para "possível transferência" (alinhado ao LeadCard / Kanban). */
export const CRM_INACTIVITY_DEADLINE_DAYS = 90;

export function isLeadPast90DaysInactivity(lead: Lead): boolean {
  if (!lead.last_deposit_at) return false;
  const lastDeposit = new Date(lead.last_deposit_at);
  const deadline = new Date(lastDeposit);
  deadline.setDate(deadline.getDate() + CRM_INACTIVITY_DEADLINE_DAYS);
  return new Date().getTime() >= deadline.getTime();
}
