const TOKEN_KEY = "provider_portal_token";
const API_BASE = "/provider/v1";

const state = {
  token: localStorage.getItem(TOKEN_KEY) || "",
  providers: [],
  providerId: "",
  storageConfigured: false,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showError(message = "") {
  $("#error").textContent = message;
  $("#error").classList.toggle("hidden", !message);
}

async function api(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const response = await fetch(API_BASE + path, {
    ...options,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!response.ok) {
    if (response.status === 401 && path !== "/auth/login") logout();
    throw new Error(data?.error || `HTTP ${response.status}`);
  }
  return data;
}

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  state.token = "";
  $("#portal").classList.add("hidden");
  $("#auth-screen").classList.remove("hidden");
}

function renderLogo(url) {
  $("#logo-preview").innerHTML = url
    ? `<img src="${escapeHtml(url)}" alt="Logo do provedor">`
    : "<span>Sem logo cadastrado</span>";
}

async function loadProviders() {
  state.providers = await api("/providers");
  const select = $("#provider-select");
  select.innerHTML = '<option value="">Escolha o provedor</option>' +
    state.providers.map((provider) =>
      `<option value="${provider.id}">${escapeHtml(provider.displayName || provider.name)}</option>`,
    ).join("");
  if (state.providers.some((provider) => String(provider.id) === state.providerId)) {
    select.value = state.providerId;
  }
}

async function loadProvider(providerId) {
  state.providerId = String(providerId);
  const data = await api(`/providers/${providerId}/games`);
  const form = $("#provider-form");
  form.classList.remove("hidden");
  form.defaultCostPct.value = data.provider.defaultCostPct ?? "";
  form.logoUrl.value = data.provider.logoUrl ?? "";
  form.logoFile.value = "";
  renderLogo(data.provider.logoUrl);

  $("#games-panel").classList.remove("hidden");
  $("#games-title").textContent = `Jogos de ${data.provider.displayName || data.provider.name}`;
  $("#games-table").innerHTML = data.games.length ? `<table class="provider-games-table">
    <thead><tr><th>Jogo</th><th>Capa</th><th>Imagem por URL</th><th>Enviar imagem</th><th>Link</th><th>Ações</th></tr></thead>
    <tbody>${data.games.map((game) => {
      const cover = game.thumbnailUrl ? `/api/v1/media/cover/${encodeURIComponent(game.slug)}` : "";
      const editableCover = /^https?:\/\//i.test(game.thumbnailUrl || "") ? game.thumbnailUrl : "";
      return `<tr data-game-id="${game.id}">
        <td><strong>${escapeHtml(game.name)}</strong><br><small>${escapeHtml(game.externalGameId || game.slug)}</small></td>
        <td>${cover ? `<img class="catalog-thumb" src="${escapeHtml(cover)}" alt="">` : "Sem capa"}</td>
        <td><input class="game-thumbnail-url catalog-url-input" type="url" maxlength="2048" value="${escapeHtml(editableCover)}" placeholder="https://..."></td>
        <td><input class="game-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" ${state.storageConfigured ? "" : "disabled"}></td>
        <td><input class="game-external-url catalog-url-input" type="url" maxlength="2048" value="${escapeHtml(game.externalUrl || "")}" placeholder="https://..."></td>
        <td>
          <button type="button" class="ghost save-game">Salvar</button>
          <button type="button" class="ghost danger clear-cover">Remover capa</button>
        </td>
      </tr>`;
    }).join("")}</tbody>
  </table>` : "<p class='hint'>Este provedor ainda não possui jogos.</p>";

  $$(".save-game").forEach((button) => button.addEventListener("click", () => saveGame(button.closest("tr"))));
  $$(".clear-cover").forEach((button) => button.addEventListener("click", () => clearCover(button.closest("tr"))));
}

async function saveGame(row) {
  showError();
  const id = row.dataset.gameId;
  const thumbnailUrl = row.querySelector(".game-thumbnail-url").value.trim();
  const externalUrl = row.querySelector(".game-external-url").value.trim();
  const file = row.querySelector(".game-file").files[0];
  try {
    await api(`/games/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        externalUrl: externalUrl || null,
        ...(thumbnailUrl ? { thumbnailUrl } : {}),
      }),
    });
    if (file) {
      const body = new FormData();
      body.append("image", file);
      await api(`/games/${id}/thumbnail`, { method: "POST", body });
    }
    await loadProvider(state.providerId);
  } catch (error) {
    showError(error.message);
  }
}

async function clearCover(row) {
  if (!confirm("Remover a capa deste jogo?")) return;
  try {
    await api(`/games/${row.dataset.gameId}`, {
      method: "PATCH",
      body: JSON.stringify({ thumbnailUrl: null }),
    });
    await loadProvider(state.providerId);
  } catch (error) {
    showError(error.message);
  }
}

async function enterPortal() {
  const session = await api("/session");
  state.storageConfigured = Boolean(session.storageConfigured);
  $("#storage-warning").classList.toggle("hidden", state.storageConfigured);
  $("#auth-screen").classList.add("hidden");
  $("#portal").classList.remove("hidden");
  await loadProviders();
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#login-error").textContent = "";
  try {
    const result = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: event.target.password.value }),
    });
    state.token = result.token;
    localStorage.setItem(TOKEN_KEY, state.token);
    event.target.reset();
    await enterPortal();
  } catch (error) {
    $("#login-error").textContent = error.message;
  }
});

$("#provider-select").addEventListener("change", async (event) => {
  if (!event.target.value) {
    state.providerId = "";
    $("#provider-form").classList.add("hidden");
    $("#games-panel").classList.add("hidden");
    return;
  }
  try {
    await loadProvider(event.target.value);
  } catch (error) {
    showError(error.message);
  }
});

$("#provider-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.providerId) return;
  showError();
  const form = event.target;
  const logoFile = form.logoFile.files[0];
  try {
    await api(`/providers/${state.providerId}`, {
      method: "PATCH",
      body: JSON.stringify({
        defaultCostPct: Number(form.defaultCostPct.value),
        ...(!logoFile ? { logoUrl: form.logoUrl.value.trim() || null } : {}),
      }),
    });
    if (logoFile) {
      const body = new FormData();
      body.append("image", logoFile);
      await api(`/providers/${state.providerId}/logo`, { method: "POST", body });
    }
    await loadProviders();
    await loadProvider(state.providerId);
  } catch (error) {
    showError(error.message);
  }
});

$("#apply-cost").addEventListener("click", async () => {
  const costPct = Number($("#provider-form").defaultCostPct.value);
  if (!Number.isFinite(costPct) || !state.providerId) return;
  if (!confirm(`Aplicar ${costPct}% a todos os jogos deste provedor?`)) return;
  try {
    await api(`/providers/${state.providerId}`, {
      method: "PATCH",
      body: JSON.stringify({ defaultCostPct: costPct }),
    });
    const result = await api(`/providers/${state.providerId}/apply-cost`, {
      method: "POST",
      body: JSON.stringify({ costPct }),
    });
    alert(`Comissão aplicada em ${result.gamesUpdated} jogos.`);
  } catch (error) {
    showError(error.message);
  }
});

$("#refresh-games").addEventListener("click", () => state.providerId && loadProvider(state.providerId));
$("#logout").addEventListener("click", logout);

if (state.token) {
  enterPortal().catch(() => logout());
}
