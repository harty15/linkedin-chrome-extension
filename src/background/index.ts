/**
 * Background Service Worker
 * 
 * LinkedIn CRM Sync - Voyager API Edition
 * 
 * Uses LinkedIn's internal Voyager API (like Harmonic) to sync connections.
 * This approach is:
 * - Truly headless (no tabs opened for auto-sync)
 * - Much faster (structured JSON, no DOM parsing)
 * - More reliable (direct API calls)
 */

import { storage } from '@/lib/storage';
import { backgroundLogger as logger } from '@/lib/logger';
import { apiClient } from '@/lib/api-client';
import { 
  initializeHeaderInterceptor, 
  getStoredHeaders, 
  areHeadersFreshForAutoSync,
  isLinkedInLoggedIn,
  getCsrfTokenFromCookies,
} from './header-interceptor';
import { fetchAllConnections, enrichProfiles, type ParsedConnection, type FullProfileData } from '@/lib/voyager-client';
import { connectionsToContacts, fullProfileToEnrichedContact } from '@/lib/voyager-parser';
import { supabase } from '@/lib/supabase';
import type { ExtensionMessage, SyncState } from '@/types';

// Constants
const ALARMS = {
  AUTO_SYNC: 'linkedin-auto-sync',
  HEALTH_CHECK: 'linkedin-health-check',
};

const SYNC_CONFIG = {
  AUTO_SYNC_INTERVAL_HOURS: 12,
  HEALTH_CHECK_INTERVAL_MINUTES: 1,
  HEADERS_MAX_AGE_MINUTES: 3,
};

// Sync state
let syncInProgress = false;
let currentSyncTabId: number | null = null;

// ============ Initialization ============

/**
 * Initialize the extension
 */
async function initialize(): Promise<void> {
  logger.info('Initializing LinkedIn CRM Sync (Voyager API Edition)');
  
  // Initialize header interceptor
  initializeHeaderInterceptor();
  
  // Setup alarms
  await setupAlarms();
  
  // Initialize sync state
  await storage.updateSyncState({
    status: 'idle',
    progress: { current: 0, total: null, batch_number: 0, started_at: 0 },
    error: null,
  });
  
  logger.info('Initialization complete');
}

/**
 * Setup recurring alarms
 */
async function setupAlarms(): Promise<void> {
  // Clear existing alarms
  await chrome.alarms.clearAll();
  
  // Auto-sync alarm (every 12 hours)
  chrome.alarms.create(ALARMS.AUTO_SYNC, {
    periodInMinutes: SYNC_CONFIG.AUTO_SYNC_INTERVAL_HOURS * 60,
    delayInMinutes: 1, // First check after 1 minute
  });
  
  // Health check alarm (every minute - to check if user is on LinkedIn)
  chrome.alarms.create(ALARMS.HEALTH_CHECK, {
    periodInMinutes: SYNC_CONFIG.HEALTH_CHECK_INTERVAL_MINUTES,
  });
  
  logger.info('Alarms configured');
}

// ============ Alarm Handlers ============

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARMS.AUTO_SYNC) {
    await handleAutoSync();
  } else if (alarm.name === ALARMS.HEALTH_CHECK) {
    await handleHealthCheck();
  }
});

/**
 * Handle auto-sync alarm
 */
async function handleAutoSync(): Promise<void> {
  logger.info('Auto-sync alarm triggered');
  
  // Check if sync is already in progress
  if (syncInProgress) {
    logger.info('Sync already in progress, skipping');
    return;
  }
  
  // Check if headers are fresh
  const headersFresh = await areHeadersFreshForAutoSync(SYNC_CONFIG.HEADERS_MAX_AGE_MINUTES);
  if (!headersFresh) {
    logger.info('Headers not fresh, skipping auto-sync. User needs to visit LinkedIn.');
    return;
  }
  
  // Check last sync time
  const syncState = await storage.getSyncState();
  const lastSync = syncState.last_sync;
  const minInterval = SYNC_CONFIG.AUTO_SYNC_INTERVAL_HOURS * 60 * 60 * 1000;
  
  if (lastSync && (Date.now() - lastSync) < minInterval) {
    logger.info(`Last sync was less than ${SYNC_CONFIG.AUTO_SYNC_INTERVAL_HOURS}h ago, skipping`);
    return;
  }
  
  // Run sync
  await runSync('auto');
}

/**
 * Handle health check - just log status
 */
