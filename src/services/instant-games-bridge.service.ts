import type { GameSessionFull } from "./instant-games.service.js";
import { resolveTargetRtpForSession } from "./client-game-config.service.js";
import { diceFairMultiplier } from "../config/rtp.js";
import {
  buildInstantSessionResponse,
  createCrashRound,
  addBetToCrashRound,
  getActiveCrashRound,
  getCrashBet,
  getCrashRound,
  startCrashRoundFlight,
  crashRoundElapsedMs,
  crashRoundDurationMs,
  dicePayout,
  evenMoneyPayout,
  flipCoin,
  generateCrashPoint,
  loadSessionBalance,
  multiplierAtElapsedMs,
  parseBet,
  resolveCrashCashout,
  resolveRtpDecision,
  rollDice,
  settleInstantBet,
  spinDoubleTile,
  doubleTileColor,
  doubleDisplayMultiplier,
  doublePayout,
  pickLosingDoubleTile,
  pickLosingDiceRoll,
  pickLosingCoinFlip,
  applyPoolGatedWin,
  DOUBLE_WHEEL_ORDER,
  createMinesRound,
  getMinesRound,
  getActiveMinesRound,
  revealMinesTile,
  minesDisplayMultiplier,
  minesPayout,
  MINES_GRID_SIZE,
  MINES_PRESETS,
} from "./instant-games.service.js";

function roundMoney(v: number) {
  return Math.round(v * 100) / 100;
}

async function validateBet(session: GameSessionFull, bet: number) {
  const minBet = session.game.minBet ? Number(session.game.minBet) : 1;
  const maxBet = session.game.maxBet ? Number(session.game.maxBet) : 1000;
  if (bet < minBet || bet > maxBet) {
    return { ok: false as const, message: `Aposta entre R$${minBet} e R$${maxBet}` };
  }
  const balance = await loadSessionBalance(session);
  if (balance < bet) return { ok: false as const, message: "Saldo insuficiente" };
  return { ok: true as const, balance, minBet, maxBet };
}

