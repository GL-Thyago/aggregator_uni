import crypto from "node:crypto";
import type { GameSession, Game, Client } from "../../generated/prisma/client.js";
import { getWalletBalance } from "./player-wallet.service.js";
import { processSpin } from "./session.service.js";
import { commitSpinPayout, resolveSpinDecision, getAvailablePayoutPool } from "./rtp-pool.service.js";
import {
  DEFAULT_HOUSE_RETENTION_PCT,
  DEFAULT_TARGET_RTP_PCT,
  diceFairMultiplier,
  evenMoneyMultiplier,
} from "../config/rtp.js";
import { resolveTargetRtpForSession } from "./client-game-config.service.js";

export type GameSessionFull = GameSession & { game: Game; client: Client };

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function parseBet(body: Record<string, unknown>, fallback = 1): number {
  const raw = body.betAmount ?? body.bet_amount ?? body.betamount ?? body.amount ?? fallback;
  return roundMoney(Number(raw));
}

export async function loadSessionBalance(session: GameSessionFull) {
  return getWalletBalance(session.clientId, session.externalUserId, session.currency);
}

export async function settleInstantBet(
  session: GameSessionFull,
  betAmount: number,
  winAmount: number,
  options?: { rtpWagerAlreadyRegistered?: boolean },
) {
  const targetRtp = await resolveTargetRtpForSession(session);

  if (betAmount > 0 && !options?.rtpWagerAlreadyRegistered) {
    await resolveSpinDecision({
      gameId: session.game.id,
      betAmount,
      targetRtpPct: targetRtp,
      clientId: session.clientId,
      rtpPoolMode: session.client.rtpPoolMode,
    });
  }

  const spin = await processSpin({
    sessionToken: session.sessionToken,
    betAmount,
    winAmount: roundMoney(winAmount),
  });

  const rtpCommit = await commitSpinPayout({
    gameId: session.game.id,
    winAmount: roundMoney(winAmount),
    targetRtpPct: targetRtp,
    clientId: session.clientId,
    rtpPoolMode: session.client.rtpPoolMode,
  });

  return { spin, rtpCommit, targetRtp };
}

export async function resolveRtpDecision(session: GameSessionFull, betAmount: number) {
  const targetRtp = await resolveTargetRtpForSession(session);
  return resolveSpinDecision({
    gameId: session.game.id,
    betAmount,
    targetRtpPct: targetRtp,
    clientId: session.clientId,
    rtpPoolMode: session.client.rtpPoolMode,
  });
}

export async function buildInstantSessionResponse(session: GameSessionFull) {
  const balance = await loadSessionBalance(session);
  const minBet = session.game.minBet ? Number(session.game.minBet) : 1;
  const maxBet = session.game.maxBet ? Number(session.game.maxBet) : 1000;

  return {
    success: true,
    message: "Session loaded",
    data: {
      user_name: session.externalUserId,
      credit: balance,
      balance,
      currency_prefix: "R$",
      currency_suffix: "",
      min_bet: minBet,
      max_bet: maxBet,
      bet_presets: [1, 2, 5, 10, 25, 50, 100, 200].filter((b) => b >= minBet && b <= maxBet),
      game: session.game.slug,
      rtp: await resolveTargetRtpForSession(session),
    },
  };
}

const MIN_CRASH_POINT = 1.08;

/** Gera ponto de crash com retenção ~20% (RTP ~80%). */
export function generateCrashPoint(retentionPct = DEFAULT_HOUSE_RETENTION_PCT): number {
  const r = crypto.randomInt(1, 1_000_000) / 1_000_000;
  const houseEdge = retentionPct / 100;
  let crash = (1 - houseEdge) / (1 - r);
  crash = Math.max(MIN_CRASH_POINT, Math.min(500, Math.floor(crash * 100) / 100));
  return roundMoney(crash);
}

export function multiplierAtElapsedMs(elapsedMs: number): number {
  const seconds = elapsedMs / 1000;
  const mult = Math.exp(seconds * 0.18);
  return roundMoney(Math.max(1, mult));
}

export function msToReachMultiplier(mult: number): number {
  const safe = Math.max(mult, MIN_CRASH_POINT);
  if (safe <= 1) return 500;
  return Math.ceil((Math.log(safe) / 0.18) * 1000);
}

export type CrashBet = {
  betId: string;
  betAmount: number;
  status: "active" | "cashed_out" | "lost";
  cashoutAt?: number;
  winAmount?: number;
};

export type CrashRound = {
  roundId: string;
  sessionToken: string;
  crashPoint: number;
  /** 0 até o voo iniciar (start_flight). */
  startedAt: number;
  createdAt: number;
  flightStarted: boolean;
  status: "active" | "ended";
  bets: CrashBet[];
};

