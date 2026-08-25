import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Game, GameSession, Client } from "../../generated/prisma/client.js";
import { resolveGamesDir } from "./game.service.js";
import { getWalletBalance } from "./player-wallet.service.js";
import { processSpin } from "./session.service.js";
import { commitSpinPayout, resolveSpinDecision, getRtpStats, getAvailablePayoutPool } from "./rtp-pool.service.js";
import { resolveTargetRtpForSession } from "./client-game-config.service.js";

type PaytableSymbol = {
  id: string;
  name: string;
  type?: string;
  win_3: number;
  win_4: number;
  win_5: number;
};

type Paytable = {
  symbols: PaytableSymbol[];
  lines: { max: number; minPerLine: number; maxPerLine: number; minTotal: number; maxTotal: number; presets?: number[] };
  payoutScale: { fullScaleMinBetPerLine: number; lowScaleFactor: number };
  wild: { id: string; name: string; substitutes: boolean };
  scatter: {
    id: string;
    name: string;
    freeSpins: Record<string, number>;
    bonusMultiplier: number;
    cauldronTrigger?: number;
    cauldronBaseMult?: Record<string, number>;
  };
  cauldronBonus?: {
    count: number;
    wrongMultipliers: number[];
    bestMultipliers: number[];
  };
  jackpots: {
    fullScale: { grand: number; major: number; minor: number };
    lowScale: { grand: number; major: number; minor: number };
  };
};

type ActiveLineWin = {
  line: number;
  symbol: string;
  symbolName: string;
  count: number;
  multiplier: number;
  winCentavos: number;
};

type FreeSpinState = {
  remaining: number;
  multiplier: number;
  betPerLineCentavos: number;
  activeLines: number;
};

type CauldronBonusState = {
  roundId: string;
  sessionToken: string;
  baseBonusCentavos: number;
  /** Índice vencedor — NUNCA enviar ao cliente antes da escolha */
  correctIndex: number;
  multipliers: number[];
  picked: boolean;
  expiresAt: number;
};

type SessionWithRelations = GameSession & { game: Game; client: Client };

const GAME_SLUG = "luck";
const WILD = "leprechaun";
const SCATTER = "pot_gold";

const PAYING_IDS = [
  "leprechaun",
  "rainbow",
  "horseshoe",
  "harp",
  "clover",
  "coin",
  "mushroom",
  "mug",
] as const;

const freeSpinState = new Map<string, FreeSpinState>();
const cauldronBonusState = new Map<string, CauldronBonusState>();

const BONUS_TTL_MS = 5 * 60 * 1000;

let paytableCache: Paytable | null = null;
let paylinesCache: number[][] | null = null;

function loadPaytable(): Paytable {
  if (paytableCache) return paytableCache;
  const file = path.join(resolveGamesDir(), GAME_SLUG, "config", "paytable.json");
  paytableCache = JSON.parse(fs.readFileSync(file, "utf8")) as Paytable;
  return paytableCache;
}

function loadPaylines(): number[][] {
  if (paylinesCache) return paylinesCache;
  const file = path.join(resolveGamesDir(), GAME_SLUG, "config", "paylines.json");
  paylinesCache = (JSON.parse(fs.readFileSync(file, "utf8")) as { lines: number[][] }).lines;
  return paylinesCache;
}

function centavosToReais(c: number) {
  return Math.round(c) / 100;
}

function reaisToCentavos(r: number) {
  return Math.round(r * 100);
}

function getScaleFactor(betPerLineCentavos: number, paytable: Paytable) {
  return betPerLineCentavos >= paytable.payoutScale.fullScaleMinBetPerLine
    ? 1
    : paytable.payoutScale.lowScaleFactor;
}

function getMultiplier(symbol: PaytableSymbol, count: number) {
  if (count >= 5) return symbol.win_5;
  if (count === 4) return symbol.win_4;
  if (count === 3) return symbol.win_3;
  return 0;
}

function cellIndex(col: number, row: number) {
  return row * 5 + col;
}

function cellNumber1Based(col: number, row: number) {
  return cellIndex(col, row) + 1;
}

