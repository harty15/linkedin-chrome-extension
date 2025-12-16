/**
 * LinkedIn DOM Selectors
 * 
 * LinkedIn updates their DOM periodically. If scraping stops working,
 * inspect the page and update these selectors.
 * 
 * Last verified: December 2024
 * 
 * TIP: Use attribute selectors like [data-*] and [aria-*] as they're
 * more stable than class names.
 */

export const SELECTORS = {
  // Connections List Page
  connections: {
    // Main container - try multiple options
    container: [
      '.scaffold-finite-scroll__content',
      '[data-finite-scroll-hotkey-context]',
      '.mn-connections',
      'main',
    ],
    
    // Individual connection cards - try multiple options
    card: [
      '.mn-connection-card',
      '[data-view-name="connection-card"]',
      'li.mn-connection-card',
      '.reusable-search__result-container',
      'li[class*="connection"]',
      'ul li a[href*="/in/"]',
    ],
    
    // Card link (profile URL)
    cardLink: [
      '.mn-connection-card__link',
      'a[href*="/in/"]',
      '.app-aware-link',
    ],
    
    // Card name
    cardName: [
      '.mn-connection-card__name',
      '.entity-result__title-text',
      'span[aria-hidden="true"]',
      '.artdeco-entity-lockup__title',
    ],
    
    // Card occupation/headline
    cardOccupation: [
      '.mn-connection-card__occupation',
      '.entity-result__primary-subtitle',
      '.artdeco-entity-lockup__subtitle',
      '.t-14.t-normal',
    ],
    
    // Card image
    cardImage: [
      '.presence-entity__image',
      '.EntityPhoto-circle-5',
      'img.EntityPhoto',
      'img[class*="presence"]',
      '.artdeco-entity-lockup__image img',
    ],
    
    // Connection timestamp
    cardTimestamp: [
      '.time-badge',
      '.mn-connection-card__time-badge',
      'time',
      'span[class*="time"]',
    ],
    
    // Loading indicators
    loadingSpinner: '.artdeco-spinner',
    loadingText: '.artdeco-loader__text',
    
    // No results
    emptyState: '.mn-connection-card-list__empty-state',
    
    // Pagination
    showMore: [
      '.scaffold-finite-scroll__load-button',
      'button[aria-label*="more"]',
      'button[class*="load-more"]',
    ],
  },

  // Individual Profile Page
  profile: {
    // Main sections
    topCard: '.pv-top-card',
    aboutSection: '#about',
    experienceSection: '#experience',
    educationSection: '#education',
    skillsSection: '#skills',
    
    // Top card elements
    name: [
      '.text-heading-xlarge',
      'h1.inline',
      'h1',
    ],
    headline: [
      '.text-body-medium.break-words',
      '.pv-top-card--list-bullet',
    ],
    location: [
      '.text-body-small.inline.t-black--light',
      'span[class*="location"]',
    ],
    profileImage: '.pv-top-card-profile-picture__image',
    connectionsCount: '.pv-top-card--list-bullet',
    
    // Current position
    currentTitle: '.pv-text-details__left-panel .text-body-medium',
    currentCompany: '.pv-text-details__left-panel span[aria-hidden="true"]',
    
    // About section
    aboutText: '.pv-shared-text-with-see-more',
  },

  // Common elements
  common: {
    primaryButton: '.artdeco-button--primary',
    secondaryButton: '.artdeco-button--secondary',
    modal: '.artdeco-modal',
    modalClose: '.artdeco-modal__dismiss',
    toast: '.artdeco-toast-item',
  },
} as const;

/**
 * Helper to try multiple selectors until one works
 */
export function findElement(parent: Element | Document, selectors: string | readonly string[]): Element | null {
  const selectorList = Array.isArray(selectors) ? selectors : [selectors];
  
  for (const selector of selectorList) {
    try {
      const el = parent.querySelector(selector);
      if (el) return el;
    } catch {
      // Invalid selector, try next
    }
  }
  
  return null;
}

/**
 * Helper to find all elements matching any selector
 */
export function findAllElements(parent: Element | Document, selectors: string | readonly string[]): Element[] {
  const selectorList = Array.isArray(selectors) ? selectors : [selectors];
  const results: Element[] = [];
  
  for (const selector of selectorList) {
    try {
      const elements = parent.querySelectorAll(selector);
      elements.forEach(el => {
        if (!results.includes(el)) {
          results.push(el);
        }
      });
    } catch {
      // Invalid selector, try next
    }
  }
  
  return results;
}
