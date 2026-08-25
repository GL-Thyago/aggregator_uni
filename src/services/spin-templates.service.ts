import fs from "node:fs";
import path from "node:path";
import { resolveGamesDir } from "./game.service.js";
import {
  calcLineWin,
  getSymbolPayout,
  resolvePayingSymbol,
  type IconPaytable,
} from "./icon-payout.service.js";

export type SpinLine = {
  index: number;
  name: string;
  combine: number;
  way_243: number;
  payout: number;
  multiply: number;
  win_amount: number;
  active_icon: number[];
};

export type SpinTemplate = {
  slotIcons: string[];
  activeIcons: number[];
  activeLines: SpinLine[];
  dropLineData: unknown[];
  multiplyCount: number;
  payout: number;
  freeSpin?: number;
};

type TemplateFile = { win: SpinTemplate[]; lose: SpinTemplate[] };

export type { TemplateFile };

const cache = new Map<string, TemplateFile>();

function phpAssocToJson(text: string): string {
  return text
    .replace(/"([^"]+)"\s*=>/g, '"$1":')
    .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*=>/g, '$1"$2":')
    .replace(/,\s*]/g, "]")
    .replace(/,\s*}/g, "}");
}

/** Converte sub-arrays associativos PHP `[ "a": 1 ]` em objetos JSON `{ "a": 1 }` */
function assocArraysToObjects(jsonish: string): string {
  const out: string[] = [];
  const stack: ("[" | "{")[] = [];

  for (let i = 0; i < jsonish.length; i++) {
    const ch = jsonish[i]!;

    if (ch === "[") {
      let j = i + 1;
      while (j < jsonish.length && /\s/.test(jsonish[j]!)) j++;

      let isObject = false;
      if (jsonish[j] === '"') {
        let k = j + 1;
        while (k < jsonish.length && jsonish[k] !== '"') k++;
        k++;
        while (k < jsonish.length && /\s/.test(jsonish[k]!)) k++;
        isObject = jsonish[k] === ":";
      }

      if (isObject) {
        out.push("{");
        stack.push("{");
      } else {
        out.push("[");
        stack.push("[");
      }
      continue;
    }

    if (ch === "]") {
      const open = stack.pop() ?? "[";
      out.push(open === "{" ? "}" : "]");
      continue;
    }

    out.push(ch);
  }

  return out.join("");
}

function parsePhpArrayLiteral(literal: string): unknown {
  const jsonish = assocArraysToObjects(phpAssocToJson(literal));
  return JSON.parse(jsonish);
}

function extractLastArray(source: string, varName: string): unknown[] {
  const re = new RegExp(`\\$${varName}\\s*=\\s*(\\[)`, "g");
  let match: RegExpExecArray | null = null;
  let lastStart = -1;

  while ((match = re.exec(source)) !== null) {
    lastStart = match.index + match[0].length - 1;
  }

  if (lastStart < 0) return [];

  let depth = 0;
  let end = -1;
  for (let i = lastStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === "[") depth++;
    if (ch === "]") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }

  if (end < 0) return [];

  const literal = source.slice(lastStart, end);
  return parsePhpArrayLiteral(literal) as unknown[];
}

function normalizeLine(raw: Record<string, unknown>): SpinLine {
  return {
    index: Number(raw.index ?? 0),
    name: String(raw.name ?? ""),
    combine: Number(raw.combine ?? 3),
    way_243: Number(raw.way_243 ?? 1),
    payout: Number(raw.payout ?? 0),
    multiply: Number(raw.multiply ?? 0),
    win_amount: Number(raw.win_amount ?? 0),
    active_icon: Array.isArray(raw.active_icon) ? raw.active_icon.map(Number) : [],
  };
}

function normalizeTemplate(row: unknown): SpinTemplate | null {
  if (!Array.isArray(row) || row.length < 6) return null;

  const slotIcons = Array.isArray(row[0]) ? row[0].map(String) : [];
  if (slotIcons.length === 0) return null;

  const activeLinesRaw = Array.isArray(row[2]) ? row[2] : [];

  return {
    slotIcons,
    activeIcons: Array.isArray(row[1]) ? row[1].map(Number) : [],
    activeLines: activeLinesRaw
      .filter((x): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x))
      .map((x) => normalizeLine(x)),
    dropLineData: Array.isArray(row[3]) ? row[3] : [],
    multiplyCount: Number(row[4] ?? 1),
    payout: Number(row[5] ?? 0),
    freeSpin: row[6] !== undefined ? Number(row[6]) : 0,
  };
}