async function handleHealthCheck(): Promise<void> {
  const isLoggedIn = await isLinkedInLoggedIn();
  const headersFresh = await areHeadersFreshForAutoSync(SYNC_CONFIG.HEADERS_MAX_AGE_MINUTES);
  
  logger.debug(`Health check: loggedIn=${isLoggedIn}, headersFresh=${headersFresh}`);
}

// ============ Sync Logic ============

type SyncType = 'auto' | 'manual';

/**
 * Run a sync operation
 */
async function runSync(type: SyncType): Promise<{ success: boolean; count: number }> {
  if (syncInProgress) {
    logger.warn('Sync already in progress');
    return { success: false, count: 0 };
  }
  
  syncInProgress = true;
  const startTime = Date.now();
  
  logger.info(`Starting ${type} sync`);
  
  // Update badge
  chrome.action.setBadgeBackgroundColor({ color: '#0A66C2' });
  chrome.action.setBadgeText({ text: '...' });
  
  try {
    // Update state
    await storage.updateSyncState({
      status: 'syncing',
      progress: { current: 0, total: null, batch_number: 0, started_at: startTime },
      error: null,
    });
    
    // Broadcast start
    broadcastProgress('syncing', 0, null);
    
    // Get headers
    let headers = await getStoredHeaders();
    
    // For manual sync, we might need to open a tab to refresh headers
    if (!headers && type === 'manual') {
      logger.info('No headers found, opening LinkedIn tab to refresh session');
      headers = await refreshHeadersViaTab();
    }
    
    if (!headers || !headers['csrf-token']) {
      // Try to get CSRF from cookies as fallback
      const csrfToken = await getCsrfTokenFromCookies();
      if (csrfToken) {
        headers = { ...headers, 'csrf-token': csrfToken };
      } else {
        throw new Error('No LinkedIn session. Please visit LinkedIn first.');
      }
    }
    
    // Get most recent connection URL for incremental sync
    const stats = await apiClient.getSyncStats();
    const mostRecentUrl = type === 'auto' ? await getMostRecentConnectionUrl() : undefined;
    
    // Fetch connections
    const { connections, total } = await fetchAllConnections(
      headers,
      (fetched, totalCount) => {
        // Update progress
        const progress = totalCount ? Math.round((fetched / totalCount) * 100) : null;
        chrome.action.setBadgeText({ text: progress ? `${progress}%` : `${fetched}` });
        broadcastProgress('syncing', fetched, totalCount);
        
        storage.updateSyncState({
          progress: {
            current: fetched,
            total: totalCount,
            batch_number: Math.floor(fetched / 80),
            started_at: startTime,
          },
        });
      },
      mostRecentUrl
    );
    
    logger.info(`Fetched ${connections.length} connections`);
    
    // Save to database
    if (connections.length > 0) {
      const contacts = connectionsToContacts(connections);
      const result = await apiClient.bulkImportContacts(contacts as any);
      logger.info(`Saved: ${result.new_count} new, ${result.updated_count} updated`);

      // Auto-enrich ALL contacts (every sync enriches all fetched profiles)
      logger.info(`Starting automatic enrichment for ${connections.length} contacts`);

      // Extract identifiers from all connections
      const identifiers: string[] = [];
      const urlToConnection = new Map<string, ParsedConnection>();

      for (const conn of connections) {
        const match = conn.linkedinUrl.match(/linkedin\.com\/in\/([^/?#]+)/);
        if (match) {
          identifiers.push(match[1]);
          urlToConnection.set(match[1], conn);
        }
      }

      if (identifiers.length > 0) {
        // Enrich profiles
        let enrichedCount = 0;
        await enrichProfiles(
          identifiers,
          headers,
          async (completed, totalToEnrich, profile) => {
            // Update badge with enrichment progress
            const pct = Math.round((completed / totalToEnrich) * 100);
            chrome.action.setBadgeText({ text: `📊${pct}%` });

            // Save profile if successfully fetched
            if (profile) {
              const identifier = identifiers[completed - 1];
              const conn = urlToConnection.get(identifier);

              if (conn) {
                const { contact: enrichedContact, experiences, educations, skills } =
                  fullProfileToEnrichedContact(profile, conn.linkedinUrl);

                // Update contact
                const { data: contactData } = await supabase
                  .from('contacts')
                  .select('id')
                  .eq('linkedin_url', conn.linkedinUrl)
                  .single();

                if (contactData) {
                  const contactId = contactData.id;

                  // Update contact with enriched data (always overwrite)
                  await supabase
                    .from('contacts')
                    .update({
                      ...enrichedContact,
                      updated_at: new Date().toISOString(),
                    })
                    .eq('id', contactId);

                  // Delete old experiences and insert fresh data
                  await supabase.from('experiences').delete().eq('contact_id', contactId);
                  if (experiences.length > 0) {
                    await supabase.from('experiences').insert(
                      experiences.map(e => ({ ...e, contact_id: contactId }))
                    );
                  }

                  // Delete old educations and insert fresh data
                  await supabase.from('educations').delete().eq('contact_id', contactId);
                  if (educations.length > 0) {
                    await supabase.from('educations').insert(
                      educations.map(e => ({ ...e, contact_id: contactId }))
                    );
                  }

                  // Delete old skills and insert fresh data
                  await supabase.from('skills').delete().eq('contact_id', contactId);
                  if (skills.length > 0) {
                    await supabase.from('skills').insert(
                      skills.map(s => ({ ...s, contact_id: contactId }))
                    );
                  }

                  // Update linkedin_profiles (upsert overwrites)
                  const nameParts = enrichedContact.name.split(' ');
                  await supabase
                    .from('linkedin_profiles')
                    .upsert({
                      contact_id: contactId,
                      linkedin_url: conn.linkedinUrl,
                      full_name: enrichedContact.name,
                      first_name: nameParts[0] || null,
                      last_name: nameParts.slice(1).join(' ') || null,
                      headline: enrichedContact.headline,
                      location: enrichedContact.location,
                      about: enrichedContact.about,
                      profile_image_url: enrichedContact.profile_image_url,
                      current_title: enrichedContact.title,
                      current_company: enrichedContact.company,
                      experience: enrichedContact.linkedin_data.experiences,
                      education: enrichedContact.linkedin_data.educations,
                      skills: enrichedContact.linkedin_data.skills,
                      scrape_status: 'complete',
                      scraped_at: enrichedContact.scraped_at,
                      updated_at: new Date().toISOString(),
                    }, { onConflict: 'linkedin_url' });

                  enrichedCount++;
                }
              }
            }
          },
          2000
        );

        logger.info(`Auto-enrichment complete: ${enrichedCount}/${identifiers.length} profiles enriched`);
      }
    }

    // Update state
    const duration = Date.now() - startTime;
    await storage.updateSyncState({
      status: 'completed',
      last_sync: Date.now(),
      total_synced: (stats.total_contacts || 0) + connections.length,
      error: null,
    });

    // Update badge
    if (connections.length > 0) {
      chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
      chrome.action.setBadgeText({ text: `+${connections.length}` });

      // Clear badge after 10 seconds
      setTimeout(() => {
        chrome.action.setBadgeText({ text: '' });
      }, 10000);
    } else {
      chrome.action.setBadgeText({ text: '' });
    }

    broadcastProgress('completed', connections.length, total);

    logger.info(`Sync completed in ${Math.round(duration / 1000)}s: ${connections.length} connections`);

    return { success: true, count: connections.length };
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Sync failed:', error);
    
    await storage.updateSyncState({
      status: 'error',
      error: errorMsg,
    });
    
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
    chrome.action.setBadgeText({ text: '!' });
    
    broadcastProgress('error', 0, null, errorMsg);
    
    return { success: false, count: 0 };
    
  } finally {
    syncInProgress = false;
    
    // Close tab if we opened one
    if (currentSyncTabId) {
      try {
        await chrome.tabs.remove(currentSyncTabId);
      } catch {
        // Tab might already be closed
      }
      currentSyncTabId = null;
    }
  }
}

/**
 * Refresh headers by opening a LinkedIn tab
 */
async function refreshHeadersViaTab(): Promise<typeof getStoredHeaders extends () => Promise<infer T> ? T : never> {
  logger.info('Opening LinkedIn tab to refresh headers');
  
  const tab = await chrome.tabs.create({
    url: 'https://www.linkedin.com/mynetwork/invite-connect/connections/',
    active: false,
  });
  
  currentSyncTabId = tab.id || null;
  
  // Wait for page to load and headers to be captured
  await new Promise<void>((resolve) => {
    const listener = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (tabId === tab.id && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        // Give extra time for API requests to fire
        setTimeout(resolve, 3000);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    
    // Timeout after 30 seconds
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 30000);
  });
  
  return getStoredHeaders();
}

/**
 * Get most recent connection URL from database
 */
async function getMostRecentConnectionUrl(): Promise<string | undefined> {
  // This would query your database for the most recent connection
  // For now, return undefined to do a full sync
  return undefined;
}

/**
 * Broadcast progress to popup
 */
function broadcastProgress(
  status: 'syncing' | 'completed' | 'error',
  current: number,
  total: number | null,
  error?: string
): void {
  chrome.runtime.sendMessage({
    type: 'SYNC_PROGRESS',
    data: { status, current, total, error },
  }).catch(() => {
    // Popup not open, ignore
  });
}

// ============ Message Handling ============

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch(error => {
      logger.error('Message handler error:', error);
      sendResponse({ success: false, error: error.message });
    });
  return true; // Async response
});

async function handleMessage(
  message: ExtensionMessage,
  _sender: chrome.runtime.MessageSender
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  logger.debug('Received message:', message.type);
  
  switch (message.type) {
    case 'START_BULK_SYNC':
      return handleStartSync();
      
    case 'STOP_SYNC':
      return handleStopSync();
      
    case 'GET_SYNC_STATUS':
      return handleGetSyncStatus();
      
    case 'GET_AUTH_STATUS':
      return handleGetAuthStatus();
      
    case 'START_ENRICHMENT':
      return handleStartEnrichment(message.data as { limit?: number } | undefined);
      
    default:
      return { success: false, error: `Unknown message type: ${message.type}` };
  }
}

async function handleStartSync(): Promise<{ success: boolean; error?: string }> {
  if (syncInProgress) {
    return { success: false, error: 'Sync already in progress' };
  }
  
  // Run sync in background
  runSync('manual').catch(error => {
    logger.error('Manual sync failed:', error);
  });
  
  return { success: true };
}

async function handleStopSync(): Promise<{ success: boolean }> {
  // Currently no way to stop mid-sync with fetch API
  // Could implement AbortController in the future
  logger.info('Stop sync requested');
  return { success: true };
}

async function handleGetSyncStatus(): Promise<{ success: boolean; data: SyncState }> {
  const state = await storage.getSyncState();
  return { success: true, data: state };
}

async function handleGetAuthStatus(): Promise<{ success: boolean; data: unknown }> {
  const isLoggedIn = await isLinkedInLoggedIn();
  const hasHeaders = !!(await getStoredHeaders());
  
  return {
    success: true,
    data: {
      is_authenticated: true, // We don't require app auth anymore
      linkedin_logged_in: isLoggedIn,
      has_headers: hasHeaders,
    },
  };
}

async function handleStartEnrichment(
  options?: { limit?: number }
): Promise<{ success: boolean; error?: string }> {
  if (syncInProgress) {
    return { success: false, error: 'Sync already in progress' };
  }
  
  // Run enrichment in background
  runEnrichment(options?.limit || 50).catch(error => {
    logger.error('Enrichment failed:', error);
  });
  
  return { success: true };
}

// ============ Profile Enrichment ============

/**
 * Run profile enrichment for contacts that need it
 */
async function runEnrichment(limit: number): Promise<void> {
  if (syncInProgress) {
    logger.warn('Sync in progress, skipping enrichment');
    return;
  }
  
  syncInProgress = true;
  logger.info(`Starting profile enrichment (limit: ${limit})`);
  
  // Update badge
  chrome.action.setBadgeBackgroundColor({ color: '#8b5cf6' }); // Purple for enrichment
  chrome.action.setBadgeText({ text: '🔄' });
  
  try {
    // Get contacts that need enrichment
    const { data: contacts, error } = await supabase
      .from('contacts')
      .select('id, linkedin_url')
      .eq('needs_enrichment', true)
      .limit(limit);
    
    if (error) {
      logger.error('Failed to get contacts for enrichment:', error);
      return;
    }
    
    if (!contacts || contacts.length === 0) {
      logger.info('No contacts need enrichment');
      chrome.action.setBadgeText({ text: '' });
      return;
    }
    
    logger.info(`Found ${contacts.length} contacts to enrich`);
    
    // Get headers
    let headers = await getStoredHeaders();
    if (!headers) {
      logger.info('No headers, opening LinkedIn to refresh');
      headers = await refreshHeadersViaTab();
    }
    
    if (!headers || !headers['csrf-token']) {
      const csrfToken = await getCsrfTokenFromCookies();
      if (csrfToken) {
        headers = { ...headers, 'csrf-token': csrfToken };
      } else {
        logger.error('No session available for enrichment');
        return;
      }
    }
    
    // Extract public identifiers from LinkedIn URLs
    const urlToId = new Map<string, string>();
    const identifiers: string[] = [];
    
    for (const contact of contacts) {
      const url = contact.linkedin_url;
      const match = url.match(/linkedin\.com\/in\/([^/?#]+)/);
      if (match) {
        identifiers.push(match[1]);
        urlToId.set(match[1], contact.id);
      }
    }
    
    if (identifiers.length === 0) {
      logger.warn('No valid LinkedIn URLs found');
      return;
    }
    
    // Enrich profiles
    let enriched = 0;
    const profiles = await enrichProfiles(
      identifiers,
      headers,
      async (completed, total, profile) => {
        // Update badge with progress
        const pct = Math.round((completed / total) * 100);
        chrome.action.setBadgeText({ text: `${pct}%` });
        
        // Save profile if successfully fetched
        if (profile) {
          const identifier = identifiers[completed - 1];
          const contactId = urlToId.get(identifier);
          const linkedinUrl = `https://www.linkedin.com/in/${identifier}`;
          
          if (contactId) {
            const saved = await saveEnrichedProfile(contactId, linkedinUrl, profile);
            if (saved) enriched++;
          }
        }
        
        // Broadcast progress
        broadcastProgress('syncing', completed, total);
      },
      2000 // 2 second delay between requests
    );
    
    logger.info(`Enrichment complete: ${enriched} profiles updated`);
    
    // Show success
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
    chrome.action.setBadgeText({ text: `+${enriched}` });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 10000);
    
    broadcastProgress('completed', enriched, contacts.length);
    
  } catch (error) {
    logger.error('Enrichment error:', error);
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
    chrome.action.setBadgeText({ text: '!' });
  } finally {
    syncInProgress = false;
    
    if (currentSyncTabId) {
      try {
        await chrome.tabs.remove(currentSyncTabId);
      } catch {}
      currentSyncTabId = null;
    }
  }
}

/**
 * Save an enriched profile to the database
 */
async function saveEnrichedProfile(
  contactId: string,
  linkedinUrl: string,
  profile: FullProfileData
): Promise<boolean> {
  try {
    const { contact, experiences, educations, skills } = fullProfileToEnrichedContact(profile, linkedinUrl);
    
    // Update contact with enriched data
    const { error: contactError } = await supabase
      .from('contacts')
      .update({
        ...contact,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contactId);
    
    if (contactError) {
      logger.error('Failed to update contact:', contactError);
      return false;
    }
    
    // Clear and insert experiences
    await supabase.from('experiences').delete().eq('contact_id', contactId);
    if (experiences.length > 0) {
      const expRecords = experiences.map(e => ({ ...e, contact_id: contactId }));
      await supabase.from('experiences').insert(expRecords);
    }
    
    // Clear and insert educations
    await supabase.from('educations').delete().eq('contact_id', contactId);
    if (educations.length > 0) {
      const eduRecords = educations.map(e => ({ ...e, contact_id: contactId }));
      await supabase.from('educations').insert(eduRecords);
    }
    
    // Clear and insert skills
    await supabase.from('skills').delete().eq('contact_id', contactId);
    if (skills.length > 0) {
      const skillRecords = skills.map(s => ({ ...s, contact_id: contactId }));
      await supabase.from('skills').insert(skillRecords);
    }
    
    // Update linkedin_profiles table
    const nameParts = contact.name.split(' ');
    await supabase
      .from('linkedin_profiles')
      .upsert({
        contact_id: contactId,
        linkedin_url: linkedinUrl,
        full_name: contact.name,
        first_name: nameParts[0] || null,
        last_name: nameParts.slice(1).join(' ') || null,
        headline: contact.headline,
        location: contact.location,
        about: contact.about,
        profile_image_url: contact.profile_image_url,
        current_title: contact.title,
        current_company: contact.company,
        experience: contact.linkedin_data.experiences,
        education: contact.linkedin_data.educations,
        skills: contact.linkedin_data.skills,
        scrape_status: 'complete',
        scraped_at: contact.scraped_at,
      }, { onConflict: 'linkedin_url' });
    
    logger.debug(`Saved enriched profile: ${contact.name}`);
    return true;
    
  } catch (error) {
    logger.error('Error saving enriched profile:', error);
    return false;
  }
}

// ============ Lifecycle Events ============

chrome.runtime.onInstalled.addListener(async (details) => {
  logger.info(`Extension ${details.reason}: ${chrome.runtime.getManifest().version}`);
  await initialize();
  
  if (details.reason === 'install') {
    // Show badge to indicate ready
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
    chrome.action.setBadgeText({ text: '✓' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 5000);
  }
});

// Initialize on startup
initialize().catch(error => {
  logger.error('Initialization failed:', error);
});

// Error handling
self.addEventListener('error', (event) => {
  logger.error('Uncaught error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  logger.error('Unhandled rejection:', event.reason);
});

logger.info('Background service worker loaded');
