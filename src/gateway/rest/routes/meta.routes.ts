import { Router } from "express";

export interface RouteInfo {
  method: string;
  path: string;
  auth: "none" | "client" | "admin" | "session";
  description: string;
}

export const API_ROUTES: RouteInfo[] = [
  { method: "GET", path: "/docs/uni", auth: "none", description: "Documentação Uni (interno e cliente)" },
  { method: "GET", path: "/docs/uni/download/interno.md", auth: "none", description: "Baixar guia interno (Markdown)" },
  { method: "GET", path: "/docs/uni/download/cliente.md", auth: "none", description: "Baixar guia do cassino (Markdown)" },
  { method: "GET", path: "/api/v1/uni", auth: "none", description: "Ambientes Uni (test + live)" },
  { method: "GET", path: "/api/v1/uni/test", auth: "none", description: "Uni Test — launch Salsa staging" },
  { method: "GET", path: "/api/v1/uni/live", auth: "none", description: "Uni Live — launch Salsa produção" },
  { method: "POST", path: "/api/v1/uni/test/games/:slug/launch", auth: "client", description: "Abrir jogo no ambiente de teste" },
  { method: "POST", path: "/api/v1/uni/live/games/:slug/launch", auth: "client", description: "Abrir jogo no ambiente de produção" },
  { method: "GET", path: "/api/v1/routes", auth: "none", description: "Lista de rotas disponíveis" },
  { method: "POST", path: "/api/v1/auth/token", auth: "none", description: "Login com API Key → JWT" },
  { method: "POST", path: "/api/v1/auth/refresh", auth: "none", description: "Renovar access token" },
  { method: "POST", path: "/api/v1/auth/logout", auth: "none", description: "Revogar refresh token" },
  { method: "GET", path: "/api/v1/categories", auth: "client", description: "Categorias com jogos liberados para o cliente" },
  { method: "GET", path: "/api/v1/games", auth: "client", description: "Listar jogos liberados (?featured=1)" },
  { method: "GET", path: "/api/v1/games/:slug", auth: "client", description: "Detalhe de um jogo" },
  { method: "GET", path: "/api/v1/sync/games", auth: "client", description: "Bulk sync de jogos para persistir no back_uni_fut" },
  { method: "POST", path: "/api/v1/games/:slug/launch", auth: "client", description: "Abrir sessão de jogo para um usuário" },
  { method: "GET", path: "/api/v1/session/balance", auth: "session", description: "Saldo da sessão (header X-Session-Token)" },
  { method: "POST", path: "/api/v1/session/spin", auth: "session", description: "Executar spin (substitui PHP dos jogos Construct 3)" },
  { method: "GET", path: "/api/v1/catalog/providers", auth: "client", description: "Provedores de jogos" },
  { method: "GET", path: "/api/v1/catalog/categories", auth: "client", description: "Todas categorias ativas" },
  { method: "POST", path: "/admin/v1/clients", auth: "admin", description: "Criar cliente B2B (desenvolvedor/back_uni_fut)" },
  { method: "GET", path: "/admin/v1/clients", auth: "admin", description: "Listar clientes" },
  { method: "PUT", path: "/admin/v1/clients/:id/entitlements", auth: "admin", description: "Atualizar jogos liberados" },
  { method: "PATCH", path: "/admin/v1/clients/:id", auth: "admin", description: "Atualizar cliente (rtpPoolMode: GLOBAL | PER_CLIENT)" },
  { method: "POST", path: "/admin/v1/games", auth: "admin", description: "Registrar novo jogo no catálogo" },
  { method: "GET", path: "/admin/v1/games", auth: "admin", description: "Listar todos jogos" },
  { method: "PATCH", path: "/admin/v1/games/:id", auth: "admin", description: "Atualizar jogo" },
  { method: "GET", path: "/admin/v1/categories", auth: "admin", description: "Listar categorias" },
  { method: "POST", path: "/admin/v1/categories", auth: "admin", description: "Criar categoria" },
  { method: "GET", path: "/admin/v1/providers", auth: "admin", description: "Listar provedores" },
  { method: "GET", path: "/admin/v1/rtp/dashboard", auth: "admin", description: "Dashboard RTP/retenção por jogo (apostado, pago, retido)" },
  { method: "GET", path: "/admin/v1/fees/report", auth: "admin", description: "Relatório de taxas cobradas (GGR, gameFee, clientFee)" },
  { method: "GET", path: "/admin/v1/clients/:id/rtp", auth: "admin", description: "RTP por cliente (?gameId= opcional)" },
  { method: "GET", path: "/admin/v1/integrations/salsa/last-request", auth: "admin", description: "Último XML da Salsa (GPI: ver a requisição que falhou)" },
  { method: "POST", path: "/admin/v1/integrations/salsa/publish", auth: "admin", description: "Desativado — use Sócios + um provedor de cada vez" },
  { method: "POST", path: "/admin/v1/integrations/salsa/deactivate", auth: "admin", description: "Desativar catálogo Salsa e travar acesso dos sócios" },
  { method: "GET", path: "/admin/v1/clients/:id/partner-access", auth: "admin", description: "Acesso e comissão do sócio por provedor" },
  { method: "PUT", path: "/admin/v1/clients/:id/partner-access", auth: "admin", description: "Salvar acesso e comissão do sócio" },
];

const router = Router();

router.get("/routes", (_req, res) => {
  res.json({
    gamesStatic: "/games/{assetPath}/index.html",
    routes: API_ROUTES,
  });
});

export default router;
