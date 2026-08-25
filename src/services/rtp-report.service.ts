import { prisma } from "../lib/prisma.js";
import { DEFAULT_TARGET_RTP_PCT, targetRtpFromGame } from "../config/rtp.js";
import { computeBankRetained, computePrizePool } from "./rtp-pool.service.js";

export type GameRtpReportRow = {
  gameId: number;
  slug: string;
  name: string;
  category: string;
  gameType: string;
  targetRtpPct: number;
  retentionPct: number;
  totalWagered: number;
  totalPaidOut: number;
  houseRetained: number;
  actualRtpPct: number;
  prizePool: number;
  bankRetained: number;
  /** @deprecated use prizePool */
  housePool: number;
  spinCount: number;
  drift: number;
};

export async function getRtpDashboard(): Promise<{
  generatedAt: string;
  summary: {
    targetRtpPct: number;
    retentionPct: number;
    totalWagered: number;
    totalPaidOut: number;
    houseRetained: number;
    actualRtpPct: number;
    spinCount: number;
  };
  games: GameRtpReportRow[];
}> {
  const games = await prisma.game.findMany({
    where: { isActive: true },
    include: { category: true, rtpLedger: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  const spinAgg = await prisma.gameSpin.findMany({
    select: {
      betAmount: true,
      winAmount: true,
      session: { select: { gameId: true } },
    },
  });

  const spinsByGame = new Map<number, { count: number; bet: number; win: number }>();
  for (const s of spinAgg) {
    const gid = s.session.gameId;
    const cur = spinsByGame.get(gid) ?? { count: 0, bet: 0, win: 0 };
    cur.count += 1;
    cur.bet += Number(s.betAmount);
    cur.win += Number(s.winAmount);
    spinsByGame.set(gid, cur);
  }

  const rows: GameRtpReportRow[] = games.map((g) => {
    const targetRtpPct = targetRtpFromGame(g.rtp);
    const ledger = g.rtpLedger;
    const spins = spinsByGame.get(g.id);

    const totalWagered = ledger ? Number(ledger.totalWagered) : (spins?.bet ?? 0);
    const totalPaidOut = ledger ? Number(ledger.totalPaidOut) : (spins?.win ?? 0);
    const houseRetained = totalWagered - totalPaidOut;
    const actualRtpPct =
      totalWagered > 0 ? Math.round((totalPaidOut / totalWagered) * 10000) / 100 : 0;
    const targetPaid = totalWagered * (targetRtpPct / 100);
    const prizePool = computePrizePool(totalWagered, totalPaidOut, targetRtpPct);
    const bankRetained = computeBankRetained(totalWagered, targetRtpPct);

    return {
      gameId: g.id,
      slug: g.slug,
      name: g.name,
      category: g.category.slug,
      gameType: g.gameType,
      targetRtpPct,
      retentionPct: 100 - targetRtpPct,
      totalWagered: round2(totalWagered),
      totalPaidOut: round2(totalPaidOut),
      houseRetained: round2(houseRetained),
      actualRtpPct,
      prizePool,
      bankRetained,
      housePool: prizePool,
      spinCount: spins?.count ?? 0,
      drift: round2(targetPaid - totalPaidOut),
    };
  });

  const summary = rows.reduce(
    (acc, r) => {
      acc.totalWagered += r.totalWagered;
      acc.totalPaidOut += r.totalPaidOut;
      acc.houseRetained += r.houseRetained;
      acc.spinCount += r.spinCount;
      return acc;
    },
    {
      targetRtpPct: DEFAULT_TARGET_RTP_PCT,
      retentionPct: 100 - DEFAULT_TARGET_RTP_PCT,
      totalWagered: 0,
      totalPaidOut: 0,
      houseRetained: 0,
      actualRtpPct: 0,
      spinCount: 0,
    },
  );

  summary.actualRtpPct =
    summary.totalWagered > 0
      ? Math.round((summary.totalPaidOut / summary.totalWagered) * 10000) / 100
      : 0;
  summary.totalWagered = round2(summary.totalWagered);
  summary.totalPaidOut = round2(summary.totalPaidOut);
  summary.houseRetained = round2(summary.houseRetained);

  return { generatedAt: new Date().toISOString(), summary, games: rows };
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}
