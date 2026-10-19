const LS_KEY = "media_studio_admin_key";

function lsGet(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function lsSet(k, v) {
  try { localStorage.setItem(k, v); } catch { /* ignore */ }
}
function lsDel(k) {
  try { localStorage.removeItem(k); } catch { /* ignore */ }
}

const state = {
  adminKey: lsGet(LS_KEY) || "",
  games: [],
  providers: [],
};

const $ = (s) => document.querySelector(s);

function escapeHtml(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function showErr(msg = "") {
  const el = $("#global-error");
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("hidden", !msg);
}

async function api(path, opts = {}) {
  const res = await fetch("/admin/v1" + path, {
    cache: "no-store",
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Key": state.adminKey,
      Authorization: "Bearer " + state.adminKey,
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
  return data;
}

function coverPreview(game, overrideUrl) {
  const raw = (overrideUrl ?? game.thumbnailUrl ?? "").trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^data:image/i.test(raw)) {
    return `/api/v1/media/cover/${encodeURIComponent(game.slug)}`;
  }
  return "";
}

function renderGrid() {
  const grid = $("#grid");
  if (!state.games.length) {
    grid.innerHTML = "<p class='hint'>Nenhum jogo encontrado.</p>";
    return;
  }
  grid.innerHTML = state.games.map((g) => {
    const prov = g.provider?.displayName || g.provider?.name || "";
    const preview = coverPreview(g);
    const editable = /^https?:\/\//i.test(g.thumbnailUrl || "") ? g.thumbnailUrl : "";
    return `<article class="game-card" data-id="${g.id}">
      <div class="preview-wrap" data-preview>
        ${preview
          ? `<img src="${escapeHtml(preview)}" alt="" loading="lazy">`
          : `<span class="placeholder">Sem capa — preview ao colar URL ou enviar arquivo</span>`}
      </div>
      <h3>${escapeHtml(g.name)}</h3>
      <p class="meta">${escapeHtml(prov)} · ${escapeHtml(g.slug)}</p>
      <label>URL da imagem (link direto S3/CDN)
        <input class="thumb-url" type="url" value="${escapeHtml(editable)}" placeholder="https://bucket.../aggregator/games/...">
      </label>
      <label>Enviar arquivo
        <input class="thumb-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif">
      </label>
      <div class="card-actions">
        <button type="button" class="save-url">Salvar link</button>
        <button type="button" class="ghost clear-url">Limpar</button>
      </div>
    </article>`;
  }).join("");

  grid.querySelectorAll(".game-card").forEach((card) => bindCard(card));
}

function bindCard(card) {
  const id = Number(card.dataset.id);
  const game = state.games.find((g) => g.id === id);
  if (!game) return;

  const urlInput = card.querySelector(".thumb-url");
  const fileInput = card.querySelector(".thumb-file");
  const previewEl = card.querySelector("[data-preview]");

  const refreshPreview = (url) => {
    const src = coverPreview(game, url);
    previewEl.innerHTML = src
      ? `<img src="${escapeHtml(src)}" alt="">`
      : `<span class="placeholder">Sem capa</span>`;
  };

  urlInput.addEventListener("input", () => refreshPreview(urlInput.value.trim()));

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    showErr("");
    card.classList.add("saving");
    try {
      const body = new FormData();
      body.append("image", file);
      const res = await fetch(`/admin/v1/games/${id}/thumbnail`, {
        method: "POST",
        headers: {
          "X-Admin-Key": state.adminKey,
          Authorization: "Bearer " + state.adminKey,
        },
        body,
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      game.thumbnailUrl = data.thumbnailUrl;
      urlInput.value = data.thumbnailUrl || "";
      refreshPreview(data.thumbnailUrl);
      fileInput.value = "";
    } catch (e) {
      showErr(e.message);
    } finally {
      card.classList.remove("saving");
    }
  });

  card.querySelector(".save-url").addEventListener("click", async () => {
    showErr("");
    card.classList.add("saving");
    const url = urlInput.value.trim();
    try {
      const updated = await api(`/games/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ thumbnailUrl: url || null }),
      });
      game.thumbnailUrl = updated.thumbnailUrl;
      refreshPreview(updated.thumbnailUrl);
    } catch (e) {
      showErr(e.message);
    } finally {
      card.classList.remove("saving");
    }
  });

  card.querySelector(".clear-url").addEventListener("click", async () => {
    urlInput.value = "";
    refreshPreview("");
    card.querySelector(".save-url").click();
  });
}

async function loadStorageHint() {
  const info = await api("/media/storage");
  const el = $("#storage-hint");
  if (!info.configured) {
    el.textContent = "S3 não configurado — use só URL manual. Defina AWS_BUCKET + credenciais no EasyPanel.";
    return;
  }
  el.textContent = `Upload → s3://${info.bucket}/${info.mediaPrefix}/games/{id}/… · Clientes recebem o link HTTPS direto na API.`;
}

async function loadProviders() {
  state.providers = await api("/providers");
  const sel = $("#provider-filter");
  sel.innerHTML = '<option value="">Todos</option>' +
    state.providers.map((p) =>
      `<option value="${p.id}">${escapeHtml(p.displayName || p.name)}</option>`,
    ).join("");
}

async function loadGames() {
  const search = $("#search").value.trim();
  const providerId = $("#provider-filter").value;
  const qs = new URLSearchParams();
  if (search) qs.set("search", search);
  if (providerId) qs.set("providerId", providerId);
  const suffix = qs.toString() ? "?" + qs.toString() : "";
  state.games = await api("/games" + suffix);
  renderGrid();
}

async function enterApp() {
  $("#auth-screen").classList.add("hidden");
  $("#app").classList.remove("hidden");
  await loadStorageHint();
  await loadProviders();
  await loadGames();
}

$("#auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#auth-error").textContent = "";
  state.adminKey = $("#admin-key").value.trim();
  try {
    await api("/session");
    lsSet(LS_KEY, state.adminKey);
    await enterApp();
  } catch (err) {
    $("#auth-error").textContent = err.message;
  }
});

$("#logout").addEventListener("click", () => {
  lsDel(LS_KEY);
  location.reload();
});

$("#btn-reload").addEventListener("click", () => loadGames().catch((e) => showErr(e.message)));
$("#search").addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadGames().catch((err) => showErr(err.message));
});
$("#provider-filter").addEventListener("change", () => loadGames().catch((e) => showErr(e.message)));

if (state.adminKey) {
  api("/session").then(() => enterApp()).catch(() => lsDel(LS_KEY));
}
