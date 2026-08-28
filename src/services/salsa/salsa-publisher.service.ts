import crypto from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import {
  centsToMoney,
  extTransactionNum,
  moneyToCents,
  validateSalsaHash,
} from "../../config/salsa.js";
import { resolveSpinFees } from "../fee.service.js";
import { resolveClientGameFees } from "../client-game-fees.service.js";
import {
  creditWin,
  debitBet,
  getOrCreateWallet,
  getWalletBalance,
} from "../player-wallet.service.js";
import { getClientWalletConfig, processWalletSpin } from "../wallet.service.js";
import { debitClientFees } from "../client-wallet.service.js";
import { salsaFailure, salsaSuccess, parseSalsaRequest, salsaParam } from "./salsa-xml.js";
import type { SalsaTxKind } from "../../../generated/prisma/client.js";

let activeHashKey: string | undefined;

export type SalsaPublisherTrace = {
  at: string;
  method: string;
  success: boolean;
  error?: string;
  errorCode?: string;
  token?: string;
  requestXml: string;
  responseXml: string;
};

let lastTrace: SalsaPublisherTrace | null = null;
let lastFailure: SalsaPublisherTrace | null = null;

export function getSalsaPublisherTrace(): {
  last: SalsaPublisherTrace | null;
  lastFailure: SalsaPublisherTrace | null;
} {
  return { last: lastTrace, lastFailure };
}

function recordPublisherTrace(xml: string, method: string, token: string | undefined, response: string) {
  const success = /Success="1"/i.test(response);
  const error = response.match(/<Error\b[^>]*\bValue="([^"]*)"/i)?.[1];
  const errorCode = response.match(/<ErrorCode\b[^>]*\bValue="([^"]*)"/i)?.[1];
  const trace: SalsaPublisherTrace = {
    at: new Date().toISOString(),
    method,
    success,
    error: error ?? undefined,
    errorCode,
    token,
    requestXml: xml,
    responseXml: response,
  };
  lastTrace = trace;
  if (!success) {
    lastFailure = trace;
    console.error(
      `[Salsa] FALHA ${method} code=${errorCode ?? "-"} error=${error ?? "-"} token=${token ?? "-"}`,
    );
    console.error(`[Salsa] Último XML (request):`, xml.replace(/\s+/g, " ").slice(0, 2000));
  } else {
    console.log(`[Salsa] OK ${method} token=${token ?? "-"}`);
  }
}

function checkSalsaHash(paramsValue: string, hash: string): boolean {
  return validateSalsaHash(paramsValue, hash, activeHashKey);
}

async function loadSessionByToken(token: string) {
  return prisma.gameSession.findUnique({
    where: { sessionToken: token },
    include: { game: { include: { provider: true } }, client: true },
  });
}

async function playerBalanceCents(session: {
  clientId: string;
  externalUserId: string;
  currency: string;
}) {
  try {
    const balance = await getWalletBalance(session.clientId, session.externalUserId, session.currency);
    return moneyToCents(balance);
  } catch (err) {
    console.warn("[Salsa] wallet remoto indisponível, usando saldo local:", err);
    const wallet = await getOrCreateWallet({
      clientId: session.clientId,
      externalUserId: session.externalUserId,
      currency: session.currency,
    });
    return moneyToCents(Number(wallet.balance));
  }
}

function hashError(method: string, balanceCents?: number, currency?: string) {
  return salsaFailure(method, "Invalid Hash", "7000", {
    ...(balanceCents !== undefined ? { Balance: balanceCents, Currency: currency ?? "BRL" } : {}),
  });
}

function expiredError(method: string, balanceCents?: number, currency?: string) {
  return salsaFailure(method, "Token Expired", "2", {
    ...(balanceCents !== undefined ? { Balance: balanceCents, Currency: currency ?? "BRL" } : {}),
  });
}

function isInsufficientWalletError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /insufficient/i.test(msg);
}

function sessionIsExpired(session: { expiresAt: Date; isActive: boolean }): boolean {
  return !session.isActive || session.expiresAt.getTime() <= Date.now();
}

