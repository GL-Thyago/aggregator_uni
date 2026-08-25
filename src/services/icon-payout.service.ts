export type IconDef = {
  icon_name: string;
  win_1: number;
  win_2: number;
  win_3: number;
  win_4: number;
  win_5: number;
  win_6: number;
  wild_card: string | null;
};

export type IconPaytable = Map<string, IconDef>;

export function buildIconPaytable(icons: unknown[]): IconPaytable {
  const table: IconPaytable = new Map();

  for (const raw of icons) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const name = String(row.icon_name ?? "");
    if (!name) continue;

    table.set(name, {
      icon_name: name,
      win_1: Number(row.win_1 ?? 0),
      win_2: Number(row.win_2 ?? 0),
      win_3: Number(row.win_3 ?? 0),
      win_4: Number(row.win_4 ?? 0),
      win_5: Number(row.win_5 ?? 0),
      win_6: Number(row.win_6 ?? 0),
      wild_card: row.wild_card ? String(row.wild_card) : null,
    });
  }

  return table;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Símbolos sem payout próprio substituem outros (ex.: Symbol_0 / Symbol_1 no Fortune Tiger). */
export function isSubstituteWild(icon: IconDef | undefined): boolean {
  if (!icon) return false;
  if (icon.wild_card) return true;
  return icon.win_3 === 0 && icon.win_4 === 0 && icon.win_5 === 0;
}

export function getSymbolPayout(paytable: IconPaytable, symbolName: string, combine: number): number {
  const icon = paytable.get(symbolName);
  if (!icon) return 0;

  const clamped = Math.max(1, Math.min(6, combine));
  const key = `win_${clamped}` as keyof IconDef;
  const payout = Number(icon[key] ?? 0);
  if (payout > 0) return payout;

  for (let n = clamped - 1; n >= 1; n--) {
    const fallback = Number(icon[`win_${n}` as keyof IconDef] ?? 0);
    if (fallback > 0) return fallback;
  }

  return 0;
}

/** Posições do Construct são 1-based (1..9). Mesma regra de evaluateSinglePayline (ancora à esquerda). */
export function resolvePayingSymbol(
  slotIcons: string[],
  activePositions: number[],
  paytable: IconPaytable,
): string {
  const symbols = activePositions
    .map((pos) => slotIcons[pos - 1]?.split(":")[0] ?? "")
    .filter(Boolean);

  for (const name of symbols) {
    if (!isSubstituteWild(paytable.get(name))) {
      return name;
    }
  }

  return symbols[0] ?? "";
}

export function calcLineWin(cpl: number, amount: number, payout: number): number {
  return roundMoney(cpl * amount * payout);
}

/** Avalia UMA linha de pagamento — retorna null se não houver prêmio. */
export function evaluateSinglePayline(
  grid: string[],
  positions: number[],
  combine: number,
  paytable: IconPaytable,
  cpl: number,
  amount: number,
): { payingSymbol: string; payout: number; winAmount: number } | null {
  const symbols = positions
    .map((pos) => grid[pos - 1]?.split(":")[0] ?? "")
    .filter(Boolean);

  if (symbols.length !== positions.length) return null;

  // Ancora no 1º símbolo pagante da esquerda; wild substitui qualquer um.
  let payingSymbol = "";
  for (const name of symbols) {
    if (!isSubstituteWild(paytable.get(name))) {
      payingSymbol = name;
      break;
    }
  }

  if (!payingSymbol) return null;

  for (const name of symbols) {
    const icon = paytable.get(name);
    if (!isSubstituteWild(icon) && name !== payingSymbol) return null;
  }

  const payout = getSymbolPayout(paytable, payingSymbol, combine);
  if (payout <= 0) return null;

  return {
    payingSymbol,
    payout,
    winAmount: calcLineWin(cpl, amount, payout),
  };
}
