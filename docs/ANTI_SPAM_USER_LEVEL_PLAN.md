# Plano: Anti-Spam por Usuário + Blacklist Global/Usuário

## Objetivo

- **super_admin, admin, auditoria**: acesso total aos dados; configuram instâncias que recebem eventos; lista negra **global**; removem números via Evolution API.
- **Qualquer cargo**: pode configurar seu próprio anti-spam; escolher instância de remoção; escolher grupos protegidos; ver eventos de entrada; ter lista negra **do usuário**; adicionar números manualmente ou a partir de entradas.

---

## 1. Schema (Nova migration)

**Arquivo:** `migrations/add_anti_spam_user_level.sql`

### 1.1 `anti_spam_configs` — suportar owner por usuário

```sql
-- Adicionar owner_type e owner_id (banca_id vira derivado para admin, user_id para usuário)
ALTER TABLE anti_spam_configs
  ADD COLUMN IF NOT EXISTS owner_type text NOT NULL DEFAULT 'banca'
    CHECK (owner_type IN ('banca', 'user')),
  ADD COLUMN IF NOT EXISTS owner_id uuid NULL;  -- user_id quando owner_type='user'

-- Para configs existentes: owner_type='banca', owner_id=NULL, banca_id permanece
-- Novos configs admin: owner_type='banca', banca_id preenchido
-- Novos configs usuário: owner_type='user', owner_id=user_id, banca_id=NULL (ou banca do enroller)

-- Tornar banca_id opcional (config de usuário pode não ter banca)
ALTER TABLE anti_spam_configs ALTER COLUMN banca_id DROP NOT NULL;

-- Tornar denuncia_group_jid opcional (usuário pode não usar grupo de denúncia)
ALTER TABLE anti_spam_configs ALTER COLUMN denuncia_group_jid DROP NOT NULL;

-- Cursor: suportar user_id além de banca_id
ALTER TABLE anti_spam_event_cursor
  ADD COLUMN IF NOT EXISTS user_id uuid NULL,
  DROP CONSTRAINT IF EXISTS anti_spam_event_cursor_banca_id_key;
-- Novo unique: (banca_id, user_id) - um deles preenchido
```

### 1.2 `anti_spam_blacklist` — escopo global vs usuário

```sql
-- Adicionar scope: 'global' (só admin) ou 'user' (qualquer um)
ALTER TABLE anti_spam_blacklist
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'user'
    CHECK (scope IN ('global', 'user'));

-- Global: config_id de config admin (owner_type='banca')
-- User: config_id de config do usuário (owner_type='user')

-- Ajustar UNIQUE para (config_id, phone_e164, scope) se necessário
```

### 1.3 Índices

```sql
CREATE INDEX IF NOT EXISTS idx_anti_spam_configs_owner 
  ON anti_spam_configs(owner_type, owner_id) 
  WHERE owner_type = 'user';

CREATE INDEX IF NOT EXISTS idx_anti_spam_blacklist_scope 
  ON anti_spam_blacklist(config_id, scope) 
  WHERE status = 'active';
```

---

## 2. APIs a criar/ajustar

### 2.1 Novas rotas ou parâmetros

| Rota | Ação | Permissão |
|------|------|-----------|
| `GET /api/anti-spam/config` | Lista config do usuário logado (owner_type=user, owner_id=userId) | Qualquer autenticado |
| `POST /api/anti-spam/config` | Cria/atualiza config do usuário (owner_type=user) | Qualquer autenticado |
| `GET /api/anti-spam/blacklist` | Lista blacklist do usuário; admin vê também global | Qualquer / Admin |
| `POST /api/anti-spam/blacklist/add` | Adiciona com scope user ou global (admin) | Qualquer / Admin |
| `GET /api/anti-spam/events` | Eventos de entrada (config do usuário ou admin) | Qualquer / Admin |
| `GET /api/anti-spam/actions` | Logs do usuário ou global | Qualquer / Admin |

### 2.2 Middlewares de permissão

- `requireAntiSpamAccess`: continua para admin/auditoria (acesso total + global).
- `requireAuth`: para rotas de usuário (qualquer cargo) — acesso apenas aos próprios dados.

### 2.3 Arquivos afetados

| Arquivo | Alteração |
|---------|-----------|
| `app/api/admin/anti-spam/config/route.ts` | Manter para admin (banca_id). Adicionar lógica para `owner_type` |
| `app/api/anti-spam/config/route.ts` | **NOVO** — config por user_id |
| `app/api/anti-spam/blacklist/route.ts` | **NOVO** — blacklist do usuário (scope user) |
| `app/api/anti-spam/blacklist/add/route.ts` | **NOVO** — adicionar com scope user |
| `app/api/anti-spam/events/route.ts` | **NOVO** — eventos por config do usuário |
| `app/api/anti-spam/actions/route.ts` | **NOVO** — ações do usuário |
| `lib/middleware/permissions.ts` | `requireAuth` já existe; opcional: `requireAntiSpamUserAccess` |

