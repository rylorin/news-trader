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
import { ConfigValidator } from "./config-validator";
import { ConfigurationError, TradingError } from "./errors";
import { HealthCheckService } from "./health-check";
import { gLogger, LogLevel } from "./logger";
import { TelegramCommandHandler } from "./telegram-command-handler";
import { LegType, legtypes, Trader } from "./trader";
import { formatObject, parseEvent, string2boolean } from "./utils";

export class MyTradingBotApp {
  private readonly config: IConfig;
  private readonly trader: Trader;
  private readonly telegram: Telegraf | undefined;
  private readonly commandHandler: TelegramCommandHandler | undefined;
  private readonly healthCheck: HealthCheckService;
  private timer: NodeJS.Timeout | undefined;
  private healthCheckTimer: NodeJS.Timeout | undefined;

  constructor(config: IConfig) {
    this.config = config;

    // Validate configuration before creating trader
    try {
      ConfigValidator.validate(config);
      gLogger.info(
        "MyTradingBotApp.constructor",
        "Configuration validation passed",
      );
    } catch (error) {
      if (error instanceof ConfigurationError) {
        gLogger.error(
          "MyTradingBotApp.constructor",
          `Configuration error: ${error.message}`,
        );
        throw error;
      } else {
        gLogger.error(
          "MyTradingBotApp.constructor",
          `Unexpected error during configuration validation: ${String(error)}`,
        );
        throw new ConfigurationError(
          "Configuration validation failed",
          undefined,
        );
      }
    }

    this.trader = new Trader(config);
    this.healthCheck = new HealthCheckService(this.trader);

    if (this.config.get("telegram.apiKey")) {
      this.commandHandler = new TelegramCommandHandler(this.trader);
      // Create telegram bot to control application
      this.telegram = new Telegraf(this.config.get("telegram.apiKey"));
      this.telegram.start(async (ctx) =>
        ctx.reply(`Welcome ${ctx.message.from.username}!`),
      );
      this.telegram.help(
        Telegraf.reply(`Available commands:
help - show this help text
whoami - show current discussion info
pause - pause or resume bot operation
status - show bot status
state - dump/load bot state
exit - exit (stop) bot
name - get/set strategy name
market - get/set market to trade
underlying - get/set underlying name
currency - get/set trading currency
price - get underlying price/level
event - get/set macro economic event to trade
delta - get/set legs strikes delta to underlying level
delay - get/set delay in mins at which trading will occurs related to event. <0 will trade before event, >0 will trade after event.
sampling - get/set frequency in secs used to check trading conditions
budget - get/set trading budget
stoplevel - get/set trailing stop loss in percents from entry price
trailingstoplevel - get/set trailing stop loss in percents from session highs
positions - display bot managed positions
close - close bot managed positions
account - display account balance
explain - explain strategy
`),
      );
      // Bot commands
      this.telegram.command("whoami", async (ctx) =>
        ctx.reply(formatObject(ctx.update)),
      );
      this.telegram.command("pause", async (ctx) =>
        this.commandHandler!.handlePauseCommand(ctx),
      );
      this.telegram.command("status", async (ctx) =>
        this.commandHandler!.handleStatusCommand(ctx),
      );
      this.telegram.command("state", async (ctx) =>
        this.handleStateCommand(ctx),
      );
      this.telegram.command("exit", async (ctx) => this.handleExitCommand(ctx));
      this.telegram.command("health", async (ctx) =>
        this.handleHealthCommand(ctx),
      );

      // Trader settings commands
      this.telegram.command("name", async (ctx) =>
        this.commandHandler!.handleNameCommand(ctx),
      );
      this.telegram.command("market", async (ctx) =>
        this.commandHandler!.handleMarketCommand(ctx),
      );
      this.telegram.command("underlying", async (ctx) =>
        this.commandHandler!.handleUnderlyingCommand(ctx),
      );
      this.telegram.command("currency", async (ctx) =>
        this.commandHandler!.handleCurrencyCommand(ctx),
      );
      this.telegram.command("price", async (ctx) =>
        this.commandHandler!.handlePriceCommand(ctx),
      );
      this.telegram.command("event", async (ctx) =>
        this.commandHandler!.handleEventCommand(ctx),
      );
      this.telegram.command("delta", async (ctx) =>
        this.commandHandler!.handleDeltaCommand(ctx),
      );
      this.telegram.command("delay", async (ctx) =>
        this.commandHandler!.handleDelayCommand(ctx),
      );
      this.telegram.command("sampling", async (ctx) =>
        this.commandHandler!.handleSamplingCommand(ctx),
      );
      this.telegram.command("stoplevel", async (ctx) =>
        this.commandHandler!.handleStopLevelCommand(ctx),
      );
      this.telegram.command("trailingstoplevel", async (ctx) =>
        this.commandHandler!.handleTrailingStopLevelCommand(ctx),
      );
      this.telegram.command("budget", async (ctx) =>
        this.commandHandler!.handleBudgetCommand(ctx),
      );
      this.telegram.command("positions", async (ctx) =>
        this.commandHandler!.handlePositionsCommand(ctx),
      );
      this.telegram.command("close", async (ctx) =>
        this.commandHandler!.handleCloseCommand(ctx),
      );
      this.telegram.command("account", async (ctx) =>
        this.commandHandler!.handleAccountCommand(ctx),
      );
      this.telegram.command("explain", async (ctx) =>
        this.commandHandler!.handleExplainCommand(ctx),
      );
      // Catch-alls
      this.telegram.on(message("sticker"), Telegraf.reply("👍"));
      this.telegram.hears(/\/(.+)/, async (ctx) => {
        const cmd = ctx.match[1];
        return ctx.reply(
          `command not found: '/${cmd}'. Type '/help' for help.`,
        );
      });
      this.telegram.hears(/(.+)/, async (ctx) =>
        ctx.reply(
          `Hello ${ctx.message.from.username}. What do you mean by '${ctx.text}'? 🧐`,
        ),
      );
    }
  }

