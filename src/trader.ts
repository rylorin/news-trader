// Load env vars
import dotenv from "dotenv";
dotenv.config();

// Load config
import { IConfig } from "config";

// The following can relying on env var and config
import { Account, DealConfirmation, Market, Position } from "ig-trading-api";
import { ApiError, ValidationError } from "./errors";
import { APIClient } from "./ig-trading-api";
import { gLogger } from "./logger";
import { TradingMetrics } from "./metrics";
import { deepCopy, oppositeLeg, parseEvent, string2boolean } from "./utils";

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

export const StatusType = {
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

export type MarketX = Market & { strike: number };

export type LegDealStatus = {
  ath?: number;
  losingPartSold: boolean;
  x2PartSold: boolean;
  x3PartSold: boolean;
  contract: MarketX;
  dealReference: string;
  dealConfirmation?: DealConfirmation;
  position?: Position;
};

export type DealingStatus = {
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

  private started: boolean;
  private timer: NodeJS.Timeout | undefined;
  private _globalStatus: DealingStatus;

  private _pause: boolean;
  private _name: string;
  private _market: string;
  private _underlying: string;
  private _currency: string;
  private _delta: number;
  private _delay: number;
  private _budget: number;
  private _nextEvent: number | undefined;
  private _sampling: number;

  private _stopLevel: number;
  private _trailingStopLevel: number;
  private _losingExitSize: number;
  private readonly _oppositeExitSize: number;
  private readonly _x2WinningLevel: number;
  private readonly _x2ExitSize: number;
  private readonly _x3WinningLevel: number;
  private readonly _x3ExitSize: number;

  constructor(config: IConfig) {
    this.config = config;

    // Bot status
    this._globalStatus = {
      status: StatusType.Idle,
      [LegTypeEnum.Put]: undefined,
      [LegTypeEnum.Call]: undefined,
    };
    this.started = false;

    // Bot settings
    this._pause = string2boolean(this.config.get("trader.pause"));
    this._name = "major";
    this._market = this.config.get("trader.market");
    this._underlying = this.config.get("trader.underlying");
    this._currency = this.config.get("trader.currency");
    this._delta = this.config.get("trader.delta");
    this._delay = this.config.get("trader.delay"); // min(s)
    this._budget = this.config.get("trader.budget");
    this._sampling = this.config.get("trader.sampling"); // secs

    this._stopLevel = this.config.get("trader.stopLevel");
    this._trailingStopLevel = this.config.get("trader.trailingStopLevel");
    this._losingExitSize = 0.5;
    this._oppositeExitSize = 0.5;
    this._x2WinningLevel = 2;
    this._x2ExitSize = 0.5;
    this._x3WinningLevel = 3;
    this._x3ExitSize = 0.5;

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

    // Validate initial parameters
    this.validateTradingParameters();
  }

  /**
   * Validate trading parameters to ensure they are within safe ranges
   */
  private validateTradingParameters(): void {
    if (this._budget <= 0) {
      throw new ValidationError("Budget must be positive", "budget");
    }
    if (this._budget > 10000) {
      throw new ValidationError(
        "Budget exceeds safety limit of 10,000",
        "budget",
      );
    }

    if (this._delta <= 0) {
      throw new ValidationError("Delta must be positive", "delta");
    }
    if (this._delta > 1000) {
      throw new ValidationError(
        "Delta exceeds reasonable limit of 1,000",
        "delta",
      );
    }

    if (this._stopLevel <= 0 || this._stopLevel >= 1) {
      throw new ValidationError(
        "Stop level must be between 0 and 1",
        "stopLevel",
      );
    }

    if (this._trailingStopLevel <= 0 || this._trailingStopLevel >= 1) {
      throw new ValidationError(
        "Trailing stop level must be between 0 and 1",
        "trailingStopLevel",
      );
    }

    if (this._sampling < 1) {
      throw new ValidationError(
        "Sampling interval must be at least 1 second",
        "sampling",
      );
    }
    if (this._sampling > 3600) {
      throw new ValidationError(
        "Sampling interval exceeds 1 hour limit",
        "sampling",
      );
    }

    if (!/^[A-Z]{3}$/.test(this._currency)) {
      throw new ValidationError(
        "Currency must be a 3-letter code (e.g., USD, EUR)",
        "currency",
      );
    }
  }

  /**
   * Safe wrapper for API calls with proper error handling
   */
  private async safeApiCall<T>(
    operation: () => Promise<T>,
    operationName: string,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const errorMessage = `${operationName} failed: ${error instanceof Error ? error.message : String(error)}`;
      gLogger.error("Trader.safeApiCall", errorMessage);

      if (error instanceof Error) {
        throw new ApiError(errorMessage, undefined, error);
      } else {
        throw new ApiError(errorMessage);
      }
    }
  }

  /**
   * Validate a single parameter value
   */
  private validateParameter(
    name: string,
    value: number,
    min?: number,
    max?: number,
  ): void {
    if (typeof value !== "number" || isNaN(value)) {
      throw new ValidationError(`${name} must be a valid number`, name);
    }
    if (min !== undefined && value < min) {
      throw new ValidationError(`${name} must be at least ${min}`, name);
    }
    if (max !== undefined && value > max) {
      throw new ValidationError(`${name} must not exceed ${max}`, name);
    }
  }

  public toString(): string {
    return `/name ${this._name}
/event ${this._nextEvent ? new Date(this._nextEvent).toISOString() : "undefined"}
/market ${this._market}
/underlying ${this._underlying}
/currency ${this._currency}
/delta ${this._delta}
/budget ${this._budget}
/pause ${this._pause}
/delay ${this._delay}
/sampling ${this._sampling}
/stoplevel ${this._stopLevel}
/trailingstoplevel ${this._trailingStopLevel}
---
Next event in ${this._nextEvent ? Math.round((this._nextEvent - Date.now()) / 60_000) : "undefined"} min(s)
Now ${new Date().toISOString()}
Status: ${this._globalStatus.status}`;
  }

  public explain(): string {
    return `Current strategy:
We will trade the next ${this._name} economic macro event at ${this._nextEvent ? new Date(this._nextEvent).toUTCString() : "undefined"} (now: ${new Date().toUTCString()}).

Trade Entry:
We buy a strangle on ${this._market} for an overall budget of ${this._budget} ${this._currency}, ${Math.abs(this._delay)} minute(s) ${this._delay < 0 ? "before" : "after"} the event.
Each leg will be at a distance of ${this._delta} from the ${this._underlying} level, selecting the closest strike.

Exits Conditions:
We will sell ${Math.round(this._x2ExitSize * 100)}% of any position reaching ${this._x2WinningLevel * 100}% of its entry price and simultaneously sell ${this._oppositeExitSize * 100}% of the opposite leg.
We will sell ${Math.round(this._x3ExitSize * 100)}% of any position reaching ${this._x3WinningLevel * 100}% of its entry price and simultaneously close the remaining opposite leg; and then sell ${this._losingExitSize * 100}% if price falls ${this._trailingStopLevel * 100}% from its highest price.

Losing Exit Conditions:
We will sell ${this._losingExitSize * 100}% of any position which price falls below ${this._stopLevel * 100}% of the entry price.

Notes:
Any unsold part of a position may be lost at the end of the trading day.
Under normal market conditions, we should not lose more than ${this._budget - this._budget * (1 - this._stopLevel) * this._losingExitSize} ${this._currency}.
Conditions will be checked approximately every ${this._sampling} second${this._sampling > 1 ? "s" : ""}; therefore, any condition that is met for less than this delay may be ignored.
🤞`;
  }

  public get pause(): boolean {
    return this._pause;
  }
  public set pause(value: boolean) {
    this._pause = value;
  }

  public get name(): string {
    return this._name;
  }
  public set name(value: string) {
    this._name = value;
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
    if (!/^[A-Z]{3}$/.test(value)) {
      throw new ValidationError(
        "Currency must be a 3-letter code (e.g., USD, EUR)",
        "currency",
      );
    }
    this._currency = value;
  }

  public get delta(): number {
    return this._delta;
  }
  public set delta(value: number) {
    this.validateParameter("delta", value, 1, 1000);
    this._delta = value;
  }

  public get budget(): number {
    return this._budget;
  }
  public set budget(value: number) {
    this.validateParameter("budget", value, 0.01, 10000);
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
    this.validateParameter("sampling", value, 1, 3600);
    this._sampling = value;
  }

  public get stoplevel(): number {
    return this._stopLevel;
  }
  public set stoplevel(value: number) {
    this.validateParameter("stoplevel", value, 0.01, 0.99);
    this._stopLevel = value;
  }

  public get trailingStopLevel(): number {
    return this._trailingStopLevel;
  }
  public set trailingStopLevel(value: number) {
    this.validateParameter("trailingStopLevel", value, 0.01, 0.99);
    this._trailingStopLevel = value;
  }

  public async start(): Promise<void> {
    const session = await this.safeApiCall(
      async () =>
        this.api.createSession(
          this.config.get("ig-api.username"),
          this.config.get("ig-api.password"),
        ),
      "createSession",
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

  private async getDailyOptionsOf(market: string): Promise<MarketX[]> {
    gLogger.debug("Trader.getDailyOptionsOf", market);

    let markets = await this.safeApiCall(
      async () => this.api.getMarketNavigation(),
      "getMarketNavigation",
    );
    const topMarketId = markets.nodes?.find((item) => item.name == market);

    markets = await this.safeApiCall(
      async () => this.api.getMarketNavigation(topMarketId?.id),
      "getMarketNavigation",
    );
    gLogger.trace("Trader.getDailyOptionsOf", market, markets);
    const dailyOptionsId = markets.nodes?.find(
      (item) => item.name == "Options jour",
    );

    markets = await this.safeApiCall(
      async () => this.api.getMarketNavigation(dailyOptionsId?.id),
      "getMarketNavigation",
    );
    const todayOptionsId = markets.nodes?.find((item) => item.name == "Jour");

    const result = (
      await this.safeApiCall(
        async () => this.api.getMarketNavigation(todayOptionsId?.id),
        "getMarketNavigation",
      )
    ).markets!;

    return result
      ?.filter((item) => item.marketStatus == "TRADEABLE")
      .map((item) => ({
        ...item,
        strike: this.getStrike(item.instrumentName),
      }));
  }

  public async getUnderlyingPrice(): Promise<number> {
    const markets = (
      await this.safeApiCall(
        async () => this.api.searchMarkets(this._underlying),
        "searchMarkets",
      )
    ).markets;

    const sum = markets.reduce(
      (p, v) => (v.bid && v.offer ? p + v.bid + v.offer : p),
      0,
    );
    const count = markets.reduce((p, v) => (v.bid && v.offer ? p + 1 : p), 0);
    return Math.round((sum * 100) / count / 2) / 100;
  }

  private getStrike(name: string): number {
    return parseFloat(name.split(" ").at(-3)!);
  }

  private findEntryContract(
    options: MarketX[],
    price: number,
  ): {
    [LegTypeEnum.Put]: MarketX | undefined;
    [LegTypeEnum.Call]: MarketX | undefined;
  } {
    return legtypes.reduce(
      (p, leg) => {
        p[leg] = options
          .filter((item) => item.instrumentName.includes(leg.toUpperCase()))
          .map((item) => {
            // console.log(item);
            return item;
          })
          .filter((item) =>
            leg == LegTypeEnum.Put ? item.strike < price : item.strike > price,
          )
          .sort((a, b) => {
            const aDelta = Math.abs(
              a.strike -
                (price + (leg == LegTypeEnum.Put ? -1 : 1) * this.delta),
            );
            const bDelta = Math.abs(
              b.strike -
                (price + (leg == LegTypeEnum.Put ? -1 : 1) * this.delta),
            );
            return bDelta - aDelta;
          })
          .at(-1);
        return p;
      },
      { [LegTypeEnum.Put]: undefined, [LegTypeEnum.Call]: undefined } as {
        [LegTypeEnum.Put]: MarketX | undefined;
        [LegTypeEnum.Call]: MarketX | undefined;
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
          `${eventDelay} mins before trading.`,
        );
    } else if (eventDelay > 0) {
      // Display countdown every min
      gLogger.info(
        "Trader.processIdleState",
        `${eventDelay} min${eventDelay > 1 ? "s" : ""} before trading.`,
      );
    }
    this.lastCount = eventDelay;
  }

  private async processIdleState(): Promise<void> {
    const now = Date.now();
    if (now > this._nextEvent! + this._delay * 60_000) {
      gLogger.info("Trader.processIdleState", "Time for trading!");
      this.nextEvent = undefined;

      // Fetch 0 DTE options list
      const options = await this.getDailyOptionsOf(this._market);
      // Get underlying price
      const price = await this.getUnderlyingPrice();
      // console.log(`Underlying price is ${price}`);
      // console.log(`Found ${options.length} daily options`);
      // console.log(
      //   `Options: ${options.map((item) => item.instrumentName).join(", ")}`,
      // );

      if (options && price) {
        // Place an entry order
        this.globalStatus.status = StatusType.Dealing;

        // Get delta distance put and call
        const twoLegsContracts = this.findEntryContract(options, price);
        // console.log(twoLegsContracts);
        if (
          !twoLegsContracts[LegTypeEnum.Put] ||
          !twoLegsContracts[LegTypeEnum.Call]
        ) {
          gLogger.error(
            "Trader.processIdleState",
            "Can't find both legs for the strangle!",
          );
          this.globalStatus.status = StatusType.Idle;
          return;
        }
        const denomo = legtypes.reduce(
          (p, leg) => p + twoLegsContracts[leg]!.offer!,
          0,
        );
        const size = Math.max(
          Math.floor((this.budget * 50) / denomo) / 50,
          0.06, // min size
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
                .then((dealReference) => {
                  this.globalStatus[leg] = {
                    ath: undefined,
                    losingPartSold: false,
                    x2PartSold: false,
                    x3PartSold: false,
                    contract: twoLegsContracts[leg]!,
                    dealReference,
                    dealConfirmation: undefined,
                    position: undefined,
                  };
                });
            }),
          Promise.resolve(),
        );
        this.globalStatus.status = StatusType.Dealing;
      } else {
        gLogger.error(
          "Trader.processIdleState",
          "No daily options or can't guess underlying price!",
        );
      }
    } else {
      this.displayCountDown(
        Math.floor((this._nextEvent! + this._delay * 60_000 - now) / 60_000),
      );
    }
  }

  private async processDealingState(): Promise<void> {
    // Update deal confirmation
    await legtypes.reduce(
      async (p, leg) =>
        p.then(async () => {
          const legData: LegDealStatus | undefined = this.globalStatus[leg];
          if (legData && !legData.dealConfirmation) {
            return this.api
              .tradeConfirm(legData.dealReference)
              .then((dealConfirmation) => {
                legData.dealConfirmation = dealConfirmation;
                gLogger.info(
                  "Trader.processIdleState",
                  `${dealConfirmation.direction} ${dealConfirmation.size} ${dealConfirmation.epic} ${dealConfirmation.dealStatus}`,
                );
              });
          }
        }),
      Promise.resolve(),
    );
    const positionsComplete = legtypes.reduce(
      (p, leg) => (this._globalStatus[leg]?.position ? p : false),
      true,
    );
    if (positionsComplete) this._globalStatus.status = StatusType.Position;
  }

  private async updatePositions(): Promise<void> {
    return this.safeApiCall(
      async () => this.api.getPositions(),
      "getPositions",
    ).then((response) => {
      legtypes.forEach((leg) => {
        const legData: LegDealStatus | undefined = this.globalStatus[leg];
        if (legData) {
          const position = response.positions.find(
            (item) => item.position.dealReference == legData.dealReference,
          );
          legData.position = position?.position;
          if (position) {
            legData.contract = {
              ...position.market,
              strike: this.getStrike(position.market.instrumentName),
            };
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

  private async closeLegAbs(
    leg: LegType,
    units: number,
  ): Promise<DealConfirmation> {
    const legData = this.globalStatus[leg];
    if (legData && legData.position && legData.position.size > 0) {
      if (units > legData.position.size) units = legData.position.size;
      else if (units < 0.01) units = 0.01;
      return this.api
        .closePosition(
          legData.position!.dealId,
          units,
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
    } else throw Error(`${leg}: No such leg or positions closed`);
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
      this._globalStatus = {
        status: StatusType.Idle,
        [LegTypeEnum.Put]: undefined,
        [LegTypeEnum.Call]: undefined,
      };
      gLogger.info("Trader.processWonState", "Trading complete");
    }
  }

  public async getAccount(): Promise<Account> {
    const accounts = await this.safeApiCall(
      async () => this.api.getAccounts(),
      "getAccounts",
    );
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
        legData.contract.bid <=
          legData.position.level * (1 - this._stopLevel) &&
        !legData.losingPartSold
      ) {
        // Sell losing position
        const exitSize =
          Math.round(legData.position.size * this._losingExitSize * 100) / 100;
        gLogger.info(
          "Trader.processOneLeg",
          `Sell (${this._losingExitSize * 100}%/stop) ${exitSize} ${legData.contract.instrumentName} @ ${legData.contract.bid} ${this._currency}`,
        );
        return this.closeLegAbs(leg, exitSize).then((_dealConfirmation) => {
          legData.losingPartSold = true;
        });
      } else if (
        legData.contract.bid <= legData.ath! * (1 - this._trailingStopLevel) &&
        !legData.losingPartSold &&
        legData.x3PartSold
      ) {
        // trailing stop loss on winning position
        const exitSize =
          Math.round(legData.position.size * this._losingExitSize * 100) / 100;
        gLogger.info(
          "Trader.processOneLeg",
          `Sell (${this._losingExitSize * 100}%/trailing stop) ${exitSize} ${legData.contract.instrumentName} @ ${legData.contract.bid} ${this._currency}`,
        );
        return this.closeLegAbs(leg, exitSize).then((_dealConfirmation) => {
          legData.losingPartSold = true;
        });
      } else if (winRatio > this._x2WinningLevel && !legData.x2PartSold) {
        // x2 level hit, sell part of wining leg
        const exitSize =
          Math.round(legData.position.size * this._x2ExitSize * 100) / 100;
        gLogger.info(
          "Trader.processOneLeg",
          `Sell (${this._x2ExitSize * 100}%/x2 level) ${exitSize} ${legData.contract.instrumentName} @ ${legData.contract.bid} ${this._currency}`,
        );
        return this.closeLegAbs(leg, exitSize).then(
          async (_dealConfirmation) => {
            legData.x2PartSold = true;
            if (this._oppositeExitSize > 0) {
              // Sell opposite (losing) leg
              const oppositeLegData = this.globalStatus[oppositeLeg(leg)];
              if (
                oppositeLegData &&
                oppositeLegData.position &&
                oppositeLegData.contract.bid
              ) {
                const exitSize =
                  Math.round(
                    oppositeLegData.position.size *
                      this._oppositeExitSize *
                      100,
                  ) / 100;
                gLogger.info(
                  "Trader.processOneLeg",
                  `Sell (${this._oppositeExitSize * 100}%/losing) ${exitSize} ${oppositeLegData.contract.instrumentName} @ ${oppositeLegData.contract.bid} ${this._currency}`,
                );
                return this.closeLegAbs(oppositeLeg(leg), exitSize).then(
                  (_dealConfirmation) => {
                    oppositeLegData.losingPartSold = true;
                  },
                );
              }
            }
          },
        );
      } else if (winRatio > this._x3WinningLevel && !legData.x3PartSold) {
        // x3 level hit, sell part of wining leg
        const exitSize =
          Math.round(legData.position.size * this._x3ExitSize * 100) / 100;
        gLogger.info(
          "Trader.processOneLeg",
          `Sell (${this._x3ExitSize * 100}%/x3 level) ${exitSize} ${legData.contract.instrumentName} @ ${legData.contract.bid} ${this._currency}`,
        );
        return this.closeLegAbs(leg, exitSize).then(
          async (_dealConfirmation) => {
            legData.x3PartSold = true;
            // Fully Sell opposite (losing) leg
            const oppositeLegData = this.globalStatus[oppositeLeg(leg)];
            if (
              oppositeLegData &&
              oppositeLegData.position &&
              oppositeLegData.contract.bid
            ) {
              const exitSize = oppositeLegData.position.size;
              gLogger.info(
                "Trader.processOneLeg",
                `Sell (lost opposite) ${exitSize} ${oppositeLegData.contract.instrumentName} @ ${oppositeLegData.contract.bid} ${this._currency}`,
              );
              return this.closeLegAbs(oppositeLeg(leg), exitSize).then(
                (_dealConfirmation) => {
                  oppositeLegData.losingPartSold = true;
                },
              );
            }
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
        "All legs are losing, exiting positions.",
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
        // await this.api.getAccounts(); // Test API status
        if (this._nextEvent && this._globalStatus.status == StatusType.Idle) {
          await this.processIdleState(); // Open positions when conditions are met
        }
        if (this._globalStatus.status !== StatusType.Idle) {
          await this.updatePositions(); // Update all positions
        }
        if (this._globalStatus.status == StatusType.Dealing) {
          await this.processDealingState(); // Check if all positions are open
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
    return this.api.disconnect();
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

    // Update position metrics
    const positionCount = legtypes.reduce(
      (count, leg) => (result[leg] ? count + 1 : count),
      0,
    );
    TradingMetrics.updatePositionCount(positionCount);

    return result;
  }
}