export async function handleCrashBridge(session: GameSessionFull, body: Record<string, unknown>) {
  const action = String(body.action ?? "session");

  if (action === "session") {
    const base = await buildInstantSessionResponse(session);
    return { ...base, data: { ...base.data, max_multiplier: 500 } };
  }

  if (action === "bet") {
    const bet = parseBet(body);
    const check = await validateBet(session, bet);
    if (!check.ok) return { success: false, message: check.message };

    const joinRoundId = String(body.round_id ?? body.roundId ?? "");
    let round = joinRoundId ? getCrashRound(joinRoundId) : getActiveCrashRound(session.sessionToken);
    let betId: string;

    if (round && round.sessionToken === session.sessionToken && round.status === "active" && !round.flightStarted) {
      betId = addBetToCrashRound(round, bet);
    } else if (round && round.sessionToken === session.sessionToken && round.status === "active" && round.flightStarted) {
      return { success: false, message: "Rodada já em voo — aguarde a próxima" };
    } else {
      const created = createCrashRound({
        sessionToken: session.sessionToken,
        crashPoint: generateCrashPoint(),
        betAmount: bet,
      });
      round = created.round;
      betId = created.betId;
    }

    const startFlight = body.start_flight === true || body.startFlight === true;
    if (startFlight) startCrashRoundFlight(round);

    return {
      success: true,
      message: "Round started",
      data: {
        round_id: round.roundId,
        bet_id: betId,
        bet_amount: bet,
        crash_point: round.crashPoint,
        started_at: round.startedAt,
        flight_started: round.flightStarted,
        crash_in_ms: round.flightStarted ? crashRoundDurationMs(round) : 0,
        credit: check.balance,
      },
    };
  }

  if (action === "start_flight") {
    const roundId = String(body.round_id ?? body.roundId ?? "");
    const round = getCrashRound(roundId);

    if (!round || round.sessionToken !== session.sessionToken) {
      return { success: false, message: "Rodada inválida" };
    }
    if (round.status !== "active") {
      return { success: false, message: "Rodada já encerrada" };
    }

    startCrashRoundFlight(round);

    return {
      success: true,
      message: "Flight started",
      data: {
        round_id: round.roundId,
        crash_point: round.crashPoint,
        started_at: round.startedAt,
        flight_started: true,
        crash_in_ms: crashRoundDurationMs(round),
      },
    };
  }

  if (action === "cashout") {
    const roundId = String(body.round_id ?? body.roundId ?? "");
    const betId = String(body.bet_id ?? body.betId ?? "");
    const claimed = roundMoney(Number(body.multiplier ?? 1));
    const round = getCrashRound(roundId);

    if (!round || round.sessionToken !== session.sessionToken) {
      return { success: false, message: "Rodada inválida" };
    }

    const crashBet = betId ? getCrashBet(round, betId) : round.bets.find((b) => b.status === "active");
    if (!crashBet || crashBet.status !== "active") {
      return { success: false, message: "Aposta inválida ou já encerrada" };
    }

    if (!round.flightStarted) {
      return { success: false, message: "O voo ainda não começou" };
    }

    const elapsed = crashRoundElapsedMs(round);
    const crashInMs = crashRoundDurationMs(round);
    if (elapsed >= crashInMs) {
      crashBet.status = "lost";
      const lost = await settleInstantBet(session, crashBet.betAmount, 0);
      if (!round.bets.some((b) => b.status === "active")) round.status = "ended";
      return {
        success: true,
        message: "Crashed",
        data: {
          won: false,
          multiplier: round.crashPoint,
          bet_amount: crashBet.betAmount,
          win_amount: 0,
          credit: lost.spin.balance,
        },
      };
    }

    const effectiveMult = resolveCrashCashout(round, claimed);
    const winAmount = roundMoney(crashBet.betAmount * effectiveMult);
    crashBet.status = "cashed_out";
    crashBet.cashoutAt = effectiveMult;
    crashBet.winAmount = winAmount;

    const settled = await settleInstantBet(session, crashBet.betAmount, winAmount);
    if (!round.bets.some((b) => b.status === "active")) round.status = "ended";

    return {
      success: true,
      message: "Cashout",
      data: {
        won: true,
        multiplier: effectiveMult,
        bet_amount: crashBet.betAmount,
        win_amount: winAmount,
        credit: settled.spin.balance,
      },
    };
  }

  if (action === "crash") {
    const roundId = String(body.round_id ?? body.roundId ?? "");
    const round = getCrashRound(roundId);

    if (!round || round.sessionToken !== session.sessionToken) {
      return { success: false, message: "Rodada inválida" };
    }
    if (!round.flightStarted) {
      startCrashRoundFlight(round);
    }
    if (round.status !== "active") {
      return { success: false, message: "Rodada já encerrada" };
    }

    round.status = "ended";
    let credit = await loadSessionBalance(session);

    for (const crashBet of round.bets) {
      if (crashBet.status !== "active") continue;
      crashBet.status = "lost";
      const settled = await settleInstantBet(session, crashBet.betAmount, 0);
      credit = settled.spin.balance;
    }

    return {
      success: true,
      message: "Round crashed",
      data: {
        won: false,
        crash_point: round.crashPoint,
        multiplier: round.crashPoint,
        bet_amount: round.bets.reduce((s, b) => s + b.betAmount, 0),
        win_amount: 0,
        credit,
      },
    };
  }

  return { success: false, message: "Unknown action" };
}

