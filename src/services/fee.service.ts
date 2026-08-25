export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

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
}

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
  };
}
