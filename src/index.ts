/*
  MyTradingBotApp
*/

// Load env vars
import dotenv from "dotenv";
dotenv.config();

// Load config
import { default as config, IConfig } from "config";

// The following can relying on env var and config
import { DealConfirmation, DealStatus, Market, Position } from "ig-trading-api";
import { Context, Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { Message, Update } from "telegraf/typings/core/types/typegram";
import { CommandContextExtn } from "telegraf/typings/telegram-types";
import { APIClient } from "./ig-trading-api";
import { gLogger, LogLevel } from "./logger";
import { formatObject, string2boolean } from "./utils";

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
type LegType = (typeof LegType)[keyof typeof LegType];

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
export class MyTradingBotApp {
  private readonly config: IConfig;
  private readonly api;
  private readonly telegram: Telegraf | undefined;
  private timer: NodeJS.Timeout | undefined;

  private pauseMode: boolean;
  private nextEvent: number | undefined;
  private delay: number;
  private delta: number;
  private budget: number;
  private globalStatus: DealingStatus;

  constructor(config: IConfig) {
    this.config = config;
    this.api = new APIClient(
      config.get("ig-api.url"),
      this.config.get(`ig-api.api-key`),
    );

    this.pauseMode = string2boolean(this.config.get("trader.pause"));
    this.globalStatus = {
      status: StatusType.Idle,
      put: undefined,
      call: undefined,
      winningLeg: undefined,
    };
    this.delay = this.config.get("trader.delay");
    this.delta = this.config.get("trader.delta");
    this.budget = this.config.get("trader.budget");

    if (this.config.get("telegram.apiKey")) {
      // Create telegram bot to control application
      this.telegram = new Telegraf(this.config.get("telegram.apiKey"));
      this.telegram.start((ctx) => ctx.reply("Welcome"));
      this.telegram.help((ctx) => ctx.reply("Send me a sticker"));
      this.telegram.on(message("sticker"), (ctx) => ctx.reply("👍"));
      this.telegram.command("pause", (ctx) => this.handlePauseCommand(ctx));
      this.telegram.command("exit", (ctx) => this.handleExitCommand(ctx));
      this.telegram.command("event", (ctx) => this.handleEventCommand(ctx));
      this.telegram.command("delta", (ctx) => this.handleDeltaCommand(ctx));
      this.telegram.command("budget", (ctx) => this.handleBudgetCommand(ctx));
      this.telegram.command("status", (ctx) => this.handleStatusCommand(ctx));
      this.telegram.command("positions", (ctx) =>
        this.handlePositionsCommand(ctx),
      );
      this.telegram.command("whoami", (ctx) =>
        ctx.reply(JSON.stringify(ctx.update)),
      );
      this.telegram.hears(/\/(.+)/, (ctx) => {
        const cmd = ctx.match[1];
        return ctx.reply(
          `command not found: '/${cmd}'. Type '/help' for help.`,
        );
      });
      this.telegram.hears(/(.+)/, (ctx) =>
        ctx.reply(
          `Hello ${ctx.message.from.username}. What do you mean by '${ctx.text}'? 🧐`,
        ),
      );
    }
  }

  private toString(): string {
    return `Pause: ${this.pauseMode ? "on" : "off"}
Market: ${this.config.get("trader.market")}
Next event: ${this.nextEvent ? new Date(this.nextEvent).toISOString() : "undefined"}
Delta: ${this.delta}
Budget: ${this.budget}`;
  }

  private async handleStatusCommand(
    ctx: Context<{
      message: Update.New & Update.NonChannel & Message.TextMessage;
      update_id: number;
    }> &
      Omit<Context<Update>, keyof Context<Update>> &
      CommandContextExtn,
  ): Promise<void> {
    gLogger.debug(
      "MyTradingBotApp.handleStatusCommand",
      "Handle 'status' command",
    );
    await ctx
      .reply(this.toString())
      .catch((err: Error) =>
        gLogger.error("MyTradingBotApp.handleStatusCommand", err.message),
      );
  }

  private async handleDeltaCommand(
    ctx: Context<{
      message: Update.New & Update.NonChannel & Message.TextMessage;
      update_id: number;
    }> &
      Omit<Context<Update>, keyof Context<Update>> &
      CommandContextExtn,
  ): Promise<void> {
    gLogger.debug(
      "MyTradingBotApp.handleDeltaCommand",
      "Handle 'delta' command",
    );
    if (ctx.payload) {
      const arg = ctx.payload.trim().replaceAll("  ", " ").toUpperCase();
      this.delta = parseInt(arg);
    }
    await ctx
      .reply(`Delta: ${this.delta}`)
      .catch((err: Error) =>
        gLogger.error("MyTradingBotApp.handleDeltaCommand", err.message),
      );
  }

  private async handleBudgetCommand(
    ctx: Context<{
      message: Update.New & Update.NonChannel & Message.TextMessage;
      update_id: number;
    }> &
      Omit<Context<Update>, keyof Context<Update>> &
      CommandContextExtn,
  ): Promise<void> {
    gLogger.debug(
      "MyTradingBotApp.handleBudgetCommand",
      "Handle 'budget' command",
    );
    if (ctx.payload) {
      const arg = ctx.payload.trim().replaceAll(" ", "");
      this.budget = parseInt(arg);
    }
    await ctx
      .reply(`Budget: ${this.budget}`)
      .catch((err: Error) =>
        gLogger.error("MyTradingBotApp.handleBudgetCommand", err.message),
      );
  }

  private async handlePauseCommand(
    ctx: Context<{
      message: Update.New & Update.NonChannel & Message.TextMessage;
      update_id: number;
    }> &
      Omit<Context<Update>, keyof Context<Update>> &
      CommandContextExtn,
  ): Promise<void> {
    gLogger.debug(
      "MyTradingBotApp.handlePauseCommand",
      "Handle 'pause' command",
    );
    if (ctx.payload) {
      const arg = ctx.payload.trim().replaceAll("  ", " ").toUpperCase();
      this.pauseMode = string2boolean(arg);
    }
    await ctx
      .reply(`Pause mode is ${this.pauseMode ? "on" : "off"}`)
      .catch((err: Error) =>
        gLogger.error("MyTradingBotApp.handleTrader", err.message),
      );
  }

  private async handleEventCommand(
    ctx: Context<{
      message: Update.New & Update.NonChannel & Message.TextMessage;
      update_id: number;
    }> &
      Omit<Context<Update>, keyof Context<Update>> &
      CommandContextExtn,
  ): Promise<void> {
    gLogger.debug(
      "MyTradingBotApp.handleEventCommand",
      "Handle 'event' command",
    );
    if (ctx.payload) {
      const arg = ctx.payload.trim().replaceAll("  ", " ").toLowerCase();
      let event;
      switch (arg) {
        case "now":
          event = Date.now();
          break;
        case "none":
        case "off":
        case "undefined":
          event = undefined;
          break;
        default:
          event = new Date(arg).getTime();
      }
      this.nextEvent = event;
    }
    await ctx
      .reply(
        `Next event: ${this.nextEvent ? new Date(this.nextEvent).toISOString() : "undefined"}`,
      )
      .catch((err: Error) =>
        gLogger.error("MyTradingBotApp.handleTrader", err.message),
      );
  }

  private async handlePositionsCommand(
    ctx: Context<{
      message: Update.New & Update.NonChannel & Message.TextMessage;
      update_id: number;
    }> &
      Omit<Context<Update>, keyof Context<Update>> &
      CommandContextExtn,
  ): Promise<void> {
    gLogger.debug(
      "MyTradingBotApp.handlePositionsCommand",
      "Handle 'positions' command",
    );
    try {
      if (this.globalStatus[LegType.Put]?.position) {
        console.log(LegType.Put);
        const output = formatObject(this.globalStatus[LegType.Put]?.position);
        console.log(output);
        await ctx
          .reply(output)
          .catch((err: Error) =>
            gLogger.error(
              "MyTradingBotApp.handlePositionsCommand",
              err.message,
            ),
          );
      }
      if (this.globalStatus[LegType.Call]?.position) {
        console.log(LegType.Call);
        const output = formatObject(this.globalStatus[LegType.Call]?.position);
        console.log(output);
        await ctx
          .reply(output)
          .catch((err: Error) =>
            gLogger.error(
              "MyTradingBotApp.handlePositionsCommand",
              err.message,
            ),
          );
      }
    } catch (err) {
      console.error(err);
      gLogger.log(
        LogLevel.Error,
        "MyTradingBotApp.handlePositionsCommand",
        undefined,
        err,
      );
    }
  }

  private async handleExitCommand(
    ctx: Context<{
      message: Update.New & Update.NonChannel & Message.TextMessage;
      update_id: number;
    }> &
      Omit<Context<Update>, keyof Context<Update>> &
      CommandContextExtn,
  ): Promise<void> {
    gLogger.debug("MyTradingBotApp.handleExitCommand", "Handle 'exit' command");
    await ctx.reply(`bye ${ctx.message.from.username}!`);
    setTimeout(() => this.exit(), 500);
  }

  public async start(): Promise<void> {
    const session = await this.api.rest.login.createSession(
      this.config.get("ig-api.username"),
      this.config.get("ig-api.password"),
    );
    gLogger.info(
      "MyTradingBotApp.start",
      `Client ID is "${session.clientId}".`,
    );
    gLogger.debug(
      "MyTradingBotApp.start",
      `IG client ID is "${session.clientId}".`,
      session,
    );

    this.timer = setInterval(() => {
      this.check().catch((err: Error) => {
        console.log(err);
        gLogger.error("MyTradingBotApp.check", err.message);
      });
    }, 60_000);

    await this.telegram?.launch(); // WARNING: this call never returns
  }

  private async getDailyOptionsOf(market: string): Promise<Market[]> {
    let markets = await this.api.getMarketNavigation();
    const topMarketId = markets.nodes?.find((item) => item.name == market);
    // console.log("topMarketId", topMarketId);
    markets = await this.api.getMarketNavigation(topMarketId?.id);
    // console.log("us tech markets", markets);
    const dailyOptionsId = markets.nodes?.find(
      (item) => item.name == "Options jour",
    );
    // console.log("dailyOptionsId", dailyOptionsId);
    markets = await this.api.getMarketNavigation(dailyOptionsId?.id);
    const todayOptionsId = markets.nodes?.find((item) => item.name == "Jour");
    // console.log("todayOptionsId", todayOptionsId);
    const result = (await this.api.getMarketNavigation(todayOptionsId?.id))
      .markets!;
    return result.filter((item) => item.marketStatus == "TRADEABLE");
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

  private async check(): Promise<void> {
    gLogger.debug(
      "MyTradingBotApp.check",
      this.pauseMode ? "paused" : "running",
      this.globalStatus.status,
    );
    if (this.pauseMode) return;

    const now = Date.now();
    if (this.nextEvent && this.globalStatus.status == StatusType.Idle) {
      if (now > this.nextEvent - this.delay * 60_000) {
        gLogger.info("MyTradingBotApp.check", "Time for trading!");
        this.nextEvent = undefined;

        // Place an entry order
        this.globalStatus.status = StatusType.Dealing;
        // Fetch 0 DTE options list
        const options = await this.getDailyOptionsOf(
          this.config.get("trader.market"),
        );
        // Get underlying price
        const price = await this.getUnderlyingPrice(
          this.config.get("trader.underlying"),
        );
        // Get delta distance put and call
        const twoLegsContracts = this.findEntryContract(options, price);
        // console.log("contracts", twoLegsContracts);
        const size =
          Math.floor(
            (this.budget * 100) /
              (twoLegsContracts.put.offer! + twoLegsContracts.call.offer!),
          ) / 100;

        gLogger.info(
          "MyTradingBotApp.check",
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
          "MyTradingBotApp.check",
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
        const mins = Math.ceil(
          (this.nextEvent - this.delay * 60_000 - now) / 60_000,
        );
        if (mins >= 60 && mins % 60 == 0) {
          gLogger.info(
            "MyTradingBotApp.check",
            `${mins / 60} hour(s) before trading`,
          );
        } else {
          let display = false;
          if (mins >= 10 && mins % 10 == 0) display = true;
          else if (mins <= 10) display = true;
          if (display)
            gLogger.info(
              "MyTradingBotApp.check",
              `${mins} min(s) before trading`,
            );
        }
      }
    } else if (this.globalStatus.status == StatusType.Dealing) {
      if (
        this.globalStatus.put &&
        this.globalStatus.put.dealReference &&
        !this.globalStatus.put.dealConfirmation
      ) {
        this.globalStatus.put.dealConfirmation = await this.api.tradeConfirm(
          this.globalStatus.put.dealReference,
        );
        if (
          this.globalStatus.put.dealConfirmation.dealStatus !=
          DealStatus.ACCEPTED
        )
          gLogger.error(
            "MyTradingBotApp.check",
            `Failed to place Put order: ${this.globalStatus.put.dealConfirmation.reason}`,
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
            "MyTradingBotApp.check",
            `Failed to place Call order: ${this.globalStatus.call.dealConfirmation.reason}`,
          );
      }
      if (
        this.globalStatus.put?.dealConfirmation &&
        this.globalStatus.call?.dealConfirmation
      ) {
        this.globalStatus.status = StatusType.Position;
      }
    } else if (this.globalStatus.status == StatusType.Position) {
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
    }

    console.log(this.globalStatus);
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.api.rest.login.logout();
  }

  public exit(signal?: string): void {
    this.stop();
    this.telegram?.stop(signal);
    process.exit();
  }
}

gLogger.info("main", `NODE_ENV=${process.env["NODE_ENV"]}`);
const bot = new MyTradingBotApp(config);
// Enable graceful stop
process.once("SIGINT", () => bot.exit("SIGINT"));
process.once("SIGTERM", () => bot.exit("SIGTERM"));
bot
  .start()
  .catch((err: Error) => gLogger.log(LogLevel.Fatal, "main", undefined, err));