export async function handleDiceBridge(session: GameSessionFull, body: Record<string, unknown>) {
  const action = String(body.action ?? "session");
  if (action === "session") return buildInstantSessionResponse(session);

  if (action === "play") {
    const bet = parseBet(body);
    const check = await validateBet(session, bet);
    if (!check.ok) return { success: false, message: check.message };

    const target = Math.max(1, Math.min(98, Number(body.target ?? 50)));
    const rollOver = Boolean(body.roll_over ?? body.rollOver ?? true);

    const decision = await resolveRtpDecision(session, bet);
    let roll = rollDice();
    let fairWin = dicePayout(bet, target, rollOver, roll);

    if (fairWin > 0 && decision.prizePool < fairWin) {
      roll = pickLosingDiceRoll(target, rollOver);
      fairWin = 0;
    }

    const winAmount = applyPoolGatedWin(
      fairWin,
      decision.prizePool,
      bet,
      await resolveTargetRtpForSession(session),
    );
    const settled = await settleInstantBet(session, bet, winAmount, { rtpWagerAlreadyRegistered: true });

    return {
      success: true,
      data: {
        roll,
        target,
        roll_over: rollOver,
        bet_amount: bet,
        win_amount: winAmount,
        won: winAmount > 0,
        credit: settled.spin.balance,
      },
    };
  }

  return { success: false, message: "Unknown action" };
}

export async function handleCoinflipBridge(session: GameSessionFull, body: Record<string, unknown>) {
  const action = String(body.action ?? "session");
  if (action === "session") return buildInstantSessionResponse(session);

  if (action === "play") {
    const bet = parseBet(body);
    const check = await validateBet(session, bet);
    if (!check.ok) return { success: false, message: check.message };

    const choice = String(body.choice ?? "heads").toLowerCase();
    if (choice !== "heads" && choice !== "tails") {
      return { success: false, message: "Escolha heads ou tails" };
    }

    const choiceBit = (choice === "heads" ? 0 : 1) as 0 | 1;

    const decision = await resolveRtpDecision(session, bet);
    let result = flipCoin();
    let fairWin = evenMoneyPayout(bet, result === choiceBit);

    if (fairWin > 0 && decision.prizePool < fairWin) {
      result = pickLosingCoinFlip(choiceBit);
      fairWin = 0;
    }

    const winAmount = applyPoolGatedWin(
      fairWin,
      decision.prizePool,
      bet,
      await resolveTargetRtpForSession(session),
    );
    const settled = await settleInstantBet(session, bet, winAmount, { rtpWagerAlreadyRegistered: true });

    return {
      success: true,
      data: {
        choice,
        result: result === 0 ? "heads" : "tails",
        bet_amount: bet,
        win_amount: winAmount,
        multiplier: bet > 0 && winAmount > 0 ? roundMoney(winAmount / bet) : 0,
        won: winAmount > 0,
        credit: settled.spin.balance,
      },
    };
  }

  return { success: false, message: "Unknown action" };
}

export async function handleDoubleBridge(session: GameSessionFull, body: Record<string, unknown>) {
  const action = String(body.action ?? "session");
  if (action === "session") {
    const base = await buildInstantSessionResponse(session);
    return {
      ...base,
      data: {
        ...base.data,
        wheel_order: [...DOUBLE_WHEEL_ORDER],
        multipliers: {
          red: doubleDisplayMultiplier("red"),
          black: doubleDisplayMultiplier("black"),
          white: doubleDisplayMultiplier("white"),
        },
        rules: {
          red_numbers: "1–7",
          black_numbers: "8–14",
          white_number: "0",
          betting_seconds: 8,
          retention_note: "Prêmios integrais (2x/14x) quando o fundo de prêmios permite; banca retida nunca paga.",
        },
      },
    };
  }

  if (action === "play") {
    const bet = parseBet(body);
    const check = await validateBet(session, bet);
    if (!check.ok) return { success: false, message: check.message };

    const choice = String(body.color ?? body.choice ?? "red").toLowerCase();
    if (choice !== "red" && choice !== "black" && choice !== "white") {
      return { success: false, message: "Escolha vermelho, preto ou branco" };
    }

    const color = choice as "red" | "black" | "white";
    const decision = await resolveRtpDecision(session, bet);
    let tile = spinDoubleTile();
    let resultColor = doubleTileColor(tile);
    let fairWin = doublePayout(bet, color, tile);

    if (fairWin > 0 && decision.prizePool < fairWin) {
      tile = pickLosingDoubleTile(color);
      resultColor = doubleTileColor(tile);
      fairWin = 0;
    }

    const winAmount = applyPoolGatedWin(
      fairWin,
      decision.prizePool,
      bet,
      await resolveTargetRtpForSession(session),
    );
    const settled = await settleInstantBet(session, bet, winAmount, { rtpWagerAlreadyRegistered: true });

    return {
      success: true,
      data: {
        choice,
        tile,
        result: resultColor,
        bet_amount: bet,
        win_amount: winAmount,
        multiplier:
          bet > 0 && winAmount > 0 ? roundMoney(winAmount / bet) : 0,
        display_multiplier: doubleDisplayMultiplier(resultColor),
        won: winAmount > 0,
        credit: settled.spin.balance,
        wheel_index: DOUBLE_WHEEL_ORDER.indexOf(tile as (typeof DOUBLE_WHEEL_ORDER)[number]),
      },
    };
  }

  return { success: false, message: "Unknown action" };
}

