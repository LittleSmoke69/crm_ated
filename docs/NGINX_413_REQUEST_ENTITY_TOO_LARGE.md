# Correção do erro 413 Request Entity Too Large (Nginx)

Quando o envio de ativações com mídia (imagem, áudio, vídeo) em base64 retorna **413 Request Entity Too Large**, o Nginx está limitando o tamanho do corpo da requisição. Ajuste o limite no servidor onde o Nginx faz proxy para a Evolution API (ou para o backend que envia as mensagens).

## Opção 1: Aumentar o limite no Nginx

### 1. Onde configurar

No **servidor** onde o Nginx está rodando (o que retorna 413 ao receber a requisição de envio):

- Arquivo principal: `/etc/nginx/nginx.conf`, ou
- Site/vhost: `/etc/nginx/sites-available/default` (ou o arquivo do seu site, ex.: `evolution.conf`).

### 2. O que adicionar/alterar

**Dentro do bloco `http`** (em `nginx.conf`), para afetar todos os sites:

```nginx
http {
    # ... outras diretivas ...
    client_max_body_size 50M;
    # ...
}
```

**Ou dentro do bloco `server`** que faz proxy para a Evolution API / backend:

```nginx
server {
    listen 80;  # ou 443 com ssl
    server_name evolution.seudominio.com;  # ou o host que recebe as requisições

    client_max_body_size 50M;   # permite corpo da requisição até 50 MB

    location / {
        proxy_pass http://127.0.0.1:8080;  # ou a URL da Evolution API
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
    }
}
```

Use um valor coerente com o uso (ex.: **20M**, **50M**, **100M**). Para ativações com imagens/áudios em base64, **50M** costuma ser suficiente.

### 3. Validar e recarregar

```bash
sudo nginx -t
sudo systemctl reload nginx
```

(Em alguns ambientes: `sudo service nginx reload`.)

### 4. Conferir

Envie novamente uma ativação com mídia; o 413 deve deixar de ocorrer se o tamanho do body estiver dentro do novo limite.

---

## Referência rápida

| Diretiva                | Escopo  | Efeito                          |
|-------------------------|---------|----------------------------------|
| `client_max_body_size 50M;` | `http`  | Todos os sites                  |
| `client_max_body_size 50M;` | `server`| Apenas aquele `server`/vhost    |

Valores comuns: `10M`, `20M`, `50M`, `100M`.

---

## Evolution na VPS Contabo (passo a passo)

Quando a Evolution API está hospedada em uma **VPS Contabo** (Ubuntu/Debian), use estes passos no servidor.

### 1. Conectar na VPS por SSH

No seu computador:

```bash
ssh root@IP_DA_VPS
```

(Substitua `IP_DA_VPS` pelo IP da sua VPS. Se usar outro usuário: `ssh usuario@IP_DA_VPS`.)

### 2. Localizar o arquivo do Nginx do site da Evolution

Listar sites disponíveis:

```bash
ls -la /etc/nginx/sites-available/
```

Ver qual `server_name` usa o domínio da Evolution (ex.: evolution47.zaploto.online):

```bash
grep -r "server_name" /etc/nginx/sites-available/
```

Anote o arquivo que corresponde ao domínio da Evolution (ex.: `default`, `evolution` ou o nome do seu site).

### 3. Editar o arquivo

Substitua `ARQUIVO_DO_SITE` pelo nome do arquivo encontrado (ex.: `default`):

```bash
sudo nano /etc/nginx/sites-available/ARQUIVO_DO_SITE
```

Dentro do bloco `server { ... }` que atende o domínio da Evolution, adicione na **primeira linha após `server {`**:

```nginx
client_max_body_size 50M;
```

Exemplo de como fica:

```nginx
server {
    client_max_body_size 50M;
    listen 80;
    server_name evolution47.zaploto.online;
    # ... resto da config (location, proxy_pass, etc.)
}
```

Salvar: **Ctrl+O**, Enter, depois **Ctrl+X** para sair.

### 4. Testar e recarregar o Nginx

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Se `nginx -t` mostrar `syntax is ok` e `test is successful`, a alteração está ativa.

### 5. Conferir

Envie novamente uma ativação com mídia a partir do Zaploto. O erro 413 deve deixar de ocorrer para requisições com corpo até 50 MB.

### Observação

Se o site estiver ativado via link em `/etc/nginx/sites-enabled/`, não é necessário criar link de novo; a edição no arquivo em `sites-available` já vale. Basta executar o passo 4.