function buildPaylineMeta() {
  const paylines = loadPaylines();
  return paylines.map((pattern, idx) => ({
    line: idx + 1,
    rows: pattern,
    cells: pattern.map((row, col) => cellNumber1Based(col, row)),
  }));
}

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function cauldronBaseMult(scatterCount: number, paytable: Paytable) {
  const map = paytable.scatter.cauldronBaseMult ?? { "3": 2, "4": 3, "5": 5 };
  if (scatterCount >= 5) return map["5"] ?? 5;
  if (scatterCount >= 4) return map["4"] ?? 3;
  if (scatterCount >= 3) return map["3"] ?? 2;
  return 0;
}

function createCauldronBonus(
  sessionToken: string,
  betTotalCentavos: number,
  scatterCount: number,
  paytable: Paytable,
): CauldronBonusState {
  const cfg = paytable.cauldronBonus ?? {
    count: 5,
    wrongMultipliers: [1, 1.5, 2, 2.5],
    bestMultipliers: [5, 8, 10],
  };
  const baseMult = cauldronBaseMult(scatterCount, paytable);
  const baseBonusCentavos = Math.max(100, Math.round(betTotalCentavos * baseMult));
  const correctIndex = crypto.randomInt(0, cfg.count);
  const bestMult = cfg.bestMultipliers[crypto.randomInt(0, cfg.bestMultipliers.length)] ?? 8;
  const wrong = shuffleArray(cfg.wrongMultipliers).slice(0, cfg.count - 1);
  const multipliers = Array.from({ length: cfg.count }, (_, i) =>
    i === correctIndex ? bestMult : (wrong.shift() ?? 2),
  );

  return {
    roundId: crypto.randomUUID(),
    sessionToken,
    baseBonusCentavos,
    correctIndex,
    multipliers,
    picked: false,
    expiresAt: Date.now() + BONUS_TTL_MS,
  };
}

function getPendingBonus(sessionToken: string): CauldronBonusState | null {
  const bonus = cauldronBonusState.get(sessionToken);
  if (!bonus) return null;
  if (bonus.picked || bonus.expiresAt < Date.now()) {
    cauldronBonusState.delete(sessionToken);
    return null;
  }
  return bonus;
}

function isWild(id: string) {
  return id === WILD;
}

function isScatter(id: string) {
  return id === SCATTER;
}

function countScatters(grid: string[]) {
  return grid.filter((s) => isScatter(s)).length;
}

function resolveLineSymbol(symbols: string[]): string | null {
  for (const s of symbols) {
    if (!isWild(s) && !isScatter(s)) return s;
  }
  for (const s of symbols) {
    if (isWild(s)) return WILD;
  }
  return null;
}

function evaluateGrid(
  grid: string[],
  activeLineCount: number,
  betPerLineCentavos: number,
  paytable: Paytable,
  bonusMultiplier = 1,
): { totalWinCentavos: number; activeLines: ActiveLineWin[]; scatterCount: number } {
  const paylines = loadPaylines();
  const scale = getScaleFactor(betPerLineCentavos, paytable);
  const symbolMap = new Map(paytable.symbols.map((s) => [s.id, s]));
  const activeLines: ActiveLineWin[] = [];
  const scatterCount = countScatters(grid);

  for (let lineIdx = 0; lineIdx < activeLineCount; lineIdx++) {
    const pattern = paylines[lineIdx];
    if (!pattern) continue;

    const symbols = pattern.map((row, col) => grid[cellIndex(col, row)] ?? "");
    const paying = resolveLineSymbol(symbols);
    if (!paying || isScatter(paying)) continue;

    let count = 0;
    for (let col = 0; col < 5; col++) {
      const s = symbols[col];
      if (!s) break;
      if (s === paying || isWild(s)) count++;
      else break;
    }

    if (count < 3) continue;

    const sym = symbolMap.get(paying);
    if (!sym) continue;

    const multiplier = getMultiplier(sym, count);
    if (multiplier <= 0) continue;

    const winCentavos = Math.round(betPerLineCentavos * multiplier * scale * bonusMultiplier);
    activeLines.push({
      line: lineIdx + 1,
      symbol: paying,
      symbolName: sym.name,
      count,
      multiplier,
      winCentavos,
    });
  }

  return {
    totalWinCentavos: activeLines.reduce((sum, l) => sum + l.winCentavos, 0),
    activeLines,
    scatterCount,
  };
}

