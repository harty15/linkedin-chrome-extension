/**
 * LinkedIn Voyager API Client
 * 
 * Calls LinkedIn's internal Voyager API directly using captured
 * authentication headers. This is the same approach used by
 * Harmonic and other LinkedIn extensions.
 * 
 * The Voyager API returns structured JSON data, eliminating the
 * need for DOM scraping.
 */

import { createLogger } from './logger';
import type { LinkedInHeaders } from '@/background/header-interceptor';

const logger = createLogger('voyager-client');

// API Configuration (based on Harmonic's implementation)
const VOYAGER_BASE_URL = 'https://www.linkedin.com/voyager/api';

const ENDPOINTS = {
  CONNECTIONS: '/relationships/dash/connections',
  PROFILE: '/identity/dash/profiles',
};

// Decoration ID for connections with profile data
const CONNECTIONS_DECORATION_ID = 
  'com.linkedin.voyager.dash.deco.web.mynetwork.ConnectionListWithProfile-16';

// Rate limiting configuration (from Harmonic)
const RATE_LIMIT = {
  CONNECTIONS_PER_REQUEST: 80,
  MAX_CONNECTIONS: 30000,
  DELAY_BETWEEN_REQUESTS_MS: 1000,
  RETRY_DELAY_MS: 2000,
  MAX_RETRIES: 3,
};

/**
 * Voyager API response types
 */
export interface VoyagerResponse {
  data: {
    '*elements'?: string[];
    elements?: unknown[];
    paging?: {
      count: number;
      start: number;
      total?: number;
    };
  };
  included: VoyagerEntity[];
}

export interface VoyagerEntity {
  $type: string;
  entityUrn?: string;
  [key: string]: unknown;
}

export interface VoyagerConnection {
  $type: 'com.linkedin.voyager.dash.relationships.Connection';
  entityUrn: string;
  connectedMember: string;
  createdAt: number;
}

export interface VoyagerProfile {
  $type: 'com.linkedin.voyager.dash.identity.profile.Profile';
  entityUrn: string;
  publicIdentifier: string;
  firstName: string;
  lastName: string;
  headline?: string;
  profilePicture?: {
    displayImageReference?: {
      vectorImage?: {
        rootUrl?: string;
        artifacts?: Array<{
          width: number;
          height: number;
          fileIdentifyingUrlPathSegment: string;
        }>;
      };
    };
  };
  industryUrn?: string;
  locationName?: string;
  geoLocationName?: string;
}

/**
 * Build headers for Voyager API request
 */
function buildRequestHeaders(linkedInHeaders: LinkedInHeaders): Record<string, string> {
  return {
    'accept': 'application/vnd.linkedin.normalized+json+2.1',
    'accept-encoding': 'gzip, deflate, br',
    'accept-language': 'en-US,en;q=0.9',
    'x-li-lang': linkedInHeaders['x-li-lang'] || 'en_US',
    'x-li-page-instance': linkedInHeaders['x-li-page-instance'] || '',
    'x-li-track': linkedInHeaders['x-li-track'] || '',
    'x-restli-protocol-version': linkedInHeaders['x-restli-protocol-version'] || '2.0.0',
    'csrf-token': linkedInHeaders['csrf-token'] || '',
  };
}

/**
 * Sleep utility for rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with retry logic
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = RATE_LIMIT.MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, options);

      if (response.status === 429) {
        // Rate limited - wait and retry with exponential backoff
        const backoffMs = RATE_LIMIT.RETRY_DELAY_MS * Math.pow(2, attempt);
        logger.warn(`Rate limited (429), waiting ${backoffMs}ms before retry ${attempt + 1}/${retries}`);
        await sleep(backoffMs);
        continue;
      }

      if (response.status === 410) {
        // Gone - profile unavailable or blocked, don't retry
        throw new Error(`HTTP 410: Profile unavailable or access blocked`);
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on 410 or 403 (blocked/forbidden)
      if (lastError.message.includes('410') || lastError.message.includes('403')) {
        throw lastError;
      }

      logger.warn(`Request failed, attempt ${attempt + 1}/${retries}:`, lastError.message);

      if (attempt < retries - 1) {
        await sleep(RATE_LIMIT.RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }

  throw lastError || new Error('Request failed after retries');
}

/**
 * Fetch a page of connections from LinkedIn
 */
