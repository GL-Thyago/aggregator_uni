(function () {
  "use strict";

  var GRID = 25;
  var session = { min_bet: 1, max_bet: 500, credit: 0, minePresets: [1, 3, 5, 10, 15, 20, 24] };
  var state = {
    active: false,
    busy: false,
    roundId: null,
    mines: 5,
    revealed: [],
    bet: 0,
    mult: 1,
    minePositions: null,
  };
  var els = {};

  function $(id) { return document.getElementById(id); }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    setTimeout(function () { els.toast.classList.remove("show"); }, 2800);
  }

  function fairMult(mines, revealed) {
    if (revealed <= 0) return 1;
    var m = 1;
    for (var i = 0; i < revealed; i++) {
      m *= (GRID - i) / (GRID - mines - i);
    }
    return Math.round(m * 100) / 100;
  }

  function displayMult(mines, revealed) {
    return fairMult(mines, revealed);
  }

  function nextMult(mines, revealed) {
    return displayMult(mines, revealed + 1);
  }

  function setBalance(v) {
    session.credit = v;
    els.balance.textContent = InstantClient.money(v);
  }

  function setBusy(on) {
    state.busy = on;
    els.grid.classList.toggle("busy", on);
    els.btnCashout.disabled = on || !state.active || state.revealed.length === 0;
  }

  function updateStats() {
    els.multDisplay.textContent = state.mult.toFixed(2) + "x";
    var gemsLeft = GRID - state.mines - state.revealed.length;
    els.gemsLeft.textContent = state.active ? String(gemsLeft) : "—";
    els.nextMult.textContent = state.active && gemsLeft > 0
      ? nextMult(state.mines, state.revealed.length).toFixed(2) + "x"
      : "—";
    if (!state.busy) {
      els.btnCashout.disabled = !state.active || state.revealed.length === 0;
    }
    els.btnStart.disabled = state.active || state.busy;
    els.bet.disabled = state.active;
  }

  function buildGrid() {
    els.grid.innerHTML = "";
    for (var i = 0; i < GRID; i++) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tile";
      btn.dataset.index = String(i);
      btn.disabled = !state.active || state.busy;
      btn.onclick = function () { revealTile(Number(this.dataset.index)); };
      els.grid.appendChild(btn);
    }
    renderGrid(false);
  }

  function renderGrid(showMines) {
    var mines = showMines && state.minePositions ? state.minePositions : [];
    var tiles = els.grid.querySelectorAll(".tile");
    tiles.forEach(function (tile) {
      var idx = Number(tile.dataset.index);
      var isGem = state.revealed.includes(idx);
      var isMine = mines.includes(idx);

      tile.className = "tile";
      tile.textContent = "";
      tile.disabled = !state.active || state.busy || isGem || (showMines && !isGem);

      if (isGem) {
        tile.classList.add("revealed", "gem");
        tile.textContent = "💎";
      } else if (showMines && isMine) {
        tile.classList.add("revealed", "mine");
        tile.textContent = "💣";
      }
    });
  }

  function endRound(showMines) {
    if (showMines && state.minePositions) {
      renderGrid(true);
    }
    state.active = false;
    state.busy = false;
    state.roundId = null;
    state.revealed = [];
    state.mult = 1;
    state.minePositions = null;
    setTimeout(function () {
      buildGrid();
      updateStats();
      els.btnStart.disabled = false;
    }, showMines ? 2000 : 0);
  }

  function handleRoundClosed(msg) {
    toast(msg || "Rodada encerrada");
    els.message.textContent = msg || "Rodada encerrada — clique Apostar para jogar de novo";
    endRound(true);
  }

  async function startRound() {
    if (state.busy) return;
    els.message.textContent = "";
    var bet = Math.max(session.min_bet, Math.min(session.max_bet, Number(els.bet.value) || session.min_bet));
    els.bet.value = bet.toFixed(2);
    setBusy(true);

    try {
      var data = await InstantClient.api("start", { betAmount: bet, mines: state.mines });
      state.active = true;
      state.roundId = data.round_id;
      state.bet = bet;
      state.revealed = [];
      state.mult = 1;
      state.minePositions = null;
      setBalance(data.credit);
      buildGrid();
      updateStats();
      toast("Escolha as casas — " + state.mines + " minas escondidas");
    } catch (e) {
      els.message.textContent = e.message;
    } finally {
      setBusy(false);
      updateStats();
    }
  }

  async function revealTile(index) {
    if (!state.active || state.busy || state.revealed.includes(index)) return;

    setBusy(true);

    try {
      var data = await InstantClient.api("reveal", { round_id: state.roundId, tile: index });

      if (data.mine_positions) state.minePositions = data.mine_positions;

      if (data.hit_mine) {
        state.revealed = data.revealed || state.revealed.concat([index]);
        setBalance(data.credit);
        renderGrid(true);
        els.message.textContent = "💣 Mina! Perdeu " + InstantClient.money(state.bet);
        toast("Boom! Você acertou uma mina.");
        setBusy(false);
        endRound(true);
        return;
      }

      state.revealed = data.revealed;
      state.mult = data.multiplier;
      renderGrid(false);
      updateStats();

      if (data.auto_cashout) {
        setBalance(data.credit);
        renderGrid(true);
        els.message.textContent = "💎 Todas as gemas! Ganhou " + InstantClient.money(data.win_amount);
        toast("Sacou " + InstantClient.money(data.win_amount) + " @ " + data.multiplier.toFixed(2) + "x");
        setBusy(false);
        endRound(true);
      }
    } catch (e) {
      if (/encerrada|inválida|andamento/i.test(e.message)) {
        handleRoundClosed(e.message);
      } else {
        toast(e.message);
      }
    } finally {
      if (state.active) {
        setBusy(false);
        updateStats();
      }
    }
  }

  async function cashout() {
    if (!state.active || state.busy || state.revealed.length === 0) return;

    setBusy(true);

    try {
      var data = await InstantClient.api("cashout", { round_id: state.roundId });
      if (data.mine_positions) state.minePositions = data.mine_positions;
      setBalance(data.credit);
      renderGrid(true);
      els.message.textContent = "Sacou " + InstantClient.money(data.win_amount) + " @ " + data.multiplier.toFixed(2) + "x";
      toast("Sacou " + InstantClient.money(data.win_amount));
      endRound(true);
    } catch (e) {
      if (/encerrada|inválida/i.test(e.message)) {
        handleRoundClosed(e.message);
      } else {
        toast(e.message);
      }
      setBusy(false);
      updateStats();
    }
  }

  function renderMinePresets() {
    els.minesPresets.innerHTML = "";
    session.minePresets.forEach(function (n) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mine-preset" + (n === state.mines ? " active" : "");
      btn.textContent = String(n);
      btn.onclick = function () {
        if (state.active) return;
        state.mines = n;
        renderMinePresets();
      };
      els.minesPresets.appendChild(btn);
    });
  }

  async function init() {
    els.balance = $("balance");
    els.bet = $("bet");
    els.grid = $("grid");
    els.multDisplay = $("mult-display");
    els.nextMult = $("next-mult");
    els.gemsLeft = $("gems-left");
    els.btnStart = $("btn-start");
    els.btnCashout = $("btn-cashout");
    els.message = $("message");
    els.toast = $("toast");
    els.minesPresets = $("mines-presets");

    $("bet-minus").onclick = function () {
      if (state.active) return;
      els.bet.value = Math.max(session.min_bet, Number(els.bet.value) - 1).toFixed(2);
    };
    $("bet-plus").onclick = function () {
      if (state.active) return;
      els.bet.value = Math.min(session.max_bet, Number(els.bet.value) + 1).toFixed(2);
    };
    els.btnStart.onclick = startRound;
    els.btnCashout.onclick = cashout;

    buildGrid();
    updateStats();

    try {
      var s = await InstantClient.api("session");
      session.min_bet = s.min_bet;
      session.max_bet = s.max_bet;
      if (s.mine_presets) session.minePresets = s.mine_presets;
      if (s.default_mines) state.mines = s.default_mines;
      els.bet.min = s.min_bet;
      els.bet.max = s.max_bet;
      setBalance(s.credit);
      renderMinePresets();

      var st = await InstantClient.api("status", {});
      if (st.active && st.round_id) {
        state.active = true;
        state.roundId = st.round_id;
        state.revealed = st.revealed || [];
        state.mult = st.multiplier || 1;
        state.bet = st.bet_amount || Number(els.bet.value);
        state.mines = st.mines || state.mines;
        buildGrid();
        updateStats();
        toast("Rodada retomada");
      }
    } catch (e) {
      els.message.textContent = e.message;
      renderMinePresets();
    }
  }

  init();
})();
