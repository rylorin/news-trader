import { IConfig } from "config";
import { LogLevel, gLogger } from "./logger";

export const State = {
  Idle: undefined,
  BUYING: "Buying",
  POSITION: "Position",
  SELLING: "Selling",
} as const;
export type State = (typeof State)[keyof typeof State];

/**
 * Trade: monitor events, place entry orders, place exit orders for one event
 */
export class MemeTrader {
  private readonly config: IConfig;
  private readonly api;

  private timer: NodeJS.Timeout | undefined;
  private running: boolean;
  private drainMode: boolean;

  private readonly symbol: string;
  private readonly macdParams: {
    SimpleMAOscillator: boolean;
    SimpleMASignal: boolean;
    fastPeriod: number;
    slowPeriod: number;
    signalPeriod: number;
  };
  private readonly upConfirmations: number;
  private readonly downConfirmations: number;

  private tradeBudget: number;
  private state: State;
  private position: number;
  private lastUpdate: number;

  constructor(config: IConfig, api: any, symbol: string) {
    gLogger.log(
      LogLevel.Info,
      "MemeTrader.constructor",
      symbol,
      "New instance",
    );
    this.config = config;
    this.api = api;
    this.symbol = symbol;
    this.macdParams = {
      SimpleMAOscillator: false,
      SimpleMASignal: false,
      fastPeriod: parseInt(this.config.get("trader.fastPeriod")),
      slowPeriod: parseInt(this.config.get("trader.slowPeriod")),
      signalPeriod: parseInt(this.config.get("trader.signalPeriod")),
    };
    (this.upConfirmations = parseInt(
      this.config.get("trader.upConfirmations"),
    )),
      (this.downConfirmations = parseInt(
        this.config.get("trader.downConfirmations"),
      )),
      (this.tradeBudget =
        parseFloat(this.config.get("trader.tradeBudget")) || 1);
    this.state = State.Idle;
    this.position = 0;
    this.running = false;
    this.drainMode = false;
    this.lastUpdate = 0;
  }

  public toString(): string {
    return `
symbol: ${this.symbol}
drain: ${this.drainMode}
tradeBudget: ${this.tradeBudget}
isRunning: ${this.isRunning()}
upConfirmations: ${this.upConfirmations}
downConfirmations: ${this.downConfirmations}
state: ${this.state}
position: ${this.position}
`;
  }

  setDrainMode(drainMode: boolean): void {
    this.drainMode = drainMode;
  }

  public isRunning(): boolean {
    return this.running;
  }

  public getPosition(): number {
    return this.position;
  }

  public start(): void {
    gLogger.log(
      LogLevel.Info,
      "MemeTrader.start",
      this.symbol,
      "Starting trader",
    );
    if (this.running) {
      gLogger.log(
        LogLevel.Warning,
        "MemeTrader.start",
        this.symbol,
        "Trying to start an already running trader",
      );
      return;
    }
    this.running = true;
  }

  public check(): Promise<void> {
    return Promise.resolve();
  }

  public stop(): void {
    gLogger.log(
      LogLevel.Info,
      "MemeTrader.stop",
      this.symbol,
      "Stopping trader",
    );
    if (this.running) {
      gLogger.log(
        LogLevel.Warning,
        "MemeTrader.start",
        this.symbol,
        "Trying to stop a non running trader",
      );
    }
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
