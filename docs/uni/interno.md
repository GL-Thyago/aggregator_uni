# Uni — Guia interno

O que o aggregator faz e como fala com a Salsa. Não envie este ficheiro ao cassino.

Site: https://rggames.site/docs/uni/interno.html

## Peças

- **Cassino (cliente Uni):** jogadores e saldo. Chama a API Uni. Expõe o wallet.
- **Uni:** catálogo, sessão, launch, publisher XML, débito no wallet do cliente da sessão.
- **Salsa:** estúdio dos jogos. Abre o iframe e, na aposta, chama o publisher da Uni.

## Fluxo

1. Cassino → Uni: `POST /api/v1/uni/test/games/{slug}/launch` (API Key + ID do jogador).
2. Uni cria sessão (token UUID) e devolve `launchUrl` da Salsa.
3. Cassino abre `launchUrl` no iframe.
4. Salsa → Uni: `POST /api/v1/salsa/publisher` (XML).
5. Uni → wallet desse cassino: `POST {walletUrl}/balance` e `/spin`.

Um aggregator, vários cassinos. Cada cliente tem o próprio `walletUrl`.

## Publisher (só a Salsa)

```
https://rggames.site/api/v1/salsa/publisher
```

## Test vs live

O ambiente é **por cassino** (admin: Teste ou Produção), não um .env global. `POST /api/v1/games/{slug}/launch` usa o destino daquele cliente.

Não são dois aggregators. São dois destinos de abertura de jogo.

| | Test | Live |
|---|---|---|
| Rota | `POST /api/v1/uni/test/games/{slug}/launch` | `POST /api/v1/uni/live/games/{slug}/launch` |
| Host | api-test.salsagator.com | api.salsagator.com |
| type | FREE | CHARGED |
| PN | `SALSA_PN` | `SALSA_PN_LIVE` |

Staging PN não existe no host de produção.

## GPI

```
POST /api/v1/uni/test/games/gpi-validation/launch
{ "externalUserId": "ID", "currency": "BRL" }
```

Abrir o `gpiUrl` da resposta. Wallet público; `betAmount = 0` + `winAmount > 0` tem de creditar.

Falha: `GET /admin/v1/integrations/salsa/last-request` (`X-Admin-Key`).

## Jogos em produção (OPS-3353)

IDs OSS: `evo-oss-xs-monopoly-live`, `ez-oss-CricketWar`, `net-oss-Quest2ReturntoElDorado`, `ret-oss-atlantis`, `nl-oss-DJPsycho`.  
TaDa: `tada-BombingFishing`, `tada-Crazy777`, `tada-BubbleBeauty`.  
PG Soft (Zenith): `znt-slot-geishas-revenge`, `znt-slot-alchemy-gold`, `znt-slot-anubis-wrath`.  
Spribe (Zenith): `znt-aviator`, `znt-mines`, `znt-dice`.

1. Salsa libera no PN de produção.
2. Uni publica o catálogo (IDs entram no banco).
3. Cliente do cassino em Produção no admin.
4. Launch: `POST /api/v1/games/{id}/launch`.
5. Precisa de `SALSA_PN_LIVE`. Sem isso, live no host de produção falha.

## Env (EasyPanel da Uni)

- `PUBLIC_BASE_URL=https://rggames.site`
- `SALSA_PUBLISHER_URL=https://rggames.site/api/v1/salsa/publisher`
- `SALSA_PN` / `SALSA_HASH_KEY`
- `SALSA_PN_LIVE` quando a Salsa enviar o PN de produção
- `BACK_UNI_WALLET_URL` no **aggregator**, só se o cliente ainda tiver localhost. Valor do SorteioBR: `https://b.sorteiobr.com/api/casino/wallet`
