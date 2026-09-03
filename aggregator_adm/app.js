const LS_KEY = "aggregator_adm_key";
const LS_BASE = "aggregator_adm_base";

const state = {
  adminKey: localStorage.getItem(LS_KEY) || "",
  apiBase: localStorage.getItem(LS_BASE) || "/admin/v1",
  clients: [],
  games: [],
  categories: [],
  selectedClientId: "",
  detailClientId: null,
  charts: {},
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function money(v) {
  return "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sinceDate() {
  const days = Number($("#period-select").value || 30);
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function showError(msg) {
  const el = $("#global-error");
  if (!msg) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.textContent = msg;
  el.classList.remove("hidden");
}

/** Extrai IDs do e-mail da Salsa (znt-aviator, tada-Crazy777, evo-oss-…). */
function parseSalsaPackText(raw) {
  const games = [];
  const seen = new Set();

  for (const line of String(raw).split(/\r?\n/)) {
    const matches = [...line.matchAll(/\b([A-Za-z][A-Za-z0-9]{1,14}-[A-Za-z0-9][A-Za-z0-9_-]{1,70})\b/g)];
    for (const m of matches) {
      const code = m[1];
      if (/^ops-\d+$/i.test(code) || /^https?$/i.test(code)) continue;
      if (seen.has(code)) continue;
      seen.add(code);
      const name = line
        .replace(code, " ")
        .replace(/[-–—|:]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      games.push({ code, name: name.length > 1 ? name : undefined });
    }
  }

  return games;
}

async function api(path, opts = {}) {
  const res = await fetch(state.apiBase + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Key": state.adminKey,
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
  return data;
}

function qs(extra = {}) {
  const p = new URLSearchParams({ since: sinceDate(), ...extra });
  if (state.selectedClientId) p.set("clientId", state.selectedClientId);
  return "?" + p.toString();
}

function destroyChart(id) {
  if (state.charts[id]) {
    state.charts[id].destroy();
    delete state.charts[id];
  }
}

function setView(name) {
  $$(".nav").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  $$(".view").forEach((v) => v.classList.add("hidden"));
  $("#view-" + name).classList.remove("hidden");
  const titles = { dashboard: "Dashboard", clients: "Clientes", partners: "Sócios", revenue: "Receita / Repasse", integrations: "Integrações", highlights: "Top 10 / Destaques", rtp: "RTP" };
  $("#view-title").textContent = titles[name] || name;
  if (name === "dashboard") loadDashboard();
  if (name === "clients") loadClientsView();
  if (name === "partners") loadPartnersView();
  if (name === "revenue") loadRevenueView();
  if (name === "integrations") loadIntegrationsView();
  if (name === "highlights") loadHighlightsView();
  if (name === "rtp") loadRtpView();
}

async function loadMeta() {
  [state.clients, state.games, state.categories] = await Promise.all([
    api("/clients"),
    api("/games"),
    api("/categories"),
  ]);
  const sel = $("#client-filter");
  const cur = sel.value;
  sel.innerHTML = '<option value="">Todos os clientes</option>' +
    state.clients.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
  sel.value = cur;
}

function renderOverviewCards(data) {
  $("#overview-cards").innerHTML = [
    { label: "Apostado", value: money(data.betAmount) },
    { label: "Repasse (prêmios)", value: money(data.playerPayout), sub: "Pago aos jogadores" },
    { label: "Seu ganho", value: money(data.aggregatorRevenue), sub: "Taxa jogo + margem B2B", cls: "ok" },
    { label: "GGR", value: money(data.ggr), sub: "Apostado − prêmios" },
    { label: "Spins", value: data.spinCount.toLocaleString("pt-BR") },
    { label: "Clientes ativos", value: data.activeClients },
  ].map((c) => `
    <div class="card">
      <div class="label">${c.label}</div>
      <div class="value ${c.cls || ""}">${c.value}</div>
      ${c.sub ? `<div class="sub">${c.sub}</div>` : ""}
    </div>`).join("");
}

function renderClientMovement(rows) {
  if (!rows.length) {
    $("#client-movement-table").innerHTML = "<p class='hint'>Sem movimento no período.</p>";
    return;
  }
  $("#client-movement-table").innerHTML = `<table>
    <thead><tr>
      <th>Cliente</th><th>Cobrança</th><th>Spins</th><th>Apostado</th>
      <th>Repasse</th><th>Seu ganho</th><th>Saldo B2B</th><th>Última atividade</th>
    </tr></thead>
    <tbody>${rows.map((r) => `
      <tr>
        <td><button class="ghost link-client" data-id="${r.clientId}">${r.clientName}</button></td>
        <td><span class="badge ${r.billingMode === "POSTPAID" ? "postpaid" : "prepaid"}">${r.billingMode === "POSTPAID" ? "Pós-pago" : "Pré-pago"}</span></td>
        <td class="num">${r.spins}</td>
        <td class="num">${money(r.betAmount)}</td>
        <td class="num">${money(r.winAmount)}</td>
        <td class="num ok">${money(r.aggregatorRevenue)}</td>
        <td class="num ${r.walletBalance < 0 ? "bad" : ""}">${money(r.walletBalance)}</td>
        <td>${new Date(r.lastActivity).toLocaleString("pt-BR")}</td>
      </tr>`).join("")}
    </tbody></table>`;
  $$(".link-client").forEach((btn) => btn.addEventListener("click", () => openClientDetail(btn.dataset.id)));
}

async function loadDashboard() {
  showError("");
  try {
    const [overview, timeseries, topGames, movement] = await Promise.all([
      api("/analytics/overview" + qs()),
      api("/analytics/timeseries" + qs()),
      api("/analytics/top-games" + qs({ limit: 8 })),
      api("/analytics/client-movement" + qs()),
    ]);
    renderOverviewCards(overview);
    renderClientMovement(movement);

    destroyChart("timeseries");
    state.charts.timeseries = new Chart($("#chart-timeseries"), {
      type: "line",
      data: {
        labels: timeseries.map((d) => d.date.slice(5)),
        datasets: [
          { label: "Apostado", data: timeseries.map((d) => d.betAmount), borderColor: "#6366f1", tension: 0.3 },
          { label: "Repasse", data: timeseries.map((d) => d.winAmount), borderColor: "#22c55e", tension: 0.3 },
          { label: "Seu ganho", data: timeseries.map((d) => d.revenue), borderColor: "#eab308", tension: 0.3 },
        ],
      },
      options: { responsive: true, plugins: { legend: { labels: { color: "#eef1f7" } } }, scales: { x: { ticks: { color: "#8b93a7" } }, y: { ticks: { color: "#8b93a7" } } } },
    });

    destroyChart("topGames");
    state.charts.topGames = new Chart($("#chart-top-games"), {
      type: "bar",
      data: {
        labels: topGames.map((g) => g.name),
        datasets: [{ label: "Spins", data: topGames.map((g) => g.spins), backgroundColor: "#6366f1" }],
      },
      options: { indexAxis: "y", responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: "#8b93a7" } }, y: { ticks: { color: "#8b93a7" } } } },
    });
  } catch (e) {
    showError(e.message);
  }
}

function renderClientsTable() {
  $("#clients-table").innerHTML = `<table>
    <thead><tr>
      <th>Nome</th><th>Ambiente</th><th>Cobrança</th><th>Cobrança %</th><th>Saldo B2B</th><th>Status</th><th></th>
    </tr></thead>
    <tbody>${state.clients.map((c) => `
      <tr>
        <td>${c.name}</td>
        <td>${c.launchEnvironment === "LIVE" ? "Produção" : "Teste"}</td>
        <td><span class="badge ${c.billingMode === "POSTPAID" ? "postpaid" : "prepaid"}">${c.billingMode === "POSTPAID" ? "Pós-pago" : "Pré-pago"}${c.maxCredit ? ` · limite ${money(c.maxCredit)}` : ""}</span></td>
        <td class="num">${c.chargePct != null ? Number(c.chargePct) + "%" : "padrão"}</td>
        <td class="num">${money(c.clientWallet?.balance ?? 0)}</td>
        <td class="${c.isActive ? "ok" : "bad"}">${c.isActive ? "Ativo" : "Inativo"}</td>
        <td><button class="ghost btn-open-client" data-id="${c.id}">Gerenciar</button></td>
      </tr>`).join("")}
    </tbody></table>`;
  $$(".btn-open-client").forEach((b) => b.addEventListener("click", () => openClientDetail(b.dataset.id)));
}

function buildEntitlementsUI(container, entitlements = []) {
  container.innerHTML = "";
  const addRow = (e = {}) => {
    const row = document.createElement("div");
    row.className = "ent-row";
    row.innerHTML = `
      <label>Categoria<select class="ent-cat">${state.categories.map((c) => `<option value="${c.id}" ${c.id === e.categoryId ? "selected" : ""}>${c.name}</option>`).join("")}</select></label>
      <label>Jogo (opcional)<select class="ent-game"><option value="">Toda categoria</option>${state.games.map((g) => `<option value="${g.id}" ${g.id === e.gameId ? "selected" : ""}>${g.name}</option>`).join("")}</select></label>
      <label>Taxa %<input class="ent-fee" type="number" step="0.1" placeholder="padrão" value="${e.feePct ?? ""}"></label>
      <label>RTP %<input class="ent-rtp" type="number" step="0.1" placeholder="padrão" value="${e.rtpPct ?? ""}"></label>
      <button type="button" class="ghost ent-remove">×</button>`;
    row.querySelector(".ent-remove").addEventListener("click", () => row.remove());
    container.appendChild(row);
  };
  if (entitlements.length) entitlements.forEach(addRow);
  else addRow();
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "ghost";
  addBtn.textContent = "+ Linha de acesso";
  addBtn.addEventListener("click", () => addRow());
  container.appendChild(addBtn);
}

function readEntitlementsFromForm(container) {
  return [...container.querySelectorAll(".ent-row")].map((row) => ({
    categoryId: Number(row.querySelector(".ent-cat").value),
    gameId: row.querySelector(".ent-game").value ? Number(row.querySelector(".ent-game").value) : null,
    feePct: row.querySelector(".ent-fee").value !== "" ? Number(row.querySelector(".ent-fee").value) : null,
    rtpPct: row.querySelector(".ent-rtp").value !== "" ? Number(row.querySelector(".ent-rtp").value) : null,
  }));
}

async function loadClientsView() {
  showError("");
  try {
    await loadMeta();
    renderClientsTable();
  } catch (e) {
    showError(e.message);
  }
}

async function openClientDetail(clientId) {
  setView("clients");
  state.detailClientId = clientId;
  $("#client-form-panel").classList.add("hidden");
  $("#client-detail-panel").classList.remove("hidden");
  const client = state.clients.find((c) => c.id === clientId);
  $("#client-detail-name").textContent = client?.name || "Cliente";
  await refreshClientDetail();
}

async function refreshClientDetail() {
  const id = state.detailClientId;
  if (!id) return;
  const [client, wallet, games] = await Promise.all([
    api("/clients/" + id),
    api("/clients/" + id + "/wallet"),
    api("/games"),
  ]);
  state.games = games;

  $("#client-wallet-cards").innerHTML = [
    { label: "Saldo B2B", value: money(wallet.balance), cls: wallet.balance < 0 ? "bad" : "ok" },
    { label: "Cobrança", value: wallet.client.billingMode === "POSTPAID" ? "Pós-pago" : "Pré-pago" },
    { label: "Crédito disponível", value: money(wallet.availableCredit) },
    { label: "Cobrança B2B", value: client.chargePct != null ? Number(client.chargePct) + "%" : "padrão global" },
  ].map((c) => `<div class="card"><div class="label">${c.label}</div><div class="value ${c.cls || ""}">${c.value}</div></div>`).join("");

  const enabledGames = games.filter((g) =>
    client.entitlements.some((e) => e.isEnabled && (e.gameId === g.id || (e.gameId == null && e.categoryId === g.categoryId))),
  );

  $("#client-game-rates-table").innerHTML = `<table>
    <thead><tr><th>Jogo</th><th>Repasse Salsa %</th><th>Cobrança total %</th><th>Sua margem</th><th>RTP cliente %</th></tr></thead>
    <tbody>${enabledGames.map((g) => {
      const ent = client.entitlements.find((e) => e.gameId === g.id) ||
        client.entitlements.find((e) => e.gameId == null && e.categoryId === g.categoryId);
      const repasse = ent?.feePct != null ? Number(ent.feePct) : Number(g.aggregatorFeePct);
      const chargeDefault = repasse + Number(client.marginPct);
      const charge = ent?.chargePct != null ? Number(ent.chargePct) : "";
      const margin = charge !== "" ? Math.max(0, Number(charge) - repasse) : Number(client.marginPct);
      return `<tr data-game-id="${g.id}" data-category-id="${g.categoryId}">
        <td>${g.name}</td>
        <td><input class="rate-input repasse-pct" type="number" step="0.1" value="${ent?.feePct ?? ""}" placeholder="${Number(g.aggregatorFeePct)}"></td>
        <td><input class="rate-input charge-pct" type="number" step="0.1" value="${charge}" placeholder="${chargeDefault}"></td>
        <td class="num margin-preview">${margin.toFixed(1)}%</td>
        <td><input class="rate-input rtp-pct" type="number" step="0.1" value="${ent?.rtpPct ?? ""}" placeholder="${g.rtp ?? 80}"></td>
      </tr>`;
    }).join("")}
    </tbody></table>`;

  $$("#client-game-rates-table .charge-pct, #client-game-rates-table .repasse-pct").forEach((input) => {
    input.addEventListener("input", () => {
      const tr = input.closest("tr");
      const repasse = Number(tr.querySelector(".repasse-pct").value || tr.querySelector(".repasse-pct").placeholder);
      const chargeVal = tr.querySelector(".charge-pct").value;
      const charge = chargeVal !== "" ? Number(chargeVal) : Number(tr.querySelector(".charge-pct").placeholder);
      tr.querySelector(".margin-preview").textContent = Math.max(0, charge - repasse).toFixed(1) + "%";
    });
  });

  $("#client-wallet-txs").innerHTML = wallet.transactions.length ? `<table>
    <thead><tr><th>Data</th><th>Tipo</th><th>Valor</th><th>Saldo depois</th><th>Descrição</th></tr></thead>
    <tbody>${wallet.transactions.map((t) => `
      <tr>
        <td>${new Date(t.createdAt).toLocaleString("pt-BR")}</td>
        <td>${t.type}</td>
        <td class="num ${t.amount >= 0 ? "ok" : "bad"}">${money(t.amount)}</td>
        <td class="num">${money(t.balanceAfter)}</td>
        <td>${t.description || "—"}</td>
      </tr>`).join("")}
    </tbody></table>` : "<p class='hint'>Nenhuma transação ainda.</p>";

  $("#btn-edit-client").onclick = () => {
    $("#client-detail-panel").classList.add("hidden");
    $("#client-form-panel").classList.remove("hidden");
    $("#client-form-title").textContent = "Editar: " + client.name;
    const form = $("#client-form");
    form.name.value = client.name;
    form.chargePct.value = client.chargePct ?? "";
    form.billingMode.value = client.billingMode || "PREPAID";
    form.maxCredit.value = client.maxCredit ?? "";
    form.initialBalance.value = 0;
    form.rtpPoolMode.value = client.rtpPoolMode;
    form.launchEnvironment.value = client.launchEnvironment || "TEST";
    form.walletUrl.value = client.walletUrl || "";
    form.walletSecret.value = "";
    form.dataset.editId = client.id;
    buildEntitlementsUI($("#entitlements-builder"), client.entitlements);
  };
}

async function loadPartnersView() {
  showError("");
  const select = $("#partner-client-select");
  const saveBtn = $("#btn-save-partner-access");
  try {
    await loadMeta();
    const current = select.value || state.selectedClientId || state.detailClientId || "";
    select.innerHTML = '<option value="">Escolha o cliente</option>' +
      state.clients.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
    select.value = current;
    if (!select.value) {
      $("#partner-summary").innerHTML = "";
      $("#partner-charge-box")?.classList.add("hidden");
      $("#partner-providers-table").innerHTML = "<p class='hint'>Escolha o sócio (cliente B2B) para liberar provedores.</p>";
      saveBtn.disabled = true;
      return;
    }
    await renderPartnerAccess(select.value);
  } catch (e) {
    showError(e.message);
  }
}

async function renderPartnerAccess(clientId) {
  const data = await api("/clients/" + clientId + "/partner-access");
  const enabled = data.providers.filter((p) => p.isEnabled).length;
  const live = data.providers.filter((p) => p.isEnabled && p.isActiveGlobal).length;
  $("#partner-summary").innerHTML = [
    { label: "Sócio", value: data.client.name },
    { label: "% Salsa (todos)", value: data.defaults.salsaPct + "%" },
    { label: "Cobrança padrão", value: data.defaults.operatorChargePct + "%" },
    { label: "Cobrança deste sócio", value: data.client.resolvedChargePct + "%", cls: data.client.chargePct != null ? "ok" : "" },
    { label: "Sua margem", value: data.client.yourMarginPct + "%" },
    { label: "Provedores liberados", value: enabled, cls: enabled ? "ok" : "warn" },
    { label: "Já no ar", value: live, cls: live ? "ok" : "warn" },
  ].map((c) => `<div class="card"><div class="label">${c.label}</div><div class="value ${c.cls || ""}">${c.value}</div></div>`).join("");

  const chargeBox = $("#partner-charge-box");
  chargeBox?.classList.remove("hidden");
  const chargeInput = $("#partner-charge-override");
  chargeInput.placeholder = String(data.defaults.operatorChargePct);
  chargeInput.value = data.client.chargePct ?? "";
  $("#partner-charge-hint").textContent =
    `Salsa ${data.defaults.salsaPct}% · vazio = cobra ${data.defaults.operatorChargePct}% como os outros · sua margem = cobrança − Salsa`;

  $("#partner-providers-table").innerHTML = `<table>
    <thead><tr>
      <th>Liberar</th><th>Provedor</th><th>Catálogo</th><th>Jogos</th>
    </tr></thead>
    <tbody>${data.providers.map((p) => `
      <tr data-provider-id="${p.providerId}">
        <td><input type="checkbox" class="partner-enabled" ${p.isEnabled ? "checked" : ""}></td>
        <td><strong>${p.name}</strong><br><small>${p.slug}</small></td>
        <td class="${p.isActiveGlobal ? "ok" : "bad"}">${p.isActiveGlobal ? "Ativo" : "Desligado"}</td>
        <td class="num">${p.activeGameCount}/${p.gameCount}</td>
      </tr>`).join("")}
    </tbody></table>`;

  $("#btn-save-partner-access").disabled = false;
}

function readPartnerAccessFromTable() {
  return [...$("#partner-providers-table").querySelectorAll("tbody tr")].map((tr) => ({
    providerId: Number(tr.dataset.providerId),
    isEnabled: tr.querySelector(".partner-enabled").checked,
  }));
}

async function loadRevenueView() {
  showError("");
  try {
    const rows = await api("/analytics/revenue-by-game" + qs());
    $("#revenue-table").innerHTML = rows.length ? `<table>
      <thead><tr>
        <th>Jogo</th><th>Spins</th><th>Apostado</th><th>Você ganha</th><th>Repasse</th><th>GGR</th>
      </tr></thead>
      <tbody>${rows.map((r) => `
        <tr>
          <td>${r.name}</td>
          <td class="num">${r.spins}</td>
          <td class="num">${money(r.betAmount)}</td>
          <td class="num ok">${money(r.aggregatorEarns)}<br><small>jogo ${money(r.gameFeeAmount)} + B2B ${money(r.clientFeeAmount)}</small></td>
          <td class="num warn">${money(r.playerPayout)}</td>
          <td class="num">${money(r.ggr)}</td>
        </tr>`).join("")}
      </tbody></table>` : "<p class='hint'>Sem dados no período.</p>";

    const top = rows.slice(0, 8);
    destroyChart("revenueEarn");
    state.charts.revenueEarn = new Chart($("#chart-revenue-earn"), {
      type: "doughnut",
      data: {
        labels: top.map((r) => r.name),
        datasets: [{ data: top.map((r) => r.aggregatorEarns), backgroundColor: ["#6366f1","#818cf8","#a5b4fc","#22c55e","#eab308","#f97316","#ef4444","#8b5cf6"] }],
      },
      options: { plugins: { legend: { labels: { color: "#eef1f7" } } } },
    });
    destroyChart("revenuePayout");
    state.charts.revenuePayout = new Chart($("#chart-revenue-payout"), {
      type: "bar",
      data: {
        labels: top.map((r) => r.name),
        datasets: [{ label: "Repasse", data: top.map((r) => r.playerPayout), backgroundColor: "#22c55e" }],
      },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: "#8b93a7" } }, y: { ticks: { color: "#8b93a7" } } } },
    });
  } catch (e) {
    showError(e.message);
  }
}

