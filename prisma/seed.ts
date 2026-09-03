import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { hashApiKey } from "../src/lib/utils.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding casino aggregator...");

  const proprietary = await prisma.gameProvider.upsert({
    where: { slug: "uni-games" },
    create: { slug: "uni-games", name: "Uni Games (Próprios)", integration: "NATIVE", isActive: false },
    update: { name: "Uni Games (Próprios)", integration: "NATIVE", isActive: false },
  });

  await prisma.gameProvider.upsert({
    where: { slug: "salsa" },
    create: {
      slug: "salsa",
      name: "Salsa Technology",
      integration: "SALSA",
      defaultCostPct: 6.5,
      isActive: false,
    },
    update: { integration: "SALSA", defaultCostPct: 6.5 },
  });

  await prisma.gameProvider.upsert({
    where: { slug: "pg-soft" },
    create: {
      slug: "pg-soft",
      name: "PG Soft",
      integration: "DIRECT",
      defaultCostPct: 8,
      isActive: false,
    },
    update: { integration: "DIRECT", defaultCostPct: 8 },
  });

  console.log("Provedores: uni-games (inativo no cassino), salsa/pg-soft (ative no admin após salsa:sync)");

  await prisma.salsaIntegrationConfig.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      enabled: process.env.SALSA_ENABLED === "true",
      publisherName: process.env.SALSA_PN ?? null,
      hashKey: process.env.SALSA_HASH_KEY ?? null,
      gameListUrl: process.env.SALSA_GAME_LIST_URL ?? null,
      apiBase: process.env.SALSA_API_BASE ?? "https://api-test.salsagator.com",
      defaultProviderCostPct: Number(process.env.SALSA_DEFAULT_COST_PCT ?? 6.5),
      defaultOperatorChargePct: 20,
    },
    update: {},
  });

  const slots = await prisma.gameCategory.upsert({
    where: { slug: "slots" },
    create: { slug: "slots", name: "Slots", sortOrder: 1 },
    update: { name: "Slots" },
  });

  const crash = await prisma.gameCategory.upsert({
    where: { slug: "crash" },
    create: { slug: "crash", name: "Crash", sortOrder: 2 },
    update: { name: "Crash" },
  });

  const instant = await prisma.gameCategory.upsert({
    where: { slug: "instant" },
    create: { slug: "instant", name: "Instantâneos", sortOrder: 3 },
    update: { name: "Instantâneos" },
  });

  const proprietaryGames = [
    { slug: "fortune-tiger", name: "Fortune Tiger", assetPath: "fortune-tiger", rtp: 80, fee: 10, sortOrder: 1, isFeatured: true },
    { slug: "fortune-mouse", name: "Fortune Mouse", assetPath: "fortune-mouse", rtp: 80, fee: 10, sortOrder: 2, isFeatured: true },
    { slug: "fortune-rabbit", name: "Fortune Rabbit", assetPath: "fortune-rabbit", rtp: 80, fee: 10, sortOrder: 3, isFeatured: true },
    { slug: "bikini-paradise", name: "Bikini Paradise", assetPath: "bikini-paradise", rtp: 80, fee: 8, sortOrder: 4, isFeatured: true },
    { slug: "phoenix", name: "Phoenix Rises", assetPath: "phoenix", rtp: 80, fee: 10, sortOrder: 5 },
    { slug: "tv-milionario", name: "TV Milionário", assetPath: "tv-milionario", rtp: 80, fee: 10, sortOrder: 6, isFeatured: true, engine: "HTML5", minBet: 1.25, maxBet: 10 },
    { slug: "luck", name: "Luck", assetPath: "luck", rtp: 80, fee: 10, sortOrder: 7, isFeatured: true, engine: "HTML5", minBet: 1, maxBet: 10 },
    { slug: "halloween-slots", name: "Halloween Slots", assetPath: "halloween-slots", rtp: 80, fee: 10, sortOrder: 8, isFeatured: true, engine: "HTML5", minBet: 1.5, maxBet: 12 },
    { slug: "aviator", name: "Aviator", assetPath: "aviator", rtp: 80, fee: 8, sortOrder: 1, isFeatured: true, engine: "HTML5", gameType: "CRASH", category: "crash", minBet: 1, maxBet: 500 },
    { slug: "spaceman", name: "Spaceman", assetPath: "spaceman", rtp: 80, fee: 8, sortOrder: 2, isFeatured: true, engine: "HTML5", gameType: "CRASH", category: "crash", minBet: 1, maxBet: 500 },
    { slug: "jetx", name: "JetX", assetPath: "jetx", rtp: 80, fee: 8, sortOrder: 3, isFeatured: true, engine: "HTML5", gameType: "CRASH", category: "crash", minBet: 1, maxBet: 500 },
    { slug: "dice", name: "Dice", assetPath: "dice", rtp: 80, fee: 8, sortOrder: 1, isFeatured: true, engine: "HTML5", gameType: "INSTANT", category: "instant", minBet: 1, maxBet: 500 },
    { slug: "coinflip", name: "Coin Flip", assetPath: "coinflip", rtp: 80, fee: 8, sortOrder: 2, isFeatured: true, engine: "HTML5", gameType: "INSTANT", category: "instant", minBet: 1, maxBet: 500 },
    { slug: "double", name: "Double", assetPath: "double", rtp: 80, fee: 8, sortOrder: 3, isFeatured: true, engine: "HTML5", gameType: "INSTANT", category: "instant", minBet: 1, maxBet: 500 },
    { slug: "mines", name: "Mines", assetPath: "mines", rtp: 80, fee: 8, sortOrder: 4, isFeatured: true, engine: "HTML5", gameType: "INSTANT", category: "instant", minBet: 1, maxBet: 500 },
  ];

  for (const g of proprietaryGames) {
    const categoryId =
      (g as { category?: string }).category === "crash"
        ? crash.id
        : (g as { category?: string }).category === "instant"
          ? instant.id
          : slots.id;

    await prisma.game.upsert({
      where: { slug: g.slug },
      create: {
        slug: g.slug,
        name: g.name,
        providerId: proprietary.id,
        categoryId,
        gameType: ((g as { gameType?: string }).gameType ?? "SLOT") as "SLOT" | "CRASH" | "INSTANT" | "TABLE" | "BINGO" | "OTHER",
        engine: (g as { engine?: string }).engine ?? "CONSTRUCT3",
        assetPath: g.assetPath,
        rtp: g.rtp,
        aggregatorFeePct: g.fee,
        minBet: (g as { minBet?: number }).minBet ?? 0.4,
        maxBet: (g as { maxBet?: number }).maxBet ?? 500,
        isFeatured: g.isFeatured ?? false,
        sortOrder: g.sortOrder,
        isActive: false,
      },
      update: {
        name: g.name,
        assetPath: g.assetPath,
        categoryId,
        gameType: ((g as { gameType?: string }).gameType ?? "SLOT") as "SLOT" | "CRASH" | "INSTANT" | "TABLE" | "BINGO" | "OTHER",
        engine: (g as { engine?: string }).engine ?? "CONSTRUCT3",
        rtp: g.rtp,
        aggregatorFeePct: g.fee,
        minBet: (g as { minBet?: number }).minBet ?? 0.4,
        maxBet: (g as { maxBet?: number }).maxBet ?? 500,
        isFeatured: g.isFeatured ?? false,
        sortOrder: g.sortOrder,
        isActive: false,
      },
    });
  }

  await prisma.game.updateMany({
    where: { slug: "fortune-ox" },
    data: { isActive: false },
  });

  const demoApiKey = "ca_demo_back_uni_fut_" + "a".repeat(48);
  const demoApiKeyHash = hashApiKey(demoApiKey);

  const walletUrl =
    process.env.BACK_UNI_WALLET_URL ?? "http://localhost:3003/api/casino/wallet";
  const walletSecret =
    process.env.WALLET_SECRET ?? "wallet_dev_secret_change_me";

  const existingClient = await prisma.client.findFirst({ where: { name: "back_uni_fut (demo)" } });

  let clientId = existingClient?.id;

  if (!existingClient) {
    const created = await prisma.client.create({
      data: {
        name: "back_uni_fut (demo)",
        apiKeyHash: demoApiKeyHash,
        marginPct: 5,
        walletUrl,
        walletSecret,
        entitlements: {
          create: [
            { categoryId: slots.id, gameId: null },
            { categoryId: crash.id, gameId: null },
            { categoryId: instant.id, gameId: null },
          ],
        },
      },
    });
    clientId = created.id;

    console.log("\n=== Cliente demo criado ===");
    console.log("Nome: back_uni_fut (demo)");
    console.log("API Key:", demoApiKey);
    console.log("Entitlements: slots, crash, instantâneos");
  } else {
    console.log("Cliente demo já existe, pulando criação.");
    if (clientId) {
      await prisma.client.update({
        where: { id: clientId },
        data: { walletUrl, walletSecret },
      });
      for (const catId of [slots.id, crash.id, instant.id]) {
        const exists = await prisma.clientEntitlement.findFirst({
          where: { clientId, categoryId: catId, gameId: null },
        });
        if (!exists) {
          await prisma.clientEntitlement.create({
            data: { clientId, categoryId: catId, gameId: null },
          });
        }
      }
      const extraCats = await prisma.gameCategory.findMany({
        where: { slug: { in: ["table", "bingo"] } },
        select: { id: true },
      });
      for (const cat of extraCats) {
        const exists = await prisma.clientEntitlement.findFirst({
          where: { clientId, categoryId: cat.id, gameId: null },
        });
        if (!exists) {
          await prisma.clientEntitlement.create({
            data: { clientId, categoryId: cat.id, gameId: null },
          });
        }
      }
      console.log("Entitlements atualizados: slots, crash, instantâneos (+ mesa/bingo se existirem)");
    }
  }

  if (clientId) {
    await prisma.clientWallet.upsert({
      where: { clientId },
      create: { clientId, balance: 100_000 },
      update: {},
    });
    console.log("Carteira B2B do operador: R$ 100.000 (taxas debitadas aqui)");
  }

  await prisma.game.updateMany({
    where: { isActive: true, engine: { not: "EXTERNAL" } },
    data: { rtp: 80 },
  });

  console.log("\nSeed concluído!");
  console.log(`Jogos registrados: ${proprietaryGames.length}`);
  console.log(`Categorias: slots, crash, instantâneos`);
  console.log(`Provedor: uni-games`);
}

void main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
