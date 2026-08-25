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
};

type ActiveLineWin = {
  line: number;
  symbol: string;
  symbolName: string;
  count: number;
  multiplier: number;
  winCentavos: number;
};

type SessionWithRelations = GameSession & { game: Game; client: Client };

const SYMBOL_IDS = [
  "host_man",
  "host_woman",
  "jet",
  "yacht",
  "mansion",
  "car",
  "ring",
  "cash",
  "camera",
  "clapper",
] as const;

let paytableCache: Paytable | null = null;
let paylinesCache: number[][] | null = null;

function loadPaytable(): Paytable {
  if (paytableCache) return paytableCache;
  const file = path.join(resolveGamesDir(), "tv-milionario", "config", "paytable.json");
  paytableCache = JSON.parse(fs.readFileSync(file, "utf8")) as Paytable;
  return paytableCache;
}

function loadPaylines(): number[][] {
  if (paylinesCache) return paylinesCache;
  const file = path.join(resolveGamesDir(), "tv-milionario", "config", "paylines.json");
  paylinesCache = (JSON.parse(fs.readFileSync(file, "utf8")) as { lines: number[][] }).lines;
  return paylinesCache;
}

function centavosToReais(centavos: number): number {
  return Math.round(centavos) / 100;
}

function reaisToCentavos(reais: number): number {
  return Math.round(reais * 100);
}

function cellIndex(col: number, row: number): number {
  return row * 5 + col;
}

function buildPaylineMeta() {
  return loadPaylines().map((pattern, idx) => ({
    line: idx + 1,
    rows: pattern,
    cells: pattern.map((row, col) => cellIndex(col, row) + 1),
  }));
}

function getScaleFactor(betPerLineCentavos: number, paytable: Paytable): number {
  return betPerLineCentavos >= paytable.payoutScale.fullScaleMinBetPerLine
    ? 1
    : paytable.payoutScale.lowScaleFactor;
}

function getMultiplier(symbol: PaytableSymbol, count: number): number {
  if (count >= 5) return symbol.win_5;
  if (count === 4) return symbol.win_4;
  if (count === 3) return symbol.win_3;
  return 0;
}

function evaluateGrid(
  grid: string[],
  activeLineCount: number,
  betPerLineCentavos: number,
  paytable: Paytable,
): { totalWinCentavos: number; activeLines: ActiveLineWin[] } {
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

    const winCentavos = Math.round(betPerLineCentavos * multiplier * scale);
    activeLines.push({
      line: lineIdx + 1,
      symbol: first,
      symbolName: sym.name,
      count,
      multiplier,
      winCentavos,
    });
  }

  const totalWinCentavos = activeLines.reduce((sum, l) => sum + l.winCentavos, 0);
  return { totalWinCentavos, activeLines };
}

function randomSymbol(): string {
  const idx = crypto.randomInt(0, SYMBOL_IDS.length);
  return SYMBOL_IDS[idx] ?? "clapper";
}

function generateRandomGrid(): string[] {
  return Array.from({ length: 15 }, () => randomSymbol());
}

function fillGridAvoidingWins(
  activeLineCount: number,
  betPerLineCentavos: number,
  paytable: Paytable,
): string[] {
  for (let attempt = 0; attempt < 40; attempt++) {
    const candidate = generateRandomGrid();
    const { totalWinCentavos } = evaluateGrid(candidate, activeLineCount, betPerLineCentavos, paytable);
    if (totalWinCentavos === 0) return candidate;
  }
  return generateRandomGrid();
}

function applyWinToGrid(
  grid: string[],
  linePattern: number[],
  symbolId: string,
  count: number,
): void {
  for (let col = 0; col < count; col++) {
    const row = linePattern[col];
    if (row === undefined) break;
    grid[cellIndex(col, row)] = symbolId;
  }
}

