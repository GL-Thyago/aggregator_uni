# Pasta de Jogos Proprietários

Coloque aqui os jogos HTML5 / Construct 3 que você quer servir pelo agregador.

## Estrutura

```
games/
├── fortune-tiger/
│   ├── index.html          ← ponto de entrada
│   ├── data.json
│   ├── scripts/
│   └── api/                ← PHP antigo (substituir pelo Node do agregador)
├── fortune-mouse/
├── fortune-rabbit/
├── bikini-paradise/
├── phoenix/
└── meu-novo-jogo/          ← novos jogos que você criar
    └── index.html
```

## Migrar jogos do caca_uni

Copie de `projeto_uni/caca_uni/assets/games_/` para cá:

```powershell
# Exemplo — copie cada pasta de jogo
Copy-Item -Recurse "..\projeto_uni\caca_uni\assets\games_\fortune-tiger" ".\games\fortune-tiger"
Copy-Item -Recurse "..\projeto_uni\caca_uni\assets\games_\fortune-mouse" ".\games\fortune-mouse"
# ... repita para os demais
```

## Registrar no catálogo

Depois de copiar, registre o jogo via Admin API:

```http
POST /admin/v1/games
X-Admin-Key: sua_admin_key

{
  "slug": "meu-novo-jogo",
  "name": "Meu Novo Jogo",
  "providerId": 1,
  "categoryId": 1,
  "gameType": "SLOT",
  "engine": "CONSTRUCT3",
  "assetPath": "meu-novo-jogo",
  "rtp": 96.5,
  "minBet": 0.4,
  "maxBet": 500
}
```

Ou rode `npm run db:seed` — os jogos padrão já vêm pré-registrados.

## URL de acesso

Cada jogo fica disponível em:

```
http://localhost:3010/games/{assetPath}/index.html?sessionToken=...
```

## Substituir PHP por Node

Os jogos antigos usam `api/spin.php` para saldo e spins. Aponte o jogo para:

```
POST /api/v1/session/spin
Header: X-Session-Token: {sessionToken}
Body: { "betAmount": 1.0 }
```

O agregador gerencia saldo e histórico na tabela `game_spins`.
