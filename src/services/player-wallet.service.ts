import { prisma } from "../lib/prisma.js";
import type { WalletTxType } from "../../generated/prisma/client.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { fetchWalletBalance, getClientWalletConfig } from "./wallet.service.js";

export async function getOrCreateWallet(input: {
  clientId: string;
  externalUserId: string;
  currency?: string;
}) {
  const currency = input.currency ?? "BRL";

  return prisma.playerWallet.upsert({
    where: {
      clientId_externalUserId_currency: {
        clientId: input.clientId,
        externalUserId: input.externalUserId,
        currency,
      },
    },
    create: {
      clientId: input.clientId,
      externalUserId: input.externalUserId,
      currency,
      balance: 0,
    },
    update: {},
  });
}

export async function getWalletBalance(
  clientId: string,
  externalUserId: string,
  currency = "BRL",
): Promise<number> {
  const config = await getClientWalletConfig(clientId);
  if (config) {
    const remote = await fetchWalletBalance(config, externalUserId, currency);
    return remote.balance;
  }

  const wallet = await getOrCreateWallet({ clientId, externalUserId, currency });
  return Number(wallet.balance);
}

async function applyWalletChange(input: {
  walletId: string;
  type: WalletTxType;
  amount: number;
  referenceId?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  return prisma.$transaction(async (tx) => {
    const wallet = await tx.playerWallet.findUniqueOrThrow({ where: { id: input.walletId } });
    const balanceBefore = Number(wallet.balance);
    const balanceAfter = balanceBefore + input.amount;

    if (balanceAfter < 0) {
      throw new Error("Insufficient balance");
    }

    await tx.playerWallet.update({
      where: { id: wallet.id },
      data: { balance: balanceAfter },
    });

    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: input.type,
        amount: input.amount,
        balanceBefore,
        balanceAfter,
        referenceId: input.referenceId ?? null,
        metadata: input.metadata ?? undefined,
      },
    });

    return { balanceBefore, balanceAfter };
  });
}

export async function depositToWallet(input: {
  clientId: string;
  externalUserId: string;
  amount: number;
  currency?: string;
  referenceId?: string;
}) {
  if (input.amount <= 0) throw new Error("Amount must be positive");

  const wallet = await getOrCreateWallet(input);
  return applyWalletChange({
    walletId: wallet.id,
    type: "DEPOSIT",
    amount: input.amount,
    referenceId: input.referenceId,
    metadata: { source: "back_uni_fut" },
  });
}

export async function withdrawFromWallet(input: {
  clientId: string;
  externalUserId: string;
  amount: number;
  currency?: string;
  referenceId?: string;
}) {
  if (input.amount <= 0) throw new Error("Amount must be positive");

  const wallet = await getOrCreateWallet(input);
  return applyWalletChange({
    walletId: wallet.id,
    type: "WITHDRAW",
    amount: -input.amount,
    referenceId: input.referenceId,
    metadata: { destination: "back_uni_fut" },
  });
}

export async function debitBet(input: {
  clientId: string;
  externalUserId: string;
  betAmount: number;
  currency?: string;
  referenceId?: string;
}) {
  const wallet = await getOrCreateWallet(input);
  return applyWalletChange({
    walletId: wallet.id,
    type: "BET",
    amount: -input.betAmount,
    referenceId: input.referenceId,
  });
}

export async function creditWin(input: {
  clientId: string;
  externalUserId: string;
  winAmount: number;
  currency?: string;
  referenceId?: string;
}) {
  if (input.winAmount <= 0) {
    const wallet = await getOrCreateWallet(input);
    return { balanceBefore: Number(wallet.balance), balanceAfter: Number(wallet.balance) };
  }

  const wallet = await getOrCreateWallet(input);
  return applyWalletChange({
    walletId: wallet.id,
    type: "WIN",
    amount: input.winAmount,
    referenceId: input.referenceId,
  });
}

export async function recordFee(input: {
  clientId: string;
  externalUserId: string;
  feeAmount: number;
  feeType: "GAME_FEE" | "CLIENT_FEE";
  currency?: string;
  referenceId?: string;
}) {
  if (input.feeAmount <= 0) {
    const wallet = await getOrCreateWallet(input);
    return { balanceBefore: Number(wallet.balance), balanceAfter: Number(wallet.balance) };
  }

  const wallet = await getOrCreateWallet(input);
  return applyWalletChange({
    walletId: wallet.id,
    type: input.feeType,
    amount: -input.feeAmount,
    referenceId: input.referenceId,
    metadata: { feeType: input.feeType },
  });
}
