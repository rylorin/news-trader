// Load env vars
import dotenv from "dotenv";
dotenv.config();

// Load config
import { IConfig } from "config";

// The following can relying on env var and config
import { Account, DealConfirmation, Market, Position } from "ig-trading-api";
import { APIClient } from "./ig-trading-api";
import { gLogger } from "./logger";
import { deepCopy, parseEvent, string2boolean } from "./utils";

export type PositionEntry = {
  instrumentName: string;
  epic: string;
  size: number;
  open: number;
  bid: number;
  value: number;
  pnl: number;
  ratio: number;
};

const StatusType = {
  Idle: "Idle",
  Dealing: "Dealing",
  Position: "Position",
  Won: "Won",
} as const;
export type StatusType = (typeof StatusType)[keyof typeof StatusType];

export const LegTypeEnum = {
  Put: "Put",
  Call: "Call",
} as const;
export type LegType = (typeof LegTypeEnum)[keyof typeof LegTypeEnum];

export const legtypes: LegType[] = [LegTypeEnum.Put, LegTypeEnum.Call];

type LegDealStatus = {
  ath?: number;
  loosingPartSold: boolean;
  x2PartSold: boolean;
  x3PartSold: boolean;
  contract: Market;
  dealReference: string;
  dealConfirmation: DealConfirmation;
  position?: Position;
};

type DealingStatus = {
  status: StatusType;
  [LegTypeEnum.Put]: LegDealStatus | undefined;
  [LegTypeEnum.Call]: LegDealStatus | undefined;
};

/**
 * Trading bot implementation
 */
export class Trader {
  private readonly config: IConfig;
  private readonly api;
  private _pause: boolean;
  private _market: string;
  private _underlying: string;
  private _currency: string;
  private _delta: number;
  private _budget: number;
  private _globalStatus: DealingStatus;
  private _nextEvent: number | undefined;
  private _stopLevel: number;
  private _loosingExitSize: number;
  private _delay: number;
  private readonly _x2WinningLevel: number;
  private readonly _x2ExitSize: number;
  private readonly _x3WinningLevel: number;
  private readonly _x3ExitSize: number;
  private _sampling: number;
  private timer: NodeJS.Timeout | undefined;
  private started: boolean;

  constructor(config: IConfig) {
    this.config = config;

    // Bot status
    this._globalStatus = {
      status: StatusType.Idle,
      [LegTypeEnum.Put]: undefined,
      [LegTypeEnum.Call]: undefined,
    };

    // Bot settings
    this._pause = string2boolean(this.config.get("trader.pause"));
    this._market = this.config.get("trader.market");
    this._underlying = this.config.get("trader.underlying");
    this._currency = this.config.get("trader.currency");
    this._delta = this.config.get("trader.delta");
    this._budget = this.config.get("trader.budget");
    this._delay = this.config.get("trader.delay"); // min(s)
    this._stopLevel = this.config.get("trader.stopLevel");
    this._sampling = this.config.get("trader.sampling"); // secs
    this._loosingExitSize = 0.5;
    this._x2WinningLevel = 2;
    this._x2ExitSize = 0.5;
    this._x3WinningLevel = 3;
    this._x3ExitSize = 1 / 3;
    this.started = false;

    // For debugging/replay purpose
    if (this.config.has("trader.event"))
      this._nextEvent = parseEvent(this.config.get("trader.event"));
    if (this.config.has("trader.state"))
      this._globalStatus = {
        ...this._globalStatus,
        ...deepCopy(this.config.get("trader.state")),
      };

    this.api = new APIClient(
      config.get("ig-api.url"),
      this.config.get(`ig-api.api-key`),
    );
  }

  public toString(): string {
    return `/event ${this._nextEvent ? new Date(this._nextEvent).toISOString() : "undefined"}
/market ${this._market}
/underlying ${this._underlying}
/currency ${this._currency}
/delta ${this._delta}
/budget ${this._budget}
/pause ${this._pause}
/sampling ${this._sampling}
/stoplevel ${this._stopLevel}
---
Next event in ${this._nextEvent ? Math.round((this._nextEvent - Date.now()) / 60_000) : "undefined"} min(s)
Now ${new Date().toISOString()}
Status: ${this._globalStatus.status}`;
  }