export async function fetchConnectionsPage(
  start: number,
  count: number,
  headers: LinkedInHeaders
): Promise<VoyagerResponse> {
  const url = new URL(`${VOYAGER_BASE_URL}${ENDPOINTS.CONNECTIONS}`);
  url.searchParams.set('decorationId', CONNECTIONS_DECORATION_ID);
  url.searchParams.set('count', String(count));
  url.searchParams.set('q', 'search');
  url.searchParams.set('sortType', 'RECENTLY_ADDED');
  url.searchParams.set('start', String(start));

  logger.debug(`Fetching connections: start=${start}, count=${count}`);

  const response = await fetchWithRetry(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: buildRequestHeaders(headers),
  });

  const data = await response.json();
  return data as VoyagerResponse;
}

/**
 * Fetch all connections (paginated)
 */
export async function fetchAllConnections(
  headers: LinkedInHeaders,
  onProgress?: (fetched: number, total: number | null) => void,
  mostRecentUrl?: string // Stop when we see this URL (for incremental sync)
): Promise<{ connections: ParsedConnection[]; total: number }> {
  const allConnections: ParsedConnection[] = [];
  let start = 0;
  let total: number | null = null;
  let foundMostRecent = false;

  logger.info('Starting to fetch all connections');

  while (start < RATE_LIMIT.MAX_CONNECTIONS && !foundMostRecent) {
    const response = await fetchConnectionsPage(
      start,
      RATE_LIMIT.CONNECTIONS_PER_REQUEST,
      headers
    );

    // Parse this page
    const pageConnections = parseConnectionsResponse(response);
    
    if (pageConnections.length === 0) {
      logger.info('No more connections found');
      break;
    }

    // Check for most recent URL (incremental sync)
    if (mostRecentUrl) {
      const recentIndex = pageConnections.findIndex(c => c.linkedinUrl === mostRecentUrl);
      if (recentIndex !== -1) {
        // Only include connections before the most recent
        allConnections.push(...pageConnections.slice(0, recentIndex));
        foundMostRecent = true;
        logger.info(`Found most recent connection at index ${recentIndex}, stopping`);
        break;
      }
    }

    allConnections.push(...pageConnections);

    // Get total from response if available
    if (response.data?.paging?.total && total === null) {
      total = response.data.paging.total;
    }

    // Get count from elements
    const elementsCount = response.data?.['*elements']?.length || 
                          response.data?.elements?.length || 0;

    // Report progress
    if (onProgress) {
      onProgress(allConnections.length, total);
    }

    logger.debug(`Fetched ${allConnections.length} connections so far`);

    // Check if we've reached the end
    if (elementsCount < RATE_LIMIT.CONNECTIONS_PER_REQUEST) {
      logger.info('Reached end of connections list');
      break;
    }

    // Rate limiting
    start += RATE_LIMIT.CONNECTIONS_PER_REQUEST;
    await sleep(RATE_LIMIT.DELAY_BETWEEN_REQUESTS_MS);
  }

  logger.info(`Finished fetching ${allConnections.length} connections`);

  return {
    connections: allConnections,
    total: total || allConnections.length,
  };
}

/**
 * Parsed connection data
 */
export interface ParsedConnection {
  linkedinUrl: string;
  publicIdentifier: string;
  firstName: string;
  lastName: string;
  name: string;
  headline: string | null;
  profileImageUrl: string | null;
  locationName: string | null;
  connectedAt: number; // Unix timestamp
  entityUrn: string;
}

/**
 * Parse connections from Voyager response
 */