function buildWinningGrid(
  targetWinCentavos: number,
  activeLineCount: number,
  betPerLineCentavos: number,
  paytable: Paytable,
): { grid: string[]; activeLines: ActiveLineWin[] } {
  const paylines = loadPaylines();

  type Candidate = { lineIdx: number; symbol: PaytableSymbol; count: 3 | 4 | 5; winCentavos: number };
  const candidates: Candidate[] = [];

  for (let lineIdx = 0; lineIdx < activeLineCount; lineIdx++) {
    for (const symbol of paytable.symbols) {
      for (const count of [3, 4, 5] as const) {
        const multiplier = getMultiplier(symbol, count);
        const winCentavos = Math.round(betPerLineCentavos * multiplier * getScaleFactor(betPerLineCentavos, paytable));
        if (winCentavos > 0 && winCentavos <= targetWinCentavos) {
          candidates.push({ lineIdx, symbol, count, winCentavos });
        }
      }
    }
  }

  candidates.sort((a, b) => b.winCentavos - a.winCentavos);

  const grid = generateRandomGrid();
  let placedWinCentavos = 0;
  const usedLines = new Set<number>();

  for (const cand of candidates) {
    if (usedLines.has(cand.lineIdx)) continue;
    if (placedWinCentavos + cand.winCentavos > targetWinCentavos) continue;

    const pattern = paylines[cand.lineIdx];
    if (!pattern) continue;

    applyWinToGrid(grid, pattern, cand.symbol.id, cand.count);
    usedLines.add(cand.lineIdx);
    placedWinCentavos += cand.winCentavos;

    if (placedWinCentavos >= targetWinCentavos * 0.85) break;
  }

  if (placedWinCentavos === 0 && candidates.length > 0) {
    const best = candidates[0]!;
    const pattern = paylines[best.lineIdx];
    if (pattern) {
      applyWinToGrid(grid, pattern, best.symbol.id, best.count);
    }
  }

  const evaluated = evaluateGrid(grid, activeLineCount, betPerLineCentavos, paytable);
  return { grid, activeLines: evaluated.activeLines };
}