function randomPayingSymbol(): string {
  return PAYING_IDS[crypto.randomInt(0, PAYING_IDS.length)] ?? "mug";
}

function randomGridSymbol(): string {
  const r = crypto.randomInt(0, 100);
  if (r < 5) return SCATTER;
  if (r < 12) return WILD;
  return randomPayingSymbol();
}

function generateRandomGrid(): string[] {
  return Array.from({ length: 15 }, () => randomGridSymbol());
}

function fillGridAvoidingWins(
  activeLineCount: number,
  betPerLineCentavos: number,
  paytable: Paytable,
): string[] {
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = generateRandomGrid();
    const { totalWinCentavos, scatterCount } = evaluateGrid(
      candidate,
      activeLineCount,
      betPerLineCentavos,
      paytable,
    );
    if (totalWinCentavos === 0 && scatterCount < 3) return candidate;
  }
  return generateRandomGrid();
}

function applyWinToGrid(grid: string[], pattern: number[], symbolId: string, count: number) {
  for (let col = 0; col < count; col++) {
    const row = pattern[col];
    if (row === undefined) break;
    grid[cellIndex(col, row)] = symbolId;
  }
}

function buildWinningGrid(
  targetWinCentavos: number,
  activeLineCount: number,
  betPerLineCentavos: number,
  paytable: Paytable,
  bonusMultiplier = 1,
): { grid: string[]; activeLines: ActiveLineWin[]; scatterCount: number } {
  const paylines = loadPaylines();
  const scale = getScaleFactor(betPerLineCentavos, paytable);

  type Candidate = { lineIdx: number; symbol: PaytableSymbol; count: 3 | 4 | 5; winCentavos: number };
  const candidates: Candidate[] = [];

  for (let lineIdx = 0; lineIdx < activeLineCount; lineIdx++) {
    for (const symbol of paytable.symbols) {
      if (isScatter(symbol.id)) continue;
      for (const count of [3, 4, 5] as const) {
        const multiplier = getMultiplier(symbol, count);
        const winCentavos = Math.round(betPerLineCentavos * multiplier * scale * bonusMultiplier);
        if (winCentavos > 0 && winCentavos <= targetWinCentavos) {
          candidates.push({ lineIdx, symbol, count, winCentavos });
        }
      }
    }
  }

  candidates.sort((a, b) => b.winCentavos - a.winCentavos);
  const grid = fillGridAvoidingWins(activeLineCount, betPerLineCentavos, paytable);
  let placed = 0;
  const usedLines = new Set<number>();

  for (const cand of candidates) {
    if (usedLines.has(cand.lineIdx)) continue;
    if (placed + cand.winCentavos > targetWinCentavos) continue;
    const pattern = paylines[cand.lineIdx];
    if (!pattern) continue;
    applyWinToGrid(grid, pattern, cand.symbol.id, cand.count);
    usedLines.add(cand.lineIdx);
    placed += cand.winCentavos;
    if (placed >= targetWinCentavos * 0.85) break;
  }

  if (placed === 0 && candidates[0]) {
    const best = candidates[0];
    const pattern = paylines[best.lineIdx];
    if (pattern) applyWinToGrid(grid, pattern, best.symbol.id, best.count);
  }

  const evaluated = evaluateGrid(grid, activeLineCount, betPerLineCentavos, paytable, bonusMultiplier);
  return { grid, activeLines: evaluated.activeLines, scatterCount: evaluated.scatterCount };
}

function scatterFreeSpins(count: number, paytable: Paytable) {
  if (count >= 5) return paytable.scatter.freeSpins["5"] ?? 20;
  if (count >= 4) return paytable.scatter.freeSpins["4"] ?? 12;
  if (count >= 3) return paytable.scatter.freeSpins["3"] ?? 8;
  return 0;
}