function parseConnectionsResponse(response: VoyagerResponse): ParsedConnection[] {
  if (!response.included) {
    logger.warn('No included data in response');
    return [];
  }

  // Extract connections and profiles
  const connections = response.included.filter(
    (item) =>
      item.$type === 'com.linkedin.voyager.dash.relationships.Connection'
  ) as unknown as VoyagerConnection[];

  const profiles = response.included.filter(
    (item) =>
      item.$type === 'com.linkedin.voyager.dash.identity.profile.Profile'
  ) as unknown as VoyagerProfile[];

  // Map connections to profiles
  return connections
    .map(conn => {
      const profile = profiles.find(p => p.entityUrn === conn.connectedMember);
      
      if (!profile || !profile.publicIdentifier) {
        return null;
      }

      // Get profile image URL
      let profileImageUrl: string | null = null;
      const picture = profile.profilePicture?.displayImageReference?.vectorImage;
      if (picture?.rootUrl && picture.artifacts?.length) {
        // Get the largest artifact
        const largest = picture.artifacts.reduce((prev: any, curr: any) =>
          (curr.width > prev.width) ? curr : prev
        );
        profileImageUrl = `${picture.rootUrl}${largest.fileIdentifyingUrlPathSegment}`;
      }

      return {
        linkedinUrl: `https://www.linkedin.com/in/${profile.publicIdentifier}`,
        publicIdentifier: profile.publicIdentifier,
        firstName: profile.firstName || '',
        lastName: profile.lastName || '',
        name: `${profile.firstName || ''} ${profile.lastName || ''}`.trim(),
        headline: profile.headline || null,
        profileImageUrl,
        locationName: profile.geoLocationName || profile.locationName || null,
        connectedAt: conn.createdAt,
        entityUrn: profile.entityUrn || '',
      };
    })
    .filter((c): c is ParsedConnection => c !== null)
    .sort((a, b) => b.connectedAt - a.connectedAt); // Most recent first
}

// Re-export parseConnectionsResponse for use in voyager-parser
export { parseConnectionsResponse };

// ============ Full Profile Fetching ============

/**
 * Voyager profile response types
 */
export interface VoyagerProfileResponse {
  data: Record<string, unknown>;
  included: VoyagerProfileEntity[];
}

export interface VoyagerProfileEntity {
  $type: string;
  entityUrn?: string;
  [key: string]: unknown;
}

/**
 * Full profile data structure
 */
export interface FullProfileData {
  // Basic info
  publicIdentifier: string;
  firstName: string;
  lastName: string;
  headline: string | null;
  summary: string | null; // "about" section
  locationName: string | null;
  industryName: string | null;
  profileImageUrl: string | null;
  backgroundImageUrl: string | null;
  
  // Stats
  connectionsCount: number | null;
  followersCount: number | null;
  
  // Contact info (from /profileContactInfo endpoint)
  emailAddress?: string | null;
  phoneNumbers?: Array<{ number: string; type: string }>;
  twitterHandles?: string[];
  birthdate?: { month?: number; day?: number } | null;
  
  // Rich data
  experiences: ProfileExperience[];
  educations: ProfileEducation[];
  skills: ProfileSkill[];
  certifications: ProfileCertification[];
  languages: string[];
  websites: string[];
}

export interface ProfileExperience {
  title: string;
  companyName: string;
  companyUrn: string | null;
  companyLogoUrl: string | null;
  locationName: string | null;
  description: string | null;
  startDate: { month?: number; year?: number } | null;
  endDate: { month?: number; year?: number } | null;
  isCurrent: boolean;
}

export interface ProfileEducation {
  schoolName: string;
  schoolUrn: string | null;
  schoolLogoUrl: string | null;
  degreeName: string | null;
  fieldOfStudy: string | null;
  description: string | null;
  startDate: { month?: number; year?: number } | null;
  endDate: { month?: number; year?: number } | null;
  activities: string | null;
}

export interface ProfileSkill {
  name: string;
  endorsementCount: number;
}

export interface ProfileCertification {
  name: string;
  authority: string | null;
  licenseNumber: string | null;
  displaySource: string | null;
  url: string | null;
  startDate: { month?: number; year?: number } | null;
  endDate: { month?: number; year?: number } | null;
}

/**
 * Fetch full profile data for a person
 * Uses multiple endpoints like the linkedin-api Python library:
 * - /identity/profiles/{id}/profileView - main profile data
 * - /identity/profiles/{id}/profileContactInfo - email, phone, etc.
 * - /identity/profiles/{id}/skills - detailed skills
 */
