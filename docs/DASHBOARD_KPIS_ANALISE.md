# Análise dos cards do Dashboard

## Fontes de dados (página principal `/` – hook `useDashboardData`)

| Card | Fonte atual | Filtro | Observação |
|------|-------------|--------|------------|
| **Mensagens Enviadas** | `searches` | `user_id` + `status_disparo = true` | Contato de contatos para os quais a mensagem foi enviada. Correto. |
| **Adicionados ao Grupo** | `campaign_contacts` | `user_id` + `status = 'success'` | Contato de contatos adicionados com sucesso em campanhas. Correto. |
| **Pendentes** | `campaign_contacts` | `user_id` + `status = 'queued'` | Contatos na fila de campanhas (aguardando processamento). Correto. |
| **Instâncias Conectadas** | `/api/instances` | Resposta filtrada por `status === 'connected'` | API usa `evolution_instances`; status no BD `'ok'` é mapeado para `'connected'`. Correto. |
| **Disparos com Falha** | `searches` | `user_id` + `status = 'failed'` + `status_disparo = false` | Tentativa de disparo que falhou (não chegou a marcar como enviado). Correto. |
| **Falhas ao Adicionar** | `campaign_contacts` | `user_id` + `status = 'failed'` | Contatos que falharam ao ser adicionados ao grupo na campanha. Correto. |

## Inconsistência corrigida

- A rota **GET /api/kpis** usava a tabela `whatsapp_instances` (legada) para "Instâncias Conectadas" e `searches` para Adicionados/Pendentes/Falhas ao Adicionar.
- O Dashboard usa `evolution_instances` (via `/api/instances`) e `campaign_contacts` para métricas de campanha.
- A API `/api/kpis` foi atualizada para usar `evolution_instances` para instâncias conectadas, alinhada ao Dashboard.

## Conclusão

Os cards do Dashboard estão trazendo as informações das fontes corretas para o modelo atual:

- **Mensagens / Disparos**: tabela `searches` (`status_disparo`, `status`).
- **Campanhas (adicionados, pendentes, falhas)**: tabela `campaign_contacts` (`status`: success, queued, failed).
- **Instâncias**: API de instâncias baseada em `evolution_instances` (status `'ok'` → conectada).

Valores zerados (0) indicam ausência de dados nessas condições (nenhum disparo, nenhuma adição, nenhuma falha, etc.). "Instâncias Conectadas = 1" reflete corretamente uma instância com status conectado.