function parseSpinInput(body: Record<string, unknown>, paytable: Paytable) {
  const activeLines = Math.min(
    paytable.lines.max,
    Math.max(1, Number(body.active_lines ?? body.numline ?? paytable.lines.max)),
  );

  let betTotalCentavos = Number(body.bet_total ?? body.betTotal ?? 0);
  if (!betTotalCentavos) {
    const betPerLine = Number(body.bet_per_line ?? body.betPerLine ?? 0);
    if (betPerLine) betTotalCentavos = Math.round(betPerLine * activeLines);
  }
  if (!betTotalCentavos) {
    const betReais = Number(body.betamount ?? body.bet_amount ?? 0);
    if (betReais) betTotalCentavos = reaisToCentavos(betReais);
  }

  return {
    activeLines,
    betTotalCentavos,
    betPerLineCentavos: Math.round(betTotalCentavos / activeLines),
  };
}

function validateBet(
  betTotalCentavos: number,
  betPerLineCentavos: number,
  activeLines: number,
  paytable: Paytable,
): string | null {
  if (betTotalCentavos < paytable.lines.minTotal || betTotalCentavos > paytable.lines.maxTotal) {
    return `Aposta entre R$${(paytable.lines.minTotal / 100).toFixed(2)} e R$${(paytable.lines.maxTotal / 100).toFixed(2)}`;
  }
  if (betPerLineCentavos < paytable.lines.minPerLine || betPerLineCentavos > paytable.lines.maxPerLine) {
    return "Aposta por linha inválida";
  }
  if (activeLines < 1 || activeLines > paytable.lines.max) return "Linhas inválidas";
  return null;
}