export async function fetchFullProfile(
  publicIdentifier: string,
  headers: LinkedInHeaders
): Promise<FullProfileData | null> {
  logger.info(`Fetching full profile for: ${publicIdentifier}`);

  try {
    // Fetch all profile data in parallel for speed
    const [profileData, contactInfo, skillsData] = await Promise.all([
      fetchProfileView(publicIdentifier, headers),
      fetchProfileContactInfo(publicIdentifier, headers),
      fetchProfileSkills(publicIdentifier, headers),
    ]);

    if (!profileData) {
      logger.warn(`No profile data for ${publicIdentifier}`);
      return null;
    }

    // Merge contact info into profile
    if (contactInfo) {
      profileData.emailAddress = contactInfo.emailAddress || null;
      profileData.phoneNumbers = contactInfo.phoneNumbers || [];
      profileData.twitterHandles = contactInfo.twitterHandles || [];
      profileData.websites = contactInfo.websites || profileData.websites;
      profileData.birthdate = contactInfo.birthdate || null;
    }

    // Use skills from dedicated endpoint if available (more complete)
    if (skillsData && skillsData.length > 0) {
      profileData.skills = skillsData;
    }

    return profileData;
  } catch (error) {
    logger.error(`Failed to fetch profile for ${publicIdentifier}:`, error);
    return null;
  }
}

/**
 * Fetch main profile view (experience, education, about, etc.)
 * 
 * LinkedIn's profileView endpoint may include experiences/educations
 * in the 'included' array, or they may need to be fetched from
 * separate endpoints like /positions and /educations
 */
async function fetchProfileView(
  publicIdentifier: string,
  headers: LinkedInHeaders
): Promise<FullProfileData | null> {
  try {
    const url = `${VOYAGER_BASE_URL}/identity/profiles/${publicIdentifier}/profileView`;
    const response = await fetchWithRetry(url, {
      method: 'GET',
      credentials: 'include',
      headers: buildRequestHeaders(headers),
    });
    const data = await response.json() as VoyagerProfileResponse;
    
    // Log the response structure for debugging
    logger.debug(`ProfileView response keys:`, Object.keys(data));
    if (data.data) {
      logger.debug(`ProfileView data keys:`, Object.keys(data.data));
    }
    
    // Parse basic profile from profileView
    let profile = parseFullProfile(data, publicIdentifier);
    
    // If no experiences found in profileView, try dedicated positions endpoint
    if (profile && profile.experiences.length === 0) {
      logger.info(`No experiences in profileView, trying positions endpoint for ${publicIdentifier}`);
      const positions = await fetchProfilePositions(publicIdentifier, headers);
      if (positions.length > 0) {
        profile.experiences = positions;
      }
    }
    
    // If no educations found, try dedicated educations endpoint
    if (profile && profile.educations.length === 0) {
      logger.info(`No educations in profileView, trying educations endpoint for ${publicIdentifier}`);
      const educations = await fetchProfileEducations(publicIdentifier, headers);
      if (educations.length > 0) {
        profile.educations = educations;
      }
    }
    
    return profile;
  } catch (error) {
    logger.error(`Failed to fetch profileView for ${publicIdentifier}:`, error);
    return null;
  }
}

/**
 * Fetch profile positions/experiences from dedicated endpoint
 */
async function fetchProfilePositions(
  publicIdentifier: string,
  headers: LinkedInHeaders
): Promise<ProfileExperience[]> {
  try {
    // Try the positions endpoint
    const url = `${VOYAGER_BASE_URL}/identity/profiles/${publicIdentifier}/positions`;
    const response = await fetchWithRetry(url, {
      method: 'GET',
      credentials: 'include',
      headers: buildRequestHeaders(headers),
    });
    const data = await response.json();
    
    logger.debug(`Positions response for ${publicIdentifier}:`, Object.keys(data));
    
    return parsePositionsResponse(data);
  } catch (error) {
    logger.debug(`Failed to fetch positions for ${publicIdentifier}:`, error);
    return [];
  }
}

/**
 * Fetch profile educations from dedicated endpoint
 */
async function fetchProfileEducations(
  publicIdentifier: string,
  headers: LinkedInHeaders
): Promise<ProfileEducation[]> {
  try {
    const url = `${VOYAGER_BASE_URL}/identity/profiles/${publicIdentifier}/educations`;
    const response = await fetchWithRetry(url, {
      method: 'GET',
      credentials: 'include',
      headers: buildRequestHeaders(headers),
    });
    const data = await response.json();
    
    logger.debug(`Educations response for ${publicIdentifier}:`, Object.keys(data));
    
    return parseEducationsResponse(data);
  } catch (error) {
    logger.debug(`Failed to fetch educations for ${publicIdentifier}:`, error);
    return [];
  }
}

