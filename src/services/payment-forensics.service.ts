import { prisma } from "../lib/prisma.js";
import { getBillingReport } from "./billing-report.service.js";

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
  return { gte: since, ...(until ? { lte: until } : {}) };
}

const DUPLICATE_WINDOW_MS = 120_000;

type DuplicateCluster = {
  sessionId: string;
  externalUserId: string;
  clientName: string;
  game: string;
  provider: string;
  winAmount: number;
  events: number;
  excessCredits: number;
  estimatedOverpayment: number;
  spinIds: string[];
  at: string;
  reason: string;
};

/**
 * Estima prêmios creditados a mais por retry Salsa (spinId aleatório antes do fix).
 */
function findDuplicateAwardClusters(
  awards: {
    sessionId: string;
    amountCents: number;
    spinId: string | null;
    salsaTransactionId: string;
    referenceNum: string;
    createdAt: Date;
    session: {
      externalUserId: string;
      client: { name: string };
      game: { name: string; provider: { displayName: string | null; name: string } };
    };
  }[],
): DuplicateCluster[] {
  const clusters: DuplicateCluster[] = [];
  const byKey = new Map<string, typeof awards>();

  for (const a of awards) {
    if (a.amountCents <= 0) continue;
    const key = `${a.sessionId}:${a.amountCents}`;
    const list = byKey.get(key) ?? [];
    list.push(a);
    byKey.set(key, list);
  }

  for (const list of byKey.values()) {
    list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    let i = 0;
    while (i < list.length) {
      const cluster = [list[i]!];
      let j = i + 1;
      while (j < list.length && list[j]!.createdAt.getTime() - cluster[0]!.createdAt.getTime() <= DUPLICATE_WINDOW_MS) {
        cluster.push(list[j]!);
        j++;
      }
      if (cluster.length > 1) {
        const uniqueTx = new Set(cluster.map((c) => `${c.salsaTransactionId}:${c.referenceNum}`));
        const uniqueSpin = new Set(cluster.map((c) => c.spinId).filter(Boolean));
        if (uniqueTx.size > 1 || uniqueSpin.size > 1) {
          const win = round2(cluster[0]!.amountCents / 100);
          const excess = cluster.length - 1;
          const sample = cluster[0]!;
          clusters.push({
            sessionId: sample.sessionId,
            externalUserId: sample.session.externalUserId,
            clientName: sample.session.client.name,
            game: sample.session.game.name,
            provider: sample.session.game.provider.displayName?.trim() || sample.session.game.provider.name,
            winAmount: win,
            events: cluster.length,
            excessCredits: excess,
            estimatedOverpayment: round2(win * excess),
            spinIds: cluster.map((c) => c.spinId).filter(Boolean) as string[],
            at: sample.createdAt.toISOString(),
            reason:
              uniqueSpin.size > 1
                ? "Vários walletSpinId no mesmo prêmio (retry antes do fix sw_*)"
                : "Vários TransactionID Salsa no mesmo valor curto",
          });
        }
      }
      i = j > i + 1 ? j : i + 1;
    }
  }

  return clusters.sort((a, b) => b.estimatedOverpayment - a.estimatedOverpayment);
}

