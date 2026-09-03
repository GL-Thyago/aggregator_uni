import "dotenv/config";
import { syncSalsaGamesFromSource, getSalsaIntegrationStatus } from "../src/services/salsa/salsa-sync.service.js";

async function main() {
  const status = await getSalsaIntegrationStatus();
  console.log("Salsa status:", status);

  if (!status.gameListUrl) {
    console.error("\nConfigure SALSA_GAME_LIST_URL no .env antes de sincronizar.");
    process.exit(1);
  }

  const result = await syncSalsaGamesFromSource();
  console.log("\nSync concluído (catálogo atualizado, nada foi ligado):");
  console.log(`  Provedores: ${result.providerNames?.join(", ") || result.providers}`);
  console.log(`  IDs Salsa: ${(result.providerIds ?? []).join(", ")}`);
  console.log(`  Criados: ${result.created}  Atualizados: ${result.updated}`);
  console.log(`  Logos URL: ${result.logosFromUrl ?? 0}  Logos BASE64: ${result.logosFromBase64 ?? 0}`);
  if (result.fromCache) {
    console.log("  Aviso: catálogo veio do cache local — a Salsa bloqueia novo download por 24h.");
  }
  if (result.rateLimited) {
    console.log(`  Rate limit Salsa: ${result.rateLimited}`);
  }
  if (!(result.logosFromUrl || result.logosFromBase64)) {
    console.log("  Aviso: o JSON desta conta não trouxe gameLogo/gameLogoUrl — as capas só aparecem quando a Salsa enviar BASE64 ou URL.");
  }
  console.log("Ative um provedor no ADM e liberte no Sócios.");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