function renderSalsaGamesTable(games) {
  if (!games.length) {
    $("#salsa-games-table").innerHTML = "<p class='hint'>Nenhum jogo importado. Clique em Importar jogos.</p>";
    return;
  }
  $("#salsa-games-table").innerHTML = `<table>
    <thead><tr>
      <th>Jogo</th><th>Código Salsa</th><th>Provedor</th><th>Status</th><th></th>
    </tr></thead>
    <tbody>${games.map((g) => `
      <tr data-game-id="${g.id}">
        <td><strong>${g.name}</strong><br><small>${g.slug}</small></td>
        <td><code>${g.externalGameId || "—"}</code></td>
        <td>${g.provider?.name || "—"}</td>
        <td class="${g.isActive ? "ok" : "bad"}">${g.isActive ? "Ativo" : "Off"}</td>
        <td>
          <button class="ghost btn-toggle-salsa-game" data-id="${g.id}" data-active="${g.isActive}">${g.isActive ? "Desligar" : "Ligar"}</button>
        </td>
      </tr>`).join("")}
    </tbody></table>`;

  $$(".btn-toggle-salsa-game").forEach((btn) => btn.addEventListener("click", async () => {
    const id = btn.dataset.id;
    const next = btn.dataset.active !== "true";
    await api(`/games/${id}`, { method: "PATCH", body: JSON.stringify({ isActive: next }) });
    loadIntegrationsView();
  }));
}

