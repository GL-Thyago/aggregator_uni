import crypto from "node:crypto";
import type { RtpPoolMode } from "../../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";

const RTP_OVERSHOOT_RATIO = 0.25;
const MAX_WIN_MULTIPLIER = 5;

export type SpinDecision = {
  shouldPay: boolean;
  maxWinAmount: number;
  targetRtpPct: number;
  drift: number;
  /** Caixa disponível para pagar prêmios (ex: 80% do apostado − já pago). */
  prizePool: number;
  /** Banca retida — não entra em prêmios (ex: 20% do apostado). */
  bankRetained: number;
  /** @deprecated use prizePool — mantido por compatibilidade */
  housePool: number;
  poolMode: RtpPoolMode;
};

export type RtpStats = {
  gameId: number;
  clientId?: string;
  poolMode: RtpPoolMode;
  targetRtpPct: number;
  totalWagered: number;
  totalPaidOut: number;
  prizePool: number;
  bankRetained: number;
  /** @deprecated use prizePool */
  housePool: number;
  targetPaid: number;
  drift: number;
  actualRtpPct: number;
  houseRetained: number;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Caixa utilizável: saldo acumulado ou, se negativo, só a fatia RTP desta aposta. */
export function getAvailablePayoutPool(
  ledgerPool: number,
  bet: number,
  targetRtpPct: number,
): number {
  const spinContribution = roundMoney(bet * (targetRtpPct / 100));
  if (ledgerPool >= 0) return roundMoney(ledgerPool);
  return spinContribution;
}

function isPerClient(mode: RtpPoolMode): boolean {
  return mode === "PER_CLIENT";
}

/** Fundo de prêmios = % configurável do apostado que pode ser pago ao jogador. */
export function computePrizePool(
  totalWagered: number,
  totalPaidOut: number,
  targetRtpPct: number,
): number {
  return roundMoney(totalWagered * (targetRtpPct / 100) - totalPaidOut);
}

/** Banca retida = % do apostado que fica com a casa e nunca paga prêmio. */
export function computeBankRetained(totalWagered: number, targetRtpPct: number): number {
  return roundMoney(totalWagered * (1 - targetRtpPct / 100));
}

function computeSpinDecision(input: {
  wageredAfter: number;
  paidBefore: number;
  bet: number;
  targetRtpPct: number;
}): Omit<SpinDecision, "poolMode"> {
  const { wageredAfter, paidBefore, bet, targetRtpPct } = input;
  const targetRtp = targetRtpPct / 100;

  const ledgerPool = computePrizePool(wageredAfter, paidBefore, targetRtpPct);
  const spinContribution = roundMoney(bet * targetRtp);
  const availablePool = getAvailablePayoutPool(ledgerPool, bet, targetRtpPct);
  const bankRetained = computeBankRetained(wageredAfter, targetRtpPct);
  const targetPaidAfter = wageredAfter * targetRtp;
  const drift = targetPaidAfter - paidBefore;

  const maxByMultiplier = bet * MAX_WIN_MULTIPLIER;
  const maxByOvershoot = Math.max(0, drift) + bet * RTP_OVERSHOOT_RATIO;
  let maxWinAmount = roundMoney(
    Math.min(maxByMultiplier, maxByOvershoot, Math.max(0, availablePool)),
  );

  let shouldPay = false;
  if (maxWinAmount > 0 && bet > 0) {
    const poolRatio = availablePool / Math.max(bet, 0.01);
    const lowPoolBoost = poolRatio <= 1.5 ? 0.12 : 0;
    const winBias = Math.min(
      0.68,
      Math.max(0.4, 0.48 + drift / Math.max(wageredAfter * 2, bet * 5) + lowPoolBoost),
    );
    shouldPay = crypto.randomInt(0, 1000) / 1000 < winBias;

    // Caixa global negativa: ainda paga micro-prêmios (≈80–100% da aposta) com a fatia da rodada
    if (!shouldPay && ledgerPool < 0 && spinContribution > 0) {
      const microCap = roundMoney(Math.min(spinContribution, bet * 1.0));
      if (microCap >= bet * 0.5) {
        maxWinAmount = microCap;
        shouldPay = crypto.randomInt(0, 1000) / 1000 < 0.45;
      }
    }
  }

  return {
    shouldPay,
    maxWinAmount: shouldPay ? maxWinAmount : 0,
    targetRtpPct,
    drift,
    prizePool: ledgerPool,
    bankRetained,
    housePool: ledgerPool,
  };
}

function buildStats(
  gameId: number,
  poolMode: RtpPoolMode,
  targetRtpPct: number,
  totalWagered: number,
  totalPaidOut: number,
  clientId?: string,
): RtpStats {
  const prizePool = computePrizePool(totalWagered, totalPaidOut, targetRtpPct);
  const bankRetained = computeBankRetained(totalWagered, targetRtpPct);
  const targetPaid = totalWagered * (targetRtpPct / 100);
  const drift = targetPaid - totalPaidOut;
  const actualRtpPct = totalWagered > 0 ? (totalPaidOut / totalWagered) * 100 : 0;

  return {
    gameId,
    clientId,
    poolMode,
    targetRtpPct,
    totalWagered,
    totalPaidOut,
    prizePool,
    bankRetained,
    housePool: prizePool,
    targetPaid,
    drift,
    actualRtpPct: Math.round(actualRtpPct * 100) / 100,
    houseRetained: roundMoney(totalWagered - totalPaidOut),
  };
}

export async function getRtpStats(input: {
  gameId: number;
  targetRtpPct: number;
  clientId?: string;
  rtpPoolMode?: RtpPoolMode;
}): Promise<RtpStats> {
  const poolMode = input.rtpPoolMode ?? "GLOBAL";

  if (isPerClient(poolMode)) {
    if (!input.clientId) {
      throw new Error("clientId required for PER_CLIENT RTP stats");
    }

    const ledger = await prisma.clientGameRtpLedger.findUnique({
      where: { clientId_gameId: { clientId: input.clientId, gameId: input.gameId } },
    });

    return buildStats(
      input.gameId,
      poolMode,
      input.targetRtpPct,
      ledger ? Number(ledger.totalWagered) : 0,
      ledger ? Number(ledger.totalPaidOut) : 0,
      input.clientId,
    );
  }

  const ledger = await prisma.gameRtpLedger.findUnique({ where: { gameId: input.gameId } });

  return buildStats(
    input.gameId,
    poolMode,
    input.targetRtpPct,
    ledger ? Number(ledger.totalWagered) : 0,
    ledger ? Number(ledger.totalPaidOut) : 0,
  );
}

/** Registra aposta e retorna caixa de prêmios disponível após a contribuição desta rodada. */
export async function resolveSpinDecision(input: {
  gameId: number;
  betAmount: number;
  targetRtpPct: number;
  clientId: string;
  rtpPoolMode: RtpPoolMode;
}): Promise<SpinDecision> {
  const bet = input.betAmount;
  const perClient = isPerClient(input.rtpPoolMode);

  return prisma.$transaction(async (tx) => {
    if (perClient) {
      const ledger = await tx.clientGameRtpLedger.upsert({
        where: { clientId_gameId: { clientId: input.clientId, gameId: input.gameId } },
        create: { clientId: input.clientId, gameId: input.gameId },
        update: {},
      });

      const wageredBefore = Number(ledger.totalWagered);
      const paidBefore = Number(ledger.totalPaidOut);
      const wageredAfter = roundMoney(wageredBefore + bet);

      const decision = computeSpinDecision({
        wageredAfter,
        paidBefore,
        bet,
        targetRtpPct: input.targetRtpPct,
      });

      await tx.clientGameRtpLedger.update({
        where: { clientId_gameId: { clientId: input.clientId, gameId: input.gameId } },
        data: {
          totalWagered: { increment: bet },
          housePool: decision.prizePool,
        },
      });

      return { ...decision, poolMode: input.rtpPoolMode };
    }

    const ledger = await tx.gameRtpLedger.upsert({
      where: { gameId: input.gameId },
      create: { gameId: input.gameId },
      update: {},
    });

    const wageredBefore = Number(ledger.totalWagered);
    const paidBefore = Number(ledger.totalPaidOut);
    const wageredAfter = roundMoney(wageredBefore + bet);

    const decision = computeSpinDecision({
      wageredAfter,
      paidBefore,
      bet,
      targetRtpPct: input.targetRtpPct,
    });

    await tx.gameRtpLedger.update({
      where: { gameId: input.gameId },
      data: {
        totalWagered: { increment: bet },
        housePool: decision.prizePool,
      },
    });

    return { ...decision, poolMode: input.rtpPoolMode };
  });
}

/** Confirma pagamento — debita do fundo de prêmios (não toca na banca retida). */
export async function commitSpinPayout(input: {
  gameId: number;
  winAmount: number;
  targetRtpPct: number;
  clientId: string;
  rtpPoolMode: RtpPoolMode;
}) {
  const targetRtp = input.targetRtpPct / 100;
  const perClient = isPerClient(input.rtpPoolMode);

  return prisma.$transaction(async (tx) => {
    if (perClient) {
      const ledger = await tx.clientGameRtpLedger.upsert({
        where: { clientId_gameId: { clientId: input.clientId, gameId: input.gameId } },
        create: { clientId: input.clientId, gameId: input.gameId },
        update: {},
      });

      const paidBefore = Number(ledger.totalPaidOut);
      const wageredAfter = Number(ledger.totalWagered);
      const paidAfter = paidBefore + input.winAmount;
      const prizePool = computePrizePool(wageredAfter, paidAfter, input.targetRtpPct);
      const actualRtpPct = wageredAfter > 0 ? (paidAfter / wageredAfter) * 100 : 0;

      await tx.clientGameRtpLedger.update({
        where: { clientId_gameId: { clientId: input.clientId, gameId: input.gameId } },
        data: {
          totalPaidOut: { increment: input.winAmount },
          housePool: prizePool,
        },
      });

      return {
        actualRtpPct: Math.round(actualRtpPct * 100) / 100,
        prizePool,
        bankRetained: computeBankRetained(wageredAfter, input.targetRtpPct),
        housePool: prizePool,
        drift: wageredAfter * targetRtp - paidAfter,
        poolMode: input.rtpPoolMode,
      };
    }

    const ledger = await tx.gameRtpLedger.upsert({
      where: { gameId: input.gameId },
      create: { gameId: input.gameId },
      update: {},
    });

    const paidBefore = Number(ledger.totalPaidOut);
    const wageredAfter = Number(ledger.totalWagered);
    const paidAfter = paidBefore + input.winAmount;
    const prizePool = computePrizePool(wageredAfter, paidAfter, input.targetRtpPct);
    const actualRtpPct = wageredAfter > 0 ? (paidAfter / wageredAfter) * 100 : 0;

    await tx.gameRtpLedger.update({
      where: { gameId: input.gameId },
      data: {
        totalPaidOut: { increment: input.winAmount },
        housePool: prizePool,
      },
    });

    return {
      actualRtpPct: Math.round(actualRtpPct * 100) / 100,
      prizePool,
      bankRetained: computeBankRetained(wageredAfter, input.targetRtpPct),
      housePool: prizePool,
      drift: wageredAfter * targetRtp - paidAfter,
      poolMode: input.rtpPoolMode,
    };
  });
}

/** @deprecated use resolveSpinDecision + commitSpinPayout */
export async function resolveSpinOutcome(input: {
  gameId: number;
  betAmount: number;
  targetRtpPct: number;
  clientId: string;
  rtpPoolMode: RtpPoolMode;
}) {
  const decision = await resolveSpinDecision(input);
  return {
    winAmount: decision.maxWinAmount,
    multiplier: input.betAmount > 0 ? decision.maxWinAmount / input.betAmount : 0,
    drift: decision.drift,
    targetRtpPct: decision.targetRtpPct,
    actualRtpPct: 0,
    prizePool: decision.prizePool,
    housePool: decision.prizePool,
    poolMode: decision.poolMode,
  };
}