const crashRounds = new Map<string, CrashRound>();
const CRASH_ROUND_TTL_MS = 120_000;

function purgeOldRounds() {
  const now = Date.now();
  for (const [key, round] of crashRounds) {
    const anchor = round.startedAt || round.createdAt;
    if (now - anchor > CRASH_ROUND_TTL_MS) crashRounds.delete(key);
  }
}

export function createCrashRound(input: {
  sessionToken: string;
  crashPoint: number;
  betAmount: number;
}): { round: CrashRound; betId: string } {
  purgeOldRounds();
  const betId = crypto.randomUUID();
  const round: CrashRound = {
    roundId: crypto.randomUUID(),
    sessionToken: input.sessionToken,
    crashPoint: input.crashPoint,
    startedAt: 0,
    createdAt: Date.now(),
    flightStarted: false,
    status: "active",
    bets: [
      {
        betId,
        betAmount: input.betAmount,
        status: "active",
      },
    ],
  };
  crashRounds.set(round.roundId, round);
  return { round, betId };
}

export function getCrashRound(roundId: string): CrashRound | undefined {
  return crashRounds.get(roundId);
}

export function getActiveCrashRound(sessionToken: string): CrashRound | undefined {
  purgeOldRounds();
  for (const round of crashRounds.values()) {
    if (round.sessionToken === sessionToken && round.status === "active") {
      return round;
    }
  }
  return undefined;
}

export function addBetToCrashRound(round: CrashRound, betAmount: number): string {
  const betId = crypto.randomUUID();
  round.bets.push({ betId, betAmount, status: "active" });
  return betId;
}

export function startCrashRoundFlight(round: CrashRound): number {
  if (round.flightStarted) return round.startedAt;
  round.flightStarted = true;
  round.startedAt = Date.now();
  return round.startedAt;
}

export function crashRoundElapsedMs(round: CrashRound): number {
  if (!round.flightStarted || round.startedAt <= 0) return 0;
  return Date.now() - round.startedAt;
}

export function crashRoundDurationMs(round: CrashRound): number {
  return msToReachMultiplier(round.crashPoint);
}

export function getCrashBet(round: CrashRound, betId: string): CrashBet | undefined {
  return round.bets.find((b) => b.betId === betId);
}

export function resolveCrashCashout(round: CrashRound, claimedMult: number): number {
  const elapsed = crashRoundElapsedMs(round);
  const timeMult = multiplierAtElapsedMs(elapsed);
  const cap = round.crashPoint <= 1.01 ? 1 : round.crashPoint - 0.01;
  const effective = roundMoney(Math.min(claimedMult, timeMult + 0.08, cap));
  return Math.max(1, effective);
}

export function rollDice(): number {
  return crypto.randomInt(0, 100);
}

export function flipCoin(): 0 | 1 {
  return crypto.randomInt(0, 2) as 0 | 1;
}

export function spinDoubleColor(): 0 | 1 {
  return crypto.randomInt(0, 2) as 0 | 1;
}

/** Ordem visual da roleta Double (15 casas, estilo Blaze). */
export const DOUBLE_WHEEL_ORDER = [1, 14, 2, 13, 3, 12, 4, 11, 5, 10, 6, 9, 7, 8, 0] as const;

export type DoubleColor = "red" | "black" | "white";

export function doubleTileColor(tile: number): DoubleColor {
  if (tile === 0) return "white";
  if (tile >= 1 && tile <= 7) return "red";
  return "black";
}

export function spinDoubleTile(): number {
  return crypto.randomInt(0, 15);
}

export function doubleWinChance(color: DoubleColor): number {
  if (color === "white") return 1 / 15;
  return 7 / 15;
}

export function doubleDisplayMultiplier(color: DoubleColor): number {
  if (color === "white") return 14;
  return 2;
}

export function doublePayout(
  bet: number,
  choice: DoubleColor,
  tile: number,
): number {
  const result = doubleTileColor(tile);
  if (choice !== result) return 0;
  return roundMoney(bet * doubleDisplayMultiplier(choice));
}

/** Escolhe tile perdedor quando a caixa não cobre o prêmio justo. */
export function pickLosingDoubleTile(choice: DoubleColor): number {
  if (choice === "white") {
    return crypto.randomInt(1, 15);
  }
  if (choice === "red") {
    const losing = [0, 8, 9, 10, 11, 12, 13, 14];
    return losing[crypto.randomInt(0, losing.length)]!;
  }
  const losing = [0, 1, 2, 3, 4, 5, 6, 7];
  return losing[crypto.randomInt(0, losing.length)]!;
}

export function evenMoneyPayout(bet: number, won: boolean): number {
  if (!won) return 0;
  return roundMoney(bet * 2);
}