function stripPhpComments(text: string): string {
  return text.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function loadFromSpinPhp(assetPath: string): TemplateFile {
  const spinPath = path.join(resolveGamesDir(), assetPath, "api", "endpoints", "spin.php");
  if (!fs.existsSync(spinPath)) return { win: [], lose: [] };

  const source = stripPhpComments(fs.readFileSync(spinPath, "utf8"));
  const loseRaw = extractLastArray(source, "loseResults");
  const winRaw = extractLastArray(source, "winResults");

  return {
    lose: loseRaw.map(normalizeTemplate).filter((t): t is SpinTemplate => t !== null && t.payout === 0),
    win: winRaw.map(normalizeTemplate).filter((t): t is SpinTemplate => t !== null && t.payout > 0),
  };
}

export function loadSpinTemplates(assetPath: string): TemplateFile {
  const cached = cache.get(assetPath);
  if (cached) return cached;

  const jsonPath = path.join(resolveGamesDir(), assetPath, "api", "spin-templates.json");
  let templates: TemplateFile;

  if (fs.existsSync(jsonPath)) {
    templates = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as TemplateFile;
  } else {
    templates = loadFromSpinPhp(assetPath);
  }

  cache.set(assetPath, templates);
  return templates;
}

export function shuffleSlotIcons(icons: string[]): string[] {
  const copy = [...icons];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Mesma fórmula do spin.php legado: cpl × betamount × PAYOUT do template. */
export function calcTemplateWinFromPayout(
  template: SpinTemplate,
  cpl: number,
  amount: number,
): number {
  if (template.payout <= 0) return 0;
  return roundMoney(cpl * amount * template.payout);
}

export function calcTemplateWinAmount(
  template: SpinTemplate,
  cpl: number,
  amount: number,
  _paytable?: IconPaytable,
): number {
  return calcTemplateWinFromPayout(template, cpl, amount);
}

/** Monta ActiveLines igual ao PHP — prêmio total no template.payout, símbolos do template. */
export function buildTemplateActiveLines(
  template: SpinTemplate,
  cpl: number,
  amount: number,
): { winAmount: number; activeLines: SpinLine[] } {
  const winAmount = calcTemplateWinFromPayout(template, cpl, amount);
  if (winAmount <= 0 || template.activeLines.length === 0) {
    return { winAmount: 0, activeLines: [] };
  }

  const activeLines = template.activeLines.map((line, i) => ({
    ...line,
    payout: template.payout,
    win_amount: i === 0 ? winAmount : 0,
    active_icon: line.active_icon.length ? line.active_icon : template.activeIcons,
  }));

  return { winAmount, activeLines };
}

/** @deprecated prefer buildTemplateActiveLines — icons.php não bate com PAYOUT dos templates PHP */
export function calcWinFromTemplate(
  template: SpinTemplate,
  cpl: number,
  amount: number,
  paytable?: IconPaytable,
): { winAmount: number; activeLines: SpinLine[] } {
  if (template.payout > 0 && template.activeLines.length > 0) {
    return buildTemplateActiveLines(template, cpl, amount);
  }

  if (!paytable || template.activeLines.length === 0) {
    const fallback = calcTemplateWinFromPayout(template, cpl, amount);
    return { winAmount: fallback, activeLines: template.activeLines };
  }

  const activeLines: SpinLine[] = [];
  let winAmount = 0;

  for (const line of template.activeLines) {
    const positions = line.active_icon.length ? line.active_icon : template.activeIcons;
    const payingSymbol = resolvePayingSymbol(template.slotIcons, positions, paytable);
    const payout = getSymbolPayout(paytable, payingSymbol, line.combine);
    const lineWin = calcLineWin(cpl, amount, payout);

    activeLines.push({
      ...line,
      name: payingSymbol,
      payout,
      win_amount: lineWin,
      active_icon: positions,
    });

    winAmount += lineWin;
  }

  return {
    winAmount: roundMoney(winAmount),
    activeLines,
  };
}

/** Escolhe template vencedor cujo prêmio cabe no teto do RTP */
export function pickWinTemplate(
  templates: SpinTemplate[],
  cpl: number,
  amount: number,
  maxWinAmount: number,
  paytable?: IconPaytable,
): SpinTemplate | null {
  const eligible = templates.filter((t) => {
    const winAmount = calcTemplateWinFromPayout(t, cpl, amount);
    return winAmount > 0 && winAmount <= maxWinAmount;
  });

  if (eligible.length === 0) return null;
  return eligible[Math.floor(Math.random() * eligible.length)]!;
}

export function pickLoseTemplate(templates: SpinTemplate[]): SpinTemplate {
  if (templates.length === 0) {
    return {
      slotIcons: ["Symbol_0", "Symbol_1", "Symbol_2", "Symbol_3", "Symbol_4", "Symbol_5", "Symbol_6", "Symbol_7", "Symbol_8"],
      activeIcons: [],
      activeLines: [],
      dropLineData: [],
      multiplyCount: 1,
      payout: 0,
    };
  }
  return templates[Math.floor(Math.random() * templates.length)]!;
}

export function buildActiveLines(template: SpinTemplate, winAmount: number): SpinLine[] {
  if (winAmount <= 0 || template.activeLines.length === 0) return [];

  return template.activeLines.map((line) => ({
    ...line,
    payout: template.payout,
    win_amount: winAmount,
    active_icon: line.active_icon.length ? line.active_icon : template.activeIcons,
  }));
}