async function loadIntegrationsView() {
  showError("");
  try {
    const [salsa, providers, salsaGames, salsaCfg] = await Promise.all([
      api("/integrations/salsa/status"),
      api("/providers"),
      api("/integrations/salsa/games"),
      api("/integrations/salsa/config").catch(() => null),
    ]);

    const liveReady = Boolean(salsa.live?.ready || salsaCfg?.live?.ready);
    $("#salsa-status").innerHTML = [
      { label: "Salsa ativa", value: (salsaCfg?.enabled ?? salsa.enabled) ? "Sim" : "Não", cls: (salsaCfg?.enabled ?? salsa.enabled) ? "ok" : "warn" },
      { label: "PN teste", value: salsa.test?.pn || salsa.pn || "—" },
      { label: "PN produção", value: salsa.live?.pn || "ainda vazio no env", cls: liveReady ? "ok" : "warn" },
      { label: "Jogos importados", value: salsa.gamesImported },
      { label: "Jogos ativos", value: salsa.gamesActive ?? "—", cls: salsa.gamesActive ? "ok" : "warn" },
      { label: "% Salsa", value: (salsaCfg?.defaultProviderCostPct ?? salsa.defaultCostPct) + "%" },
      { label: "% operador", value: (salsaCfg?.defaultOperatorChargePct ?? "—") + "%" },
    ].map((c) => `<div class="card"><div class="label">${c.label}</div><div class="value ${c.cls || ""}">${c.value}</div></div>`).join("");

    if (salsaCfg) {
      const form = $("#salsa-config-form");
      form.enabled.checked = salsaCfg.enabled;
      form.publisherName.value = salsaCfg.publisherName || "";
      form.gameListUrl.value = salsaCfg.gameListUrl || "";
      form.apiBase.value = salsaCfg.apiBase || "";
      const commissions = $("#commission-defaults-form");
      if (commissions) {
        commissions.defaultProviderCostPct.value = salsaCfg.defaultProviderCostPct ?? 6.5;
        commissions.defaultOperatorChargePct.value = salsaCfg.defaultOperatorChargePct ?? 20;
      }
    }

    $("#salsa-config-pre").textContent = `# Publisher (único, a Salsa chama isto):
${salsa.publisherUrl}

# TESTE (o formulário acima — deve continuar staging)
PN: ${salsa.test?.pn || salsa.pn || "—"}
API: ${salsa.test?.apiBase || "https://api-test.salsagator.com"}

# PRODUÇÃO (EasyPanel: SALSA_PN_LIVE — NÃO é este formulário)
PN live: ${salsa.live?.pn || "NÃO CONFIGURADO — por isso ainda parece teste"}
API live: https://api.salsagator.com

# Quem usa teste ou live: aba Clientes → Ambiente do cassino
# Publicar 5069 jogos não muda o PN. Só libera o catálogo.`;

    renderSalsaGamesTable(salsaGames.games || []);

    $("#providers-table").innerHTML = `<table>
      <thead><tr>
        <th>Provedor</th><th>Integração</th><th>Jogos</th><th>Ativos</th><th>Status</th><th>Ações</th>
      </tr></thead>
      <tbody>${providers.map((p) => `
        <tr>
          <td><strong>${p.name}</strong><br><small>${p.slug}</small></td>
          <td>${p.integration || "NATIVE"}</td>
          <td class="num">${p.gameCount ?? "—"}</td>
          <td class="num">${p.activeGameCount ?? "—"}</td>
          <td class="${p.isActive ? "ok" : "bad"}">${p.isActive ? "Ativo" : "Desativado"}</td>
          <td>
            <button class="ghost btn-toggle-provider" data-id="${p.id}" data-active="${p.isActive}">${p.isActive ? "Desativar" : "Ativar"}</button>
          </td>
        </tr>`).join("")}
      </tbody></table>`;

    $$(".btn-toggle-provider").forEach((btn) => btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const newActive = btn.dataset.active !== "true";
      const cascade = confirm(newActive
        ? "Ativar este provedor e todos os jogos dele no catálogo global? Os sócios ainda precisam da liberação na aba Sócios."
        : "Desativar este provedor e todos os jogos dele?");
      await api(`/providers/${id}?cascadeGames=${cascade ? "1" : "0"}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: newActive }),
      });
      loadIntegrationsView();
    }));
  } catch (e) {
    showError(e.message);
  }
}

async function loadHighlightsView() {
  showError("");
  try {
    await loadMeta();
    const games = [...state.games].sort((a, b) => {
      if (Boolean(b.isFeatured) !== Boolean(a.isFeatured)) return b.isFeatured ? 1 : -1;
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    });

    if (!games.length) {
      $("#highlights-table").innerHTML = "<p class='hint'>Nenhum jogo cadastrado.</p>";
      return;
    }

    $("#highlights-table").innerHTML = `<table>
      <thead><tr>
        <th>Top</th><th>Jogo</th><th>Provedor</th><th>Destaque</th><th>Ordem</th><th></th>
      </tr></thead>
      <tbody>${games.map((g, index) => `
        <tr data-game-id="${g.id}">
          <td class="num">${g.isFeatured && index < 10 ? index + 1 : "—"}</td>
          <td><strong>${g.name}</strong><br><small>${g.slug}</small></td>
          <td>${g.provider?.name || "—"}</td>
          <td><input type="checkbox" class="hl-featured" ${g.isFeatured ? "checked" : ""}></td>
          <td><input class="rate-input hl-order" type="number" step="1" value="${g.sortOrder ?? 0}"></td>
          <td><button class="ghost btn-save-highlight">Salvar</button></td>
        </tr>`).join("")}
      </tbody></table>`;

    $$(".btn-save-highlight").forEach((btn) => btn.addEventListener("click", async () => {
      const row = btn.closest("tr");
      const id = row.dataset.gameId;
      const isFeatured = row.querySelector(".hl-featured").checked;
      const sortOrder = Number(row.querySelector(".hl-order").value);
      await api(`/games/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isFeatured, sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0 }),
      });
      await loadMeta();
      loadHighlightsView();
    }));
  } catch (e) {
    showError(e.message);
  }
}

