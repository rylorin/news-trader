import { ApiError } from "./errors";
import { gLogger } from "./logger";

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors?: string[];
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: [
    "ECONNRESET",
    "ENOTFOUND",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "error.security.oauth-token-invalid",
    "error.security.client-token-missing",
  ],
};

/**
 * Helper class for implementing retry logic with exponential backoff
 */
export class RetryHelper {
  /**
   * Execute an operation with retry logic and exponential backoff
   */
  static async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    config: Partial<RetryConfig> = {},
  ): Promise<T> {
    const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
    let lastError: Error | undefined = undefined;

    for (let attempt = 0; attempt <= finalConfig.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          gLogger.debug(
            "RetryHelper.withRetry",
            `Retry attempt ${attempt}/${finalConfig.maxRetries} for ${operationName}`,
          );
        }

        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on the last attempt
        if (attempt === finalConfig.maxRetries) {
          break;
        }

        // Check if error is retryable
        if (!this.isRetryableError(lastError, finalConfig.retryableErrors)) {
          gLogger.debug(
            "RetryHelper.withRetry",
            `Non-retryable error for ${operationName}: ${lastError.message}`,
          );
          break;
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
          finalConfig.baseDelayMs *
            Math.pow(finalConfig.backoffMultiplier, attempt),
          finalConfig.maxDelayMs,
        );

        gLogger.debug(
          "RetryHelper.withRetry",
          `${operationName} failed (attempt ${attempt + 1}/${finalConfig.maxRetries + 1}): ${lastError.message}. Retrying in ${delay}ms`,
        );

        await this.delay(delay);
      }
    }

    // All retries exhausted
    const finalError = lastError || new Error("Unknown error");
    gLogger.error(
      "RetryHelper.withRetry",
      `${operationName} failed after ${finalConfig.maxRetries + 1} attempts: ${finalError.message}`,
    );

    throw new ApiError(
      `${operationName} failed after ${finalConfig.maxRetries + 1} attempts`,
      undefined,
      finalError,
    );
  }

  /**
   * Check if an error is retryable based on error message or code
   */
  private static isRetryableError(
    error: Error,
    retryableErrors?: string[],
  ): boolean {
    if (!retryableErrors || retryableErrors.length === 0) {
      return true; // Retry all errors if no specific list provided
    }

    const errorMessage = error.message.toLowerCase();
    const errorCode = (error as any).code;

    return retryableErrors.some((retryableError) => {
      const lowerRetryable = retryableError.toLowerCase();
      return (
        errorMessage.includes(lowerRetryable) ||
        errorCode === retryableError ||
        (error as any).response?.data?.errorCode === retryableError
      );
    });
  }

  /**
   * Simple delay utility
   */
  private static async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Create a retry wrapper for a function
   */
  static createRetryWrapper<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    operationName: string,
    config: Partial<RetryConfig> = {},
  ): T {
    return (async (...args: Parameters<T>) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return this.withRetry(async () => fn(...args), operationName, config);
    }) as T;
  }

  /**
   * Calculate jittered delay to avoid thundering herd problem
   */
  static calculateJitteredDelay(baseDelay: number, jitterFactor = 0.1): number {
    const jitter = baseDelay * jitterFactor * Math.random();
    return Math.floor(baseDelay + jitter);
  }
}
