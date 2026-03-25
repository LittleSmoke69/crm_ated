# Blindagem de Repositorio (Core + PR)

## Objetivo

Garantir que alteracoes no core do ZaplotoV2 so avancem com autorizacao explicita do owner.

## Camadas aplicadas no repositorio

1. `CODEOWNERS` define ownership estrito para o core.
2. Workflow `Core Guard` reprova PR com alteracao de core sem:
   - review `APPROVED` do owner, ou
   - label de override `owner-approved`.

## Configuracao obrigatoria no GitHub (servidor)

No branch `main`, habilitar em **Settings > Branches > Branch protection rules**:

1. **Require a pull request before merging**
2. **Require approvals** (minimo 1)
3. **Require review from Code Owners**
4. **Require status checks to pass before merging**
   - incluir check: `Core Guard / owner-approval-for-core`
5. **Restrict who can push to matching branches** (somente owner/maintainers)
6. **Do not allow bypassing the above settings**

Sem esses itens, o bloqueio nao fica completo.

## Ajustes de ownership

Se mudar o owner:

- atualizar owner no `CODEOWNERS`
- atualizar `CORE_OWNER` em `.github/workflows/core-guard.yml`

## Observacao

A label `owner-approved` e um canal de excecao controlado pelo owner para casos pontuais.