async function loadRtpView() {
  showError("");
  try {
    const dash = await api("/rtp/dashboard");
    $("#rtp-table").innerHTML = `<table>
      <thead><tr><th>Jogo</th><th>RTP alvo</th><th>RTP real</th><th>Apostado</th><th>Pago</th><th>Caixa</th></tr></thead>
      <tbody>${(dash.games || []).map((g) => `
        <tr>
          <td>${g.name || g.slug}</td>
          <td class="num">${g.targetRtpPct}%</td>
          <td class="num">${g.actualRtpPct}%</td>
          <td class="num">${money(g.totalWagered)}</td>
          <td class="num">${money(g.totalPaidOut)}</td>
          <td class="num">${money(g.housePool)}</td>
        </tr>`).join("")}
      </tbody></table>`;
  } catch (e) {
    showError(e.message);
  }
}

function initAuth() {
  $("#api-base-input").value = state.apiBase;
  if (state.adminKey) {
    $("#auth-screen").classList.add("hidden");
    $("#app").classList.remove("hidden");
    bootstrap();
  }

  $("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    state.adminKey = $("#admin-key-input").value.trim();
    state.apiBase = $("#api-base-input").value.trim() || "/admin/v1";
    $("#auth-error").textContent = "";
    try {
      await api("/clients");
      localStorage.setItem(LS_KEY, state.adminKey);
      localStorage.setItem(LS_BASE, state.apiBase);
      $("#auth-screen").classList.add("hidden");
      $("#app").classList.remove("hidden");
      bootstrap();
    } catch (err) {
      $("#auth-error").textContent = err.message;
    }
  });

  $("#logout-btn").addEventListener("click", () => {
    localStorage.removeItem(LS_KEY);
    location.reload();
  });
}