/**
 * Parse positions response from dedicated endpoint
 */
function parsePositionsResponse(data: unknown): ProfileExperience[] {
  if (!data || typeof data !== 'object') return [];

  const d = data as Record<string, unknown>;

  // Try different response structures
  const dataObj = d.data as Record<string, unknown> | undefined;
  const elements = d.elements || dataObj?.elements || d.included || [];
  
  if (!Array.isArray(elements)) return [];
  
  return elements
    .filter((item: any) => 
      item.$type?.includes('Position') || 
      item.title || 
      item.companyName
    )
    .map((pos: any) => {
      const timePeriod = pos.timePeriod as Record<string, unknown> | undefined;
      const dateRange = pos.dateRange as Record<string, unknown> | undefined;
      const startDate = timePeriod?.startDate || dateRange?.start || null;
      const endDate = timePeriod?.endDate || dateRange?.end || null;
      
      return {
        title: pos.title || '',
        companyName: pos.companyName || '',
        companyUrn: pos.companyUrn || pos['*company'] || null,
        companyLogoUrl: null,
        locationName: pos.locationName || pos.location || null,
        description: pos.description || null,
        startDate: startDate ? normalizeDate(startDate) : null,
        endDate: endDate ? normalizeDate(endDate) : null,
        isCurrent: !endDate,
      };
    })
    .filter((exp: ProfileExperience) => exp.title || exp.companyName);
}

/**
 * Parse educations response from dedicated endpoint
 */
function parseEducationsResponse(data: unknown): ProfileEducation[] {
  if (!data || typeof data !== 'object') return [];

  const d = data as Record<string, unknown>;

  // Try different response structures
  const dataObj = d.data as Record<string, unknown> | undefined;
  const elements = d.elements || dataObj?.elements || d.included || [];
  
  if (!Array.isArray(elements)) return [];
  
  return elements
    .filter((item: any) => 
      item.$type?.includes('Education') || 
      item.schoolName
    )
    .map((edu: any) => {
      const timePeriod = edu.timePeriod as Record<string, unknown> | undefined;
      const dateRange = edu.dateRange as Record<string, unknown> | undefined;
      const startDate = timePeriod?.startDate || dateRange?.start || null;
      const endDate = timePeriod?.endDate || dateRange?.end || null;
      
      return {
        schoolName: edu.schoolName || '',
        schoolUrn: edu.schoolUrn || edu['*school'] || null,
        schoolLogoUrl: null,
        degreeName: edu.degreeName || edu.degree || null,
        fieldOfStudy: edu.fieldOfStudy || edu.field || null,
        description: edu.description || null,
        startDate: startDate ? normalizeDate(startDate) : null,
        endDate: endDate ? normalizeDate(endDate) : null,
        activities: edu.activities || null,
      };
    })
    .filter((edu: ProfileEducation) => edu.schoolName);
}

/**
 * Fetch profile contact info (email, phone, Twitter, etc.)
 * Endpoint: /identity/profiles/{id}/profileContactInfo
 */
async function fetchProfileContactInfo(
  publicIdentifier: string,
  headers: LinkedInHeaders
): Promise<ProfileContactInfo | null> {
  try {
    const url = `${VOYAGER_BASE_URL}/identity/profiles/${publicIdentifier}/profileContactInfo`;
    const response = await fetchWithRetry(url, {
      method: 'GET',
      credentials: 'include',
      headers: buildRequestHeaders(headers),
    });
    const data = await response.json();
    return parseContactInfo(data);
  } catch (error) {
    // Contact info might be private - don't error
    logger.debug(`No contact info for ${publicIdentifier}:`, error);
    return null;
  }
}

/**
 * Fetch profile skills with endorsements
 * Endpoint: /identity/profiles/{id}/skills
 */
