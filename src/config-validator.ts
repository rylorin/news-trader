import { IConfig } from "config";
import { ConfigurationError } from "./errors";

/**
 * Configuration validator for trading bot
 */
export class ConfigValidator {
  private static readonly REQUIRED_KEYS = [
    "ig-api.url",
    "ig-api.api-key",
    "ig-api.username",
    "ig-api.password",
    "trader.market",
    "trader.underlying",
    "trader.currency",
    "trader.delta",
    "trader.budget",
    "trader.delay",
    "trader.sampling",
    "trader.stopLevel",
    "trader.trailingStopLevel",
  ];

  private static readonly NUMERIC_KEYS = [
    "trader.delta",
    "trader.budget",
    "trader.delay",
    "trader.sampling",
    "trader.stopLevel",
    "trader.trailingStopLevel",
  ];

  /**
   * Validate all required configuration keys are present and valid
   */
  public static validate(config: IConfig): void {
    // Check required keys exist
    for (const key of this.REQUIRED_KEYS) {
      if (!config.has(key)) {
        throw new ConfigurationError(
          `Missing required configuration: ${key}`,
          key,
        );
      }
    }

    // Validate specific values
    this.validateTradingParameters(config);
    this.validateApiConfiguration(config);
  }

  /**
   * Validate trading parameters are within safe ranges
   */
  private static validateTradingParameters(config: IConfig): void {
    const budget = config.get("trader.budget") as number;
    if (budget <= 0) {
      throw new ConfigurationError("Budget must be positive", "trader.budget");
    }
    if (budget > 10000) {
      throw new ConfigurationError(
        "Budget exceeds safety limit of 10,000",
        "trader.budget",
      );
    }

    const delta = config.get("trader.delta") as number;
    if (delta <= 0) {
      throw new ConfigurationError("Delta must be positive", "trader.delta");
    }
    if (delta > 1000) {
      throw new ConfigurationError(
        "Delta exceeds reasonable limit of 1,000",
        "trader.delta",
      );
    }

    const stopLevel = config.get("trader.stopLevel") as number;
    if (stopLevel <= 0 || stopLevel >= 1) {
      throw new ConfigurationError(
        "Stop level must be between 0 and 1",
        "trader.stopLevel",
      );
    }

    const trailingStopLevel = config.get("trader.trailingStopLevel") as number;
    if (trailingStopLevel <= 0 || trailingStopLevel >= 1) {
      throw new ConfigurationError(
        "Trailing stop level must be between 0 and 1",
        "trader.trailingStopLevel",
      );
    }

    const sampling = config.get("trader.sampling") as number;
    if (sampling < 1) {
      throw new ConfigurationError(
        "Sampling interval must be at least 1 second",
        "trader.sampling",
      );
    }
    if (sampling > 3600) {
      throw new ConfigurationError(
        "Sampling interval exceeds 1 hour limit",
        "trader.sampling",
      );
    }

    // Validate currency is a valid 3-letter code
    const currency = config.get("trader.currency") as string;
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new ConfigurationError(
        "Currency must be a 3-letter code (e.g., USD, EUR)",
        "trader.currency",
      );
    }
  }

  /**
   * Validate API configuration
   */
  private static validateApiConfiguration(config: IConfig): void {
    const apiUrl = config.get("ig-api.url") as string;
    if (!apiUrl.startsWith("https://")) {
      throw new ConfigurationError("API URL must use HTTPS", "ig-api.url");
    }

    const apiKey = config.get("ig-api.api-key") as string;
    if (apiKey === "provide a valid IG API key" || apiKey.length < 10) {
      throw new ConfigurationError(
        "Invalid or placeholder API key",
        "ig-api.api-key",
      );
    }

    const username = config.get("ig-api.username") as string;
    if (username === "replace with your username" || username.length < 3) {
      throw new ConfigurationError(
        "Invalid or placeholder username",
        "ig-api.username",
      );
    }

    const password = config.get("ig-api.password") as string;
    if (password === "replace with your password" || password.length < 6) {
      throw new ConfigurationError(
        "Invalid or placeholder password",
        "ig-api.password",
      );
    }
  }

  /**
   * Validate numeric configuration values
   */
  public static validateNumericConfig(config: IConfig): void {
    for (const key of this.NUMERIC_KEYS) {
      const value = config.get(key);
      if (typeof value !== "number" || isNaN(value)) {
        throw new ConfigurationError(
          `Configuration ${key} must be a valid number`,
          key,
        );
      }
    }
  }
}
