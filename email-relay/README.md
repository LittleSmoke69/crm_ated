# Email Relay (Contabo)

Microserviço HTTPS → SMTP. Roda na **Contabo** (onde 465/587 para Hostinger estão abertas).  
O CRM na **SuperBitHost** chama este serviço na porta **443** (SMTP local lá é bloqueado).

```
CRM SuperBitHost  --HTTPS-->  email-relay Contabo  --SMTP 465/587-->  Hostinger
```

## Endpoints

| Método | Path | Auth | Descrição |
|--------|------|------|-----------|
| GET | `/health` | não | healthcheck |
| POST | `/v1/send` | Bearer | envia e-mail |
| POST | `/v1/verify` | Bearer | testa login SMTP |

### Body `/v1/send`

```json
{
  "to": "destino@exemplo.com",
  "from": "Cap do Sucesso <atendimento@capdosucesso.co.uk>",
  "subject": "Assunto",
  "html": "<p>Olá</p>",
  "text": "Olá",
  "smtp": {
    "host": "smtp.hostinger.com",
    "port": 465,
    "username": "atendimento@capdosucesso.co.uk",
    "password": "…"
  }
}
```

Credenciais SMTP vêm **por request** (do CRM / `smtp_accounts`). O relay não persiste senhas.

## Deploy na Contabo

```bash
# 1) Copiar pasta email-relay para a Contabo
cd email-relay
cp .env.example .env
# edite EMAIL_RELAY_SECRET (mesmo valor do CRM)

# 2) Subir
docker compose up -d --build
curl -s http://127.0.0.1:8787/health

# 3) TLS na frente (Caddy exemplo)
# mail-relay.seudominio.com {
#   reverse_proxy 127.0.0.1:8787
# }
```

### Firewall recomendado

```bash
# Só o IP da SuperBitHost (CRM) fala com o relay
sudo ufw allow from 111.90.149.172 to any port 443 proto tcp
# (ajuste se o TLS termina noutro proxy)
```

## CRM (SuperBitHost) — `.env`

```dotenv
EMAIL_RELAY_URL=https://mail-relay.seudominio.com
EMAIL_RELAY_SECRET=<mesmo_secret_do_relay>
```

Reinicie `zaplotov3-1` / `zaplotov3-2` após alterar o `.env`.

## Checklist de teste

1. Contabo: `curl -s https://mail-relay…/health` → `{ "ok": true }`
2. Contabo: TCP SMTP `python3` conectando `smtp.hostinger.com:465` → OK
3. CRM Admin → E-mails → **Testar** conta Hostinger → sucesso
4. Campanha com 1 destinatário → `email_logs.status = sent`

## Segurança

- `EMAIL_RELAY_SECRET` ≥ 16 chars, idêntico nos dois lados
- Não logar `smtp.password`
- Preferir bind `127.0.0.1:8787` + reverse proxy TLS
- Restringir origem ao IP do CRM
