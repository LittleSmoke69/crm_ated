# Análise: Envio e exibição de mensagens (texto, áudio, vídeo, imagem) no chat interno via API oficial do WhatsApp

**Data:** 12/03/2026  
**Objetivo:** Documentar como está implementado o envio e a recepção de mensagens (texto, áudio, vídeo, imagem) no chat interno usando a WhatsApp Cloud API (oficial).

---

## 1. Visão geral

O chat interno integra com a **WhatsApp Cloud API** (Meta) através de:

- **Envio:** `POST /api/chat/whatsapp-official/send` → `lib/services/whatsapp-official-service.ts`
- **Recepção:** Webhook `POST /api/webhooks/whatsapp-official/route.ts` → `chatService.saveMessage()`
- **Exibição:** `app/chat/page.tsx` + mensagens carregadas via `GET /api/chat/messages`

---

## 2. Endpoints da API oficial do WhatsApp (Meta)

Base URL usada no projeto: **`https://graph.facebook.com`** (Graph API). A versão vem de `graph_version` da config (ex.: `v25.0`).

| Uso no projeto | Método | Endpoint (Meta) | Onde é usado |
|----------------|--------|------------------|--------------|
| **Envio de mensagens** | `POST` | `https://graph.facebook.com/v{version}/{phone_number_id}/messages` | `lib/services/whatsapp-official-service.ts` em `sendText`, `sendImage` e `sendAudio` |
| **Webhook (verificação)** | `GET` | Nossa URL exposta (ex.: `/api/webhooks/whatsapp-official`) — a **Meta chama** nosso endpoint com `hub.mode`, `hub.verify_token`, `hub.challenge` | `app/api/webhooks/whatsapp-official/route.ts` (GET) |
| **Webhook (eventos)** | `POST` | Mesma URL — a **Meta envia** mensagens e status para nós | `app/api/webhooks/whatsapp-official/route.ts` (POST) |

**Não utilizado no fluxo atual do chat:**

- **Media API** — `GET https://graph.facebook.com/v{version}/{media_id}`  
  Necessário para obter a URL de download a partir do ID de mídia (ex.: `image.id`, `video.id`) que vem nas mensagens recebidas. Hoje não é chamado; por isso mensagens recebidas de mídia ficam sem `media_url` no banco.

Referência: [WhatsApp Cloud API – Messages](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages), [Webhooks](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks), [Media](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media).

---

## 3. Envio de mensagens (backend)

### 3.1 Rota de envio

**Arquivo:** `app/api/chat/whatsapp-official/send/route.ts`

| Tipo   | Suportado no backend | Observação |
|--------|----------------------|------------|
| Texto  | ✅ Sim               | `type: 'text'`, campo `text` obrigatório |
| Imagem | ✅ Sim               | `type: 'image'`, `media_url` obrigatório, `caption` opcional |
| Áudio  | ✅ Sim               | `type: 'audio'`, `media_url` obrigatório |
| Vídeo  | ❌ Não               | Não existe `type: 'video'` nem `sendVideo` no serviço |

- Validação: `type` deve ser um de `['text', 'image', 'audio']`. Qualquer outro valor (incluindo `'video'`) retorna 400.
- Janela de 24h: envio só é permitido se a última mensagem do contato tiver sido há menos de 24h; caso contrário, a API retorna erro orientando uso de template.

### 3.2 Serviço WhatsApp Official

**Arquivo:** `lib/services/whatsapp-official-service.ts`

- **`sendText(config, to, text, replyToMessageId?)`** – Envia texto; suporta `context.message_id` para resposta.
- **`sendImage(config, to, mediaUrl, caption?, replyToMessageId?)`** – Envia imagem por URL pública; caption opcional.
- **`sendAudio(config, to, mediaUrl, replyToMessageId?)`** – Envia áudio por URL pública.
- **`sendVideo`** – Não existe. A WhatsApp Cloud API suporta vídeo; a integração atual não implementa.

Resumo: **texto, imagem e áudio estão implementados no backend; vídeo não.**

---

## 4. Recepção de mensagens (webhook)

**Arquivo:** `app/api/webhooks/whatsapp-official/route.ts`

- **Metadata do payload:** Em todo evento a Meta envia `value.metadata` com `phone_number_id` (ex.: `"869289969604374"`) e opcionalmente `display_phone_number`. O webhook usa **apenas** `metadata.phone_number_id` para buscar a configuração ativa em `whatsapp_official_configs`. O cadastro em Admin > WhatsApp Oficial deve ter o **Phone Number ID** igual ao recebido no payload.
- **Tipos tratados:** texto, imagem, áudio, vídeo, documento (via `resolveMediaInfo`).
- Para cada mensagem recebida são persistidos: `message_id`, `text`, `media_type`, `caption`, `timestamp`, etc.
- **Problema:** Não é persistido `media_url` para mensagens recebidas. Na API oficial, mídia vem como **ID** (ex.: `image.id`, `video.id`). Para obter URL é necessário chamar a Media API da Meta (`GET /vXX.0/{media-id}` com token). Como isso não é feito, mensagens de imagem/áudio/vídeo/documento ficam no banco **sem URL**, apenas com `media_type` e texto/legenda.

Consequência: na listagem do chat, não há como exibir a mídia (imagem/áudio/vídeo) recebida, apenas o texto/legenda.

---

## 5. Persistência (chat-service e banco)

**Arquivo:** `lib/services/chat-service.ts`