  /**
   * Handle the 'health' command - show system health status
   */
  private async handleHealthCommand(
    ctx: Context<{
      message: Update.New & Update.NonChannel & Message.TextMessage;
      update_id: number;
    }> &
      Omit<Context<Update>, keyof Context<Update>> &
      CommandContextExtn,
  ): Promise<void> {
    gLogger.debug(
      "MyTradingBotApp.handleHealthCommand",
      "Handle 'health' command",
    );
    try {
      const healthReport = await this.healthCheck.performHealthCheck();
      const summary = `System Health: ${healthReport.status.toUpperCase()}
Uptime: ${Math.round(healthReport.uptime / 1000 / 60)} minutes
Checks: ${healthReport.checks.length}

${healthReport.checks
  .map((check) => `${check.name}: ${check.status} - ${check.message}`)
  .join("\n")}`;

      await ctx.reply(summary);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      gLogger.error("MyTradingBotApp.handleHealthCommand", errorMsg);
      await ctx.reply(`Health check failed: ${errorMsg}`);
    }
  }

  private async handleNameCommand(
    ctx: Context<{
      message: Update.New & Update.NonChannel & Message.TextMessage;
      update_id: number;
    }> &
      Omit<Context<Update>, keyof Context<Update>> &
      CommandContextExtn,
  ): Promise<void> {
    gLogger.debug("MyTradingBotApp.handleNameCommand", "Handle 'name' command");
    if (ctx.payload) {
      this.trader.name = ctx.payload.trim();
    }
    await ctx
      .reply(`/name ${this.trader.name}`)
      .catch((err: Error) =>
        gLogger.error("MyTradingBotApp.handleNameCommand", err.message),
      );
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

  private async handleExplainCommand(
    ctx: Context<{
      message: Update.New & Update.NonChannel & Message.TextMessage;
      update_id: number;
    }> &
      Omit<Context<Update>, keyof Context<Update>> &
      CommandContextExtn,
  ): Promise<void> {
    gLogger.debug(
      "MyTradingBotApp.handleExplainCommand",
      "Handle 'explain' command",
    );
    await ctx
      .reply(this.trader.explain())
      .catch((err: Error) =>
        gLogger.error("MyTradingBotApp.handleExplainCommand", err.message),
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

  private async handleDelayCommand(
    ctx: Context<{
      message: Update.New & Update.NonChannel & Message.TextMessage;
      update_id: number;
    }> &
      Omit<Context<Update>, keyof Context<Update>> &
      CommandContextExtn,
  ): Promise<void> {
    gLogger.debug(
      "MyTradingBotApp.handleDelayCommand",
      "Handle 'delay' command",
    );
    if (ctx.payload) {
      const arg = ctx.payload.trim().replaceAll("  ", " ");
      this.trader.delay = parseInt(arg);
    }
    await ctx
      .reply(`/delay ${this.trader.delay}`)
      .catch((err: Error) =>
        gLogger.error("MyTradingBotApp.handleDelayCommand", err.message),
      );
  }

  private async handleSamplingCommand(
    ctx: Context<{
      message: Update.New & Update.NonChannel & Message.TextMessage;
      update_id: number;
    }> &
      Omit<Context<Update>, keyof Context<Update>> &
      CommandContextExtn,
  ): Promise<void> {
    gLogger.debug(
      "MyTradingBotApp.handleSamplingCommand",
      "Handle 'sampling' command",
    );
    if (ctx.payload) {
      const arg = ctx.payload.trim();
      this.trader.sampling = parseInt(arg);
    }
    await ctx
      .reply(`/sampling ${this.trader.sampling}`)
      .catch((err: Error) =>
        gLogger.error("MyTradingBotApp.handleSamplingCommand", err.message),
      );
  }

  private async handleStopLevelCommand(
    ctx: Context<{
      message: Update.New & Update.NonChannel & Message.TextMessage;
      update_id: number;
    }> &
      Omit<Context<Update>, keyof Context<Update>> &
      CommandContextExtn,
  ): Promise<void> {
    gLogger.debug(
      "MyTradingBotApp.handleStopLevelCommand",
      "Handle 'stoplevel' command",
    );
    if (ctx.payload) {
      const arg = ctx.payload.trim();
      this.trader.stoplevel = parseFloat(arg);
    }
    await ctx
      .reply(`/stoplevel ${this.trader.stoplevel}`)
      .catch((err: Error) =>
        gLogger.error("MyTradingBotApp.handleStopLevelCommand", err.message),
      );
  }

  private async handleTrailingStopLevelCommand(
    ctx: Context<{
      message: Update.New & Update.NonChannel & Message.TextMessage;
      update_id: number;
    }> &
      Omit<Context<Update>, keyof Context<Update>> &
      CommandContextExtn,
  ): Promise<void> {
    gLogger.debug(
      "MyTradingBotApp.handleTrailingStopLevelCommand",
      "Handle 'trailingstoplevel' command",
    );
    if (ctx.payload) {
      const arg = ctx.payload.trim();
      this.trader.trailingStopLevel = parseFloat(arg);
    }
    await ctx
      .reply(`/trailingstoplevel ${this.trader.trailingStopLevel}`)
      .catch((err: Error) =>
        gLogger.error(
          "MyTradingBotApp.handleTrailingStopLevelCommand",
          err.message,
        ),
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
      .then(async (price) => ctx.reply(`Underlying price: ${price}`))
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
      const positions = await this.trader.getPositions();
      await Object.keys(positions).reduce(
        async (p, leg) =>
          p.then(async () => {
            const output = formatObject(positions[leg as LegType]);
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

  private async handleCloseCommand(
    ctx: Context<{
      message: Update.New & Update.NonChannel & Message.TextMessage;
      update_id: number;
    }> &
      Omit<Context<Update>, keyof Context<Update>> &
      CommandContextExtn,
  ): Promise<void> {
    gLogger.debug(
      "MyTradingBotApp.handleCloseCommand",
      "Handle 'close' command",
    );
    try {
      let legs: LegType[];
      if (ctx.payload) {
        const text = ctx.payload.trim().replaceAll("  ", " ");
        legs = text
          .split(" ")
          .map(
            (text) =>
              (text.charAt(0).toUpperCase() +
                text.slice(1).toLowerCase()) as LegType,
          );
      } else legs = legtypes;
      // console.log(legs);
      await legs.reduce(
        async (p, leg) =>
          p
            .then(async () => this.trader.closeLeg(leg, 1, true))
            .then(async (dealConfirmation) =>
              ctx.reply(
                `${leg}: ${dealConfirmation.direction} ${dealConfirmation.size} ${dealConfirmation.epic} ${dealConfirmation.dealStatus}`,
              ),
            )
            .then(() => undefined)
            .catch((err: Error) =>
              gLogger.error("MyTradingBotApp.handleCloseCommand", err.message),
            ),
        Promise.resolve(),
      );
    } catch (err) {
      console.error(err);
      gLogger.log(
        LogLevel.Error,
        "MyTradingBotApp.handleCloseCommand",
        undefined,
        err,
      );
    }
  }

  private async handleAccountCommand(
    ctx: Context<{
      message: Update.New & Update.NonChannel & Message.TextMessage;
      update_id: number;
    }> &
      Omit<Context<Update>, keyof Context<Update>> &
      CommandContextExtn,
  ): Promise<void> {
    gLogger.debug(
      "MyTradingBotApp.handleAccountCommand",
      "Handle 'account' command",
    );
    try {
      return this.trader
        .getAccount()
        .then(async (account) => ctx.reply(formatObject(account)))
        .then(() => undefined)
        .catch((err: Error) =>
          gLogger.error("MyTradingBotApp.handleAccountCommand", err.message),
        );
    } catch (err) {
      console.error(err);
      gLogger.log(
        LogLevel.Error,
        "MyTradingBotApp.handleAccountCommand",
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
        .reply(`/state ${formatObject(this.trader.globalStatus)}`)
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

    // Start periodic health checks
    this.healthCheckTimer = setInterval(() => {
      this.healthCheck.logHealthStatus().catch((err: Error) => {
        gLogger.error("MyTradingBotApp.healthCheck", err.message);
      });
    }, 300_000); // Every 5 minutes

    // Initial health check
    await this.healthCheck.logHealthStatus();

    await this.telegram?.launch(() => undefined); // WARNING: this call never returns
  }

  private async check(): Promise<void> {
    gLogger.trace("MyTradingBotApp.check");
    return this.trader.check();
  }

  public async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
    this.healthCheckTimer = undefined;
    return this.trader.stop();
  }

  public exit(signal?: string): void {
    this.stop().catch((error) => console.error(error));
    this.telegram?.stop(signal);
    process.exit();
  }
}

gLogger.debug("main", `NODE_ENV=${process.env["NODE_ENV"]}`);

try {
  const bot = new MyTradingBotApp(config);
  // Enable graceful stop
  process.once("SIGINT", () => bot.exit("SIGINT"));
  process.once("SIGTERM", () => bot.exit("SIGTERM"));
  bot.start().catch((err: Error) => {
    if (err instanceof TradingError) {
      gLogger.log(
        LogLevel.Fatal,
        "main",
        undefined,
        `Trading error: ${err.message}`,
      );
    } else {
      gLogger.log(LogLevel.Fatal, "main", undefined, err);
    }
  });
} catch (error) {
  if (error instanceof ConfigurationError) {
    gLogger.log(
      LogLevel.Fatal,
      "main",
      undefined,
      `Configuration error: ${error.message}`,
    );
  } else {
    gLogger.log(
      LogLevel.Fatal,
      "main",
      undefined,
      `Startup error: ${String(error)}`,
    );
  }
}
