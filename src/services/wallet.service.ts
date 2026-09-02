import axios from "axios";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { signWalletPayload } from "../lib/wallet-sign.js";

export interface WalletClientConfig {
  walletUrl: string;
  walletSecret: string;
}

export interface WalletBalanceResponse {
  balance: number;
  currency?: string;
}

export interface WalletSpinRequest {
  externalUserId: string;
  gameSlug: string;
  betAmount: number;
  winAmount: number;
  gameFeeAmount: number;
  clientFeeAmount: number;
  gameFeePct: number;
  clientFeePct: number;
  spinId: string;
  sessionId: string;
  currency: string;
}

export interface WalletSpinResponse {
  ok: boolean;
  balanceBefore: number;
  balanceAfter: number;
  transactionId?: string;
  error?: string;
}

function walletHeaders(body: unknown, secret: string): Record<string, string> {
  const payload = JSON.stringify(body);
  return {
    "Content-Type": "application/json",
    "X-Wallet-Signature": signWalletPayload(payload, secret),
  };
}

export async function fetchWalletBalance(
  config: WalletClientConfig,
  externalUserId: string,
  currency: string,
): Promise<WalletBalanceResponse> {
  const body = { externalUserId, currency };
  const url = `${config.walletUrl.replace(/\/$/, "")}/balance`;

  try {
    const { data } = await axios.post<WalletBalanceResponse>(url, body, {
      headers: walletHeaders(body, config.walletSecret),
      timeout: 10_000,
    });

    if (typeof data.balance !== "number" || data.balance < 0) {
      throw new Error("Resposta de saldo inválida do wallet");
    }

    return data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const payload = err.response?.data as { error?: string } | undefined;
      const detail = payload?.error ?? err.message;
      throw new Error(
        `Wallet (${url}): ${detail}. Confira walletUrl/walletSecret no agregador e CASINO_WALLET_SECRET no back_uni.`,
      );
    }
    throw err;
  }
}

export async function processWalletSpin(
  config: WalletClientConfig,
  request: WalletSpinRequest,
): Promise<WalletSpinResponse> {
  const url = `${config.walletUrl.replace(/\/$/, "")}/spin`;

  const { data } = await axios.post<WalletSpinResponse>(url, request, {
    headers: walletHeaders(request, config.walletSecret),
    timeout: 15_000,
  });

  if (!data.ok) {
    throw new Error(data.error ?? "Wallet rejected spin transaction");
  }

  return data;
}

function resolveWalletUrl(walletUrl: string): string {
  if (/localhost|127\.0\.0\.1/i.test(walletUrl) && env.NODE_ENV === "production") {
    console.error(
      `[Wallet] walletUrl deste cliente é localhost. Grave a URL pública no admin Uni (cadastro do cassino), não no .env.`,
    );
  }
  return walletUrl;
}

export async function getClientWalletConfig(clientId: string): Promise<WalletClientConfig | null> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { walletUrl: true, walletSecret: true },
  });

  if (!client?.walletUrl || !client.walletSecret) return null;

  return {
    walletUrl: resolveWalletUrl(client.walletUrl),
    walletSecret: client.walletSecret,
  };
}

export async function resolveGameFeePct(
  clientId: string,
  gameId: number,
  categoryId: number,
  defaultGameFeePct: number,
): Promise<number> {
  const entitlement = await prisma.clientEntitlement.findFirst({
    where: {
      clientId,
      categoryId,
      OR: [{ gameId }, { gameId: null }],
      isEnabled: true,
    },
    orderBy: { gameId: "desc" },
    select: { feePct: true },
  });

  if (entitlement?.feePct !== null && entitlement?.feePct !== undefined) {
    return Number(entitlement.feePct);
  }

  return defaultGameFeePct;
}
