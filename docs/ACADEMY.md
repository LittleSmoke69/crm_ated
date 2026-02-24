# Academy (Área de Aprendizado)

Área de aprendizado estilo Netflix/Hotmart: vitrine pública, trilhas/módulos, aulas com player VTurb, anexos e progresso por usuário.

## Rotas

### Área externa (pública / vitrine)

| Rota | Descrição |
|------|-----------|
| `/academy` | Home: continuar de onde parou, cards de trilhas |
| `/academy/trilhas` | Lista de trilhas (módulos) |
| `/academy/modulos/[moduleSlug]` | Aulas do módulo |
| `/academy/aula/[lessonSlug]` | Página da aula: player, descrição, CTA, anexos, marcar concluída |
| `/academy/materiais` | Material de apoio: lista e download (PDF, DOC, imagens, etc.) — área de membros |

- Layout próprio, sem sidebar do app. Usuário não logado vê vitrine; player e downloads bloqueados com CTA "Entrar".

### Admin (somente admin e super_admin)

| Rota | Descrição |
|------|-----------|
| `/admin/academy` | Dashboard: módulos, aulas, materiais, analytics |
| `/admin/academy/modulos` | Lista de módulos (criar, editar, excluir, publicar, ordem) |
| `/admin/academy/modulos/novo` | Novo módulo |
| `/admin/academy/modulos/[id]` | Editar módulo |
| `/admin/academy/aulas` | Lista de aulas |
| `/admin/academy/aulas/novo` | Nova aula |
| `/admin/academy/aulas/[id]` | Editar aula (VTurb/iframe/texto, CTA, anexos) |
| `/admin/academy/assets` | Upload de materiais (PDF, DOC, imagens) |
| `/admin/academy/analytics` | Relatórios VTurb (eventos, engajamento, clicks, conversões) |

## Banco de dados (Supabase)

- **Migrations:** `migrations/create_academy_tables.sql`, `create_academy_rls_policies.sql`, `create_academy_storage_bucket.sql`, `add_academy_lesson_thumbnail_and_comments.sql`
- **Tabelas:** `academy_modules`, `academy_lessons` (com `thumbnail_url`), `academy_lesson_comments`, `academy_assets`, `academy_lesson_attachments`, `academy_user_progress`, `academy_vturb_snapshots`
- **Storage:** bucket `academy-assets` (PDF, DOC, DOCX, PNG, JPG, WEBP). Upload apenas admin; leitura conforme RLS.

## Variáveis de ambiente

| Variável | Descrição | Obrigatório |
|----------|-----------|--------------|
| `VTURB_ANALYTICS_TOKEN` | Chave da API VTurb Analytics | Para analytics e job de snapshot |
| `VTURB_ANALYTICS_VERSION` | Versão da API (ex: `v1`) | Não (default: v1) |
| `VTURB_ANALYTICS_TIMEZONE` | Timezone para relatórios (ex: `America/Sao_Paulo`) | Não (usado no cron) |

**Importante:** Não armazene a chave da API VTurb no frontend; use apenas em APIs server-side e no job agendado.

## APIs

### Públicas / Academy

- `GET /api/academy/modules` — módulos publicados (`is_published = true`)
- `GET /api/academy/lessons?moduleSlug=xxx` — aulas do módulo (exige **módulo** e **aulas** publicados; retorna 404 se o módulo não estiver publicado)
- `GET /api/academy/lessons/[slug]` — aula por slug (com módulo, anexos e `thumbnail_url`)
- `GET /api/academy/lessons/[slug]/comments` — comentários/dúvidas da aula
- `POST /api/academy/lessons/[slug]/comments` — criar comentário (body: `{ body }`; header `x-user-id`)
- `GET /api/academy/progress` — progresso do usuário (header `x-user-id`)
- `POST /api/academy/progress` — upsert progresso (body: `lessonId`, `status`; header `x-user-id`)
- `GET /api/academy/materials` — materiais de apoio publicados (para área de membros)
- `GET /api/academy/signed-url?path=xxx` — URL assinada para download (Storage)

