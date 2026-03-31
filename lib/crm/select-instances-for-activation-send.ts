/**
 * Instâncias usadas no disparo/agendamento de ativações.
 * Prioriza conectadas marcadas como mestre; se não houver nenhuma mestre conectada,
 * usa todas as conectadas (evita modal “vazio” quando o WhatsApp está só em instância não-mestre).
 */
export function selectInstancesForActivationSend(apiInstances: unknown[]): unknown[] {
  const list = Array.isArray(apiInstances) ? apiInstances : [];
  const connected = list.filter(
    (i: any) => i && typeof i === 'object' && i.status === 'connected'
  );
  const masters = connected.filter((i: any) => i.is_master === true);
  const pool = masters.length > 0 ? masters : connected;
  return [...pool].sort((a: any, b: any) => {
    const ma = a?.is_master === true ? 0 : 1;
    const mb = b?.is_master === true ? 0 : 1;
    if (ma !== mb) return ma - mb;
    return String(a?.instance_name ?? '').localeCompare(String(b?.instance_name ?? ''));
  });
}
