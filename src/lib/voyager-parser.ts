/**
 * Voyager Response Parser
 * 
 * Utilities for parsing LinkedIn's Voyager API responses.
 * The Voyager API returns normalized JSON with $type annotations
 * that identify the type of each entity.
 */

import type { 
  VoyagerResponse, 
  VoyagerEntity, 
  ParsedConnection,
  FullProfileData,
  ProfileExperience,
  ProfileEducation,
  ProfileSkill,
} from './voyager-client';

/**
 * Known Voyager entity types
 */
export const VOYAGER_TYPES = {
  CONNECTION: 'com.linkedin.voyager.dash.relationships.Connection',
  PROFILE: 'com.linkedin.voyager.dash.identity.profile.Profile',
  COMPANY: 'com.linkedin.voyager.dash.organization.Company',
  POSITION: 'com.linkedin.voyager.dash.identity.profile.Position',
  EDUCATION: 'com.linkedin.voyager.dash.identity.profile.Education',
  SKILL: 'com.linkedin.voyager.dash.identity.profile.Skill',
} as const;

/**
 * Extract entities of a specific type from a Voyager response
 */
export function extractEntitiesByType<T extends VoyagerEntity>(
  response: VoyagerResponse,
  type: string
): T[] {
  if (!response.included) return [];
  return response.included.filter(item => item.$type === type) as T[];
}

/**
 * Find an entity by its URN
 */
export function findEntityByUrn<T extends VoyagerEntity>(
  response: VoyagerResponse,
  urn: string
): T | undefined {
  if (!response.included) return undefined;
  return response.included.find(item => item.entityUrn === urn) as T | undefined;
}

/**
 * Parse a URN to extract the type and ID
 * Format: urn:li:type:id
 */
export function parseUrn(urn: string): { type: string; id: string } | null {
  const match = urn.match(/^urn:li:(\w+):(.+)$/);
  if (!match) return null;
  return { type: match[1], id: match[2] };
}

/**
 * Convert a Voyager timestamp (milliseconds) to ISO string
 */
export function voyagerTimestampToIso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

/**
 * Convert a Voyager timestamp to a readable date
 */
export function voyagerTimestampToDate(timestamp: number): Date {
  return new Date(timestamp);
}

/**
 * Convert ParsedConnection to our database Contact format
 */
export function connectionToContact(conn: ParsedConnection): {
  name: string;
  title: string | null;
  company: string | null;
  occupation: string | null;
  linkedin_url: string;
  profile_image_url: string | null;
  connected_at: string | null;
  location: string | null;
  source: string;
  scraped_at: string;
} {
  // Try to parse title and company from headline
  let title: string | null = null;
  let company: string | null = null;
  
  if (conn.headline) {
    const separators = [' at ', ' @ ', ' | ', ' - '];
    for (const sep of separators) {
      const idx = conn.headline.indexOf(sep);
      if (idx > 0) {
        title = conn.headline.substring(0, idx).trim();
        company = conn.headline.substring(idx + sep.length).trim();
        break;
      }
    }
    // If no separator found, treat headline as title
    if (!title) {
      title = conn.headline;
    }
  }

  return {
    name: conn.name,
    title,
    company,
    occupation: conn.headline,
    linkedin_url: conn.linkedinUrl,
    profile_image_url: conn.profileImageUrl,
    connected_at: conn.connectedAt ? voyagerTimestampToIso(conn.connectedAt) : null,
    location: conn.locationName,
    source: 'voyager_api',
    scraped_at: new Date().toISOString(),
  };
}

/**
 * Convert multiple connections to contacts
 */
export function connectionsToContacts(connections: ParsedConnection[]): ReturnType<typeof connectionToContact>[] {
  return connections.map(connectionToContact);
}

/**
 * Get pagination info from Voyager response
 */
export function getPagination(response: VoyagerResponse): {
  start: number;
  count: number;
  total: number | null;
  hasMore: boolean;
} {
  const paging = response.data?.paging;
  const elementsCount = response.data?.['*elements']?.length || 
                        response.data?.elements?.length || 0;
  
  return {
    start: paging?.start || 0,
    count: paging?.count || elementsCount,
    total: paging?.total || null,
    hasMore: elementsCount >= (paging?.count || 80),
  };
}

/**
 * Check if a Voyager response indicates an error
 */
export function isErrorResponse(response: unknown): boolean {
  if (typeof response !== 'object' || response === null) return true;
  
  const res = response as Record<string, unknown>;
  
  // Check for error indicators
  if (res.status && typeof res.status === 'number' && res.status >= 400) {
    return true;
  }
  
  if (res.errorCode || res.message) {
    return true;
  }
  
  return false;
}

/**
 * Extract error message from response
 */
export function getErrorMessage(response: unknown): string {
  if (typeof response !== 'object' || response === null) {
    return 'Invalid response';
  }
  
  const res = response as Record<string, unknown>;
  
  if (typeof res.message === 'string') {
    return res.message;
  }
  
  if (typeof res.errorCode === 'string') {
    return `Error code: ${res.errorCode}`;
  }
  
  return 'Unknown error';
}

// ============ Full Profile Conversion ============

/**
 * Format a date object to a string like "Jan 2020" or "2020"
 */
