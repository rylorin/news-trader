// Load env vars
import dotenv from "dotenv";
dotenv.config();

// Load config
import { IConfig } from "config";

// The following can relying on env var and config
import { DealConfirmation, DealStatus, Market, Position } from "ig-trading-api";
import { APIClient } from "./ig-trading-api";
import { gLogger } from "./logger";
import { formatObject, string2boolean } from "./utils";

const StatusType = {
  Idle: undefined,
  Dealing: "Dealing",
  Position: "Position",
} as const;
export type StatusType = (typeof StatusType)[keyof typeof StatusType];

const LegType = {
  Put: "Put",
  Call: "Call",
} as const;
export type LegType = (typeof LegType)[keyof typeof LegType];

const legtypes: LegType[] = [LegType.Put, LegType.Call];

type LegDealStatus = {
  contract: Market;
  dealReference: string | undefined;
  dealConfirmation: DealConfirmation | undefined;
  position: Position | undefined;
};

type DealingStatus = {
  status: StatusType;
  [LegType.Put]: LegDealStatus | undefined;
  [LegType.Call]: LegDealStatus | undefined;
  winningLeg: LegType | undefined;
};

/**
 * Trading bot implementation
 */
export class Trader {
  private readonly config: IConfig;
  private readonly api;
  private readonly delay: number;
  private _pause: boolean;
  private _market: string;
  private _underlying: string;
  private _currency: string;
  private _delta: number;
  private _budget: number;
  private _globalStatus: DealingStatus;
  private _nextEvent: number | undefined;

  constructor(config: IConfig) {
    this.config = config;

    this._globalStatus = {
      status: StatusType.Idle,
      [LegType.Put]: undefined,
      [LegType.Call]: undefined,
      winningLeg: undefined,
    };
    this._pause = string2boolean(this.config.get("trader.pause"));
    this._market = this.config.get("trader.market");
    this._underlying = this.config.get("trader.underlying");
    this._currency = this.config.get("trader.currency");
    this.delay = this.config.get("trader.delay");
    this._delta = this.config.get("trader.delta");
    this._budget = this.config.get("trader.budget");

    this.api = new APIClient(
      config.get("ig-api.url"),
      this.config.get(`ig-api.api-key`),
    );
  }

  public toString(): string {
    return `Pause: ${this._pause}
Market: ${this._market}
Underlying: ${this._underlying}
Currency: ${this._currency}
Next event: ${this.nextEvent ? new Date(this.nextEvent).toISOString() : "undefined"}
Delta: ${this.delta}
Budget: ${this.budget}`;
  }

  public get pause(): boolean {
    return this._pause;
  }
  public set pause(value: boolean) {
    this._pause = value;
  }

  public get market(): string {
    return this._market;
  }
  public set market(value: string) {
    this._market = value;
  }

  public get underlying(): string {
    return this._underlying;
  }
  public set underlying(value: string) {
    this._underlying = value;
  }

  public get currency(): string {
    return this._currency;
  }
  public set currency(value: string) {
    this._currency = value;
  }

  public get delta(): number {
    return this._delta;
  }
  public set delta(value: number) {
    this._delta = value;
  }

  public get budget(): number {
    return this._budget;
  }
  public set budget(value: number) {
    this._budget = value;
  }

  public get nextEvent(): number | undefined {
    return this._nextEvent;
  }
  public set nextEvent(value: number | undefined) {
    this._nextEvent = value;
  }

  public get globalStatus(): DealingStatus {
    return this._globalStatus;
  }
  public set globalStatus(text: string) {
    this._globalStatus = JSON.parse(text);
  }

  public get status(): StatusType {
    return this._globalStatus.status;
  }

  public async start(): Promise<void> {
    const session = await this.api.rest.login.createSession(
      this.config.get("ig-api.username"),
      this.config.get("ig-api.password"),
    );
    gLogger.info("Trader.start", `Client ID is "${session.clientId}".`);
  }

  private async getDailyOptionsOf(market: string): Promise<Market[]> {
    gLogger.debug("Trader.getDailyOptionsOf", market);

    let markets = await this.api.getMarketNavigation();
    const topMarketId = markets.nodes?.find((item) => item.name == market);

    markets = await this.api.getMarketNavigation(topMarketId?.id);
    gLogger.debug("Trader.getDailyOptionsOf", market, markets);
    const dailyOptionsId = markets.nodes?.find(
      (item) => item.name == "Options jour",
    );
    // console.log("dailyOptionsId", dailyOptionsId);

    markets = await this.api.getMarketNavigation(dailyOptionsId?.id);
    const todayOptionsId = markets.nodes?.find((item) => item.name == "Jour");
    // console.log("todayOptionsId", todayOptionsId);
    const result = (await this.api.getMarketNavigation(todayOptionsId?.id))
      .markets!;
    return result?.filter((item) => item.marketStatus == "TRADEABLE");
  }

