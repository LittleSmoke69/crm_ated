# Análise: Recebimento de Eventos da Evolution API nos Flows

## Resumo Executivo

Análise detalhada do fluxo de recebimento e processamento de eventos da Evolution API para identificar causas de duplicação de mensagens de boas-vindas e outros problemas potenciais.

---

## 🔴 Problemas Críticos Identificados

### 1. **Deduplicação Pré-Insert: Falta Filtro por Participante**

**Localização:** `app/api/webhooks/evolution/prod/route.ts:59-90`

**Problema:**
A deduplicação pré-insert verifica apenas `instance_name` + `remote_jid` (grupo), mas **não filtra por participante**. Isso causa dois problemas:

1. **Falso positivo:** Se pessoa A entra no grupo e, em seguida (< 30s), pessoa B entra no mesmo grupo, o segundo evento pode ser descartado incorretamente porque a query encontra o evento da pessoa A.

```typescript
// ❌ PROBLEMA: Query não filtra por participante
const { data: existing } = await supabaseServiceRole
  .from('evolution_webhook_events')
  .select('id')
  .eq('instance_name', instanceName)
  .eq('remote_jid', remoteJid)  // ← Só grupo, não participante!
  .in('event_type', ['group-participants.update', 'GROUP_PARTICIPANTS_UPDATE'])
  .gte('created_at', since)
  .limit(1)
  .maybeSingle();
```

**Impacto:**
- Mensagens de boas-vindas não enviadas para pessoas que entram logo após outra
- Perda de eventos legítimos

**Solução Recomendada:**
Adicionar filtro por participante na query ou usar fingerprint mais específico (ex: hash de `instance_name + remote_jid + participant_id`).

---

### 2. **Deduplicação Pós-Insert: Mesmo Problema**

**Localização:** `app/api/webhooks/evolution/prod/route.ts:124-148`

**Problema:**
A deduplicação pós-insert também não considera o participante, apenas o grupo. Se dois eventos chegam simultaneamente para pessoas diferentes no mesmo grupo, apenas o primeiro será processado.

```typescript
// ❌ PROBLEMA: Mesma query sem filtro por participante
const { data: firstEvent } = await supabaseServiceRole
  .from('evolution_webhook_events')
  .select('id')
  .eq('instance_name', instanceName)
  .eq('remote_jid', remoteJid)  // ← Só grupo!
  .in('event_type', ['group-participants.update', 'GROUP_PARTICIPANTS_UPDATE'])
  .gte('created_at', dedupSince)
  .order('created_at', { ascending: true })
  .limit(1)
  .maybeSingle();
```

**Impacto:**
- Race condition: dois participantes entrando simultaneamente → apenas um recebe boas-vindas

---

### 3. **Extração de groupJid: Múltiplas Tentativas sem Validação**

**Localização:** `app/api/webhooks/evolution/prod/route.ts:174-185`

**Problema:**
A extração de `groupJid` tenta múltiplos caminhos, mas não valida se o valor extraído é realmente um grupo (deveria terminar com `@g.us`). Isso pode causar:

- Processamento de eventos de mensagens privadas como se fossem de grupo
- Execução incorreta de flows de boas-vindas

```typescript
// ⚠️ PROBLEMA: Não valida se é realmente um grupo
const groupJid =
  payload?.data?.id ??
  np?.data?.id ??
  np?.normalized?.groupId ??
  // ... muitas tentativas ...
  (remoteJid && String(remoteJid).includes('@g.us') ? remoteJid : null) ??
  null;
```

**Solução Recomendada:**
Validar que `groupJid` termina com `@g.us` antes de processar como evento de grupo.

---

### 4. **Normalização Pode Falhar Silenciosamente**

**Localização:** `app/api/webhooks/evolution/prod/route.ts:92-102`

**Problema:**
Se a normalização falhar, o código continua sem `normalizedPayload`, mas depois há um `return` se `normalizedPayload` for `null`:

```typescript
// ── Flows ─────────────────────────────────────────────────────────────────
if (!normalizedPayload) return;  // ← Retorna sem processar flows!
```

**Impacto:**
- Se a normalização falhar (ex: timeout no Supabase), **nenhum flow é executado**
- Eventos legítimos são perdidos silenciosamente

**Solução Recomendada:**
- Usar payload original como fallback se normalização falhar
- Adicionar retry ou cache para regras de normalização

