(function () {
  "use strict";
  var rollOver = true;
  var els = {};

  function $(id) { return document.getElementById(id); }

  async function play() {
    els.message.textContent = "";
    els.btnPlay.disabled = true;
    try {
      var data = await InstantClient.api("play", {
        betAmount: Number(els.bet.value),
        target: Number(els.target.value),
        roll_over: rollOver,
      });
      els.balance.textContent = InstantClient.money(data.credit);
      els.roll.textContent = data.roll;
      els.roll.className = "roll " + (data.won ? "win" : "lose");
      els.message.textContent = data.won
        ? "Ganhou " + InstantClient.money(data.win_amount) + "!"
        : "Perdeu…";
    } catch (e) {
      els.message.textContent = e.message;
    }
    els.btnPlay.disabled = false;
  }

  async function init() {
    els.balance = $("balance");
    els.bet = $("bet");
    els.target = $("target");
    els.roll = $("roll");
    els.hint = $("hint");
    els.message = $("message");
    els.btnPlay = $("btn-play");
    els.btnOver = $("btn-over");
    els.btnUnder = $("btn-under");

    els.btnPlay.onclick = play;
    els.btnOver.onclick = function () {
      rollOver = true;
      els.btnOver.className = "active";
      els.btnUnder.className = "";
      els.hint.textContent = "Role ACIMA do alvo para ganhar";
    };
    els.btnUnder.onclick = function () {
      rollOver = false;
      els.btnUnder.className = "active";
      els.btnOver.className = "";
      els.hint.textContent = "Role ABAIXO do alvo para ganhar";
    };

    try {
      var s = await InstantClient.api("session");
      els.balance.textContent = InstantClient.money(s.credit);
      els.bet.min = s.min_bet;
      els.bet.max = s.max_bet;
    } catch (e) {
      els.message.textContent = e.message;
    }
  }

  init();
})();
