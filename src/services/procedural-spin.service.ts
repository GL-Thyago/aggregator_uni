import crypto from "node:crypto";
import {
  evaluateSinglePayline,
  type IconPaytable,
} from "./icon-payout.service.js";
import {
  buildTemplateActiveLines,
  loadSpinTemplates,
  pickLoseTemplate,
  shuffleSlotIcons,
  type SpinLine,
  type SpinTemplate,
  type TemplateFile,
} from "./spin-templates.service.js";
import { pickWeightedWinTemplate, shuffleGridVariety } from "./slot-math.service.js";

/** 5 linhas fixas dos Fortune 3×3 (PG Soft). index = ID visual no Construct (payline_01..05). */
const FORTUNE_3X3_PAYLINES: PaylineDef[] = [
  { positions: [4, 5, 6], combine: 3, lineIndex: 1 },
  { positions: [1, 2, 3], combine: 3, lineIndex: 2 },
  { positions: [7, 8, 9], combine: 3, lineIndex: 3 },
  { positions: [1, 5, 9], combine: 3, lineIndex: 4 },
  { positions: [7, 5, 3], combine: 3, lineIndex: 5 },
];

const FORTUNE_3X3_LINE_INDEX = new Map(
  FORTUNE_3X3_PAYLINES.map((line) => [line.positions.join(","), line.lineIndex]),
);

const MAX_GENERATION_RETRIES = 40;

const paylineCache = new Map<string, PaylineDef[]>();

export type PaylineDef = {
  positions: number[];
  combine: number;
  /** ID da linha no cliente Construct (LineActiveAt / payline_0N). */
  lineIndex: number;
};

export type ProceduralSpinResult = {
  slotIcons: string[];
  activeIcons: number[];
  activeLines: SpinLine[];
  dropLineData: unknown[];
  multiplyCount: number;
  winAmount: number;
};

function randomInt(max: number): number {
  return crypto.randomInt(0, max);
}

