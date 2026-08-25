import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Game, GameSession, Client } from "../../generated/prisma/client.js";
import { resolveGamesDir } from "./game.service.js";
import { getWalletBalance } from "./player-wallet.service.js";
import { processSpin } from "./session.service.js";
import { commitSpinPayout, resolveSpinDecision } from "./rtp-pool.service.js";
import { resolveTargetRtpForSession } from "./client-game-config.service.js";

type PaytableSymbol = {
  id: string;
  name: string;
  win_3: number;
  win_4: number;
  win_5: number;
};

type Paytable = {
  symbols: PaytableSymbol[];
  lines: {
    max: number;
    minPerLine: number;
    maxPerLine: number;
    minTotal: number;
    maxTotal: number;
    presets?: number[];
  };
  payoutScale: { fullScaleMinBetPerLine: number; lowScaleFactor: number };
  formula?: string;
  jackpots: {
    fullScale: { grand: number; major: number; minor: number };
    lowScale: { grand: number; major: number; minor: number };
  };
  double?: { enabled: boolean; winChancePct: number };
};

type ActiveLineWin = {
  line: number;
  symbol: string;
  symbolName: string;
  count: number;
  multiplier: number;
  winCentavos: number;
};

type DoublePending = {
  winCentavos: number;
  expiresAt: number;
};

type SessionWithRelations = GameSession & { game: Game; client: Client };

const GAME_SLUG = "halloween-slots";
const DOUBLE_TTL_MS = 2 * 60 * 1000;

const SYMBOL_IDS = [
  "witch",
  "pumpkin",
  "ghost",
  "bat",
  "skull",
  "spider",
  "black_cat",
  "full_moon",
  "candle",
  "candy",
] as const;

const doublePending = new Map<string, DoublePending>();

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

function centavosToReais(centavos: number) {
  return Math.round(centavos) / 100;
}

function reaisToCentavos(reais: number) {
  return Math.round(reais * 100);
}

function cellIndex(col: number, row: number) {
  return row * 5 + col;
}