- `saveMessage()` aceita `media_type` e `media_url` (e `caption`).
- O upsert é por `(conversation_id, message_id)`; deduplicação e atualização de resumo da conversa funcionam.

**Tabela `chat_messages`:** possui `media_url` (TEXT). Para mensagens **enviadas** com imagem/áudio, a rota de envio preenche `media_url` com a URL que o usuário informou. Para mensagens **recebidas**, o webhook não preenche `media_url` (e hoje a Meta envia só ID, não URL).

---

## 6. Frontend do chat (`app/chat/page.tsx`)

### 6.1 Envio

- **Evolution:** chama `POST /api/chat/send` com `type: 'text'` e `text`.
- **WhatsApp Oficial:** chama `POST /api/chat/whatsapp-official/send` com:
  - `config_id`, `to`, `type: 'text'`, `text: messageText`.
- Não há no frontend:
  - Seletor de tipo de mensagem (imagem/áudio/vídeo).
  - Upload de arquivo ou campo para `media_url`.
  - Uso de `type: 'image'` ou `type: 'audio'` (ou vídeo).

Ou seja: na tela do chat interno o usuário **só envia texto** para o canal WhatsApp Oficial. O backend até suporta imagem e áudio, mas a UI não expõe essa opção.

### 6.2 Exibição de mensagens

- Mensagens são exibidas com: `msg.text`, `msg.caption` e indicador de horário/status.
- Não há renderização específica para:
  - `media_type === 'image'` com `<img src={msg.media_url}>`
  - `media_type === 'audio'` com player de áudio
  - `media_type === 'video'` com player de vídeo
- Ícones Paperclip, Mic, FileText existem na barra de input mas **não têm ação** (só layout). Não abrem upload nem definem tipo de mídia.

Conclusão: mesmo que `media_url` viesse preenchido (envio ou futura resolução de ID no webhook), a tela atual não mostra imagem/áudio/vídeo, só texto e caption.

---

## 7. Resumo por tipo de mídia

| Tipo   | Envio (backend) | Envio (frontend) | Recepção (webhook) | Exibição (frontend) |
|--------|------------------|------------------|---------------------|----------------------|
| Texto  | ✅               | ✅               | ✅ (text + preview) | ✅                   |
| Imagem | ✅               | ❌ (só texto)    | ✅ tipo + caption   | ❌ (sem img)         |
| Áudio  | ✅               | ❌               | ✅ tipo             | ❌ (sem player)      |
| Vídeo  | ❌               | ❌               | ✅ tipo + caption   | ❌ (sem player)      |

---

## 8. Recomendações (ordem sugerida)

1. **Vídeo no envio (backend)**  
   - Em `whatsapp-official-service.ts`: implementar `sendVideo(config, to, mediaUrl, caption?, replyToMessageId?)` seguindo o mesmo padrão de `sendImage`/`sendAudio`.  
   - Em `app/api/chat/whatsapp-official/send/route.ts`: aceitar `type: 'video'`, validar `media_url` (e opcionalmente `caption`) e chamar `sendVideo`; persistir em `chat_messages` com `media_type: 'video'` e `media_url`.

2. **Envio de mídia no frontend**  
   - Na página do chat, para canal WhatsApp Oficial:  
     - Botão/opção para anexar arquivo (imagem, áudio, vídeo).  
     - Upload para um storage (ex.: Supabase Storage) ou uso de URL pública.  
     - Envio para `/api/chat/whatsapp-official/send` com `type: 'image' | 'audio' | 'video'` e `media_url` (e `caption` quando aplicável).

3. **Recepção: guardar URL de mídia**  
   - No webhook, ao processar mensagem com `image`, `audio`, `video` ou `document`:  
     - Usar o `access_token` da config e a Media API da Meta para obter a URL da mídia a partir do ID.  
     - Persistir essa URL em `media_url` no `saveMessage`, para que a UI possa exibir depois.

4. **Exibição de mídia no chat**  
   - Em `app/chat/page.tsx`, ao renderizar cada mensagem:  
     - Se `media_type === 'image'` e `media_url`: mostrar `<img>`.  
     - Se `media_type === 'audio'` e `media_url`: mostrar `<audio controls>`.  
     - Se `media_type === 'video'` e `media_url`: mostrar `<video controls>`.  
   - Manter texto e caption como hoje; considerar fallback quando `media_url` estiver vazio (ex.: “Imagem/Áudio/Vídeo” + caption).

5. **Admin / teste**  
   - Em `app/admin/whatsapp-official/page.tsx` o “Testar envio” usa só texto; opcionalmente permitir teste de envio de imagem/áudio (e, após item 1, vídeo) para validar a API oficial.

---

## 9. Referência rápida (arquivos)

| Função              | Arquivo |
|---------------------|--------|
| Envio (API)         | `app/api/chat/whatsapp-official/send/route.ts` |
| sendText/Image/Audio| `lib/services/whatsapp-official-service.ts`   |
| Webhook recepção    | `app/api/webhooks/whatsapp-official/route.ts`  |
| Persistência        | `lib/services/chat-service.ts`                |
| Listagem mensagens  | `app/api/chat/messages/route.ts`              |
| UI do chat          | `app/chat/page.tsx`                           |
| Teste admin         | `app/admin/whatsapp-official/page.tsx`        |

Com isso, o estado atual do envio e da exibição de texto, áudio, vídeo e imagem no chat interno via API oficial do WhatsApp fica documentado e as melhorias podem ser aplicadas de forma consistente.
