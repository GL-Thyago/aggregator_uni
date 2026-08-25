export interface JwtPayload {
  sub: string;
  clientId: string;
  clientName: string;
  type: "access";
}

export interface GameLaunchPayload {
  sessionId: string;
  sessionToken: string;
  gameSlug: string;
  launchUrl: string;
  expiresAt: string;
  balance: number;
  warning?: string;
  fees: {
    gameFeePct: number;
    clientFeePct: number;
    totalChargePct?: number;
    providerCostPct?: number;
  };
}

export interface SyncGamesResponse {
  count: number;
  games: Array<{
    id: number;
    slug: string;
    name: string;
    categoryId: number;
    categorySlug: string;
    categoryName: string;
    providerId: number;
    providerSlug: string;
    providerName: string;
    gameType: string;
    engine: string;
    launchUrl: string;
    thumbnailUrl: string | null;
    rtp: string | null;
    minBet: string | null;
    maxBet: string | null;
    aggregatorFeePct: string | null;
    isFeatured: boolean;
  }>;
  syncedAt: string;
}
