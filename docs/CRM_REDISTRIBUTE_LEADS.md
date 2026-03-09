# Contrato: CRM Redistribuição de Leads

O ZaplotoV2 chama o CRM externo para **transferir leads** de um consultor (origem) para outro (destino). Se os leads não aparecem em **"CRM transferido"** do consultor destino, o endpoint do CRM precisa garantir que os leads sejam **atribuídos ao consultor destino** e que passem a constar na lista de transferidos.

## Endpoint chamado

`POST {CRM_BASE_URL}/api/crm/redistribute-leads`

- **Headers:** `Content-Type: application/json`, `x-api-key: {CRM_API_KEY}`, `Accept: application/json`
- **Body:**
  ```json
  {
    "source_consultant_email": "email@do-consultor-origem.com",
    "target_consultant_email": "email@do-consultor-destino.com",
    "leads_ids": [ 123, 456, 789 ]
  }
  ```
  - `leads_ids` pode ser array de **números** ou **strings** (IDs dos leads no CRM).

## Resposta esperada do CRM

- **HTTP 200**
- **Body (exemplo):**
  ```json
  {
    "success": true,
    "count": 100,
    "message": "Leads transferidos com sucesso."
  }
  ```
  Ou: `data.count` em vez de `count` na raiz.

## O que o CRM deve fazer

1. **Identificar** os leads pelos `leads_ids` (no contexto da banca/origem, se aplicável).
2. **Atribuir** cada lead ao consultor **destino** (`target_consultant_email`), de forma que o lead passe a constar como **do** consultor destino.
3. **Salvar na lista "CRM transferidos"**: além da reassociação, o CRM precisa **persistir** cada lead na estrutura que alimenta a tela **"CRM transferido"** / "Leads transferidos" do consultor destino (tabela, flag `transferred`, histórico de transferência, etc.). **Se essa gravação não for feita, a transferência pode até mudar o dono do lead, mas os leads não aparecerão em "transferidos".**
4. **Remover** (ou desvincular) os leads do consultor **origem** (`source_consultant_email`), para que não fiquem duplicados.
5. Retornar `success: true` e `count` com a quantidade de leads efetivamente transferidos **e** gravados em "transferidos".

## Cenário: "A transferência é feita mas os leads não aparecem em CRM transferidos"

Isso indica que o endpoint do CRM está **reassociando** o lead ao consultor destino, mas **não está gravando** o lead na lista/estrutura de "transferidos". É necessário no CRM:

- Garantir que, ao processar `redistribute-leads`, além de alterar o dono do lead, seja feita a **persistência** no que alimenta a view "CRM transferidos" (ex.: tabela de transferências, campo `transferred_at`, vínculo com o consultor destino na lista de transferidos, etc.).
- Retornar `count` com o número de leads que foram **tanto** reassignados **quanto** registrados em "transferidos".

## Complemento na tela "CRM transferidos" (ZaplotoV2)

Enquanto o CRM não persistir os leads em "transferidos", o ZaplotoV2 **complementa** a listagem para o consultor:

- A API `GET /api/crm/transferred-leads` (usada pela tela **Leads Transferidos** do consultor) busca primeiro os leads que o CRM retorna com `transferred_filter=yes`.
- Em seguida, consulta `admin_lead_transfer_entries` para o consultor e identifica leads que **constam no log de transferência** do ZaplotoV2 mas **não** aparecem na resposta do CRM como transferidos.
- Para esses leads "faltantes", faz uma nova chamada ao CRM (sem `transferred_filter=yes`) para obter nome, telefone, etc., e os inclui na lista exibida ao consultor.

Assim, mesmo que o CRM não grave na parte que alimenta "transferidos", o consultor vê na tela **Leads Transferidos** do ZaplotoV2 todos os leads que foram transferidos para ele (registrados no ZaplotoV2).

## Verificação no ZaplotoV2

- Os logs do servidor (rota `POST /api/admin/crm/redistribute-leads`) registram:
  - Payload enviado ao CRM (source, target, quantidade de `leads_ids`, amostra dos IDs).
  - Resposta completa do CRM (`fullResponse`).
- Use os logs para confirmar que a chamada foi feita e o que o CRM retornou. Se `success` e `count` estiverem corretos mas os leads não aparecem em "transferido", o ajuste deve ser no **CRM** (lógica de atribuição ao consultor destino e exibição em "transferido").
