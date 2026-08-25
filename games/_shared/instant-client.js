(function (global) {
  "use strict";

  function getParams() {
    return new URLSearchParams(window.location.search);
  }

  function getApiUrl() {
    var p = getParams();
    var token = p.get("sessionToken") || p.get("token") || "";
    return p.get("apiUrl") || (token ? "/api/v1/game/" + token : "");
  }

  function getSessionToken() {
    var p = getParams();
    return p.get("sessionToken") || p.get("token") || "";
  }

  async function api(action, payload) {
    var url = getApiUrl();
    if (!url) throw new Error("sessionToken ausente na URL");
    var body = Object.assign({ action: action, id: getSessionToken() }, payload || {});
    var res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    var json;
    try {
      json = await res.json();
    } catch (_e) {
      throw new Error("Resposta inválida do servidor (" + res.status + ")");
    }
    if (!json.success) throw new Error(json.message || "Erro na API");
    return json.data;
  }

  function money(v) {
    return "R$" + Number(v).toFixed(2).replace(".", ",");
  }

  global.InstantClient = { api: api, money: money, getSessionToken: getSessionToken };
})(window);
