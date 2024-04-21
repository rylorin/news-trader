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
import { APIClient } from "./ig-trading-api";
import { gLogger, LogLevel } from "./logger";
import { string2boolean } from "./utils";

/**
 * Trading bot implementation
 */
export class MyTradingBotApp {
  private readonly config: IConfig;
  private readonly api;
  private readonly telegram: Telegraf;
  private timer: NodeJS.Timeout | undefined;
  private drainMode: boolean;
  private pauseMode: boolean;

  constructor(config: IConfig) {
    this.config = config;
    this.api = new APIClient(
      this.config.get("ig-api.demo") ? APIClient.URL_DEMO : APIClient.URL_LIVE,
      this.config.get("ig-api.demo") ?
        this.config.get("ig-api.demo.api-key")
      : this.config.get("ig-api.live.api-key"),
    );
    this.drainMode = string2boolean(this.config.get("bot.drain"));
    this.pauseMode = string2boolean(this.config.get("bot.pause"));

    // Create telegram bot to control application
    this.telegram = new Telegraf(this.config.get("telegram.apiKey"));
    this.telegram.start((ctx) => ctx.reply("Welcome"));
    this.telegram.help((ctx) => ctx.reply("Send me a sticker"));
    this.telegram.on(message("sticker"), (ctx) => ctx.reply("👍"));
    this.telegram.command("pause", (ctx) => this.handlePauseCommand(ctx));
    this.telegram.command("exit", (ctx) => this.handleExitCommand(ctx));
    // this.telegram.command("stop", () => this.exit());
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
      this.config.get("ig-api.demo") ?
        this.config.get("ig-api.demo.username")
      : this.config.get("ig-api.live.username"),
      this.config.get("ig-api.demo") ?
        this.config.get("ig-api.demo.password")
      : this.config.get("ig-api.live.username"),
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

  private async check(): Promise<void> {
    gLogger.trace(
      "MyTradingBotApp.refreshTraders",
      this.pauseMode ? "paused" : "running",
    );
    if (this.pauseMode) return;

    const accounts = await this.api.getAccounts();
    console.log(accounts);
    const markets = await this.api.getMarketNavigation();
    console.log(markets);
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
