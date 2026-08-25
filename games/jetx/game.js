(function () {
  "use strict";

  var FAKE_NAMES = ["João", "Maria", "Pedro", "Ana", "Lucas", "Julia", "Rafa", "Bia", "Leo", "Carla", "Diego", "Luiza"];
  var BETTING_MS = 5000;
  var rayAngle = 0;

  var session = { min_bet: 1, max_bet: 500, credit: 0 };
  var history = [];
  var panels = [];
  var els = {};

  var round = {
    phase: "betting",
    roundId: null,
    startedAt: 0,
    crashInMs: 0,
    crashPoint: 0,
    bettingEndsAt: 0,
    animId: null,
    bettingTimer: null,
    settling: false,
  };

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }

  function fmtMoney(v) {
    return "R$" + Number(v).toFixed(2).replace(".", ",");
  }

  function multFromTime(ms) {
    return Math.max(1, Math.round(Math.exp((ms / 1000) * 0.18) * 100) / 100);
  }

  function historyClass(m) {
    if (m >= 10) return "high";
    if (m >= 2) return "mid";
    return "";
  }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    setTimeout(function () { els.toast.classList.remove("show"); }, 2500);
  }

  function renderHistory() {
    els.historyBar.innerHTML = "";
    history.slice(0, 25).forEach(function (m) {
      var pill = document.createElement("span");
      pill.className = "history-pill " + historyClass(m);
      pill.textContent = m.toFixed(2) + "x";
      els.historyBar.appendChild(pill);
    });
  }

  function setBalance(v) {
    session.credit = v;
    els.balance.textContent = fmtMoney(v);
  }

  function panelActiveInput(panel) {
    return panel.mode === "auto" ? panel.inputAuto : panel.input;
  }

  function panelBetAmount(panel) {
    var input = panelActiveInput(panel);
    return Math.max(session.min_bet, Math.min(session.max_bet, Number(input.value) || session.min_bet));
  }

  function panelAutoCashoutMult(panel) {
    var mult = Number(panel.autoCashoutInput.value) || 2;
    return Math.max(1.01, Math.min(500, Math.round(mult * 100) / 100));
  }

  function syncAutoCashoutInput(panel) {
    panel.autoCashoutInput.value = panelAutoCashoutMult(panel).toFixed(2);
  }

  function isPanelLocked(panel) {
    return panel.state === "flying" || panel.state === "armed" || panel.state === "queued";
  }

  function updatePanelBtnLabel(panel) {
    var amt = panel.state === "flying" ? panel.betAmount : panelBetAmount(panel);
    var input = panelActiveInput(panel);
    if (panel.state !== "flying") input.value = amt.toFixed(2);
    if (panel.mode === "bet") panel.input.value = amt.toFixed(2);

    if (panel.mode === "auto") {
      updateAutoBtnLabel(panel, amt);
      return;
    }

    if (panel.state === "idle") {
      panel.btn.innerHTML = "Aposta<br><small>" + fmtMoney(amt) + "</small>";
    } else if (panel.state === "armed") {
      panel.btn.innerHTML = "Confirmado<br><small>" + fmtMoney(panel.betAmount) + "</small>";
    } else if (panel.state === "queued") {
      panel.btn.innerHTML = "Cancelar<br><small>" + fmtMoney(panel.betAmount) + "</small>";
    } else if (panel.state === "flying") {
      var win = panel.betAmount * multFromTime(Date.now() - round.startedAt);
      panel.btn.innerHTML = "Sacar<br><small>" + fmtMoney(win) + "</small>";
    }
  }

  function updateAutoBtnLabel(panel, amt) {
    amt = amt || panelBetAmount(panel);
    var btn = panel.autoBtn;

    if (panel.autoEnabled) {
      if (panel.state === "flying") {
        var win = panel.betAmount * multFromTime(Date.now() - round.startedAt);
        btn.innerHTML = "Auto · Sacar<br><small>" + fmtMoney(win) + "</small>";
      } else if (panel.state === "armed") {
        var left = panel.autoRoundsLeft != null ? " · " + panel.autoRoundsLeft + " rest." : "";
        btn.innerHTML = "Auto ativo" + left + "<br><small>" + fmtMoney(panel.betAmount) + "</small>";
      } else {
        btn.innerHTML = "Parar Auto<br><small>" + fmtMoney(amt) + "</small>";
      }
      btn.className = "action-btn auto-stop-btn";
    } else {
      var cashoutHint = panel.autoCashoutToggle.checked
        ? " @ " + panelAutoCashoutMult(panel).toFixed(2) + "x"
        : "";
      btn.innerHTML = "Iniciar Auto<br><small>" + fmtMoney(amt) + cashoutHint + "</small>";
      btn.className = "action-btn auto-start-btn bet-btn";
    }
  }

  function setPanelState(panel, state) {
    panel.state = state;
    var locked = isPanelLocked(panel);
    panel.el.classList.toggle("locked", locked);
    panel.bodyBet.classList.toggle("locked", locked && panel.mode === "bet");
    panel.bodyAuto.classList.toggle("locked", locked && panel.mode === "auto");

    if (panel.mode === "bet") {
      panel.btn.className = "action-btn";
      panel.btn.disabled = false;

      if (state === "idle") {
        panel.btn.classList.add("bet-btn");
        panel.betId = null;
      } else if (state === "armed") {
        panel.btn.classList.add("bet-btn");
      } else if (state === "queued") {
        panel.btn.classList.add("cancel-btn");
      } else if (state === "flying") {
        panel.btn.classList.add("cashout-btn");
      }
    } else if (panel.autoEnabled) {
      panel.autoBtn.disabled = false;
      if (state === "flying") {
        panel.autoBtn.classList.add("cashout-btn");
      } else if (panel.autoEnabled) {
        panel.autoBtn.className = "action-btn auto-stop-btn";
      }
    }

    updatePanelBtnLabel(panel);
  }

  function setPanelTab(panel, tab) {
    panel.mode = tab;
    panel.el.querySelectorAll(".panel-tab").forEach(function (t) {
      t.classList.toggle("active", t.getAttribute("data-tab") === tab);
    });
    panel.bodyBet.classList.toggle("hidden", tab !== "bet");
    panel.bodyAuto.classList.toggle("hidden", tab !== "auto");
    updatePanelBtnLabel(panel);
  }

  function stopAuto(panel, reason) {
    if (!panel.autoEnabled) return;
    panel.autoEnabled = false;
    panel.autoRoundsLeft = null;
    if (panel.state === "armed" && round.phase === "betting") {
      setPanelState(panel, "idle");
    }
    updateAutoBtnLabel(panel);
    if (reason) toast(reason);
  }

  function startAuto(panel) {
    panel.betAmount = panelBetAmount(panel);
    if (panel.betAmount > session.credit) {
      toast("Saldo insuficiente para auto");
      return;
    }
    syncAutoCashoutInput(panel);
    panel.autoEnabled = true;
    if (panel.autoRoundsToggle.checked) {
      panel.autoRoundsLeft = Math.max(1, Math.floor(Number(panel.autoRoundsInput.value) || 1));
    } else {
      panel.autoRoundsLeft = null;
    }
    if (round.phase === "betting" && panel.state === "idle") {
      setPanelState(panel, "armed");
    }
    updateAutoBtnLabel(panel);
    toast("Auto ligado — " + fmtMoney(panel.betAmount) +
      (panel.autoCashoutToggle.checked ? " · sacar @ " + panelAutoCashoutMult(panel).toFixed(2) + "x" : ""));
  }

  function applyAutoBets() {
    panels.forEach(function (p) {
      if (!p.autoEnabled || p.mode !== "auto") return;
      if (p.state !== "idle" && p.state !== "queued") return;

      p.betAmount = panelBetAmount(p);
      if (p.betAmount > session.credit) {
        stopAuto(p, "Auto pausado — saldo insuficiente");
        return;
      }
      setPanelState(p, "armed");
    });
  }

  function consumeAutoRound(panel) {
    if (panel.autoRoundsLeft == null) return;
    panel.autoRoundsLeft -= 1;
    if (panel.autoRoundsLeft <= 0) {
      stopAuto(panel, "Auto concluído — limite de rodadas");
    }
  }

  function checkAutoCashouts(mult) {
    panels.forEach(function (p) {
      if (p.state !== "flying" || p.cashingOut || round.settling) return;
      if (!p.autoEnabled || !p.autoCashoutToggle.checked) return;
      if (mult >= panelAutoCashoutMult(p)) {
        cashout(p, panelAutoCashoutMult(p));
      }
    });
  }

  function updateBettingHint() {
    if (round.phase !== "betting") return;
    var left = Math.max(0, Math.ceil((round.bettingEndsAt - Date.now()) / 1000));
    els.stageHint.textContent = "Apostas abertas — voo em " + left + "s";
    els.stageHint.classList.add("betting-open");
  }

  function openBettingWindow() {
    round.phase = "betting";
    round.roundId = null;
    round.startedAt = 0;
    round.crashInMs = 0;
    round.crashPoint = 0;
    round.settling = false;
    round.bettingEndsAt = Date.now() + BETTING_MS;
    clearTimeout(round.bettingTimer);

    panels.forEach(function (p) {
      if (p.state === "queued") {
        setPanelState(p, "armed");
      } else if (p.state === "flying") {
        /* shouldn't happen */
      } else if (p.state !== "armed") {
        setPanelState(p, "idle");
      }
    });

    applyAutoBets();

    setMultiplierUI(1);
    els.flewAway.classList.remove("show");
    drawFrame(0, 1, false);
    updateBettingHint();

    round.bettingTimer = setTimeout(function () {
      launchRound();
    }, BETTING_MS);

    if (!round.hintTimer) {
      round.hintTimer = setInterval(updateBettingHint, 250);
    }
  }

  async function launchRound() {
    clearTimeout(round.bettingTimer);
    var armed = panels.filter(function (p) { return p.state === "armed"; });

    if (armed.length === 0) {
      openBettingWindow();
      return;
    }

    round.phase = "launching";
    els.stageHint.classList.remove("betting-open");
    els.stageHint.textContent = "Decolando…";

    var lastData = null;

    try {
      for (var i = 0; i < armed.length; i++) {
        var panel = armed[i];
        if (panel.betAmount > session.credit) {
          stopAuto(panel, "Saldo insuficiente");
          setPanelState(panel, "idle");
          continue;
        }

        var payload = { betAmount: panel.betAmount };
        if (round.roundId) payload.round_id = round.roundId;

        lastData = await InstantClient.api("bet", payload);
        panel.betId = lastData.bet_id;
        panel.roundId = lastData.round_id;
        round.roundId = lastData.round_id;
        if (lastData.crash_point) round.crashPoint = Number(lastData.crash_point);

        setPanelState(panel, "flying");
        consumeAutoRound(panel);
        addLiveBet("Você", panel.betAmount, null);
      }

      if (!round.roundId) {
        openBettingWindow();
        return;
      }

      var start = await InstantClient.api("start_flight", { round_id: round.roundId });
      round.startedAt = start.started_at;
      round.crashInMs = start.crash_in_ms;
      if (start.crash_point) round.crashPoint = Number(start.crash_point);

      if (!round.startedAt || !round.crashInMs || round.crashInMs <= 0) {
        throw new Error("Falha ao iniciar o voo");
      }

      if (lastData && lastData.credit != null) setBalance(lastData.credit);

      round.phase = "flying";
      els.stageHint.textContent = "";
      tick();
    } catch (e) {
      toast(e.message);
      armed.forEach(function (p) { setPanelState(p, "idle"); });
      openBettingWindow();
    }
  }

  function onPanelClick(panel) {
    if (round.phase === "betting") {
      if (panel.state === "idle") {
        panel.betAmount = panelBetAmount(panel);
        setPanelState(panel, "armed");
      } else if (panel.state === "armed") {
        setPanelState(panel, "idle");
      } else if (panel.state === "queued") {
        setPanelState(panel, "idle");
      }
      return;
    }

    if (round.phase === "flying") {
      if (panel.state === "flying") {
        cashout(panel);
      } else if (panel.state === "idle") {
        panel.betAmount = panelBetAmount(panel);
        setPanelState(panel, "queued");
        toast("Aposta R$" + panel.betAmount.toFixed(2) + " na próxima rodada");
      } else if (panel.state === "queued") {
        setPanelState(panel, "idle");
      }
    }
  }

  function onAutoClick(panel) {
    if (panel.autoEnabled) {
      if (panel.state === "flying") {
        cashout(panel);
        return;
      }
      stopAuto(panel, "Auto desligado");
      if (panel.state === "armed" && round.phase === "betting") {
        setPanelState(panel, "idle");
      }
      return;
    }
    startAuto(panel);
  }

  async function cashout(panel, targetMult) {
    if (panel.state !== "flying" || !panel.betId || panel.cashingOut) return;
    if (round.settling) return;

    var mult = targetMult || multFromTime(Date.now() - round.startedAt);
    panel.cashingOut = true;
    var btn = panel.mode === "auto" ? panel.autoBtn : panel.btn;
    btn.classList.add("busy");

    try {
      var data = await InstantClient.api("cashout", {
        round_id: panel.roundId || round.roundId,
        bet_id: panel.betId,
        multiplier: mult,
      });
      setBalance(data.credit);
      if (data.won) {
        var tag = panel.autoEnabled ? "Auto · " : "";
        toast(tag + "Sacou " + fmtMoney(data.win_amount) + " @ " + data.multiplier.toFixed(2) + "x");
        updateLiveBetMult(panel.betAmount, data.multiplier);
      } else {
        toast("Não sacou a tempo — crash @ " + (data.multiplier || mult).toFixed(2) + "x");
      }
      setPanelState(panel, "idle");
    } catch (e) {
      toast(e.message || "Erro ao sacar");
    } finally {
      panel.cashingOut = false;
      btn.classList.remove("busy");
    }
  }

  function stopFlight() {
    if (round.animId) cancelAnimationFrame(round.animId);
    round.animId = null;
  }

  function onCrash(crashMult) {
    stopFlight();
    round.phase = "crashed";
    var displayMult = crashMult || round.crashPoint || 1;
    setMultiplierUI(displayMult, "crashed");
    drawFrame(1, displayMult, true);
    history.unshift(displayMult);
    renderHistory();

    panels.forEach(function (p) {
      if (p.state === "flying") setPanelState(p, "idle");
    });

    setTimeout(function () {
      openBettingWindow();
    }, 2200);
  }

  function settleCrash() {
    if (!round.roundId || round.settling) {
      onCrash(1);
      return;
    }
    round.settling = true;

    InstantClient.api("crash", { round_id: round.roundId })
      .then(function (data) {
        setBalance(data.credit);
        var cp = data.crash_point ? Number(data.crash_point) : round.crashPoint;
        onCrash(cp || multFromTime(round.crashInMs));
      })
      .catch(function (e) {
        toast(e.message || "Erro ao encerrar rodada");
        onCrash(round.crashPoint || multFromTime(round.crashInMs));
      })
      .finally(function () {
        round.settling = false;
      });
  }

  function tick() {
    if (round.phase !== "flying") return;
    if (!round.startedAt || !round.crashInMs) return;

    var elapsed = Date.now() - round.startedAt;
    var mult = multFromTime(elapsed);
    var progress = Math.min(1, elapsed / round.crashInMs);

    setMultiplierUI(mult);
    drawFrame(progress, mult, false);

    panels.forEach(function (p) {
      if (p.state === "flying") updatePanelBtnLabel(p);
    });

    checkAutoCashouts(mult);

    if (elapsed >= round.crashInMs) {
      if (panels.some(function (p) { return p.cashingOut; })) return;
      settleCrash();
      return;
    }
    round.animId = requestAnimationFrame(tick);
  }

  /* ── Canvas ── */
  function resizeCanvas() {
    var wrap = els.canvas.parentElement;
    var dpr = window.devicePixelRatio || 1;
    els.canvas.width = wrap.clientWidth * dpr;
    els.canvas.height = wrap.clientHeight * dpr;
    els.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    els.w = wrap.clientWidth;
    els.h = wrap.clientHeight;
  }

  function drawPlane(ctx, x, y, crashed) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.1);
    ctx.fillStyle = crashed ? "#666" : "#ff6b00";
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-12, -8);
    ctx.lineTo(-8, 0);
    ctx.lineTo(-12, 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = crashed ? "#444" : "#ffb347";
    ctx.fillRect(-14, -3, 12, 6);
    ctx.fillStyle = crashed ? "#555" : "#ff3300";
    ctx.beginPath();
    ctx.moveTo(-16, 0);
    ctx.lineTo(-24, -6);
    ctx.lineTo(-20, 0);
    ctx.lineTo(-24, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawFrame(progress, mult, crashed) {
    var ctx = els.ctx;
    var w = els.w;
    var h = els.h;
    ctx.clearRect(0, 0, w, h);

    var cx = w * 0.06;
    var cy = h * 0.75;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rayAngle);
    for (var i = 0; i < 24; i++) {
      ctx.rotate((Math.PI * 2) / 24);
      var grd = ctx.createLinearGradient(0, 0, w, 0);
      grd.addColorStop(0, "rgba(255, 107, 0, 0.35)");
      grd.addColorStop(1, "rgba(229, 5, 57, 0)");
      ctx.strokeStyle = grd;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w * 1.1, 0);
      ctx.stroke();
    }
    ctx.restore();
    rayAngle += 0.004;

    var maxT = Math.min(1, progress);
    var points = [];
    for (var t = 0; t <= maxT; t += 0.02) {
      var px = cx + Math.pow(t, 0.75) * (w - cx - 30);
      var py = cy - Math.pow(t, 1.2) * (cy - 40);
      points.push({ x: px, y: py });
    }

    if (points.length > 1) {
      ctx.strokeStyle = "#ff6b00";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (var j = 1; j < points.length; j++) ctx.lineTo(points[j].x, points[j].y);
      ctx.stroke();
      ctx.lineTo(points[points.length - 1].x, cy);
      ctx.lineTo(cx, cy);
      ctx.closePath();
      ctx.fillStyle = crashed ? "rgba(255,107,0,0.12)" : "rgba(255,107,0,0.18)";
      ctx.fill();
    }

    if (points.length) {
      var last = points[points.length - 1];
      drawPlane(ctx, last.x, last.y, crashed);
    }
  }

  function setMultiplierUI(mult, mode) {
    els.multiplier.textContent = mult.toFixed(2) + "x";
    els.multiplier.className = "multiplier" + (mode ? " " + mode : "");
    els.flewAway.classList.toggle("show", mode === "crashed");
  }

  /* ── Live bets ── */
  var liveBets = [];

  function renderLiveBets() {
    els.liveBets.innerHTML = "";
    liveBets.slice(0, 30).forEach(function (b) {
      var row = document.createElement("div");
      row.className = "live-bet-row";
      row.innerHTML =
        '<span class="user">' + b.user + "</span>" +
        '<span class="amount">' + fmtMoney(b.amount) + "</span>" +
        '<span class="mult">' + (b.mult ? b.mult.toFixed(2) + "x" : "—") + "</span>";
      els.liveBets.appendChild(row);
    });
    els.liveCount.textContent = String(liveBets.length);
    els.liveTotal.textContent = fmtMoney(liveBets.reduce(function (s, b) { return s + b.amount; }, 0));
  }

  function addLiveBet(user, amount, mult) {
    liveBets.unshift({ user: user, amount: amount, mult: mult });
    if (liveBets.length > 40) liveBets.pop();
    renderLiveBets();
  }

  function updateLiveBetMult(amount, mult) {
    var bet = liveBets.find(function (b) { return b.user === "Você" && b.amount === amount && !b.mult; });
    if (bet) bet.mult = mult;
    renderLiveBets();
  }

  setInterval(function () {
    if (Math.random() > 0.45) return;
    var name = FAKE_NAMES[Math.floor(Math.random() * FAKE_NAMES.length)] + "***";
    var amount = [5, 10, 20, 50, 100][Math.floor(Math.random() * 5)];
    addLiveBet(name, amount, null);
  }, 2000);

  function bindAmountControls(panel, input) {
    var body = input.closest(".panel-body");
    body.querySelector(".minus").onclick = function () {
      if (isPanelLocked(panel)) return;
      input.value = Math.max(session.min_bet, panelBetAmount(panel) - 1).toFixed(2);
      updatePanelBtnLabel(panel);
    };
    body.querySelector(".plus").onclick = function () {
      if (isPanelLocked(panel)) return;
      input.value = Math.min(session.max_bet, panelBetAmount(panel) + 1).toFixed(2);
      updatePanelBtnLabel(panel);
    };
    body.querySelectorAll(".quick-btn").forEach(function (btn) {
      btn.onclick = function () {
        if (isPanelLocked(panel)) return;
        var add = Number(btn.getAttribute("data-add"));
        input.value = Math.min(session.max_bet, panelBetAmount(panel) + add).toFixed(2);
        updatePanelBtnLabel(panel);
      };
    });
    input.onchange = function () { updatePanelBtnLabel(panel); };
  }

  function initPanels() {
    $$(".bet-panel").forEach(function (el) {
      var panel = {
        el: el,
        mode: "bet",
        bodyBet: el.querySelector(".panel-body-bet"),
        bodyAuto: el.querySelector(".panel-body-auto"),
        input: el.querySelector(".bet-input"),
        inputAuto: el.querySelector(".bet-input-auto"),
        btn: el.querySelector(".panel-body-bet .action-btn"),
        autoBtn: el.querySelector(".auto-start-btn"),
        autoCashoutToggle: el.querySelector(".auto-cashout-toggle"),
        autoCashoutInput: el.querySelector(".auto-cashout-input"),
        autoRoundsToggle: el.querySelector(".auto-rounds-toggle"),
        autoRoundsInput: el.querySelector(".auto-rounds-input"),
        state: "idle",
        betId: null,
        roundId: null,
        betAmount: 0,
        cashingOut: false,
        autoEnabled: false,
        autoRoundsLeft: null,
      };

      el.querySelectorAll(".panel-tab").forEach(function (tab) {
        tab.onclick = function () {
          if (panel.autoEnabled && tab.getAttribute("data-tab") === "bet") {
            toast("Desligue o Auto antes de trocar de aba");
            return;
          }
          setPanelTab(panel, tab.getAttribute("data-tab"));
        };
      });

      bindAmountControls(panel, panel.input);
      bindAmountControls(panel, panel.inputAuto);

      panel.autoCashoutInput.onchange = function () {
        syncAutoCashoutInput(panel);
        updateAutoBtnLabel(panel);
      };
      el.querySelector(".cashout-minus").onclick = function () {
        if (isPanelLocked(panel)) return;
        panel.autoCashoutInput.value = Math.max(1.01, panelAutoCashoutMult(panel) - 0.1).toFixed(2);
        updateAutoBtnLabel(panel);
      };
      el.querySelector(".cashout-plus").onclick = function () {
        if (isPanelLocked(panel)) return;
        panel.autoCashoutInput.value = Math.min(500, panelAutoCashoutMult(panel) + 0.1).toFixed(2);
        updateAutoBtnLabel(panel);
      };
      panel.autoCashoutToggle.onchange = function () {
        panel.autoCashoutInput.disabled = !panel.autoCashoutToggle.checked;
        el.querySelector(".auto-cashout-row").classList.toggle("disabled", !panel.autoCashoutToggle.checked);
        updateAutoBtnLabel(panel);
      };
      panel.autoRoundsToggle.onchange = function () {
        panel.autoRoundsInput.disabled = !panel.autoRoundsToggle.checked;
        el.querySelector(".auto-rounds-row").classList.toggle("disabled", !panel.autoRoundsToggle.checked);
      };

      panel.btn.onclick = function () { onPanelClick(panel); };
      panel.autoBtn.onclick = function () { onAutoClick(panel); };

      panels.push(panel);
      setPanelState(panel, "idle");
    });
  }

  async function init() {
    els.canvas = $("#game-canvas");
    els.ctx = els.canvas.getContext("2d");
    els.multiplier = $("#multiplier");
    els.flewAway = $("#flew-away");
    els.balance = $("#balance");
    els.historyBar = $("#history-bar");
    els.stageHint = $("#stage-hint");
    els.toast = $("#toast");
    els.liveBets = $("#live-bets");
    els.liveCount = $("#live-count");
    els.liveTotal = $("#live-total");

    window.addEventListener("resize", function () {
      resizeCanvas();
      drawFrame(0, 1, false);
    });

    initPanels();
    resizeCanvas();
    drawFrame(0, 1, false);

    try {
      var s = await InstantClient.api("session");
      session.min_bet = s.min_bet;
      session.max_bet = s.max_bet;
      setBalance(s.credit);
      panels.forEach(function (p) {
        p.input.min = s.min_bet;
        p.input.max = s.max_bet;
        p.inputAuto.min = s.min_bet;
        p.inputAuto.max = s.max_bet;
        updatePanelBtnLabel(p);
      });
    } catch (e) {
      toast(e.message);
    }

    for (var i = 0; i < 8; i++) history.push(1 + Math.random() * 8);
    renderHistory();
    openBettingWindow();
  }

  init();
})();
