/*
  MyTradingBotApp
*/

// Load env vars
import dotenv from "dotenv";
dotenv.config();

// Load config
import { default as config, IConfig } from "config";

// The following can relying on env var and config
import { Context, Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { Message, Update } from "telegraf/typings/core/types/typegram";
import { CommandContextExtn } from "telegraf/typings/telegram-types";
import { gLogger, LogLevel } from "./logger";
import { LegType, Trader } from "./trader";
import { formatObject, parseEvent, string2boolean } from "./utils";

export class MyTradingBotApp {
  private readonly config: IConfig;
  private readonly trader: Trader;
  private readonly telegram: Telegraf | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(config: IConfig) {
    this.config = config;

    this.trader = new Trader(config);

    if (this.config.get("telegram.apiKey")) {
      // Create telegram bot to control application
      this.telegram = new Telegraf(this.config.get("telegram.apiKey"));
      this.telegram.start((ctx) => ctx.reply("Welcome"));
      this.telegram.help((ctx) => ctx.reply("Send me a sticker"));
      this.telegram.on(message("sticker"), (ctx) => ctx.reply("👍"));
      // Bot commands
      this.telegram.command("exit", (ctx) => this.handleExitCommand(ctx));
      this.telegram.command("whoami", (ctx) =>
        ctx.reply(formatObject(ctx.update)),
      );
      // Trader settings commands
      this.telegram.command("pause", (ctx) => this.handlePauseCommand(ctx));
      this.telegram.command("market", (ctx) => this.handleMarketCommand(ctx));
      this.telegram.command("underlying", (ctx) =>
        this.handleUnderlyingCommand(ctx),
      );
      this.telegram.command("currency", (ctx) =>
        this.handleCurrencyCommand(ctx),
      );
      this.telegram.command("price", (ctx) => this.handlePriceCommand(ctx));
      this.telegram.command("event", (ctx) => this.handleEventCommand(ctx));
      this.telegram.command("delta", (ctx) => this.handleDeltaCommand(ctx));
      this.telegram.command("budget", (ctx) => this.handleBudgetCommand(ctx));
      this.telegram.command("status", (ctx) => this.handleStatusCommand(ctx));
      this.telegram.command("state", (ctx) => this.handleStateCommand(ctx));
      this.telegram.command("positions", (ctx) =>
        this.handlePositionsCommand(ctx),
      );
      // Catch-alls
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

  private async handleMarketCommand(
    ctx: Context<{
      message: Update.New & Update.NonChannel & Message.TextMessage;
      update_id: number;
    }> &
      Omit<Context<Update>, keyof Context<Update>> &
      CommandContextExtn,
  ): Promise<void> {
    gLogger.debug(
      "MyTradingBotApp.handleMarketCommand",
      "Handle 'market' command",
    );
    if (ctx.payload) {
      this.trader.market = ctx.payload.trim();
    }
    await ctx
      .reply(`/market ${this.trader.market}`)
      .catch((err: Error) =>
        gLogger.error("MyTradingBotApp.handleMarketCommand", err.message),
      );
  }

  private async handleUnderlyingCommand(
    ctx: Context<{
      message: Update.New & Update.NonChannel & Message.TextMessage;
      update_id: number;
    }> &
      Omit<Context<Update>, keyof Context<Update>> &
      CommandContextExtn,
  ): Promise<void> {
    gLogger.debug(
      "MyTradingBotApp.handleUnderlyingCommand",
      "Handle 'underlying' command",
    );
    if (ctx.payload) {
      this.trader.underlying = ctx.payload.trim();
    }
    await ctx
      .reply(`/market ${this.trader.underlying}`)
      .catch((err: Error) =>
        gLogger.error("MyTradingBotApp.handleUnderlyingCommand", err.message),
      );
  }

  private async handleCurrencyCommand(
    ctx: Context<{
      message: Update.New & Update.NonChannel & Message.TextMessage;
      update_id: number;
    }> &
      Omit<Context<Update>, keyof Context<Update>> &
      CommandContextExtn,
  ): Promise<void> {
    gLogger.debug(
      "MyTradingBotApp.handleCurrencyCommand",
      "Handle 'market' command",
    );
    if (ctx.payload) {
      this.trader.currency = ctx.payload.trim().toUpperCase();
    }
    await ctx
      .reply(`/currency ${this.trader.currency}`)
      .catch((err: Error) =>
        gLogger.error("MyTradingBotApp.handleCurrencyCommand", err.message),
      );
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
      .reply(this.trader.toString())
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
      this.trader.delta = parseInt(arg);
    }
    await ctx
      .reply(`/delta ${this.trader.delta}`)
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
      this.trader.budget = parseFloat(arg);
    }
    await ctx
      .reply(`/budget ${this.trader.budget}`)
      .catch((err: Error) =>
        gLogger.error("MyTradingBotApp.handleBudgetCommand", err.message),
      );
  }

  private async handlePriceCommand(
    ctx: Context<{
      message: Update.New & Update.NonChannel & Message.TextMessage;
      update_id: number;
    }> &
      Omit<Context<Update>, keyof Context<Update>> &
      CommandContextExtn,
  ): Promise<void> {
    gLogger.debug(
      "MyTradingBotApp.handlePriceCommand",
      "Handle 'price' command",
    );
    await this.trader
      .getUnderlyingPrice()
      .then((price) => ctx.reply(`Underlying price: ${price}`))
      .catch((err: Error) =>
        gLogger.error("MyTradingBotApp.handlePriceCommand", err.message),
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
      this.trader.pause = string2boolean(arg);
    }
    await ctx
      .reply(`/pause ${this.trader.pause ? "on" : "off"}`)
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
      const text = ctx.payload.trim().replaceAll("  ", " ");
      this.trader.nextEvent = parseEvent(text);
    }
    await ctx
      .reply(
        `/event ${this.trader.nextEvent ? new Date(this.trader.nextEvent).toISOString() : "undefined"}`,
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
      const positions = this.trader.getPositions();
      // console.log(positions);
      await Object.keys(positions).reduce(
        (p, leg) =>
          p.then(() => {
            // console.log(leg);
            const output = formatObject(positions[leg as LegType]);
            // console.log(output);
            return ctx
              .reply(leg + ": " + output)
              .then(() => undefined)
              .catch((err: Error) =>
                gLogger.error(
                  "MyTradingBotApp.handlePositionsCommand",
                  err.message,
                ),
              );
          }),
        Promise.resolve(),
      );
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

  private async handleStateCommand(
    ctx: Context<{
      message: Update.New & Update.NonChannel & Message.TextMessage;
      update_id: number;
    }> &
      Omit<Context<Update>, keyof Context<Update>> &
      CommandContextExtn,
  ): Promise<void> {
    gLogger.debug(
      "MyTradingBotApp.handleStateCommand",
      "Handle 'state' command",
    );
    try {
      if (ctx.payload) {
        this.trader.globalStatus = ctx.payload;
      }
      // console.log(ctx);
      await ctx
        .reply(
          "/" + ctx.command + " " + JSON.stringify(this.trader.globalStatus),
        )
        .catch((err: Error) =>
          gLogger.error("MyTradingBotApp.handleStateCommand", err.message),
        );
    } catch (error) {
      console.error(error);
      gLogger.error("MyTradingBotApp.handleStateCommand", formatObject(error));
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
    await this.trader.start();

    this.timer = setInterval(() => {
      this.check().catch((err: Error) => {
        console.log(err);
        gLogger.error("MyTradingBotApp.check", err.message);
      });
    }, 60_000);

    await this.telegram?.launch(); // WARNING: this call never returns
  }

  private async check(): Promise<void> {
    gLogger.trace("MyTradingBotApp.check");

    // if (!this.trader.nextEvent && !this.trader.status) {
    //   await fetch("https://www.investing.com/economic-calendar/")
    //     .then((response) => response.text())
    //     .then((text) => {console.log(text);
    //     });
    // }

    return this.trader.check();
  }

  public stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    return this.trader.stop();
  }

  public exit(signal?: string): void {
    this.stop().catch((error) => console.error(error));
    this.telegram?.stop(signal);
    process.exit();
  }
}

gLogger.debug("main", `NODE_ENV=${process.env["NODE_ENV"]}`);
const bot = new MyTradingBotApp(config);
// Enable graceful stop
process.once("SIGINT", () => bot.exit("SIGINT"));
process.once("SIGTERM", () => bot.exit("SIGTERM"));
bot
  .start()
  .catch((err: Error) => gLogger.log(LogLevel.Fatal, "main", undefined, err));
