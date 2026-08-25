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
  getWalletBalance,
} from "../player-wallet.service.js";
import { getClientWalletConfig, processWalletSpin } from "../wallet.service.js";
import { debitClientFees } from "../client-wallet.service.js";
import { salsaFailure, salsaSuccess, parseSalsaRequest } from "./salsa-xml.js";
import type { SalsaTxKind } from "../../../generated/prisma/client.js";

let activeHashKey: string | undefined;

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
  const balance = await getWalletBalance(session.clientId, session.externalUserId, session.currency);
  return moneyToCents(balance);
}

function hashError(method: string, balanceCents: number, currency: string) {
  return salsaFailure(method, "Invalid Hash.", "7000", {
    Balance: balanceCents,
    Currency: currency,
  });
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

async function handleGetAccountDetails(token: string, hash: string) {
  const session = await loadSessionByToken(token);
  if (!session) {
    return salsaFailure("GetAccountDetails", "Invalid token.", "6001");
  }

  if (!checkSalsaHash(token, hash)) {
    return hashError("GetAccountDetails", await playerBalanceCents(session), session.currency);
  }

  return salsaSuccess("GetAccountDetails", {
    Token: token,
    LoginName: session.externalUserId,
    Currency: session.currency,
    Country: "BR",
    Birthdate: "1990-01-01",
    Registration: "2020-01-01",
    Gender: "m",
  });
}

async function handleGetBalance(token: string, hash: string) {
  const session = await loadSessionByToken(token);
  if (!session) {
    return salsaFailure("GetBalance", "Invalid token.", "6001");
  }

  if (!checkSalsaHash(token, hash)) {
    return hashError("GetBalance", await playerBalanceCents(session), session.currency);
  }

  const balance = await playerBalanceCents(session);
  return salsaSuccess("GetBalance", {
    Token: token,
    Balance: balance,
    Currency: session.currency,
  });
}

async function handlePlaceBet(params: Record<string, string>) {
  const token = params.Token ?? "";
  const transactionId = params.TransactionID ?? "";
  const referenceNum = params.BetReferenceNum ?? "";
  const betCents = Number(params.BetAmount ?? 0);
  const hash = params.Hash ?? "";

  const session = await loadSessionByToken(token);
  if (!session) {
    return salsaFailure("PlaceBet", "Invalid token.", "6001");
  }

  const balanceBefore = await playerBalanceCents(session);
  if (!checkSalsaHash(transactionId + referenceNum + token, hash)) {
    return hashError("PlaceBet", balanceBefore, session.currency);
  }

  const existing = await findSalsaTx(transactionId, referenceNum, "PLACE_BET");
  if (existing) {
    const balance = await playerBalanceCents(session);
    return salsaSuccess("PlaceBet", {
      Token: token,
      Balance: balance,
      Currency: session.currency,
      ExtTransactionID: existing.extTransactionNum.toString(),
      AlreadyProcessed: true,
    });
  }

  const betAmount = centsToMoney(betCents);
  if (betAmount > 0 && balanceBefore < betCents) {
    return salsaFailure("PlaceBet", "Insufficient balance.", "6002", {
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
    if (walletConfig && betAmount > 0) {
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
      if (!walletResult.ok) {
        return salsaFailure("PlaceBet", walletResult.error ?? "Wallet error.", "6002", {
          Balance: balanceBefore,
          Currency: session.currency,
        });
      }
      balanceAfterCents = moneyToCents(walletResult.balanceAfter);
    } else if (betAmount > 0) {
      const betTx = await debitBet({
        clientId: session.clientId,
        externalUserId: session.externalUserId,
        betAmount,
        currency: session.currency,
        referenceId: spinId,
      });
      balanceAfterCents = moneyToCents(betTx.balanceAfter);
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
    return salsaFailure("PlaceBet", e instanceof Error ? e.message : "Bet failed.", "6002", {
      Balance: balanceBefore,
      Currency: session.currency,
    });
  }

  return salsaSuccess("PlaceBet", {
    Token: token,
    Balance: balanceAfterCents,
    Currency: session.currency,
    ExtTransactionID: extNum.toString(),
    AlreadyProcessed: false,
  });
}

async function handleAwardWinnings(params: Record<string, string>) {
  const token = params.Token ?? "";
  const transactionId = params.TransactionID ?? "";
  const referenceNum = params.WinReferenceNum ?? "";
  const winCents = Number(params.WinAmount ?? 0);
  const hash = params.Hash ?? "";

  const session = await loadSessionByToken(token);
  if (!session) {
    return salsaFailure("AwardWinnings", "Invalid token.", "6001");
  }

  const balanceBefore = await playerBalanceCents(session);
  if (!checkSalsaHash(transactionId + referenceNum + token, hash)) {
    return hashError("AwardWinnings", balanceBefore, session.currency);
  }

  const existing = await findSalsaTx(transactionId, referenceNum, "AWARD_WINNINGS");
  if (existing) {
    const balance = await playerBalanceCents(session);
    return salsaSuccess("AwardWinnings", {
      Token: token,
      Balance: balance,
      Currency: session.currency,
      ExtTransactionID: existing.extTransactionNum.toString(),
      AlreadyProcessed: true,
    });
  }

  const winAmount = centsToMoney(winCents);
  const spinId = crypto.randomUUID();
  const extNum = extTransactionNum(`${transactionId}:${referenceNum}:win`);
  let balanceAfterCents = balanceBefore;

  try {
    if (winAmount > 0) {
      const walletConfig = await getClientWalletConfig(session.clientId);
      if (walletConfig) {
        const walletResult = await processWalletSpin(walletConfig, {
          externalUserId: session.externalUserId,
          gameSlug: session.game.slug,
          betAmount: 0,
          winAmount,
          gameFeeAmount: 0,
          clientFeeAmount: 0,
          gameFeePct: 0,
          clientFeePct: 0,
          spinId,
          sessionId: session.sessionToken,
          currency: session.currency,
        });
        if (!walletResult.ok) {
          return salsaFailure("AwardWinnings", walletResult.error ?? "Wallet error.", "6003", {
            Balance: balanceBefore,
            Currency: session.currency,
          });
        }
        balanceAfterCents = moneyToCents(walletResult.balanceAfter);
      } else {
        const winTx = await creditWin({
          clientId: session.clientId,
          externalUserId: session.externalUserId,
          winAmount,
          currency: session.currency,
          referenceId: spinId,
        });
        balanceAfterCents = moneyToCents(winTx.balanceAfter);
      }
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
    ExtTransactionID: extNum.toString(),
    AlreadyProcessed: false,
  });
}

async function handleRefundBet(params: Record<string, string>) {
  const token = params.Token ?? "";
  const transactionId = params.TransactionID ?? "";
  const referenceNum = params.BetReferenceNum ?? "";
  const refundCents = Number(params.RefundAmount ?? 0);
  const hash = params.Hash ?? "";

  const session = await loadSessionByToken(token);
  if (!session) {
    return salsaFailure("RefundBet", "Invalid token.", "6001");
  }

  const balanceBefore = await playerBalanceCents(session);
  if (!checkSalsaHash(transactionId + referenceNum + token, hash)) {
    return hashError("RefundBet", balanceBefore, session.currency);
  }

  const existing = await findSalsaTx(transactionId, referenceNum, "REFUND_BET");
  if (existing) {
    const balance = await playerBalanceCents(session);
    return salsaSuccess("RefundBet", {
      Token: token,
      Balance: balance,
      Currency: session.currency,
      ExtTransactionID: existing.extTransactionNum.toString(),
      AlreadyProcessed: true,
    });
  }

  const originalBet = await findSalsaTx(transactionId, referenceNum, "PLACE_BET");
  const refundAmount = centsToMoney(refundCents);
  const spinId = crypto.randomUUID();
  const extNum = extTransactionNum(`${transactionId}:${referenceNum}:refund`);
  let balanceAfterCents = balanceBefore;

  if (originalBet && refundAmount > 0) {
    try {
      const winTx = await creditWin({
        clientId: session.clientId,
        externalUserId: session.externalUserId,
        winAmount: refundAmount,
        currency: session.currency,
        referenceId: spinId,
      });
      balanceAfterCents = moneyToCents(winTx.balanceAfter);

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
    ExtTransactionID: extNum.toString(),
    AlreadyProcessed: false,
  });
}

async function handleChangeGameToken(params: Record<string, string>) {
  const token = params.Token ?? "";
  const newGameRef = params.NewGameReference ?? "";
  const hash = params.Hash ?? "";

  const session = await loadSessionByToken(token);
  if (!session) {
    return salsaFailure("ChangeGameToken", "Invalid token.", "6001");
  }

  if (!checkSalsaHash(newGameRef + token, hash)) {
    return salsaFailure("ChangeGameToken", "Invalid Hash.", "7000");
  }

  const newGame = await prisma.game.findFirst({
    where: { externalGameId: newGameRef, isActive: true, provider: { isActive: true } },
  });
  if (!newGame) {
    return salsaFailure("ChangeGameToken", "Game not found.", "6005");
  }

  const newToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const balance = await getWalletBalance(
    session.clientId,
    session.externalUserId,
    session.currency,
  );

  await prisma.gameSession.create({
    data: {
      clientId: session.clientId,
      gameId: newGame.id,
      externalUserId: session.externalUserId,
      sessionToken: newToken,
      balance,
      currency: session.currency,
      expiresAt,
    },
  });

  return salsaSuccess("ChangeGameToken", { NewToken: newToken });
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
    return salsaFailure("Unknown", "Invalid XML packet.", "9002");
  }

  const { method, params } = parsed;

  switch (method) {
    case "GetAccountDetails":
      return handleGetAccountDetails(params.Token ?? "", params.Hash ?? "");
    case "GetBalance":
      return handleGetBalance(params.Token ?? "", params.Hash ?? "");
    case "PlaceBet":
      return handlePlaceBet(params);
    case "AwardWinnings":
      return handleAwardWinnings(params);
    case "RefundBet":
      return handleRefundBet(params);
    case "ChangeGameToken":
      return handleChangeGameToken(params);
    default:
      return salsaFailure(method, `Unknown method: ${method}`, "9003");
  }
}
