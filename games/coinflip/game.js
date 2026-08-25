(function () {
  "use strict";
  var choice = "heads";
  var els = {};

  function $(id) { return document.getElementById(id); }

  async function play() {
    els.message.textContent = "";
    els.btnPlay.disabled = true;
    els.coin.className = "coin flip";
    try {
      var data = await InstantClient.api("play", {
        betAmount: Number(els.bet.value),
        choice: choice,
      });
      setTimeout(function () {
        els.coin.className = "coin " + (data.won ? "win" : "lose");
        els.coin.textContent = data.result === "heads" ? "H" : "T";
        els.balance.textContent = InstantClient.money(data.credit);
        els.message.textContent = data.won
          ? "Ganhou " + InstantClient.money(data.win_amount) + " (" + (data.multiplier || 2).toFixed(2) + "x)"
          : "Perdeu…";
        els.btnPlay.disabled = false;
      }, 400);
    } catch (e) {
      els.message.textContent = e.message;
      els.btnPlay.disabled = false;
    }
  }

  async function init() {
    els.balance = $("balance");
    els.bet = $("bet");
    els.coin = $("coin");
    els.message = $("message");
    els.btnPlay = $("btn-play");

    $("btn-heads").onclick = function () {
      choice = "heads";
      $("btn-heads").className = "choice active";
      $("btn-tails").className = "choice";
    };
    $("btn-tails").onclick = function () {
      choice = "tails";
      $("btn-tails").className = "choice active";
      $("btn-heads").className = "choice";
    };
    els.btnPlay.onclick = play;

    try {
      var s = await InstantClient.api("session");
      els.balance.textContent = InstantClient.money(s.credit);
    } catch (e) {
      els.message.textContent = e.message;
    }
  }

  init();
})();
