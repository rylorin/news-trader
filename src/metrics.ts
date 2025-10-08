import { gLogger } from "./logger";

/**
 * Metric types for different kinds of measurements
 */
export enum MetricType {
  COUNTER = "counter",
  GAUGE = "gauge",
  HISTOGRAM = "histogram",
  TIMER = "timer",
}

/**
 * Individual metric data point
 */
export interface MetricPoint {
  name: string;
  type: MetricType;
  value: number;
  timestamp: number;
  tags?: Record<string, string>;
}

/**
 * Aggregated metric statistics
 */
export interface MetricStats {
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  last: number;
}

/**
 * Metrics collection and reporting system
 */
export class MetricsCollector {
  private metrics: Map<string, MetricPoint[]> = new Map();
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private timers: Map<string, number[]> = new Map();

  /**
   * Increment a counter metric
   */
  incrementCounter(
    name: string,
    value = 1,
    tags?: Record<string, string>,
  ): void {
    const key = this.getMetricKey(name, tags);
    const currentValue = this.counters.get(key) || 0;
    this.counters.set(key, currentValue + value);

    this.recordMetric({
      name,
      type: MetricType.COUNTER,
      value: currentValue + value,
      timestamp: Date.now(),
      tags,
    });
  }

  /**
   * Set a gauge metric value
   */
  setGauge(name: string, value: number, tags?: Record<string, string>): void {
    const key = this.getMetricKey(name, tags);
    this.gauges.set(key, value);

    this.recordMetric({
      name,
      type: MetricType.GAUGE,
      value,
      timestamp: Date.now(),
      tags,
    });
  }

  /**
   * Record a histogram value
   */
  recordHistogram(
    name: string,
    value: number,
    tags?: Record<string, string>,
  ): void {
    this.recordMetric({
      name,
      type: MetricType.HISTOGRAM,
      value,
      timestamp: Date.now(),
      tags,
    });
  }

  /**
   * Start a timer and return a function to stop it
   */
  startTimer(name: string, tags?: Record<string, string>): () => void {
    const startTime = Date.now();

    return () => {
      const duration = Date.now() - startTime;
      const key = this.getMetricKey(name, tags);

      if (!this.timers.has(key)) {
        this.timers.set(key, []);
      }
      this.timers.get(key)!.push(duration);

      this.recordMetric({
        name,
        type: MetricType.TIMER,
        value: duration,
        timestamp: Date.now(),
        tags,
      });
    };
  }

  /**
   * Record a timing measurement
   */
  recordTiming(
    name: string,
    duration: number,
    tags?: Record<string, string>,
  ): void {
    const key = this.getMetricKey(name, tags);

    if (!this.timers.has(key)) {
      this.timers.set(key, []);
    }
    this.timers.get(key)!.push(duration);

    this.recordMetric({
      name,
      type: MetricType.TIMER,
      value: duration,
      timestamp: Date.now(),
      tags,
    });
  }

  /**
   * Get statistics for a metric
   */
  getMetricStats(
    name: string,
    tags?: Record<string, string>,
  ): MetricStats | undefined {
    const key = this.getMetricKey(name, tags);
    const points = this.metrics.get(key);

    if (!points || points.length === 0) {
      return undefined;
    }

    const values = points.map((p) => p.value);
    const sum = values.reduce((a, b) => a + b, 0);

    return {
      count: values.length,
      sum,
      min: Math.min(...values),
      max: Math.max(...values),
      avg: sum / values.length,
      last: values[values.length - 1],
    };
  }

  /**
   * Get all current counter values
   */
  getCounters(): Record<string, number> {
    return Object.fromEntries(this.counters);
  }

  /**
   * Get all current gauge values
   */
  getGauges(): Record<string, number> {
    return Object.fromEntries(this.gauges);
  }

  /**
   * Get timer statistics
   */
  getTimerStats(): Record<string, MetricStats> {
    const stats: Record<string, MetricStats> = {};

    for (const [key, values] of this.timers) {
      if (values.length > 0) {
        const sum = values.reduce((a, b) => a + b, 0);
        stats[key] = {
          count: values.length,
          sum,
          min: Math.min(...values),
          max: Math.max(...values),
          avg: sum / values.length,
          last: values[values.length - 1],
        };
      }
    }

    return stats;
  }

