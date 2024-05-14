import {
  default as axios,
  AxiosError,
  AxiosInstance,
  AxiosResponse as Response,
} from "axios";
import https from "https";
import {
  AccountsResponse,
  DealConfirmation,
  DealReferenceResponse,
  Direction,
  MarketNavigation,
  MarketSearch,
  OauthToken,
  Position,
  PositionCloseRequest,
  PositionCreateRequest,
  PositionListResponse,
  PositionOrderType,
  PositionTimeInForce,
  Resolution,
  TradingSession,
} from "ig-trading-api";
import { gLogger, LogLevel } from "./logger";

enum IgApiEndpoint {
  CreateSession,
  GetSession,
  RefreshSession,
  Logout,
  GetMarketNavigation,
  GetMarket,
  GetMarkets,
  SearchMarkets,
  GetHitoryPrices,
  GetAccounts,
  CreatePosition,
  ClosePosition,
  TradeConfirm,
  GetPosition,
  GetPositions,
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
  [IgApiEndpoint.Logout]: {
    method: "delete",
    url: "/session",
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
  [IgApiEndpoint.GetHitoryPrices]: {
    method: "get",
    url: "/prices/{epic}/{resolution}/{startDate}/{endDate}/",
  },
  [IgApiEndpoint.GetAccounts]: {
    method: "get",
    url: "/accounts",
  },
  [IgApiEndpoint.CreatePosition]: {
    method: "post",
    url: "/positions/otc",
  },
  [IgApiEndpoint.ClosePosition]: {
    method: "delete",
    url: "/positions/otc",
  },
  [IgApiEndpoint.TradeConfirm]: {
    method: "get",
    url: "/confirms/{dealReference}",
  },
  [IgApiEndpoint.GetPosition]: {
    method: "get",
    url: "/positions/{dealId}",
  },
  [IgApiEndpoint.GetPositions]: {
    method: "get",
    url: "/positions",
  },
};

/**
 * Convert a Javascript Date to string format (UTC) YYYY-MM-DDTHH:MM:SS
 * @param {Date} datetime date to convert
 * @returns datetime converted as a string
 */
const dateToString = (datetime: Date): string => {
  const value = datetime.toISOString();
  const year = parseInt(value.substring(0, 4));
  const month = parseInt(value.substring(5, 7));
  const day = parseInt(value.substring(8, 10));
  const hours = parseInt(value.substring(11, 13));
  const mins = parseInt(value.substring(14, 16));
  const secs = parseInt(value.substring(17, 19));

  const date: string =
    year.toString() +
    "-" +
    (month < 10 ? "0" + month : month) +
    "-" +
    (day < 10 ? "0" + day : day);
  const time: string =
    (hours < 10 ? "0" + hours : hours) +
    ":" +
    (mins < 10 ? "0" + mins : mins) +
    ":" +
    (secs < 10 ? "0" + secs : secs);
  return date + "T" + time;
};

export class APIClient {
  // static URL_DEMO: string = "https://demo-api.ig.com/gateway/deal/";
  // static URL_LIVE: string = "https://api.ig.com/gateway/deal/";

  private readonly api: AxiosInstance;
  private readonly apiKey: string;
  private keepalive: NodeJS.Timeout | undefined;

  private identifier: string | undefined;
  private password: string | undefined;
  private oauthToken: OauthToken | undefined;
  private accountId: string | undefined;

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

  private async submit_request(
    api: IgApiEndpoint,
    params?: Record<string, any>,
    extraHeaders?: Record<string, string>,
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
        return this.api.delete(url, { data: params, headers });
      case "put":
        return this.api.put(url, params, { headers });
      default:
        throw Error("APIClient.call: method not implemented!");
    }
  }

