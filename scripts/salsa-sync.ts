import "dotenv/config";
import { syncSalsaGamesFromSource, getSalsaIntegrationStatus } from "../src/services/salsa/salsa-sync.service.js";

function argValue(flag: string): string | undefined {
  const prefix = `${flag}=`;
  const match = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

async function main() {
  const status = await getSalsaIntegrationStatus();
  console.log("Salsa status:", status);

  if (!status.gameListUrl) {
    console.error("\nConfigure SALSA_GAME_LIST_URL no .env antes de sincronizar.");
    process.exit(1);
  }

  const provider = argValue("--provider") ?? argValue("--providers");
  const scanAll = process.argv.includes("--all");
  const resetCatalog = process.argv.includes("--reset");

  if (!provider && !scanAll) {
    console.error("\nPasse o código que a Salsa liberou. Ex.:");
    console.error("  npm run salsa:sync -- --provider=46");
    console.error("  npm run salsa:sync -- --reset --provider=46");
    console.error("  npm run salsa:sync -- --all   (varre tudo — só em emergência)");
    process.exit(1);
  }

  const result = await syncSalsaGamesFromSource({
    salsaProviderIds: provider ? provider.split(/[,\s]+/).map(Number) : [],
    scanAll,
    resetCatalog,
  });
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
