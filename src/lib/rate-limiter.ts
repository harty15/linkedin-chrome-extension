import { RATE_LIMITS } from '@/config/constants';
import { storage } from './storage';
import { createLogger } from './logger';

const logger = createLogger('rate-limiter');

interface RateLimitState {
  hourlyCount: number;
  dailyCount: number;
  hourStart: number;
  dayStart: number;
  lastAction: number;
}

type RateLimitType = keyof typeof RATE_LIMITS;

/**
 * Rate limiter to prevent LinkedIn detection
 * Uses chrome.storage to persist state across sessions
 */
export class RateLimiter {
  private type: RateLimitType;
  private config: (typeof RATE_LIMITS)[RateLimitType];
  private state: RateLimitState;
  private stateLoaded: boolean = false;

  constructor(type: RateLimitType = 'bulk') {
    this.type = type;
    this.config = RATE_LIMITS[type];
    this.state = {
      hourlyCount: 0,
      dailyCount: 0,
      hourStart: Date.now(),
      dayStart: Date.now(),
      lastAction: 0,
    };
  }

  /**
   * Load state from storage
   */
  private async loadState(): Promise<void> {
    if (this.stateLoaded) return;

    const saved = await storage.get<RateLimitState>(`rate_limit_${this.type}`);
    if (saved) {
      this.state = saved;
      this.checkResets();
    }
    this.stateLoaded = true;
  }

  /**
   * Save state to storage
   */
  private async saveState(): Promise<void> {
    await storage.set(`rate_limit_${this.type}`, this.state);
  }

  /**
   * Check if hourly/daily counters should reset
   */
  private checkResets(): void {
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;
    const dayMs = 24 * 60 * 60 * 1000;

    // Reset hourly counter
    if (now - this.state.hourStart > hourMs) {
      logger.debug('Resetting hourly counter');
      this.state.hourlyCount = 0;
      this.state.hourStart = now;
    }

    // Reset daily counter
    if (now - this.state.dayStart > dayMs) {
      logger.debug('Resetting daily counter');
      this.state.dailyCount = 0;
      this.state.dayStart = now;
    }
  }

  /**
   * Check if we can proceed with an action
   */
  async canProceed(): Promise<boolean> {
    await this.loadState();
    this.checkResets();

    const canProceed = 
      this.state.hourlyCount < this.config.maxPerHour &&
      this.state.dailyCount < this.config.maxPerDay;

    if (!canProceed) {
      logger.warn('Rate limit reached', {
        hourly: `${this.state.hourlyCount}/${this.config.maxPerHour}`,
        daily: `${this.state.dailyCount}/${this.config.maxPerDay}`,
      });
    }

    return canProceed;
  }

  /**
   * Get remaining actions
   */
  async getRemaining(): Promise<{ hourly: number; daily: number }> {
    await this.loadState();
    this.checkResets();

    return {
      hourly: Math.max(0, this.config.maxPerHour - this.state.hourlyCount),
      daily: Math.max(0, this.config.maxPerDay - this.state.dailyCount),
    };
  }

  /**
   * Get time until rate limit resets
   */
  async getResetTime(): Promise<{ hourly: number; daily: number }> {
    await this.loadState();
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;
    const dayMs = 24 * 60 * 60 * 1000;

    return {
      hourly: Math.max(0, (this.state.hourStart + hourMs) - now),
      daily: Math.max(0, (this.state.dayStart + dayMs) - now),
    };
  }

  /**
   * Wait before performing an action (includes rate limiting and random delay)
   * @throws Error if rate limit exceeded
   */
  async wait(): Promise<void> {
    await this.loadState();
    this.checkResets();

    // Check limits
    if (this.state.hourlyCount >= this.config.maxPerHour) {
      const resetTime = await this.getResetTime();
      const minutes = Math.ceil(resetTime.hourly / 60000);
      throw new Error(`Hourly rate limit reached. Try again in ${minutes} minutes.`);
    }

    if (this.state.dailyCount >= this.config.maxPerDay) {
      const resetTime = await this.getResetTime();
      const hours = Math.ceil(resetTime.daily / 3600000);
      throw new Error(`Daily rate limit reached. Try again in ${hours} hours.`);
    }

    // Ensure minimum delay since last action
    if (this.state.lastAction) {
      const timeSinceLast = Date.now() - this.state.lastAction;
      if (timeSinceLast < this.config.delayMin) {
        await this.sleep(this.config.delayMin - timeSinceLast);
      }
    }

    // Random additional delay (appear human)
    const randomDelay = Math.random() * (this.config.delayMax - this.config.delayMin);
    await this.sleep(randomDelay);

    // Update counters
    this.state.hourlyCount++;
    this.state.dailyCount++;
    this.state.lastAction = Date.now();

    logger.debug(`Action performed. Hourly: ${this.state.hourlyCount}/${this.config.maxPerHour}, Daily: ${this.state.dailyCount}/${this.config.maxPerDay}`);

    await this.saveState();
  }

  /**
   * Record an action without waiting
   */
  async recordAction(): Promise<void> {
    await this.loadState();
    this.checkResets();

    this.state.hourlyCount++;
    this.state.dailyCount++;
    this.state.lastAction = Date.now();

    await this.saveState();
  }

  /**
   * Reset all counters
   */
  async reset(): Promise<void> {
    this.state = {
      hourlyCount: 0,
      dailyCount: 0,
      hourStart: Date.now(),
      dayStart: Date.now(),
      lastAction: 0,
    };
    await this.saveState();
    logger.info('Rate limiter reset');
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instances for common use cases
export const bulkRateLimiter = new RateLimiter('bulk');
export const incrementalRateLimiter = new RateLimiter('incremental');
export const quickAddRateLimiter = new RateLimiter('quickAdd');

