# Sistema de Normalização Configurável - Parte C

**Data:** 2024  
**Status:** ✅ Concluído

## Resumo

Sistema completo de normalização configurável para mapear campos do payload para campos normalizados, facilitando a criação de automações e agentes IA.

---

## Funcionalidades Implementadas

### 1. Tabelas Criadas

#### `webhook_normalization_rules`
Armazena regras de normalização configuráveis.

**Estrutura:**
```sql
- id: uuid
- name: text (Nome da regra)
- description: text (Descrição opcional)
- event_type: text (Tipo de evento, ex: "group-participants.update")
- priority: integer (Prioridade, maior = aplicado primeiro)
- enabled: boolean (Se a regra está ativa)
- rule_config: jsonb (Configuração da regra com mapeamentos)
- created_at: timestamptz
- updated_at: timestamptz
- created_by: text (ID do usuário que criou)
```

#### `group_participants_state`
Armazena estado dos participantes por grupo (para calcular action add/remove).

**Estrutura:**
```sql
- id: uuid
- group_id: text (JID do grupo)
- participant_id: text (ID do participante)
- phone_number: text (Número normalizado)
- is_active: boolean (Se está ativo)
- first_seen_at: timestamptz
- last_seen_at: timestamptz
- instance_name: text (Instância que reportou)
- UNIQUE(group_id, participant_id, instance_name)
```

#### Coluna Adicionada em `evolution_webhook_events`
- `payload_normalized`: jsonb (Payload normalizado após aplicar regras)

---

### 2. Serviço de Normalização

**Arquivo:** `zaplotoapp/lib/services/normalization-service.ts`

**Funcionalidades:**
1. **normalizePayload()** - Aplica todas as regras ativas para um tipo de evento
2. **getValueFromPath()** - Extrai valor de um path no payload (suporta JSONPath simples)
3. **applyTransform()** - Aplica transformações (lowercase, uppercase, trim)
4. **calculateStateCompare()** - Calcula valores baseados em comparação de estado (ex: action add/remove)

**Tipos de Mapeamento:**
- `direct`: Mapeamento direto de um path no payload para um campo normalizado
- `transform`: Mapeamento com transformação (lowercase, uppercase, trim)
- `calculated`: Cálculo baseado em estado (ex: add/remove baseado em participante existente)

---

### 3. Integração com Webhooks

**Arquivos atualizados:**
- `zaplotoapp/app/api/webhooks/evolution/prod/route.ts`
- `zaplotoapp/app/api/webhooks/evolution/test/route.ts`

**Comportamento:**
1. Recebe evento do webhook
2. Aplica normalização usando `normalizationService.normalizePayload()`
3. Salva payload original e payload normalizado no banco
4. Retorna 200 imediatamente (não bloqueia Evolution API)

---

### 4. API Endpoints

#### GET `/api/admin/webhooks/normalization-rules`
Lista regras de normalização (opcionalmente filtradas por `event_type`).

#### POST `/api/admin/webhooks/normalization-rules`
Cria uma nova regra de normalização.

**Body:**
```json
{
  "name": "Normalizar action group-participants",
  "description": "Calcula action add/remove baseado em estado",
  "event_type": "group-participants.update",
  "priority": 10,
  "enabled": true,
  "rule_config": {
    "mappings": [
      {
        "target": "action",
        "source": "data.action",
        "type": "calculated",
        "calculated": {
          "type": "state_compare",
          "state_table": "group_participants_state",
          "key_fields": ["group_id", "participant_id"],
          "logic": "add_if_new"
        }
      },
      {
        "target": "phoneNumber",
        "source": "data.participants[0].phoneNumber",
        "type": "direct",
        "default": null
      }
    ]
  }
}
```

#### PUT `/api/admin/webhooks/normalization-rules/[ruleId]`
Atualiza uma regra de normalização.

#### DELETE `/api/admin/webhooks/normalization-rules/[ruleId]`
Deleta uma regra de normalização.

---

## Exemplo de Uso

### Regra para group-participants.update

```json
{
  "name": "Normalizar group-participants.update",
  "event_type": "group-participants.update",
  "priority": 10,
  "enabled": true,
  "rule_config": {
    "mappings": [
      {
        "target": "action",
        "source": "data.action",
        "type": "calculated",
        "calculated": {
          "type": "state_compare",
          "state_table": "group_participants_state",
          "key_fields": ["group_id", "participant_id"],
          "logic": "add_if_new" 
        }
      },
      {
        "target": "phoneNumber",
        "source": "data.participants[0].phoneNumber",
        "type": "direct"
      },
      {
        "target": "groupId",
        "source": "data.key.remoteJid",
        "type": "direct"
      }
    ]
  }
}
```

**Resultado:**
```json
{
  "event": "group-participants.update",
  "data": { ... },
  "action": "add", // Calculado baseado em estado
  "phoneNumber": "5511999999999", // Extraído de data.participants[0].phoneNumber
  "groupId": "120363123456789012@g.us" // Extraído de data.key.remoteJid
}
```

---

## Como Funciona o Calculated (State Compare)

Para `group-participants.update` com `action` calculado:

1. **Extração de campos:**
   - `group_id`: Extraído de `data.key.remoteJid` ou `data.groupJid`
   - `participant_id`: Extraído de `data.participants[0].phoneNumber` ou `data.participants[0].id`

2. **Verificação de estado:**
   - Busca registro em `group_participants_state` com `group_id`, `participant_id` e `instance_name`

3. **Cálculo de action:**
   - **Se não existe**: `action = "add"` e cria registro no estado
   - **Se existe e ainda está ativo**: `action = "add"` (re-adicionado) e atualiza `last_seen_at`
   - **Se payload já traz action="remove"**: `action = "remove"` e marca como inativo no estado

4. **Atualização de estado:**
   - Cria ou atualiza registro em `group_participants_state`

---

## Paths Suportados

O sistema suporta paths no formato JSONPath simples:

- `data.field` - Campo direto
- `data.participants[0].phoneNumber` - Array com índice
- `data.key.remoteJid` - Objetos aninhados
- `json.body.data.id` - Path completo (prefixo "json." é removido automaticamente)

**Exemplos:**
- `phoneNumber` → `data.participants[0].phoneNumber`
- `groupId` → `data.key.remoteJid`
- `instanceName` → `instance.instanceName`

---

## Próximos Passos

1. ✅ **Parte C - Sistema de Normalização**: Concluído
2. ⏳ **Interface Admin para Gerenciar Regras**: Pendente (pode ser criada na Parte D)
3. ⏳ **Parte D - Flow Builder MVP**: Pendente
4. ⏳ **Parte E - Executions + Logs**: Pendente

---

## Notas Técnicas

### Performance
- Normalização é aplicada assincronamente (não bloqueia o webhook)
- Regras são ordenadas por prioridade antes de aplicar
- Erros em uma regra não impedem a aplicação de outras

### Multi-tenant
- Regras são globais (aplicadas a todos os eventos do tipo)
- Estado de participantes é por `instance_name` (permite multi-tenant futuro)

### Segurança
- Regras são gerenciadas apenas por admin
- Validação de inputs antes de criar/atualizar regras
- Erros não expõem informações sensíveis

---

**Desenvolvido para o Zaploto** 🚀

