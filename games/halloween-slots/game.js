(function () {
  "use strict";

  var LINE_OPTS = [1, 5, 10, 15, 20, 25, 30];
  var BET_OPTS = [5, 10, 15, 20, 25, 30, 35, 40];
  var SYMBOL_IDS = [
    "witch", "pumpkin", "ghost", "bat", "skull",
    "spider", "black_cat", "full_moon", "candle", "candy",
  ];
  var SYMBOL_LABELS = {
    witch: "Bruxa", pumpkin: "Abóbora", ghost: "Fantasma", bat: "Morcego",
    skull: "Caveira", spider: "Aranha", black_cat: "Gato", full_moon: "Lua",
    candle: "Vela", candy: "Doce",
  };

  var params = new URLSearchParams(window.location.search);
  var sessionToken = params.get("sessionToken") || params.get("token") || "";
  var apiUrl = params.get("apiUrl") || (sessionToken ? "/api/v1/game/" + sessionToken : "");

  var state = {
    lines: 30,
    betPerLine: 5,
    spinning: false,
    session: null,
    paylines: [],
    canDouble: false,
    showAllLines: false,
    lastWinLines: [],
  };

  var els = {};

  function $(id) { return document.getElementById(id); }

  function money(c) {
    return "R$" + (Number(c) / 100).toFixed(2).replace(".", ",");
  }

  function moneyReais(v) {
    return "R$" + Number(v).toFixed(2).replace(".", ",");
  }

  function totalBet() { return state.lines * state.betPerLine; }

  function symbolImg(id, size) {
    var sid = SYMBOL_IDS.indexOf(id) >= 0 ? id : "candy";
    return '<img src="assets/symbols/' + sid + '.svg" alt="' + (SYMBOL_LABELS[id] || id) + '" width="' + (size || 32) + '" height="' + (size || 32) + '">';
  }

  function getPaylinePattern(n) {
    var pl = state.paylines[n - 1];
    return pl ? pl.rows : null;
  }

  function renderLineIndicators() {
    var left = $("line-indicators-left");
    var right = $("line-indicators-right");
    left.innerHTML = "";
    right.innerHTML = "";

    function dot(container, num) {
      var active = num <= state.lines;
      var winning = state.lastWinLines.indexOf(num) >= 0;
      var el = document.createElement("div");
      el.className = "line-dot" + (active ? " active" : "") + (winning ? " winning" : "");
      el.textContent = String(num);
      container.appendChild(el);
    }

    for (var i = 1; i <= 15; i++) dot(left, i);
    for (var j = 16; j <= 30; j++) dot(right, j);
  }

  function drawPaylines(highlight) {
    var canvas = $("payline-canvas");
    var wrap = canvas.parentElement;
    if (!wrap) return;

    var rect = wrap.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    var gap = 5;
    var cellW = (canvas.width - gap * 4) / 5;
    var cellH = (canvas.height - gap * 2) / 3;

    function center(col, row) {
      return { x: col * (cellW + gap) + cellW / 2, y: row * (cellH + gap) + cellH / 2 };
    }

    var lines = highlight && highlight.length
      ? highlight
      : state.showAllLines
        ? Array.from({ length: state.lines }, function (_, i) { return i + 1; })
        : [];

    lines.forEach(function (lineNum) {
      var pat = getPaylinePattern(lineNum);
      if (!pat) return;
      var isWin = state.lastWinLines.indexOf(lineNum) >= 0;
      ctx.beginPath();
      ctx.strokeStyle = isWin ? "rgba(255,152,0,0.95)" : "rgba(156,39,176,0.35)";
      ctx.lineWidth = isWin ? 3 : 1.5;
      ctx.setLineDash(isWin ? [] : [4, 4]);
      pat.forEach(function (row, col) {
        var pt = center(col, row);
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
      for (var c = 0; c < (line.count || 3); c++) winCells[c + "-" + pat[c]] = true;
    });

    els.reels.innerHTML = "";
    for (var row = 0; row < 3; row++) {
      for (var col = 0; col < 5; col++) {
        var idx = row * 5 + col;
        var sym = symbols[idx] || "candy";
        var cell = document.createElement("div");
        cell.className = "cell";
        if (winCells[col + "-" + row]) cell.classList.add("win");
        cell.innerHTML = '<span class="cell-num">' + (idx + 1) + "</span>" + symbolImg(sym);
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
    var pool = state.betPerLine >= fullMin ? state.session.jackpots.fullScale : state.session.jackpots.lowScale;
    $("jp-grand").textContent = money(pool.grand * 100);
    $("jp-major").textContent = money(pool.major * 100);
    $("jp-minor").textContent = money(pool.minor * 100);
  }

  function updateDoubleUI() {
    if (state.canDouble) {
      els.btnDouble.classList.remove("hidden");
      els.btnCollect.classList.remove("hidden");
      els.btnSpin.disabled = true;
    } else {
      els.btnDouble.classList.add("hidden");
      els.btnCollect.classList.add("hidden");
      els.btnSpin.disabled = state.spinning;
    }
  }

  function updateUI() {
    $("lines-val").textContent = String(state.lines);
    $("bet-total").textContent = money(totalBet());
    updateJackpots();
    renderLineIndicators();
    drawPaylines(null);
    updateDoubleUI();
  }

  function renderPaytable(symbols) {
    var html = "<table><thead><tr><th>Símbolo</th><th>3×</th><th>4×</th><th>5×</th></tr></thead><tbody>";
    (symbols || []).forEach(function (s) {
      html += "<tr><td>" + symbolImg(s.id, 26) + " " + s.name + "</td><td>" + s.win_3 + "</td><td>" + s.win_4 + "</td><td>" + s.win_5 + "</td></tr>";
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

  async function loadSession() {
    if (!sessionToken) {
      els.message.textContent = "Sessão inválida";
      return;
    }
    var res = await api("session");
    if (!res.success) {
      els.message.textContent = res.message || "Erro";
      return;
    }
    state.session = res.data;
    state.paylines = res.data.paylines || [];
    state.lines = res.data.active_lines_default || 30;
    if (res.data.line_presets) LINE_OPTS = res.data.line_presets;
    state.canDouble = !!res.data.can_double;
    $("balance").textContent = moneyReais(res.data.credit);
    renderPaytable(res.data.symbols);
    $("rules-list").innerHTML = (res.data.rules || []).map(function (r) { return "<li>" + r + "</li>"; }).join("");
    renderGrid(Array(15).fill("pumpkin"), []);
    updateUI();
  }

  async function spin() {
    if (state.spinning || state.canDouble) return;
    state.spinning = true;
    els.btnSpin.disabled = true;
    els.message.textContent = "Girando...";
    els.message.className = "message";
    $("win").textContent = "R$0,00";
    state.lastWinLines = [];

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
      renderGrid((d.pull && d.pull.SlotIcons) || [], (d.pull && d.pull.ActiveLines) || []);
      $("balance").textContent = moneyReais(d.credit);
      $("win").textContent = money(d.win_centavos || 0);
      state.canDouble = !!d.can_double;

      if ((d.win_centavos || 0) > 0) {
        els.message.textContent = "Ganhou " + money(d.win_centavos) + "! Dobrar ou cobrar?";
        els.message.className = "message win";
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

  async function doDouble() {
    if (!state.canDouble || state.spinning) return;
    state.spinning = true;
    els.btnDouble.disabled = true;
    try {
      var res = await api("double");
      if (!res.success) {
        els.message.textContent = res.message || "Erro";
        return;
      }
      var d = res.data;
      $("balance").textContent = moneyReais(d.credit);
      state.canDouble = false;
      if (d.won) {
        els.message.textContent = "DOBROU! +" + money(d.extra_centavos);
        els.message.className = "message win";
      } else {
        els.message.textContent = "Perdeu o prêmio!";
        els.message.className = "message lose";
        $("win").textContent = "R$0,00";
      }
    } catch (e) {
      els.message.textContent = "Erro de conexão";
    } finally {
      state.spinning = false;
      els.btnDouble.disabled = false;
      updateUI();
    }
  }

  async function doCollect() {
    if (!state.canDouble) return;
    await api("collect");
    state.canDouble = false;
    els.message.textContent = "Prêmio confirmado!";
    els.message.className = "message";
    updateUI();
  }

  function init() {
    els.reels = $("reels");
    els.message = $("message");
    els.btnSpin = $("btn-spin");
    els.btnDouble = $("btn-double");
    els.btnCollect = $("btn-collect");

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
    });

    $("btn-rules").addEventListener("click", function () { $("modal-rules").classList.remove("hidden"); });
    $("btn-close-rules").addEventListener("click", function () { $("modal-rules").classList.add("hidden"); });
    els.btnSpin.addEventListener("click", spin);
    els.btnDouble.addEventListener("click", doDouble);
    els.btnCollect.addEventListener("click", doCollect);
    window.addEventListener("resize", function () {
      drawPaylines(state.lastWinLines.length ? state.lastWinLines : null);
    });
    loadSession();
  }

  init();
})();