  /**
   * Get all metrics for a time range
   */
  getMetricsInRange(startTime: number, endTime: number): MetricPoint[] {
    const allMetrics: MetricPoint[] = [];

    for (const points of this.metrics.values()) {
      allMetrics.push(
        ...points.filter(
          (p) => p.timestamp >= startTime && p.timestamp <= endTime,
        ),
      );
    }

    return allMetrics.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Clear old metrics to prevent memory leaks
   */
  clearOldMetrics(olderThanMs: number = 24 * 60 * 60 * 1000): void {
    const cutoffTime = Date.now() - olderThanMs;

    for (const [key, points] of this.metrics) {
      const filteredPoints = points.filter((p) => p.timestamp > cutoffTime);
      if (filteredPoints.length === 0) {
        this.metrics.delete(key);
      } else {
        this.metrics.set(key, filteredPoints);
      }
    }

    // Clear old timer data
    for (const [key, values] of this.timers) {
      if (values.length > 1000) {
        // Keep only last 1000 measurements
        this.timers.set(key, values.slice(-1000));
      }
    }
  }

  /**
   * Export metrics in Prometheus format
   */
  exportPrometheusFormat(): string {
    const lines: string[] = [];

    // Export counters
    for (const [key, value] of this.counters) {
      lines.push(`# TYPE ${key} counter`);
      lines.push(`${key} ${value}`);
    }

    // Export gauges
    for (const [key, value] of this.gauges) {
      lines.push(`# TYPE ${key} gauge`);
      lines.push(`${key} ${value}`);
    }

    // Export timer histograms
    for (const [key, stats] of Object.entries(this.getTimerStats())) {
      lines.push(`# TYPE ${key} histogram`);
      lines.push(`${key}_count ${stats.count}`);
      lines.push(`${key}_sum ${stats.sum}`);
      lines.push(`${key}_min ${stats.min}`);
      lines.push(`${key}_max ${stats.max}`);
      lines.push(`${key}_avg ${stats.avg}`);
    }

    return lines.join("\n");
  }

  /**
   * Log current metrics summary
   */
  logMetricsSummary(): void {
    const counters = this.getCounters();
    const gauges = this.getGauges();
    const timers = this.getTimerStats();

    if (Object.keys(counters).length > 0) {
      gLogger.info("MetricsCollector", `Counters: ${JSON.stringify(counters)}`);
    }

    if (Object.keys(gauges).length > 0) {
      gLogger.info("MetricsCollector", `Gauges: ${JSON.stringify(gauges)}`);
    }

    if (Object.keys(timers).length > 0) {
      const timerSummary = Object.entries(timers).reduce(
        (acc, [key, stats]) => {
          acc[key] = `${stats.avg.toFixed(2)}ms avg (${stats.count} calls)`;
          return acc;
        },
        {} as Record<string, string>,
      );
      gLogger.info(
        "MetricsCollector",
        `Timers: ${JSON.stringify(timerSummary)}`,
      );
    }
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics.clear();
    this.counters.clear();
    this.gauges.clear();
    this.timers.clear();
  }

  /**
   * Record a metric point
   */
  private recordMetric(point: MetricPoint): void {
    const key = this.getMetricKey(point.name, point.tags);

    if (!this.metrics.has(key)) {
      this.metrics.set(key, []);
    }

    this.metrics.get(key)!.push(point);

    // Keep only last 1000 points per metric to prevent memory leaks
    const points = this.metrics.get(key)!;
    if (points.length > 1000) {
      this.metrics.set(key, points.slice(-1000));
    }
  }

  /**
   * Generate a unique key for a metric with tags
   */
  private getMetricKey(name: string, tags?: Record<string, string>): string {
    if (!tags || Object.keys(tags).length === 0) {
      return name;
    }

    const tagString = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join(",");

    return `${name}{${tagString}}`;
  }
}

// Global metrics collector instance
export const metrics = new MetricsCollector();

// Trading-specific metric helpers
export const TradingMetrics = {
  // API call metrics
  recordApiCall: (endpoint: string, success: boolean, duration: number) => {
    metrics.incrementCounter("api_calls_total", 1, {
      endpoint,
      status: success ? "success" : "error",
    });
    metrics.recordTiming("api_call_duration", duration, { endpoint });
  },

  // Trading operation metrics
  recordTrade: (
    type: "buy" | "sell",
    leg: string,
    size: number,
    price: number,
  ) => {
    metrics.incrementCounter("trades_total", 1, { type, leg });
    metrics.recordHistogram("trade_size", size, { type, leg });
    metrics.recordHistogram("trade_price", price, { type, leg });
  },

  // Position metrics
  updatePositionCount: (count: number) => {
    metrics.setGauge("open_positions", count);
  },

  updateAccountBalance: (balance: number, currency: string) => {
    metrics.setGauge("account_balance", balance, { currency });
  },

  // Error metrics
  recordError: (type: string, component: string) => {
    metrics.incrementCounter("errors_total", 1, { type, component });
  },

  // Health check metrics
  recordHealthCheck: (status: string, duration: number) => {
    metrics.incrementCounter("health_checks_total", 1, { status });
    metrics.recordTiming("health_check_duration", duration);
  },
};