async function provisionSalsaSession(token: string, loginName?: string) {
  const existing = await loadSessionByToken(token);
  if (existing) return existing;

  const { ensureGpiValidationGame } = await import("./salsa-sync.service.js");
  const gpiGame = await ensureGpiValidationGame();
  const client = await prisma.client.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });
  const game =
    gpiGame ??
    (await prisma.game.findFirst({
      where: { engine: "EXTERNAL", isActive: true },
    }));

  if (!client || !game) {
    throw new Error("Sem cliente/jogo Salsa para criar sessão GPI");
  }

  const externalUserId = (loginName?.trim() || `gpi-${token.replace(/-/g, "").slice(0, 16)}`).slice(0, 64);

  await prisma.playerWallet.upsert({
    where: {
      clientId_externalUserId_currency: {
        clientId: client.id,
        externalUserId,
        currency: "BRL",
      },
    },
    create: {
      clientId: client.id,
      externalUserId,
      currency: "BRL",
      balance: 10_000,
    },
    update: {},
  });

  return prisma.gameSession.create({
    data: {
      clientId: client.id,
      gameId: game.id,
      externalUserId,
      sessionToken: token,
      balance: 10_000,
      currency: "BRL",
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    },
    include: { game: { include: { provider: true } }, client: true },
  });
}

function isUsableSalsaToken(token: string): boolean {
  const t = token.trim();
  if (t.length < 8) return false;
  if (t.includes(":")) return false;
  if (t.startsWith("{") || t.startsWith("$")) return false;
  if (/^token$/i.test(t)) return false;
  return true;
}

async function applyWalletCredit(session: {
  clientId: string;
  externalUserId: string;
  currency: string;
  game: { slug: string };
  sessionToken: string;
}, amount: number, spinId: string): Promise<number> {
  if (amount <= 0) {
    return moneyToCents(await getWalletBalance(session.clientId, session.externalUserId, session.currency).catch(async () => {
      const w = await getOrCreateWallet({
        clientId: session.clientId,
        externalUserId: session.externalUserId,
        currency: session.currency,
      });
      return Number(w.balance);
    }));
  }

  const walletConfig = await getClientWalletConfig(session.clientId);
  if (walletConfig) {
    const walletResult = await processWalletSpin(walletConfig, {
      externalUserId: session.externalUserId,
      gameSlug: session.game.slug,
      betAmount: 0,
      winAmount: amount,
      gameFeeAmount: 0,
      clientFeeAmount: 0,
      gameFeePct: 0,
      clientFeePct: 0,
      spinId,
      sessionId: session.sessionToken,
      currency: session.currency,
    });
    return moneyToCents(walletResult.balanceAfter);
  }

  const winTx = await creditWin({
    clientId: session.clientId,
    externalUserId: session.externalUserId,
    winAmount: amount,
    currency: session.currency,
    referenceId: spinId,
  });
  return moneyToCents(winTx.balanceAfter);
}

async function resolveSalsaSession(
  method: string,
  token: string,
  hash: string,
  hashMaterial: string,
  options?: { provision?: boolean; loginName?: string },
) {
  if (!token.trim()) {
    return { error: salsaFailure(method, "Invalid request", "1") };
  }
  if (!isUsableSalsaToken(token)) {
    return { error: expiredError(method) };
  }

  const existing = await loadSessionByToken(token);

  if (!checkSalsaHash(hashMaterial, hash)) {
    if (existing) {
      try {
        return { error: hashError(method, await playerBalanceCents(existing), existing.currency) };
      } catch {
        return { error: hashError(method) };
      }
    }
    return { error: hashError(method) };
  }

  let session = existing;
  if (!session && options?.provision && isUsableSalsaToken(token)) {
    session = await provisionSalsaSession(token, options.loginName);
  }
  if (!session) {
    return { error: expiredError(method) };
  }
  if (sessionIsExpired(session)) {
    try {
      return { error: expiredError(method, await playerBalanceCents(session), session.currency) };
    } catch {
      return { error: expiredError(method) };
    }
  }
  return { session };
}