---

### 5. **findMatchingFlowInstances: Busca Duplicada e Ineficiente**

**Localização:** `lib/services/flow-executor-service.ts:2526-2698`

**Problemas:**

#### 5.1. Busca em Duas Etapas (Fallback Manual)
O código primeiro tenta buscar com variações de `groupJid`, e se não encontrar, busca **TODAS** as instâncias ativas da instância e compara manualmente:

```typescript
// Se não encontrou, tenta busca mais ampla e compara manualmente
if ((!instances || instances.length === 0) && !error) {
  // Busca TODAS as flow_instances ativas para essa instância
  const { data: allInstances } = await supabaseServiceRole
    .from('flow_instances')
    .select(...)
    .eq('instance_name', instanceName)
    .eq('is_active', true);  // ← Pode retornar centenas de registros!
```

**Impacto:**
- Performance degradada se houver muitas `flow_instances` ativas
- Processamento desnecessário em memória

#### 5.2. Normalização de groupJid Inconsistente
A função `normalizeGroupJid` e `getGroupJidVariations` podem gerar variações que não correspondem ao formato real do WhatsApp:

```typescript
private normalizeGroupJid(groupJid: string | null): string {
  // Remove espaços
  let normalized = String(groupJid).trim();
  
  // Garante que tem o sufixo @g.us
  if (!normalized.includes('@')) {
    normalized = `${normalized}@g.us`;  // ← Pode adicionar @g.us incorretamente
  }
  
  return normalized;
}
```

**Problema:**
Se o `groupJid` já tem formato correto (ex: `120363123456789012@g.us`), adicionar `@g.us` novamente pode gerar formato inválido.

---

### 6. **Race Condition na Execução de Flows**

**Localização:** `lib/services/flow-executor-service.ts:89-117`

**Problema:**
A proteção contra duplicação usa `UNIQUE CONSTRAINT` no banco, mas o código trata apenas erros `PGRST116` e `23505`. Se a constraint não existir ou houver outro tipo de erro, a execução pode duplicar.

```typescript
// PGRST116 = no rows returned (ON CONFLICT DO NOTHING suprimiu o INSERT — duplicata)
if (execError?.code === 'PGRST116' || execError?.code === '23505') {
  // Trata duplicata
}
```

**Verificação Necessária:**
- Confirmar que a migration `add_flow_executions_dedup_constraint.sql` foi executada
- Verificar se a constraint `uq_flow_executions_flow_event` existe no banco

---

### 7. **Múltiplos Endpoints Podem Processar o Mesmo Evento**

**Endpoints Identificados:**
1. `/api/webhooks/evolution/prod` → `processEventBackground`
2. `/api/webhooks/evolution/test` → `processEventBackground` (mesma lógica)
3. `/api/webhooks/evolution` → Processa apenas mensagens (MESSAGES_UPSERT, etc.)

**Problema Potencial:**
Se a Evolution API estiver configurada com múltiplos webhooks apontando para endpoints diferentes, o mesmo evento pode ser processado múltiplas vezes.

**Verificação Necessária:**
- Confirmar configuração de webhooks na Evolution API
- Verificar se há sobreposição entre endpoints

---

### 8. **Logs Insuficientes para Debug**

**Problema:**
Muitos pontos críticos não têm logs detalhados:

- Quando `normalizedPayload` é `null` e flows não são executados
- Quando `groupJid` não é encontrado
- Quando `findMatchingFlowInstances` retorna vazio
- Quando deduplicação descarta eventos

**Solução Recomendada:**
Adicionar logs estruturados com contexto completo para facilitar debug.

---

## 🟡 Problemas de Design/Arquitetura

### 9. **Dependência de Normalização para Execução de Flows**

**Problema:**
Se a normalização falhar, **nenhum flow é executado**, mesmo que o payload original tenha todos os dados necessários.

**Solução Recomendada:**
- Usar payload original como fallback
- Processar flows mesmo sem normalização (com dados do payload original)

### 10. **Deduplicação por Janela de Tempo (30s) é Arbitrária**

**Problema:**
A janela de 30 segundos pode não ser suficiente para:
- Eventos que chegam com delay de rede
- Retries da Evolution API após timeout
- Processamento em diferentes timezones/servidores

**Solução Recomendada:**
- Usar deduplicação baseada em fingerprint único (hash de campos-chave)
- Adicionar índice composto para busca rápida

