import { prisma } from "../lib/prisma.js";

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

function parseBound(query?: string, asEnd = false): Date | undefined {
  if (!query) return undefined;
  const raw = String(query).trim();
  if (!raw) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, day] = raw.split("-").map(Number);
    const d = new Date(y!, m! - 1, day!);
    return asEnd ? new Date(d.setHours(23, 59, 59, 999)) : new Date(d.setHours(0, 0, 0, 0));
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

function parseSince(query?: string): Date {
  return parseBound(query) ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
}

function parseUntil(query?: string): Date | undefined {
  return parseBound(query, true);
}

function createdAtFilter(since: Date, until?: Date) {
  return {
    gte: since,
    ...(until ? { lte: until } : {}),
  };
}

function providerLabel(p: { displayName?: string | null; name: string }) {
  return p.displayName?.trim() || p.name;
}

/** Resumo por jogador (ID no back = externalUserId). */
export async function getPlayersMovementSummary(options: {
  since?: string;
  until?: string;
  clientId?: string;
  limit?: number;
}) {
  const since = parseSince(options.since);
  const until = parseUntil(options.until);
  const limit = Math.min(500, Math.max(10, options.limit ?? 100));

  const spins = await prisma.gameSpin.findMany({
    where: {
      createdAt: createdAtFilter(since, until),
      session: {
        ...(options.clientId && { clientId: options.clientId }),
      },
    },
    select: {
      betAmount: true,
      winAmount: true,
      session: {
        select: {
          externalUserId: true,
          clientId: true,
          client: { select: { name: true } },
        },
      },
    },
  });

  type Row = {
    externalUserId: string;
    clientId: string;
    clientName: string;
    spins: number;
    betAmount: number;
    winAmount: number;
  };

  const byPlayer = new Map<string, Row>();
  for (const s of spins) {
    const key = `${s.session.clientId}:${s.session.externalUserId}`;
    const cur = byPlayer.get(key) ?? {
      externalUserId: s.session.externalUserId,
      clientId: s.session.clientId,
      clientName: s.session.client.name,
      spins: 0,
      betAmount: 0,
      winAmount: 0,
    };
    cur.spins += 1;
    cur.betAmount += Number(s.betAmount);
    cur.winAmount += Number(s.winAmount);
    byPlayer.set(key, cur);
  }

  const players = [...byPlayer.values()]
    .map((p) => ({
      ...p,
      betAmount: round2(p.betAmount),
      winAmount: round2(p.winAmount),
      ggr: round2(p.betAmount - p.winAmount),
      playerNet: round2(p.winAmount - p.betAmount),
    }))
    .sort((a, b) => b.betAmount - a.betAmount)
    .slice(0, limit);

  const totals = players.reduce(
    (acc, p) => {
      acc.spins += p.spins;
      acc.betAmount += p.betAmount;
      acc.winAmount += p.winAmount;
      return acc;
    },
    { spins: 0, betAmount: 0, winAmount: 0 },
  );

  return {
    since: since.toISOString(),
    until: until?.toISOString() ?? null,
    clientId: options.clientId ?? null,
    playerCount: byPlayer.size,
    totals: {
      spins: totals.spins,
      betAmount: round2(totals.betAmount),
      winAmount: round2(totals.winAmount),
      ggr: round2(totals.betAmount - totals.winAmount),
    },
    players,
  };
}