export function dicePayout(
  bet: number,
  target: number,
  rollOver: boolean,
  roll: number,
): number {
  const winChance = rollOver ? (99 - target) / 100 : target / 100;
  if (winChance <= 0 || winChance >= 1) return 0;

  const won = rollOver ? roll > target : roll < target;
  if (!won) return 0;

  return roundMoney(bet / winChance);
}

/** Rolagem perdedora forçada (caixa insuficiente). */
export function pickLosingDiceRoll(target: number, rollOver: boolean): number {
  if (rollOver) {
    return crypto.randomInt(0, Math.min(target, 99) + 1);
  }
  return crypto.randomInt(Math.min(target, 99), 100);
}

export function pickLosingCoinFlip(choiceBit: 0 | 1): 0 | 1 {
  return (1 - choiceBit) as 0 | 1;
}

/** Prêmio justo limitado ao fundo disponível; se caixa global negativa, usa fatia desta aposta. */
export function applyPoolGatedWin(
  fairWinAmount: number,
  prizePool: number,
  betAmount = 0,
  targetRtpPct = 80,
): number {
  if (fairWinAmount <= 0) return 0;
  const available = getAvailablePayoutPool(prizePool, betAmount, targetRtpPct);
  if (available <= 0) return 0;
  if (available >= fairWinAmount) return roundMoney(fairWinAmount);
  // Paga parcialmente prêmios pequenos (ex.: aposta 10, ganha 8)
  if (fairWinAmount <= betAmount * 1.05) return roundMoney(available);
  return 0;
}

/* ── Mines ── */

export const MINES_GRID_SIZE = 25;
export const MINES_PRESETS = [1, 3, 5, 10, 15, 20, 24] as const;

export type MinesRound = {
  roundId: string;
  sessionToken: string;
  gridSize: number;
  mineCount: number;
  minePositions: number[];
  revealed: number[];
  betAmount: number;
  status: "active" | "lost" | "cashed_out";
  createdAt: number;
};

const minesRounds = new Map<string, MinesRound>();
const MINES_ROUND_TTL_MS = 120_000;

function purgeOldMinesRounds() {
  const now = Date.now();
  for (const [key, round] of minesRounds) {
    if (now - round.createdAt > MINES_ROUND_TTL_MS) minesRounds.delete(key);
  }
}

export function minesFairMultiplier(gridSize: number, mines: number, revealed: number): number {
  if (revealed <= 0) return 1;
  let mult = 1;
  for (let i = 0; i < revealed; i++) {
    mult *= (gridSize - i) / (gridSize - mines - i);
  }
  return roundMoney(Math.max(1, mult));
}

export function minesDisplayMultiplier(
  gridSize: number,
  mines: number,
  revealed: number,
): number {
  return minesFairMultiplier(gridSize, mines, revealed);
}

export function minesPayout(
  bet: number,
  gridSize: number,
  mines: number,
  revealed: number,
): number {
  if (revealed <= 0) return 0;
  return roundMoney(bet * minesFairMultiplier(gridSize, mines, revealed));
}

function pickMinePositions(gridSize: number, mineCount: number): number[] {
  const positions = new Set<number>();
  while (positions.size < mineCount) {
    positions.add(crypto.randomInt(0, gridSize));
  }
  return [...positions];
}

export function createMinesRound(input: {
  sessionToken: string;
  betAmount: number;
  mineCount: number;
  gridSize?: number;
}): MinesRound {
  purgeOldMinesRounds();
  const gridSize = input.gridSize ?? MINES_GRID_SIZE;
  const mineCount = Math.max(1, Math.min(gridSize - 1, input.mineCount));
  const round: MinesRound = {
    roundId: crypto.randomUUID(),
    sessionToken: input.sessionToken,
    gridSize,
    mineCount,
    minePositions: pickMinePositions(gridSize, mineCount),
    revealed: [],
    betAmount: input.betAmount,
    status: "active",
    createdAt: Date.now(),
  };
  minesRounds.set(round.roundId, round);
  return round;
}

export function getMinesRound(roundId: string): MinesRound | undefined {
  return minesRounds.get(roundId);
}

export function getActiveMinesRound(sessionToken: string): MinesRound | undefined {
  purgeOldMinesRounds();
  for (const round of minesRounds.values()) {
    if (round.sessionToken === sessionToken && round.status === "active") {
      return round;
    }
  }
  return undefined;
}

export function revealMinesTile(round: MinesRound, tile: number): { hitMine: boolean; completed: boolean } {
  if (round.minePositions.includes(tile)) {
    return { hitMine: true, completed: true };
  }
  if (!round.revealed.includes(tile)) {
    round.revealed.push(tile);
  }
  const maxSafe = round.gridSize - round.mineCount;
  const completed = round.revealed.length >= maxSafe;
  return { hitMine: false, completed };
}
