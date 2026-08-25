import { prisma } from "../lib/prisma.js";
import type { ClientWalletTxType } from "../../generated/prisma/client.js";

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function getClientWalletBalance(clientId: string): Promise<number> {
  const wallet = await prisma.clientWallet.findUnique({ where: { clientId } });
  return wallet ? Number(wallet.balance) : 0;
}

export async function ensureClientWallet(clientId: string, initialBalance = 0) {
  return prisma.clientWallet.upsert({
    where: { clientId },
    create: { clientId, balance: initialBalance },
    update: {},
  });
}

async function logWalletTx(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  input: {
    clientId: string;
    type: ClientWalletTxType;
    amount: number;
    balanceBefore: number;
    balanceAfter: number;
    description?: string;
    referenceId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await tx.clientWalletTransaction.create({
    data: {
      clientId: input.clientId,
      type: input.type,
      amount: input.amount,
      balanceBefore: input.balanceBefore,
      balanceAfter: input.balanceAfter,
      description: input.description,
      referenceId: input.referenceId,
      metadata: (input.metadata ?? undefined) as import("../../generated/prisma/client.js").Prisma.InputJsonValue | undefined,
    },
  });
}

async function assertCanDebit(clientId: string, balanceAfter: number) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { billingMode: true, maxCredit: true },
  });
  if (!client) throw new Error("Client not found");

  if (client.billingMode === "PREPAID" && balanceAfter < 0) {
    throw new Error("Saldo B2B insuficiente (pré-pago)");
  }

  if (client.billingMode === "POSTPAID" && client.maxCredit !== null) {
    const floor = -Number(client.maxCredit);
    if (balanceAfter < floor) {
      throw new Error(`Limite de crédito pós-pago excedido (mínimo R$ ${floor})`);
    }
  }
}

/** Debita taxa B2B do operador — jogador final não vê isso */
export async function debitClientFees(input: {
  clientId: string;
  gameFeeAmount: number;
  clientFeeAmount: number;
  referenceId?: string;
}) {
  const total = round(input.gameFeeAmount + input.clientFeeAmount);
  if (total <= 0) {
    return { debited: 0, balanceAfter: await getClientWalletBalance(input.clientId) };
  }

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.clientWallet.upsert({
      where: { clientId: input.clientId },
      create: { clientId: input.clientId, balance: 0 },
      update: {},
    });

    const balanceBefore = Number(wallet.balance);
    const balanceAfter = round(balanceBefore - total);

    await assertCanDebit(input.clientId, balanceAfter);

    await tx.clientWallet.update({
      where: { clientId: input.clientId },
      data: { balance: balanceAfter },
    });

    await logWalletTx(tx, {
      clientId: input.clientId,
      type: "DEBIT_FEE",
      amount: -total,
      balanceBefore,
      balanceAfter,
      description: "Taxas de jogo + margem B2B",
      referenceId: input.referenceId,
      metadata: {
        gameFeeAmount: input.gameFeeAmount,
        clientFeeAmount: input.clientFeeAmount,
      },
    });

    return {
      debited: total,
      balanceBefore,
      balanceAfter,
      referenceId: input.referenceId,
    };
  });
}

export async function fundClientWallet(
  clientId: string,
  amount: number,
  description = "Recarga manual",
) {
  if (amount <= 0) throw new Error("Amount must be positive");

  return prisma.$transaction(async (tx) => {
    const existing = await tx.clientWallet.findUnique({ where: { clientId } });
    const balanceBefore = existing ? Number(existing.balance) : 0;
    const balanceAfter = round(balanceBefore + amount);

    await tx.clientWallet.upsert({
      where: { clientId },
      create: { clientId, balance: amount },
      update: { balance: balanceAfter },
    });

    await logWalletTx(tx, {
      clientId,
      type: "FUND",
      amount,
      balanceBefore,
      balanceAfter,
      description,
    });

    return { balance: balanceAfter };
  });
}

export async function adjustClientWallet(
  clientId: string,
  amount: number,
  description = "Ajuste manual",
) {
  if (amount === 0) throw new Error("Amount cannot be zero");

  return prisma.$transaction(async (tx) => {
    const existing = await tx.clientWallet.findUnique({ where: { clientId } });
    const balanceBefore = existing ? Number(existing.balance) : 0;
    const balanceAfter = round(balanceBefore + amount);

    if (amount < 0) {
      await assertCanDebit(clientId, balanceAfter);
    }

    await tx.clientWallet.upsert({
      where: { clientId },
      create: { clientId, balance: balanceAfter },
      update: { balance: balanceAfter },
    });

    await logWalletTx(tx, {
      clientId,
      type: "ADJUST",
      amount,
      balanceBefore,
      balanceAfter,
      description,
    });

    return { balance: balanceAfter };
  });
}

export async function getClientWalletDetails(clientId: string) {
  const [client, wallet, txs] = await Promise.all([
    prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, name: true, billingMode: true, maxCredit: true, marginPct: true },
    }),
    prisma.clientWallet.findUnique({ where: { clientId } }),
    prisma.clientWalletTransaction.findMany({
      where: { clientId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  if (!client) return null;

  const balance = wallet ? Number(wallet.balance) : 0;
  const maxCredit = client.maxCredit !== null ? Number(client.maxCredit) : null;

  return {
    client,
    balance: round(balance),
    maxCredit,
    availableCredit:
      client.billingMode === "POSTPAID" && maxCredit !== null
        ? round(maxCredit + balance)
        : round(balance),
    transactions: txs.map((t) => ({
      id: t.id,
      type: t.type,
      amount: Number(t.amount),
      balanceBefore: Number(t.balanceBefore),
      balanceAfter: Number(t.balanceAfter),
      description: t.description,
      referenceId: t.referenceId,
      createdAt: t.createdAt.toISOString(),
    })),
  };
}