async function findSalsaTx(
  salsaTransactionId: string,
  referenceNum: string,
  kind: SalsaTxKind,
) {
  return prisma.salsaTransaction.findUnique({
    where: {
      salsaTransactionId_referenceNum_kind: {
        salsaTransactionId,
        referenceNum,
        kind,
      },
    },
  });
}

async function handleGetAccountDetails(params: Record<string, string>) {
  const token = salsaParam(params, "Token");
  const hash = salsaParam(params, "Hash");
  try {
    const resolved = await resolveSalsaSession("GetAccountDetails", token, hash, token, {
      provision: true,
      loginName: salsaParam(params, "LoginName", "UserName", "UserId"),
    });
    if (resolved.error) return resolved.error;
    const session = resolved.session!;

    return salsaSuccess("GetAccountDetails", {
      Token: token,
      LoginName: session.externalUserId,
      Currency: session.currency,
      Country: "BR",
      Birthdate: "1990-01-01",
      Registration: "2020-01-01",
      Gender: "m",
    });
  } catch (e) {
    return salsaFailure(
      "GetAccountDetails",
      e instanceof Error ? e.message : "GetAccountDetails failed.",
      "6001",
    );
  }
}

async function handleGetBalance(params: Record<string, string>) {
  const token = salsaParam(params, "Token");
  const hash = salsaParam(params, "Hash");
  try {
    const resolved = await resolveSalsaSession("GetBalance", token, hash, token, {
      provision: true,
      loginName: salsaParam(params, "LoginName", "UserName", "UserId"),
    });
    if (resolved.error) return resolved.error;
    const session = resolved.session!;

    const balance = await playerBalanceCents(session);
    return salsaSuccess("GetBalance", {
      Token: token,
      Balance: balance,
      Currency: session.currency,
    });
  } catch (e) {
    return salsaFailure("GetBalance", e instanceof Error ? e.message : "GetBalance failed.", "6002");
  }
}

