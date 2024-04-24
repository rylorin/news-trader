import axios, { AxiosError, AxiosInstance } from "axios";
import https from "https";
import {
  AccountsResponse,
  DealConfirmation,
  DealReferenceResponse,
  Direction,
  MarketNavigation,
  MarketSearch,
  OauthToken,
  PositionCreateRequest,
  PositionOrderType,
  PositionTimeInForce,
  TradingSession,
} from "ig-trading-api";
import WebSocket from "ws";
import { LogLevel, gLogger } from "./logger";

enum IgApiEndpoint {
  CreateSession,
  GetSession,
  RefreshSession,
  GetMarketNavigation,
  GetMarket,
  GetMarkets,
  SearchMarkets,
  GetAccounts,
  CreatePosition,
  TradeConfirm,
}

interface IgApiEndpointDef {
  method: "get" | "post" | "delete" | "put";
  url: string;
}

const endpoints: Record<IgApiEndpoint, IgApiEndpointDef> = {
  [IgApiEndpoint.CreateSession]: {
    method: "post",
    url: "/session",
  },
  [IgApiEndpoint.GetSession]: {
    method: "get",
    url: "/session",
  },
  [IgApiEndpoint.RefreshSession]: {
    method: "post",
    url: "/session/refresh-token",
  },
  [IgApiEndpoint.GetMarketNavigation]: {
    method: "get",
    url: "/marketnavigation/{nodeId}",
  },
  [IgApiEndpoint.GetMarket]: {
    method: "get",
    url: "/markets/{epic}",
  },
  [IgApiEndpoint.GetMarkets]: {
    method: "get",
    url: "/markets",
  },
  [IgApiEndpoint.SearchMarkets]: {
    method: "get",
    url: "/markets",
  },
  [IgApiEndpoint.GetAccounts]: {
    method: "get",
    url: "/accounts",
  },
  [IgApiEndpoint.CreatePosition]: {
    method: "post",
    url: "/positions/otc",
  },
  [IgApiEndpoint.TradeConfirm]: {
    method: "get",
    url: "/confirms/{dealReference}",
  },
};

export class APIClient {
  static URL_DEMO: string = "https://demo-api.ig.com/gateway/deal/";
  static URL_LIVE: string = "https://api.ig.com/gateway/deal/";

  private readonly api: AxiosInstance;
  private readonly apiKey: string;
  private keepalive: NodeJS.Timeout | undefined;
  private ws: WebSocket | undefined;
  private keepaliveWs: NodeJS.Timer | undefined;

  private oauthToken: OauthToken | undefined;
  private accountId: string | undefined;

  public rest = {
    login: {
      createSession: (
        identifier: string,
        password: string,
      ): Promise<TradingSession> => this.createSession(identifier, password),
      logout: () => undefined,
    },
  };

