import { getSessionByToken, processSpin } from "./session.service.js";
import { getWalletBalance } from "./player-wallet.service.js";
import { loadGameIcons } from "./game-assets.service.js";
import { buildIconPaytable } from "./icon-payout.service.js";
import { generateProceduralSpin, generateSessionGrid } from "./procedural-spin.service.js";
import { loadSpinTemplates, pickLoseTemplate, shuffleSlotIcons } from "./spin-templates.service.js";
import { commitSpinPayout, resolveSpinDecision } from "./rtp-pool.service.js";
import { handleInstantGameBridge, isInstantGame } from "./instant-games-bridge.service.js";
import { handleTvMilionarioBridge } from "./tv-milionario.service.js";
import { handleLuckBridge } from "./luck.service.js";
import { handleHalloweenSlotsBridge } from "./halloween-slots.service.js";
import { resolveTargetRtpForSession } from "./client-game-config.service.js";

function isConstructSlot(assetPath: string, slug: string): boolean {
  return slug !== "tv-milionario" && assetPath !== "tv-milionario" && slug !== "luck" && assetPath !== "luck" && slug !== "halloween-slots" && assetPath !== "halloween-slots";
}

export async function handleGameBridge(sessionToken: string, body: Record<string, unknown>) {
  const session = await getSessionByToken(sessionToken);
  if (!session || !session.isActive || session.expiresAt < new Date()) {
    return { success: false, message: "Invalid session" };
  }

  const action = String(body.action ?? "");
  const assetPath = session.game.assetPath ?? session.game.slug;

  if (isInstantGame(session.game.slug)) {
    return handleInstantGameBridge(session, body);
  }

  if (session.game.slug === "tv-milionario" || assetPath === "tv-milionario") {
    return handleTvMilionarioBridge(session, body);
  }

  if (session.game.slug === "luck" || assetPath === "luck") {
    return handleLuckBridge(session, body);
  }

  if (session.game.slug === "halloween-slots" || assetPath === "halloween-slots") {
    return handleHalloweenSlotsBridge(session, body);
  }

  if (action === "session") {
    const balance = await getWalletBalance(
      session.clientId,
      session.externalUserId,
      session.currency,
    );

    const initialIcons = isConstructSlot(assetPath, session.game.slug)
      ? generateSessionGrid(assetPath)
      : shuffleSlotIcons(pickLoseTemplate(loadSpinTemplates(assetPath).lose).slotIcons);

    return {
      success: true,
      message: "Load sessions success",
      data: {
        user_name: session.externalUserId,
        credit: balance,
        num_line: 5,
        line_num: 5,
        bet_amount: 0.5,
        free_num: 0,
        free_total: 0,
        free_amount: 0,
        free_multi: 0,
        freespin_mode: 0,
        multiple_list: [],
        credit_line: 0.4,
        buy_feature: 50,
        buy_max: 1300,
        feature: [],
        total_way: 27,
        multiply: 0,
        icon_data: initialIcons,
        active_icons: [],
        active_lines: [],
        drop_line: [],
        currency_prefix: "R$",
        currency_suffix: "",
        currency_thousand: ".",
        currency_decimal: ",",
        bet_size_list: ["0.1", "0.5", "1", "10"],
        previous_session: false,
        game_state: "",
      },
    };
  }

  if (action === "icons") {
    const icons = loadGameIcons(assetPath);
    return { success: true, data: icons, message: "List icons success" };
  }

  if (action === "spin") {
    const cpl = Number(body.cpl ?? 1);
    const amount = Number(body.betamount ?? body.bet_amount ?? 0.5);
    const numline = Number(body.numline ?? 5);
    const bet = amount * cpl * numline;

    const balance = await getWalletBalance(
      session.clientId,
      session.externalUserId,
      session.currency,
    );

    if (balance < bet) {
      return { success: false, message: "Insufficient balance" };
    }

    const targetRtp = await resolveTargetRtpForSession(session);
    const paytable = buildIconPaytable(loadGameIcons(assetPath));

    const decision = await resolveSpinDecision({
      gameId: session.game.id,
      betAmount: bet,
      targetRtpPct: targetRtp,
      clientId: session.clientId,
      rtpPoolMode: session.client.rtpPoolMode,
    });

    const generated = generateProceduralSpin({
      assetPath,
      paytable,
      cpl,
      amount,
      bet,
      shouldPay: decision.shouldPay,
      maxWinAmount: decision.maxWinAmount,
    });

    const winAmount = generated.winAmount;
    const activeLines = generated.activeLines;
    const activeIcons = generated.activeIcons;

    if (winAmount > 0 && activeLines.length > 0) {
      activeLines.forEach((line, i) => {
        line.win_amount = i === 0 ? winAmount : 0;
      });
    }

    const spin = await processSpin({
      sessionToken,
      betAmount: bet,
      winAmount,
    });

    const rtpCommit = await commitSpinPayout({
      gameId: session.game.id,
      winAmount,
      targetRtpPct: targetRtp,
      clientId: session.clientId,
      rtpPoolMode: session.client.rtpPoolMode,
    });

    return {
      success: true,
      message: "Spin success",
      data: {
        bet,
        credit: spin.balance,
        freemode: false,
        jackpot: 0,
        free_spin: 0,
        free_num: 0,
        scaler: 0,
        num_line: numline,
        cpl,
        betamount: amount,
        bet_amount: bet,
        pull: {
          WinAmount: winAmount,
          WinOnDrop: winAmount,
          TotalWay: 27,
          FreeSpin: 0,
          LastMultiply: 0,
          WildFixedIcons: [],
          HasJackpot: false,
          HasScatter: false,
          CountScatter: 0,
          WildColumIcon: "",
          MultipyScatter: 0,
          MultiplyCount: generated.multiplyCount,
          SlotIcons: generated.slotIcons,
          ActiveIcons: activeIcons,
          ActiveLines: activeLines,
          WinLogs: [],
          DropLine: 3,
          DropLineData: generated.dropLineData,
          MultipleList: [1, 2, 3, 5],
        },
        fees: spin.fees,
        rtp: {
          targetPct: targetRtp,
          actualPct: rtpCommit.actualRtpPct,
          drift: rtpCommit.drift,
          poolMode: rtpCommit.poolMode,
        },
      },
    };
  }

  return { success: false, message: "Unknown action" };
}
