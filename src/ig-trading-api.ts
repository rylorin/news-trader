// import { TimeInForce } from '@stoqey/ib';
import axios, { AxiosError, AxiosInstance } from "axios";
import https from "https";
import {
  AccountsResponse,
  MarketNavigation,
  OauthToken,
  TradingSession,
} from "ig-trading-api";
import WebSocket from "ws";
import { LogLevel, gLogger } from "./logger";

// export interface OauthToken {
//   access_token: string;
//   expires_in: string;
//   refresh_token: string;
//   scope: string;
//   token_type: string;
// }

enum IbCwpEndpointTypes {
  CreateSession,
  GetMarketNavigation,
  GetMarket,
  GetMarkets,
  GetAccounts,
}

interface IbCwpEndpoint {
  method: "get" | "post" | "delete" | "put";
  url: string;
}

const endpoints: Record<IbCwpEndpointTypes, IbCwpEndpoint> = {
  [IbCwpEndpointTypes.CreateSession]: {
    method: "post",
    url: "/session",
  },
  [IbCwpEndpointTypes.GetMarketNavigation]: {
    method: "get",
    url: "/marketnavigation/{nodeId}",
  },
  [IbCwpEndpointTypes.GetMarket]: {
    method: "get",
    url: "/markets/{epic}",
  },
  [IbCwpEndpointTypes.GetMarkets]: {
    method: "get",
    url: "/markets",
  },
  [IbCwpEndpointTypes.GetAccounts]: {
    method: "get",
    url: "/accounts",
  },
};

export class APIClient {
  static URL_DEMO: string = "https://demo-api.ig.com/gateway/deal/";
  static URL_LIVE: string = "https://api.ig.com/gateway/deal/";

  private readonly api: AxiosInstance;
  private readonly apiKey: string;
  private keepalive: NodeJS.Timer | undefined;
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

  // private ws_connect(session: string): Promise<void> {
  //   return new Promise((resolve, reject) => {
  //     let resolved = false;
  //     const url = (this.params as IgApiAccount).url.replace('https:', 'wss:') + '/v1/api/ws';
  //     this.ws = new WebSocket(url, { rejectUnauthorized: false })
  //       .once('open', () => {
  //         gLogger.log(LogLevel.Info, 'IgApiConnection.websocket', undefined, 'IgApiConnection stream Connected');
  //         this.ws!.send(JSON.stringify({ session }));
  //         this.ws!.send('tic'); // Ping session
  //         this.ws!.send('spl+{}'); // Profit & Loss Updates
  //         this.ws!.send('str+{}'); // Trades
  //         this.keepaliveWs = setInterval(() => this.ws?.send('tic'), 60 * 1000);
  //       })
  //       .on('message', (data: Buffer) => {
  //         if (!resolved) {
  //           resolved = true;
  //           gLogger.log(LogLevel.Info, 'IgApiConnection.websocket', undefined, 'Connection is Up');
  //           resolve();
  //         }
  //         this.process_ws_message(JSON.parse(data.toString()));
  //       })
  //       .once('close', (data: any) => {
  //         gLogger.log(LogLevel.Error, 'IgApiConnection.websocket', undefined, 'close', data);
  //         this.ws = undefined;
  //         if (!resolved) {
  //           resolved = true;
  //           reject();
  //         }
  //       })
  //       .on('error', (data: any) => {
  //         gLogger.log(LogLevel.Error, 'IgApiConnection.websocket', undefined, 'error', data);
  //         if (!resolved) {
  //           resolved = true;
  //           reject();
  //         }
  //       });
  //   });
  // }

  // public disconnect() {
  //   if (this.keepaliveWs) clearInterval(this.keepaliveWs);
  //   this.keepaliveWs = undefined;
  //   this.ws?.close();
  //   delete this.ws;
  //   this.ws = undefined;
  //   if (this.keepalive) clearInterval(this.keepalive);
  //   this.keepalive = undefined;
  // }

  private submit_request(
    api: IbCwpEndpointTypes,
    params?: any,
    extraHeaders?: any,
  ): Promise<Response> {
    let url: string = endpoints[api].url.replace(
      "{accountId}",
      "this.params.accountName",
    );
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
    if (this.oauthToken?.access_token)
      headers["Authorization"] =
        this.oauthToken.token_type + " " + this.oauthToken.access_token;
    // console.log(headers);
    switch (endpoints[api].method) {
      case "post":
        return this.api.post(url, params, { headers });
      case "get":
        return this.api.get(url, { headers });
      case "delete":
        return this.api.delete(url, { headers });
      case "put":
        return this.api.put(url, params, { headers });
      default:
        throw Error("IgApiConnection.call: method not implemented!");
    }
  }

  private call(
    api: IbCwpEndpointTypes,
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
    gLogger.info("IgApiConnection.connect", "connecting");
    return this.call(
      IbCwpEndpointTypes.CreateSession,
      {
        encryptedPassword: false,
        identifier,
        password,
      },
      { Version: "3" },
    ).then((session) => {
      this.oauthToken = session.oauthToken;
      this.accountId = session.accountId;
      return session as TradingSession;
    });
  }

  public getMarketNavigation(nodeId?: string): Promise<MarketNavigation> {
    gLogger.debug("IgApiConnection.connect", "getMarketNavigation");
    return this.call(IbCwpEndpointTypes.GetMarketNavigation, {
      nodeId,
    }) as Promise<MarketNavigation>;
  }

  public getMarket(epic?: string): Promise<MarketNavigation> {
    gLogger.debug("IgApiConnection.connect", "getMarketNavigation");
    return this.call(
      IbCwpEndpointTypes.GetMarket,
      {
        epic,
      },
      { Version: "3" },
    ) as Promise<MarketNavigation>;
  }

  public getMarkets(epics: string[]): Promise<MarketNavigation> {
    gLogger.debug("IgApiConnection.connect", "getMarketNavigation");
    return this.call(
      IbCwpEndpointTypes.GetMarkets,
      {
        epics: epics.join(","),
      },
      { Version: "2" },
    ) as Promise<MarketNavigation>;
  }

  public getAccounts(): Promise<AccountsResponse> {
    gLogger.debug("IgApiConnection.connect", "getAccounts");
    return this.call(
      IbCwpEndpointTypes.GetAccounts,
    ) as Promise<AccountsResponse>;
  }
}