async function handlePlaceBet(params: Record<string, string>) {
  const token = salsaParam(params, "Token");
  const transactionId = salsaParam(params, "TransactionID");
  const referenceNum = salsaParam(params, "BetReferenceNum");
  const betCents = Number(salsaParam(params, "BetAmount") || 0);
  const hash = salsaParam(params, "Hash");

  const resolved = await resolveSalsaSession(
    "PlaceBet",
    token,
    hash,
    transactionId + referenceNum + token,
  );
  if (resolved.error) return resolved.error;
  const session = resolved.session!;

  const balanceBefore = await playerBalanceCents(session);

  const existing = await findSalsaTx(transactionId, referenceNum, "PLACE_BET");
  if (existing) {
    const balance = await playerBalanceCents(session);
    return salsaSuccess("PlaceBet", {
      Token: token,
      Balance: balance,
      Currency: session.currency,
      ExtTransactionID: existing.extTransactionNum,
      AlreadyProcessed: true,
      InProgress: false,
    });
  }

  const betAmount = centsToMoney(betCents);
  if (betAmount > 0 && balanceBefore < betCents) {
    return salsaFailure("PlaceBet", "Insufficient funds", "6", {
      Balance: balanceBefore,
      Currency: session.currency,
    });
  }

  const feeBreakdown = await resolveClientGameFees({
    clientId: session.clientId,
    gameId: session.game.id,
    categoryId: session.game.categoryId,
    defaultProviderCostPct: Number(session.game.aggregatorFeePct),
    defaultClientMarginPct: Number(session.client.marginPct),
  });
  const fees = resolveSpinFees({
    betAmount,
    gameFeePct: feeBreakdown.gameFeePct,
    clientFeePct: feeBreakdown.clientFeePct,
  });
  const spinId = crypto.randomUUID();
  const extNum = extTransactionNum(`${transactionId}:${referenceNum}:bet`);

  const walletConfig = await getClientWalletConfig(session.clientId);
  let balanceAfterCents = balanceBefore;

  try {
    if (betAmount > 0) {
      if (walletConfig) {
        try {
          const walletResult = await processWalletSpin(walletConfig, {
            externalUserId: session.externalUserId,
            gameSlug: session.game.slug,
            betAmount,
            winAmount: 0,
            gameFeeAmount: fees.gameFeeAmount,
            clientFeeAmount: fees.clientFeeAmount,
            gameFeePct: fees.gameFeePct,
            clientFeePct: fees.clientFeePct,
            spinId,
            sessionId: session.sessionToken,
            currency: session.currency,
          });
          balanceAfterCents = moneyToCents(walletResult.balanceAfter);
        } catch (err) {
          if (isInsufficientWalletError(err)) {
            return salsaFailure("PlaceBet", "Insufficient funds", "6", {
              Balance: balanceBefore,
              Currency: session.currency,
            });
          }
          throw err;
        }
      } else {
        const betTx = await debitBet({
          clientId: session.clientId,
          externalUserId: session.externalUserId,
          betAmount,
          currency: session.currency,
          referenceId: spinId,
        });
        balanceAfterCents = moneyToCents(betTx.balanceAfter);
      }
    }

    await prisma.$transaction([
      prisma.gameSpin.create({
        data: {
          id: spinId,
          sessionId: session.id,
          betAmount,
          winAmount: 0,
          gameFeeAmount: fees.gameFeeAmount,
          clientFeeAmount: fees.clientFeeAmount,
          gameFeePct: fees.gameFeePct,
          clientFeePct: fees.clientFeePct,
          balanceBefore: centsToMoney(balanceBefore),
          balanceAfter: centsToMoney(balanceAfterCents),
          externalTxId: `${transactionId}:${referenceNum}`,
          result: { source: "salsa", type: "PlaceBet", gameReference: params.GameReference },
        },
      }),
      prisma.salsaTransaction.create({
        data: {
          sessionId: session.id,
          salsaTransactionId: transactionId,
          referenceNum,
          kind: "PLACE_BET",
          amountCents: betCents,
          gameReference: params.GameReference ?? null,
          extTransactionNum: extNum,
          spinId,
        },
      }),
      prisma.gameSession.update({
        where: { id: session.id },
        data: { balance: centsToMoney(balanceAfterCents) },
      }),
    ]);

    if (fees.totalFeeAmount > 0) {
      await debitClientFees({
        clientId: session.clientId,
        gameFeeAmount: fees.gameFeeAmount,
        clientFeeAmount: fees.clientFeeAmount,
        referenceId: spinId,
      });
    }
  } catch (e) {
    if (isInsufficientWalletError(e)) {
      return salsaFailure("PlaceBet", "Insufficient funds", "6", {
        Balance: balanceBefore,
        Currency: session.currency,
      });
    }
    return salsaFailure("PlaceBet", e instanceof Error ? e.message : "Bet failed.", "6002", {
      Balance: balanceBefore,
      Currency: session.currency,
    });
  }

  return salsaSuccess("PlaceBet", {
    Token: token,
    Balance: balanceAfterCents,
    Currency: session.currency,
    ExtTransactionID: extNum,
    AlreadyProcessed: false,
    InProgress: false,
  });
}

