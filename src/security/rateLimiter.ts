/**
 * DG Domain Core - Abuse Prevention & Rate Limiter
 * Copyright (c) 2026 Deep Group
 *
 * Implements an in-memory sliding window rate limiter to prevent
 * domain squatting brute-force scripts and denial of service.
 */

interface RateLimitRecord {
  timestamps: number[];
}

export class RateLimiter {
  private windowMs: number;
  private maxRequests: number;
  private hits: Map<string, RateLimitRecord> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(windowMs = 60000, maxRequests = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;

    // Periodic cleanup of stale IPs every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 300000);

    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  public check(key: string): { allowed: boolean; remaining: number; resetMs: number } {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let record = this.hits.get(key);
    if (!record) {
      record = { timestamps: [] };
      this.hits.set(key, record);
    }

    // Keep only timestamps within window
    record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

    if (record.timestamps.length >= this.maxRequests) {
      const earliest = record.timestamps[0];
      const resetMs = Math.max(0, earliest + this.windowMs - now);
      return {
        allowed: false,
        remaining: 0,
        resetMs,
      };
    }

    record.timestamps.push(now);
    return {
      allowed: true,
      remaining: this.maxRequests - record.timestamps.length,
      resetMs: this.windowMs,
    };
  }

  public reset(): void {
    this.hits.clear();
  }

  public cleanup(): void {
    const windowStart = Date.now() - this.windowMs;
    for (const [key, record] of this.hits.entries()) {
      record.timestamps = record.timestamps.filter((ts) => ts > windowStart);
      if (record.timestamps.length === 0) {
        this.hits.delete(key);
      }
    }
  }

  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.hits.clear();
  }
}

function parsePositiveInt(val?: string, defaultVal = 0): number {
  if (!val || val.trim() === '') return defaultVal;
  const num = parseInt(val.trim(), 10);
  return Number.isFinite(num) && num > 0 ? num : defaultVal;
}

// Environment configuration
export const RATE_LIMIT_WINDOW_MS = parsePositiveInt(process.env.RATE_LIMIT_WINDOW_MS, 60000);
export const RATE_LIMIT_MAX = parsePositiveInt(
  process.env.RATE_LIMIT_MAX || process.env.RATE_LIMIT_MAX_REQUESTS,
  100
);

// Global registry rate limiters configured from environment
export const registrationRateLimiter = new RateLimiter(
  RATE_LIMIT_WINDOW_MS,
  Math.max(5, Math.floor(RATE_LIMIT_MAX * 0.3)) // Stricter threshold for registrations (e.g. 30 per window)
);
export const lookupRateLimiter = new RateLimiter(
  RATE_LIMIT_WINDOW_MS,
  Math.max(10, RATE_LIMIT_MAX * 2) // Higher threshold for read lookups (e.g. 200 per window)
);