export async function handleMinesBridge(session: GameSessionFull, body: Record<string, unknown>) {
  const action = String(body.action ?? "session");

  if (action === "session") {
    const base = await buildInstantSessionResponse(session);
    return {
      ...base,
      data: {
        ...base.data,
        grid_size: MINES_GRID_SIZE,
        mine_presets: [...MINES_PRESETS],
        default_mines: 5,
      },
    };
  }

  if (action === "status") {
    const roundId = String(body.round_id ?? body.roundId ?? "");
    const round = roundId ? getMinesRound(roundId) : getActiveMinesRound(session.sessionToken);
    if (!round || round.sessionToken !== session.sessionToken) {
      return { success: true, data: { active: false } };
    }
    return {
      success: true,
      data: {
        active: round.status === "active",
        round_id: round.roundId,
        status: round.status,
        bet_amount: round.betAmount,
        mines: round.mineCount,
        revealed: [...round.revealed],
        multiplier: minesDisplayMultiplier(round.gridSize, round.mineCount, round.revealed.length),
        gems_left: round.gridSize - round.mineCount - round.revealed.length,
      },
    };
  }

  if (action === "start") {
    const bet = parseBet(body);
    const check = await validateBet(session, bet);
    if (!check.ok) return { success: false, message: check.message };

    if (getActiveMinesRound(session.sessionToken)) {
      return { success: false, message: "Rodada em andamento" };
    }

    const mineCount = Math.max(1, Math.min(MINES_GRID_SIZE - 1, Number(body.mines ?? body.mine_count ?? 5)));
    const round = createMinesRound({
      sessionToken: session.sessionToken,
      betAmount: bet,
      mineCount,
    });

    return {
      success: true,
      message: "Mines started",
      data: {
        round_id: round.roundId,
        bet_amount: bet,
        mines: round.mineCount,
        grid_size: round.gridSize,
        multiplier: 1,
        credit: check.balance,
      },
    };
  }

  if (action === "reveal") {
    const roundId = String(body.round_id ?? body.roundId ?? "");
    const tile = Number(body.tile ?? body.index ?? -1);
    const round = getMinesRound(roundId);

    if (!round || round.sessionToken !== session.sessionToken) {
      return { success: false, message: "Rodada inválida" };
    }
    if (round.status !== "active") {
      return { success: false, message: "Rodada já encerrada" };
    }
    if (!Number.isInteger(tile) || tile < 0 || tile >= round.gridSize) {
      return { success: false, message: "Casa inválida" };
    }
    if (round.revealed.includes(tile)) {
      return { success: false, message: "Casa já revelada" };
    }

    const { hitMine, completed } = revealMinesTile(round, tile);
    const mult = minesDisplayMultiplier(round.gridSize, round.mineCount, round.revealed.length);

    if (hitMine) {
      try {
        await resolveRtpDecision(session, round.betAmount);
        const settled = await settleInstantBet(session, round.betAmount, 0, { rtpWagerAlreadyRegistered: true });
        round.status = "lost";
        return {
          success: true,
          message: "Mine",
          data: {
            hit_mine: true,
            tile,
            revealed: [...round.revealed, tile],
            mine_positions: round.minePositions,
            multiplier: 0,
            bet_amount: round.betAmount,
            win_amount: 0,
            credit: settled.spin.balance,
          },
        };
      } catch (err) {
        round.revealed = round.revealed.filter((t) => t !== tile);
        throw err;
      }
    }

    if (completed) {
      const decision = await resolveRtpDecision(session, round.betAmount);
      const fairWin = minesPayout(round.betAmount, round.gridSize, round.mineCount, round.revealed.length);
      const winAmount = applyPoolGatedWin(
        fairWin,
        decision.prizePool,
        round.betAmount,
        await resolveTargetRtpForSession(session),
      );
      try {
        const settled = await settleInstantBet(session, round.betAmount, winAmount, { rtpWagerAlreadyRegistered: true });
        round.status = "cashed_out";
        return {
          success: true,
          message: "All gems",
          data: {
            hit_mine: false,
            tile,
            revealed: [...round.revealed],
            mine_positions: round.minePositions,
            multiplier: mult,
            bet_amount: round.betAmount,
            win_amount: winAmount,
            credit: settled.spin.balance,
            auto_cashout: true,
          },
        };
      } catch (err) {
        round.revealed.pop();
        throw err;
      }
    }

    return {
      success: true,
      message: "Gem",
      data: {
        hit_mine: false,
        tile,
        revealed: [...round.revealed],
        multiplier: mult,
        bet_amount: round.betAmount,
        gems_left: round.gridSize - round.mineCount - round.revealed.length,
      },
    };
  }

  if (action === "cashout") {
    const roundId = String(body.round_id ?? body.roundId ?? "");
    const round = getMinesRound(roundId);

    if (!round || round.sessionToken !== session.sessionToken) {
      return { success: false, message: "Rodada inválida" };
    }
    if (round.status !== "active") {
      return { success: false, message: "Rodada já encerrada" };
    }
    if (round.revealed.length === 0) {
      return { success: false, message: "Revele ao menos uma gema" };
    }

    const decision = await resolveRtpDecision(session, round.betAmount);
    const mult = minesDisplayMultiplier(round.gridSize, round.mineCount, round.revealed.length);
    const fairWin = minesPayout(round.betAmount, round.gridSize, round.mineCount, round.revealed.length);
    const winAmount = applyPoolGatedWin(
      fairWin,
      decision.prizePool,
      round.betAmount,
      await resolveTargetRtpForSession(session),
    );

    try {
      const settled = await settleInstantBet(session, round.betAmount, winAmount, { rtpWagerAlreadyRegistered: true });
      round.status = "cashed_out";
      return {
        success: true,
        message: "Cashout",
        data: {
          multiplier: mult,
          bet_amount: round.betAmount,
          win_amount: winAmount,
          revealed: [...round.revealed],
          mine_positions: round.minePositions,
          credit: settled.spin.balance,
        },
      };
    } catch (err) {
      throw err;
    }
  }

  return { success: false, message: "Unknown action" };
}

const INSTANT_HANDLERS: Record<
  string,
  (session: GameSessionFull, body: Record<string, unknown>) => Promise<unknown>
> = {
  aviator: handleCrashBridge,
  spaceman: handleCrashBridge,
  jetx: handleCrashBridge,
  dice: handleDiceBridge,
  coinflip: handleCoinflipBridge,
  double: handleDoubleBridge,
  mines: handleMinesBridge,
};

export async function handleInstantGameBridge(
  session: GameSessionFull,
  body: Record<string, unknown>,
) {
  const slug = session.game.slug;
  const handler = INSTANT_HANDLERS[slug];
  if (!handler) return { success: false, message: "Instant game handler not found" };
  return handler(session, body);
}

export function isInstantGame(slug: string): boolean {
  return slug in INSTANT_HANDLERS;
}