async function fetchProfileSkills(
  publicIdentifier: string,
  headers: LinkedInHeaders
): Promise<ProfileSkill[] | null> {
  try {
    const url = `${VOYAGER_BASE_URL}/identity/profiles/${publicIdentifier}/skills`;
    const response = await fetchWithRetry(url, {
      method: 'GET',
      credentials: 'include',
      headers: buildRequestHeaders(headers),
    });
    const data = await response.json();
    return parseSkills(data);
  } catch (error) {
    logger.debug(`No skills data for ${publicIdentifier}:`, error);
    return null;
  }
}

/**
 * Contact info structure
 */
interface ProfileContactInfo {
  emailAddress: string | null;
  phoneNumbers: Array<{ number: string; type: string }>;
  twitterHandles: string[];
  websites: string[];
  birthdate: { month?: number; day?: number } | null;
}

/**
 * Parse contact info response
 */
function parseContactInfo(data: unknown): ProfileContactInfo | null {
  if (!data || typeof data !== 'object') return null;
  
  const d = data as Record<string, unknown>;
  
  return {
    emailAddress: (d.emailAddress as string) || null,
    phoneNumbers: Array.isArray(d.phoneNumbers) 
      ? d.phoneNumbers.map((p: any) => ({ number: p.number || '', type: p.type || '' }))
      : [],
    twitterHandles: Array.isArray(d.twitterHandles) 
      ? d.twitterHandles.map((t: any) => t.name || t)
      : [],
    websites: Array.isArray(d.websites)
      ? d.websites.map((w: any) => w.url || w)
      : [],
    birthdate: d.birthdate ? {
      month: (d.birthdate as any).month,
      day: (d.birthdate as any).day,
    } : null,
  };
}

/**
 * Parse skills response
 */
function parseSkills(data: unknown): ProfileSkill[] {
  if (!data || typeof data !== 'object') return [];

  const d = data as Record<string, unknown>;
  const dataObj = d.data as Record<string, unknown> | undefined;
  const elements = d.elements || dataObj?.elements || d.included;
  
  if (!Array.isArray(elements)) return [];
  
  return elements
    .filter((e: any) => e.name || e.skill?.name)
    .map((e: any) => ({
      name: e.name || e.skill?.name || '',
      endorsementCount: e.endorsementCount || e.endorsements || 0,
    }));
}

/**
 * Parse full profile from Voyager response
 * 
 * LinkedIn's API returns data in different structures depending on the endpoint.
 * This parser handles multiple formats.
 */