  public async getUnderlyingPrice(): Promise<number> {
    const markets = (await this.api.searchMarkets(this._underlying)).markets;
    // console.log(markets);
    const sum = markets.reduce(
      (p, v) => (v.bid && v.offer ? p + v.bid + v.offer : p),
      0,
    );
    const count = markets.reduce((p, v) => (v.bid && v.offer ? p + 1 : p), 0);
    return Math.round((sum * 100) / count / 2) / 100;
  }

  private findEntryContract(
    options: Market[],
    price: number,
  ): { [LegType.Put]: Market | undefined; [LegType.Call]: Market | undefined } {
    // const result :{ [LegType.Put]: Market|undefined; [LegType.Call]: Market|undefined } ={ [LegType.Put]: undefined, [LegType.Call]: undefined }
    return legtypes.reduce(
      (p, leg) => {
        p[leg] = options
          .filter((item) => item.instrumentName.endsWith(leg.toUpperCase()))
          .sort((a, b) => {
            const aStrike = Math.abs(
              parseFloat(a.instrumentName.split(" ").at(-2)!) -
                (price + (leg == LegType.Put ? -1 : 1) * this.delta),
            );
            const bStrike = Math.abs(
              parseFloat(b.instrumentName.split(" ").at(-2)!) -
                (price + (leg == LegType.Put ? -1 : 1) * this.delta),
            );
            return bStrike - aStrike;
          })
          .at(-1);
        return p;
      },
      { [LegType.Put]: undefined, [LegType.Call]: undefined } as {
        [LegType.Put]: Market | undefined;
        [LegType.Call]: Market | undefined;
      },
    );
  }

  private async processIdleState(): Promise<void> {
    const now = Date.now();
    const eventDelay = Math.floor((this.nextEvent! - now) / 60_000); // in mins
    if (eventDelay < 1) {
      gLogger.info("Trader.processIdleState", "Time for trading!");
      this.nextEvent = undefined;

      // Fetch 0 DTE options list
      const options = await this.getDailyOptionsOf(this._market);
      // Get underlying price
      const price = await this.getUnderlyingPrice();

      if (options && price) {
        // Place an entry order
        this.globalStatus.status = StatusType.Dealing;

        // Get delta distance put and call
        const twoLegsContracts = this.findEntryContract(options, price);
        // console.log("contracts", twoLegsContracts);
        const size =
          Math.floor(
            (this.budget * 100) /
              legtypes.reduce((p, leg) => p + twoLegsContracts[leg]!.offer!, 0),
          ) / 100;

        await legtypes.reduce(
          (p, leg) =>
            p.then(() => {
              gLogger.info(
                "Trader.processIdleState",
                `Buy ${size} ${twoLegsContracts[leg]!.instrumentName} @ ${twoLegsContracts[leg]!.offer} ${this._currency}`,
              );
              return this.api
                .createPosition(
                  twoLegsContracts[leg]!.epic,
                  this._currency,
                  size,
                  twoLegsContracts[leg]!.offer! * 2, // To make sure to be executed even in case of price change
                  twoLegsContracts[leg]!.expiry,
                )
                .then((dealReference) => {
                  this.globalStatus[leg] = {
                    contract: twoLegsContracts[leg]!,
                    dealReference,
                    dealConfirmation: undefined,
                    position: undefined,
                  };
                });
            }),
          Promise.resolve(),
        );
      } else {
        gLogger.error(
          "Trader.processIdleState",
          "No daily options or can't guess underlying price!",
        );
      }
    } else {
      // Display count down
      if (eventDelay >= 60) {
        if (eventDelay % 60 == 0)
          gLogger.info(
            "Trader.processIdleState",
            `${eventDelay / 60} hour(s) before trading.`,
          );
      } else {
        let display = false;
        if (eventDelay >= 10 && eventDelay % 10 == 0) display = true;
        else if (eventDelay <= 10) display = true;
        if (display)
          gLogger.info(
            "Trader.processIdleState",
            `${eventDelay} min(s) before event.`,
          );
      }
    }
  }