/** Detalhe: totais + por jogo + últimas rodadas (Salsa). */
export async function getPlayerMovementDetail(options: {
  since?: string;
  until?: string;
  clientId: string;
  externalUserId: string;
}) {
  const since = parseSince(options.since);
  const until = parseUntil(options.until);
  const sessionWhere = {
    clientId: options.clientId,
    externalUserId: options.externalUserId,
  };

  const spins = await prisma.gameSpin.findMany({
    where: {
      createdAt: createdAtFilter(since, until),
      session: sessionWhere,
    },
    select: {
      id: true,
      betAmount: true,
      winAmount: true,
      createdAt: true,
      result: true,
      session: {
        select: {
          game: {
            select: {
              name: true,
              slug: true,
              provider: { select: { name: true, displayName: true, slug: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });

  type GameRow = {
    slug: string;
    game: string;
    provider: string;
    providerSlug: string;
    spins: number;
    betAmount: number;
    winAmount: number;
  };

  const byGame = new Map<string, GameRow>();
  let totalBet = 0;
  let totalWin = 0;

  for (const s of spins) {
    const bet = Number(s.betAmount);
    const win = Number(s.winAmount);
    totalBet += bet;
    totalWin += win;
    const g = s.session.game;
    const slug = g.slug;
    const cur = byGame.get(slug) ?? {
      slug,
      game: g.name,
      provider: providerLabel(g.provider),
      providerSlug: g.provider.slug,
      spins: 0,
      betAmount: 0,
      winAmount: 0,
    };
    cur.spins += 1;
    cur.betAmount += bet;
    cur.winAmount += win;
    byGame.set(slug, cur);
  }

  const games = [...byGame.values()]
    .map((g) => ({
      ...g,
      betAmount: round2(g.betAmount),
      winAmount: round2(g.winAmount),
      ggr: round2(g.betAmount - g.winAmount),
      playerNet: round2(g.winAmount - g.betAmount),
    }))
    .sort((a, b) => b.betAmount - a.betAmount);

  const salsaEvents = await prisma.salsaTransaction.findMany({
    where: {
      createdAt: createdAtFilter(since, until),
      session: sessionWhere,
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      kind: true,
      amountCents: true,
      gameReference: true,
      spinId: true,
      createdAt: true,
      session: {
        select: {
          game: {
            select: {
              name: true,
              provider: { select: { displayName: true, name: true } },
            },
          },
        },
      },
    },
  });

  const rounds = buildSalsaRoundPreview(salsaEvents);

  return {
    externalUserId: options.externalUserId,
    clientId: options.clientId,
    since: since.toISOString(),
    until: until?.toISOString() ?? null,
    totals: {
      spins: spins.length,
      betAmount: round2(totalBet),
      winAmount: round2(totalWin),
      ggr: round2(totalBet - totalWin),
      playerNet: round2(totalWin - totalBet),
    },
    games,
    recentRounds: rounds.slice(0, 80),
    recentEvents: salsaEvents.slice(0, 50).map((e) => ({
      at: e.createdAt.toISOString(),
      kind: e.kind,
      amount: round2(e.amountCents / 100),
      game: e.session.game.name,
      provider: providerLabel(e.session.game.provider),
      gameReference: e.gameReference,
      walletSpinId: e.spinId,
    })),
  };
}

function buildSalsaRoundPreview(
  events: {
    kind: string;
    amountCents: number;
    gameReference: string | null;
    spinId: string | null;
    createdAt: Date;
    session: { game: { name: string } };
  }[],
) {
  type Round = {
    at: string;
    game: string;
    gameReference: string | null;
    bet: number;
    win: number;
    net: number;
    walletSpinIds: string[];
    flags: string[];
  };

  const byRef = new Map<string, Round>();

  for (const e of events) {
    const ref = e.gameReference?.trim() || `t:${e.createdAt.getTime()}`;
    const key = `${e.session.game.name}:${ref}`;
    const cur = byRef.get(key) ?? {
      at: e.createdAt.toISOString(),
      game: e.session.game.name,
      gameReference: e.gameReference,
      bet: 0,
      win: 0,
      net: 0,
      walletSpinIds: [],
      flags: [],
    };
    const amt = round2(e.amountCents / 100);
    if (e.kind === "PLACE_BET") cur.bet += amt;
    else if (e.kind === "AWARD_WINNINGS") cur.win += amt;
    else if (e.kind === "REFUND_BET") {
      cur.win += amt;
      cur.flags.push("refund");
    }
    if (e.spinId && !cur.walletSpinIds.includes(e.spinId)) cur.walletSpinIds.push(e.spinId);
    cur.net = round2(cur.win - cur.bet);
    if (cur.bet <= 0 && cur.win > 0) cur.flags.push("premio_sem_aposta_registrada");
    byRef.set(key, cur);
  }

  return [...byRef.values()].sort((a, b) => b.at.localeCompare(a.at));
}

/** Auditoria: prêmios órfãos, possíveis duplicatas, foco Aviatrix. */
export async function getWalletIntegrityReport(options: {
  since?: string;
  until?: string;
  clientId?: string;
}) {
  const since = parseSince(options.since);
  const until = parseUntil(options.until);

  const awards = await prisma.salsaTransaction.findMany({
    where: {
      kind: "AWARD_WINNINGS",
      createdAt: createdAtFilter(since, until),
      session: options.clientId ? { clientId: options.clientId } : undefined,
    },
    select: {
      id: true,
      sessionId: true,
      amountCents: true,
      gameReference: true,
      spinId: true,
      salsaTransactionId: true,
      referenceNum: true,
      createdAt: true,
      session: {
        select: {
          externalUserId: true,
          clientId: true,
          client: { select: { name: true } },
          game: {
            select: {
              name: true,
              slug: true,
              provider: { select: { slug: true, displayName: true, name: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 15_000,
  });

  const places = await prisma.salsaTransaction.findMany({
    where: {
      kind: "PLACE_BET",
      createdAt: createdAtFilter(since, until),
      session: options.clientId ? { clientId: options.clientId } : undefined,
    },
    select: {
      sessionId: true,
      gameReference: true,
      amountCents: true,
      createdAt: true,
    },
    take: 30_000,
  });

  const placeIndex = new Map<string, number[]>();
  for (const p of places) {
    const key = `${p.sessionId}:${p.gameReference ?? ""}`;
    const list = placeIndex.get(key) ?? [];
    list.push(p.amountCents);
    placeIndex.set(key, list);
  }

  let orphanAwardCount = 0;
  let orphanAwardAmount = 0;
  const orphanSamples: unknown[] = [];

  for (const a of awards) {
    if (a.amountCents <= 0) continue;
    const key = `${a.sessionId}:${a.gameReference ?? ""}`;
    const linked = placeIndex.get(key);
    if (!linked?.length) {
      orphanAwardCount += 1;
      orphanAwardAmount += a.amountCents;
      if (orphanSamples.length < 25) {
        orphanSamples.push({
          at: a.createdAt.toISOString(),
          client: a.session.client.name,
          externalUserId: a.session.externalUserId,
          game: a.session.game.name,
          provider: providerLabel(a.session.game.provider),
          win: round2(a.amountCents / 100),
          walletSpinId: a.spinId,
          gameReference: a.gameReference,
        });
      }
    }
  }

  const duplicateCandidates: unknown[] = [];
  for (let i = 0; i < awards.length; i++) {
    const a = awards[i]!;
    if (a.amountCents <= 0) continue;
    for (let j = i + 1; j < awards.length; j++) {
      const b = awards[j]!;
      if (a.sessionId !== b.sessionId) continue;
      if (a.amountCents !== b.amountCents) continue;
      if (Math.abs(a.createdAt.getTime() - b.createdAt.getTime()) > 120_000) continue;
      if (a.salsaTransactionId === b.salsaTransactionId && a.referenceNum === b.referenceNum) continue;
      duplicateCandidates.push({
        at: a.createdAt.toISOString(),
        client: a.session.client.name,
        externalUserId: a.session.externalUserId,
        game: a.session.game.name,
        win: round2(a.amountCents / 100),
        spinA: a.spinId,
        spinB: b.spinId,
        note: "Dois prêmios iguais em <2min — possível retry antes do fix de spinId",
      });
      if (duplicateCandidates.length >= 30) break;
    }
    if (duplicateCandidates.length >= 30) break;
  }

  const aviatrixSpins = await prisma.gameSpin.findMany({
    where: {
      createdAt: createdAtFilter(since, until),
      session: {
        ...(options.clientId && { clientId: options.clientId }),
        game: {
          provider: {
            OR: [{ slug: { contains: "aviatrix" } }, { name: { contains: "Aviatrix" } }],
          },
        },
      },
    },
    select: { betAmount: true, winAmount: true },
  });

  let avBet = 0;
  let avWin = 0;
  for (const s of aviatrixSpins) {
    avBet += Number(s.betAmount);
    avWin += Number(s.winAmount);
  }

  const spinIdRows = await prisma.salsaTransaction.findMany({
    where: {
      spinId: { not: null },
      createdAt: createdAtFilter(since, until),
      session: options.clientId ? { clientId: options.clientId } : undefined,
    },
    select: { spinId: true },
  });
  const spinIdCounts = new Map<string, number>();
  for (const row of spinIdRows) {
    if (!row.spinId) continue;
    spinIdCounts.set(row.spinId, (spinIdCounts.get(row.spinId) ?? 0) + 1);
  }
  const reusedWalletSpinIds = [...spinIdCounts.values()].filter((n) => n > 1).length;

  return {
    since: since.toISOString(),
    until: until?.toISOString() ?? null,
    clientId: options.clientId ?? null,
    summary: {
      orphanAwards: {
        count: orphanAwardCount,
        totalWin: round2(orphanAwardAmount / 100),
        description:
          "Prêmio Salsa sem PlaceBet com mesmo gameReference — risco de crédito indevido no passado",
      },
      suspectedDuplicateWins: {
        count: duplicateCandidates.length,
        description: "Pares de Award com mesmo valor em curto intervalo (heurística pós-rede ocupada)",
      },
      reusedWalletSpinIds,
      aviatrix: {
        spins: aviatrixSpins.length,
        betAmount: round2(avBet),
        winAmount: round2(avWin),
        ggr: round2(avBet - avWin),
        playerNet: round2(avWin - avBet),
      },
    },
    orphanSamples,
    duplicateCandidates,
    guidance: [
      "GGR positivo no relatório = casa ganhou no cassino; saldo Pix dos clientes pode cair se jogadores ganharam (GGR negativo por jogador).",
      "Deploy com salsaWalletSpinId reduz prêmio duplicado em retry; rode este relatório antes/depois.",
      "Use Rastreio → informe externalUserId (ID numérico no back) para ver jogos e totais.",
    ],
  };
}
