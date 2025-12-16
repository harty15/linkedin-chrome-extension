import { STORAGE_KEYS, type AuthState, type SyncState, type ExtensionSettings, DEFAULT_SETTINGS } from '@/types';
import { createLogger } from './logger';

const logger = createLogger('storage');

/**
 * Type-safe wrapper around chrome.storage.local
 */
class Storage {
  /**
   * Get a value from storage
   */
  async get<T>(key: string, defaultValue?: T): Promise<T | undefined> {
    try {
      const result = await chrome.storage.local.get(key);
      return result[key] ?? defaultValue;
    } catch (error) {
      logger.error(`Failed to get ${key}:`, error);
      return defaultValue;
    }
  }

  /**
   * Set a value in storage
   */
  async set<T>(key: string, value: T): Promise<void> {
    try {
      await chrome.storage.local.set({ [key]: value });
      logger.debug(`Set ${key}:`, value);
    } catch (error) {
      logger.error(`Failed to set ${key}:`, error);
      throw error;
    }
  }

  /**
   * Remove a value from storage
   */
  async remove(key: string): Promise<void> {
    try {
      await chrome.storage.local.remove(key);
      logger.debug(`Removed ${key}`);
    } catch (error) {
      logger.error(`Failed to remove ${key}:`, error);
      throw error;
    }
  }

  /**
   * Clear all storage
   */
  async clear(): Promise<void> {
    try {
      await chrome.storage.local.clear();
      logger.info('Storage cleared');
    } catch (error) {
      logger.error('Failed to clear storage:', error);
      throw error;
    }
  }

  /**
   * Get all storage data
   */
  async getAll(): Promise<Record<string, unknown>> {
    try {
      return await chrome.storage.local.get(null);
    } catch (error) {
      logger.error('Failed to get all storage:', error);
      return {};
    }
  }

  // ============ Typed Accessors ============

  /**
   * Get auth state
   */
  async getAuth(): Promise<AuthState> {
    const token = await this.get<string>(STORAGE_KEYS.AUTH_TOKEN);
    const user = await this.get<AuthState['user']>(STORAGE_KEYS.USER);
    
    return {
      is_authenticated: !!token,
      token: token ?? null,
      user: user ?? null,
    };
  }

  /**
   * Set auth state
   */
  async setAuth(auth: { token: string; user: AuthState['user'] }): Promise<void> {
    await this.set(STORAGE_KEYS.AUTH_TOKEN, auth.token);
    await this.set(STORAGE_KEYS.USER, auth.user);
    logger.info('Auth state saved');
  }

  /**
   * Clear auth state
   */
  async clearAuth(): Promise<void> {
    await this.remove(STORAGE_KEYS.AUTH_TOKEN);
    await this.remove(STORAGE_KEYS.USER);
    logger.info('Auth state cleared');
  }

  /**
   * Get sync state
   */
  async getSyncState(): Promise<SyncState> {
    const state = await this.get<SyncState>(STORAGE_KEYS.SYNC_STATE);
    
    return state ?? {
      status: 'idle',
      progress: { current: 0, total: null, batch_number: 0, started_at: 0 },
      last_sync: null,
      total_synced: 0,
      error: null,
    };
  }

  /**
   * Update sync state (partial update)
   */
  async updateSyncState(updates: Partial<SyncState>): Promise<void> {
    const current = await this.getSyncState();
    const newState = { ...current, ...updates };
    await this.set(STORAGE_KEYS.SYNC_STATE, newState);
  }

  /**
   * Get settings
   */
  async getSettings(): Promise<ExtensionSettings> {
    const settings = await this.get<ExtensionSettings>(STORAGE_KEYS.SETTINGS);
    return { ...DEFAULT_SETTINGS, ...settings };
  }

  /**
   * Update settings (partial update)
   */
  async updateSettings(updates: Partial<ExtensionSettings>): Promise<void> {
    const current = await this.getSettings();
    const newSettings = { ...current, ...updates };
    await this.set(STORAGE_KEYS.SETTINGS, newSettings);
  }
}

// Export singleton instance
export const storage = new Storage();

