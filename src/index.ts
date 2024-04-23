/*
  MyTradingBotApp
*/

// Load env vars
import dotenv from "dotenv";
dotenv.config();

// Load config
import { default as config, IConfig } from "config";

// The following can relying on env var and config
import { MarketNavigation } from "ig-trading-api";
import { Context, Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { Message, Update } from "telegraf/typings/core/types/typegram";
import { CommandContextExtn } from "telegraf/typings/telegram-types";
import { APIClient } from "./ig-trading-api";
import { gLogger, LogLevel } from "./logger";
import { string2boolean } from "./utils";

type OptionEntry = {
  strike: number;
  callPrice: number | undefined;
  putPrice: number | undefined;
};

export const StatusType = {
  Idle: "Idle",
  Entering: "Entering",
  Done: "Done",
} as const;
export type StatusType = (typeof StatusType)[keyof typeof StatusType];

/**
 * Trading bot implementation
 */
export class MyTradingBotApp {
  private readonly config: IConfig;
  private readonly api;
  private readonly telegram: Telegraf;
  private timer: NodeJS.Timeout | undefined;

  private pauseMode: boolean;
  private nextEvent: number | undefined;
  private delay: number;
  private status: StatusType;

  constructor(config: IConfig) {
    this.config = config;
    this.api = new APIClient(
      config.get("ig-api.url"),
      this.config.get(`ig-api.api-key`),
    );

    this.pauseMode = string2boolean(this.config.get("trader.pause"));
    this.status = StatusType.Idle;
    this.delay = this.config.get("trader.delay");

    // Create telegram bot to control application
    this.telegram = new Telegraf(this.config.get("telegram.apiKey"));
    this.telegram.start((ctx) => ctx.reply("Welcome"));
    this.telegram.help((ctx) => ctx.reply("Send me a sticker"));
    this.telegram.on(message("sticker"), (ctx) => ctx.reply("👍"));
    this.telegram.command("pause", (ctx) => this.handlePauseCommand(ctx));
    this.telegram.command("exit", (ctx) => this.handleExitCommand(ctx));
    this.telegram.command("event", (ctx) => this.handleEventCommand(ctx));
    this.telegram.command("whoami", (ctx) =>
      ctx.reply(JSON.stringify(ctx.update)),
    );
    this.telegram.hears(/\/(.+)/, (ctx) => {
      const cmd = ctx.match[1];
      return ctx.reply(`command not found: '/${cmd}'. Type '/help' for help.`);
    });
    this.telegram.hears(/(.+)/, (ctx) =>
      ctx.reply(
        `Hello ${ctx.message.from.username}. What do you mean by '${ctx.text}'? 🧐`,
      ),
    );
  }

  public async start(): Promise<void> {
    // console.log("connecting to IG");
    const session = await this.api.rest.login.createSession(
      this.config.get(`ig-api.username`),
      this.config.get(`ig-api.password`),
    );
    gLogger.info(
      "MyTradingBotApp.start",
      `IG client ID is "${session.clientId}".`,
    );
    gLogger.debug(
      "MyTradingBotApp.start",
      `IG client ID is "${session.clientId}".`,
      session,
    );

    this.timer = setInterval(
      () => {
        this.check().catch((err: Error) => {
          console.log(err);
          gLogger.error("MyTradingBotApp.check", err.message);
        });
      },
      (parseInt(session.oauthToken.expires_in) * 1000) / 2,
    );

    await this.telegram.launch(); // WARNING: this call never returns
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
      "MyTradingBotApp.handlePauseCommand",
      "Handle 'event' command",
    );
    if (ctx.payload) {
      const arg = ctx.payload.trim().replaceAll("  ", " ").toUpperCase();
      this.nextEvent = new Date(arg).getTime();
    }
    await ctx
      .reply(
        `Next event: ${this.nextEvent ? new Date(this.nextEvent).toISOString() : "undefined"}`,
      )
      .catch((err: Error) =>
        gLogger.error("MyTradingBotApp.handleTrader", err.message),
      );
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

  private async getDailyOptionsOf(market: string): Promise<MarketNavigation> {
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
    markets = await this.api.getMarketNavigation(todayOptionsId?.id);
    return markets;
  }

  private async getUnderlyingPrice() {
    const market = this.api.getMarket("IX.D.NASDAQ.OPTCALL.IP");
    console.log(market);
    const markets = this.api.getMarkets([
      "IX.D.NASDAQ.OPTCALL.IP",
      "IX.D.NASDAQ.OPTPUT.IP",
    ]);
    console.log(markets);
  }

  private findMiddle(options: MarketNavigation) {
    const optionsStrikes: Record<number, OptionEntry> = {};
    options.markets?.forEach((element) => {
      const strike = parseFloat(element.instrumentName.split(" ").at(-2)!);
      if (!optionsStrikes[strike])
        optionsStrikes[strike] = {
          strike,
          callPrice: undefined,
          putPrice: undefined,
        };
      const price =
        element.bid && element.offer ?
          (element.bid + element.offer) / 2
        : undefined;
      if (element.instrumentName.endsWith("PUT"))
        optionsStrikes[strike].putPrice = price;
      else if (element.instrumentName.endsWith("CALL"))
        optionsStrikes[strike].callPrice = price;
    });
    let lowerStrike: number | undefined;
    let upperStrike: number | undefined;
    const strikes: number[] = Object.keys(optionsStrikes).map((key) =>
      parseInt(key),
    );
    strikes.forEach((strike) => {
      if (
        !upperStrike &&
        optionsStrikes[strike].putPrice! > optionsStrikes[strike].callPrice!
      ) {
        upperStrike = strike;
      }
      if (!upperStrike) lowerStrike = strike;
    });
    console.log("findMiddle", lowerStrike, upperStrike);
  }

  private async check(): Promise<void> {
    gLogger.trace(
      "MyTradingBotApp.refreshTraders",
      this.pauseMode ? "paused" : "running",
    );
    if (this.pauseMode || !this.nextEvent) return;

    const now = Date.now();
    if (this.status == StatusType.Idle) {
      if (now > this.nextEvent - this.delay * 60_000) {
        console.log("timer done");
        this.status = StatusType.Entering;
        const options = await this.getDailyOptionsOf("Options (US Tech 100)");
        console.log(options);
        // this.findMiddle(options);
        this.getUnderlyingPrice();
      }
    }
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.api.rest.login.logout();
  }

  public exit(signal?: string): void {
    this.stop();
    this.telegram.stop(signal);
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
