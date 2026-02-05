# Auditoria de Saídas de Participantes (group-participants.update)

**Data:** 2026-01-30  
**Status:** ✅ Implementado

## Objetivo

Garantir rastreabilidade, histórico e controle estratégico de todos os usuários que saem (ou são removidos) de grupos WhatsApp, permitindo gestão por **banca**, **grupo** e **período**, sem interferir na operação principal.

## Eventos monitorados

- **Tipo:** `group-participants.update`
- **Ação:** `action: "remove"` (usuário saiu ou foi removido do grupo)

## Dados capturados

| Campo no payload | Tratamento | Salvo como |
|------------------|------------|------------|
| `data.id` | JID do grupo (ex: `120363403357540053@g.us`) | `group_id` |
| `data.participants[0].phoneNumber` | Remover `@s.whatsapp.net` e não numéricos | `phone` |
| — | Resolvido via instância → dono → profile.banca_url → crm_bancas | `banca_id` |
| — | Sempre `"remove"` | `action` |
| — | `group-participants.update` | `event_type` |
| `data.author` / `data.by` | Se existir | `author` |
| Recebimento ou `data.timestamp` | Data/hora do evento | `occurred_at` |
| Payload completo | Opcional | `payload` (jsonb) |

## Tabela: `group_participant_exits`

- **Migration:** `migrations/create_group_participant_exits_audit.sql`
- **Campos:** `id`, `evolution_instance_id`, `banca_id`, `group_id`, `phone`, `action`, `event_type`, `author`, `occurred_at`, `payload`, `created_at`
- **Hierarquia:** Banca → Grupo → Evento → Usuário (nunca dados soltos)

## Fluxo

1. Webhook recebe evento (`POST /api/webhooks/evolution/prod` ou `/test`).
2. Se `event_type === 'group-participants.update'` e `action === 'remove'`, chama `participantExitAuditService.recordParticipantExit(payload, instanceName)` (assíncrono, não bloqueia).
3. Serviço extrai `group_id`, `phone` (normalizado), resolve `banca_id` pelo dono da instância e insere em `group_participant_exits`.

## API de consulta

**Endpoint:** `GET /api/admin/audit/participant-exits`  
**Acesso:** perfis `admin`, `dono_banca`, `gerente`, `auditoria`.

**Query params:**

| Parâmetro | Descrição |
|-----------|-----------|
| `banca_id` | Filtrar por banca (UUID) |
| `group_id` | Filtrar por grupo (JID) |
| `date_from` | Início do período (ISO ou YYYY-MM-DD) |
| `date_to` | Fim do período |
| `list` | `recent` (padrão) \| `unique_phones` \| `groups_evasion` |
| `page`, `limit` | Paginação |

**Modos de listagem:**

- **`list=recent`** (padrão): Registros de saída ordenados por `occurred_at` (mais recentes primeiro), com filtros por banca, grupo e período.
- **`list=unique_phones`**: Telefones únicos que já saíram, com `exit_count` e `last_exit_at`.
- **`list=groups_evasion`**: Grupos com maior evasão (`group_id` + `exit_count`), ordenados por quantidade de saídas.

## Variáveis de ambiente

Nenhuma variável nova. Usa as mesmas do projeto (Supabase, Evolution, etc.).

## Arquivos

- **Serviço:** `lib/services/participant-exit-audit-service.ts`
- **Webhooks:** `app/api/webhooks/evolution/prod/route.ts`, `app/api/webhooks/evolution/test/route.ts`
- **API:** `app/api/admin/audit/participant-exits/route.ts`
- **Migration:** `migrations/create_group_participant_exits_audit.sql`
