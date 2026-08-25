import crypto from "node:crypto";
import type { SpinTemplate } from "./spin-templates.service.js";
import { calcTemplateWinFromPayout } from "./spin-templates.service.js";

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Escolhe template vencedor — favorece prêmios pequenos (curva similar a slots PG). */
export function pickWeightedWinTemplate(
  templates: SpinTemplate[],
  cpl: number,
  amount: number,
  maxWinAmount: number,
): SpinTemplate | null {
  const eligible = templates
    .map((t) => ({
      template: t,
      winAmount: calcTemplateWinFromPayout(t, cpl, amount),
    }))
    .filter((e) => e.winAmount > 0 && e.winAmount <= maxWinAmount);

  if (eligible.length === 0) return null;

  const weights = eligible.map((e) => {
    const payout = Math.max(1, e.template.payout);
    return 1 / Math.pow(payout, 0.65);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = crypto.randomInt(0, 1_000_000) / 1_000_000 * total;

  for (let i = 0; i < eligible.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return eligible[i]!.template;
  }

  return eligible[eligible.length - 1]!.template;
}

/** Embaralha símbolos fora das posições vencedoras — visual diferente a cada spin. */
export function shuffleGridVariety(
  grid: string[],
  frozenPositions: Set<number>,
  symbolPool: string[],
): string[] {
  const out = [...grid];
  const movable: number[] = [];
  const symbols: string[] = [];

  for (let i = 0; i < out.length; i++) {
    const pos = i + 1;
    if (frozenPositions.has(pos)) continue;
    movable.push(i);
    symbols.push(out[i]!.split(":")[0] ?? out[i]!);
  }

  for (let i = symbols.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [symbols[i], symbols[j]] = [symbols[j]!, symbols[i]!];
  }

  for (let k = 0; k < movable.length; k++) {
    out[movable[k]!] = symbols[k]!;
  }

  if (symbolPool.length > 0 && crypto.randomInt(0, 100) < 35) {
    for (const idx of movable) {
      if (crypto.randomInt(0, 100) < 40) {
        out[idx] = symbolPool[crypto.randomInt(0, symbolPool.length)]!;
      }
    }
  }

  return out;
}

export function expectedRetentionPct(targetRtpPct: number): number {
  return roundMoney(100 - targetRtpPct);
}