function pickRandom<T>(items: readonly T[]): T {
  return items[randomInt(items.length)]!;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function pickLoseSymbol(pool: string[]): string {
  return pool[randomInt(pool.length)]!;
}

function buildLoseGrid(
  gridSize: number,
  paylines: PaylineDef[],
  paytable: IconPaytable,
  symbolPool: string[],
  cpl: number,
  amount: number,
): string[] {
  for (let i = 0; i < 60; i++) {
    const grid = Array.from({ length: gridSize }, () => pickLoseSymbol(symbolPool));
    if (evaluateAllPaylines(grid, paylines, paytable, cpl, amount).winAmount === 0) {
      return grid;
    }
  }

  const fallback = pickLoseTemplate([]);
  return padGrid(fallback.slotIcons, gridSize);
}

function payingSymbols(paytable: IconPaytable): string[] {
  const out: string[] = [];
  for (const [name, icon] of paytable) {
    if (icon.wild_card) continue;
    if (icon.win_3 > 0 || icon.win_4 > 0 || icon.win_5 > 0) out.push(name);
  }
  return out.sort();
}

function wildSymbols(paytable: IconPaytable): string[] {
  const out: string[] = [];
  for (const [name, icon] of paytable) {
    if (icon.wild_card || (icon.win_3 === 0 && icon.win_4 === 0 && icon.win_5 === 0)) {
      out.push(name);
    }
  }
  return out.length ? out : ["Symbol_0", "Symbol_1"];
}

function getOrderedPaylines(assetPath: string, gridSize: number): PaylineDef[] {
  if (gridSize === 9) return [...FORTUNE_3X3_PAYLINES];
  return extractPaylines(assetPath, gridSize).sort((a, b) => a.lineIndex - b.lineIndex);
}

function getGridSize(templates: TemplateFile): number {
  let size = 9;
  for (const t of [...templates.win, ...templates.lose]) {
    size = Math.max(size, t.slotIcons.length);
    for (const line of t.activeLines) {
      for (const pos of line.active_icon) {
        size = Math.max(size, pos);
      }
    }
  }
  return size;
}

function padGrid(grid: string[], gridSize: number): string[] {
  if (grid.length >= gridSize) return grid.slice(0, gridSize);
  return [...grid, ...Array.from({ length: gridSize - grid.length }, () => "_blank")];
}

export function extractPaylines(assetPath: string, gridSize: number): PaylineDef[] {
  const cached = paylineCache.get(assetPath);
  if (cached) return cached;

  const templates = loadSpinTemplates(assetPath);
  const map = new Map<string, PaylineDef>();

  for (const win of templates.win) {
    for (const line of win.activeLines) {
      if (!line.active_icon.length) continue;
      const positions = [...line.active_icon].sort((a, b) => a - b);
      const key = positions.join(",");
      if (!map.has(key)) {
        map.set(key, {
          positions: line.active_icon,
          combine: line.combine || line.active_icon.length,
          lineIndex: line.index,
        });
      }
    }
  }

  if (gridSize === 9) {
    for (const line of FORTUNE_3X3_PAYLINES) {
      const key = line.positions.join(",");
      if (!map.has(key)) map.set(key, line);
    }
  }

  const lines = [...map.values()].map((line) => {
    if (gridSize !== 9) return line;
    const canonical = FORTUNE_3X3_LINE_INDEX.get(line.positions.join(","));
    return canonical !== undefined ? { ...line, lineIndex: canonical } : line;
  });
  paylineCache.set(assetPath, lines);
  return lines;
}

/** Percorre cada linha sequencialmente (1→N) e soma todos os prêmios. */
export function evaluateAllPaylines(
  grid: string[],
  paylines: PaylineDef[],
  paytable: IconPaytable,
  cpl: number,
  amount: number,
): { winAmount: number; activeLines: SpinLine[] } {
  const activeLines: SpinLine[] = [];

  for (const payline of paylines) {
    const result = evaluateSinglePayline(
      grid,
      payline.positions,
      payline.combine,
      paytable,
      cpl,
      amount,
    );
    if (!result) continue;

    activeLines.push({
      index: payline.lineIndex,
      name: result.payingSymbol,
      combine: payline.combine,
      way_243: 1,
      payout: result.payout,
      multiply: 0,
      win_amount: result.winAmount,
      active_icon: [...payline.positions],
    });
  }

  activeLines.sort((a, b) => a.index - b.index);
  const winAmount = roundMoney(activeLines.reduce((sum, line) => sum + line.win_amount, 0));

  return { winAmount, activeLines };
}

/** Posições vencedoras — brilho no Construct usa ActiveIcons, não todas as células. */
function winningActiveIcons(activeLines: SpinLine[]): number[] {
  return [...new Set(activeLines.flatMap((line) => line.active_icon))].sort((a, b) => a - b);
}

function buildSymbolPool(paying: string[], wilds: string[]): string[] {
  const pool: string[] = [];
  for (const symbol of paying) {
    pool.push(symbol, symbol, symbol, symbol, symbol, symbol, symbol, symbol, symbol);
  }
  for (const wild of wilds) {
    pool.push(wild);
  }
  return pool;
}

function buildRandomGrid(gridSize: number, pool: string[]): string[] {
  return Array.from({ length: gridSize }, () => pickRandom(pool));
}

function toSpinResult(
  grid: string[],
  gridSize: number,
  paylines: PaylineDef[],
  paytable: IconPaytable,
  cpl: number,
  amount: number,
): ProceduralSpinResult {
  const padded = padGrid(grid, gridSize);
  const { winAmount, activeLines } = evaluateAllPaylines(padded, paylines, paytable, cpl, amount);

  return {
    slotIcons: padded,
    activeIcons: winAmount > 0 ? winningActiveIcons(activeLines) : [],
    activeLines,
    dropLineData: [],
    multiplyCount: 0,
    winAmount,
  };
}

/** Converte template PHP/JSON curado — prêmio via template.payout (igual spin.php). */
function templateToSpinResult(
  template: SpinTemplate,
  gridSize: number,
  paytable: IconPaytable,
  paylines: PaylineDef[],
  cpl: number,
  amount: number,
  shuffleIcons: boolean,
  symbolPool: string[] = [],
): ProceduralSpinResult {
  let icons = template.slotIcons.map((s) => s.split(":")[0] ?? s);
  if (shuffleIcons) {
    for (let attempt = 0; attempt < 20; attempt++) {
      icons = shuffleSlotIcons(template.slotIcons.map((s) => s.split(":")[0] ?? s));
      const padded = padGrid(icons, gridSize);
      const checked = evaluateAllPaylines(padded, paylines, paytable, cpl, amount);
      if (checked.winAmount === 0) break;
    }
  }

  let padded = padGrid(icons, gridSize);
  const { winAmount, activeLines } = buildTemplateActiveLines(
    { ...template, slotIcons: padded },
    cpl,
    amount,
  );

  const frozen = new Set(activeLines.flatMap((l) => l.active_icon));
  if (winAmount > 0 && frozen.size > 0) {
    padded = shuffleGridVariety(padded, frozen, symbolPool);
    const rechecked = evaluateAllPaylines(padded, paylines, paytable, cpl, amount);
    if (rechecked.winAmount === winAmount || rechecked.winAmount === 0) {
      if (rechecked.winAmount === winAmount) {
        return {
          slotIcons: padded,
          activeIcons: winningActiveIcons(rechecked.activeLines),
          activeLines: rechecked.activeLines.map((line, i) => ({
            ...line,
            win_amount: i === 0 ? winAmount : 0,
          })),
          dropLineData: template.dropLineData ?? [],
          multiplyCount: template.multiplyCount ?? 0,
          winAmount,
        };
      }
    }
  }

  const activeIcons =
    winAmount > 0
      ? template.activeIcons.length > 0
        ? template.activeIcons
        : winningActiveIcons(activeLines)
      : [];

  return {
    slotIcons: padded,
    activeIcons,
    activeLines,
    dropLineData: template.dropLineData ?? [],
    multiplyCount: template.multiplyCount ?? 0,
    winAmount,
  };
}

function generateLoseSpin(input: {
  assetPath: string;
  paytable: IconPaytable;
  cpl: number;
  amount: number;
}): ProceduralSpinResult {
  const templates = loadSpinTemplates(input.assetPath);
  const gridSize = getGridSize(templates);
  const paylines = getOrderedPaylines(input.assetPath, gridSize);
  const pool = buildSymbolPool(payingSymbols(input.paytable), wildSymbols(input.paytable));
  const loseTemplate = pickLoseTemplate(templates.lose);
  return templateToSpinResult(
    loseTemplate,
    gridSize,
    input.paytable,
    paylines,
    input.cpl,
    input.amount,
    true,
    pool,
  );
}

function generateFromTemplates(input: {
  assetPath: string;
  paytable: IconPaytable;
  cpl: number;
  amount: number;
  shouldPay: boolean;
  maxWinAmount: number;
}): ProceduralSpinResult | null {
  const templates = loadSpinTemplates(input.assetPath);
  if (templates.win.length === 0 && templates.lose.length === 0) return null;

  const gridSize = getGridSize(templates);
  const paylines = getOrderedPaylines(input.assetPath, gridSize);
  const pool = buildSymbolPool(payingSymbols(input.paytable), wildSymbols(input.paytable));

  if (!input.shouldPay || input.maxWinAmount <= 0) {
    return generateLoseSpin(input);
  }

  const winTemplate = pickWeightedWinTemplate(
    templates.win,
    input.cpl,
    input.amount,
    input.maxWinAmount,
  );

  if (winTemplate) {
    return templateToSpinResult(
      winTemplate,
      gridSize,
      input.paytable,
      paylines,
      input.cpl,
      input.amount,
      false,
      pool,
    );
  }

  return generateLoseSpin(input);
}

function generateRandomFallback(input: {
  assetPath: string;
  paytable: IconPaytable;
  cpl: number;
  amount: number;
  shouldPay: boolean;
  maxWinAmount: number;
}): ProceduralSpinResult {
  const { assetPath, paytable, cpl, amount, shouldPay, maxWinAmount } = input;
  const templates = loadSpinTemplates(assetPath);
  const gridSize = getGridSize(templates);
  const paylines = getOrderedPaylines(assetPath, gridSize);
  const paying = payingSymbols(paytable);
  const wilds = wildSymbols(paytable);
  const pool = buildSymbolPool(paying, wilds);

  if (shouldPay && maxWinAmount > 0) {
    for (let attempt = 0; attempt < MAX_GENERATION_RETRIES; attempt++) {
      const result = toSpinResult(buildRandomGrid(gridSize, pool), gridSize, paylines, paytable, cpl, amount);
      if (result.winAmount > 0 && result.winAmount <= maxWinAmount) {
        return result;
      }
    }
  }

  for (let attempt = 0; attempt < MAX_GENERATION_RETRIES; attempt++) {
    const result = toSpinResult(buildRandomGrid(gridSize, pool), gridSize, paylines, paytable, cpl, amount);
    if (result.winAmount === 0) return result;
  }

  return toSpinResult(
    buildLoseGrid(gridSize, paylines, paytable, pool, cpl, amount),
    gridSize,
    paylines,
    paytable,
    cpl,
    amount,
  );
}

export function generateProceduralSpin(input: {
  assetPath: string;
  paytable: IconPaytable;
  cpl: number;
  amount: number;
  bet: number;
  shouldPay: boolean;
  maxWinAmount: number;
}): ProceduralSpinResult {
  const fromTemplates = generateFromTemplates(input);
  if (fromTemplates) return fromTemplates;
  return generateRandomFallback(input);
}

export function proceduralSpinToTemplate(result: ProceduralSpinResult): SpinTemplate {
  return {
    slotIcons: result.slotIcons,
    activeIcons: result.activeIcons,
    activeLines: result.activeLines,
    dropLineData: result.dropLineData,
    multiplyCount: result.multiplyCount,
    payout: result.activeLines.reduce((sum, line) => sum + line.payout, 0),
  };
}

/** Grid inicial/perda para sessão — sempre template de perda embaralhado. */
export function generateSessionGrid(assetPath: string): string[] {
  const templates = loadSpinTemplates(assetPath);
  const lose = pickLoseTemplate(templates.lose);
  return shuffleSlotIcons(lose.slotIcons.map((s) => s.split(":")[0] ?? s));
}

/** @deprecated use generateProceduralSpin */
export const generateFortuneTigerSpin = generateProceduralSpin;
