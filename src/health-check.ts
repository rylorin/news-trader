import { Account } from "ig-trading-api";
import { gLogger } from "./logger";
import { Trader } from "./trader";

/**
 * Health check status levels
 */
export enum HealthStatus {
  HEALTHY = "healthy",
  DEGRADED = "degraded",
  UNHEALTHY = "unhealthy",
}

/**
 * Individual health check result
 */
export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  message: string;
  timestamp: number;
  duration?: number;
  details?: Record<string, any>;
}

/**
 * Overall system health report
 */
export interface HealthReport {
  status: HealthStatus;
  timestamp: number;
  checks: HealthCheckResult[];
  uptime: number;
  version: string;
}

/**
 * Health check service for monitoring system components
 */
export class HealthCheckService {
  private readonly startTime: number;
  private readonly version: string;

  constructor(
    private readonly trader: Trader,
    version = "0.0.1",
  ) {
    this.startTime = Date.now();
    this.version = version;
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck(): Promise<HealthReport> {
    const timestamp = Date.now();
    const checks: HealthCheckResult[] = [];

    // Run all health checks in parallel
    const checkPromises = [
      this.checkApiConnection(),
      this.checkTraderStatus(),
      this.checkAccountAccess(),
      this.checkSystemResources(),
    ];

    const results = await Promise.allSettled(checkPromises);

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        checks.push(result.value);
      } else {
        checks.push({
          name: `check_${index}`,
          status: HealthStatus.UNHEALTHY,
          message: `Health check failed: ${result.reason}`,
          timestamp,
        });
      }
    });

    // Determine overall status
    const overallStatus = this.determineOverallStatus(checks);

    return {
      status: overallStatus,
      timestamp,
      checks,
      uptime: timestamp - this.startTime,
      version: this.version,
    };
  }

  /**
   * Check API connection health
   */
  private async checkApiConnection(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const checkName = "api_connection";

    try {
      // Simple API call to test connectivity
      await this.trader.getAccount();

      const duration = Date.now() - startTime;
      return {
        name: checkName,
        status: duration < 5000 ? HealthStatus.HEALTHY : HealthStatus.DEGRADED,
        message:
          duration < 5000 ? "API connection healthy" : "API connection slow",
        timestamp: startTime,
        duration,
        details: { responseTimeMs: duration },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);

      return {
        name: checkName,
        status: HealthStatus.UNHEALTHY,
        message: `API connection failed: ${errorMsg}`,
        timestamp: startTime,
        duration,
        details: { error: errorMsg },
      };
    }
  }

  /**
   * Check trader status and configuration
   */
  private checkTraderStatus(): HealthCheckResult {
    const timestamp = Date.now();
    const checkName = "trader_status";

    try {
      const status = this.trader.status;
      const isPaused = this.trader.pause;
      const hasValidConfig = this.validateTraderConfig();

      let healthStatus = HealthStatus.HEALTHY;
      let message = "Trader status healthy";

      if (isPaused) {
        healthStatus = HealthStatus.DEGRADED;
        message = "Trader is paused";
      } else if (!hasValidConfig) {
        healthStatus = HealthStatus.UNHEALTHY;
        message = "Trader configuration invalid";
      }

      return {
        name: checkName,
        status: healthStatus,
        message,
        timestamp,
        details: {
          traderStatus: status,
          isPaused,
          hasValidConfig,
          budget: this.trader.budget,
          currency: this.trader.currency,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        name: checkName,
        status: HealthStatus.UNHEALTHY,
        message: `Trader status check failed: ${errorMsg}`,
        timestamp,
        details: { error: errorMsg },
      };
    }
  }

  /**
   * Check account access and balance
   */
  private async checkAccountAccess(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const checkName = "account_access";

    try {
      const account: Account = await this.trader.getAccount();
      const duration = Date.now() - startTime;

      // Check if account has sufficient balance
      const balance = account.balance?.available || 0;
      const requiredBalance = this.trader.budget * 2; // Safety margin

      let healthStatus = HealthStatus.HEALTHY;
      let message = "Account access healthy";

      if (balance < requiredBalance) {
        healthStatus = HealthStatus.DEGRADED;
        message = `Low account balance: ${balance} < ${requiredBalance}`;
      }

      return {
        name: checkName,
        status: healthStatus,
        message,
        timestamp: startTime,
        duration,
        details: {
          accountId: account.accountId,
          balance: account.balance,
          currency: account.currency,
          requiredBalance,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);

      return {
        name: checkName,
        status: HealthStatus.UNHEALTHY,
        message: `Account access failed: ${errorMsg}`,
        timestamp: startTime,
        duration,
        details: { error: errorMsg },
      };
    }
  }

  /**
   * Check system resources (memory, etc.)
   */
  private checkSystemResources(): HealthCheckResult {
    const timestamp = Date.now();
    const checkName = "system_resources";

    try {
      const memUsage = process.memoryUsage();
      const memUsageMB = {
        rss: Math.round(memUsage.rss / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024),
      };

      // Check memory usage thresholds
      let healthStatus = HealthStatus.HEALTHY;
      let message = "System resources healthy";

      if (memUsageMB.heapUsed > 500) {
        // 500MB threshold
        healthStatus = HealthStatus.DEGRADED;
        message = `High memory usage: ${memUsageMB.heapUsed}MB`;
      } else if (memUsageMB.heapUsed > 1000) {
        // 1GB threshold
        healthStatus = HealthStatus.UNHEALTHY;
        message = `Critical memory usage: ${memUsageMB.heapUsed}MB`;
      }

      return {
        name: checkName,
        status: healthStatus,
        message,
        timestamp,
        details: {
          memoryUsageMB: memUsageMB,
          uptime: process.uptime(),
          nodeVersion: process.version,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        name: checkName,
        status: HealthStatus.UNHEALTHY,
        message: `System resources check failed: ${errorMsg}`,
        timestamp,
        details: { error: errorMsg },
      };
    }
  }

  /**
   * Validate trader configuration
   */
  private validateTraderConfig(): boolean {
    try {
      return (
        this.trader.budget > 0 &&
        this.trader.delta > 0 &&
        this.trader.currency.length === 3 &&
        this.trader.stoplevel > 0 &&
        this.trader.stoplevel < 1 &&
        this.trader.trailingStopLevel > 0 &&
        this.trader.trailingStopLevel < 1
      );
    } catch {
      return false;
    }
  }

  /**
   * Determine overall system status from individual checks
   */
  private determineOverallStatus(checks: HealthCheckResult[]): HealthStatus {
    const hasUnhealthy = checks.some(
      (check) => check.status === HealthStatus.UNHEALTHY,
    );
    const hasDegraded = checks.some(
      (check) => check.status === HealthStatus.DEGRADED,
    );

    if (hasUnhealthy) {
      return HealthStatus.UNHEALTHY;
    } else if (hasDegraded) {
      return HealthStatus.DEGRADED;
    } else {
      return HealthStatus.HEALTHY;
    }
  }

  /**
   * Get a simple health status (for quick checks)
   */
  async getSimpleHealthStatus(): Promise<{
    status: HealthStatus;
    message: string;
  }> {
    try {
      const report = await this.performHealthCheck();
      return {
        status: report.status,
        message: `System is ${report.status}. ${report.checks.length} checks completed.`,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      gLogger.error("HealthCheckService.getSimpleHealthStatus", errorMsg);
      return {
        status: HealthStatus.UNHEALTHY,
        message: `Health check failed: ${errorMsg}`,
      };
    }
  }

  /**
   * Log health status to logger
   */
  async logHealthStatus(): Promise<void> {
    try {
      const report = await this.performHealthCheck();

      if (report.status === HealthStatus.HEALTHY) {
        gLogger.info("HealthCheckService", `System health: ${report.status}`);
      } else {
        gLogger.warn("HealthCheckService", `System health: ${report.status}`);

        // Log details of unhealthy checks
        report.checks
          .filter((check) => check.status !== HealthStatus.HEALTHY)
          .forEach((check) => {
            gLogger.warn(
              "HealthCheckService",
              `${check.name}: ${check.message}`,
            );
          });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      gLogger.error("HealthCheckService.logHealthStatus", errorMsg);
    }
  }
}
