# API: Envio de PTV (vídeo de bolinha) via Evolution

Endpoint HTTP do Zaploto para envio **real** de **vídeo de bolinha (PTV)** via Evolution API.  
Chamada **exclusiva** para `POST {EVOLUTION_BASE_URL}/message/sendPtv/{instance}` — **não** usa `sendMedia`.

## Endpoint

- **Método:** `POST`
- **URL:** `/api/whatsapp/evolution/send-ptv`

## Body enviado para a Evolution

Apenas três campos (o endpoint sendPtv trata o resto internamente):

- `number`: jid normalizado (ex: `5581999999999@s.whatsapp.net` ou `...@g.us`)
- `video`: URL ou base64 do vídeo
- `delay`: atraso em ms (ex: 1200)

**Não são enviados:** `mediatype`, `mimetype`, `fileName`.

## Autenticação

- **Header:** `Authorization: Bearer <token>`
  - `<token>` = `userId` do Supabase (UUID do perfil), validado no banco.
- Ou sessão Supabase via `requireAuth`.

## Variáveis de ambiente (fallback)

Quando a instância **não** está no Supabase:

| Variável              | Obrigatória (fallback) | Exemplo                          |
|-----------------------|-------------------------|----------------------------------|
| `EVOLUTION_BASE_URL`  | Sim                     | `https://72.61.46.153:21465`     |
| `EVOLUTION_API_KEY`   | Sim                     | apikey global da Evolution      |

### Limite de tamanho do vídeo PTV (disparo/worker)

| Variável            | Obrigatória | Default | Exemplo |
|---------------------|-------------|---------|---------|
| `PTV_FETCH_MAX_MB`  | Não         | sem limite (`0`/vazio) | `80` |

Quando o vídeo vem por URL, o backend baixa e converte para base64 antes de enviar no `sendPtv`.
Defina `PTV_FETCH_MAX_MB` apenas se quiser impor um teto de segurança.

## Body da requisição (JSON)

| Campo             | Obrigatório | Descrição |
|------------------|-------------|-----------|
| `instance`       | Sim         | Nome da instância na Evolution. |
| `to`             | Sim         | Número com DDI ou jid de grupo (`...@g.us`). Normalizado automaticamente. |
| `video`          | Sim         | URL pública (`http`/`https`) ou string base64 (mín. 100 caracteres). |
| `delay`          | Não         | Atraso em ms (0–10000). Default: 1200. |
| `width`          | Não         | Se informado com `height`, validação 1:1 (quadrado) para PTV. |
| `height`         | Não         | Se informado com `width`, validação 1:1 (quadrado) para PTV. |
| `durationSeconds`| Não         | Se informado e > 60, retorna erro (duração máxima recomendada 60s). |

## Validações

- **Vídeo quadrado (1:1):** Se `width` e `height` forem enviados, devem ser iguais; caso contrário retorna `VIDEO_NOT_SQUARE_FOR_PTV`.
- **Duração:** Se `durationSeconds` > 60, retorna erro de validação.

## Respostas

- **200** – Sucesso: `{ "ok": true, "type": "ptv", "instance": "...", "to": "...", "provider": "evolution" }`
- **400** – Validação (ex.: campo inválido, `VIDEO_NOT_SQUARE_FOR_PTV`, duração > 60s).
- **401** – Não autenticado.
- **502** – Erro da Evolution. Se a Evolution retornar **404** no sendPtv, o corpo inclui `error: "EVOLUTION_VERSION_DOES_NOT_SUPPORT_PTV"`.

## Exemplo curl

```bash
curl -X POST "https://seu-dominio.com/api/whatsapp/evolution/send-ptv" \
  -H "Authorization: Bearer SEU_USER_ID_SUPABASE" \
  -H "Content-Type: application/json" \
  -d '{
    "instance": "NOME_DA_INSTANCIA_EVOLUTION",
    "to": "5581999999999",
    "video": "https://dominio.com/video.mp4",
    "delay": 1200
  }'
```

## Observabilidade

- Logs incluem apenas: `instance`, `to`, `statusCode`, `requestId`.
- **Não** são logados: `video`, base64 ou apikey.

## Implementação

- Arquivo: `app/api/whatsapp/evolution/send-ptv/route.ts`
- Timeout da requisição à Evolution: 20 s.
- Retry: 1 tentativa em caso de `ECONNRESET` ou `ETIMEDOUT`.
