/**
 * Exemplo para o back_uni_fut sincronizar jogos do agregador e expor ao front.
 *
 * Copie src/sdk/ para o seu projeto back_uni_fut ou importe via path relativo.
 *
 * .env no back_uni_fut:
 *   CASINO_BASE_URL=http://localhost:3010
 *   CASINO_API_KEY=ca_demo_back_uni_fut_aaaa...
 *   DATABASE_URL=postgresql://...
 *
 * Prisma schema sugerido no consumidor (back_uni_fut):
 *
 * model LocalCasinoGame {
 *   id           String   @id @default(cuid())
 *   aggregatorId Int      @unique
 *   slug         String   @unique
 *   name         String
 *   categorySlug String
 *   launchUrl    String
 *   thumbnailUrl String?
 *   rtp          Decimal? @db.Decimal(5, 2)
 *   minBet       Decimal? @db.Decimal(12, 2)
 *   maxBet       Decimal? @db.Decimal(12, 2)
 *   isFeatured   Boolean  @default(false)
 *   isActive     Boolean  @default(true)
 *   updatedAt    DateTime @updatedAt
 * }
 *
 * Fluxo:
 *   1. back_uni_fut chama syncGames() periodicamente (cron ou webhook)
 *   2. Persiste jogos liberados no banco local
 *   3. Front (uni/uni) consulta back_uni_fut → GET /casino/games
 *   4. Ao abrir jogo: back_uni_fut chama launchGame() → retorna launchUrl ao front
 */

import "dotenv/config";
import { createCasinoClient } from "../src/sdk/index.js";

async function syncGamesFromAggregator() {
  const client = createCasinoClient({
    baseURL: process.env.CASINO_BASE_URL ?? "http://localhost:3010",
    apiKey: process.env.CASINO_API_KEY,
  });

  await client.login();

  const { count, games, syncedAt } = await client.syncGames();

  console.log(`Sync ${syncedAt}: ${count} jogos liberados`);

  for (const game of games) {
    // Aqui você persiste no Prisma do back_uni_fut:
    //
    // await prisma.localCasinoGame.upsert({
    //   where: { aggregatorId: game.id },
    //   create: {
    //     aggregatorId: game.id,
    //     slug: game.slug,
    //     name: game.name,
    //     categorySlug: game.categorySlug,
    //     launchUrl: game.launchUrl,
    //     thumbnailUrl: game.thumbnailUrl,
    //     rtp: game.rtp,
    //     minBet: game.minBet,
    //     maxBet: game.maxBet,
    //     isFeatured: game.isFeatured,
    //   },
    //   update: { ... },
    // });

    console.log(`  - ${game.slug} (${game.name}) → ${game.launchUrl}`);
  }

  // Exemplo: abrir sessão para um usuário
  if (games.length > 0) {
    const firstGame = games[0]!;
    const launch = await client.launchGame(firstGame.slug, {
      externalUserId: "user_123",
      balance: 100,
    });
    console.log(`\nLaunch demo: ${launch.launchUrl}`);
  }
}

void syncGamesFromAggregator().catch(console.error);