function initUi() {
  $$(".nav").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
  $("#period-select").addEventListener("change", () => {
    const active = $(".nav.active")?.dataset.view;
    if (active) setView(active);
  });
  $("#client-filter").addEventListener("change", (e) => {
    state.selectedClientId = e.target.value;
    const active = $(".nav.active")?.dataset.view;
    if (active) setView(active);
  });

  $("#btn-highlights-refresh")?.addEventListener("click", loadHighlightsView);

  $("#partner-client-select")?.addEventListener("change", async (e) => {
    const id = e.target.value;
    if (!id) {
      $("#partner-summary").innerHTML = "";
      $("#partner-charge-box")?.classList.add("hidden");
      $("#partner-providers-table").innerHTML = "<p class='hint'>Escolha o sócio (cliente B2B) para liberar provedores.</p>";
      $("#btn-save-partner-access").disabled = true;
      return;
    }
    try {
      await renderPartnerAccess(id);
    } catch (err) {
      showError(err.message);
    }
  });

  $("#btn-save-partner-access")?.addEventListener("click", async () => {
    const clientId = $("#partner-client-select")?.value;
    if (!clientId) return;
    showError("");
    try {
      await api("/clients/" + clientId + "/partner-access", {
        method: "PUT",
        body: JSON.stringify({
          chargePct: $("#partner-charge-override").value !== "" ? Number($("#partner-charge-override").value) : null,
          providers: readPartnerAccessFromTable(),
        }),
      });
      await renderPartnerAccess(clientId);
      alert("Acesso e cobrança do sócio salvos.");
    } catch (err) {
      showError(err.message);
    }
  });

  $("#btn-salsa-sync").addEventListener("click", async () => {
    showError("");
    const overlay = $("#salsa-sync-overlay");
    const msg = $("#salsa-sync-msg");
    const detail = $("#salsa-sync-detail");
    const btn = $("#btn-salsa-sync");
    overlay?.classList.remove("hidden");
    btn.disabled = true;
    if (msg) msg.textContent = "A iniciar importação…";
    if (detail) detail.textContent = "Isto pode levar alguns minutos. Não feche a página.";

    try {
      await api("/integrations/salsa/sync", { method: "POST", body: "{}" });

      const started = Date.now();
      while (Date.now() - started < 15 * 60 * 1000) {
        await new Promise((r) => setTimeout(r, 1500));
        const status = await api("/integrations/salsa/sync");
        if (msg) msg.textContent = status.phase || "A importar…";
        if (detail) {
          detail.textContent = status.found
            ? `Provedores com jogos: ${status.found} · varrido até ${status.scanned || "—"}`
            : "A pedir o catálogo à Salsa (TaDa = provider 331 primeiro)…";
        }
        if (status.running) continue;
        if (status.error) throw new Error(status.error);
        const result = status.result || {};
        alert(
          `Sync OK: ${result.created ?? 0} novos, ${result.updated ?? 0} atualizados` +
            `\nCapas URL: ${result.logosFromUrl ?? 0} · BASE64: ${result.logosFromBase64 ?? 0}` +
            (result.fromCache ? "\n(usou cache — se a TaDa faltar, espera 24h e importa de novo)" : ""),
        );
        break;
      }
      loadIntegrationsView();
    } catch (e) {
      showError(e.message);
    } finally {
      overlay?.classList.add("hidden");
      btn.disabled = false;
    }
  });

  $("#btn-salsa-deactivate")?.addEventListener("click", async () => {
    showError("");
    if (!confirm("Desligar todos os provedores e jogos Salsa e travar o acesso dos sócios? Clientes, saldos e histórico ficam intactos.")) return;
    try {
      const result = await api("/integrations/salsa/deactivate", { method: "POST", body: "{}" });
      alert(
        `Catálogo desligado: ${result.gamesDeactivated ?? 0} jogos, ${result.providersDeactivated ?? 0} provedores.\n` +
          `Sócios travados: ${result.partnersLocked ?? 0}. Agora ative um provedor e liberte na aba Sócios.`,
      );
      loadIntegrationsView();
    } catch (e) {
      showError(e.message);
    }
  });

  $("#btn-salsa-register")?.addEventListener("click", async () => {
    showError("");
    const games = parseSalsaPackText($("#salsa-register-pack")?.value || "");
    if (!games.length) {
      showError("Cole pelo menos um ID Salsa (ex.: znt-aviator).");
      return;
    }
    try {
      const result = await api("/integrations/salsa/register-games", {
        method: "POST",
        body: JSON.stringify({
          games,
          publish: Boolean($("#salsa-register-publish")?.checked),
        }),
      });
      const created = (result.created || []).join(", ") || "nenhum novo";
      const updated = (result.updated || []).join(", ") || "nenhum";
      alert(
        `Cadastrados: ${result.count}` +
          `\nNovos: ${created}` +
          `\nJá existiam: ${updated}` +
          (result.published
            ? `\nAtivados só estes IDs: ${result.published.gamesActivated}`
            : "\nSó cadastrados — ative o provedor em Integrações e liberte no Sócios."),
      );
      $("#salsa-register-pack").value = "";
      loadIntegrationsView();
    } catch (e) {
      showError(e.message);
    }
  });

  $("#commission-defaults-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("");
    const form = e.target;
    try {
      const salsaPct = Number(form.defaultProviderCostPct.value);
      const chargePct = Number(form.defaultOperatorChargePct.value);
      if (!Number.isFinite(salsaPct) || !Number.isFinite(chargePct)) {
        showError("Informe a % da Salsa e a % cobrada do operador.");
        return;
      }
      await api("/integrations/salsa/config", {
        method: "PUT",
        body: JSON.stringify({
          defaultProviderCostPct: salsaPct,
          defaultOperatorChargePct: chargePct,
        }),
      });
      alert(`Padrão salvo: Salsa ${salsaPct}% · operador ${chargePct}% (vale para todos).`);
      loadIntegrationsView();
    } catch (err) {
      showError(err.message);
    }
  });

  $("#salsa-config-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("");
    const form = e.target;
    try {
      await api("/integrations/salsa/config", {
        method: "PUT",
        body: JSON.stringify({
          enabled: form.enabled.checked,
          publisherName: form.publisherName.value || null,
          hashKey: form.hashKey.value || undefined,
          gameListUrl: form.gameListUrl.value || null,
          apiBase: form.apiBase.value || undefined,
        }),
      });
      form.hashKey.value = "";
      loadIntegrationsView();
    } catch (err) {
      showError(err.message);
    }
  });

  $("#btn-salsa-games-refresh")?.addEventListener("click", loadIntegrationsView);

  $("#salsa-games-search")?.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const search = e.target.value.trim();
    const data = await api("/integrations/salsa/games" + (search ? "?search=" + encodeURIComponent(search) : ""));
    renderSalsaGamesTable(data.games || []);
  });

  $("#btn-new-client").addEventListener("click", () => {
    state.detailClientId = null;
    $("#client-detail-panel").classList.add("hidden");
    $("#client-form-panel").classList.remove("hidden");
    $("#client-form-title").textContent = "Novo cliente";
    $("#new-api-key-box").classList.add("hidden");
    $("#client-form").reset();
    delete $("#client-form").dataset.editId;
    buildEntitlementsUI($("#entitlements-builder"));
  });

  $("#cancel-client-form").addEventListener("click", () => {
    $("#client-form-panel").classList.add("hidden");
  });

  $("#client-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("");
    const form = e.target;
    const editId = form.dataset.editId;
    const chargePct = form.chargePct.value !== "" ? Number(form.chargePct.value) : null;
    const body = {
      name: form.name.value,
      chargePct,
      marginPct: 0,
      billingMode: form.billingMode.value,
      maxCredit: form.maxCredit.value !== "" ? Number(form.maxCredit.value) : null,
      initialBalance: Number(form.initialBalance.value || 0),
      rtpPoolMode: form.rtpPoolMode.value,
      launchEnvironment: form.launchEnvironment.value || "TEST",
      walletUrl: form.walletUrl.value || null,
      walletSecret: form.walletSecret.value || null,
      entitlements: readEntitlementsFromForm($("#entitlements-builder")),
    };
    try {
      if (editId) {
        await api("/clients/" + editId, {
          method: "PATCH",
          body: JSON.stringify({
            name: body.name,
            chargePct: body.chargePct,
            billingMode: body.billingMode,
            maxCredit: body.maxCredit,
            rtpPoolMode: body.rtpPoolMode,
            walletUrl: body.walletUrl,
            launchEnvironment: body.launchEnvironment,
            ...(body.walletSecret ? { walletSecret: body.walletSecret } : {}),
          }),
        });
        await api("/clients/" + editId + "/entitlements", {
          method: "PUT",
          body: JSON.stringify({ entitlements: body.entitlements }),
        });
        await loadMeta();
        renderClientsTable();
        $("#client-form-panel").classList.add("hidden");
        openClientDetail(editId);
      } else {
        const created = await api("/clients", { method: "POST", body: JSON.stringify(body) });
        $("#new-api-key-box").classList.remove("hidden");
        $("#new-api-key-box").innerHTML = `<strong>API Key (guarde agora):</strong><br><code>${created.apiKey}</code>`;
        await loadMeta();
        renderClientsTable();
      }
    } catch (err) {
      showError(err.message);
    }
  });

  $("#wallet-fund-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.detailClientId) return;
    const fd = new FormData(e.target);
    try {
      await api("/clients/" + state.detailClientId + "/wallet/fund", {
        method: "POST",
        body: JSON.stringify({ amount: Number(fd.get("amount")), description: fd.get("description") || undefined }),
      });
      e.target.reset();
      await loadMeta();
      await refreshClientDetail();
    } catch (err) {
      showError(err.message);
    }
  });

  $("#btn-save-rates").addEventListener("click", async () => {
    if (!state.detailClientId) return;
    const items = [...$("#client-game-rates-table").querySelectorAll("tbody tr")].map((tr) => {
      const gameId = Number(tr.dataset.gameId);
      const repasse = tr.querySelector(".repasse-pct").value;
      const charge = tr.querySelector(".charge-pct").value;
      const rtp = tr.querySelector(".rtp-pct").value;
      return {
        gameId,
        providerCostPct: repasse !== "" ? Number(repasse) : null,
        chargePct: charge !== "" ? Number(charge) : null,
        rtpPct: rtp !== "" ? Number(rtp) : null,
      };
    });

    try {
      await api("/clients/" + state.detailClientId + "/game-fees", {
        method: "PUT",
        body: JSON.stringify({ items }),
      });
      await refreshClientDetail();
      showError("");
    } catch (err) {
      showError(err.message);
    }
  });
}

async function bootstrap() {
  initUi();
  try {
    await loadMeta();
    setView("dashboard");
  } catch (e) {
    showError(e.message);
  }
}

initAuth();