async function handleAwardWinnings(params: Record<string, string>) {
  const token = salsaParam(params, "Token");
  const transactionId = salsaParam(params, "TransactionID");
  const referenceNum = salsaParam(params, "WinReferenceNum");
  const winCents = Number(salsaParam(params, "WinAmount") || 0);
  const hash = salsaParam(params, "Hash");

  const resolved = await resolveSalsaSession(
    "AwardWinnings",
    token,
    hash,
    transactionId + referenceNum + token,
  );
  if (resolved.error) return resolved.error;
  const session = resolved.session!;

  const balanceBefore = await playerBalanceCents(session);

  const existing = await findSalsaTx(transactionId, referenceNum, "AWARD_WINNINGS");
  if (existing) {
    const balance = await playerBalanceCents(session);
    return salsaSuccess("AwardWinnings", {
      Token: token,
      Balance: balance,
      Currency: session.currency,
      ExtTransactionID: existing.extTransactionNum,
      AlreadyProcessed: true,
      InProgress: false,
    });
  }

  const winAmount = centsToMoney(winCents);
  const spinId = crypto.randomUUID();
  const extNum = extTransactionNum(`${transactionId}:${referenceNum}:win`);
  let balanceAfterCents = balanceBefore;

  try {
    if (winAmount > 0) {
      balanceAfterCents = await applyWalletCredit(session, winAmount, spinId);
    }

    await prisma.$transaction([
      prisma.gameSpin.create({
        data: {
          id: spinId,
          sessionId: session.id,
          betAmount: 0,
          winAmount,
          balanceBefore: centsToMoney(balanceBefore),
          balanceAfter: centsToMoney(balanceAfterCents),
          externalTxId: `${transactionId}:${referenceNum}`,
          result: {
            source: "salsa",
            type: "AwardWinnings",
            gameStatus: params.GameStatus,
            gameReference: params.GameReference,
          },
        },
      }),
      prisma.salsaTransaction.create({
        data: {
          sessionId: session.id,
          salsaTransactionId: transactionId,
          referenceNum,
          kind: "AWARD_WINNINGS",
          amountCents: winCents,
          gameReference: params.GameReference ?? null,
          extTransactionNum: extNum,
          spinId,
        },
      }),
      prisma.gameSession.update({
        where: { id: session.id },
        data: { balance: centsToMoney(balanceAfterCents) },
      }),
    ]);
  } catch (e) {
    return salsaFailure("AwardWinnings", e instanceof Error ? e.message : "Win failed.", "6003", {
      Balance: balanceBefore,
      Currency: session.currency,
    });
  }

  return salsaSuccess("AwardWinnings", {
    Token: token,
    Balance: balanceAfterCents,
    Currency: session.currency,
    ExtTransactionID: extNum,
    AlreadyProcessed: false,
    InProgress: false,
  });
}

async function handleRefundBet(params: Record<string, string>) {
  const token = salsaParam(params, "Token");
  const transactionId = salsaParam(params, "TransactionID");
  const referenceNum = salsaParam(params, "BetReferenceNum");
  const refundCents = Number(salsaParam(params, "RefundAmount") || 0);
  const hash = salsaParam(params, "Hash");

  const resolved = await resolveSalsaSession(
    "RefundBet",
    token,
    hash,
    transactionId + referenceNum + token,
  );
  if (resolved.error) return resolved.error;
  const session = resolved.session!;

  const balanceBefore = await playerBalanceCents(session);

  const existing = await findSalsaTx(transactionId, referenceNum, "REFUND_BET");
  if (existing) {
    const balance = await playerBalanceCents(session);
    return salsaSuccess("RefundBet", {
      Token: token,
      Balance: balance,
      Currency: session.currency,
      ExtTransactionID: existing.extTransactionNum,
      AlreadyProcessed: true,
      InProgress: false,
    });
  }

  const originalBet = await findSalsaTx(transactionId, referenceNum, "PLACE_BET");
  const refundAmount = centsToMoney(refundCents);
  const spinId = crypto.randomUUID();
  const extNum = extTransactionNum(`${transactionId}:${referenceNum}:refund`);
  let balanceAfterCents = balanceBefore;

  if (originalBet && refundAmount > 0) {
    try {
      balanceAfterCents = await applyWalletCredit(session, refundAmount, spinId);

      await prisma.$transaction([
        prisma.salsaTransaction.create({
          data: {
            sessionId: session.id,
            salsaTransactionId: transactionId,
            referenceNum,
            kind: "REFUND_BET",
            amountCents: refundCents,
            gameReference: params.GameReference ?? null,
            extTransactionNum: extNum,
            spinId,
          },
        }),
        prisma.gameSession.update({
          where: { id: session.id },
          data: { balance: centsToMoney(balanceAfterCents) },
        }),
      ]);
    } catch (e) {
      return salsaFailure("RefundBet", e instanceof Error ? e.message : "Refund failed.", "6004", {
        Balance: balanceBefore,
        Currency: session.currency,
      });
    }
  } else {
    await prisma.salsaTransaction.create({
      data: {
        sessionId: session.id,
        salsaTransactionId: transactionId,
        referenceNum,
        kind: "REFUND_BET",
        amountCents: refundCents,
        gameReference: params.GameReference ?? null,
        extTransactionNum: extNum,
      },
    });
  }

  return salsaSuccess("RefundBet", {
    Token: token,
    Balance: balanceAfterCents,
    Currency: session.currency,
    ExtTransactionID: extNum,
    AlreadyProcessed: false,
    InProgress: false,
  });
}

