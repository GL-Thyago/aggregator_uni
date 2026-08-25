(function () {
  "use strict";

  var WHEEL_ORDER = [1, 14, 2, 13, 3, 12, 4, 11, 5, 10, 6, 9, 7, 8, 0];
  var TILE_WIDTH = 62;
  var BETTING_MS = 8000;

  var session = { min_bet: 1, max_bet: 500, credit: 0 };
  var choice = "red";
  var choiceAuto = "red";
  var history = [];
  var autoRunning = false;
  var autoLeft = 0;
  var spinning = false;
  var bettingTimer = null;
  var bettingEndsAt = 0;

  var els = {};

  function $(id) { return document.getElementById(id); }

  function tileColor(n) {
    if (n === 0) return "white";
    if (n <= 7) return "red";
    return "black";
  }

  function clampBet(v) {
    return Math.max(session.min_bet, Math.min(session.max_bet, Math.round(v * 100) / 100));
  }

  function activeBetInput() {
    return els.panelAuto.classList.contains("hidden") ? els.bet : els.betAuto;
  }

  function activeChoice() {
    return els.panelAuto.classList.contains("hidden") ? choice : choiceAuto;
  }

  function setBalance(v) {
    session.credit = v;
    els.balance.textContent = InstantClient.money(v);
  }

  function renderHistory() {
    els.historyList.innerHTML = "";
    history.slice(0, 30).forEach(function (item) {
      var el = document.createElement("div");
      el.className = "history-item " + item.color;
      el.textContent = item.tile === 0 ? "0" : String(item.tile);
      el.title = item.color;
      els.historyList.appendChild(el);
    });
  }

  function buildWheel() {
    els.wheelTrack.innerHTML = "";
    var repeats = 8;
    for (var r = 0; r < repeats; r++) {
      WHEEL_ORDER.forEach(function (num) {
        var tile = document.createElement("div");
        tile.className = "wheel-tile " + tileColor(num);
        tile.dataset.num = String(num);
        tile.textContent = num === 0 ? "0" : String(num);
        els.wheelTrack.appendChild(tile);
      });
    }
  }

  function wheelOffsetForIndex(index, extraLaps) {
    var centerTile = (WHEEL_ORDER.length * 4) + index;
    var px = centerTile * TILE_WIDTH + TILE_WIDTH / 2;
    return px;
  }

  function animateToTile(tile, wheelIndex, cb) {
    els.wheelWrap.classList.add("spinning");
    var targetIndex = wheelIndex >= 0 ? wheelIndex : WHEEL_ORDER.indexOf(tile);
    var laps = 3 + Math.floor(Math.random() * 2);
    var totalIndex = WHEEL_ORDER.length * laps + targetIndex;
    var offset = totalIndex * TILE_WIDTH + TILE_WIDTH / 2;
    els.wheelTrack.style.transform = "translateX(-" + offset + "px)";
    setTimeout(function () {
      els.wheelWrap.classList.remove("spinning");
      els.wheelTrack.style.transition = "none";
      var resetIndex = (WHEEL_ORDER.length * 4) + targetIndex;
      els.wheelTrack.style.transform = "translateX(-" + (resetIndex * TILE_WIDTH + TILE_WIDTH / 2) + "px)";
      requestAnimationFrame(function () {
        els.wheelTrack.style.transition = "";
        if (cb) cb();
      });
    }, 4200);
  }

  function setStatus(text, countdown) {
    els.statusText.textContent = text;
    if (countdown) {
      els.countdown.classList.remove("hidden");
      els.countdown.textContent = countdown;
    } else {
      els.countdown.classList.add("hidden");
    }
  }

  function startBettingPhase() {
    bettingEndsAt = Date.now() + BETTING_MS;
    setStatus("Apostas abertas");
    els.btnPlay.disabled = false;
    clearInterval(bettingTimer);
    bettingTimer = setInterval(function () {
      var left = Math.max(0, Math.ceil((bettingEndsAt - Date.now()) / 1000));
      if (left > 0) {
        setStatus("Apostas abertas", left + "s");
      } else {
        clearInterval(bettingTimer);
        setStatus("Aguardando aposta…");
      }
    }, 200);
  }

  async function playRound(isAuto) {
    if (spinning) return;
    var input = isAuto ? els.betAuto : els.bet;
    var bet = clampBet(Number(input.value));
    input.value = bet.toFixed(2);
    var color = isAuto ? choiceAuto : choice;

    if (bet > session.credit) {
      els.message.textContent = "Saldo insuficiente";
      els.message.className = "message lose";
      stopAuto();
      return;
    }

    spinning = true;
    els.btnPlay.disabled = true;
    els.message.textContent = "";
    els.message.className = "message";
    setStatus("Girando…");

    try {
      var data = await InstantClient.api("play", { betAmount: bet, color: color });
      animateToTile(data.tile, data.wheel_index, function () {
        history.unshift({ tile: data.tile, color: data.result });
        renderHistory();
        setBalance(data.credit);

        if (data.won) {
          els.message.textContent =
            "Ganhou " + InstantClient.money(data.win_amount) + " (" + data.multiplier.toFixed(2) + "x)";
          els.message.className = "message win";
        } else {
          var labels = { red: "Vermelho", black: "Preto", white: "Branco" };
          els.message.textContent =
            "Caiu " + labels[data.result] + " (" + data.tile + ") — sem prêmio";
          els.message.className = "message lose";
        }

        spinning = false;
        startBettingPhase();

        if (autoRunning) {
          autoLeft -= 1;
          if (autoLeft <= 0) {
            stopAuto();
          } else {
            setTimeout(function () { playRound(true); }, 1200);
          }
        }
      });
    } catch (e) {
      els.message.textContent = e.message;
      els.message.className = "message lose";
      spinning = false;
      els.btnPlay.disabled = false;
      stopAuto();
      startBettingPhase();
    }
  }

  function stopAuto() {
    autoRunning = false;
    els.btnAuto.textContent = "Iniciar Auto";
    els.btnAuto.classList.add("auto");
  }

  function selectColor(color, auto) {
    if (auto) {
      choiceAuto = color;
      document.querySelectorAll("[data-color-auto]").forEach(function (btn) {
        btn.classList.toggle("active", btn.getAttribute("data-color-auto") === color);
      });
    } else {
      choice = color;
      document.querySelectorAll("[data-color]").forEach(function (btn) {
        btn.classList.toggle("active", btn.getAttribute("data-color") === color);
      });
    }
  }

  function bindAmountControls(halfId, dblId, input) {
    $(halfId).onclick = function () {
      input.value = clampBet(Number(input.value) / 2).toFixed(2);
    };
    $(dblId).onclick = function () {
      input.value = clampBet(Number(input.value) * 2).toFixed(2);
    };
  }

  function switchTab(tab) {
    var normal = tab === "normal";
    els.panelNormal.classList.toggle("hidden", !normal);
    els.panelAuto.classList.toggle("hidden", normal);
    document.querySelectorAll(".panel-tab").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-tab") === tab);
    });
  }

  async function init() {
    els.balance = $("balance");
    els.bet = $("bet");
    els.betAuto = $("bet-auto");
    els.btnPlay = $("btn-play");
    els.btnAuto = $("btn-auto");
    els.wheelTrack = $("wheel-track");
    els.wheelWrap = document.querySelector(".wheel-wrap");
    els.historyList = $("history-list");
    els.message = $("message");
    els.statusText = $("status-text");
    els.countdown = $("countdown");
    els.panelNormal = $("panel-normal");
    els.panelAuto = $("panel-auto");
    els.rulesModal = $("rules-modal");

    buildWheel();

    document.querySelectorAll("[data-color]").forEach(function (btn) {
      btn.onclick = function () { selectColor(btn.getAttribute("data-color"), false); };
    });
    document.querySelectorAll("[data-color-auto]").forEach(function (btn) {
      btn.onclick = function () { selectColor(btn.getAttribute("data-color-auto"), true); };
    });

    document.querySelectorAll(".panel-tab").forEach(function (btn) {
      btn.onclick = function () { switchTab(btn.getAttribute("data-tab")); };
    });

    bindAmountControls("btn-half", "btn-double", els.bet);
    bindAmountControls("btn-half-auto", "btn-double-auto", els.betAuto);

    els.btnPlay.onclick = function () { playRound(false); };
    els.btnAuto.onclick = function () {
      if (autoRunning) {
        stopAuto();
        return;
      }
      autoLeft = Math.max(1, Math.min(100, Number($("auto-rounds").value) || 10));
      autoRunning = true;
      els.btnAuto.textContent = "Parar Auto";
      playRound(true);
    };

    $("btn-rules").onclick = function () { els.rulesModal.classList.remove("hidden"); };
    $("btn-close-rules").onclick = function () { els.rulesModal.classList.add("hidden"); };

    try {
      var s = await InstantClient.api("session");
      session.min_bet = s.min_bet || 1;
      session.max_bet = s.max_bet || 500;
      setBalance(s.credit);
      if (s.wheel_order && s.wheel_order.length === 15) {
        WHEEL_ORDER = s.wheel_order;
        buildWheel();
      }
      els.bet.min = session.min_bet;
      els.bet.max = session.max_bet;
      els.betAuto.min = session.min_bet;
      els.betAuto.max = session.max_bet;
      startBettingPhase();
    } catch (e) {
      els.message.textContent = e.message;
    }
  }

  init();
})();
