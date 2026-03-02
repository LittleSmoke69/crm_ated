  # Zaploto V2 — Escopo da Aplicação (Versão Atual)

  **Documento:** Análise completa de funcionalidades, cargos e escopo  
  **Data:** 27/02/2026  
  **Versão:** 1.0

  ---

  ## 1. Visão Geral

  ### 1.1 Tipo de Aplicação

  | Aspecto | Tecnologia |
  |---------|------------|
  | **Stack** | Fullstack SPA com Next.js 16 (App Router) |
  | **Frontend** | React 19 |
  | **Backend** | API Routes do Next.js (`app/api/`) |
  | **Banco de Dados** | Supabase (PostgreSQL) |
  | **Deploy** | Netlify (Next.js + serverless functions) |
  | **White Label** | Multi-tenant por slug (`zaploto.com/{slug}/...`) |

  ### 1.2 Stack Técnica Detalhada

  | Camada | Tecnologias |
  |--------|-------------|
  | Runtime | Node.js 20 |
  | Framework | Next.js 16 |
  | React | 19.2 |
  | Banco de Dados | Supabase (PostgreSQL) |
  | Autenticação | Sessão (sessionStorage/localStorage/cookie) + bcrypt |
  | UI | Tailwind CSS 4, Lucide React |
  | Gráficos | Recharts, ReactFlow |
  | Validação | Zod |
  | Filas | AMQP (amqplib) |
  | Integrações | Evolution API (WhatsApp), Wasender, Meta Graph API, VTurb Analytics |

  ---

  ## 2. Sistema de Cargos (Roles)

  ### 2.1 Cargos Padrão

  O sistema utiliza o campo `profiles.status` como identificador do cargo do usuário. Cada cargo possui rota inicial de acesso (landing route) e permissões configuráveis via tabelas white label.

  | Código | Label | Rota Inicial | Descrição |
  |--------|-------|--------------|-----------|
  | `super_admin` | Super Admin | `/admin` | Acesso total ao sistema |
  | `admin` | Admin | `/admin` | Painel admin restrito (sem maturador, flows, webhooks, chat, gestão de banca) |
  | `suporte` | Suporte | `/admin/hierarchy` | Hierarquia e operação |
  | `auditoria` | Auditoria | `/admin` | Auditoria e anti-spam |
  | `dono_banca` | Dono de Banca | `/dono-banca` | Gestão da banca, visão de gerentes |
  | `gestor` | Gestor de Tráfego | `/gestor-trafego` | VSL, Meta Ads, fluxos de tráfego |
  | `gerente` | Gerente | `/gerente` | Gestão de consultores subordinados |
  | `consultor` | Consultor | `/crm/kanban` | Operacional: CRM, campanhas, desempenho |

  ### 2.2 Hierarquia Organizacional

  ```
  Super Admin / Admin / Suporte / Auditoria (nível plataforma)
                      │
  Dono de Banca ──────┼──► Gerente ──► Consultor
                      │
  Gestor de Tráfego ──┘
  ```

  - **Consultor** → vinculado a um **Gerente** (`profiles.enroller`)
  - **Gerente** → vinculado a um **Dono de Banca**
  - **Gestor** → vinculado a Dono de Banca ou Admin
  - **Suporte / Auditoria** → vinculados a Admin

  ### 2.3 Permissões Dinâmicas (White Label)

  O sistema suporta permissões por tenant através das tabelas:

  - **zaploto_roles** — cargos por tenant (code, label, landing_route, etc.)
  - **zaploto_sidebar_items** — itens de menu
  - **zaploto_role_sidebar** — visibilidade da sidebar por cargo
  - **zaploto_admin_steps** — abas/steps do painel admin
  - **zaploto_role_admin_steps** — permissão por aba (visible, can_execute)

  ### 2.4 Visibilidade por Cargo (Sidebar Padrão)

  | Cargo | Itens visíveis (resumo) |
  |-------|-------------------------|
  | **Super Admin** | Todos |
  | **Admin** | Exceto maturador, flows, integrations, webhooks, meta_ads, chat, gestao_banca |
  | **Suporte** | dashboard, hierarquia, instances, maturador, ai_agents, chat, crm, campanhas, contacts, import, meu_anti_spam, profile |
  | **Auditoria** | dashboard, instances, maturador, ai_agents, crm, campanhas, contacts, auditoria, anti_spam, profile |
  | **Dono Banca** | gestao_banca, dashboard, instances, maturador, crm, campanhas, contacts, meu_anti_spam, profile |
  | **Gestor** | gestao_trafego, vsl_redirect, dashboard, instances, maturador, crm, campanhas, contacts, meu_anti_spam, profile |
  | **Gerente** | gestao_consultores, dashboard, instances, ai_agents, crm, campanhas, contacts, list_cleaning, meu_anti_spam, profile |
  | **Consultor** | meu_desempenho, instances, crm, campanha_consultor, ai_agents, meu_anti_spam, profile |

  ---

  ## 3. Autenticação e Sessão

  ### 3.1 Fluxo de Login

  1. Usuário envia email + senha para `POST /api/auth/login`
  2. API valida em `profiles`, compara hash com bcrypt
  3. Retorna `userId`, `email`, `status`
  4. Cliente grava `user_id` em sessionStorage, localStorage e cookie
  5. Redireciona conforme `status` para rota inicial do cargo

  ### 3.2 Identificação nas APIs

  - Header **`X-User-Id`** em todas as requisições autenticadas
  - Sem JWT: autenticação própria, não utiliza Supabase Auth

  ### 3.3 Recuperação de Senha

  - Fluxo via `POST /api/forgot-password/send-code` e página `/forgot-password`

  ---

  ## 4. Módulos e Funcionalidades

  ### 4.1 Dashboard

  - **Rota:** `/`
  - **KPIs:** Instâncias WhatsApp, campanhas, gráficos
  - **Visão:** Geral do sistema conforme permissões do usuário

  ### 4.2 Instâncias WhatsApp (Evolution API)

  - **Rotas:** `/instances`
  - **Funcionalidades:**
    - Criar, configurar e gerenciar instâncias Evolution API
    - Conectar via QR Code
    - Verificar status (ok, connecting, disconnected)
    - Sincronizar grupos

  ### 4.3 Maturador

  - **Rotas:** `/maturador` (usuário), `/admin/maturador` (admin)
  - **Funcionalidades:**
    - Maturação manual/agendada (instâncias mestre)
    - Auto-maturação virgem (5 dias) para instâncias novas
    - Planos de maturação com steps configuráveis
    - Feed de mensagens estilo WhatsApp
    - Jobs e logs de execução
  - **Acesso:** `super_admin`, `admin` ou cargo com item "maturador" na sidebar

  ### 4.4 CRM (Customer Relationship Management)

  - **Rotas:**
    - `/crm/kanban` — Kanban de leads
    - `/crm/transferido` — Leads transferidos
    - `/crm/activations` — Disparo de mensagens (ativações)
    - `/crm/groups` — Grupos de campanha

  - **Funcionalidades:**
    - Kanban com colunas por status do lead
    - Transferência de leads entre consultores
    - Ativações: envio em massa de mensagens
    - Integração com API externa de CRM (CRM_API_KEY)
    - Bancas vinculadas via `user_bancas` e `crm_bancas`

  - **Status de Lead (exemplos):** novo, sem_deposito, contato, deposito, aposta, ativo, inativo, etc.

  - **Status Térmico:** cold, very_cold, active, hot, cooling

  ### 4.5 Campanhas

  - **Rotas:**
    - `/add-to-group` — Adição em grupos
    - `/crm/activations` — Mensagens de ativação
    - `/campanha/groups` — Grupos de campanha

  - **Funcionalidades:**
    - Disparo em massa
    - Adição de contatos em grupos
    - Campanhas de mensagem
    - Status: pending, running, completed, failed
    - Processamento via fila (Netlify function `process-campaign-queue`)

  ### 4.6 Anti-Spam

  - **Rotas:** `/anti-spam` (usuário), `/admin/anti-spam` (admin)
  - **Funcionalidades:**
    - Blacklist de grupos
    - Auditoria de grupos
    - Configuração por banca
    - Eventos e ações (bloqueio, remoção)

  ### 4.7 List Cleaning (Limpeza de Lista)

  - **Rota:** `/list-cleaning`
  - **Funcionalidades:**
    - Upload de números (textarea ou CSV)
    - Deduplicação
    - Verificação via Wasender API (active/inactive/unknown)
    - Download CSV com números validados
    - Processamento em slots via Netlify function `list-cleaning-resume`

  ### 4.8 Chat Interno

  - **Rota:** `/chat`
  - **Funcionalidades:**
    - Chat via WhatsApp Oficial
    - Canais, conversas, mensagens
    - Integração com webhook WhatsApp Business API

  ### 4.9 Academy (Área de Aprendizado)

  - **Rotas públicas:**
    - `/academy` — Home (vitrine)
    - `/academy/trilhas` — Trilhas
    - `/academy/modulos/[moduleSlug]` — Aulas do módulo
    - `/academy/aula/[lessonSlug]` — Página da aula
    - `/academy/materiais` — Materiais de apoio

  - **Rotas admin:**
    - `/admin/academy` — Dashboard
    - `/admin/academy/modulos` — CRUD módulos
    - `/admin/academy/aulas` — CRUD aulas
    - `/admin/academy/assets` — Upload de materiais
    - `/admin/academy/analytics` — Relatórios VTurb

  - **Funcionalidades:**
    - Módulos e aulas (VTurb, iframe, texto)
    - Progresso por usuário
    - Comentários em aulas
    - Thumbnails
    - Integração VTurb Analytics

  ### 4.10 Flows (Automações)

  - **Rotas:** `/admin/flows`, `/admin/flows/[flowId]`, `/admin/flows/[flowId]/activations`, `/admin/flows/[flowId]/executions`
  - **Funcionalidades:**
    - Editor visual com ReactFlow
    - Tipos de nós: webhookTrigger, switch, randomPicker, sendMessage, generateImage, generateVideo, agentIA, etc.
    - Execução via webhook Evolution
    - Histórico de execuções
    - Geração de imagem/vídeo com Gemini API

  ### 4.11 VSL & Redirect

  - **Rotas:** `/admin/vsl`, `/admin/vsl/new`, `/admin/vsl/[projectId]`, `/admin/redirect/[projectSlug]`
  - **Landing:** `/vsl/[slug]`, `/r/[slug]`
  - **Funcionalidades:**
    - Projetos VSL
    - Páginas de destino
    - Redirects rastreáveis
    - Edição de páginas

  ### 4.12 Meta Ads

  - **Rota:** `/admin/meta`
  - **Funcionalidades:**
    - Configuração de token (criptografado)
    - Sincronização de campanhas
    - Métricas: alcance, impressões, cliques, leads, spend
    - Integração com Gestor de Tráfego

  ### 4.13 Gestor de Tráfego

  - **Rotas:** `/gestor-trafego`, `/gestor-trafego/gerentes/[gerenteId]`, `/gestor-trafego/consultores/[consultorId]`
  - **Funcionalidades:**
    - Dashboard de tráfego
    - Funil 3D (Meta Ads + Loteria)
    - Visão de gerentes e consultores
    - Métricas de cadastros, depósitos, ativos

  ### 4.14 Dono de Banca

  - **Rotas:** `/dono-banca`, `/dono-banca/gerentes/[gerenteId]`, `/dono-banca/consultores/[consultorId]`
  - **Funcionalidades:**
    - Visão da banca
    - Gerentes e consultores vinculados
    - Bancas: `banca_name`, `banca_url` em profiles

  ### 4.15 Gerente

  - **Rotas:** `/gerente`, `/gerente/consultores/[consultorId]`, `/gerente/consultor/[consultorId]/crm`
  - **Funcionalidades:**
    - Dashboard de consultores subordinados
    - CRM filtrado por consultores da equipe

  ### 4.16 Consultor

  - **Rota:** `/consultor`
  - **Funcionalidades:**
    - Meu desempenho individual
    - Métricas de vendas/ativações

  ### 4.17 Agentes IA

  - **Rotas:** `/ai-agents` (usuário), `/admin/ai-agents` (admin)
  - **Funcionalidades:**
    - Configuração de agentes de IA
    - Integração com flows (nó agentIA)

  ### 4.18 Painel Admin

  - **Rota:** `/admin`
  - **Abas/Steps (configuráveis):**
    - overview (Dashboard)
    - users (Usuários)
    - crm (CRM)
    - lead_transfer (Transferência de Leads)
    - disparo (Disparo)
    - loto_assistencia (Loto Assistência)
    - meta_ads (Meta Ads)
    - vsl_redirect (VSL & Redirect)
    - campaigns (Campanhas)
    - settings (Configurações)
    - proxys (Proxys)
    - maturador (Maturador)

  ### 4.19 Hierarquia (Admin)

  - **Rota:** `/admin/hierarchy`
  - **Funcionalidades:**
    - Criação de usuários (Dono de Banca, Gestor, Gerente, Consultor)
    - Atribuição de cargos
    - Vincular consultores a gerentes
    - Bancas por usuário (user_bancas)
    - Gestão de CRM bancas (crm_bancas)

  ### 4.20 Auditoria

  - **Rota:** `/admin/audit`
  - **Funcionalidades:**
    - Eventos de instâncias
    - Sincronização de nomes de grupos
    - Saídas de participantes
    - Exportação CSV
    - Eventos raw

  ### 4.21 Integrações (Admin)

  - **Webhooks Evolution:** `/admin/webhooks/evolution`
  - **Regras de Normalização:** `/admin/webhooks/normalization-rules`
  - **WhatsApp Oficial:** `/admin/whatsapp-official`
  - **Chat Instances:** `/admin/chat-instances`

  ### 4.22 Perfil

  - **Rota:** `/perfil`
  - **Funcionalidades:**
    - Configurações do usuário
    - Bancas associadas
    - Tema (claro/escuro)
    - Telefone, heartbeat

  ---

  ## 5. Modelo de Dados (Tabelas Principais)

  | Tabela | Descrição |
  |--------|-----------|
  | `profiles` | Usuários: id, email, password_hash, status, enroller, zaploto_id, banca_name, banca_url |
  | `whatsapp_instances` | Instâncias WhatsApp Evolution |
  | `evolution_apis` | APIs Evolution |
  | `evolution_instances` | Instâncias por Evolution API |
  | `whatsapp_groups` | Grupos WhatsApp |
  | `campaigns` | Campanhas de disparo |
  | `messages` | Mensagens para campanhas |
  | `user_settings` | Limites por usuário |
  | `academy_modules` | Módulos da Academy |
  | `academy_lessons` | Aulas |
  | `academy_user_progress` | Progresso do usuário |
  | `flows` | Automações |
  | `flow_executions` | Execuções de flows |
  | `zaploto_tenants` | Tenants white label |
  | `zaploto_roles` | Cargos por tenant |
  | `zaploto_sidebar_items` | Itens da sidebar |
  | `zaploto_role_sidebar` | Permissões sidebar × role |
  | `zaploto_admin_steps` | Steps do painel admin |
  | `zaploto_role_admin_steps` | Permissões admin × role |
  | `user_bancas` | Bancas por usuário |
  | `crm_bancas` | Bancas CRM |
  | `master_instances` | Instâncias mestre (maturador) |
  | `maturation_jobs` | Jobs de maturação |
  | `maturation_plans` | Planos de maturação |
  | `list_cleaning_jobs` | Jobs de limpeza de lista |
  | `list_cleaning_items` | Itens por job |
  | `meta_integrations` | Configuração Meta Ads |
  | `meta_campaigns` | Campanhas Meta |
  | `meta_insights_daily` | Insights diários |

  ---

  ## 6. APIs Principais (Endpoints)

  ### Autenticação

  - `POST /api/auth/login`

  ### Usuário

  - `GET /api/user/profile`
  - `GET /api/user/bancas`
  - `GET /api/user/theme`
  - `GET /api/user/telefone`
  - `GET /api/user/heartbeat`

  ### CRM

  - `GET/POST /api/crm/bancas`
  - `GET /api/crm/transferred-leads`
  - `POST /api/crm/activations/send`
  - `GET /api/crm/leads` (via integração externa)

  ### Campanhas e Instâncias

  - `GET/POST /api/campaigns`
  - `GET/POST /api/instances`
  - `GET/POST /api/groups`
  - `POST /api/groups/sync`

  ### Admin

  - `GET /api/admin/users`
  - `GET /api/admin/stats`
  - `GET/POST /api/admin/crm/bancas`
  - `GET /api/admin/crm/transfer-logs/*`
  - `GET/PUT /api/admin/zaploto/tenants`
  - `GET/POST /api/admin/zaploto/roles`
  - `GET/PUT /api/admin/whatsapp-official-configs`
  - `GET/POST /api/admin/anti-spam/*`
  - `GET /api/admin/audit/*`

  ### Academy

  - `GET /api/academy/modules`
  - `GET /api/academy/lessons`
  - `GET/POST /api/academy/progress`
  - `GET /api/academy/materials`
  - `GET/POST /api/admin/academy/modules`
  - `GET/POST /api/admin/academy/lessons`

  ### Maturador

  - `GET /api/maturation/jobs`
  - `POST /api/maturation/start`
  - `GET /api/maturation/plans`
  - `GET /api/maturation/virgin-instances`

  ### Chat

  - `GET /api/chat/conversations`
  - `GET /api/chat/messages`
  - `POST /api/chat/whatsapp-official/send`

  ### Gestor / Gerente / Dono / Consultor

  - `GET /api/gestor-trafego/*`
  - `GET /api/gerente/dashboard`
  - `GET /api/dono-banca/dashboard`
  - `GET /api/consultor/dashboard`

  ### Outros

  - `GET /api/kpis`
  - `POST /api/webhooks/evolution`
  - `POST /api/webhooks/whatsapp-official`
  - `GET /api/list-cleaning/*`
  - `POST /api/vturb/analytics`

  ---

  ## 7. Variáveis de Ambiente

  ### Obrigatórias

  | Variável | Uso |
  |----------|-----|
  | `NEXT_PUBLIC_SUPABASE_URL` | URL do Supabase |
  | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave anônima |
  | `SUPABASE_SERVICE_ROLE_KEY` | Chave de serviço (backend) |

  ### Opcionais por Funcionalidade

  | Variável | Uso |
  |----------|-----|
  | `CRM_API_KEY` | API externa de CRM |
  | `EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY` | Evolution API |
  | `EVOLUTION_WEBHOOK_TOKEN` | Token de webhooks Evolution |
  | `NEXT_PUBLIC_APP_URL` | URL base para callbacks |
  | `NEXT_PUBLIC_WEBHOOK_BASE_URL` | Base para webhooks |
  | `WASENDER_API_KEY` | Wasender (list cleaning) |
  | `GEMINI_API_KEY` | Geração de imagem/vídeo em flows |
  | `VTURB_ANALYTICS_TOKEN` | Academy (VTurb) |
  | `ENCRYPTION_PEPPER` | Criptografia (ex.: Meta token) |
  | `PROCESS_CAMPAIGN_QUEUE_URL` | Netlify function de campanhas |
  | `NETLIFY_ACCESS_TOKEN`, `NETLIFY_SITE_ID` | Scheduled functions |
  | `MATURATION_MIN_HEALTH_SCORE`, `MATURATION_MAX_HOURS_SINCE_LAST_JOB`, `MATURATION_DEFAULT_PLAN_ID` | Maturador |
  | `ANTI_SPAM_POLL_MS`, `ANTI_SPAM_BATCH_SIZE` | Worker anti-spam |

  ---

  ## 8. Netlify Functions (Jobs Agendados)

  | Função | Uso |
  |--------|-----|
  | `process-message-queue` | Fila de mensagens |
  | `process-campaign-queue` | Processamento de campanhas |
  | `maturation-scheduler` | Agendamento de jobs de maturação |
  | `maturation-tick` | Tick de maturação (1 min) |
  | `maturation-start` | Início de jobs manuais |
  | `transfer-expired-notify` | Notificação de transferências expiradas |
  | `academy-vturb-snapshots` | Snapshots VTurb |
  | `check-instances-status` | Verificação de status das instâncias |
  | `audit-group-names-sync` | Sincronização de nomes de grupos |
  | `list-cleaning-resume` | Continuação de jobs de limpeza |

  ---

  ## 9. White Label (Multi-tenant)

  - **URL:** `zaploto.com/{slug}/login` ou `zaploto.com/login`
  - **Middleware:** Detecta slug no primeiro segmento; se não for rota reservada, trata como tenant
  - **Cookie:** `zaploto_slug` define o tenant ativo
  - **Banco:** `zaploto_id` em profiles e tabelas relacionadas para filtrar dados por tenant

  ---

  ## 10. Fluxos de Negócio Principais

  ### Login → Redirecionamento

  1. Usuário informa email e senha
  2. API valida e retorna status
  3. Cliente grava sessão e redireciona para `getLandingRouteByStatus(status)`

  ### CRM / Hierarquia

  - **Consultor:** leads da própria carteira (via API externa + user_bancas)
  - **Gerente:** visão dos consultores subordinados
  - **Dono:** visão da banca e gerentes
  - **Gestor:** Meta Ads, VSL, fluxos de tráfego

  ### Flow Executor

  1. Webhook Evolution recebe evento
  2. FlowExecutorService busca flow ativo
  3. Executa nós (sendMessage, generateImage, agentIA, etc.)
  4. Registra execução em `flow_executions`

  ### Maturador

  - Jobs mestre: `maturation-scheduler` cria, `maturation-tick` processa
  - Instâncias virgens: maturação automática 5 dias após escanear QR

  ---

  ## 11. Resumo Executivo

  A aplicação Zaploto V2 é uma plataforma de gestão para operações de loteria/bingos, com foco em:

  - **CRM** e gestão de leads com hierarquia Dono → Gerente → Consultor
  - **WhatsApp** via Evolution API (instâncias, grupos, disparos)
  - **Maturação** de números
  - **Campanhas** de mensagens e adição em grupos
  - **Anti-spam** e auditoria
  - **Academy** estilo Netflix
  - **Flows** (automações visuais)
  - **Meta Ads** para Gestor de Tráfego
  - **VSL e Redirect** para conversão
  - **White label** multi-tenant

  O sistema possui **8 cargos** padrão com permissões granulares por sidebar e abas do admin. A autenticação é própria (bcrypt), sem Supabase Auth. O deploy é via Netlify com várias funções serverless para filas e jobs agendados.

  ---

  *Documento gerado com base na análise do código-fonte e documentação existente.*