---

## 3. Worker (`antiSpamWorker.ts`)

### 3.1 Lógica atual

- Carrega configs ativas (`is_enabled=true`).
- Para cada banca, busca eventos, verifica blacklist e remove via Evolution API.

### 3.2 Alterações

- Carregar configs com `owner_type IN ('banca','user')`.
- Para cada config:
  - Se `owner_type='banca'`: cursor por `banca_id`; blacklist com `scope='global'` (configs admin).
  - Se `owner_type='user'`: cursor por `user_id`; blacklist com `scope='user'` e `config_id` da config do usuário.
- Ao verificar blacklist: **usar união** de blacklist global (da banca/instância) + blacklist do usuário (quando config for de usuário).
- Se o evento vier de instância usada por config de usuário, checar:
  1. Blacklist global (se houver config admin para a banca dessa instância).
  2. Blacklist do usuário dono da config.

### 3.3 Cursor

- `anti_spam_event_cursor`: permitir `banca_id` OU `user_id`.
- `getCursor(bancaId?, userId?)` e `updateCursor(bancaId?, userId?, ...)`.

---

## 4. Frontend

### 4.1 Rotas

- Admin: `/admin/anti-spam` — continua igual; usa `banca_id` e APIs admin.
- Usuário: `/anti-spam` — nova página; usa `user_id` e APIs `/api/anti-spam/*`.

### 4.2 Página do usuário (`app/anti-spam/page.tsx`)

- Similar à admin, mas:
  - Sem campo "Banca ID".
  - Carrega config do usuário logado automaticamente.
  - Lista negra: apenas do usuário (sem aba "global").
  - Grupos protegidos: escolher quais grupos proteger.
  - Eventos de entrada: ver quem entrou e bloquear.
  - Números removidos: ver remoções feitas pelo próprio anti-spam.

### 4.3 Página admin (`app/admin/anti-spam/page.tsx`)

- Aba "Lista negra": seletor "Minha lista" / "Lista global" (só para admin/auditoria).
- Demais abas permanecem.

### 4.4 Sidebar

- **Todos os cargos**: exibir "Anti-Spam" em `/anti-spam`.
- **Admin/Auditoria**: além de `/anti-spam`, manter `/admin/anti-spam` para dados globais.

**Arquivos afetados:**

| Arquivo | Alteração |
|---------|-----------|
| `app/anti-spam/page.tsx` | **NOVO** — página do usuário |
| `app/admin/anti-spam/page.tsx` | Aba lista global + manter fluxo por banca |
| `components/Sidebar.tsx` | Incluir Anti-Spam para todos (usando `/anti-spam`) |
| `migrations/seed_zaploto_default_roles_and_sidebar.sql` | Adicionar `anti_spam` aos roles que ainda não têm |

---

## 5. Ordem de implementação sugerida

1. Migration `add_anti_spam_user_level.sql`.
2. Atualizar `antiSpamWorker.ts` para suportar `owner_type`, cursor por user e blacklist global+user.
3. Criar APIs `/api/anti-spam/*` (config, blacklist, events, actions).
4. Criar página `/anti-spam` para usuário.
5. Atualizar Sidebar e seed para exibir Anti-Spam para todos.
6. Ajustar página admin para aba "Lista global".

---

## 6. Arquivos novos vs modificados

### Novos

- `migrations/add_anti_spam_user_level.sql`
- `app/anti-spam/page.tsx`
- `app/api/anti-spam/config/route.ts`
- `app/api/anti-spam/blacklist/route.ts`
- `app/api/anti-spam/blacklist/add/route.ts`
- `app/api/anti-spam/events/route.ts`
- `app/api/anti-spam/actions/route.ts`

### Modificados

- `lib/anti-spam/antiSpamWorker.ts`
- `lib/anti-spam/types.ts`
- `app/admin/anti-spam/page.tsx` (aba lista global)
- `components/Sidebar.tsx` (Anti-Spam para todos)
- `migrations/seed_zaploto_default_roles_and_sidebar.sql`
- `docs/ANTI_SPAM.md`

---

## 7. Fluxo de remoção (Evolution API)

- Já implementado em `evolution-client.ts` (`removeParticipant`).
- Worker continua usando `master_instance_id` da config para remover.
- Config do usuário deve ter `master_instance_id` preenchido (instância que remove).
- Instâncias disponíveis: API existente `/api/admin/evolution/instances` ou criar `/api/evolution/instances` para usuário (filtrar por permissão).

---

## 8. Considerações

- **Banca do usuário**: dono_banca, gerente e consultor podem ter `banca_url`/`banca_name`; usar para vincular config de usuário à banca, se desejado.
- **RLS**: avaliar RLS nas tabelas anti-spam para usuários acessarem apenas seus dados.
- **Instâncias**: definir quais instâncias cada cargo pode escolher (ex.: dono_banca só as da sua banca).
