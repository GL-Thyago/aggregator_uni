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
  const billableGgr = Math.max(0, ggr);
  const chargeAmount = round2((billableGgr * chargePct) / 100);
  const salsaDue = round2((billableGgr * salsaPct) / 100);
  return {
    ggr: round2(ggr),
    billableGgr: round2(billableGgr),
    salsaPct,
    chargePct,
    chargeAmount,
    salsaDue,
    yourEarn: round2(Math.max(0, chargeAmount - salsaDue)),
  };
}

type RateMaps = {
  globalSalsa: number;
  globalCharge: number;
  providerSalsa: Map<number, number>;
  clientCharge: Map<string, number>;
  accessCharge: Map<string, number>;
  accessSalsa: Map<string, number>;
};

async function loadRateMaps(): Promise<RateMaps> {
  const [cfg, providers, clients, access] = await Promise.all([
    getSalsaRuntimeConfig(),
    prisma.gameProvider.findMany({ select: { id: true, defaultCostPct: true } }),
    prisma.client.findMany({ select: { id: true, chargePct: true } }),
    prisma.clientProviderAccess.findMany({
      select: { clientId: true, providerId: true, feePct: true, chargePct: true },
    }),
  ]);

  const globalSalsa = Number(cfg.defaultProviderCostPct) || 0;
  const globalCharge = Number(cfg.defaultOperatorChargePct) || 0;
  const providerSalsa = new Map<number, number>();
  for (const p of providers) {
    if (p.defaultCostPct != null) providerSalsa.set(p.id, Number(p.defaultCostPct));
  }
  const clientCharge = new Map<string, number>();
  for (const c of clients) {
    if (c.chargePct != null) clientCharge.set(c.id, Number(c.chargePct));
  }
  const accessCharge = new Map<string, number>();
  const accessSalsa = new Map<string, number>();
  for (const row of access) {
    const key = `${row.clientId}:${row.providerId}`;
    if (row.chargePct != null) accessCharge.set(key, Number(row.chargePct));
    if (row.feePct != null) accessSalsa.set(key, Number(row.feePct));
  }

  return { globalSalsa, globalCharge, providerSalsa, clientCharge, accessCharge, accessSalsa };
}

function resolveRates(maps: RateMaps, clientId: string, providerId: number) {
  const key = `${clientId}:${providerId}`;
  const salsaPct = maps.accessSalsa.get(key) ?? maps.providerSalsa.get(providerId) ?? maps.globalSalsa;
  const chargePct = maps.accessCharge.get(key) ?? maps.clientCharge.get(clientId) ?? maps.globalCharge;
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

    const rates = resolveRates(maps, s.clientId, s.providerId);
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
    };
    prov.spins += 1;
    prov.betAmount += s.betAmount;
    prov.winAmount += s.winAmount;
    byProvider.set(pk, prov);
  }

  const providerRows = [...byProvider.values()].map((row) => {
    const ggr = row.betAmount - row.winAmount;
    const settled = settleGgr(ggr, row.salsaPct, row.chargePct);
    return {
      ...row,
      betAmount: round2(row.betAmount),
      winAmount: round2(row.winAmount),
      ...settled,
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
      billableGgr: round2(Math.max(0, ggr)),
      chargeAmount,
      salsaDue,
      yourEarn: round2(Math.max(0, chargeAmount - salsaDue)),
      providers: slices.sort((a, b) => b.betAmount - a.betAmount),
    };
  }).sort((a, b) => b.betAmount - a.betAmount);

  const totalGgr = round2(betAmount - winAmount);
  const invoiceable = round2(clientRows.reduce((s, c) => s + c.chargeAmount, 0));
  const salsaIfPositive = round2(clientRows.reduce((s, c) => s + c.salsaDue, 0));
  const salsaPayable = totalGgr > 0 ? salsaIfPositive : 0;
  const yourEarnOverall = totalGgr > 0 ? round2(Math.max(0, invoiceable - salsaPayable)) : 0;

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
      totalGgr <= 0 && !clientId
        ? "GGR geral ≤ 0: você não ganha no consolidado e não repassa à Salsa. Clientes positivos ainda podem ser cobrados."
        : "Você cobra só o GGR positivo de cada cliente. Salsa só entra se o GGR daquele recorte for > 0.",
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
      const rates = resolveRates(maps, s.session.clientId, providerId);
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
        ggr: round2(ggr),
        salsaPct: rates.salsaPct,
        chargePct: rates.chargePct,
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