export async function getPaymentForensicsReport(options: {
  since?: string;
  until?: string;
  clientId?: string;
}) {
  const since = parseSince(options.since);
  const until = parseUntil(options.until);
  const sinceIso = since.toISOString();
  const untilIso = until?.toISOString() ?? null;

  const billing = await getBillingReport(sinceIso, options.clientId, untilIso ?? undefined);

  const awards = await prisma.salsaTransaction.findMany({
    where: {
      kind: "AWARD_WINNINGS",
      amountCents: { gt: 0 },
      createdAt: createdAtFilter(since, until),
      session: options.clientId ? { clientId: options.clientId } : undefined,
    },
    select: {
      sessionId: true,
      amountCents: true,
      spinId: true,
      salsaTransactionId: true,
      referenceNum: true,
      createdAt: true,
      session: {
        select: {
          externalUserId: true,
          client: { select: { name: true } },
          game: {
            select: {
              name: true,
              provider: { select: { displayName: true, name: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: 50_000,
  });

  const duplicateClusters = findDuplicateAwardClusters(awards);
  const estimatedDuplicateOverpayment = round2(
    duplicateClusters.reduce((s, c) => s + c.estimatedOverpayment, 0),
  );

  let legacySpinAwards = 0;
  let stableSpinAwards = 0;
  for (const a of awards) {
    const id = a.spinId ?? "";
    if (id.startsWith("sw_")) stableSpinAwards += 1;
    else if (id) legacySpinAwards += 1;
  }

  const spins = await prisma.gameSpin.findMany({
    where: {
      createdAt: createdAtFilter(since, until),
      session: options.clientId ? { clientId: options.clientId } : undefined,
    },
    select: {
      betAmount: true,
      winAmount: true,
      session: { select: { externalUserId: true } },
    },
  });

  let totalBet = 0;
  let totalWin = 0;
  const byPlayer = new Map<string, { bet: number; win: number }>();
  for (const s of spins) {
    const bet = Number(s.betAmount);
    const win = Number(s.winAmount);
    totalBet += bet;
    totalWin += win;
    const uid = s.session.externalUserId;
    const p = byPlayer.get(uid) ?? { bet: 0, win: 0 };
    p.bet += bet;
    p.win += win;
    byPlayer.set(uid, p);
  }

  const aggregatePlayerNet = round2(totalWin - totalBet);
  const aggregateGgrHouse = round2(totalBet - totalWin);
  const billingGgr = round2(billing.ggr);
  const ggrDelta = round2(aggregateGgrHouse - billingGgr);

  const topWinners = [...byPlayer.entries()]
    .map(([externalUserId, v]) => ({
      externalUserId,
      betAmount: round2(v.bet),
      winAmount: round2(v.win),
      playerNet: round2(v.win - v.bet),
      houseGgr: round2(v.bet - v.win),
    }))
    .filter((p) => p.playerNet > 0)
    .sort((a, b) => b.playerNet - a.playerNet)
    .slice(0, 25);

  const topWinnersTotal = round2(topWinners.reduce((s, p) => s + p.playerNet, 0));

  const interpretation = buildInterpretation({
    estimatedDuplicateOverpayment,
    duplicateClusterCount: duplicateClusters.length,
    aggregatePlayerNet,
    aggregateGgrHouse,
    billingGgr,
    topWinnersTotal,
    legacySpinAwards,
  });

  return {
    since: sinceIso,
    until: untilIso,
    clientId: options.clientId ?? null,
    reconciliation: {
      gameSpinBet: round2(totalBet),
      gameSpinWin: round2(totalWin),
      aggregatePlayerNet,
      aggregateGgrHouse,
      billingReportGgr: billingGgr,
      ggrDelta,
      note: "aggregatePlayerNet + aggregateGgrHouse ≈ 0. billingGgr deve ≈ aggregateGgrHouse.",
    },
    duplicateAwards: {
      clusterCount: duplicateClusters.length,
      estimatedOverpaymentR$: estimatedDuplicateOverpayment,
      description:
        "Soma (N−1)×valor quando o mesmo prêmio apareceu várias vezes em <2min com spin/tx diferentes.",
      topClusters: duplicateClusters.slice(0, 40),
    },
    walletSpinIdEra: {
      awardsWithLegacyUuidSpinId: legacySpinAwards,
      awardsWithStableSwSpinId: stableSpinAwards,
      note: "Prêmios antes do deploy usam UUID no back; duplicata em retry era possível.",
    },
    winners: {
      topWinners,
      sumTop25PlayerNet: topWinnersTotal,
      description:
        "Ganhadores líquidos no período — explica saque mesmo com GGR casa positivo (não é bug por si).",
    },
    verdict: interpretation.verdict,
    explanation: interpretation.explanation,
    nextSteps: interpretation.nextSteps,
  };
}

function buildInterpretation(input: {
  estimatedDuplicateOverpayment: number;
  duplicateClusterCount: number;
  aggregatePlayerNet: number;
  aggregateGgrHouse: number;
  billingGgr: number;
  topWinnersTotal: number;
  legacySpinAwards: number;
}) {
  const steps: string[] = [
    "Rode `npm run forensics:casino` no back_uni Zona (mesmo período) para cruzar c1_casino_spin_idempotency.",
    "Compare Pix entrou − saiu no admin Zona com aggregatePlayerNet dos ganhadores.",
    "Após deploy sw_* spinId, monitore duplicateAwards.estimatedOverpaymentR$ → deve parar de subir.",
  ];

  if (input.estimatedDuplicateOverpayment >= 100) {
    return {
      verdict: "EVIDENCE_DUPLICATE_CREDITS",
      explanation: [
        `Foram encontrados ${input.duplicateClusterCount} grupos de prêmio repetido (heurística Salsa).`,
        `Estimativa conservadora de crédito a mais no wallet: **R$ ${input.estimatedDuplicateOverpayment.toFixed(2)}**.`,
        `Isso pode explicar parte do depósito extra para pagar saques, além de ganhadores legítimos.`,
        `GGR casa no período: R$ ${input.aggregateGgrHouse.toFixed(2)} — a casa pode ganhar no agregado e mesmo assim alguns jogadores sacarem muito.`,
      ],
      nextSteps: steps,
    };
  }

  if (input.aggregateGgrHouse > 0 && input.topWinnersTotal > input.aggregateGgrHouse * 1.5) {
    return {
      verdict: "LIKELY_LEGITIMATE_WINNERS",
      explanation: [
        "Pouca ou nenhuma duplicata detectada no agregador neste período.",
        `Soma do lucro líquido dos top 25 ganhadores: R$ ${input.topWinnersTotal.toFixed(2)}.`,
        `GGR casa (GameSpin): R$ ${input.aggregateGgrHouse.toFixed(2)} — os ganhadores concentrados podem exigir Pix mesmo com relatório RG positivo.`,
        `Lucro líquido de todos os jogadores no período: R$ ${input.aggregatePlayerNet.toFixed(2)} (negativo = casa ganhou no agregado).`,
      ],
      nextSteps: steps,
    };
  }

  return {
    verdict: "INCONCLUSIVE",
    explanation: [
      "Não há clusters fortes de duplicata Salsa neste recorte.",
      "Use o script no back e confira bônus/ajustes/Pix fora do agregador.",
    ],
    nextSteps: steps,
  };
}
