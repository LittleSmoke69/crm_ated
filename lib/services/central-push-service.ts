/**
 * Serviço para o Zaploto Central enviar dados aos white labels.
 * Apenas o tenant marcado como is_central pode usar este serviço.
 * Tipos suportados: profiles (usuários), evolution_instances, crm_bancas,
 * campaigns, message_schedules. Modo: transfer (atualiza zaploto_id no destino).
 */

import { supabaseServiceRole } from './supabase-service';

const CENTRAL_ZAPLOTO_ID = '00000000-0000-0000-0000-000000000001';

export type PushDataType = 'profiles' | 'evolution_instances' | 'crm_bancas' | 'campaigns' | 'message_schedules';

export interface PushDataOptions {
  types: PushDataType[];
  /** IDs por tipo. Se omitido, envia todos do source. */
  ids?: Partial<Record<PushDataType, string[]>>;
  /** 'transfer' = atualiza zaploto_id para o tenant destino (dados saem do central e vão para o white label) */
  mode: 'transfer';
}

export interface PushDataResult {
  success: boolean;
  updated: Partial<Record<PushDataType, number>>;
  errors: string[];
}

/** Verifica se o tenant é o Zaploto Central (pode enviar dados para white labels). */
export async function isCentralTenant(zaplotoId: string): Promise<boolean> {
  if (zaplotoId === CENTRAL_ZAPLOTO_ID) return true;
  const { data } = await supabaseServiceRole
    .from('zaploto_tenants')
    .select('is_central')
    .eq('id', zaplotoId)
    .maybeSingle();
  return (data as { is_central?: boolean } | null)?.is_central === true;
}

/** Valida se o tenant destino existe e não é o central (evitar enviar para si mesmo em modo transfer). */
export async function validateTargetTenant(targetZaplotoId: string): Promise<{ valid: boolean; error?: string }> {
  if (targetZaplotoId === CENTRAL_ZAPLOTO_ID) {
    return { valid: false, error: 'Não é possível enviar dados para o próprio Central em modo transferir.' };
  }
  const { data, error } = await supabaseServiceRole
    .from('zaploto_tenants')
    .select('id, is_active')
    .eq('id', targetZaplotoId)
    .maybeSingle();
  if (error) return { valid: false, error: error.message };
  if (!data) return { valid: false, error: 'Tenant destino não encontrado.' };
  if (!(data as { is_active?: boolean }).is_active) {
    return { valid: false, error: 'Tenant destino está inativo.' };
  }
  return { valid: true };
}

/**
 * Transfere dados do tenant de origem (central) para o tenant destino (white label).
 * Em modo 'transfer', apenas atualiza zaploto_id nos registros selecionados.
 */
export async function pushDataToTenant(
  sourceZaplotoId: string,
  targetZaplotoId: string,
  options: PushDataOptions
): Promise<PushDataResult> {
  const result: PushDataResult = { success: true, updated: {}, errors: [] };
  const { types, ids = {}, mode } = options;

  if (mode !== 'transfer') {
    result.success = false;
    result.errors.push('Apenas modo "transfer" é suportado.');
    return result;
  }

  const validTarget = await validateTargetTenant(targetZaplotoId);
  if (!validTarget.valid) {
    result.success = false;
    result.errors.push(validTarget.error!);
    return result;
  }

  for (const type of types) {
    try {
      const count = await transferByType(type, sourceZaplotoId, targetZaplotoId, ids[type]);
      result.updated[type] = count;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`${type}: ${msg}`);
      result.success = false;
    }
  }

  return result;
}

async function transferByType(
  type: PushDataType,
  sourceZaplotoId: string,
  targetZaplotoId: string,
  idList?: string[]
): Promise<number> {
  const table = tableByType(type);
  const idColumn = idColumnByType(type);

  const payload: Record<string, unknown> = { zaploto_id: targetZaplotoId };

  let query = supabaseServiceRole
    .from(table)
    .update(payload)
    .eq('zaploto_id', sourceZaplotoId);

  if (idList?.length) {
    query = query.in(idColumn, idList);
  }

  const { data, error } = await query.select('id');
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) as number;
}

function tableByType(type: PushDataType): string {
  switch (type) {
    case 'profiles':
      return 'profiles';
    case 'evolution_instances':
      return 'evolution_instances';
    case 'crm_bancas':
      return 'crm_bancas';
    case 'campaigns':
      return 'campaigns';
    case 'message_schedules':
      return 'message_schedules';
    default:
      return type as string;
  }
}

function idColumnByType(type: PushDataType): string {
  switch (type) {
    case 'profiles':
      return 'id';
    case 'evolution_instances':
      return 'id';
    case 'crm_bancas':
      return 'id';
    case 'campaigns':
      return 'id';
    case 'message_schedules':
      return 'id';
    default:
      return 'id';
  }
}
