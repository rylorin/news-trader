import IGClient from "ig-trading-api";
import type {
  AccountsResponse,
  DealConfirmation,
  MarketNavigation,
  MarketSearch,
  PositionListResponse,
  TradingSession,
} from "ig-trading-api";
import { gLogger } from "./logger";

const MAX_API_RETRIES = 3;

function apiRetryCondition(error: {
  response?: { status: number; data?: { errorCode?: string } };
}): boolean {
  if (!error.response) return true;
  const { status, data } = error.response;
  if (status === 429 || status >= 500) return true;
  const errorCode = data?.errorCode;
  if (
    errorCode === "error.public-api.exceeded-api-key-allowance" ||
    errorCode === "error.security.oauth-token-invalid" ||
    errorCode === "error.security.client-token-missing"
  ) {
    return true;
  }
  return false;
}

function apiRetryDelay(retryCount: number): number {
  return Math.min(1000 * 2 ** retryCount, 30_000);
}

export class APIClient {
  private readonly client: InstanceType<typeof IGClient>;
  private keepalive: NodeJS.Timeout | undefined;

  private identifier: string | undefined;
  private password: string | undefined;

  public rest = {
    login: {
      createSession: async (
        identifier: string,
        password: string,
      ): Promise<TradingSession> => this.createSession(identifier, password),
      logout: async (): Promise<void> => this.disconnect(),
    },
  };

  constructor(baseURL: string, apiKey: string) {
    gLogger.trace("APIClient.constructor", baseURL, apiKey);
    this.client = new IGClient(baseURL, apiKey);
    this.patchRetryConfig();
  }

  private patchRetryConfig(): void {
    const retries = MAX_API_RETRIES;
    // Use any to bypass typing issues with axios-retry custom property

    this.client.rest.httpClient.interceptors.request.use((config: any) => {
      config["axios-retry"] = {
        retries,
        retryCondition: apiRetryCondition,
        retryDelay: apiRetryDelay,
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return config;
    });
  }

  private heartbeat(): void {
    gLogger.trace("APIClient.heartbeat");
    this.client.rest.login
      .refreshToken()
      .then((token) => {
        gLogger.trace("APIClient.heartbeat", "token refreshed");
        this.keepalive = setTimeout(
          () => this.heartbeat(),
          parseInt(token.expires_in) * 500,
        );
      })
      .catch(async (error: Error) => {
        gLogger.error("APIClient.heartbeat", error.message);
        this.keepalive = undefined;
        if (this.identifier && this.password) {
          return this.createSession(this.identifier, this.password);
        }
      });
  }

  public async createSession(
    identifier: string,
    password: string,
  ): Promise<TradingSession> {
    gLogger.trace("APIClient.createSession", "connecting", identifier);
    this.identifier = identifier;
    this.password = password;
    return this.client.rest.login
      .createSession(identifier, password)
      .then((session) => {
        if (!this.keepalive) {
          this.keepalive = setTimeout(
            () => this.heartbeat(),
            parseInt(session.oauthToken.expires_in) * 500,
          );
        }
        return session;
      });
  }

  public async disconnect(): Promise<void> {
    if (this.keepalive) clearTimeout(this.keepalive);
    this.keepalive = undefined;
    this.identifier = undefined;
    this.password = undefined;
    return this.client.rest.login.logout().then(() => undefined);
  }

  public async getMarketNavigation(nodeId?: string): Promise<MarketNavigation> {
    gLogger.trace("APIClient.getMarketNavigation", nodeId);
    try {
      return await this.client.rest.market.getMarketCategories(nodeId);
    } catch (error: unknown) {
      const err = error as {
        response?: { data?: { errorCode?: string } };
        message?: string;
      };
      const errorCode = err.response?.data?.errorCode;
      gLogger.error(
        "APIClient.getMarketNavigation",
        errorCode || err.message || "unknown error",
      );
      throw error;
    }
  }

  public async searchMarkets(searchTerm: string): Promise<MarketSearch> {
    gLogger.trace("APIClient.searchMarkets", searchTerm);
    try {
      return await this.client.rest.market.searchMarkets(searchTerm);
    } catch (error: unknown) {
      const err = error as {
        response?: { data?: { errorCode?: string } };
        message?: string;
      };
      const errorCode = err.response?.data?.errorCode;
      gLogger.error(
        "APIClient.searchMarkets",
        errorCode || err.message || "unknown error",
      );
      throw error;
    }
  }

  public async getAccounts(): Promise<AccountsResponse> {
    gLogger.trace("APIClient.getAccounts");
    return this.client.rest.account.getAccounts();
  }

  public async createPosition(
    epic: string,
    currencyCode: string,
    size: number,
    level: number,
    expiry = "-",
  ): Promise<string> {
    gLogger.trace(
      "APIClient.createPosition",
      epic,
      currencyCode,
      size,
      level,
      expiry,
    );
    return this.client.rest.dealing
      .createPosition({
        epic,
        direction: "BUY" as any,
        size,
        level,
        currencyCode,
        expiry,
        forceOpen: false,
        guaranteedStop: false,
        timeInForce: "EXECUTE_AND_ELIMINATE" as any,
        orderType: "LIMIT" as any,
      })
      .then((response) => response.dealReference);
  }

  public async closePosition(
    dealId: string,
    size: number,
    level: number,
  ): Promise<string> {
    gLogger.trace("APIClient.closePosition", dealId, size, level);
    return this.client.rest.dealing
      .closePosition({
        dealId,
        expiry: "-",
        direction: "SELL" as any,
        size,
        level,
        orderType: "LIMIT" as any,
        timeInForce: "EXECUTE_AND_ELIMINATE" as any,
      })
      .then((response) => response.dealReference);
  }

  public async tradeConfirm(dealReference: string): Promise<DealConfirmation> {
    gLogger.trace("APIClient.tradeConfirm", dealReference);
    return this.client.rest.dealing.confirmTrade({ dealReference });
  }

  public async getPositions(): Promise<PositionListResponse> {
    gLogger.trace("APIClient.getPositions");
    return this.client.rest.dealing.getAllOpenPositions();
  }
}
