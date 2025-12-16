/**
 * LinkedIn Observer Content Script
 * 
 * Minimal content script that:
 * 1. Detects when user is on LinkedIn
 * 2. Provides UI elements (optional "Add to CRM" button)
 * 3. Helps refresh session headers by existing on the page
 * 
 * Note: The actual data fetching is done via the Voyager API
 * from the background script - no DOM scraping needed!
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('linkedin-observer');

/**
 * Check if we're on a profile page
 */
function isProfilePage(): boolean {
  return window.location.pathname.startsWith('/in/');
}

/**
 * Check if we're on the connections page
 */
function isConnectionsPage(): boolean {
  return window.location.pathname.includes('/mynetwork/invite-connect/connections');
}

/**
 * Get current page type
 */
function getPageType(): 'profile' | 'connections' | 'feed' | 'other' {
  const path = window.location.pathname;
  
  if (path.startsWith('/in/')) return 'profile';
  if (path.includes('/mynetwork/invite-connect/connections')) return 'connections';
  if (path === '/feed/' || path === '/feed') return 'feed';
  
  return 'other';
}

/**
 * Notify background script that user is on LinkedIn
 */
function notifyBackgroundOfActivity(): void {
  chrome.runtime.sendMessage({
    type: 'LINKEDIN_ACTIVITY',
    data: {
      pageType: getPageType(),
      url: window.location.href,
      timestamp: Date.now(),
    },
  }).catch(() => {
    // Background script might not be ready yet
  });
}

/**
 * Initialize the observer
 */
function initialize(): void {
  logger.info('LinkedIn Observer initialized', { pageType: getPageType() });
  
  // Notify background of activity
  notifyBackgroundOfActivity();
  
  // Set up URL change observer (for SPA navigation)
  let lastUrl = window.location.href;
  
  const urlObserver = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      logger.debug('URL changed', { newUrl: lastUrl });
      notifyBackgroundOfActivity();
    }
  });
  
  urlObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
  
  logger.info('LinkedIn Observer ready');
}

// Listen for messages from background
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'LINKEDIN_HEALTH_CHECK') {
    sendResponse({
      success: true,
      data: {
        pageType: getPageType(),
        url: window.location.href,
        timestamp: Date.now(),
      },
    });
    return true;
  }
  
  if (message.type === 'GET_PAGE_INFO') {
    sendResponse({
      success: true,
      data: {
        pageType: getPageType(),
        url: window.location.href,
        title: document.title,
      },
    });
    return true;
  }
  
  return false;
});

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