  private processDealingState(): Promise<void> {
    // Update deal confirmation
    return legtypes
      .reduce(
        (p, leg) =>
          p.then(() => {
            const legData: LegDealStatus = this.globalStatus[leg]!;
            if (legData.dealReference && !legData.dealConfirmation) {
              return this.api
                .tradeConfirm(legData.dealReference)
                .then((dealConfirmation) => {
                  legData.dealConfirmation = dealConfirmation;
                  if (
                    legData.dealConfirmation.dealStatus != DealStatus.ACCEPTED
                  )
                    gLogger.error(
                      "Trader.check",
                      `Failed to place ${leg} entry order: ${legData.dealConfirmation.reason}`,
                    );
                });
            }
          }),
        Promise.resolve(),
      )
      .then(() => {
        // When all deals accepted we can move to next step
        if (
          legtypes.reduce(
            (p, leg) =>
              (
                this.globalStatus[leg]!.dealConfirmation?.dealStatus ==
                DealStatus.ACCEPTED
              ) ?
                p
              : false,
            true,
          )
        ) {
          this.globalStatus.status = StatusType.Position;
        }
      });
  }

  private async processPositionState(): Promise<void> {
    // Update positions
    const positions = (await this.api.getPositions()).positions;
    // console.log(positions);
    // await legtypes.reduce(
    //   (p, leg) =>
    //     p.then(() => {
    //       const legData: LegDealStatus = this.globalStatus[leg]!;
    //       const position = positions.find(
    //         (item) =>
    //           item.position.dealReference ==
    //           legData.dealConfirmation!.dealReference,
    //       );
    //       legData.position = position?.position;
    //       if (position) legData.contract = position.market;
    //     }),
    //   Promise.resolve(),
    // );
    legtypes.forEach((leg) => {
      const legData: LegDealStatus = this.globalStatus[leg]!;
      const position = positions.find(
        (item) =>
          item.position.dealReference ==
          legData.dealConfirmation!.dealReference,
      );
      legData.position = position?.position;
      if (position) legData.contract = position.market;
    });

    // Wait for a winning leg
    if (!this.globalStatus.winningLeg) {
      await legtypes.reduce(
        (p, leg) =>
          p.then(() => {
            const legData: LegDealStatus = this.globalStatus[leg]!;
            if (legData.position && legData.position?.size > 0) {
              if (
                legData.contract!.bid! >
                legData.dealConfirmation!.level * 2
              ) {
                this.globalStatus.winningLeg = leg;
                gLogger.info(
                  "Trader.check",
                  `${leg} becomes winning leg, sell 50% of position`,
                );
                return this.api
                  .closePosition(
                    legData.position!.dealId,
                    legData.contract!.epic,
                    Math.round(legData.position!.size * 50) / 100,
                    legData.contract!.bid! / 2,
                  )
                  .then((dealReference) => this.api.tradeConfirm(dealReference))
                  .then((dealConfirmation) => {
                    gLogger.info(
                      "Trader.check",
                      formatObject(dealConfirmation),
                    );
                  });
              } else if (
                legData.contract!.bid! <
                legData.dealConfirmation!.level * 0.5
              ) {
                gLogger.info("Trader.check", `${leg} potentially loosing leg!`);
              }
            }
          }),
        Promise.resolve(),
      );
    }
  }

  public async check(): Promise<void> {
    gLogger.trace(
      "Trader.check",
      this.globalStatus.status,
      this._pause ? "paused" : "running",
    );

    if (!this._pause) {
      if (this.nextEvent && this.globalStatus.status == StatusType.Idle) {
        await this.processIdleState();
      } else if (this.globalStatus.status == StatusType.Dealing) {
        await this.processDealingState();
      } else if (this.globalStatus.status == StatusType.Position) {
        await this.processPositionState();
      }

      // const accounts = await this.api.getAccounts();
      // console.log(accounts.accounts[0]);

      gLogger.trace("Trader.check", this.globalStatus);
    }
  }

  public stop(): Promise<void> {
    return this.api.rest.login.logout();
  }

  public getPositions(): Record<LegType, Position | undefined> {
    const result = legtypes.reduce(
      (p, leg: LegType) => {
        p[leg] = this.globalStatus[leg]?.position;
        return p;
      },
      {} as Record<LegType, Position | undefined>,
    );
    return result;
  }
}
