import { Context } from "telegraf";
import { Message, Update } from "telegraf/typings/core/types/typegram";
import { CommandContextExtn } from "telegraf/typings/telegram-types";
import { ValidationError } from "./errors";
import { gLogger } from "./logger";
import { LegType, legtypes, Trader } from "./trader";
import { formatObject, parseEvent, string2boolean } from "./utils";

/**
 * Type definition for Telegram command context
 */
type TelegramContext = Context<{
  message: Update.New & Update.NonChannel & Message.TextMessage;
  update_id: number;
}> &
  Omit<Context<Update>, keyof Context<Update>> &
  CommandContextExtn;

/**
 * Handles all Telegram bot commands for the trading application
 */
export class TelegramCommandHandler {
  constructor(private readonly trader: Trader) {}

  /**
   * Handle the 'name' command - get/set strategy name
   */
  async handleNameCommand(ctx: TelegramContext): Promise<void> {
    gLogger.debug(
      "TelegramCommandHandler.handleNameCommand",
      "Handle 'name' command",
    );
    try {
      if (ctx.payload) {
        this.trader.name = ctx.payload.trim();
      }
      await ctx.reply(`/name ${this.trader.name}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      gLogger.error("TelegramCommandHandler.handleNameCommand", errorMsg);
      await ctx.reply(`Error: ${errorMsg}`);
    }
  }

  /**
   * Handle the 'market' command - get/set market to trade
   */
  async handleMarketCommand(ctx: TelegramContext): Promise<void> {
    gLogger.debug(
      "TelegramCommandHandler.handleMarketCommand",
      "Handle 'market' command",
    );
    try {
      if (ctx.payload) {
        this.trader.market = ctx.payload.trim();
      }
      await ctx.reply(`/market ${this.trader.market}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      gLogger.error("TelegramCommandHandler.handleMarketCommand", errorMsg);
      await ctx.reply(`Error: ${errorMsg}`);
    }
  }

  /**
   * Handle the 'underlying' command - get/set underlying name
   */
  async handleUnderlyingCommand(ctx: TelegramContext): Promise<void> {
    gLogger.debug(
      "TelegramCommandHandler.handleUnderlyingCommand",
      "Handle 'underlying' command",
    );
    try {
      if (ctx.payload) {
        this.trader.underlying = ctx.payload.trim();
      }
      await ctx.reply(`/underlying ${this.trader.underlying}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      gLogger.error("TelegramCommandHandler.handleUnderlyingCommand", errorMsg);
      await ctx.reply(`Error: ${errorMsg}`);
    }
  }

  /**
   * Handle the 'currency' command - get/set trading currency
   */
  async handleCurrencyCommand(ctx: TelegramContext): Promise<void> {
    gLogger.debug(
      "TelegramCommandHandler.handleCurrencyCommand",
      "Handle 'currency' command",
    );
    try {
      if (ctx.payload) {
        this.trader.currency = ctx.payload.trim().toUpperCase();
      }
      await ctx.reply(`/currency ${this.trader.currency}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      gLogger.error("TelegramCommandHandler.handleCurrencyCommand", errorMsg);
      await ctx.reply(`Error: ${errorMsg}`);
    }
  }

  /**
   * Handle the 'status' command - show bot status
   */
  async handleStatusCommand(ctx: TelegramContext): Promise<void> {
    gLogger.debug(
      "TelegramCommandHandler.handleStatusCommand",
      "Handle 'status' command",
    );
    try {
      await ctx.reply(this.trader.toString());
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      gLogger.error("TelegramCommandHandler.handleStatusCommand", errorMsg);
      await ctx.reply(`Error: ${errorMsg}`);
    }
  }

  /**
   * Handle the 'explain' command - explain strategy
   */
  async handleExplainCommand(ctx: TelegramContext): Promise<void> {
    gLogger.debug(
      "TelegramCommandHandler.handleExplainCommand",
      "Handle 'explain' command",
    );
    try {
      await ctx.reply(this.trader.explain());
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      gLogger.error("TelegramCommandHandler.handleExplainCommand", errorMsg);
      await ctx.reply(`Error: ${errorMsg}`);
    }
  }

  /**
   * Handle the 'delta' command - get/set legs strikes delta
   */
  async handleDeltaCommand(ctx: TelegramContext): Promise<void> {
    gLogger.debug(
      "TelegramCommandHandler.handleDeltaCommand",
      "Handle 'delta' command",
    );
    try {
      if (ctx.payload) {
        const arg = ctx.payload.trim().replaceAll("  ", " ");
        const value = parseInt(arg);
        if (isNaN(value)) {
          throw new ValidationError("Delta must be a valid number", "delta");
        }
        this.trader.delta = value;
      }
      await ctx.reply(`/delta ${this.trader.delta}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      gLogger.error("TelegramCommandHandler.handleDeltaCommand", errorMsg);
      await ctx.reply(`Error: ${errorMsg}`);
    }
  }

  /**
   * Handle the 'delay' command - get/set delay in minutes
   */
  async handleDelayCommand(ctx: TelegramContext): Promise<void> {
    gLogger.debug(
      "TelegramCommandHandler.handleDelayCommand",
      "Handle 'delay' command",
    );
    try {
      if (ctx.payload) {
        const arg = ctx.payload.trim().replaceAll("  ", " ");
        const value = parseInt(arg);
        if (isNaN(value)) {
          throw new ValidationError("Delay must be a valid number", "delay");
        }
        this.trader.delay = value;
      }
      await ctx.reply(`/delay ${this.trader.delay}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      gLogger.error("TelegramCommandHandler.handleDelayCommand", errorMsg);
      await ctx.reply(`Error: ${errorMsg}`);
    }
  }

  /**
   * Handle the 'sampling' command - get/set frequency in seconds
   */
  async handleSamplingCommand(ctx: TelegramContext): Promise<void> {
    gLogger.debug(
      "TelegramCommandHandler.handleSamplingCommand",
      "Handle 'sampling' command",
    );
    try {
      if (ctx.payload) {
        const arg = ctx.payload.trim();
        const value = parseInt(arg);
        if (isNaN(value)) {
          throw new ValidationError(
            "Sampling must be a valid number",
            "sampling",
          );
        }
        this.trader.sampling = value;
      }
      await ctx.reply(`/sampling ${this.trader.sampling}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      gLogger.error("TelegramCommandHandler.handleSamplingCommand", errorMsg);
      await ctx.reply(`Error: ${errorMsg}`);
    }
  }

  /**
   * Handle the 'stoplevel' command - get/set stop loss level
   */
  async handleStopLevelCommand(ctx: TelegramContext): Promise<void> {
    gLogger.debug(
      "TelegramCommandHandler.handleStopLevelCommand",
      "Handle 'stoplevel' command",
    );
    try {
      if (ctx.payload) {
        const arg = ctx.payload.trim();
        const value = parseFloat(arg);
        if (isNaN(value)) {
          throw new ValidationError(
            "Stop level must be a valid number",
            "stoplevel",
          );
        }
        this.trader.stoplevel = value;
      }
      await ctx.reply(`/stoplevel ${this.trader.stoplevel}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      gLogger.error("TelegramCommandHandler.handleStopLevelCommand", errorMsg);
      await ctx.reply(`Error: ${errorMsg}`);
    }
  }

  /**
   * Handle the 'trailingstoplevel' command - get/set trailing stop level
   */
  async handleTrailingStopLevelCommand(ctx: TelegramContext): Promise<void> {
    gLogger.debug(
      "TelegramCommandHandler.handleTrailingStopLevelCommand",
      "Handle 'trailingstoplevel' command",
    );
    try {
      if (ctx.payload) {
        const arg = ctx.payload.trim();
        const value = parseFloat(arg);
        if (isNaN(value)) {
          throw new ValidationError(
            "Trailing stop level must be a valid number",
            "trailingstoplevel",
          );
        }
        this.trader.trailingStopLevel = value;
      }
      await ctx.reply(`/trailingstoplevel ${this.trader.trailingStopLevel}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      gLogger.error(
        "TelegramCommandHandler.handleTrailingStopLevelCommand",
        errorMsg,
      );
      await ctx.reply(`Error: ${errorMsg}`);
    }
  }

  /**
   * Handle the 'budget' command - get/set trading budget
   */
  async handleBudgetCommand(ctx: TelegramContext): Promise<void> {
    gLogger.debug(
      "TelegramCommandHandler.handleBudgetCommand",
      "Handle 'budget' command",
    );
    try {
      if (ctx.payload) {
        const arg = ctx.payload.trim().replaceAll(" ", "");
        const value = parseFloat(arg);
        if (isNaN(value)) {
          throw new ValidationError("Budget must be a valid number", "budget");
        }
        this.trader.budget = value;
      }
      await ctx.reply(`/budget ${this.trader.budget}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      gLogger.error("TelegramCommandHandler.handleBudgetCommand", errorMsg);
      await ctx.reply(`Error: ${errorMsg}`);
    }
  }

  /**
   * Handle the 'price' command - get underlying price
   */
  async handlePriceCommand(ctx: TelegramContext): Promise<void> {
    gLogger.debug(
      "TelegramCommandHandler.handlePriceCommand",
      "Handle 'price' command",
    );
    try {
      const price = await this.trader.getUnderlyingPrice();
      await ctx.reply(`Underlying price: ${price}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      gLogger.error("TelegramCommandHandler.handlePriceCommand", errorMsg);
      await ctx.reply(`Error getting price: ${errorMsg}`);
    }
  }

  /**
   * Handle the 'pause' command - pause or resume bot operation
   */
  async handlePauseCommand(ctx: TelegramContext): Promise<void> {
    gLogger.debug(
      "TelegramCommandHandler.handlePauseCommand",
      "Handle 'pause' command",
    );
    try {
      if (ctx.payload) {
        const arg = ctx.payload.trim().replaceAll("  ", " ").toUpperCase();
        this.trader.pause = string2boolean(arg);
      }
      await ctx.reply(`/pause ${this.trader.pause ? "on" : "off"}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      gLogger.error("TelegramCommandHandler.handlePauseCommand", errorMsg);
      await ctx.reply(`Error: ${errorMsg}`);
    }
  }

  /**
   * Handle the 'event' command - get/set macro economic event
   */
  async handleEventCommand(ctx: TelegramContext): Promise<void> {
    gLogger.debug(
      "TelegramCommandHandler.handleEventCommand",
      "Handle 'event' command",
    );
    try {
      if (ctx.payload) {
        const text = ctx.payload.trim().replaceAll("  ", " ");
        this.trader.nextEvent = parseEvent(text);
      }
      const eventText =
        this.trader.nextEvent ?
          new Date(this.trader.nextEvent).toISOString()
        : "undefined";
      await ctx.reply(`/event ${eventText}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      gLogger.error("TelegramCommandHandler.handleEventCommand", errorMsg);
      await ctx.reply(`Error: ${errorMsg}`);
    }
  }

  /**
   * Handle the 'positions' command - display bot managed positions
   */
  async handlePositionsCommand(ctx: TelegramContext): Promise<void> {
    gLogger.debug(
      "TelegramCommandHandler.handlePositionsCommand",
      "Handle 'positions' command",
    );
    try {
      const positions = await this.trader.getPositions();
      for (const leg of Object.keys(positions) as LegType[]) {
        const output = formatObject(positions[leg]);
        await ctx.reply(`${leg}: ${output}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      gLogger.error("TelegramCommandHandler.handlePositionsCommand", errorMsg);
      await ctx.reply(`Error getting positions: ${errorMsg}`);
    }
  }

  /**
   * Handle the 'close' command - close bot managed positions
   */
  async handleCloseCommand(ctx: TelegramContext): Promise<void> {
    gLogger.debug(
      "TelegramCommandHandler.handleCloseCommand",
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
      } else {
        legs = legtypes;
      }

      for (const leg of legs) {
        try {
          const dealConfirmation = await this.trader.closeLeg(leg, 1, true);
          await ctx.reply(
            `${leg}: ${dealConfirmation.direction} ${dealConfirmation.size} ${dealConfirmation.epic} ${dealConfirmation.dealStatus}`,
          );
        } catch (legError) {
          const errorMsg =
            legError instanceof Error ? legError.message : String(legError);
          await ctx.reply(`${leg}: Error - ${errorMsg}`);
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      gLogger.error("TelegramCommandHandler.handleCloseCommand", errorMsg);
      await ctx.reply(`Error closing positions: ${errorMsg}`);
    }
  }

  /**
   * Handle the 'account' command - display account balance
   */
  async handleAccountCommand(ctx: TelegramContext): Promise<void> {
    gLogger.debug(
      "TelegramCommandHandler.handleAccountCommand",
      "Handle 'account' command",
    );
    try {
      const account = await this.trader.getAccount();
      await ctx.reply(formatObject(account));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      gLogger.error("TelegramCommandHandler.handleAccountCommand", errorMsg);
      await ctx.reply(`Error getting account: ${errorMsg}`);
    }
  }

  /**
   * Handle the 'state' command - dump/load bot state
   */
  async handleStateCommand(ctx: TelegramContext): Promise<void> {
    gLogger.debug(
      "TelegramCommandHandler.handleStateCommand",
      "Handle 'state' command",
    );
    try {
      if (ctx.payload) {
        this.trader.globalStatus = ctx.payload;
      }
      await ctx.reply(`/state ${formatObject(this.trader.globalStatus)}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      gLogger.error("TelegramCommandHandler.handleStateCommand", errorMsg);
      await ctx.reply(`Error: ${errorMsg}`);
    }
  }
}
