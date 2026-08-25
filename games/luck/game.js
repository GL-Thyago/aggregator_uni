(function () {
  "use strict";

  var LINE_OPTS = [1, 5, 9, 15, 25];
  var BET_OPTS = [5, 10, 15, 20, 25, 30, 40, 50];
  var SYMBOL_IDS = [
    "leprechaun", "pot_gold", "rainbow", "horseshoe", "harp",
    "clover", "coin", "mushroom", "mug",
  ];
  var SYMBOL_LABELS = {
    leprechaun: "Duende",
    pot_gold: "Pote",
    rainbow: "Arco-íris",
    horseshoe: "Ferradura",
    harp: "Harpa",
    clover: "Trevo",
    coin: "Moeda",
    mushroom: "Cogumelo",
    mug: "Caneca",
  };

  var params = new URLSearchParams(window.location.search);
  var sessionToken = params.get("sessionToken") || params.get("token") || "";
  var apiUrl = params.get("apiUrl") || (sessionToken ? "/api/v1/game/" + sessionToken : "");

  var state = {
    lines: 25,
    betPerLine: 5,
    spinning: false,
    session: null,
    freeSpins: 0,
    paylines: [],
    bonusRoundId: null,
    bonusPending: false,
    showAllLines: false,
    lastWinLines: [],
  };

  var els = {};

  function $(id) { return document.getElementById(id); }

  function money(centavos) {
    return "R$" + (Number(centavos) / 100).toFixed(2).replace(".", ",");
  }

  function moneyReais(v) {
    return "R$" + Number(v).toFixed(2).replace(".", ",");
  }

  function totalBet() {
    return state.lines * state.betPerLine;
  }

  function symbolImg(id, size) {
    var src = "assets/symbols/" + (SYMBOL_IDS.indexOf(id) >= 0 ? id : "mug") + ".svg";
    return '<img src="' + src + '" alt="' + (SYMBOL_LABELS[id] || id) + '" width="' + (size || 32) + '" height="' + (size || 32) + '">';
  }

  function cellNumber(row, col) {
    return row * 5 + col + 1;
  }

  function getPaylinePattern(lineNum) {
    var pl = state.paylines[lineNum - 1];
    return pl ? pl.rows : null;
  }

  function renderLineIndicators() {
    var left = $("line-indicators-left");
    var right = $("line-indicators-right");
    left.innerHTML = "";
    right.innerHTML = "";

    function addDot(container, num) {
      var active = num <= state.lines;
      var winning = state.lastWinLines.indexOf(num) >= 0;
      var el = document.createElement("div");
      el.className = "line-dot" + (active ? " active" : "") + (winning ? " winning" : "");
      el.textContent = String(num);
      el.title = "Linha " + num;
      container.appendChild(el);
    }

    for (var i = 1; i <= 13; i++) addDot(left, i);
    for (var j = 14; j <= 25; j++) addDot(right, j);
  }

  function drawPaylines(highlightLines) {
    var canvas = $("payline-canvas");
    var wrap = canvas.parentElement;
    if (!wrap) return;

    var rect = wrap.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    var cols = 5;
    var rows = 3;
    var gap = 5;
    var pad = 0;
    var cellW = (canvas.width - pad * 2 - gap * (cols - 1)) / cols;
    var cellH = (canvas.height - pad * 2 - gap * (rows - 1)) / rows;

    function cellCenter(col, row) {
      return {
        x: pad + col * (cellW + gap) + cellW / 2,
        y: pad + row * (cellH + gap) + cellH / 2,
      };
    }

    var linesToDraw = highlightLines && highlightLines.length
      ? highlightLines
      : state.showAllLines
        ? Array.from({ length: state.lines }, function (_, i) { return i + 1; })
        : [];

    linesToDraw.forEach(function (lineNum, idx) {
      var pat = getPaylinePattern(lineNum);
      if (!pat) return;

      var isWin = state.lastWinLines.indexOf(lineNum) >= 0;
      ctx.beginPath();
      ctx.strokeStyle = isWin ? "rgba(255,213,74,0.95)" : "rgba(255,152,0,0.35)";
      ctx.lineWidth = isWin ? 3 : 1.5;
      ctx.setLineDash(isWin ? [] : [4, 4]);

      pat.forEach(function (row, col) {
        var pt = cellCenter(col, row);
        if (col === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();
    });
  }

  function renderGrid(symbols, winLines) {
    state.lastWinLines = (winLines || []).map(function (l) { return l.line; });

    var winCells = {};
    (winLines || []).forEach(function (line) {
      var pat = getPaylinePattern(line.line);
      if (!pat) return;
      for (var c = 0; c < (line.count || 3); c++) {
        winCells[c + "-" + pat[c]] = true;
      }
    });

    els.reels.innerHTML = "";
    for (var row = 0; row < 3; row++) {
      for (var col = 0; col < 5; col++) {
        var idx = row * 5 + col;
        var sym = symbols[idx] || "mug";
        var cell = document.createElement("div");
        cell.className = "cell";
        if (winCells[col + "-" + row]) cell.classList.add("win");
        if (sym === "pot_gold") cell.classList.add("scatter");
        cell.innerHTML =
          '<span class="cell-num">' + cellNumber(row, col) + "</span>" +
          symbolImg(sym);
        els.reels.appendChild(cell);
      }
    }

    renderLineIndicators();
    requestAnimationFrame(function () {
      drawPaylines(state.lastWinLines.length ? state.lastWinLines : null);
    });
  }

  function updateJackpots() {
    if (!state.session || !state.session.jackpots) return;
    var scale = state.session.payout_scale || {};
    var fullMin = scale.fullScaleMinBetPerLine || 10;
    var pool = state.betPerLine >= fullMin
      ? state.session.jackpots.fullScale
      : state.session.jackpots.lowScale;
    $("jp-grand").textContent = money(pool.grand * 100);
    $("jp-major").textContent = money(pool.major * 100);
    $("jp-minor").textContent = money(pool.minor * 100);
  }

  function updateUI() {
    $("lines-val").textContent = String(state.lines);
    $("bet-line-val").textContent = String(state.betPerLine);
    $("bet-total").textContent = money(totalBet());
    $("free-spins").textContent = String(state.freeSpins);
    updateJackpots();
    renderLineIndicators();
    drawPaylines(null);

    if (state.freeSpins > 0) {
      els.bonusBanner.classList.remove("hidden");
      els.bonusBanner.textContent = state.freeSpins + " Rodadas Grátis ×2!";
    } else {
      els.bonusBanner.classList.add("hidden");
    }

    els.btnSpin.disabled = state.spinning || state.bonusPending;
  }

  function renderPaytable(symbols) {
    var html = "<table><thead><tr><th>Símbolo</th><th>3×</th><th>4×</th><th>5×</th></tr></thead><tbody>";
    (symbols || []).forEach(function (s) {
      if (s.id === "pot_gold") {
        html += "<tr><td>" + symbolImg(s.id, 28) + " Scatter</td><td colspan='3'>3+ = Grátis + Caldeirão</td></tr>";
        return;
      }
      html += "<tr><td>" + symbolImg(s.id, 28) + " " + s.name + "</td><td>" + s.win_3 + "</td><td>" + s.win_4 + "</td><td>" + s.win_5 + "</td></tr>";
    });
    html += "</tbody></table>";
    $("paytable").innerHTML = html;
  }

  async function api(action, extra) {
    var res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ action: action, id: sessionToken }, extra || {})),
    });
    return res.json();
  }

  function buildCauldronGrid(count) {
    var grid = $("cauldron-grid");
    grid.innerHTML = "";
    for (var i = 0; i < count; i++) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cauldron-btn";
      btn.dataset.index = String(i);
      btn.innerHTML = '<img src="assets/symbols/cauldron.svg" alt="Caldeirão">';
      btn.addEventListener("click", function () {
        pickCauldron(Number(this.dataset.index));
      });
      grid.appendChild(btn);
    }
  }

  function showBonusModal(roundId, count) {
    state.bonusRoundId = roundId;
    state.bonusPending = true;
    $("bonus-result").classList.add("hidden");
    $("bonus-result").textContent = "";
    $("btn-close-bonus").classList.add("hidden");
    buildCauldronGrid(count || 5);
    $("modal-bonus").classList.remove("hidden");
    updateUI();
  }

  async function pickCauldron(index) {
    if (!state.bonusRoundId || state.spinning) return;
    state.spinning = true;
    var buttons = $("cauldron-grid").querySelectorAll(".cauldron-btn");
    buttons.forEach(function (b) { b.disabled = true; });

    try {
      var res = await api("bonus_pick", {
        round_id: state.bonusRoundId,
        pick: index,
      });

      if (!res.success) {
        $("bonus-result").textContent = res.message || "Erro no bônus";
        $("bonus-result").classList.remove("hidden");
        buttons.forEach(function (b) { b.disabled = false; });
        return;
      }

      var d = res.data;
      var reveal = d.reveal || {};
      var mults = reveal.multipliers || [];
      var bestIdx = reveal.best_index;

      buttons.forEach(function (btn, i) {
        var mult = mults[i];
        var label = document.createElement("span");
        label.className = "mult-label";
        label.textContent = "×" + mult;
        btn.appendChild(label);
        if (i === index) btn.classList.add(i === bestIdx ? "picked-best" : "picked-wrong");
        if (i === bestIdx && i !== index) btn.classList.add("picked-best");
      });

      $("balance").textContent = moneyReais(d.credit);
      $("win").textContent = money(d.win_centavos || 0);

      var msg = index === bestIdx
        ? "Caldeirão da sorte! ×" + d.multiplier + " — Ganhou " + money(d.win_centavos)
        : "×" + d.multiplier + " — Ganhou " + money(d.win_centavos) + " (melhor era ×" + (reveal.best_multiplier || "?") + ")";
      $("bonus-result").textContent = msg;
      $("bonus-result").classList.remove("hidden");
      $("btn-close-bonus").classList.remove("hidden");

      state.bonusRoundId = null;
      state.bonusPending = false;
    } catch (e) {
      $("bonus-result").textContent = "Erro de conexão";
      $("bonus-result").classList.remove("hidden");
      buttons.forEach(function (b) { b.disabled = false; });
    } finally {
      state.spinning = false;
      updateUI();
    }
  }

  function closeBonusModal() {
    $("modal-bonus").classList.add("hidden");
    state.bonusPending = false;
    state.bonusRoundId = null;
    updateUI();
  }

  async function loadSession() {
    if (!sessionToken) {
      els.message.textContent = "Sessão inválida";
      return;
    }
    var res = await api("session");
    if (!res.success) {
      els.message.textContent = res.message || "Erro ao carregar";
      return;
    }
    state.session = res.data;
    state.paylines = res.data.paylines || [];
    state.freeSpins = res.data.free_spins_remaining || 0;
    state.lines = res.data.active_lines_default || 25;

    if (res.data.line_presets) LINE_OPTS = res.data.line_presets;

    $("balance").textContent = moneyReais(res.data.credit);
    renderPaytable(res.data.symbols);
    var rules = res.data.rules || [];
    $("rules-list").innerHTML = rules.map(function (r) { return "<li>" + r + "</li>"; }).join("");
    renderGrid(Array(15).fill("clover"), []);

    if (res.data.bonus_pending && res.data.bonus_round_id) {
      showBonusModal(res.data.bonus_round_id, 5);
    }

    updateUI();
  }

  async function spin() {
    if (state.spinning || state.bonusPending) return;
    state.spinning = true;
    els.btnSpin.disabled = true;
    els.message.textContent = "Girando...";
    els.message.className = "message";
    $("win").textContent = "R$0,00";
    state.lastWinLines = [];
    drawPaylines(null);

    var cells = els.reels.querySelectorAll(".cell");
    cells.forEach(function (c) { c.classList.add("spinning"); });

    try {
      var res = await api("spin", {
        active_lines: state.lines,
        bet_per_line: state.betPerLine,
        bet_total: totalBet(),
      });

      cells.forEach(function (c) { c.classList.remove("spinning"); });

      if (!res.success) {
        els.message.textContent = res.message || "Erro";
        els.message.className = "message lose";
        return;
      }

      var d = res.data;
      var grid = (d.pull && d.pull.SlotIcons) || [];
      var lines = (d.pull && d.pull.ActiveLines) || [];

      renderGrid(grid, lines);
      $("balance").textContent = moneyReais(d.credit);
      $("win").textContent = money(d.win_centavos || 0);
      state.freeSpins = d.free_spins_remaining || 0;
      updateUI();

      if (d.bonus_pending && d.bonus_round) {
        els.message.textContent = "BÔNUS CALDEIRÃO! Escolha seu caldeirão!";
        els.message.className = "message win";
        setTimeout(function () {
          showBonusModal(d.bonus_round.round_id, d.bonus_round.cauldron_count);
        }, 800);
      } else if (d.free_spins_triggered > 0) {
        els.message.textContent = "BÔNUS! +" + d.free_spins_triggered + " rodadas grátis!";
        els.message.className = "message win";
      } else if ((d.win_centavos || 0) > 0) {
        els.message.textContent = "Ganhou " + money(d.win_centavos) + "!";
        els.message.className = "message win";
      } else if (d.free_spin) {
        els.message.textContent = "Rodada grátis — sem prêmio";
        els.message.className = "message";
      } else {
        els.message.textContent = "Tente novamente!";
        els.message.className = "message lose";
      }
    } catch (e) {
      els.message.textContent = "Erro de conexão";
      els.message.className = "message lose";
    } finally {
      state.spinning = false;
      updateUI();
    }
  }

  function init() {
    els.reels = $("reels");
    els.message = $("message");
    els.btnSpin = $("btn-spin");
    els.bonusBanner = $("bonus-banner");

    $("btn-lines").addEventListener("click", function () {
      var i = LINE_OPTS.indexOf(state.lines);
      if (i < 0) i = LINE_OPTS.length - 1;
      state.lines = LINE_OPTS[(i + 1) % LINE_OPTS.length];
      updateUI();
    });

    $("btn-bet").addEventListener("click", function () {
      var i = BET_OPTS.indexOf(state.betPerLine);
      state.betPerLine = BET_OPTS[(i + 1) % BET_OPTS.length];
      updateUI();
    });

    $("btn-show-lines").addEventListener("click", function () {
      state.showAllLines = !state.showAllLines;
      drawPaylines(null);
      els.message.textContent = state.showAllLines
        ? "Mostrando " + state.lines + " linhas ativas"
        : "Linhas ocultas";
    });

    $("btn-rules").addEventListener("click", function () {
      $("modal-rules").classList.remove("hidden");
    });

    $("btn-close-rules").addEventListener("click", function () {
      $("modal-rules").classList.add("hidden");
    });

    $("btn-close-bonus").addEventListener("click", closeBonusModal);
    els.btnSpin.addEventListener("click", spin);

    window.addEventListener("resize", function () {
      drawPaylines(state.lastWinLines.length ? state.lastWinLines : null);
    });

    loadSession();
  }

  init();
})();
