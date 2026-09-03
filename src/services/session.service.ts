import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { generateSessionToken } from "../lib/utils.js";
import { buildLaunchUrl, isExternalLaunchGame } from "./game.service.js";
import { env } from "../config/env.js";
import { buildSalsaLaunchUrl, isLocalHostname, salsaPublisherUrl } from "../config/salsa.js";
import { UNI_SALSA, uniPn, type UniEnvironment } from "../config/uni.js";
import { resolveSpinFees } from "./fee.service.js";
import { resolveClientGameFees } from "./client-game-fees.service.js";
import { debitBet, creditWin, getWalletBalance } from "./player-wallet.service.js";
import { debitClientFees } from "./client-wallet.service.js";
import { getClientWalletConfig, processWalletSpin } from "./wallet.service.js";
import type { GameLaunchPayload } from "../types/index.js";

const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const SALSA_SESSION_TTL_MS = 48 * 60 * 60 * 1000;

export async function createGameSession(input: {
  clientId: string;
  gameId: number;
  externalUserId: string;
  currency?: string;
  environment?: UniEnvironment;
}): Promise<GameLaunchPayload> {
  const [game, client] = await Promise.all([
    prisma.game.findUnique({
      where: { id: input.gameId },
      include: { provider: true },
    }),
    prisma.client.findUnique({
      where: { id: input.clientId },
      select: { marginPct: true, launchEnvironment: true },
    }),
  ]);

  if (!game || !game.isActive) throw new Error("Game not found or inactive");
  if (!game.provider.isActive) throw new Error("Game provider is disabled");
  if (!client) throw new Error("Client not found");
  const { canClientAccessGame } = await import("../entitlements/entitlement.service.js");
  if (!(await canClientAccessGame(input.clientId, game))) {
    throw new Error("Game not entitled for this client");
  }

  const isExternal = isExternalLaunchGame(game) || game.provider.integration === "SALSA";
  if (isExternal && !game.externalGameId) {
    throw new Error("Jogo externo sem código — rode o sync do catálogo");
  }
  if (isExternal) {
    const { getSalsaRuntimeConfig } = await import("./salsa/salsa-config.service.js");
    const salsaCfg = await getSalsaRuntimeConfig();
    if (!salsaCfg.enabled) {
      throw new Error("Catálogo externo desabilitado — ative na aba Integrações");
    }
  }

  const currency = input.currency ?? "BRL";
  const balance = await getWalletBalance(input.clientId, input.externalUserId, currency);

  const feeBreakdown = await resolveClientGameFees({
    clientId: input.clientId,
    gameId: game.id,
    categoryId: game.categoryId,
    providerId: game.providerId,
    defaultProviderCostPct: Number(game.aggregatorFeePct),
    defaultClientMarginPct: Number(client.marginPct),
  });

  const sessionToken = isExternal ? crypto.randomUUID() : generateSessionToken();
  const expiresAt = new Date(Date.now() + (isExternal ? SALSA_SESSION_TTL_MS : SESSION_TTL_MS));

  await prisma.gameSession.create({
    data: {
      clientId: input.clientId,
      gameId: input.gameId,
      externalUserId: input.externalUserId,
      sessionToken,
      balance,
      currency,
      expiresAt,
    },
  });

  const apiBridge = `${env.PUBLIC_BASE_URL}/api/v1/game/${sessionToken}`;
  const gpiValidation =
    game.slug === "gpi-validation" || game.externalGameId === "gpi-validation";
  const environment: UniEnvironment =
    input.environment ?? (client.launchEnvironment === "LIVE" ? "live" : "test");
  if (isExternal && environment === "live" && !env.SALSA_PN_LIVE) {
    throw new Error(
      "Launch em produção exige SALSA_PN_LIVE no EasyPanel do aggregator (PN de produção da Salsa, não o de staging).",
    );
  }
  const salsaEnv = UNI_SALSA[environment];
  const launchUrl = isExternal
    ? buildSalsaLaunchUrl({
        token: sessionToken,
        gameCode: gpiValidation ? "gpi-validation" : game.externalGameId!,
        openurl: gpiValidation ? null : game.externalUrl,
        currency,
        lang: "pt",
        apiBase: salsaEnv.apiBase,
        type: salsaEnv.launchType,
        pn: uniPn(salsaEnv.id),
      })
    : `${buildLaunchUrl(game)}?sessionToken=${sessionToken}&apiUrl=${encodeURIComponent(apiBridge)}`;

  const publisher = salsaPublisherUrl();
  const warning =
    isExternal && isLocalHostname(publisher)
      ? "A Salsa não alcança localhost. Suba um túnel (cloudflared/ngrok) e defina SALSA_PUBLISHER_URL com a URL pública /api/v1/salsa/publisher."
      : undefined;

  return {
    sessionId: sessionToken,
    sessionToken,
    gameSlug: game.slug,
    launchUrl,
    environment,
    expiresAt: expiresAt.toISOString(),
    balance,
    warning,
    fees: {
      gameFeePct: feeBreakdown.gameFeePct,
      clientFeePct: feeBreakdown.clientFeePct,
      totalChargePct: feeBreakdown.totalChargePct,
      providerCostPct: feeBreakdown.providerCostPct,
    },
  };
}