function parseFullProfile(
  response: VoyagerProfileResponse,
  publicIdentifier: string
): FullProfileData | null {
  if (!response.included || response.included.length === 0) {
    logger.warn('No included data in profile response');
    return null;
  }

  // Log all $type values for debugging
  const types = new Set(response.included.map(item => item.$type).filter(Boolean));
  logger.debug(`Profile ${publicIdentifier} - Found entity types:`, Array.from(types));

  // Find the main profile entity (try multiple patterns)
  const profile = response.included.find(
    item => item.$type?.includes('profile.Profile') || 
            item.$type?.includes('identity.profile.Profile') ||
            item.publicIdentifier === publicIdentifier
  );

  if (!profile) {
    logger.warn(`No profile entity found for ${publicIdentifier}`);
    return null;
  }

  // Extract experiences (try multiple $type patterns)
  const experiences: ProfileExperience[] = response.included
    .filter(item => 
      item.$type?.includes('Position') || 
      item.$type?.includes('position') ||
      item.$type?.includes('Experience')
    )
    .map(pos => {
      // Handle different field naming conventions
      const timePeriod = pos.timePeriod as Record<string, unknown> | undefined;
      const dateRange = pos.dateRange as Record<string, unknown> | undefined;
      const startDate = timePeriod?.startDate || dateRange?.start || pos.startDate || null;
      const endDate = timePeriod?.endDate || dateRange?.end || pos.endDate || null;
      
      return {
        title: (pos.title as string) || (pos.jobTitle as string) || '',
        companyName: (pos.companyName as string) || (pos.company as string) || '',
        companyUrn: (pos.companyUrn as string) || (pos['*company'] as string) || null,
        companyLogoUrl: extractLogoUrl(pos.companyLogo || pos.logo || (pos.miniCompany as Record<string, unknown> | undefined)?.logo),
        locationName: (pos.locationName as string) || (pos.location as string) || null,
        description: (pos.description as string) || null,
        startDate: startDate ? normalizeDate(startDate) : null,
        endDate: endDate ? normalizeDate(endDate) : null,
        isCurrent: !endDate,
      };
    })
    .filter(exp => exp.title || exp.companyName); // Only include if there's meaningful data

  // Extract educations (try multiple $type patterns)
  const educations: ProfileEducation[] = response.included
    .filter(item => 
      item.$type?.includes('Education') || 
      item.$type?.includes('education')
    )
    .map(edu => {
      const timePeriod = edu.timePeriod as Record<string, unknown> | undefined;
      const dateRange = edu.dateRange as Record<string, unknown> | undefined;
      const startDate = timePeriod?.startDate || dateRange?.start || edu.startDate || null;
      const endDate = timePeriod?.endDate || dateRange?.end || edu.endDate || null;
      
      return {
        schoolName: (edu.schoolName as string) || (edu.school as string) || '',
        schoolUrn: (edu.schoolUrn as string) || (edu['*school'] as string) || null,
        schoolLogoUrl: extractLogoUrl(edu.schoolLogo || edu.logo || (edu.miniSchool as Record<string, unknown> | undefined)?.logo),
        degreeName: (edu.degreeName as string) || (edu.degree as string) || null,
        fieldOfStudy: (edu.fieldOfStudy as string) || (edu.field as string) || null,
        description: (edu.description as string) || null,
        startDate: startDate ? normalizeDate(startDate) : null,
        endDate: endDate ? normalizeDate(endDate) : null,
        activities: (edu.activities as string) || null,
      };
    })
    .filter(edu => edu.schoolName); // Only include if there's a school name

  // Extract skills (try multiple $type patterns)
  const skills: ProfileSkill[] = response.included
    .filter(item => 
      item.$type?.includes('Skill') || 
      item.$type?.includes('skill')
    )
    .map(skill => ({
      name: (skill.name as string) || '',
      endorsementCount: (skill.endorsementCount as number) || (skill.endorsements as number) || 0,
    }))
    .filter(s => s.name);

  // Extract certifications
  const certifications: ProfileCertification[] = response.included
    .filter(item => item.$type?.includes('Certification'))
    .map(cert => ({
      name: (cert.name as string) || '',
      authority: (cert.authority as string) || null,
      licenseNumber: (cert.licenseNumber as string) || null,
      displaySource: (cert.displaySource as string) || null,
      url: (cert.url as string) || null,
      startDate: cert.timePeriod ? normalizeDate((cert.timePeriod as Record<string, unknown>).startDate) : null,
      endDate: cert.timePeriod ? normalizeDate((cert.timePeriod as Record<string, unknown>).endDate) : null,
    }));

  // Extract languages
  const languages: string[] = response.included
    .filter(item => item.$type?.includes('Language'))
    .map(lang => (lang.name as string) || '')
    .filter(Boolean);

  // Extract websites
  const websites: string[] = response.included
    .filter(item => item.$type?.includes('Website'))
    .map(site => (site.url as string) || '')
    .filter(Boolean);

  // Get profile image
  let profileImageUrl: string | null = null;
  const miniProfile = profile.miniProfile as Record<string, unknown> | undefined;
  const picture = profile.profilePicture || miniProfile?.picture || profile.picture;
  if (picture) {
    profileImageUrl = extractProfileImageUrl(picture);
  }

  // Get background image
  let backgroundImageUrl: string | null = null;
  const bgImage = profile.backgroundImage || profile.backgroundPicture;
  if (bgImage) {
    backgroundImageUrl = extractProfileImageUrl(bgImage);
  }

  // Get connection/follower counts from various locations
  const connectionsCount = (profile.connectionCount as number) ||
                           (profile.connections as number) ||
                           (profile.numConnections as number) || null;
  const followingInfo = profile.followingInfo as Record<string, unknown> | undefined;
  const followersCount = (followingInfo?.followerCount as number) || 
                         (profile.followerCount as number) ||
                         (profile.numFollowers as number) || null;

  logger.info(`Parsed profile ${publicIdentifier}: ${experiences.length} exp, ${educations.length} edu, ${skills.length} skills`);

  return {
    publicIdentifier,
    firstName: (profile.firstName as string) || '',
    lastName: (profile.lastName as string) || '',
    headline: (profile.headline as string) || null,
    summary: (profile.summary as string) || (profile.about as string) || null,
    locationName: (profile.locationName as string) || (profile.geoLocationName as string) || (profile.location as string) || null,
    industryName: (profile.industryName as string) || (profile.industry as string) || null,
    profileImageUrl,
    backgroundImageUrl,
    connectionsCount,
    followersCount,
    experiences,
    educations,
    skills,
    certifications,
    languages,
    websites,
  };
}

