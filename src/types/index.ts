// LinkedIn Contact Data (basic info from connections list)
export interface LinkedInContact {
  name: string;
  title: string | null;
  company: string | null;
  occupation: string | null; // Original combined field (headline)
  linkedin_url: string;
  profile_image_url: string | null;
  connected_at: string | null;
  scraped_at: string;
  source: 'bulk_import' | 'quick_add' | 'incremental';
}

// Full profile data (from visiting individual profile pages)
export interface LinkedInProfile extends LinkedInContact {
  location: string | null;
  about: string | null;
  open_to_work: boolean;
  experiences: Experience[];
  educations: Education[];
  skills: string[];
  mutual_connections: number | null;
}

// Experience entry (from /details/experience page)
export interface Experience {
  position_title: string;
  institution_name: string; // Company name
  linkedin_url: string | null; // Company LinkedIn URL
  from_date: string | null;
  to_date: string | null; // null if current position
  duration: string | null;
  location: string | null;
  description: string | null;
}

// Education entry (from /details/education page)
export interface Education {
  institution_name: string; // School name
  linkedin_url: string | null; // School LinkedIn URL
  degree: string | null;
  field_of_study: string | null;
  from_date: string | null;
  to_date: string | null;
  description: string | null;
}

// Sync State
export interface SyncState {
  status: SyncStatus;
  progress: SyncProgress;
  last_sync: number | null;
  total_synced: number;
  error: string | null;
}

export type SyncStatus = 'idle' | 'syncing' | 'paused' | 'completed' | 'error';

export interface SyncProgress {
  current: number;
  total: number | null;
  batch_number: number;
  started_at: number;
}

// Auth State
export interface AuthState {
  is_authenticated: boolean;
  user: User | null;
  token: string | null;
}

export interface User {
  id: string;
  email: string;
  name: string;
}

// API Responses
export interface BulkImportResponse {
  success: boolean;
  new_count: number;
  updated_count: number;
  skipped_count: number;
  duration_ms: number;
}

export interface QuickAddResponse {
  success: boolean;
  status: 'created' | 'updated';
  contact: {
    id: string;
    name: string;
  };
}

export interface ContactExistsResponse {
  exists: boolean;
  contact: {
    id: string;
    name: string;
    last_contact: string | null;
    relationship_score: number | null;
  } | null;
}

// Messages between extension components
export type MessageType =
  | 'START_BULK_SYNC'
  | 'STOP_SYNC'
  | 'PAUSE_SYNC'
  | 'RESUME_SYNC'
  | 'BATCH_CONTACTS'
  | 'SYNC_PROGRESS'
  | 'SYNC_COMPLETE'
  | 'SYNC_ERROR'
  | 'QUICK_ADD_CONTACT'
  | 'CHECK_CONTACT_EXISTS'
  | 'GET_SYNC_STATUS'
  | 'GET_AUTH_STATUS'
  | 'SIGN_IN'
  | 'SIGN_OUT'
  | 'CHECK_ENRICHMENT_MODE'
  | 'PROFILE_SCRAPED'
  | 'START_ENRICHMENT'
  | 'LINKEDIN_ACTIVITY';

export interface ExtensionMessage<T = unknown> {
  type: MessageType;
  data?: T;
}

export interface MessageResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// Storage Keys
export const STORAGE_KEYS = {
  AUTH_TOKEN: 'auth_token',
  USER: 'user',
  SYNC_STATE: 'sync_state',
  RATE_LIMIT_STATE: 'rate_limit_state',
  SETTINGS: 'settings',
} as const;

// Settings
export interface ExtensionSettings {
  api_url: string;
  auto_sync_enabled: boolean;
  auto_sync_time: string; // "09:00"
  rate_limit_per_hour: number;
  rate_limit_per_day: number;
  show_notifications: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  api_url: import.meta.env.VITE_API_URL || 'http://localhost:3000',
  auto_sync_enabled: true,
  auto_sync_time: '09:00',
  rate_limit_per_hour: 200,
  rate_limit_per_day: 1000,
  show_notifications: true,
};