  public explain(): string {
    return `News trader's strategy:
We will trade the next major economic macro event at ${this._nextEvent ? new Date(this._nextEvent).toUTCString() : "undefined"} (now: ${new Date().toUTCString()}).

Trade entry:
We will simultaneously buy ${LegTypeEnum.Put} and ${LegTypeEnum.Call} legs on ${this._market} for an overall budget of ${this._budget} ${this._currency} during the last ${this._delay} minute(s) before the event.
Each leg will be at a distance of ${this._delta} from the ${this._underlying} level, selecting the closest strike.

Losing exit conditions:
We will sell ${this._loosingExitSize * 100}% (based on current/remaining size) of any leg which price falls below ${this._stopLevel * 100}% of the entry price below the highest price reached during the current trading session.

Winning exits conditions:
We will sell ${Math.round(this._x2ExitSize * 100)}% (based on open size) of any leg reaching ${this._x2WinningLevel * 100}% of its entry price. We will simultaneously close the opposite leg.
We will sell ${Math.round(this._x3ExitSize * 100)}% (based on open size) of any leg reaching ${this._x3WinningLevel * 100}% of its entry price.

Notes:
Any unsold part of a position may be lost at the end of the trading day.
Under normal market conditions, we should not lose more than ${this._budget - this._budget * (1 - this._stopLevel) * this._loosingExitSize} ${this._currency}.
Conditions will be checked approximately every ${this._sampling} second${this._sampling > 1 ? "s" : ""}; therefore, any condition that is met for less than this delay may be ignored.
🤞`;
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

  public get delay(): number {
    return this._delay;
  }
  public set delay(value: number) {
    this._delay = value;
  }

  public get sampling(): number {
    return this._sampling;
  }
  public set sampling(value: number) {
    this._sampling = value;
  }

  public get stoplevel(): number {
    return this._stopLevel;
  }
  public set stoplevel(value: number) {
    this._stopLevel = value;
  }

  public async start(): Promise<void> {
    const session = await this.api.rest.login.createSession(
      this.config.get("ig-api.username"),
      this.config.get("ig-api.password"),
    );
    gLogger.info("Trader.start", `Client ID is "${session.clientId}".`);
    this.started = true;
    this.timer = setTimeout(() => {
      this.check().catch((err: Error) => {
        console.log(err);
        gLogger.error("MyTradingBotApp.check", err.message);
      });
    }, 10_000);
  }

  private async getDailyOptionsOf(market: string): Promise<Market[]> {
    gLogger.debug("Trader.getDailyOptionsOf", market);

    let markets = await this.api.getMarketNavigation();
    const topMarketId = markets.nodes?.find((item) => item.name == market);

    markets = await this.api.getMarketNavigation(topMarketId?.id);
    gLogger.trace("Trader.getDailyOptionsOf", market, markets);
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
  ): {
    [LegTypeEnum.Put]: Market | undefined;
    [LegTypeEnum.Call]: Market | undefined;
  } {
    // const result :{ [LegType.Put]: Market|undefined; [LegType.Call]: Market|undefined } ={ [LegType.Put]: undefined, [LegType.Call]: undefined }
    return legtypes.reduce(
      (p, leg) => {
        p[leg] = options
          .filter((item) => item.instrumentName.endsWith(leg.toUpperCase()))
          .sort((a, b) => {
            const aStrike = Math.abs(
              parseFloat(a.instrumentName.split(" ").at(-2)!) -
                (price + (leg == LegTypeEnum.Put ? -1 : 1) * this.delta),
            );
            const bStrike = Math.abs(
              parseFloat(b.instrumentName.split(" ").at(-2)!) -
                (price + (leg == LegTypeEnum.Put ? -1 : 1) * this.delta),
            );
            return bStrike - aStrike;
          })
          .at(-1);
        return p;
      },
      { [LegTypeEnum.Put]: undefined, [LegTypeEnum.Call]: undefined } as {
        [LegTypeEnum.Put]: Market | undefined;
        [LegTypeEnum.Call]: Market | undefined;
      },
    );
  }

  private lastCount: number | undefined;

  private displayCountDown(eventDelay: number): void {
    if (this.lastCount == eventDelay) return;
    if (eventDelay >= 60) {
      if (eventDelay % 60 == 0)
        // Display countdown every one hour
        gLogger.info(
          "Trader.processIdleState",
          `${eventDelay / 60} hour(s) before trading.`,
        );
    } else if (eventDelay >= 10) {
      if (eventDelay % 10 == 0)
        // Display countdown every ten mins
        gLogger.info(
          "Trader.processIdleState",
          `${eventDelay} min(s) before trading.`,
        );
    } else if (eventDelay > 0) {
      // Display countdown every min
      gLogger.info(
        "Trader.processIdleState",
        `${eventDelay} min(s) before trading.`,
      );
    }
    this.lastCount = eventDelay;
  }

  private async processIdleState(): Promise<void> {
    const now = Date.now();
    const eventDelay = Math.floor((this.nextEvent! - now) / 60_000); // in mins
    if (eventDelay < this._delay) {
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
        const denomo = legtypes.reduce(
          (p, leg) => p + twoLegsContracts[leg]!.offer!,
          0,
        );
        const size = Math.max(
          Math.floor((this.budget * 50) / denomo) / 50,
          0.02, // min size of 0.02
        );

        await legtypes.reduce(
          async (p, leg) =>
            p.then(async () => {
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
                .then(async (dealReference) => {
                  return this.api
                    .tradeConfirm(dealReference)
                    .then((dealConfirmation) => {
                      this.globalStatus[leg] = {
                        ath: undefined,
                        loosingPartSold: false,
                        x2PartSold: false,
                        x3PartSold: false,
                        contract: twoLegsContracts[leg]!,
                        dealReference,
                        dealConfirmation,
                        position: undefined,
                      };
                      gLogger.info(
                        "Trader.processIdleState",
                        `${dealConfirmation.direction} ${dealConfirmation.size} ${dealConfirmation.epic} ${dealConfirmation.dealStatus}`,
                      );
                    });
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
    } else this.displayCountDown(eventDelay);
  }

  private processDealingState(): void {
    // Update deal confirmation
    const positionsComplete = legtypes.reduce(
      (p, leg) => (this._globalStatus[leg]?.position ? p : false),
      true,
    );
    if (positionsComplete) this._globalStatus.status = StatusType.Position;
  }

  private async updatePositions(): Promise<void> {
    return this.api.getPositions().then((response) => {
      legtypes.forEach((leg) => {
        const legData: LegDealStatus | undefined = this.globalStatus[leg];
        if (legData) {
          const position = response.positions.find(
            (item) =>
              item.position.dealReference ==
              legData.dealConfirmation!.dealReference,
          );
          legData.position = position?.position;
          if (position) {
            legData.contract = position.market;
            if (!legData.ath) legData.ath = position.position.level;
            if (legData.contract.bid! > legData.ath)
              legData.ath = position.market.bid!;
          }
        }
      });
    });
  }

  public async closeLeg(
    leg: LegType,
    percent: number,
    posRelative = false,
  ): Promise<DealConfirmation> {
    const legData = this.globalStatus[leg];
    if (legData && legData.position && legData.position.size > 0) {
      let relSize = Math.round(legData.position!.size * percent * 100) / 100; // Relative to current position
      if (relSize < 0.01) relSize = 0.01;
      let absSize =
        Math.round(legData.dealConfirmation!.size * percent * 100) / 100; // Relative to initial position
      if (absSize > legData.position!.size) absSize = legData.position!.size;
      return this.api
        .closePosition(
          legData.position!.dealId,
          posRelative ? relSize : absSize,
          legData.contract!.bid! / 2,
        )
        .then(async (dealReference) => this.api.tradeConfirm(dealReference))
        .then((dealConfirmation) => {
          gLogger.info(
            "Trader.processPositionState",
            `${dealConfirmation.direction} ${dealConfirmation.size} ${dealConfirmation.epic} ${dealConfirmation.dealStatus}`,
          );
          return dealConfirmation;
        });
    } else throw Error(`No such leg or positions closed for "${leg}" leg`);
  }

  private isLoosing(leg: LegType): boolean {
    const legData: LegDealStatus | undefined = this.globalStatus[leg];
    return !!(
      legData &&
      legData.contract &&
      legData.dealConfirmation &&
      legData.position &&
      legData.position.size > 0 &&
      legData.contract.bid &&
      legData.contract.bid <=
        legData.dealConfirmation.level * (1 - this._stopLevel)
    );
  }

  private allLoosing(): boolean {
    return legtypes.reduce((p, leg) => (this.isLoosing(leg) ? p : false), true);
  }

  private legPosition(leg: LegType): number {
    const legData = this.globalStatus[leg];
    if (legData && legData.position) return legData.position.size;
    else return 0;
  }

  private processWonState(): void {
    const totalPositions = legtypes.reduce(
      (p, leg) => p + this.legPosition(leg),
      0,
    );
    if (!totalPositions) {
      gLogger.info(
        "Trader.processWonState",
        `/state ${JSON.stringify(this._globalStatus)}`,
      );
      this._globalStatus = {
        status: StatusType.Idle,
        [LegTypeEnum.Put]: undefined,
        [LegTypeEnum.Call]: undefined,
      };
      gLogger.info("Trader.processWonState", "Trading complete");
    }
  }

  public async getAccount(): Promise<Account> {
    const accounts = await this.api.getAccounts();
    return accounts.accounts[0];
  }

  private async processOneLeg(leg: LegType): Promise<void> {
    const legData: LegDealStatus | undefined = this.globalStatus[leg];
    if (
      legData &&
      legData.contract &&
      legData.contract.bid &&
      legData.position &&
      legData.position.size > 0
    ) {
      const winRatio = legData.contract.bid / legData.position.level;
      if (
        !legData.loosingPartSold &&
        legData.contract.bid <=
          legData.ath! - legData.position.level * this._stopLevel
      ) {
        gLogger.info(
          "Trader.processOneLeg",
          `Stop selling ${this._loosingExitSize * 100}% of ${legData.contract.instrumentName} @ ${legData.contract.bid} ${this._currency}`,
        );
        return this.closeLeg(leg, this._loosingExitSize, true).then(
          (_dealConfirmation) => {
            legData.loosingPartSold = true;
          },
        );
      } else if (winRatio > this._x3WinningLevel && !legData.x3PartSold) {
        gLogger.info(
          "Trader.processOneLeg",
          `Selling ${this._loosingExitSize * 100}% of ${legData.contract.instrumentName} @ ${legData.contract.bid} ${this._currency} at x2 level`,
        );
        return this.closeLeg(leg, this._x3ExitSize).then(
          (_dealConfirmation) => {
            legData.x3PartSold = true;
          },
        );
      } else if (winRatio > this._x2WinningLevel && !legData.x2PartSold) {
        gLogger.info(
          "Trader.processOneLeg",
          `Selling ${this._loosingExitSize * 100}% of ${legData.contract.instrumentName} @ ${legData.contract.bid} ${this._currency} at x3 level`,
        );
        return this.closeLeg(leg, this._x2ExitSize).then(
          (_dealConfirmation) => {
            legData.x2PartSold = true;
          },
        );
      }
    }
    return Promise.resolve();
  }

  private async processBothLegs(): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    if (/* this.allLoosing() */ false) {
      gLogger.info(
        "Trader.processBothLegs",
        "All legs are loosing, exiting positions.",
      );
      // Exit all positions
      return legtypes.reduce(
        async (p, leg) =>
          p.then(async () => this.closeLeg(leg, 1, true).then(() => undefined)),
        Promise.resolve(),
      );
    } else {
      return Promise.all(
        legtypes.map(async (leg) => this.processOneLeg(leg)),
      ).then(() => undefined); // Monitor open positions
    }
  }

  private checkGuard: boolean | undefined; // Reentrancy guard

  public async check(): Promise<void> {
    if (this.checkGuard) return;
    gLogger.trace(
      "Trader.check",
      this.globalStatus.status,
      this._pause ? "paused" : "running",
    );
    if (!this._pause && this.started) {
      try {
        this.checkGuard = true;
        if (this._nextEvent && this._globalStatus.status == StatusType.Idle) {
          await this.processIdleState(); // Open positions when conditions are met
        }
        if (this._globalStatus.status !== StatusType.Idle) {
          await this.updatePositions(); // Update all positions
        }
        if (this._globalStatus.status == StatusType.Dealing) {
          this.processDealingState(); // Check if all positions are open
        }
        if (this._globalStatus.status == StatusType.Position) {
          await this.processBothLegs();
          await this.processWonState(); // Check if all positions are over
        }
      } catch (error: unknown) {
        console.log(error);
        gLogger.error("Trader.check", String(error));
      } finally {
        this.checkGuard = false;
        this.timer = setTimeout(() => {
          this.check().catch((err: Error) => {
            console.log(err);
            gLogger.error("MyTradingBotApp.check", err.message);
          });
        }, this._sampling * 1_000);
        gLogger.trace("Trader.check", this.globalStatus);
      }
    }
  }

  public async stop(): Promise<void> {
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    return this.api.rest.login.logout();
  }

  public async getPositions(): Promise<
    Record<LegType, PositionEntry | undefined>
  > {
    await this.updatePositions();
    const result = legtypes.reduce(
      (p, leg: LegType) => {
        const legData = this.globalStatus[leg];
        p[leg] =
          legData?.position ?
            {
              instrumentName: legData.contract.instrumentName,
              epic: legData.contract.epic,
              size: legData.position.size,
              open: legData.position.level,
              bid: legData.contract.bid!,
              value: legData.position.size * legData.contract.bid!,
              pnl:
                legData.position.size *
                (legData.contract.bid! - legData.position.level),
              ratio: legData.contract.bid! / legData.position.level,
            }
          : undefined;
        return p;
      },
      {} as Record<LegType, PositionEntry | undefined>,
    );
    return result;
  }
}
