import { prisma } from "../lib/prisma.js";

function parseSince(query?: string | Date): Date {
  if (query instanceof Date) return query;
  if (query) {
    const d = new Date(query);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

export async function getAnalyticsOverview(sinceInput?: string | Date, clientId?: string) {
  const since = parseSince(sinceInput);

  const spins = await prisma.gameSpin.findMany({
    where: {
      createdAt: { gte: since },
      ...(clientId && { session: { clientId } }),
    },
    select: {
      betAmount: true,
      winAmount: true,
      gameFeeAmount: true,
      clientFeeAmount: true,
      session: { select: { clientId: true, gameId: true } },
    },
  });

  let betAmount = 0;
  let winAmount = 0;
  let gameFeeAmount = 0;
  let clientFeeAmount = 0;
  const clients = new Set<string>();
  const games = new Set<number>();

  for (const s of spins) {
    betAmount += Number(s.betAmount);
    winAmount += Number(s.winAmount);
    gameFeeAmount += Number(s.gameFeeAmount);
    clientFeeAmount += Number(s.clientFeeAmount);
    clients.add(s.session.clientId);
    games.add(s.session.gameId);
  }

  const aggregatorRevenue = gameFeeAmount + clientFeeAmount;

  return {
    since: since.toISOString(),
    spinCount: spins.length,
    activeClients: clients.size,
    activeGames: games.size,
    betAmount: round2(betAmount),
    winAmount: round2(winAmount),
    ggr: round2(betAmount - winAmount),
    gameFeeAmount: round2(gameFeeAmount),
    clientFeeAmount: round2(clientFeeAmount),
    aggregatorRevenue: round2(aggregatorRevenue),
    /** Valor repassado aos jogadores (prêmios) */
    playerPayout: round2(winAmount),
  };
}

export async function getTopGames(sinceInput?: string | Date, clientId?: string, limit = 10) {
  const since = parseSince(sinceInput);

  const spins = await prisma.gameSpin.findMany({
    where: {
      createdAt: { gte: since },
      ...(clientId && { session: { clientId } }),
    },
    select: {
      betAmount: true,
      winAmount: true,
      session: {
        select: {
          gameId: true,
          game: { select: { id: true, slug: true, name: true } },
        },
      },
    },
  });

  const byGame = new Map<
    number,
    { gameId: number; slug: string; name: string; spins: number; betAmount: number; winAmount: number }
  >();

  for (const s of spins) {
    const game = s.session.game;
    const cur = byGame.get(game.id) ?? {
      gameId: game.id,
      slug: game.slug,
      name: game.name,
      spins: 0,
      betAmount: 0,
      winAmount: 0,
    };
    cur.spins += 1;
    cur.betAmount += Number(s.betAmount);
    cur.winAmount += Number(s.winAmount);
    byGame.set(game.id, cur);
  }

  return [...byGame.values()]
    .sort((a, b) => b.spins - a.spins)
    .slice(0, limit)
    .map((g) => ({
      ...g,
      betAmount: round2(g.betAmount),
      winAmount: round2(g.winAmount),
      ggr: round2(g.betAmount - g.winAmount),
    }));
}

export async function getTopGamesByClient(sinceInput?: string | Date, limit = 10) {
  const since = parseSince(sinceInput);

  const spins = await prisma.gameSpin.findMany({
    where: { createdAt: { gte: since } },
    select: {
      betAmount: true,
      winAmount: true,
      session: {
        select: {
          clientId: true,
          gameId: true,
          client: { select: { name: true } },
          game: { select: { slug: true, name: true } },
        },
      },
    },
  });

  const key = (clientId: string, gameId: number) => `${clientId}:${gameId}`;
  const map = new Map<
    string,
    {
      clientId: string;
      clientName: string;
      gameId: number;
      gameSlug: string;
      gameName: string;
      spins: number;
      betAmount: number;
      winAmount: number;
    }
  >();

  for (const s of spins) {
    const k = key(s.session.clientId, s.session.gameId);
    const cur = map.get(k) ?? {
      clientId: s.session.clientId,
      clientName: s.session.client.name,
      gameId: s.session.gameId,
      gameSlug: s.session.game.slug,
      gameName: s.session.game.name,
      spins: 0,
      betAmount: 0,
      winAmount: 0,
    };
    cur.spins += 1;
    cur.betAmount += Number(s.betAmount);
    cur.winAmount += Number(s.winAmount);
    map.set(k, cur);
  }

  return [...map.values()]
    .sort((a, b) => b.spins - a.spins)
    .slice(0, limit)
    .map((r) => ({
      ...r,
      betAmount: round2(r.betAmount),
      winAmount: round2(r.winAmount),
      ggr: round2(r.betAmount - r.winAmount),
    }));
}

export async function getClientMovement(sinceInput?: string | Date) {
  const since = parseSince(sinceInput);

  const spins = await prisma.gameSpin.findMany({
    where: { createdAt: { gte: since } },
    select: {
      betAmount: true,
      winAmount: true,
      gameFeeAmount: true,
      clientFeeAmount: true,
      createdAt: true,
      session: {
        select: {
          clientId: true,
          client: { select: { name: true, billingMode: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const byClient = new Map<
    string,
    {
      clientId: string;
      clientName: string;
      billingMode: string;
      spins: number;
      betAmount: number;
      winAmount: number;
      gameFeeAmount: number;
      clientFeeAmount: number;
      lastActivity: string;
    }
  >();

  for (const s of spins) {
    const id = s.session.clientId;
    const cur = byClient.get(id) ?? {
      clientId: id,
      clientName: s.session.client.name,
      billingMode: s.session.client.billingMode,
      spins: 0,
      betAmount: 0,
      winAmount: 0,
      gameFeeAmount: 0,
      clientFeeAmount: 0,
      lastActivity: s.createdAt.toISOString(),
    };
    cur.spins += 1;
    cur.betAmount += Number(s.betAmount);
    cur.winAmount += Number(s.winAmount);
    cur.gameFeeAmount += Number(s.gameFeeAmount);
    cur.clientFeeAmount += Number(s.clientFeeAmount);
    cur.lastActivity = s.createdAt.toISOString();
    byClient.set(id, cur);
  }

  const wallets = await prisma.clientWallet.findMany({
    where: { clientId: { in: [...byClient.keys()] } },
    select: { clientId: true, balance: true },
  });
  const balanceMap = new Map(wallets.map((w) => [w.clientId, Number(w.balance)]));

  return [...byClient.values()]
    .map((c) => ({
      ...c,
      betAmount: round2(c.betAmount),
      winAmount: round2(c.winAmount),
      ggr: round2(c.betAmount - c.winAmount),
      gameFeeAmount: round2(c.gameFeeAmount),
      clientFeeAmount: round2(c.clientFeeAmount),
      aggregatorRevenue: round2(c.gameFeeAmount + c.clientFeeAmount),
      walletBalance: round2(balanceMap.get(c.clientId) ?? 0),
    }))
    .sort((a, b) => b.betAmount - a.betAmount);
}

export async function getTimeseries(sinceInput?: string | Date, clientId?: string, gameId?: number) {
  const since = parseSince(sinceInput);

  const spins = await prisma.gameSpin.findMany({
    where: {
      createdAt: { gte: since },
      ...(clientId && { session: { clientId } }),
      ...(gameId && { session: { gameId } }),
    },
    select: {
      betAmount: true,
      winAmount: true,
      gameFeeAmount: true,
      clientFeeAmount: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const byDay = new Map<
    string,
    { date: string; spins: number; betAmount: number; winAmount: number; revenue: number }
  >();

  for (const s of spins) {
    const date = s.createdAt.toISOString().slice(0, 10);
    const cur = byDay.get(date) ?? { date, spins: 0, betAmount: 0, winAmount: 0, revenue: 0 };
    cur.spins += 1;
    cur.betAmount += Number(s.betAmount);
    cur.winAmount += Number(s.winAmount);
    cur.revenue += Number(s.gameFeeAmount) + Number(s.clientFeeAmount);
    byDay.set(date, cur);
  }

  return [...byDay.values()].map((d) => ({
    ...d,
    betAmount: round2(d.betAmount),
    winAmount: round2(d.winAmount),
    revenue: round2(d.revenue),
    ggr: round2(d.betAmount - d.winAmount),
  }));
}

export async function getRevenueByGame(sinceInput?: string | Date, clientId?: string) {
  const since = parseSince(sinceInput);

  const spins = await prisma.gameSpin.findMany({
    where: {
      createdAt: { gte: since },
      ...(clientId && { session: { clientId } }),
    },
    select: {
      betAmount: true,
      winAmount: true,
      gameFeeAmount: true,
      clientFeeAmount: true,
      session: {
        select: {
          gameId: true,
          game: { select: { slug: true, name: true, aggregatorFeePct: true } },
        },
      },
    },
  });

  const byGame = new Map<
    number,
    {
      gameId: number;
      slug: string;
      name: string;
      defaultFeePct: number;
      spins: number;
      betAmount: number;
      winAmount: number;
      gameFeeAmount: number;
      clientFeeAmount: number;
    }
  >();

  for (const s of spins) {
    const g = s.session.game;
    const cur = byGame.get(s.session.gameId) ?? {
      gameId: s.session.gameId,
      slug: g.slug,
      name: g.name,
      defaultFeePct: Number(g.aggregatorFeePct),
      spins: 0,
      betAmount: 0,
      winAmount: 0,
      gameFeeAmount: 0,
      clientFeeAmount: 0,
    };
    cur.spins += 1;
    cur.betAmount += Number(s.betAmount);
    cur.winAmount += Number(s.winAmount);
    cur.gameFeeAmount += Number(s.gameFeeAmount);
    cur.clientFeeAmount += Number(s.clientFeeAmount);
    byGame.set(s.session.gameId, cur);
  }

  return [...byGame.values()]
    .map((g) => ({
      ...g,
      betAmount: round2(g.betAmount),
      winAmount: round2(g.winAmount),
      gameFeeAmount: round2(g.gameFeeAmount),
      clientFeeAmount: round2(g.clientFeeAmount),
      /** Quanto o agregador retém (taxas) */
      aggregatorEarns: round2(g.gameFeeAmount + g.clientFeeAmount),
      /** Quanto repassa aos jogadores */
      playerPayout: round2(g.winAmount),
      ggr: round2(g.betAmount - g.winAmount),
    }))
    .sort((a, b) => b.aggregatorEarns - a.aggregatorEarns);
}