export async function getSessionBalance(sessionToken: string) {
  const session = await prisma.gameSession.findUnique({
    where: { sessionToken },
    include: {
      game: { select: { slug: true, name: true, aggregatorFeePct: true, categoryId: true, providerId: true } },
      client: { select: { marginPct: true } },
    },
  });

  if (!session || !session.isActive || session.expiresAt < new Date()) return null;

  const balance = await getWalletBalance(session.clientId, session.externalUserId, session.currency);

  await prisma.gameSession.update({ where: { id: session.id }, data: { balance } });

  const feeBreakdown = await resolveClientGameFees({
    clientId: session.clientId,
    gameId: session.gameId,
    categoryId: session.game.categoryId,
    providerId: session.game.providerId,
    defaultProviderCostPct: Number(session.game.aggregatorFeePct),
    defaultClientMarginPct: Number(session.client.marginPct),
  });

  return {
    balance,
    currency: session.currency,
    game: session.game,
    externalUserId: session.externalUserId,
    fees: {
      gameFeePct: feeBreakdown.gameFeePct,
      clientFeePct: feeBreakdown.clientFeePct,
      totalChargePct: feeBreakdown.totalChargePct,
      providerCostPct: feeBreakdown.providerCostPct,
    },
  };
}

export async function getSessionByToken(sessionToken: string) {
  return prisma.gameSession.findUnique({
    where: { sessionToken },
    include: { game: true, client: true },
  });
}

export async function processSpin(input: {
  sessionToken: string;
  betAmount: number;
  winAmount?: number;
}) {
  const session = await prisma.gameSession.findUnique({
    where: { sessionToken: input.sessionToken },
    include: { game: true, client: true },
  });

  if (!session || !session.isActive || session.expiresAt < new Date()) {
    throw new Error("Invalid session");
  }

  const minBet = session.game.minBet ? Number(session.game.minBet) : 0.1;
  const maxBet = session.game.maxBet ? Number(session.game.maxBet) : 1000;
  if (input.betAmount > 0 && (input.betAmount < minBet || input.betAmount > maxBet)) {
    throw new Error(`Bet must be between ${minBet} and ${maxBet}`);
  }

  const feeBreakdown = await resolveClientGameFees({
    clientId: session.clientId,
    gameId: session.game.id,
    categoryId: session.game.categoryId,
    providerId: session.game.providerId,
    defaultProviderCostPct: Number(session.game.aggregatorFeePct),
    defaultClientMarginPct: Number(session.client.marginPct),
  });
  const fees = resolveSpinFees({
    betAmount: input.betAmount,
    gameFeePct: feeBreakdown.gameFeePct,
    clientFeePct: feeBreakdown.clientFeePct,
  });

  let winAmount = input.winAmount;
  if (winAmount === undefined) {
    throw new Error("winAmount required — use rtp-pool before processSpin");
  }

  const spinId = crypto.randomUUID();
  const balanceBefore = await getWalletBalance(
    session.clientId,
    session.externalUserId,
    session.currency,
  );

  if (input.betAmount > 0 && balanceBefore < input.betAmount) throw new Error("Insufficient balance");

  const walletConfig = await getClientWalletConfig(session.clientId);
  let balanceAfter: number;

  if (walletConfig) {
    const walletResult = await processWalletSpin(walletConfig, {
      externalUserId: session.externalUserId,
      gameSlug: session.game.slug,
      betAmount: input.betAmount,
      winAmount,
      gameFeeAmount: fees.gameFeeAmount,
      clientFeeAmount: fees.clientFeeAmount,
      gameFeePct: fees.gameFeePct,
      clientFeePct: fees.clientFeePct,
      spinId,
      sessionId: session.sessionToken,
      currency: session.currency,
    });

    if (!walletResult.ok) {
      throw new Error(walletResult.error ?? "Wallet rejected spin");
    }

    balanceAfter = walletResult.balanceAfter;
  } else {
    const betTx = await debitBet({
      clientId: session.clientId,
      externalUserId: session.externalUserId,
      betAmount: input.betAmount,
      currency: session.currency,
      referenceId: spinId,
    });

    balanceAfter = betTx.balanceAfter;

    if (winAmount > 0) {
      const winTx = await creditWin({
        clientId: session.clientId,
        externalUserId: session.externalUserId,
        winAmount,
        currency: session.currency,
        referenceId: spinId,
      });
      balanceAfter = winTx.balanceAfter;
    }
  }

  const isWin = winAmount > 0;

  const [updatedSession, spin] = await prisma.$transaction([
    prisma.gameSession.update({
      where: { id: session.id },
      data: { balance: balanceAfter },
    }),
    prisma.gameSpin.create({
      data: {
        id: spinId,
        sessionId: session.id,
        betAmount: input.betAmount,
        winAmount,
        gameFeeAmount: fees.gameFeeAmount,
        clientFeeAmount: fees.clientFeeAmount,
        gameFeePct: fees.gameFeePct,
        clientFeePct: fees.clientFeePct,
        balanceBefore,
        balanceAfter,
        result: { isWin, winAmount },
      },
    }),
  ]);

  await debitClientFees({
    clientId: session.clientId,
    gameFeeAmount: fees.gameFeeAmount,
    clientFeeAmount: fees.clientFeeAmount,
    referenceId: spinId,
  });

  return {
    spinId: spin.id,
    betAmount: input.betAmount,
    winAmount,
    balance: Number(updatedSession.balance),
    fees,
    result: { isWin, winAmount },
  };
}
