// Load env vars
import dotenv from "dotenv";
dotenv.config();

// Load config
import { IConfig } from "config";

// The following can relying on env var and config
import { DealConfirmation, DealStatus, Market, Position } from "ig-trading-api";
import { APIClient } from "./ig-trading-api";
import { gLogger } from "./logger";
import { formatObject } from "./utils";

const StatusType = {
  Idle: undefined,
  Dealing: "Dealing",
  Position: "Position",
} as const;
type StatusType = (typeof StatusType)[keyof typeof StatusType];

const LegType = {
  Put: "put",
  Call: "call",
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
  private _delta: number;
  private _budget: number;
  private _globalStatus: DealingStatus;
  private _nextEvent: number | undefined;

  constructor(config: IConfig) {
    this.config = config;

    this._globalStatus = {
      status: StatusType.Idle,
      put: undefined,
      call: undefined,
      winningLeg: undefined,
    };
    this.delay = this.config.get("trader.delay");
    this._delta = this.config.get("trader.delta");
    this._budget = this.config.get("trader.budget");

    this.api = new APIClient(
      config.get("ig-api.url"),
      this.config.get(`ig-api.api-key`),
    );
  }

  public toString(): string {
    return `Market: ${this.config.get("trader.market")}
Next event: ${this.nextEvent ? new Date(this.nextEvent).toISOString() : "undefined"}
Delta: ${this.delta}
Budget: ${this.budget}`;
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

  private async getUnderlyingPrice(underlying: string): Promise<number> {
    const markets = (await this.api.searchMarkets(underlying)).markets;
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
  ): { put: Market; call: Market } {
    const put = options
      .filter((item) => item.instrumentName.endsWith("PUT"))
      .sort((a, b) => {
        const aStrike = Math.abs(
          parseFloat(a.instrumentName.split(" ").at(-2)!) -
            (price - this.delta),
        );
        const bStrike = Math.abs(
          parseFloat(b.instrumentName.split(" ").at(-2)!) -
            (price - this.delta),
        );
        return bStrike - aStrike;
      })
      .at(-1)!;
    // console.log("puts", puts.at(-1));
    const call = options
      .filter((item) => item.instrumentName.endsWith("CALL"))
      .sort((a, b) => {
        const aStrike = Math.abs(
          parseFloat(a.instrumentName.split(" ").at(-2)!) -
            (price + this.delta),
        );
        const bStrike = Math.abs(
          parseFloat(b.instrumentName.split(" ").at(-2)!) -
            (price + this.delta),
        );
        return bStrike - aStrike;
      })
      .at(-1)!;
    // console.log("calls", calls.at(-1));
    return { put, call };
  }

  private async processIdleState() {
    const now = Date.now();
    if (now > this.nextEvent! - this.delay * 60_000) {
      gLogger.info("Trader.check", "Time for trading!");
      this.nextEvent = undefined;

      // Fetch 0 DTE options list
      const options = await this.getDailyOptionsOf(
        this.config.get("trader.market"),
      );
      // Get underlying price
      const price = await this.getUnderlyingPrice(
        this.config.get("trader.underlying"),
      );

      if (options && price) {
        // Place an entry order
        this.globalStatus.status = StatusType.Dealing;

        // Get delta distance put and call
        const twoLegsContracts = this.findEntryContract(options, price);
        // console.log("contracts", twoLegsContracts);
        const size =
          Math.floor(
            (this.budget * 100) /
              (twoLegsContracts.put.offer! + twoLegsContracts.call.offer!),
          ) / 100;

        gLogger.info(
          "Trader.check",
          `Buy ${size} ${twoLegsContracts.put.instrumentName} @ ${twoLegsContracts.put.offer} USD`,
        );
        const putRef = await this.api.createPosition(
          twoLegsContracts.put.epic,
          "USD",
          size,
          twoLegsContracts.put.offer! * 2, // To make sure to be executed even in case of price change
          twoLegsContracts.put.expiry,
        );
        this.globalStatus.put = {
          contract: twoLegsContracts.put,
          dealReference: putRef,
          dealConfirmation: undefined,
          position: undefined,
        };

        gLogger.info(
          "Trader.check",
          `Buy ${size} ${twoLegsContracts.call.instrumentName} @ ${twoLegsContracts.call.offer} USD`,
        );
        const callRef = await this.api.createPosition(
          twoLegsContracts.call.epic,
          "USD",
          size,
          twoLegsContracts.call.offer! * 2, // To make sure to be executed even in case of price change
          twoLegsContracts.call.expiry,
        );
        this.globalStatus.call = {
          contract: twoLegsContracts.call,
          dealReference: callRef,
          dealConfirmation: undefined,
          position: undefined,
        };
      } else {
        gLogger.error(
          "Trader.check",
          "No daily options or can't guess underlying price!",
        );
      }
    } else {
      // Display count down
      const mins = Math.ceil(
        (this.nextEvent! - this.delay * 60_000 - now) / 60_000,
      );
      // console.log(mins, mins % 60);
      if (mins >= 60 && mins % 60 == 0) {
        gLogger.info("Trader.check", `${mins / 60} hour(s) before trading`);
      } else {
        let display = false;
        if (mins >= 10 && mins % 10 == 0) display = true;
        else if (mins <= 10) display = true;
        if (display)
          gLogger.info("Trader.check", `${mins} min(s) before trading`);
      }
    }
  }

  private async processDealingState() {
    if (
      this.globalStatus.put &&
      this.globalStatus.put.dealReference &&
      !this.globalStatus.put.dealConfirmation
    ) {
      this.globalStatus.put.dealConfirmation = await this.api.tradeConfirm(
        this.globalStatus.put.dealReference,
      );
      if (
        this.globalStatus.put.dealConfirmation.dealStatus != DealStatus.ACCEPTED
      )
        gLogger.error(
          "Trader.check",
          `Failed to place Put entry order: ${this.globalStatus.put.dealConfirmation.reason}`,
        );
    }
    if (
      this.globalStatus.call &&
      this.globalStatus.call.dealReference &&
      !this.globalStatus.call.dealConfirmation
    ) {
      this.globalStatus.call.dealConfirmation = await this.api.tradeConfirm(
        this.globalStatus.call.dealReference,
      );
      if (
        this.globalStatus.call.dealConfirmation.dealStatus !=
        DealStatus.ACCEPTED
      )
        gLogger.error(
          "Trader.check",
          `Failed to place Call entry order: ${this.globalStatus.call.dealConfirmation.reason}`,
        );
    }
    if (
      this.globalStatus.put?.dealConfirmation?.dealStatus ==
        DealStatus.ACCEPTED &&
      this.globalStatus.call?.dealConfirmation?.dealStatus ==
        DealStatus.ACCEPTED
    ) {
      this.globalStatus.status = StatusType.Position;
    }
  }

  private async processPositionState() {
    // Update positions
    const positions = (await this.api.getPositions()).positions;
    // console.log(positions);
    let position;
    position = positions.find(
      (item) =>
        item.position.dealReference ==
        this.globalStatus.put!.dealConfirmation!.dealReference,
    );
    this.globalStatus.put!.position = position?.position;
    if (position) this.globalStatus.put!.contract = position.market;
    position = positions.find(
      (item) =>
        item.position.dealReference ==
        this.globalStatus.call!.dealConfirmation!.dealReference,
    );
    this.globalStatus.call!.position = position?.position;
    if (position) this.globalStatus.call!.contract = position.market;

    // Wait for a winning leg
    if (!this.globalStatus.winningLeg) {
      await legtypes.reduce(
        (p, leg) =>
          p.then(() => {
            const legData: LegDealStatus = this.globalStatus[leg]!;
            if (legData.contract!.bid! > legData.dealConfirmation!.level * 2) {
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
                  gLogger.info("Trader.check", formatObject(dealConfirmation));
                });
            } else if (
              legData.contract!.bid! <
              legData.dealConfirmation!.level * 0.5
            ) {
              gLogger.info("Trader.check", `${leg} potentially loosing leg!`);
            }
          }),
        Promise.resolve(),
      );
    }
  }

  public async check(): Promise<void> {
    gLogger.debug("Trader.check", this.globalStatus.status);

    if (this.nextEvent && this.globalStatus.status == StatusType.Idle) {
      await this.processIdleState();
    } else if (this.globalStatus.status == StatusType.Dealing) {
      await this.processDealingState();
    } else if (this.globalStatus.status == StatusType.Position) {
      await this.processPositionState();
    }

    gLogger.trace("Trader.check", this.globalStatus);
  }

  public stop(): void {
    this.api.rest.login.logout();
  }

  public getPositions(): Record<LegType, number> {
    const result: Record<string, string> = {};
    legtypes.reduce(
      (p: Record<string, string>, leg: LegType) => {
        p[leg] = formatObject(this.globalStatus[leg]?.position);
        return p;
      },
      {} as Record<string, string>,
    );
    return result as unknown as Record<LegType, number>;
  }
}