  constructor(baseURL: string, apiKey: string) {
    gLogger.debug("APIClient.constructor", baseURL, apiKey);
    this.apiKey = apiKey;
    this.api = axios.create({
      baseURL,
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        Accept: "application/json; charset=UTF-8",
        "X-IG-API-KEY": this.apiKey,
      },
      httpsAgent: new https.Agent({
        rejectUnauthorized: false,
      }),
      maxRedirects: 0,
    });
  }

  private submit_request(
    api: IgApiEndpoint,
    params?: any,
    extraHeaders?: any,
  ): Promise<Response> {
    let url: string = endpoints[api].url;
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url = url.replace(
          "{" + key + "}",
          value !== undefined ? (value as string) : "",
        );
      }
    }
    const headers = extraHeaders || {};
    if (this.accountId) headers["IG-ACCOUNT-ID"] = this.accountId;
    if (
      this.oauthToken?.access_token &&
      (!extraHeaders || !("Authorization" in extraHeaders))
    ) {
      headers["Authorization"] =
        this.oauthToken.token_type + " " + this.oauthToken.access_token;
    }
    // console.log(headers, params);
    switch (endpoints[api].method) {
      case "post":
        return this.api.post(url, params, { headers });
      case "get":
        return this.api.get(url, { params, headers });
      case "delete":
        return this.api.delete(url, { headers });
      case "put":
        return this.api.put(url, params, { headers });
      default:
        throw Error("IgApiConnection.call: method not implemented!");
    }
  }

  private call(
    api: IgApiEndpoint,
    params?: any,
    headers?: any,
  ): Promise<Record<string, any>> {
    return this.submit_request(api, params, headers)
      .then((response) => {
        if (response.status == 200) {
          if ((response as any).error) {
            throw Error((response as any).error);
          } else {
            return (response as any).data;
          }
        } else {
          gLogger.log(
            LogLevel.Error,
            "IgApiConnection.call",
            undefined,
            response.statusText,
          );
          gLogger.log(
            LogLevel.Debug,
            "IgApiConnection.call",
            undefined,
            response,
          );
          throw Error(response.statusText);
        }
      })
      .catch((error: AxiosError) => {
        gLogger.log(
          LogLevel.Error,
          "IgApiConnection.call",
          undefined,
          error.message,
        );
        gLogger.log(LogLevel.Debug, "IgApiConnection.call", undefined, error);
        throw error;
      });
  }

  public createSession(
    identifier: string,
    password: string,
  ): Promise<TradingSession> {
    gLogger.info("IgApiConnection.createSession", "connecting");
    return this.call(
      IgApiEndpoint.CreateSession,
      {
        encryptedPassword: false,
        identifier,
        password,
      },
      { Version: "3" },
    ).then((session) => {
      this.accountId = session.accountId;
      this.oauthToken = session.oauthToken;
      this.keepalive = setTimeout(
        () => this.heartbeat(),
        parseInt(this.oauthToken!.expires_in) * 900,
      );
      return session as TradingSession;
    });
  }

  private heartbeat() {
    gLogger.trace("IgApiConnection.heartbeat");
    (
      this.call(IgApiEndpoint.RefreshSession, {
        refresh_token: this.oauthToken!.refresh_token,
      }) as Promise<OauthToken>
    )
      .then((response) => {
        gLogger.trace("IgApiConnection.heartbeat", response);
        this.oauthToken = response;
        this.keepalive = setTimeout(
          () => this.heartbeat(),
          parseInt(this.oauthToken.expires_in) * 900,
        );
      })
      .catch((error) => console.error(error));
  }

  public disconnect() {
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = undefined;
  }

  public getMarketNavigation(nodeId?: string): Promise<MarketNavigation> {
    gLogger.debug("IgApiConnection.getMarketNavigation", nodeId);
    return this.call(IgApiEndpoint.GetMarketNavigation, {
      nodeId,
    }) as Promise<MarketNavigation>;
  }

  public getMarket(epic?: string): Promise<MarketNavigation> {
    gLogger.debug("IgApiConnection.getMarket", epic);
    return this.call(
      IgApiEndpoint.GetMarket,
      {
        epic,
      },
      { Version: "3" },
    ) as Promise<MarketNavigation>;
  }

  public getMarkets(epics: string[]): Promise<MarketNavigation> {
    gLogger.debug("IgApiConnection.getMarkets", epics);
    return this.call(
      IgApiEndpoint.GetMarkets,
      {
        epics: epics.join(","),
      },
      { Version: "2" },
    ) as Promise<MarketNavigation>;
  }

  public searchMarkets(searchTerm: string): Promise<MarketSearch> {
    gLogger.debug("IgApiConnection.searchMarkets", searchTerm);
    return this.call(IgApiEndpoint.SearchMarkets, {
      searchTerm,
    }) as Promise<MarketSearch>;
  }

  public getAccounts(): Promise<AccountsResponse> {
    gLogger.debug("IgApiConnection.getAccounts");
    return this.call(IgApiEndpoint.GetAccounts) as Promise<AccountsResponse>;
  }

  public tradeConfirm(dealReference: string): Promise<DealConfirmation> {
    gLogger.debug("IgApiConnection.tradeConfirm");
    return this.call(IgApiEndpoint.TradeConfirm, {
      dealReference,
    }) as Promise<DealConfirmation>;
  }

  public createPosition(
    epic: string,
    currencyCode: string,
    size: number,
    level: number,
  ): Promise<DealConfirmation> {
    gLogger.debug("IgApiConnection.createPosition");
    const createPositionRequest: PositionCreateRequest = {
      epic,
      direction: Direction.BUY,
      size,
      level,
      currencyCode,
      expiry: "-",
      forceOpen: false,
      guaranteedStop: false,
      timeInForce: PositionTimeInForce.EXECUTE_AND_ELIMINATE,
      orderType: PositionOrderType.LIMIT,
    };
    return (
      this.call(IgApiEndpoint.CreatePosition, createPositionRequest, {
        Version: "2",
      }) as Promise<DealReferenceResponse>
    ).then((response: DealReferenceResponse) =>
      this.tradeConfirm(response.dealReference),
    );
  }
}
