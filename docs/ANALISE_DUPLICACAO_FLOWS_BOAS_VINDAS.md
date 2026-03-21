# Análise: Duplicação em Flows e Template de Boas-vindas

## Resumo executivo

A duplicação ocorre principalmente na **criação do template de boas-vindas** e na **exibição de flows ativos**. Não há verificação de existência antes de criar um novo template.

---

## 1. Fluxo de criação do template

### Onde é criado
- **Página**: `/admin/flows` (apenas SuperAdmin)
- **Botão**: "Template: Boas-vindas"
- **API**: `POST /api/admin/flows/templates/welcome`
- **Serviço**: `flowTemplatesService.createWelcomeTemplate(userId)`

### Problema: sem idempotência
Cada clique no botão cria um **novo flow** na tabela `flows`:
- Nome: `"Boas-vindas (quando entra no grupo)"`
- Tipo: `template`
- `user_id`: id do SuperAdmin

**Não há verificação** se o usuário já possui um flow com esse nome/tipo. O serviço sempre faz `INSERT` direto.

---

## 2. Onde a duplicação aparece

### 2.1 Página de Flows (admin)
- **Rota**: `/admin/flows`
- **API**: `GET /api/admin/flows` — retorna flows do `user_id`
- Se o admin clicou 3x em "Template: Boas-vindas", verá **3 cards** idênticos.

### 2.2 Página de Agentes IA (gerente/dono)
- **Rota**: `/ai-agents`
- **API**: `GET /api/flows` — retorna **todos os flows ativos** do sistema (sem filtrar por user)
- Se existirem 3 flows "Boas-vindas" ativos, todos aparecem como opções.
- O botão "Adicionar Automação" usa `flows[0]` quando há múltiplos — comportamento imprevisível.

### 2.3 Flow instances (ativações)
- **Tabela**: `flow_instances` com `UNIQUE(flow_id, instance_name, group_jid)` (sem `user_id`)
- Um único grupo não pode ter duas ativações do **mesmo flow**.
- Porém, se existirem **vários flows** de boas-vindas (flow_id diferente), cada um pode ter sua ativação no **mesmo grupo**.
- Resultado: ao entrar no grupo, o webhook pode disparar **várias vezes** (um por flow), enviando múltiplas mensagens de boas-vindas.

---

## 3. Estrutura atual

```
flows (tabela)
├── id, name, type, status, graph_json, user_id, ...
└── Sem constraint UNIQUE em (user_id, name) ou (user_id, type, name)

flow_instances (tabela)
├── flow_id, instance_name, group_jid, user_id, settings_json
└── UNIQUE(flow_id, instance_name, group_jid) — evita duplicata por flow+grupo, mas não por flow

flow-templates-service.ts
└── createWelcomeTemplate() — sempre INSERT, nunca verifica existência
```

---

## 4. Correções recomendadas

### 4.1 Evitar criação duplicada (prioridade alta)
No `flowTemplatesService.createWelcomeTemplate()`:
- Antes do `INSERT`, buscar flow existente: `name = 'Boas-vindas (quando entra no grupo)' AND type = 'template' AND user_id = userId`
- Se existir, retornar o `id` existente.
- Se não existir, criar e retornar o novo `id`.

### 4.2 API de template (prioridade alta)
Em `POST /api/admin/flows/templates/welcome`:
- Retornar mensagem distinta quando o template já existia: ex. "Template já existe" com `flow_id` para redirecionar.

### 4.3 UI na página de flows (prioridade média)
- Se o usuário já tem o template de boas-vindas, o botão pode:
  - Mudar para "Abrir template Boas-vindas" (e redirecionar para o existente), ou
  - Mostrar aviso: "Você já possui este template".

### 4.4 Deduplicação de dados existentes (opcional)
- Script/migration para usuários que já têm múltiplos templates:
  - Manter o mais antigo (ou o que tiver ativações).
  - Desativar ou remover os demais.
  - Migrar `flow_instances` dos flows removidos para o flow mantido (se fizer sentido).

---

## 5. Arquivos envolvidos

| Arquivo | Alteração |
|---------|-----------|
| `lib/services/flow-templates-service.ts` | Verificar template existente antes de criar |
| `app/api/admin/flows/templates/welcome/route.ts` | Tratar retorno quando já existe |
| `app/admin/flows/page.tsx` | Opcional: ajustar texto do botão conforme existência |

---

## 6. Fluxo do executor (sem alteração necessária)

O `flow-executor-service` busca `flow_instances` por `instance_name` + `group_jid` e executa o flow associado. Se houver várias `flow_instances` para o mesmo grupo (de flows diferentes de boas-vindas), cada uma será executada. A correção na origem (evitar flows duplicados) resolve o problema na execução.
