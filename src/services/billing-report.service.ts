import { prisma } from "../lib/prisma.js";
import { getSalsaRuntimeConfig } from "./salsa/salsa-config.service.js";

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

function parseSince(query?: string): Date {
  if (query) {
    const d = new Date(query);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
}

export function settleGgr(ggr: number, salsaPct: number, chargePct: number) {
  const signed = round2(ggr);
  const chargeAmount = round2((signed * chargePct) / 100);
  const salsaDue = round2((signed * salsaPct) / 100);
  return {
    ggr: signed,
    billableGgr: signed,
    salsaPct,
    chargePct,
    chargeAmount,
    salsaDue,
    yourEarn: round2(chargeAmount - salsaDue),
  };
}

type RateMaps = {
  globalSalsa: number;
  providerSalsa: Map<number, number>;
  gameSalsa: Map<number, number>;
  clientMargin: Map<string, number>;
  clientCharge: Map<string, number>;
  accessCharge: Map<string, number>;
  accessSalsa: Map<string, number>;
  entitlementSalsa: Map<string, number>;
  entitlementCharge: Map<string, number>;
};

function roundPct(n: number) {
  return Math.round(n * 100) / 100;
}

async function loadRateMaps(): Promise<RateMaps> {
  const [cfg, providers, clients, access, games, entitlements] = await Promise.all([
    getSalsaRuntimeConfig(),
    prisma.gameProvider.findMany({ select: { id: true, defaultCostPct: true } }),
    prisma.client.findMany({ select: { id: true, chargePct: true, marginPct: true } }),
    prisma.clientProviderAccess.findMany({
      select: { clientId: true, providerId: true, feePct: true, chargePct: true },
    }),
    prisma.game.findMany({ select: { id: true, aggregatorFeePct: true } }),
    prisma.clientEntitlement.findMany({
      where: { gameId: { not: null } },
      select: { clientId: true, gameId: true, feePct: true, chargePct: true },
    }),
  ]);

  const globalSalsa = Number(cfg.defaultProviderCostPct) || 0;
  const providerSalsa = new Map<number, number>();
  for (const p of providers) {
    if (p.defaultCostPct != null) providerSalsa.set(p.id, Number(p.defaultCostPct));
  }
  const gameSalsa = new Map<number, number>();
  for (const g of games) {
    if (g.aggregatorFeePct != null) gameSalsa.set(g.id, Number(g.aggregatorFeePct));
  }
  const clientMargin = new Map<string, number>();
  const clientCharge = new Map<string, number>();
  for (const c of clients) {
    clientMargin.set(c.id, Number(c.marginPct) || 0);
    if (c.chargePct != null) clientCharge.set(c.id, Number(c.chargePct));
  }
  const accessCharge = new Map<string, number>();
  const accessSalsa = new Map<string, number>();
  for (const row of access) {
    const key = `${row.clientId}:${row.providerId}`;
    if (row.chargePct != null) accessCharge.set(key, Number(row.chargePct));
    if (row.feePct != null) accessSalsa.set(key, Number(row.feePct));
  }
  const entitlementSalsa = new Map<string, number>();
  const entitlementCharge = new Map<string, number>();
  for (const row of entitlements) {
    if (row.gameId == null) continue;
    const key = `${row.clientId}:${row.gameId}`;
    if (row.feePct != null) entitlementSalsa.set(key, Number(row.feePct));
    if (row.chargePct != null) entitlementCharge.set(key, Number(row.chargePct));
  }

  return {
    globalSalsa,
    providerSalsa,
    gameSalsa,
    clientMargin,
    clientCharge,
    accessCharge,
    accessSalsa,
    entitlementSalsa,
    entitlementCharge,
  };
}

function resolveRates(maps: RateMaps, clientId: string, providerId: number, gameId?: number) {
  const accessKey = `${clientId}:${providerId}`;
  const gameKey = gameId != null ? `${clientId}:${gameId}` : "";
  const salsaPct =
    (gameKey ? maps.entitlementSalsa.get(gameKey) : undefined) ??
    maps.accessSalsa.get(accessKey) ??
    (gameId != null ? maps.gameSalsa.get(gameId) : undefined) ??
    maps.providerSalsa.get(providerId) ??
    maps.globalSalsa;
  const chargePct =
    (gameKey ? maps.entitlementCharge.get(gameKey) : undefined) ??
    maps.accessCharge.get(accessKey) ??
    maps.clientCharge.get(clientId) ??
    roundPct(salsaPct + (maps.clientMargin.get(clientId) ?? 0));
  return { salsaPct, chargePct };
}

type SpinRow = {
  betAmount: number;
  winAmount: number;
  createdAt: Date;
  clientId: string;
  clientName: string;
  gameId: number;
  gameName: string;
  gameSlug: string;
  providerId: number;
  providerName: string;
  providerSlug: string;
};

async function loadSpins(since: Date, clientId?: string): Promise<SpinRow[]> {
  const spins = await prisma.gameSpin.findMany({
    where: {
      createdAt: { gte: since },
      ...(clientId && { session: { clientId } }),
    },
    select: {
      betAmount: true,
      winAmount: true,
      createdAt: true,
      session: {
        select: {
          clientId: true,
          client: { select: { name: true } },
          game: {
            select: {
              id: true,
              name: true,
              slug: true,
              provider: { select: { id: true, name: true, displayName: true, slug: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return spins.map((s) => ({
    betAmount: Number(s.betAmount),
    winAmount: Number(s.winAmount),
    createdAt: s.createdAt,
    clientId: s.session.clientId,
    clientName: s.session.client.name,
    gameId: s.session.game.id,
    gameName: s.session.game.name,
    gameSlug: s.session.game.slug,
    providerId: s.session.game.provider.id,
    providerName: s.session.game.provider.displayName?.trim() || s.session.game.provider.name,
    providerSlug: s.session.game.provider.slug,
  }));
}

function providerLabel(p: { displayName?: string | null; name: string }) {
  return p.displayName?.trim() || p.name;
}

export async function getBillingReport(sinceInput?: string, clientId?: string) {
  const since = parseSince(sinceInput);
  const [spins, maps] = await Promise.all([loadSpins(since, clientId), loadRateMaps()]);

  const byClient = new Map<
    string,
    { clientId: string; clientName: string; spins: number; betAmount: number; winAmount: number }
  >();
  const byProvider = new Map<
    string,
    {
      clientId: string;
      clientName: string;
      providerId: number;
      providerName: string;
      providerSlug: string;
      spins: number;
      betAmount: number;
      winAmount: number;
      salsaPct: number;
      chargePct: number;
      salsaDue: number;
      chargeAmount: number;
    }
  >();

  let betAmount = 0;
  let winAmount = 0;

  for (const s of spins) {
    betAmount += s.betAmount;
    winAmount += s.winAmount;

    const client = byClient.get(s.clientId) ?? {
      clientId: s.clientId,
      clientName: s.clientName,
      spins: 0,
      betAmount: 0,
      winAmount: 0,
    };
    client.spins += 1;
    client.betAmount += s.betAmount;
    client.winAmount += s.winAmount;
    byClient.set(s.clientId, client);

    const rates = resolveRates(maps, s.clientId, s.providerId, s.gameId);
    const settled = settleGgr(s.betAmount - s.winAmount, rates.salsaPct, rates.chargePct);
    const pk = `${s.clientId}:${s.providerId}`;
    const prov = byProvider.get(pk) ?? {
      clientId: s.clientId,
      clientName: s.clientName,
      providerId: s.providerId,
      providerName: s.providerName,
      providerSlug: s.providerSlug,
      spins: 0,
      betAmount: 0,
      winAmount: 0,
      salsaPct: rates.salsaPct,
      chargePct: rates.chargePct,
      salsaDue: 0,
      chargeAmount: 0,
    };
    prov.spins += 1;
    prov.betAmount += s.betAmount;
    prov.winAmount += s.winAmount;
    prov.salsaDue += settled.salsaDue;
    prov.chargeAmount += settled.chargeAmount;
    byProvider.set(pk, prov);
  }

  const providerRows = [...byProvider.values()].map((row) => {
    const ggr = round2(row.betAmount - row.winAmount);
    const chargeAmount = round2(row.chargeAmount);
    const salsaDue = round2(row.salsaDue);
    return {
      ...row,
      betAmount: round2(row.betAmount),
      winAmount: round2(row.winAmount),
      ggr,
      billableGgr: ggr,
      salsaPct: row.salsaPct,
      chargePct: row.chargePct,
      chargeAmount,
      salsaDue,
      yourEarn: round2(chargeAmount - salsaDue),
    };
  });

  const clientRows = [...byClient.values()].map((row) => {
    const slices = providerRows.filter((p) => p.clientId === row.clientId);
    const ggr = row.betAmount - row.winAmount;
    const chargeAmount = round2(slices.reduce((s, p) => s + p.chargeAmount, 0));
    const salsaDue = round2(slices.reduce((s, p) => s + p.salsaDue, 0));
    return {
      clientId: row.clientId,
      clientName: row.clientName,
      spins: row.spins,
      betAmount: round2(row.betAmount),
      winAmount: round2(row.winAmount),
      ggr: round2(ggr),
      billableGgr: round2(ggr),
      chargeAmount,
      salsaDue,
      yourEarn: round2(chargeAmount - salsaDue),
      providers: slices.sort((a, b) => b.betAmount - a.betAmount),
    };
  }).sort((a, b) => b.betAmount - a.betAmount);

  const totalGgr = round2(betAmount - winAmount);
  const invoiceable = round2(clientRows.reduce((s, c) => s + c.chargeAmount, 0));
  const salsaPayable = round2(clientRows.reduce((s, c) => s + c.salsaDue, 0));
  const yourEarnOverall = round2(clientRows.reduce((s, c) => s + c.yourEarn, 0));

  return {
    since: since.toISOString(),
    clientId: clientId || null,
    scoped: Boolean(clientId),
    spinCount: spins.length,
    betAmount: round2(betAmount),
    winAmount: round2(winAmount),
    ggr: totalGgr,
    invoiceable,
    salsaPayable,
    yourEarn: clientId ? (clientRows[0]?.yourEarn ?? 0) : yourEarnOverall,
    rule:
      "Cobrança = % × GGR real (pode ser negativo). A soma dos provedores fecha com o total do cliente.",
    clients: clientRows,
    providers: providerRows.sort((a, b) => b.betAmount - a.betAmount),
  };
}

export async function getBillingSpins(options: {
  since?: string;
  clientId?: string;
  providerId?: number;
  page?: number;
  pageSize?: number;
}) {
  const since = parseSince(options.since);
  const pageSize = Math.min(100, Math.max(10, options.pageSize ?? 25));
  const page = Math.max(1, options.page ?? 1);
  const maps = await loadRateMaps();

  const where = {
    createdAt: { gte: since },
    session: {
      ...(options.clientId && { clientId: options.clientId }),
      ...(options.providerId && { game: { providerId: options.providerId } }),
    },
  };

  const [total, rows] = await Promise.all([
    prisma.gameSpin.count({ where }),
    prisma.gameSpin.findMany({
      where,
      select: {
        id: true,
        betAmount: true,
        winAmount: true,
        createdAt: true,
        session: {
          select: {
            clientId: true,
            client: { select: { name: true } },
            game: {
              select: {
                id: true,
                name: true,
                slug: true,
                provider: { select: { id: true, name: true, displayName: true, slug: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    spins: rows.map((s) => {
      const providerId = s.session.game.provider.id;
      const rates = resolveRates(maps, s.session.clientId, providerId, s.session.game.id);
      const bet = Number(s.betAmount);
      const win = Number(s.winAmount);
      const ggr = bet - win;
      return {
        id: s.id,
        at: s.createdAt.toISOString(),
        clientId: s.session.clientId,
        clientName: s.session.client.name,
        game: s.session.game.name,
        slug: s.session.game.slug,
        provider: providerLabel(s.session.game.provider),
        providerId,
        betAmount: round2(bet),
        winAmount: round2(win),
        ...settleGgr(ggr, rates.salsaPct, rates.chargePct),
      };
    }),
  };
}

export async function buildBillingCsv(sinceInput?: string, clientId?: string) {
  const report = await getBillingReport(sinceInput, clientId);
  const lines: string[][] = [];
  const money = (n: number) => n.toFixed(2).replace(".", ",");

  lines.push(["Relatório de cobrança"]);
  lines.push(["Período desde", new Date(report.since).toLocaleString("pt-BR")]);
  lines.push(["Apostado", money(report.betAmount)]);
  lines.push(["Prêmios", money(report.winAmount)]);
  lines.push(["GGR", money(report.ggr)]);
  lines.push(["A cobrar dos clientes", money(report.invoiceable)]);
  lines.push(["A pagar à Salsa", money(report.salsaPayable)]);
  lines.push(["Seu ganho", money(report.yourEarn)]);
  lines.push([report.rule]);
  lines.push([]);
  lines.push(["Cliente", "Spins", "Apostado", "Prêmios", "GGR", "A cobrar", "Salsa", "Seu ganho"]);
  for (const c of report.clients) {
    lines.push([
      c.clientName,
      String(c.spins),
      money(c.betAmount),
      money(c.winAmount),
      money(c.ggr),
      money(c.chargeAmount),
      money(c.salsaDue),
      money(c.yourEarn),
    ]);
  }
  lines.push([]);
  lines.push(["Cliente", "Provedor", "Spins", "Apostado", "Prêmios", "GGR", "% Salsa", "% Cobrança", "A cobrar", "Salsa", "Seu ganho"]);
  for (const p of report.providers) {
    lines.push([
      p.clientName,
      p.providerName,
      String(p.spins),
      money(p.betAmount),
      money(p.winAmount),
      money(p.ggr),
      String(p.salsaPct).replace(".", ","),
      String(p.chargePct).replace(".", ","),
      money(p.chargeAmount),
      money(p.salsaDue),
      money(p.yourEarn),
    ]);
  }

  const csv = `\uFEFF${lines.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")).join("\r\n")}`;
  return csv;
}
