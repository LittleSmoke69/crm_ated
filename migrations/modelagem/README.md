# Modelagem — migrations isolados

Cada arquivo é **auto-contido, idempotente e aditivo**: adiciona só o necessário para
a sua função, **sem recriar o banco**. Rode individualmente no **SQL Editor do Supabase**
(copiar → colar → Run), na ordem abaixo.

| # | Arquivo | Função | Principais objetos |
|---|---------|--------|--------------------|
| 00 | `00_prerequisites.sql` | **Pré-requisitos** — torna a pasta auto-suficiente | Garante (IF NOT EXISTS) as tabelas/colunas-base que 01–05 referenciam: `profiles`, `zaploto_*`, `crm_leads`, `crm_bancas`, `whatsapp_official_configs`, `chat_conversations` (+colunas), `meta_insights_daily` |
| 01 | `01_roles_keep_four.sql` | **Acesso** — manter só 4 cargos | `zaploto_roles.is_active`; desativa auditoria/dono_banca/gestor/suporte/consultor; ativa super_admin, admin, gerente, captador |
| 02 | `02_crm_kanban_columns.sql` | **CRM Kanban** configurável (loteria + clientes) | `crm_columns` (11 colunas semeadas), `crm_lead_stage`, `crm_lead_stage_history`, RPC `crm_move_lead()` |
| 03 | `03_chat_oficial_atendimento_metricas.sql` | **Chat oficial** multi-atendente + métricas | `chat_agent_pool`, `chat_attendance_events`, colunas de TMPR em `chat_conversations`, RPCs `chat_claim_next_official/mark_first_response/resolve_conversation`, view `chat_attendance_metrics_daily` |
| 04 | `04_ads_meta_completar.sql` | **ADS Meta** — completar | `meta_ads`, `meta_insights_ad_daily`, `crm_lead_ad_attribution`, view `meta_campaign_roi_daily` |
| 05 | `05_hardening_security.sql` | **Hardening** dos objetos de 02/03/04 | `search_path` fixo + `REVOKE PUBLIC` nos RPCs, remove INSERT permissivo do histórico, `security_invoker` nas views |
| 06 | `06_nucleo_isolado.sql` | **Runtime isolado** | Completa tenant, perfis, bancas e semeia somente itens de sidebar suportados |
| 07 | `07_crm_tags.sql` | **Etiquetas do CRM** | `crm_tags`, `crm_lead_tags` e políticas de acesso |
| 09 | `09_meta_e_whatsapp_oficial.sql` | **Meta + WhatsApp Oficial** | Completa integrações, campanhas, insights, conversas, mensagens e storage |
| 11 | `11_chat_gestao_metricas.sql` | **Gestão do chat** | Atividade/login em `profiles` e RPC de métricas de suporte |
| 12 | `12_profiles_username.sql` | **Login por username** | `profiles.username`, normalização, backfill e índice único case-insensitive |
| 13 | `13_seed_usuarios_captadores.sql` | **Importação de usuários** | Perfis da planilha, senha inicial, status e vínculos gerente/captador |

**Ordem:** `00` → `01` → `02` → `03` → `04` → `05` → `06` → `07` → `09` → `11` → `12` → `13`.
- O **00 roda primeiro**: provisiona os pré-requisitos (inclusive `profiles`, espelhando
  `0000_foundation_supabase_core.sql`). Em banco já existente é **no-op total** (tudo `IF NOT EXISTS`).
- Sem o 00, 02/03/04 podem falhar com "relation/column does not exist" num ambiente que não
  tenha as tabelas-base (`crm_leads`, `chat_conversations`, `whatsapp_official_configs`,
  `crm_bancas`, `meta_insights_daily`) ou as colunas de atendimento em `chat_conversations`.
- Entre 02, 03 e 04 não há dependência (qualquer ordem). O **05 roda por último** —
  corrige as brechas de segurança dos objetos criados em 02/03/04.
- O 00 garante só **estrutura** (tabelas/colunas); RLS/policies dessas tabelas-base pertencem
  às migrations canônicas do app (já presentes no seu banco).

## O que a aplicação precisa passar a consumir (fora do escopo do SQL)

- **01 Roles:** a UI de seleção de cargo e o admin devem filtrar `zaploto_roles.is_active = true`.
  `profiles.status` continua sendo a fonte de verdade da autorização — para aposentar de
  fato os cargos antigos, reatribua usuários existentes (bloco **OPCIONAL** comentado no 01).
- **02 CRM:** o Kanban ([app/crm/kanban/page.tsx](../../app/crm/kanban/page.tsx)) deve ler colunas de
  `crm_columns` e a posição de `crm_lead_stage` (via RPC `crm_move_lead`) em vez das colunas
  hardcoded. As `auto_rule` preservam a classificação automática atual da loteria; o card
  arrastado à mão (`is_manual = true`) prevalece sobre a regra.
- **03 Chat:** o inbox de atendimento chama `chat_claim_next_official()` para puxar a próxima
  conversa, `chat_mark_first_response()` no primeiro envio e `chat_resolve_conversation()` ao
  fechar. Dashboard de gestão lê `chat_attendance_metrics_daily`. Popular `chat_agent_pool`
  com os usuários de cargo **admin** (ou equipe de atendimento) por número oficial.
- **04 ADS:** o sync Meta deve gravar `meta_ads` / `meta_insights_ad_daily`; o webhook oficial
  (referral CTWA) e/ou o cadastro do lead alimentam `crm_lead_ad_attribution`. Relatórios de
  ROI leem a view `meta_campaign_roi_daily`.

## Rollback

Cada arquivo cria objetos novos (ou colunas `ADD COLUMN IF NOT EXISTS`). Para reverter,
`DROP TABLE`/`DROP VIEW`/`DROP FUNCTION` dos objetos listados na tabela acima. As colunas
adicionadas em tabelas existentes (`chat_conversations`, `zaploto_roles`) podem ser mantidas
sem efeito colateral.
