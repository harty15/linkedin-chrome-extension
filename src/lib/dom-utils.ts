import { TIMEOUTS } from '@/config/constants';
import { createLogger } from './logger';

const logger = createLogger('dom-utils');

/**
 * DOM utility functions for scraping LinkedIn pages
 */
export class DOMUtils {
  /**
   * Wait for an element to appear in the DOM
   */
  static async waitForElement(
    selector: string,
    timeout = TIMEOUTS.elementWait
  ): Promise<Element> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const element = document.querySelector(selector);
      if (element) {
        return element;
      }
      await this.sleep(100);
    }

    throw new Error(`Element not found: ${selector} (after ${timeout}ms)`);
  }

  /**
   * Wait for element to be removed from DOM
   */
  static async waitForElementRemoved(
    selector: string,
    timeout = TIMEOUTS.elementWait
  ): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const element = document.querySelector(selector);
      if (!element) {
        return true;
      }
      await this.sleep(100);
    }

    return false; // Element still exists after timeout
  }

  /**
   * Wait for multiple elements to appear
   */
  static async waitForElements(
    selector: string,
    minCount = 1,
    timeout = TIMEOUTS.elementWait
  ): Promise<NodeListOf<Element>> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const elements = document.querySelectorAll(selector);
      if (elements.length >= minCount) {
        return elements;
      }
      await this.sleep(100);
    }

    throw new Error(`Not enough elements found for: ${selector} (found ${document.querySelectorAll(selector).length}, need ${minCount})`);
  }

  /**
   * Extract text content from an element
   */
  static extractText(element: Element | null, selector?: string): string | null {
    const target = selector ? element?.querySelector(selector) : element;
    return target?.textContent?.trim() || null;
  }

  /**
   * Extract attribute from an element
   */
  static extractAttr(
    element: Element | null,
    selector: string,
    attribute: string
  ): string | null {
    const target = element?.querySelector(selector);
    return target?.getAttribute(attribute) || null;
  }

  /**
   * Extract href from a link element
   */
  static extractHref(element: Element | null, selector?: string): string | null {
    const target = selector ? element?.querySelector(selector) : element;
    const href = target?.getAttribute('href');
    
    if (!href) return null;
    
    // Handle relative URLs
    if (href.startsWith('/')) {
      return `https://www.linkedin.com${href}`;
    }
    
    return href;
  }

  /**
   * Extract image src from an element
   */
  static extractImageSrc(element: Element | null, selector: string): string | null {
    const img = element?.querySelector(selector) as HTMLImageElement | null;
    return img?.src || null;
  }

  /**
   * Try multiple selectors until one works
   */
  static trySelectors<T>(
    element: Element,
    selectors: string[],
    extractor: (el: Element | null) => T
  ): T {
    for (const selector of selectors) {
      const target = element.querySelector(selector);
      if (target) {
        return extractor(target);
      }
    }
    return extractor(null);
  }

  /**
   * Scroll to bottom of page
   */
  static scrollToBottom(): void {
    window.scrollTo({
      top: document.body.scrollHeight,
      behavior: 'smooth',
    });
  }

  /**
   * Scroll by a specific amount
   */
  static scrollBy(amount: number): void {
    window.scrollBy({
      top: amount,
      behavior: 'smooth',
    });
  }

  /**
   * Check if page is at bottom
   */
  static isAtBottom(threshold = 100): boolean {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollHeight = document.documentElement.scrollHeight;
    const clientHeight = document.documentElement.clientHeight;
    
    return scrollTop + clientHeight >= scrollHeight - threshold;
  }

  /**
   * Simulate human-like scrolling
   */
  static async humanScroll(): Promise<void> {
    // Scroll in small increments with random delays
    const scrollAmount = 300 + Math.random() * 200;
    this.scrollBy(scrollAmount);
    
    // Random micro-pause
    await this.sleep(100 + Math.random() * 200);
    
    // Occasionally scroll up a bit (like a human would)
    if (Math.random() < 0.1) {
      this.scrollBy(-50);
      await this.sleep(50);
    }
  }

  /**
   * Check if element is visible in viewport
   */
  static isInViewport(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
  }

  /**
   * Check if on LinkedIn connections page
   */
  static isConnectionsPage(): boolean {
    return window.location.pathname.includes('/mynetwork/invite-connect/connections');
  }

  /**
   * Check if on LinkedIn profile page
   */
  static isProfilePage(): boolean {
    return window.location.pathname.startsWith('/in/');
  }

  /**
   * Get LinkedIn profile username from URL
   */
  static getProfileUsername(): string | null {
    const match = window.location.pathname.match(/\/in\/([^/]+)/);
    return match ? match[1] : null;
  }

  /**
   * Clean LinkedIn URL (remove query params and trailing slash)
   */
  static cleanLinkedInUrl(url: string): string {
    try {
      const parsed = new URL(url);
      let path = parsed.pathname;
      
      // Remove trailing slash
      if (path.endsWith('/')) {
        path = path.slice(0, -1);
      }
      
      return `https://www.linkedin.com${path}`;
    } catch {
      return url;
    }
  }

  /**
   * Parse occupation string into title and company
   */
  static parseOccupation(occupation: string | null): { title: string | null; company: string | null } {
    if (!occupation) {
      return { title: null, company: null };
    }

    // Common patterns:
    // "Software Engineer at Google"
    // "CEO @ Startup Inc"
    // "Founder | Company Name"
    // "Product Manager - Microsoft"
    const separators = [' at ', ' @ ', ' | ', ' - ', ' · '];

    for (const sep of separators) {
      if (occupation.includes(sep)) {
        const [title, company] = occupation.split(sep, 2);
        return {
          title: title.trim(),
          company: company.trim(),
        };
      }
    }

    // No separator found, treat entire string as title
    return {
      title: occupation,
      company: null,
    };
  }

  /**
   * Sleep helper
   */
  static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Create an element from HTML string
   */
  static createElement(html: string): Element {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    return template.content.firstElementChild!;
  }

  /**
   * Inject CSS into the page
   */
  static injectStyles(css: string, id?: string): void {
    if (id && document.getElementById(id)) {
      return; // Already injected
    }

    const style = document.createElement('style');
    if (id) style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
  }
}

// Export convenience functions
export const waitForElement = DOMUtils.waitForElement.bind(DOMUtils);
export const extractText = DOMUtils.extractText.bind(DOMUtils);
export const parseOccupation = DOMUtils.parseOccupation.bind(DOMUtils);
export const sleep = DOMUtils.sleep.bind(DOMUtils);

