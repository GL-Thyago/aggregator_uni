export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** @deprecated Prefer resolveGgrFees — cobrança alinhada ao relatório ( % sobre GGR ). */
export function calcFeeAmount(betAmount: number, feePct: number): number {
  if (feePct <= 0) return 0;
  return roundMoney((betAmount * feePct) / 100);
}

export interface ResolvedFees {
  gameFeePct: number;
  clientFeePct: number;
  gameFeeAmount: number;
  clientFeeAmount: number;
  totalFeeAmount: number;
  ggr: number;
}

/**
 * Taxa B2B igual ao relatório / CSV: % aplicado sobre GGR (apostado − prêmio), não sobre turnover.
 * Repasse Salsa = providerCostPct × GGR; margem = (totalChargePct − providerCostPct) × GGR.
 */
export function resolveGgrFees(input: {
  betAmount: number;
  winAmount: number;
  providerCostPct: number;
  totalChargePct: number;
}): ResolvedFees {
  const ggr = roundMoney(input.betAmount - input.winAmount);
  const providerCostPct = input.providerCostPct;
  const totalChargePct = input.totalChargePct;
  const clientMarginPct = roundMoney(Math.max(0, totalChargePct - providerCostPct));

  const gameFeeAmount = roundMoney((ggr * providerCostPct) / 100);
  const chargeAmount = roundMoney((ggr * totalChargePct) / 100);
  const clientFeeAmount = roundMoney(chargeAmount - gameFeeAmount);

  return {
    gameFeePct: providerCostPct,
    clientFeePct: clientMarginPct,
    gameFeeAmount,
    clientFeeAmount,
    totalFeeAmount: chargeAmount,
    ggr,
  };
}

/** Legado: % sobre aposta (superestima ~14× vs fatura em slots). Evitar em produção. */
export function resolveSpinFees(input: {
  betAmount: number;
  gameFeePct: number;
  clientFeePct: number;
}): ResolvedFees {
  const gameFeeAmount = calcFeeAmount(input.betAmount, input.gameFeePct);
  const clientFeeAmount = calcFeeAmount(input.betAmount, input.clientFeePct);

  return {
    gameFeePct: input.gameFeePct,
    clientFeePct: input.clientFeePct,
    gameFeeAmount,
    clientFeeAmount,
    totalFeeAmount: roundMoney(gameFeeAmount + clientFeeAmount),
    ggr: roundMoney(input.betAmount),
  };
}
