import axios, { type AxiosInstance, type AxiosError } from "axios";

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface CasinoClientConfig {
  baseURL: string;
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  timeoutMs?: number;
  onTokenUpdate?: (tokens: { accessToken: string; refreshToken: string | null }) => void;
}

export interface AuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  client: { id: string; name: string };
}

export interface SyncGamesResponse {
  count: number;
  syncedAt: string;
  games: Array<{
    id: number;
    slug: string;
    name: string;
    categorySlug: string;
    launchUrl: string;
    thumbnailUrl: string | null;
    rtp: string | null;
    minBet: string | null;
    maxBet: string | null;
    isFeatured: boolean;
  }>;
}

export interface LaunchGameParams {
  externalUserId: string;
  balance: number;
  currency?: string;
}

export interface LaunchGameResponse {
  sessionId: string;
  sessionToken: string;
  gameSlug: string;
  launchUrl: string;
  expiresAt: string;
}

function createHttpClient(config: {
  baseURL: string;
  timeoutMs?: number;
  getAuthToken: () => string | null;
  onUnauthorized: () => Promise<string | null>;
}): AxiosInstance {
  const http = axios.create({
    baseURL: config.baseURL,
    timeout: config.timeoutMs ?? 30_000,
  });

  http.interceptors.request.use((req) => {
    const token = config.getAuthToken();
    if (token) {
      req.headers.Authorization = `Bearer ${token}`;
    }
    return req;
  });

  http.interceptors.response.use(
    (res) => res,
    async (error: AxiosError) => {
      if (error.response?.status === 401 && config.getAuthToken()) {
        const newToken = await config.onUnauthorized();
        if (newToken && error.config) {
          error.config.headers.Authorization = `Bearer ${newToken}`;
          return http.request(error.config);
        }
      }

      const status = error.response?.status ?? 0;
      const body = error.response?.data;
      throw new HttpError(
        (body as { error?: string })?.error ?? error.message,
        status,
        body,
      );
    },
  );

  return http;
}

export class CasinoClient {
  private accessToken: string | null;
  private refreshToken: string | null;
  private readonly apiKey: string | null;
  private readonly onTokenUpdate?: CasinoClientConfig["onTokenUpdate"];
  private readonly http: AxiosInstance;

  constructor(config: CasinoClientConfig) {
    this.apiKey = config.apiKey ?? null;
    this.accessToken = config.accessToken ?? null;
    this.refreshToken = config.refreshToken ?? null;
    this.onTokenUpdate = config.onTokenUpdate;

    this.http = createHttpClient({
      baseURL: config.baseURL.replace(/\/$/, ""),
      timeoutMs: config.timeoutMs,
      getAuthToken: () => this.accessToken,
      onUnauthorized: () => this.refreshAccessToken(),
    });

    if (this.apiKey) {
      this.http.defaults.headers.common["X-API-Key"] = this.apiKey;
    }
  }

  private setTokens(accessToken: string, refreshToken: string | null): void {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.onTokenUpdate?.({ accessToken, refreshToken });
  }

  async login(apiKey?: string): Promise<AuthTokenResponse> {
    const key = apiKey ?? this.apiKey;
    if (!key) throw new Error("API key required for login");

    const { data } = await this.http.post<AuthTokenResponse>("/api/v1/auth/token", { apiKey: key });
    this.setTokens(data.accessToken, data.refreshToken);
    return data;
  }

  async refreshAccessToken(): Promise<string | null> {
    if (!this.refreshToken) return null;

    try {
      const { data } = await this.http.post<{ accessToken: string }>("/api/v1/auth/refresh", {
        refreshToken: this.refreshToken,
      });
      this.accessToken = data.accessToken;
      this.onTokenUpdate?.({ accessToken: data.accessToken, refreshToken: this.refreshToken });
      return data.accessToken;
    } catch {
      return null;
    }
  }

  async health(): Promise<{ status: string; ts: number }> {
    const { data } = await this.http.get("/api/v1/health");
    return data;
  }

  async syncGames(): Promise<SyncGamesResponse> {
    const { data } = await this.http.get<SyncGamesResponse>("/api/v1/sync/games");
    return data;
  }

  async listGames(featuredOnly = false): Promise<unknown[]> {
    const { data } = await this.http.get("/api/v1/games", {
      params: featuredOnly ? { featured: 1 } : undefined,
    });
    return data;
  }

  async launchGame(slug: string, params: LaunchGameParams): Promise<LaunchGameResponse> {
    const { data } = await this.http.post<LaunchGameResponse>(`/api/v1/games/${slug}/launch`, params);
    return data;
  }
}

export function createCasinoClient(config: CasinoClientConfig): CasinoClient {
  return new CasinoClient(config);
}
