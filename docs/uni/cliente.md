# Uni — Integração para cassinos

Como o vosso cassino fala com a Uni. O saldo continua no vosso sistema.

Site: https://rggames.site/docs/uni/cliente.html

## O que vocês fazem

1. Recebem uma API Key.
2. Informam `walletUrl` (HTTPS) e `walletSecret`.
3. No site: listar jogos, abrir jogo, mostrar `launchUrl` (iframe ou nova aba).
4. No backend: responder `/balance` e `/spin` quando a Uni chamar.

## Base

`https://rggames.site/api/v1`

Header: `X-Api-Key: <chave>`

Opcional: `POST /auth/token` com `{ "apiKey" }` e depois `Authorization: Bearer …`.

## Listar jogos

```
GET https://rggames.site/api/v1/games
```

Usem o `slug`. Capa: `GET /api/v1/media/cover/{slug}`. Sync: `GET /api/v1/sync/games`.

## Abrir jogo

`externalUserId` = ID do jogador no vosso cassino.

A Uni define se a vossa conta é teste ou produção. Uma rota só:

```
POST https://rggames.site/api/v1/games/{slug}/launch
{ "externalUserId": "20419622", "currency": "BRL" }
```

`slug` pode ser o código do jogo (`evo-oss-xs-monopoly-live`). A resposta traz `environment` e `launchUrl`. Abram a URL sem alterar. No CSP, `frame-src` deve incluir o domínio dessa URL.

## Wallet

A Uni chama:

- `POST {walletUrl}/balance` → `{ "balance": 11000.00, "currency": "BRL" }`
- `POST {walletUrl}/spin` → débito/crédito

Header: `X-Wallet-Signature: HMAC-SHA256(corpo_bruto, walletSecret)` em hex. Validem o JSON cru.

- Aposta: `betAmount > 0`, `winAmount = 0`
- Prêmio/estorno: `betAmount = 0`, `winAmount > 0` (válido — creditem)
- Sem saldo: `{ "ok": false, "error": "Insufficient balance", ... }`
- `spinId` idempotente
