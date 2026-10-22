/** Fila por jogador — Aviator (2 PlaceBet) não chama o wallet do operador em paralelo. */
const tails = new Map<string, Promise<unknown>>();

export async function withWalletUserQueue<T>(
  externalUserId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = String(externalUserId || "").trim() || "_";
  const prev = tails.get(key) ?? Promise.resolve();

  const run = prev
    .catch(() => undefined)
    .then(() => fn());

  tails.set(
    key,
    run.catch(() => undefined),
  );

  try {
    return await run;
  } finally {
    if (tails.get(key) === run) tails.delete(key);
  }
}