### Admin

- `GET/POST /api/admin/academy/modules` — listar / criar módulos
- `GET/PATCH/DELETE /api/admin/academy/modules/[id]` — módulo
- `GET/POST /api/admin/academy/lessons` — listar / criar aulas
- `GET/PATCH/DELETE /api/admin/academy/lessons/[id]` — aula
- `GET /api/admin/academy/assets` — listar assets
- `POST /api/admin/academy/upload` — upload para Storage + registro em `academy_assets`
- `POST /api/admin/academy/upload-thumbnail` — thumbnail de módulo (FormData: file, moduleId)
- `POST /api/admin/academy/upload-lesson-thumbnail` — thumbnail de aula (FormData: file, lessonId)
- `GET/POST/DELETE /api/admin/academy/attachments` — anexos por aula

### VTurb Analytics (admin)

- `POST /api/vturb/analytics` — Body: `type` (events|engagement|clicks|conversions), `playerId`, `startDate`, `endDate`, `timezone`, opcional `lessonId`, `saveSnapshot`.

## Job agendado (Netlify)

- **Função:** `netlify/functions/academy-vturb-snapshots.ts`
- **Objetivo:** Para cada aula publicada com `vturb_player_id`, buscar eventos do dia na API VTurb e salvar em `academy_vturb_snapshots`.
- **Agendamento:** Configurar no Netlify (ex: cron `0 2 * * *` para 2h da manhã).
- **Env:** `VTURB_ANALYTICS_TOKEN`, `VTURB_ANALYTICS_VERSION`, `VTURB_ANALYTICS_TIMEZONE`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Player VTurb

- **Componente:** `components/academy/VturbPlayer.tsx`
- **SDK:** carregado uma vez via `next/script`: `https://scripts.converteai.net/lib/js/smartplayer-wc/v4/sdk.js`
- **Embed:** `https://scripts.converteai.net/{projectId}/players/{playerId}/v4/embed.html?...&vl={encodeURIComponent(location.href)}`

## Publicação (vitrine)

Para uma aula aparecer na vitrine (`/academy/trilhas` → módulo → aulas):

1. **O módulo** deve estar publicado: em Admin → Academy → Módulos, use o ícone de olho (verde = publicado).
2. **A aula** deve estar publicada: em Admin → Academy → Aulas, use o ícone de olho na aula.

Se apenas a aula estiver publicada e o módulo não, a página do módulo retornará "Módulo não encontrado ou não está publicado".

## Reordenação e thumbnail

- **Drag-and-drop:** Na lista de módulos (`/admin/academy/modulos`) e na lista de aulas com filtro por módulo (`/admin/academy/aulas?moduleId=...`), é possível reordenar arrastando o ícone de alça (GripVertical). A ordem é persistida via `POST /api/admin/academy/modules/reorder` e `POST /api/admin/academy/lessons/reorder` (body: `{ orderedIds: string[] }`).
- **Thumbnail de módulo:** Na edição do módulo (`/admin/academy/modulos/[id]`) há botão "Enviar imagem" que faz upload para `academy-assets/thumbnails/{moduleId}/{timestamp}.ext` via `POST /api/admin/academy/upload-thumbnail`. O campo `thumbnail_url` pode ser path do Storage ou URL externa. Na vitrine (`/academy`, `/academy/trilhas`), thumbnails em path são exibidas via `GET /api/academy/thumbnail?path=...` (redirect para signed URL).

## Checklist de aceite

- [x] Área `/academy` com layout externo
- [x] Admin cria/edita módulos e aulas, ordena (drag-and-drop), publica, thumbnail (upload)
- [x] Admin faz upload de PDF/DOC e associa anexos por aula
- [x] Player VTurb embutido (project_id + player_id, SDK 1x)
- [x] CTA configurável por aula (interno/externo)
- [x] Progresso por usuário (marcar concluída, continuar)
- [x] Painel Admin de Analytics (plays/events/engajamento/clicks/conversões) via API VTurb
- [x] RLS em todas as tabelas `academy_*`
