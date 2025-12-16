/**
 * Extension Constants
 */

// Extension Info
export const EXTENSION_NAME = 'LinkedIn CRM Sync';
export const EXTENSION_VERSION = '1.0.0';

// API Configuration
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// LinkedIn URLs
export const LINKEDIN_URLS = {
  connections: 'https://www.linkedin.com/mynetwork/invite-connect/connections/',
  profile: 'https://www.linkedin.com/in/',
  login: 'https://www.linkedin.com/login',
} as const;

// Rate Limiting
export const RATE_LIMITS = {
  bulk: {
    maxPerHour: 200,
    maxPerDay: 1000,
    delayMin: 2000, // 2 seconds
    delayMax: 5000, // 5 seconds
    scrollDelay: 1000, // 1 second between scrolls
  },
  incremental: {
    maxPerHour: 50,
    maxPerDay: 100,
    delayMin: 3000,
    delayMax: 7000,
  },
  quickAdd: {
    maxPerHour: 20,
    maxPerDay: 100,
    delayMin: 1000,
    delayMax: 2000,
  },
} as const;

// Batch Sizes
export const BATCH_SIZE = 20; // Send to backend in batches of 20
export const MAX_BATCH_SIZE = 100;

// Timeouts
export const TIMEOUTS = {
  elementWait: 10000 as number, // 10 seconds
  pageLoad: 30000 as number, // 30 seconds
  apiRequest: 15000 as number, // 15 seconds
  scroll: 1000 as number, // 1 second
};

// Retries
export const RETRY_CONFIG = {
  maxRetries: 3 as number,
  initialDelay: 1000 as number,
  maxDelay: 10000 as number,
  backoffMultiplier: 2 as number,
};

// Auto-sync Schedule
export const AUTO_SYNC = {
  alarmName: 'daily-incremental-sync',
  defaultTime: '09:00',
  checkIntervalMinutes: 60, // Check every hour
} as const;

// Storage Limits
export const STORAGE_LIMITS = {
  maxCachedContacts: 1000,
  maxLogEntries: 100,
} as const;

// UI Constants
export const UI = {
  popupWidth: 360,
  popupHeight: 500,
  sidebarWidth: 300,
  toastDuration: 3000,
} as const;

// Logging
export const LOG_PREFIX = '[CRM-Extension]';
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