function parseSpinInput(body: Record<string, unknown>, paytable: Paytable) {
  const activeLines = Math.min(
    paytable.lines.max,
    Math.max(1, Number(body.active_lines ?? body.numline ?? body.num_line ?? paytable.lines.max)),
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

  const betPerLineCentavos = Math.round(betTotalCentavos / activeLines);

  return { activeLines, betTotalCentavos, betPerLineCentavos };
}

function validateBet(
  betTotalCentavos: number,
  betPerLineCentavos: number,
  activeLines: number,
  paytable: Paytable,
): string | null {
  if (betTotalCentavos < paytable.lines.minTotal || betTotalCentavos > paytable.lines.maxTotal) {
    return `Aposta total deve ser entre ${paytable.lines.minTotal} e ${paytable.lines.maxTotal} centavos`;
  }
  if (betPerLineCentavos < paytable.lines.minPerLine || betPerLineCentavos > paytable.lines.maxPerLine) {
    return `Aposta por linha deve ser entre ${paytable.lines.minPerLine} e ${paytable.lines.maxPerLine} centavos`;
  }
  if (betTotalCentavos !== betPerLineCentavos * activeLines) {
    return "Aposta total deve ser divisível pelas linhas ativas";
  }
  if (activeLines < 1 || activeLines > paytable.lines.max) {
    return `Linhas ativas deve ser entre 1 e ${paytable.lines.max}`;
  }
  return null;
}

export async function handleTvMilionarioBridge(
  session: SessionWithRelations,
  body: Record<string, unknown>,
) {
  const action = String(body.action ?? "");
  const paytable = loadPaytable();

  if (action === "session" || action === "config") {
    const balance = await getWalletBalance(
      session.clientId,
      session.externalUserId,
      session.currency,
    );

    return {
      success: true,
      message: "TV Milionário session loaded",
      data: {
        user_name: session.externalUserId,
        credit: balance,
        credit_centavos: reaisToCentavos(balance),
        currency: session.currency,
        currency_prefix: "R$",
        currency_suffix: "",
        currency_thousand: ".",
        currency_decimal: ",",
        bet_unit: "centavos",
        lines: paytable.lines,
        line_presets: paytable.lines.presets ?? [1, 5, 10, 15, 20, 25],
        paylines: buildPaylineMeta(),
        payout_scale: paytable.payoutScale,
        jackpots: paytable.jackpots,
        formula: paytable.formula,
        active_lines_default: paytable.lines.max,
        bet_presets_centavos: [125, 250, 500, 750, 1000],
        bet_per_line_presets: [5, 10, 15, 20, 25, 30, 35, 40],
        symbols: paytable.symbols,
        grid: { cols: 5, rows: 3 },
        rules: [
          "25 linhas de pagamento — da esquerda para a direita.",
          "Linha 1 = fileira do meio (células 6–10).",
          "Prêmio = aposta por linha × multiplicador × escala.",
          "Escala cheia (×1) com aposta/linha ≥ 10 centavos.",
        ],
      },
    };
  }

  if (action === "icons") {
    return {
      success: true,
      message: "List icons success",
      data: paytable.symbols.map((s) => ({
        icon_name: s.id,
        name: s.name,
        win_3: s.win_3,
        win_4: s.win_4,
        win_5: s.win_5,
      })),
    };
  }

  if (action === "spin") {
    const { activeLines, betTotalCentavos, betPerLineCentavos } = parseSpinInput(body, paytable);
    const validationError = validateBet(betTotalCentavos, betPerLineCentavos, activeLines, paytable);
    if (validationError) {
      return { success: false, message: validationError };
    }

    const betReais = centavosToReais(betTotalCentavos);
    const balance = await getWalletBalance(
      session.clientId,
      session.externalUserId,
      session.currency,
    );

    if (balance < betReais) {
      return { success: false, message: "Insufficient balance" };
    }

    const targetRtp = await resolveTargetRtpForSession(session);
    const scale = getScaleFactor(betPerLineCentavos, paytable);

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
      const maxWinCentavos = reaisToCentavos(decision.maxWinAmount);
      const built = buildWinningGrid(maxWinCentavos, activeLines, betPerLineCentavos, paytable);
      grid = built.grid;
      activeLineWins = built.activeLines;
      winCentavos = activeLineWins.reduce((s, l) => s + l.winCentavos, 0);
    } else {
      grid = fillGridAvoidingWins(activeLines, betPerLineCentavos, paytable);
    }

    const winReais = centavosToReais(winCentavos);

    const spin = await processSpin({
      sessionToken: session.sessionToken,
      betAmount: betReais,
      winAmount: winReais,
    });

    const rtpCommit = await commitSpinPayout({
      gameId: session.game.id,
      winAmount: winReais,
      targetRtpPct: targetRtp,
      clientId: session.clientId,
      rtpPoolMode: session.client.rtpPoolMode,
    });

    return {
      success: true,
      message: "Spin success",
      data: {
        bet: betReais,
        bet_centavos: betTotalCentavos,
        bet_per_line_centavos: betPerLineCentavos,
        active_lines: activeLines,
        scale,
        credit: spin.balance,
        credit_centavos: reaisToCentavos(spin.balance),
        win_centavos: winCentavos,
        win_reais: winReais,
        pull: {
          WinAmount: winReais,
          WinAmountCentavos: winCentavos,
          SlotIcons: grid,
          ActiveLines: activeLineWins.map((l) => ({
            line: l.line,
            symbol: l.symbol,
            symbol_name: l.symbolName,
            count: l.count,
            multiplier: l.multiplier,
            win_centavos: l.winCentavos,
            win_reais: centavosToReais(l.winCentavos),
          })),
          Grid: grid,
        },
        fees: spin.fees,
        rtp: {
          targetPct: targetRtp,
          actualPct: rtpCommit.actualRtpPct,
          drift: rtpCommit.drift,
          poolMode: rtpCommit.poolMode,
        },
      },
    };
  }

  return { success: false, message: "Unknown action" };
}
