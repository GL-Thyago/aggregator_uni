(function () {
  "use strict";

  var LINE_OPTIONS = [1, 5, 10, 15, 20, 25];
  var BET_OPTIONS = [5, 10, 15, 20, 25, 30, 35, 40];

  var LINES_LEFT = [10, 4, 2, 8, 12, 6, 1, 7, 13, 9, 3, 5, 11];
  var LINES_RIGHT = [22, 16, 14, 20, 24, 18, 19, 25, 21, 15, 17, 23];

  var SYMBOL_IDS = [
    "host_man", "host_woman", "jet", "yacht", "mansion",
    "car", "ring", "cash", "camera", "clapper",
  ];

  var params = new URLSearchParams(window.location.search);
  var sessionToken = params.get("sessionToken") || params.get("token") || "";
  var apiUrl = params.get("apiUrl") || (sessionToken ? "/api/v1/game/" + sessionToken : "");

  var state = {
    lines: 25,
    betPerLine: 5,
    spinning: false,
    sessionData: null,
    paylines: [],
    showAllLines: false,
    lastWinLines: [],
  };

  var els = {};

  function $(id) { return document.getElementById(id); }

  function initEls() {
    els.cabinet = $("cabinet");
    els.balance = $("balance");
    els.alimento = $("alimento");
    els.gana = $("gana");
    els.msgText = $("msg-text");
    els.reels = $("reels");
    els.linesLeft = $("lines-left");
    els.linesRight = $("lines-right");
    els.betPerLineLabel = $("bet-per-line-label");
    els.linesLabel = $("lines-label");
    els.minBet = $("min-bet");
    els.jpGrand = $("jp-grand");
    els.jpMajor = $("jp-major");
    els.jpMinor = $("jp-minor");
    els.paytable = $("paytable");
    els.modalAyuda = $("modal-ayuda");
    els.btnCobrar = $("btn-cobrar");
    els.btnAyuda = $("btn-ayuda");
    els.btnLineas = $("btn-lineas");
    els.btnAumento = $("btn-aumento");
    els.btnShowLines = $("btn-show-lines");
    els.btnIniciar = $("btn-iniciar");
    els.modalClose = $("modal-close");
  }

  function fitCabinet() {
    if (!els.cabinet) return;
    els.cabinet.style.transform = "none";
    var rect = els.cabinet.getBoundingClientRect();
    var scale = Math.min(window.innerWidth / rect.width, window.innerHeight / rect.height, 1);
    els.cabinet.style.transform = "scale(" + scale + ")";
  }

  function money(centavos) {
    return "R$" + (Number(centavos) / 100).toFixed(2).replace(".", ",");
  }

  function creditDisplay(reais) {
    return Math.round(Number(reais) * 100);
  }

  function totalBet() {
    return state.lines * state.betPerLine;
  }

  function symbolImg(sym) {
    var id = SYMBOL_IDS.indexOf(sym) >= 0 ? sym : "clapper";
    return '<img src="assets/symbols/' + id + '.svg" alt="' + sym + '">';
  }

  function getPaylinePattern(lineNum) {
    var pl = state.paylines[lineNum - 1];
    return pl ? pl.rows : null;
  }

  function renderLineBadges() {
    els.linesLeft.innerHTML = "";
    els.linesRight.innerHTML = "";

    function addDot(container, num) {
      var active = num <= state.lines;
      var winning = state.lastWinLines.indexOf(num) >= 0;
      var el = document.createElement("div");
      el.className = "line-dot" + (active ? " active" : "") + (winning ? " winning" : "");
      el.textContent = String(num);
      el.title = "Linha " + num;
      container.appendChild(el);
    }

    LINES_LEFT.forEach(function (n) { addDot(els.linesLeft, n); });
    LINES_RIGHT.forEach(function (n) { addDot(els.linesRight, n); });
  }

  function drawPaylines(highlight) {
    var canvas = $("payline-canvas");
    var wrap = canvas && canvas.parentElement;
    if (!wrap) return;

    var rect = wrap.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    var gap = 3;
    var cellW = (canvas.width - gap * 4) / 5;
    var cellH = (canvas.height - gap * 2) / 3;

    function center(col, row) {
      return {
        x: col * (cellW + gap) + cellW / 2,
        y: row * (cellH + gap) + cellH / 2,
      };
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
      ctx.strokeStyle = isWin ? "rgba(255,215,0,0.95)" : "rgba(156,39,176,0.35)";
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
      for (var c = 0; c < (line.count || 3); c++) {
        winCells[c + "-" + pat[c]] = true;
      }
    });

    els.reels.innerHTML = "";
    for (var row = 0; row < 3; row++) {
      for (var col = 0; col < 5; col++) {
        var idx = row * 5 + col;
        var sym = symbols[idx] || "clapper";
        var cell = document.createElement("div");
        cell.className = "cell";
        if (winCells[col + "-" + row]) cell.classList.add("win");
        cell.innerHTML = '<span class="cell-num">' + (idx + 1) + "</span>" + symbolImg(sym);
        els.reels.appendChild(cell);
      }
    }

    renderLineBadges();
    requestAnimationFrame(function () {
      drawPaylines(state.lastWinLines.length ? state.lastWinLines : null);
    });
  }

  function jackpotDisplay(value) {
    return String(Math.round(Number(value) * 100));
  }

  function updateJackpots() {
    var sd = state.sessionData;
    if (!sd || !sd.jackpots) return;
    var fullMin = (sd.payout_scale && sd.payout_scale.fullScaleMinBetPerLine) || 10;
    var pool = state.betPerLine >= fullMin ? sd.jackpots.fullScale : sd.jackpots.lowScale;
    els.jpGrand.textContent = jackpotDisplay(pool.grand);
    els.jpMajor.textContent = jackpotDisplay(pool.major);
    els.jpMinor.textContent = jackpotDisplay(pool.minor);
  }

  function updateDisplays() {
    els.betPerLineLabel.textContent = String(state.betPerLine);
    els.linesLabel.textContent = String(state.lines);
    els.minBet.textContent = String(
      (state.sessionData && state.sessionData.lines && state.sessionData.lines.minTotal) || 125
    );
    els.alimento.textContent = String(totalBet());
    updateJackpots();
    renderLineBadges();
    drawPaylines(null);
  }

  function setMessage(text, type) {
    els.msgText.textContent = text || "";
    els.msgText.className = "msg-text" + (type ? " " + type : "");
  }

  function renderPaytable(symbols) {
    var html = "<table><thead><tr><th>Símbolo</th><th>3×</th><th>4×</th><th>5×</th></tr></thead><tbody>";
    (symbols || []).forEach(function (s) {
      html += "<tr><td>" + symbolImg(s.id) + " " + s.name + "</td><td>" + s.win_3 + "</td><td>" + s.win_4 + "</td><td>" + s.win_5 + "</td></tr>";
    });
    html += "</tbody></table>";
    html += "<p style='font-size:0.72rem;color:#aaa;margin-top:8px'>Prêmio = aposta/linha × multiplicador × escala.<br>Jackpots na tela em centavos (ex.: GRAND 200000 = R$ 2.000,00).</p>";
    els.paytable.innerHTML = html;
  }

  function setButtonsEnabled(on) {
    els.btnIniciar.disabled = !on;
    els.btnLineas.disabled = !on;
    els.btnAumento.disabled = !on;
    els.btnCobrar.disabled = !on;
    els.btnShowLines.disabled = !on;
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
      setMessage("Sessão inválida", "lose");
      setButtonsEnabled(false);
      return;
    }

    var res = await api("session");
    if (!res.success) {
      setMessage("Erro ao carregar", "lose");
      setButtonsEnabled(false);
      return;
    }

    state.sessionData = res.data;
    state.paylines = res.data.paylines || [];
    if (res.data.line_presets) LINE_OPTIONS = res.data.line_presets;

    els.balance.textContent = String(creditDisplay(res.data.credit));
    renderPaytable(res.data.symbols || []);
    var rules = res.data.rules || [];
    $("rules-list").innerHTML = rules.map(function (r) { return "<li>" + r + "</li>"; }).join("");
    renderGrid(Array(15).fill("clapper"), []);
    updateDisplays();
    setMessage("Boa sorte!");
    setButtonsEnabled(true);
  }

  async function refreshBalance() {
    var res = await api("session");
    if (res.success) {
      els.balance.textContent = String(creditDisplay(res.data.credit));
      setMessage("Saldo atualizado");
    }
  }

  function cycleLines() {
    var idx = LINE_OPTIONS.indexOf(state.lines);
    if (idx < 0) idx = LINE_OPTIONS.length - 1;
    state.lines = LINE_OPTIONS[(idx + 1) % LINE_OPTIONS.length];
    updateDisplays();
  }

  function cycleBet() {
    var idx = BET_OPTIONS.indexOf(state.betPerLine);
    state.betPerLine = BET_OPTIONS[(idx + 1) % BET_OPTIONS.length];
    updateDisplays();
  }

  async function spin() {
    if (state.spinning || !state.sessionData) return;

    var tb = totalBet();
    state.spinning = true;
    setButtonsEnabled(false);
    els.gana.textContent = "0";
    setMessage("Girando...");
    state.lastWinLines = [];

    var cells = els.reels.querySelectorAll(".cell");
    cells.forEach(function (c) { c.classList.add("spinning"); });

    try {
      var res = await api("spin", {
        active_lines: state.lines,
        bet_per_line: state.betPerLine,
        bet_total: tb,
      });

      cells.forEach(function (c) { c.classList.remove("spinning"); });

      if (!res.success) {
        setMessage(String(res.message || "Erro"), "lose");
        return;
      }

      var data = res.data;
      var grid = (data.pull && data.pull.SlotIcons) || (data.pull && data.pull.Grid) || [];
      var winLines = (data.pull && data.pull.ActiveLines) || [];

      renderGrid(grid, winLines);
      els.balance.textContent = String(creditDisplay(data.credit));

      var winCentavos = data.win_centavos || 0;
      els.gana.textContent = String(winCentavos);

      if (winCentavos > 0) {
        setMessage("Ganhou " + money(winCentavos) + "!", "win");
      } else {
        setMessage("Tente novamente", "lose");
      }
    } catch (err) {
      setMessage("Erro de conexão", "lose");
      console.error(err);
    } finally {
      state.spinning = false;
      setButtonsEnabled(true);
    }
  }

  function bindEvents() {
    els.btnIniciar.addEventListener("click", spin);
    els.btnLineas.addEventListener("click", cycleLines);
    els.btnAumento.addEventListener("click", cycleBet);
    els.btnAyuda.addEventListener("click", function () {
      els.modalAyuda.classList.remove("hidden");
    });
    els.modalClose.addEventListener("click", function () {
      els.modalAyuda.classList.add("hidden");
    });
    els.btnCobrar.addEventListener("click", refreshBalance);
    els.btnShowLines.addEventListener("click", function () {
      state.showAllLines = !state.showAllLines;
      drawPaylines(null);
      setMessage(state.showAllLines ? "Mostrando " + state.lines + " linhas" : "");
    });
    window.addEventListener("resize", function () {
      fitCabinet();
      drawPaylines(state.lastWinLines.length ? state.lastWinLines : null);
    });
  }

  initEls();
  bindEvents();
  renderGrid(Array(15).fill("clapper"), []);
  loadSession();
  requestAnimationFrame(function () {
    fitCabinet();
    requestAnimationFrame(fitCabinet);
  });
})();
