// Load env vars
import dotenv from "dotenv";
dotenv.config();

// Load config
import { IConfig } from "config";

// The following can relying on env var and config
import { DealConfirmation, DealStatus, Market, Position } from "ig-trading-api";
import { APIClient } from "./ig-trading-api";
import { gLogger } from "./logger";
import { oppositeLeg, parseEvent, string2boolean } from "./utils";

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

const legtypes: LegType[] = [LegTypeEnum.Put, LegTypeEnum.Call];

type LegDealStatus = {
  contract: Market;
  dealReference: string | undefined;
  dealConfirmation: DealConfirmation | undefined;
  position: Position | undefined;
};

type DealingStatus = {
  status: StatusType;
  [LegTypeEnum.Put]: LegDealStatus | undefined;
  [LegTypeEnum.Call]: LegDealStatus | undefined;
  winningLeg: LegType | undefined;
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

  constructor(config: IConfig) {
    this.config = config;

    this._globalStatus = {
      status: StatusType.Idle,
      [LegTypeEnum.Put]: undefined,
      [LegTypeEnum.Call]: undefined,
      winningLeg: undefined,
    };
    this._pause = string2boolean(this.config.get("trader.pause"));
    this._market = this.config.get("trader.market");
    this._underlying = this.config.get("trader.underlying");
    this._currency = this.config.get("trader.currency");
    this._delta = this.config.get("trader.delta");
    this._budget = this.config.get("trader.budget");
    if (this.config.has("trader.event"))
      this._nextEvent = parseEvent(this.config.get("trader.event"));
    if (this.config.has("trader.state"))
      this._globalStatus = this.config.get("trader.state");

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
Next event: ${this._nextEvent ? new Date(this._nextEvent).toISOString() : "undefined"}
Delta: ${this._delta}
Budget: ${this._budget}
Status: ${this._globalStatus.status}`;
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
        const size = Math.max(
          Math.floor(
            (this.budget * 200) /
              legtypes.reduce((p, leg) => p + twoLegsContracts[leg]!.offer!, 0),
          ) / 200,
          0.02, // min size of 0.02
        );

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
            `${eventDelay} min(s) before trading.`,
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
                      "Trader.processDealingState",
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
        // If none deal accepted move back to idle state, and pause trader
        if (
          legtypes.reduce(
            (p, leg) =>
              (
                this.globalStatus[leg]!.dealConfirmation?.dealStatus !=
                DealStatus.ACCEPTED
              ) ?
                p
              : false,
            true,
          )
        ) {
          this.globalStatus.status = StatusType.Idle;
          this._pause = true;
        }
      });
  }

  private async updatePositions(): Promise<void> {
    const positions = (await this.api.getPositions()).positions;
    // console.log(positions);
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
  }

  private async closeLeg(
    leg: LegType,
    percent: number,
    posRelative: boolean = false,
  ): Promise<DealConfirmation> {
    const legData: LegDealStatus = this.globalStatus[leg]!;
    const relSize = Math.ceil(legData.position!.size * percent * 100) / 100; // Relative to current position
    const absSize =
      Math.ceil(legData.dealConfirmation!.size * percent * 100) / 100; // Relative to initial position
    return this.api
      .closePosition(
        legData.position!.dealId,
        posRelative ? relSize : absSize,
        legData.contract!.bid! / 2,
      )
      .then((dealReference) => this.api.tradeConfirm(dealReference))
      .then((dealConfirmation) => {
        gLogger.info(
          "Trader.processPositionState",
          dealConfirmation.dealStatus,
        );
        return dealConfirmation;
      });
  }

  private isWinning(leg: LegType): boolean {
    const legData: LegDealStatus = this.globalStatus[leg]!;
    return !!(
      legData.contract &&
      legData.dealConfirmation &&
      legData.position &&
      legData.position.size > 0 &&
      legData.contract.bid &&
      legData.contract.bid > legData.dealConfirmation.level * 2
    );
  }

  private isLoosing(leg: LegType): boolean {
    const legData: LegDealStatus = this.globalStatus[leg]!;
    return !!(
      legData.contract &&
      legData.dealConfirmation &&
      legData.position &&
      legData.position.size > 0 &&
      legData.contract.bid &&
      legData.contract.bid < legData.dealConfirmation.level * 0.5
    );
  }

  private allLoosing(): boolean {
    return legtypes.reduce((p, leg) => (this.isLoosing(leg) ? p : false), true);
  }

  private async processPositionState(): Promise<void> {
    if (this.allLoosing()) {
      gLogger.info(
        "Trader.processPositionState",
        "All legs are loosing, exiting positions.",
      );
      // Exit all positions
      await legtypes.reduce(
        (p, leg) =>
          p.then(() => this.closeLeg(leg, 1, true).then(() => undefined)),
        Promise.resolve(),
      );
    } else {
      // Wait for a winning leg
      await legtypes.reduce(
        (p, leg) =>
          p.then(() => {
            if (this.isWinning(leg)) {
              gLogger.info(
                "Trader.processPositionState",
                `${leg} becomes winning leg, selling 50% of position`,
              );
              this._globalStatus.status = StatusType.Won;
              this._globalStatus.winningLeg = leg;
              return (
                // Sell 50% of winning leg
                this.closeLeg(leg, 0.5)
                  // And sell 50% of loosing leg
                  .then(() => this.closeLeg(oppositeLeg(leg), 0.5))
                  .then(() => undefined)
              );
            } else if (this.isLoosing(leg)) {
              gLogger.info(
                "Trader.processPositionState",
                `${leg} potentially loosing leg!`,
              );
            }
          }),
        Promise.resolve(),
      );
    }
  }

  private legPosition(leg: LegType): number {
    const legData = this.globalStatus[leg];
    if (legData && legData.position) return legData.position.size;
    else return 0;
  }

  public async check(): Promise<void> {
    gLogger.trace(
      "Trader.check",
      this.globalStatus.status,
      this._pause ? "paused" : "running",
    );

    if (!this._pause) {
      if (this._nextEvent && this._globalStatus.status == StatusType.Idle) {
        await this.processIdleState();
      } else if (this._globalStatus.status == StatusType.Dealing) {
        await this.processDealingState();
      } else if (this._globalStatus.status == StatusType.Position) {
        await this.updatePositions(); // Update positions
        await this.processPositionState();
      } else if (this._globalStatus.status == StatusType.Won) {
        await this.updatePositions();
        const totalPositions = legtypes.reduce(
          (p, leg) => p + this.legPosition(leg),
          0,
        );
        if (!totalPositions) this._globalStatus.status = StatusType.Idle;
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