async function handleChangeGameToken(params: Record<string, string>) {
  const token = salsaParam(params, "Token");
  const newGameRef = salsaParam(params, "NewGameReference");
  const hash = salsaParam(params, "Hash");

  const resolved = await resolveSalsaSession("ChangeGameToken", token, hash, newGameRef + token);
  if (resolved.error) return resolved.error;
  const session = resolved.session!;

  const newGame =
    (newGameRef
      ? await prisma.game.findFirst({
          where: {
            isActive: true,
            provider: { isActive: true },
            OR: [{ externalGameId: newGameRef }, { name: newGameRef }, { slug: newGameRef }],
          },
        })
      : null) ?? session.game;

  const newToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const balance = await getWalletBalance(
    session.clientId,
    session.externalUserId,
    session.currency,
  );

  await prisma.$transaction([
    prisma.gameSession.updateMany({
      where: {
        clientId: session.clientId,
        externalUserId: session.externalUserId,
        isActive: true,
      },
      data: { isActive: false },
    }),
    prisma.gameSession.create({
      data: {
        clientId: session.clientId,
        gameId: newGame.id,
        externalUserId: session.externalUserId,
        sessionToken: newToken,
        balance,
        currency: session.currency,
        expiresAt,
      },
    }),
  ]);

  return salsaSuccess("ChangeGameToken", {
    Token: token,
    NewToken: newToken,
    Balance: moneyToCents(balance),
    Currency: session.currency,
  });
}

export async function handleSalsaPublisherRequest(xml: string): Promise<string> {
  const { getSalsaRuntimeConfig } = await import("./salsa-config.service.js");
  const cfg = await getSalsaRuntimeConfig();

  if (!cfg.enabled) {
    return salsaFailure("Unknown", "Salsa integration disabled.", "9000");
  }

  if (!cfg.hashKey) {
    return salsaFailure("Unknown", "SALSA_HASH_KEY not configured.", "9001");
  }

  activeHashKey = cfg.hashKey;
  const parsed = parseSalsaRequest(xml);
  console.log(
    "[Salsa] Publisher",
    parsed?.method ?? "unparsed",
    String(xml).replace(/\s+/g, " ").slice(0, 240),
  );
  if (!parsed) {
    const response = salsaFailure("Unknown", "Invalid XML packet.", "9002");
    recordPublisherTrace(xml, "Unknown", undefined, response);
    return response;
  }

  const { method, params } = parsed;
  let response: string;
  try {
    switch (method) {
      case "GetAccountDetails":
        response = await handleGetAccountDetails(params);
        break;
      case "GetBalance":
        response = await handleGetBalance(params);
        break;
      case "PlaceBet":
        response = await handlePlaceBet(params);
        break;
      case "AwardWinnings":
        response = await handleAwardWinnings(params);
        break;
      case "RefundBet":
        response = await handleRefundBet(params);
        break;
      case "ChangeGameToken":
        response = await handleChangeGameToken(params);
        break;
      default:
        response = salsaFailure(method, `Unknown method: ${method}`, "9003");
    }
  } catch (e) {
    response = salsaFailure(
      method,
      e instanceof Error ? e.message : "Internal error",
      "500",
    );
  }
  recordPublisherTrace(xml, method, salsaParam(params, "Token") || undefined, response);
  return response;
}