function buildPaylineMeta() {
  return loadPaylines().map((pattern, idx) => ({
    line: idx + 1,
    rows: pattern,
    cells: pattern.map((row, col) => cellIndex(col, row) + 1),
  }));
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

function getDoublePending(sessionToken: string): DoublePending | null {
  const p = doublePending.get(sessionToken);
  if (!p) return null;
  if (p.expiresAt < Date.now()) {
    doublePending.delete(sessionToken);
    return null;
  }
  return p;
}

function evaluateGrid(
  grid: string[],
  activeLineCount: number,
  betPerLineCentavos: number,
  paytable: Paytable,
) {
  const paylines = loadPaylines();
  const scale = getScaleFactor(betPerLineCentavos, paytable);
  const symbolMap = new Map(paytable.symbols.map((s) => [s.id, s]));
  const activeLines: ActiveLineWin[] = [];

  for (let lineIdx = 0; lineIdx < activeLineCount; lineIdx++) {
    const pattern = paylines[lineIdx];
    if (!pattern) continue;

    const symbols = pattern.map((row, col) => grid[cellIndex(col, row)] ?? "");
    const first = symbols[0];
    if (!first) continue;

    let count = 1;
    for (let col = 1; col < 5; col++) {
      if (symbols[col] === first) count++;
      else break;
    }

    if (count < 3) continue;

    const sym = symbolMap.get(first);
    if (!sym) continue;

    const multiplier = getMultiplier(sym, count);
    if (multiplier <= 0) continue;

    activeLines.push({
      line: lineIdx + 1,
      symbol: first,
      symbolName: sym.name,
      count,
      multiplier,
      winCentavos: Math.round(betPerLineCentavos * multiplier * scale),
    });
  }

  return {
    totalWinCentavos: activeLines.reduce((s, l) => s + l.winCentavos, 0),
    activeLines,
  };
}

function randomSymbol() {
  return SYMBOL_IDS[crypto.randomInt(0, SYMBOL_IDS.length)] ?? "candy";
}

function generateRandomGrid() {
  return Array.from({ length: 15 }, () => randomSymbol());
}

function fillGridAvoidingWins(
  activeLineCount: number,
  betPerLineCentavos: number,
  paytable: Paytable,
) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const candidate = generateRandomGrid();
    const { totalWinCentavos } = evaluateGrid(candidate, activeLineCount, betPerLineCentavos, paytable);
    if (totalWinCentavos === 0) return candidate;
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
) {
  const paylines = loadPaylines();

  type Candidate = { lineIdx: number; symbol: PaytableSymbol; count: 3 | 4 | 5; winCentavos: number };
  const candidates: Candidate[] = [];

  for (let lineIdx = 0; lineIdx < activeLineCount; lineIdx++) {
    for (const symbol of paytable.symbols) {
      for (const count of [3, 4, 5] as const) {
        const winCentavos = Math.round(
          betPerLineCentavos * getMultiplier(symbol, count) * getScaleFactor(betPerLineCentavos, paytable),
        );
        if (winCentavos > 0 && winCentavos <= targetWinCentavos) {
          candidates.push({ lineIdx, symbol, count, winCentavos });
        }
      }
    }
  }

  candidates.sort((a, b) => b.winCentavos - a.winCentavos);
  const grid = generateRandomGrid();
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

  const evaluated = evaluateGrid(grid, activeLineCount, betPerLineCentavos, paytable);
  return { grid, activeLines: evaluated.activeLines };
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

export async function handleHalloweenSlotsBridge(
  session: SessionWithRelations,
  body: Record<string, unknown>,
) {
  const action = String(body.action ?? "");
  const paytable = loadPaytable();
  const fsKey = session.sessionToken;
  const targetRtp = await resolveTargetRtpForSession(session);

  if (action === "session" || action === "config") {
    const balance = await getWalletBalance(session.clientId, session.externalUserId, session.currency);
    const pending = getDoublePending(fsKey);

    return {
      success: true,
      message: "Halloween Slots session loaded",
      data: {
        user_name: session.externalUserId,
        credit: balance,
        credit_centavos: reaisToCentavos(balance),
        currency_prefix: "R$",
        lines: paytable.lines,
        line_presets: paytable.lines.presets ?? [1, 5, 10, 15, 20, 25, 30],
        paylines: buildPaylineMeta(),
        payout_scale: paytable.payoutScale,
        jackpots: paytable.jackpots,
        double: paytable.double,
        active_lines_default: paytable.lines.max,
        bet_per_line_presets: [5, 10, 15, 20, 25, 30, 35, 40],
        symbols: paytable.symbols,
        grid: { cols: 5, rows: 3 },
        can_double: !!pending,
        double_amount_centavos: pending?.winCentavos ?? 0,
        rules: [
          "30 linhas de pagamento — escolha 1 a 30 linhas.",
          "Linha 1 = fileira do meio (células 6–10).",
          "3+ símbolos iguais da esquerda para direita em uma linha = prêmio.",
          "Após ganhar, use DOBRAR para arriscar o prêmio (50% chance ×2).",
          "Jackpots pagam com aposta mínima por linha ≥ 10 centavos.",
        ],
      },
    };
  }

  if (action === "icons") {
    return { success: true, data: paytable.symbols, message: "List icons success" };
  }

  if (action === "collect") {
    doublePending.delete(fsKey);
    return { success: true, message: "Prêmio confirmado", data: { can_double: false } };
  }

  if (action === "double") {
    const pending = getDoublePending(fsKey);
    if (!pending) return { success: false, message: "Nenhum prêmio para dobrar" };

    doublePending.delete(fsKey);
    const winReais = centavosToReais(pending.winCentavos);
    const chance = paytable.double?.winChancePct ?? 50;
    const won = crypto.randomInt(0, 100) < chance;

    const spin = await processSpin({
      sessionToken: fsKey,
      betAmount: won ? 0 : winReais,
      winAmount: won ? winReais : 0,
    });

    await commitSpinPayout({
      gameId: session.game.id,
      winAmount: won ? winReais : 0,
      targetRtpPct: targetRtp,
      clientId: session.clientId,
      rtpPoolMode: session.client.rtpPoolMode,
    });

    return {
      success: true,
      message: won ? "Dobrou!" : "Perdeu o prêmio",
      data: {
        won,
        credit: spin.balance,
        extra_centavos: won ? pending.winCentavos : -pending.winCentavos,
        can_double: false,
      },
    };
  }

  if (action === "spin") {
    if (getDoublePending(fsKey)) {
      return { success: false, message: "Dobre ou confirme o prêmio antes de girar" };
    }

    const parsed = parseSpinInput(body, paytable);
    const { activeLines, betTotalCentavos, betPerLineCentavos } = parsed;
    const err = validateBet(betTotalCentavos, betPerLineCentavos, activeLines, paytable);
    if (err) return { success: false, message: err };

    const betReais = centavosToReais(betTotalCentavos);
    const balance = await getWalletBalance(session.clientId, session.externalUserId, session.currency);
    if (balance < betReais) return { success: false, message: "Saldo insuficiente" };

    const decision = await resolveSpinDecision({
      gameId: session.game.id,
      betAmount: betReais,
      targetRtpPct: targetRtp,
      clientId: session.clientId,
      rtpPoolMode: session.client.rtpPoolMode,
    });

    let grid: string[];
    let winCentavos = 0;
    let activeLineWins: ActiveLineWin[] = [];

    if (decision.shouldPay && decision.maxWinAmount > 0) {
      const built = buildWinningGrid(
        reaisToCentavos(decision.maxWinAmount),
        activeLines,
        betPerLineCentavos,
        paytable,
      );
      grid = built.grid;
      activeLineWins = built.activeLines;
      winCentavos = activeLineWins.reduce((s, l) => s + l.winCentavos, 0);
    } else {
      grid = fillGridAvoidingWins(activeLines, betPerLineCentavos, paytable);
    }

    const winReais = centavosToReais(winCentavos);
    const spin = await processSpin({
      sessionToken: fsKey,
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

    const canDouble = winCentavos > 0 && (paytable.double?.enabled ?? true);
    if (canDouble) {
      doublePending.set(fsKey, { winCentavos, expiresAt: Date.now() + DOUBLE_TTL_MS });
    }

    return {
      success: true,
      message: winCentavos > 0 ? "Ganhou!" : "Spin success",
      data: {
        bet: betReais,
        bet_centavos: betTotalCentavos,
        bet_per_line_centavos: betPerLineCentavos,
        active_lines: activeLines,
        credit: spin.balance,
        win_centavos: winCentavos,
        win_reais: winReais,
        can_double: canDouble,
        double_amount_centavos: canDouble ? winCentavos : 0,
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
