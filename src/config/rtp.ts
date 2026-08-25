/** RTP alvo padrão: jogador recebe 80% do apostado (retenção da casa = 20%). */
export const DEFAULT_TARGET_RTP_PCT = 80;
export const DEFAULT_HOUSE_RETENTION_PCT = 100 - DEFAULT_TARGET_RTP_PCT;

export function targetRtpFromGame(rtp: unknown): number {
  const n = Number(rtp);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : DEFAULT_TARGET_RTP_PCT;
}

/** Multiplicador em jogo 50/50 com RTP alvo (ex: 80% → 1.6x). */
export function evenMoneyMultiplier(rtpPct: number): number {
  return round2(2 * (rtpPct / 100));
}

/** Multiplicador Dice proporcional à probabilidade. */
export function diceFairMultiplier(winChance: number, rtpPct: number): number {
  if (winChance <= 0 || winChance >= 1) return 0;
  return round2(rtpPct / 100 / winChance);
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}