  private async call<T extends Record<string, any>>(
    api: IgApiEndpoint,
    params?: Record<string, any>,
    headers?: Record<string, any>,
  ): Promise<T> {
    return this.submit_request(api, params, headers) // {status:number; statusText:string;error:Record<string,any>;data:T}
      .then((response) => response.data as T)
      .catch(async (error: AxiosError) => {
        if (
          error.response &&
          [400, 401].includes(error.response.status) &&
          error.response.data
        ) {
          gLogger.log(
            LogLevel.Trace,
            "APIClient.call:1",
            undefined,
            error.response,
          );
          const errorData = error.response.data as {
            errorCode: string;
          };
          if (
            [
              "error.security.oauth-token-invalid",
              "error.security.client-token-missing",
            ].includes(errorData.errorCode)
          ) {
            // Reconnect session
            this.oauthToken = undefined;
            return this.submit_request(
              IgApiEndpoint.CreateSession,
              {
                encryptedPassword: false,
                identifier: this.identifier,
                password: this.password,
              },
              { Version: "3" },
            )
              .then(async (response) => {
                this.oauthToken = response.data.oauthToken;
                // And retry
                return this.submit_request(api, params, headers);
              })
              .then((response) => response.data as T)
              .catch((error: AxiosError) => {
                const errorData = error.response?.data as {
                  errorCode: string;
                };
                gLogger.log(
                  LogLevel.Error,
                  "APIClient.call:3",
                  undefined,
                  errorData.errorCode,
                );
                throw Error(errorData.errorCode);
              });
          }
          gLogger.log(
            LogLevel.Error,
            "APIClient.call:1",
            undefined,
            errorData.errorCode,
          );
          throw Error(errorData.errorCode);
        } else {
          gLogger.log(LogLevel.Debug, "APIClient.call:2", undefined, error);
          gLogger.log(
            LogLevel.Error,
            "APIClient.call:2",
            undefined,
            error.message,
          );
          throw error;
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
    this.oauthToken = undefined;
    return this.call<TradingSession>(
      IgApiEndpoint.CreateSession,
      {
        encryptedPassword: false,
        identifier: this.identifier,
        password: this.password,
      },
      { Version: "3" },
    ).then((session) => {
      this.accountId = session.accountId;
      this.oauthToken = session.oauthToken;
      if (!this.keepalive) {
        this.keepalive = setTimeout(
          () => this.heartbeat(),
          parseInt(this.oauthToken!.expires_in) * 500, // renew token twice as frequently as needed
        );
      }
      return session;
    });
  }

  private heartbeat(): void {
    gLogger.trace("APIClient.heartbeat");
    this.call<OauthToken>(IgApiEndpoint.RefreshSession, {
      refresh_token: this.oauthToken!.refresh_token,
    })
      .then((response) => {
        gLogger.trace("APIClient.heartbeat", response);
        this.oauthToken = response;
        this.keepalive = setTimeout(
          () => this.heartbeat(),
          parseInt(this.oauthToken.expires_in) * 500, // renew token twice as frequently as needed
        );
      })
      .catch(async (error) => {
        console.error(error);
        gLogger.error("APIClient.heartbeat", error.message as string);
        // Trying to reconnect
        return this.createSession(this.identifier!, this.password!);
      });
  }

  public async disconnect(): Promise<void> {
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = undefined;
    this.identifier = undefined;
    this.password = undefined;
    return this.call(IgApiEndpoint.Logout).then(() => undefined);
  }

  public async getMarketNavigation(nodeId?: string): Promise<MarketNavigation> {
    gLogger.trace("APIClient.getMarketNavigation", nodeId);
    return this.call(IgApiEndpoint.GetMarketNavigation, {
      nodeId,
    }) as Promise<MarketNavigation>;
  }

  public async getMarket(epic?: string): Promise<MarketNavigation> {
    gLogger.trace("APIClient.getMarket", epic);
    return this.call(
      IgApiEndpoint.GetMarket,
      {
        epic,
      },
      { Version: "3" },
    ) as Promise<MarketNavigation>;
  }

  public async getMarkets(epics: string[]): Promise<MarketNavigation> {
    gLogger.trace("APIClient.getMarkets", epics);
    return this.call(
      IgApiEndpoint.GetMarkets,
      {
        epics: epics.join(","),
      },
      { Version: "2" },
    ) as Promise<MarketNavigation>;
  }

  public async searchMarkets(searchTerm: string): Promise<MarketSearch> {
    gLogger.trace("APIClient.searchMarkets", searchTerm);
    return this.call(IgApiEndpoint.SearchMarkets, {
      searchTerm,
    }) as Promise<MarketSearch>;
  }

  public async getHistoryPrices(
    epic: string,
    resolution: Resolution,
    startDate: Date,
    endDate: Date,
  ): Promise<MarketSearch> {
    gLogger.debug(
      "APIClient.getHistoryPrices",
      epic,
      resolution,
      startDate,
      endDate,
    );
    return this.call(
      IgApiEndpoint.GetHitoryPrices,
      {
        epic,
        resolution,
        startDate: dateToString(startDate),
        endDate: dateToString(endDate),
      },
      { Version: "2" },
    ) as Promise<MarketSearch>;
  }

  public async getAccounts(): Promise<AccountsResponse> {
    gLogger.trace("APIClient.getAccounts");
    return this.call(IgApiEndpoint.GetAccounts) as Promise<AccountsResponse>;
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
    const createPositionRequest: PositionCreateRequest = {
      epic,
      direction: Direction.BUY,
      size,
      level,
      currencyCode,
      expiry,
      forceOpen: false,
      guaranteedStop: false,
      timeInForce: PositionTimeInForce.EXECUTE_AND_ELIMINATE,
      orderType: PositionOrderType.LIMIT,
    };
    return (
      this.call(IgApiEndpoint.CreatePosition, createPositionRequest, {
        Version: "2",
      }) as Promise<DealReferenceResponse>
    ).then((response: DealReferenceResponse) => response.dealReference);
  }

  public async closePosition(
    dealId: string,
    size: number,
    level: number,
  ): Promise<string> {
    // Provide either dealId or epic + expiry
    const closePositionRequest: PositionCloseRequest = {
      dealId,
      expiry: "-",
      direction: Direction.SELL,
      size,
      level,
      orderType: PositionOrderType.LIMIT,
      timeInForce: PositionTimeInForce.EXECUTE_AND_ELIMINATE,
    };
    gLogger.trace("APIClient.closePosition", closePositionRequest);
    return this.call<DealReferenceResponse>(
      IgApiEndpoint.ClosePosition,
      closePositionRequest,
    ).then((response: DealReferenceResponse) => {
      gLogger.trace("APIClient.closePosition", dealId, response);
      return response.dealReference;
    });
  }

  public async tradeConfirm(dealReference: string): Promise<DealConfirmation> {
    gLogger.trace("APIClient.tradeConfirm", dealReference);
    return this.call(IgApiEndpoint.TradeConfirm, {
      dealReference,
    }) as Promise<DealConfirmation>;
  }

  public async getPosition(dealId?: string): Promise<Position> {
    gLogger.trace("APIClient.getPosition", dealId);
    return this.call(
      IgApiEndpoint.GetPosition,
      {
        dealId,
      },
      {
        Version: "2",
      },
    ) as Promise<Position>;
  }

  public async getPositions(): Promise<PositionListResponse> {
    gLogger.trace("APIClient.getPositions");
    return this.call(
      IgApiEndpoint.GetPositions,
      {},
      {
        Version: "2",
      },
    ) as Promise<PositionListResponse>;
  }
}