export async function handleLuckBridge(session: SessionWithRelations, body: Record<string, unknown>) {
  const action = String(body.action ?? "");
  const paytable = loadPaytable();
  const fsKey = session.sessionToken;

  if (action === "session" || action === "config") {
    const balance = await getWalletBalance(session.clientId, session.externalUserId, session.currency);
    const fs = freeSpinState.get(fsKey);
    const pendingBonus = getPendingBonus(fsKey);

    return {
      success: true,
      message: "Luck session loaded",
      data: {
        user_name: session.externalUserId,
        credit: balance,
        credit_centavos: reaisToCentavos(balance),
        currency_prefix: "R$",
        lines: paytable.lines,
        line_presets: paytable.lines.presets ?? [1, 5, 9, 15, 25],
        paylines: buildPaylineMeta(),
        payout_scale: paytable.payoutScale,
        jackpots: paytable.jackpots,
        wild: paytable.wild,
        scatter: paytable.scatter,
        cauldron_bonus: paytable.cauldronBonus,
        active_lines_default: paytable.lines.max,
        bet_per_line_presets: [5, 10, 15, 20, 25, 30, 40, 50],
        symbols: paytable.symbols,
        grid: { cols: 5, rows: 3 },
        free_spins_remaining: fs?.remaining ?? 0,
        bonus_multiplier: fs?.multiplier ?? 1,
        bonus_pending: !!pendingBonus,
        bonus_round_id: pendingBonus?.roundId ?? null,
        rules: [
          "Duende (Wild) substitui todos os símbolos exceto Scatter.",
          "3+ Potes de Ouro = Rodadas Grátis ×2 + Bônus Caldeirão.",
          "25 linhas de pagamento — opções: 1, 5, 9, 15 ou 25 linhas.",
          "Linha 1 = meio (células 6, 7, 8, 9, 10).",
          "No Bônus Caldeirão escolha 1 de 5 caldeirões — o melhor multiplica mais!",
        ],
      },
    };
  }

  if (action === "icons") {
    return { success: true, data: paytable.symbols, message: "List icons success" };
  }

  if (action === "bonus_pick") {
    const pending = getPendingBonus(fsKey);
    if (!pending) {
      return { success: false, message: "Nenhum bônus pendente ou expirado" };
    }

    const roundId = String(body.round_id ?? body.roundId ?? "");
    if (roundId !== pending.roundId) {
      return { success: false, message: "Rodada de bônus inválida" };
    }

    const pick = Number(body.pick ?? body.index ?? -1);
    if (!Number.isInteger(pick) || pick < 0 || pick >= pending.multipliers.length) {
      return { success: false, message: "Escolha inválida" };
    }

    pending.picked = true;
    const multiplier = pending.multipliers[pick] ?? 1;
    const winCentavos = Math.round(pending.baseBonusCentavos * multiplier);
    const winReais = centavosToReais(winCentavos);
    cauldronBonusState.delete(fsKey);

    const targetRtp = await resolveTargetRtpForSession(session);
    const spin = await processSpin({
      sessionToken: session.sessionToken,
      betAmount: 0,
      winAmount: winReais,
    });

    await commitSpinPayout({
      gameId: session.game.id,
      winAmount: winReais,
      targetRtpPct: targetRtp,
      clientId: session.clientId,
      rtpPoolMode: session.client.rtpPoolMode,
    });

    return {
      success: true,
      message: pick === pending.correctIndex ? "Caldeirão da sorte!" : "Bônus coletado!",
      data: {
        credit: spin.balance,
        pick,
        multiplier,
        win_centavos: winCentavos,
        win_reais: winReais,
        base_bonus_centavos: pending.baseBonusCentavos,
        /** Revelação só após escolha — seguro */
        reveal: {
          multipliers: pending.multipliers,
          best_index: pending.correctIndex,
          best_multiplier: pending.multipliers[pending.correctIndex] ?? multiplier,
        },
      },
    };
  }

  if (action === "spin") {
    const pendingBonus = getPendingBonus(fsKey);
    if (pendingBonus) {
      return { success: false, message: "Complete o Bônus Caldeirão antes de girar" };
    }
    const parsed = parseSpinInput(body, paytable);
    let { activeLines, betTotalCentavos, betPerLineCentavos } = parsed;
    const fs = freeSpinState.get(fsKey);
    const isFreeSpin = (fs?.remaining ?? 0) > 0;
    const bonusMult = isFreeSpin ? (fs?.multiplier ?? paytable.scatter.bonusMultiplier) : 1;

    if (isFreeSpin && fs) {
      activeLines = fs.activeLines;
      betPerLineCentavos = fs.betPerLineCentavos;
      betTotalCentavos = betPerLineCentavos * activeLines;
    } else {
      const err = validateBet(betTotalCentavos, betPerLineCentavos, activeLines, paytable);
      if (err) return { success: false, message: err };
    }

    const betReais = isFreeSpin ? 0 : centavosToReais(betTotalCentavos);
    const balance = await getWalletBalance(session.clientId, session.externalUserId, session.currency);
    if (!isFreeSpin && balance < betReais) {
      return { success: false, message: "Saldo insuficiente" };
    }

    const targetRtp = await resolveTargetRtpForSession(session);
    let grid: string[];
    let winCentavos = 0;
    let activeLineWins: ActiveLineWin[] = [];
    let scatterCount = 0;
    let maxPayCentavos = Infinity;

    if (isFreeSpin) {
      const stats = await getRtpStats({
        gameId: session.game.id,
        targetRtpPct: targetRtp,
        clientId: session.clientId,
        rtpPoolMode: session.client.rtpPoolMode,
      });
      const virtualBetReais = centavosToReais(betTotalCentavos);
      const availableReais = getAvailablePayoutPool(stats.prizePool, virtualBetReais, targetRtp);
      maxPayCentavos = reaisToCentavos(Math.max(availableReais, virtualBetReais * (targetRtp / 100)));

      const targetWin = Math.min(betPerLineCentavos * 15, maxPayCentavos);
      if (targetWin > 0 && crypto.randomInt(0, 1000) < 520) {
        const built = buildWinningGrid(targetWin, activeLines, betPerLineCentavos, paytable, bonusMult);
        grid = built.grid;
        winCentavos = Math.min(
          built.activeLines.reduce((s, l) => s + l.winCentavos, 0),
          maxPayCentavos,
        );
        activeLineWins = built.activeLines;
        scatterCount = built.scatterCount;
      } else {
        grid = fillGridAvoidingWins(activeLines, betPerLineCentavos, paytable);
        scatterCount = countScatters(grid);
      }
    } else {
      const decision = await resolveSpinDecision({
        gameId: session.game.id,
        betAmount: betReais,
        targetRtpPct: targetRtp,
        clientId: session.clientId,
        rtpPoolMode: session.client.rtpPoolMode,
      });

      maxPayCentavos = reaisToCentavos(decision.maxWinAmount);

      if (decision.shouldPay && decision.maxWinAmount > 0) {
        const built = buildWinningGrid(
          maxPayCentavos,
          activeLines,
          betPerLineCentavos,
          paytable,
        );
        grid = built.grid;
        winCentavos = Math.min(
          built.activeLines.reduce((s, l) => s + l.winCentavos, 0),
          maxPayCentavos,
        );
        activeLineWins = built.activeLines;
        scatterCount = built.scatterCount;
      } else {
        grid = fillGridAvoidingWins(activeLines, betPerLineCentavos, paytable);
        const ev = evaluateGrid(grid, activeLines, betPerLineCentavos, paytable);
        winCentavos = 0;
        activeLineWins = [];
        scatterCount = ev.scatterCount;
      }
    }

    let triggeredFreeSpins = 0;
    let cauldronBonus: CauldronBonusState | null = null;
    const triggerCount = paytable.scatter.cauldronTrigger ?? 3;

    if (scatterCount >= 3) {
      triggeredFreeSpins = scatterFreeSpins(scatterCount, paytable);
      const current = freeSpinState.get(fsKey);
      freeSpinState.set(fsKey, {
        remaining: (current?.remaining ?? 0) + triggeredFreeSpins,
        multiplier: paytable.scatter.bonusMultiplier,
        betPerLineCentavos,
        activeLines,
      });
    }

    if (scatterCount >= triggerCount) {
      cauldronBonus = createCauldronBonus(fsKey, betTotalCentavos, scatterCount, paytable);
      cauldronBonusState.set(fsKey, cauldronBonus);
    }

    if (isFreeSpin && fs) {
      fs.remaining -= 1;
      if (fs.remaining <= 0) freeSpinState.delete(fsKey);
      else freeSpinState.set(fsKey, fs);
    }

    const winReais = centavosToReais(winCentavos);

    const spin = await processSpin({
      sessionToken: session.sessionToken,
      betAmount: betReais,
      winAmount: winReais,
    });

    await commitSpinPayout({
      gameId: session.game.id,
      winAmount: winReais,
      targetRtpPct: targetRtp,
      clientId: session.clientId,
      rtpPoolMode: session.client.rtpPoolMode,
    });

    const fsAfter = freeSpinState.get(fsKey);

    return {
      success: true,
      message: cauldronBonus
        ? "Bônus Caldeirão!"
        : triggeredFreeSpins > 0
          ? "Bônus — Rodadas da Sorte!"
          : "Spin success",
      data: {
        bet: betReais,
        bet_centavos: betTotalCentavos,
        bet_per_line_centavos: betPerLineCentavos,
        active_lines: activeLines,
        credit: spin.balance,
        win_centavos: winCentavos,
        win_reais: winReais,
        free_spin: isFreeSpin,
        free_spins_remaining: fsAfter?.remaining ?? 0,
        free_spins_triggered: triggeredFreeSpins,
        scatter_count: scatterCount,
        bonus_multiplier: bonusMult,
        bonus_pending: !!cauldronBonus,
        bonus_round: cauldronBonus
          ? {
              round_id: cauldronBonus.roundId,
              cauldron_count: cauldronBonus.multipliers.length,
            }
          : null,
        pull: {
          WinAmount: winReais,
          SlotIcons: grid,
          ActiveLines: activeLineWins,
          Grid: grid,
        },
      },
    };
  }

  return { success: false, message: "Unknown action" };
}
