/**
 * Custom error classes for trading operations
 */

export class TradingError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "TradingError";
    if (cause) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

export class ValidationError extends TradingError {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export class ConfigurationError extends TradingError {
  constructor(
    message: string,
    public readonly configKey?: string,
  ) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export class ApiError extends TradingError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    cause?: Error,
  ) {
    super(message, cause);
    this.name = "ApiError";
  }
}