---

## ✅ Pontos Positivos

1. **Uso de `after()` do Next.js 15+** garante resposta rápida à Evolution API
2. **Idempotência em `flow_executions`** (se a constraint existir)
3. **Normalização flexível** com múltiplos caminhos para extrair dados
4. **Logs estruturados** em pontos críticos (podem ser melhorados)

---

## 📋 Checklist de Verificação Imediata

- [ ] Verificar se constraint `uq_flow_executions_flow_event` existe no banco
- [ ] Verificar logs para eventos descartados pela deduplicação
- [ ] Verificar se há múltiplos flows de boas-vindas ativos no mesmo grupo
- [ ] Verificar configuração de webhooks na Evolution API (não duplicados)
- [ ] Verificar se `normalizedPayload` está sendo `null` frequentemente
- [ ] Verificar se `groupJid` está sendo extraído corretamente dos eventos

---

## 🔧 Correções Recomendadas (Prioridade)

### Prioridade ALTA

1. **Corrigir deduplicação para incluir participante**
   - Adicionar filtro por `participant_id` nas queries de dedup
   - Ou usar fingerprint único (hash de `instance + group + participant`)

2. **Validar `groupJid` antes de processar**
   - Garantir que termina com `@g.us`
   - Não processar eventos de chat privado como grupo

3. **Fallback para payload original se normalização falhar**
   - Não retornar early se `normalizedPayload` for `null`
   - Usar payload original para executar flows

### Prioridade MÉDIA

4. **Otimizar `findMatchingFlowInstances`**
   - Remover busca manual de todas as instâncias
   - Melhorar normalização de `groupJid`

5. **Adicionar logs detalhados**
   - Log quando eventos são descartados
   - Log quando flows não são encontrados
   - Log quando normalização falha

### Prioridade BAIXA

6. **Melhorar deduplicação baseada em fingerprint**
   - Substituir janela de tempo por hash único
   - Adicionar índice composto para performance

---

## 📊 Queries SQL para Diagnóstico

```sql
-- Verificar se constraint existe
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'flow_executions'
  AND constraint_name = 'uq_flow_executions_flow_event';

-- Verificar eventos duplicados recentes
SELECT 
  instance_name,
  remote_jid,
  event_type,
  COUNT(*) as count,
  MIN(created_at) as first_event,
  MAX(created_at) as last_event
FROM evolution_webhook_events
WHERE event_type IN ('group-participants.update', 'GROUP_PARTICIPANTS_UPDATE')
  AND created_at > NOW() - INTERVAL '1 hour'
GROUP BY instance_name, remote_jid, event_type
HAVING COUNT(*) > 1
ORDER BY count DESC;

-- Verificar execuções duplicadas (se constraint não existir)
SELECT 
  flow_id,
  trigger_event_id,
  COUNT(*) as count
FROM flow_executions
WHERE created_at > NOW() - INTERVAL '1 day'
GROUP BY flow_id, trigger_event_id
HAVING COUNT(*) > 1;

-- Verificar flows de boas-vindas ativos no mesmo grupo
SELECT 
  fi.instance_name,
  fi.group_jid,
  COUNT(DISTINCT fi.flow_id) as flow_count,
  array_agg(DISTINCT f.name) as flow_names
FROM flow_instances fi
JOIN flows f ON f.id = fi.flow_id
WHERE fi.is_active = true
  AND f.status = 'active'
  AND f.name LIKE '%Boas-vindas%'
GROUP BY fi.instance_name, fi.group_jid
HAVING COUNT(DISTINCT fi.flow_id) > 1;
```

---

## 🎯 Conclusão

Os principais problemas identificados são:

1. **Deduplicação incompleta** (não considera participante)
2. **Falta de validação** de `groupJid`
3. **Dependência crítica de normalização** (falha = nenhum flow executa)
4. **Busca ineficiente** em `findMatchingFlowInstances`

A causa mais provável de **duplicação de mensagens de boas-vindas** é:
- **Múltiplos flows** de boas-vindas ativos no mesmo grupo (dados legados)
- **Dois eventos distintos** da Evolution API (não é "ler duas vezes", são eventos diferentes)

A causa mais provável de **mensagens não enviadas** é:
- **Deduplicação incorreta** descartando eventos legítimos
- **Falha na normalização** impedindo execução de flows
