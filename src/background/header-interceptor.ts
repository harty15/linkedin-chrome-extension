/**
 * LinkedIn Header Interceptor
 * 
 * Passively captures LinkedIn authentication headers when the user
 * browses LinkedIn naturally. These headers are required to call
 * LinkedIn's Voyager API directly.
 * 
 * Based on reverse-engineering of Harmonic's extension.
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('header-interceptor');

// Headers required for Voyager API calls
const REQUIRED_HEADERS = [
  'x-li-lang',
  'x-li-page-instance',
  'x-li-track',
  'x-restli-protocol-version',
  'csrf-token',
];

// Storage keys
const STORAGE_KEYS = {
  HEADERS: 'linkedinHeaders',
  HEADERS_UPDATED_AT: 'linkedinHeadersUpdatedAt',
  HEADERS_FOR_AUTO_SYNC: 'linkedinHeadersForAutoSync',
  HEADERS_FOR_MANUAL_SYNC: 'linkedinHeadersForManualSync',
};

export interface LinkedInHeaders {
  'x-li-lang'?: string;
  'x-li-page-instance'?: string;
  'x-li-track'?: string;
  'x-restli-protocol-version'?: string;
  'csrf-token'?: string;
  [key: string]: string | undefined;
}

/**
 * Extract relevant headers from request headers array
 */
function extractHeaders(requestHeaders: chrome.webRequest.HttpHeader[] | undefined): LinkedInHeaders {
  const headers: LinkedInHeaders = {};
  
  if (!requestHeaders) return headers;
  
  for (const header of requestHeaders) {
    if (header.name && header.value && REQUIRED_HEADERS.includes(header.name.toLowerCase())) {
      headers[header.name.toLowerCase()] = header.value;
    }
  }
  
  return headers;
}

/**
 * Check if the request is from the connections page
 */
function isConnectionsPageRequest(requestHeaders: chrome.webRequest.HttpHeader[] | undefined): boolean {
  if (!requestHeaders) return false;
  
  return requestHeaders.some(
    header => 
      header.name?.toLowerCase() === 'x-li-page-instance' &&
      header.value?.includes('urn:li:page:d_flagship3_people_connections')
  );
}

/**
 * Check if the request is from feed or profile page (good for auto-sync)
 */
function isAutoSyncEligibleRequest(requestHeaders: chrome.webRequest.HttpHeader[] | undefined): boolean {
  if (!requestHeaders) return false;
  
  return requestHeaders.some(
    header => 
      header.name?.toLowerCase() === 'x-li-page-instance' &&
      (header.value?.includes('urn:li:page:d_flagship3_feed') ||
       header.value?.includes('urn:li:page:d_flagship3_profile_view_base'))
  );
}

/**
 * Check if we have all required headers
 */
function hasAllRequiredHeaders(headers: LinkedInHeaders): boolean {
  // csrf-token is the most critical one
  return !!headers['csrf-token'];
}

/**
 * Initialize the header interceptor
 * Call this from the background script on startup
 */
export function initializeHeaderInterceptor(): void {
  logger.info('Initializing LinkedIn header interceptor');

  // Listen for LinkedIn API requests
  chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      const headers = extractHeaders(details.requestHeaders);
      
      if (!hasAllRequiredHeaders(headers)) {
        return;
      }

      // Store headers for manual sync (from connections page)
      if (isConnectionsPageRequest(details.requestHeaders)) {
        logger.debug('Captured headers from connections page');
        chrome.storage.local.set({
          [STORAGE_KEYS.HEADERS_FOR_MANUAL_SYNC]: headers,
        });
      }
      
      // Store headers for auto sync (from feed/profile pages)
      if (isAutoSyncEligibleRequest(details.requestHeaders)) {
        logger.debug('Captured headers for auto sync');
        chrome.storage.local.set({
          [STORAGE_KEYS.HEADERS_FOR_AUTO_SYNC]: headers,
          [STORAGE_KEYS.HEADERS_UPDATED_AT]: Date.now(),
        });
      }

      // Always update the general headers storage
      chrome.storage.local.set({
        [STORAGE_KEYS.HEADERS]: headers,
      });
    },
    { urls: ['*://*.linkedin.com/voyager/api/*'] },
    ['requestHeaders']
  );

  logger.info('Header interceptor initialized');
}

/**
 * Get stored LinkedIn headers
 */
export async function getStoredHeaders(): Promise<LinkedInHeaders | null> {
  const result = await chrome.storage.local.get([
    STORAGE_KEYS.HEADERS,
    STORAGE_KEYS.HEADERS_FOR_MANUAL_SYNC,
    STORAGE_KEYS.HEADERS_FOR_AUTO_SYNC,
  ]);
  
  // Prefer manual sync headers, then auto sync, then general
  return result[STORAGE_KEYS.HEADERS_FOR_MANUAL_SYNC] ||
         result[STORAGE_KEYS.HEADERS_FOR_AUTO_SYNC] ||
         result[STORAGE_KEYS.HEADERS] ||
         null;
}

/**
 * Get headers last updated timestamp
 */
export async function getHeadersUpdatedAt(): Promise<number | null> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.HEADERS_UPDATED_AT);
  return result[STORAGE_KEYS.HEADERS_UPDATED_AT] || null;
}

/**
 * Check if headers are fresh enough for auto-sync
 * Harmonic uses 3 minutes as the threshold
 */
export async function areHeadersFreshForAutoSync(maxAgeMinutes = 3): Promise<boolean> {
  const updatedAt = await getHeadersUpdatedAt();
  if (!updatedAt) return false;
  
  const maxAgeMs = maxAgeMinutes * 60 * 1000;
  return (Date.now() - updatedAt) < maxAgeMs;
}

/**
 * Get CSRF token from LinkedIn cookies
 */
export async function getCsrfTokenFromCookies(): Promise<string | null> {
  try {
    const cookies = await chrome.cookies.getAll({ domain: '.linkedin.com' });
    const jsessionCookie = cookies.find(c => c.name === 'JSESSIONID');
    
    if (jsessionCookie?.value) {
      // Remove quotes if present
      return jsessionCookie.value.replace(/"/g, '');
    }
    
    return null;
  } catch (error) {
    logger.error('Failed to get CSRF token from cookies:', error);
    return null;
  }
}

/**
 * Check if user is logged into LinkedIn
 */
export async function isLinkedInLoggedIn(): Promise<boolean> {
  try {
    const cookies = await chrome.cookies.getAll({ domain: '.linkedin.com' });
    return cookies.some(c => c.name === 'li_at' || c.name === 'JSESSIONID');
  } catch {
    return false;
  }
}