/**
 * Normalize date objects from various API formats
 */
function normalizeDate(date: unknown): { month?: number; year?: number } | null {
  if (!date || typeof date !== 'object') return null;
  
  const d = date as Record<string, unknown>;
  const year = d.year as number | undefined;
  const month = d.month as number | undefined;
  
  if (!year) return null;
  
  return { year, month };
}

/**
 * Extract logo URL from Voyager logo object
 */
function extractLogoUrl(logo: unknown): string | null {
  if (!logo || typeof logo !== 'object') return null;
  
  const logoObj = logo as Record<string, unknown>;
  const vectorImage = logoObj.vectorImage || logoObj.image;
  
  if (vectorImage && typeof vectorImage === 'object') {
    const vi = vectorImage as Record<string, unknown>;
    if (vi.rootUrl && Array.isArray(vi.artifacts) && vi.artifacts.length > 0) {
      const artifact = vi.artifacts[vi.artifacts.length - 1] as Record<string, string>;
      return `${vi.rootUrl}${artifact.fileIdentifyingUrlPathSegment || ''}`;
    }
  }
  
  return null;
}

/**
 * Extract profile image URL from Voyager picture object
 */
function extractProfileImageUrl(picture: unknown): string | null {
  if (!picture || typeof picture !== 'object') return null;
  
  const pic = picture as Record<string, unknown>;
  const displayImage = pic.displayImageReference || pic.displayImage;
  
  if (displayImage && typeof displayImage === 'object') {
    const di = displayImage as Record<string, unknown>;
    const vectorImage = di.vectorImage;
    
    if (vectorImage && typeof vectorImage === 'object') {
      const vi = vectorImage as Record<string, unknown>;
      if (vi.rootUrl && Array.isArray(vi.artifacts) && vi.artifacts.length > 0) {
        // Get the largest artifact
        const artifacts = vi.artifacts as Array<Record<string, unknown>>;
        const largest = artifacts.reduce((prev, curr) => 
          ((curr.width as number) > (prev.width as number)) ? curr : prev
        );
        return `${vi.rootUrl}${largest.fileIdentifyingUrlPathSegment || ''}`;
      }
    }
  }
  
  return null;
}

/**
 * Enrich multiple profiles with rate limiting
 */
export async function enrichProfiles(
  publicIdentifiers: string[],
  headers: LinkedInHeaders,
  onProgress?: (completed: number, total: number, profile: FullProfileData | null) => void,
  delayMs = 2000
): Promise<Map<string, FullProfileData>> {
  const results = new Map<string, FullProfileData>();
  
  logger.info(`Starting profile enrichment for ${publicIdentifiers.length} profiles`);
  
  for (let i = 0; i < publicIdentifiers.length; i++) {
    const identifier = publicIdentifiers[i];
    
    try {
      const profile = await fetchFullProfile(identifier, headers);
      
      if (profile) {
        results.set(identifier, profile);
        logger.debug(`Enriched profile ${i + 1}/${publicIdentifiers.length}: ${identifier}`);
      }
      
      if (onProgress) {
        onProgress(i + 1, publicIdentifiers.length, profile);
      }
      
      // Rate limiting between requests
      if (i < publicIdentifiers.length - 1) {
        await sleep(delayMs);
      }
    } catch (error) {
      logger.error(`Failed to enrich ${identifier}:`, error);
      if (onProgress) {
        onProgress(i + 1, publicIdentifiers.length, null);
      }
    }
  }
  
  logger.info(`Profile enrichment complete: ${results.size}/${publicIdentifiers.length} successful`);
  
  return results;
}

