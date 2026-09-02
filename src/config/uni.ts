import { env } from "./env.js";
import { salsaPublisherUrl } from "./salsa.js";

export type UniEnvironment = "test" | "live";

export const UNI_BRAND = {
  name: "Uni",
  docsPath: "/docs/uni",
} as const;

export const UNI_SALSA = {
  test: {
    id: "test" as const,
    name: "Uni Test",
    apiBase: "https://api-test.salsagator.com",
    catalogBase: "https://back-test.patagoniaentertainment.com/game-integration.do",
    gpiExecute: "https://gpi-validation-test.patagoniaentertainment.com/gpi-validation/execute",
    launchType: "FREE" as const,
  },
  live: {
    id: "live" as const,
    name: "Uni Live",
    apiBase: "https://api.salsagator.com",
    catalogBase: "https://back.patagoniaentertainment.com/game-integration.do",
    gpiExecute: null as string | null,
    launchType: "CHARGED" as const,
  },
} as const;

export function uniPublicBase(): string {
  return env.PUBLIC_BASE_URL.replace(/\/$/, "");
}

export function uniPn(environment: UniEnvironment): string | undefined {
  if (environment === "live") {
    return env.SALSA_PN_LIVE;
  }
  return env.SALSA_PN;
}

export function uniGpiUrl(token: string, pn: string, type: "CHARGED" | "FREE" = "CHARGED"): string {
  const url = new URL(UNI_SALSA.test.gpiExecute);
  url.searchParams.set("token", token);
  url.searchParams.set("type", type);
  url.searchParams.set("lang", "pt");
  url.searchParams.set("pn", pn);
  url.searchParams.set("game", "gpi-validation");
  return url.toString();
}

export function uniEnvironmentDescriptor(environment: UniEnvironment) {
  const salsa = UNI_SALSA[environment];
  const base = uniPublicBase();
  const pn = uniPn(environment) ?? null;

  return {
    brand: UNI_BRAND.name,
    environment: salsa.id,
    name: salsa.name,
    aggregator: {
      baseUrl: base,
      docs: `${base}${UNI_BRAND.docsPath}`,
      api: `${base}/api/v1`,
      publisher: salsaPublisherUrl(),
      launch: `${base}/api/v1/uni/${environment}/games/{slug}/launch`,
    },
    salsa: {
      pn,
      apiBase: salsa.apiBase,
      gameLaunch: `${salsa.apiBase}/game`,
      catalog: pn ? `${salsa.catalogBase}?pn=${encodeURIComponent(pn)}` : salsa.catalogBase,
      launchType: salsa.launchType,
    },
    gpi:
      environment === "test" && pn
        ? {
            execute: UNI_SALSA.test.gpiExecute,
            game: "gpi-validation",
            example: uniGpiUrl("{sessionToken}", pn),
          }
        : null,
  };
}