function formatDate(date: { month?: number; year?: number } | null): string | null {
  if (!date || !date.year) return null;
  
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  if (date.month && date.month >= 1 && date.month <= 12) {
    return `${months[date.month - 1]} ${date.year}`;
  }
  
  return `${date.year}`;
}

/**
 * Convert full profile to enriched contact data
 */
export function fullProfileToEnrichedContact(
  profile: FullProfileData,
  linkedinUrl: string
): {
  contact: {
    name: string;
    title: string | null;
    company: string | null;
    occupation: string | null;
    linkedin_url: string;
    profile_image_url: string | null;
    location: string | null;
    headline: string | null;
    about: string | null;
    industry: string | null;
    email: string | null;
    phone: string | null;
    website: string | null;
    needs_enrichment: boolean;
    linkedin_data: {
      experiences: Array<{
        position_title: string;
        institution_name: string;
        linkedin_url: string | null;
        from_date: string | null;
        to_date: string | null;
        location: string | null;
        description: string | null;
        is_current: boolean;
      }>;
      educations: Array<{
        institution_name: string;
        linkedin_url: string | null;
        degree: string | null;
        field_of_study: string | null;
        from_date: string | null;
        to_date: string | null;
        description: string | null;
      }>;
      skills: string[];
      certifications: Array<{
        name: string;
        authority: string | null;
      }>;
      languages: string[];
      websites: string[];
      twitter_handles: string[];
      phone_numbers: Array<{ number: string; type: string }>;
      connections_count: number | null;
      followers_count: number | null;
      birthdate: { month?: number; day?: number } | null;
    };
    scraped_at: string;
  };
  experiences: Array<{
    position_title: string;
    company_name: string;
    company_linkedin_url: string | null;
    location: string | null;
    start_date: string | null;
    end_date: string | null;
    is_current: boolean;
    description: string | null;
  }>;
  educations: Array<{
    institution_name: string;
    institution_linkedin_url: string | null;
    degree: string | null;
    field_of_study: string | null;
    start_date: string | null;
    end_date: string | null;
    description: string | null;
  }>;
  skills: Array<{
    skill_name: string;
    endorsements: number;
  }>;
} {
  const currentExp = profile.experiences.find(e => e.isCurrent);
  
  // Convert experiences
  const experiences = profile.experiences.map(exp => ({
    position_title: exp.title,
    company_name: exp.companyName,
    company_linkedin_url: exp.companyUrn 
      ? `https://www.linkedin.com/company/${exp.companyUrn.split(':').pop()}`
      : null,
    location: exp.locationName,
    start_date: formatDate(exp.startDate),
    end_date: formatDate(exp.endDate),
    is_current: exp.isCurrent,
    description: exp.description,
  }));

  // Convert educations
  const educations = profile.educations.map(edu => ({
    institution_name: edu.schoolName,
    institution_linkedin_url: edu.schoolUrn 
      ? `https://www.linkedin.com/school/${edu.schoolUrn.split(':').pop()}`
      : null,
    degree: edu.degreeName,
    field_of_study: edu.fieldOfStudy,
    start_date: formatDate(edu.startDate),
    end_date: formatDate(edu.endDate),
    description: edu.description,
  }));

  // Convert skills
  const skills = profile.skills.map(skill => ({
    skill_name: skill.name,
    endorsements: skill.endorsementCount,
  }));

  // Get primary phone and website for top-level fields
  const primaryPhone = profile.phoneNumbers?.[0]?.number || null;
  const primaryWebsite = profile.websites?.[0] || null;

  return {
    contact: {
      name: `${profile.firstName} ${profile.lastName}`.trim(),
      title: currentExp?.title || null,
      company: currentExp?.companyName || null,
      occupation: profile.headline,
      linkedin_url: linkedinUrl,
      profile_image_url: profile.profileImageUrl,
      location: profile.locationName,
      headline: profile.headline,
      about: profile.summary,
      industry: profile.industryName,
      email: profile.emailAddress || null,
      phone: primaryPhone,
      website: primaryWebsite,
      needs_enrichment: false,
      linkedin_data: {
        experiences: experiences.map(e => ({
          position_title: e.position_title,
          institution_name: e.company_name,
          linkedin_url: e.company_linkedin_url,
          from_date: e.start_date,
          to_date: e.end_date,
          location: e.location,
          description: e.description,
          is_current: e.is_current,
        })),
        educations: educations.map(e => ({
          institution_name: e.institution_name,
          linkedin_url: e.institution_linkedin_url,
          degree: e.degree,
          field_of_study: e.field_of_study,
          from_date: e.start_date,
          to_date: e.end_date,
          description: e.description,
        })),
        skills: profile.skills.map(s => s.name),
        certifications: profile.certifications.map(c => ({
          name: c.name,
          authority: c.authority,
        })),
        languages: profile.languages,
        websites: profile.websites,
        twitter_handles: profile.twitterHandles || [],
        phone_numbers: profile.phoneNumbers || [],
        connections_count: profile.connectionsCount,
        followers_count: profile.followersCount,
        birthdate: profile.birthdate || null,
      },
      scraped_at: new Date().toISOString(),
    },
    experiences,
    educations,
    skills,
  };
}

