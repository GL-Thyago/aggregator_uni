import { prisma } from "../lib/prisma.js";

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

function parseBound(query?: string, asEnd = false): Date | undefined {
  if (!query) return undefined;
  const raw = String(query).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return undefined;
    return d;
  }
  const [y, m, day] = raw.split("-").map(Number);
  const d = new Date(y!, m! - 1, day!);
  return asEnd ? new Date(d.setHours(23, 59, 59, 999)) : new Date(d.setHours(0, 0, 0, 0));
}

function parseSince(query?: string): Date {
  return parseBound(query) ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
}

function parseUntil(query?: string): Date | undefined {
  return parseBound(query, true);
}

export type SpinAuditFlag =
  | "premio_sem_aposta"
  | "aposta_possivel_nao_serializada"
  | "premio_possivel_duplicado"
  | "evento_sem_wallet_spin_id"
  | "aposta_salsa_sem_game_spin";

const DUPLICATE_MS = 120_000;

/**
 * Exporta eventos Salsa + game_spin com flags para relatório (cobrança / pagamento).
 */
export async function getSpinAuditExport(options: {
  since?: string;
  until?: string;
  clientId?: string;
  externalUserId?: string;
  limit?: number;
}) {
  const since = parseSince(options.since);
  const until = parseUntil(options.until);
  const limit = Math.min(100_000, Math.max(1000, options.limit ?? 25_000));

  const sessionFilter = {
    ...(options.clientId && { clientId: options.clientId }),
    ...(options.externalUserId && { externalUserId: options.externalUserId }),
  };

  const events = await prisma.salsaTransaction.findMany({
    where: {
      kind: { in: ["PLACE_BET", "AWARD_WINNINGS", "REFUND_BET"] },
      createdAt: { gte: since, ...(until ? { lte: until } : {}) },
      ...(Object.keys(sessionFilter).length ? { session: sessionFilter } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      kind: true,
      amountCents: true,
      gameReference: true,
      spinId: true,
      salsaTransactionId: true,
      referenceNum: true,
      createdAt: true,
      session: {
        select: {
          id: true,
          externalUserId: true,
          clientId: true,
          client: { select: { name: true } },
          game: {
            select: {
              name: true,
              slug: true,
              provider: { select: { displayName: true, name: true } },
            },
          },
        },
      },
    },
  });

  const spinIds = events.map((e) => e.spinId).filter(Boolean) as string[];
  const gameSpins =
    spinIds.length > 0
      ? await prisma.gameSpin.findMany({
          where: { id: { in: spinIds } },
          select: {
            id: true,
            betAmount: true,
            winAmount: true,
            balanceBefore: true,
            balanceAfter: true,
            createdAt: true,
          },
        })
      : [];
  const spinById = new Map(gameSpins.map((g) => [g.id, g]));

  const placeKeys = new Set<string>();
  for (const e of events) {
    if (e.kind === "PLACE_BET" && e.amountCents > 0) {
      placeKeys.add(`${e.session.id}:${e.gameReference ?? ""}`);
    }
  }

  type Row = {
    at: string;
    kind: string;
    amountR$: number;
    clientName: string;
    clientId: string;
    externalUserId: string;
    game: string;
    provider: string;
    gameReference: string | null;
    walletSpinId: string | null;
    salsaTransactionId: string;
    referenceNum: string;
    gameSpinBet: number | null;
    gameSpinWin: number | null;
    walletBalanceBefore: number | null;
    walletBalanceAfter: number | null;
    flags: SpinAuditFlag[];
    flagNotes: string[];
  };

  const rows: Row[] = [];

  for (const e of events) {
    const flags: SpinAuditFlag[] = [];
    const notes: string[] = [];
    const gs = e.spinId ? spinById.get(e.spinId) : undefined;
    const amount = round2(e.amountCents / 100);

    if (!e.spinId) {
      flags.push("evento_sem_wallet_spin_id");
      notes.push("Salsa registrou evento sem spinId enviado ao wallet");
    }
    if (e.kind === "PLACE_BET" && e.amountCents > 0 && e.spinId && !gs) {
      flags.push("aposta_salsa_sem_game_spin");
      notes.push("PlaceBet na Salsa sem game_spin correspondente no agregador");
    }
    if (e.kind === "AWARD_WINNINGS" && e.amountCents > 0) {
      const pk = `${e.session.id}:${e.gameReference ?? ""}`;
      if (!placeKeys.has(pk)) {
        flags.push("premio_sem_aposta");
        notes.push("Prêmio Salsa sem PlaceBet na mesma sessão/rodada (gameReference)");
      }
    }

    rows.push({
      at: e.createdAt.toISOString(),
      kind: e.kind,
      amountR$: amount,
      clientName: e.session.client.name,
      clientId: e.session.clientId,
      externalUserId: e.session.externalUserId,
      game: e.session.game.name,
      provider:
        e.session.game.provider.displayName?.trim() || e.session.game.provider.name,
      gameReference: e.gameReference,
      walletSpinId: e.spinId,
      salsaTransactionId: e.salsaTransactionId,
      referenceNum: e.referenceNum,
      gameSpinBet: gs ? round2(Number(gs.betAmount)) : null,
      gameSpinWin: gs ? round2(Number(gs.winAmount)) : null,
      walletBalanceBefore: gs ? round2(Number(gs.balanceBefore)) : null,
      walletBalanceAfter: gs ? round2(Number(gs.balanceAfter)) : null,
      flags,
      flagNotes: notes,
    });
  }

  // Débitos paralelos (Aviator 2 entradas): mesmo user, <2s, mesmo balanceBefore no game_spin
  const bets = rows.filter((r) => r.kind === "PLACE_BET" && r.amountR$ > 0 && r.walletBalanceBefore != null);
  for (let i = 0; i < bets.length; i++) {
    for (let j = i + 1; j < bets.length; j++) {
      const a = bets[i]!;
      const b = bets[j]!;
      if (a.externalUserId !== b.externalUserId) continue;
      const ta = new Date(a.at).getTime();
      const tb = new Date(b.at).getTime();
      if (tb - ta > DUPLICATE_MS) break;
      if (a.walletSpinId === b.walletSpinId) continue;
      if (a.walletBalanceBefore === b.walletBalanceBefore) {
        for (const row of [a, b]) {
          if (!row.flags.includes("aposta_possivel_nao_serializada")) {
            row.flags.push("aposta_possivel_nao_serializada");
            row.flagNotes.push(
              "Duas apostas com o mesmo saldo-antes no wallet — provável débito não fila (corrida)",
            );
          }
        }
      }
    }
  }

  // Prêmios duplicados (retry)
  const awards = rows.filter((r) => r.kind === "AWARD_WINNINGS" && r.amountR$ > 0);
  for (let i = 0; i < awards.length; i++) {
    for (let j = i + 1; j < awards.length; j++) {
      const a = awards[i]!;
      const b = awards[j]!;
      if (a.externalUserId !== b.externalUserId) continue;
      if (a.amountR$ !== b.amountR$) continue;
      const dt = Math.abs(new Date(a.at).getTime() - new Date(b.at).getTime());
      if (dt > DUPLICATE_MS) continue;
      if (a.salsaTransactionId === b.salsaTransactionId && a.referenceNum === b.referenceNum) continue;
      for (const row of [a, b]) {
        if (!row.flags.includes("premio_possivel_duplicado")) {
          row.flags.push("premio_possivel_duplicado");
          row.flagNotes.push("Dois prêmios iguais em janela curta — possível pagamento em duplicata");
        }
      }
    }
  }

  const flagged = rows.filter((r) => r.flags.length > 0);

  return {
    since: since.toISOString(),
    until: until?.toISOString() ?? null,
    totalEvents: rows.length,
    flaggedEvents: flagged.length,
    truncated: events.length >= limit,
    limit,
    summary: {
      premio_sem_aposta: flagged.filter((r) => r.flags.includes("premio_sem_aposta")).length,
      aposta_nao_serializada: flagged.filter((r) => r.flags.includes("aposta_possivel_nao_serializada")).length,
      premio_duplicado: flagged.filter((r) => r.flags.includes("premio_possivel_duplicado")).length,
      sem_spin_id: flagged.filter((r) => r.flags.includes("evento_sem_wallet_spin_id")).length,
      aposta_sem_game_spin: flagged.filter((r) => r.flags.includes("aposta_salsa_sem_game_spin")).length,
    },
    rows,
    flaggedOnly: flagged,
    howToUse: [
      "Baixe JSON (rows ou flaggedOnly) e cruze walletSpinId com c1_casino_spin_idempotency no back Zona.",
      "aposta_possivel_nao_serializada = não cobrou a 2ª aposta em cima do saldo já debitado.",
      "premio_sem_aposta / premio_possivel_duplicado = pagamento indevido ou Salsa sem bet pareado.",
      "Para CSV: jq ou importar flaggedOnly no Excel.",
    ],
  };
}
