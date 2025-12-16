import { createClient } from '@supabase/supabase-js';

// Supabase configuration
const SUPABASE_URL = 'https://ugfzidcccokjlgnvcfjb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVnZnppZGNjY29ramxnbnZjZmpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU4Mjc4NjgsImV4cCI6MjA4MTQwMzg2OH0.V2wQoXVENZE4RrwFHpWG5O4BLjeZXKMu5AuW-IpTzkA';

// Create Supabase client
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Database types
export interface Contact {
  id?: string;
  name: string;
  title?: string | null;
  company?: string | null;
  occupation?: string | null;
  linkedin_url: string;
  profile_image_url?: string | null;
  connected_at?: string | null;
  location?: string | null;
  headline?: string | null;
  about?: string | null;
  industry?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  relationship_score?: number;
  last_contact_date?: string | null;
  contact_frequency?: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly' | 'none' | null;
  tags?: string[];
  groups?: string[];
  source?: string;
  linkedin_data?: Record<string, unknown>;
  notes?: string | null;
  is_archived?: boolean;
  needs_enrichment?: boolean;
  created_at?: string;
  updated_at?: string;
  scraped_at?: string;
}

export interface SyncHistoryEntry {
  id?: string;
  sync_type: 'bulk' | 'incremental' | 'quick_add';
  status: 'started' | 'in_progress' | 'completed' | 'failed';
  total_found?: number;
  new_contacts?: number;
  updated_contacts?: number;
  skipped_contacts?: number;
  started_at?: string;
  completed_at?: string | null;
  duration_ms?: number | null;
  error_message?: string | null;
  metadata?: Record<string, unknown>;
}

export interface Interaction {
  id?: string;
  contact_id: string;
  interaction_type: 'meeting' | 'email_sent' | 'email_received' | 'call' | 'voice_note' | 'manual_note' | 'linkedin_message' | 'other';
  title?: string | null;
  summary?: string | null;
  content?: string | null;
  metadata?: Record<string, unknown>;
  interaction_date?: string;
  created_at?: string;
}

export interface FollowUp {
  id?: string;
  contact_id: string;
  description: string;
  priority?: 'high' | 'medium' | 'low';
  status?: 'pending' | 'completed' | 'cancelled' | 'snoozed';
  due_date?: string | null;
  completed_at?: string | null;
  snoozed_until?: string | null;
  source?: string | null;
  source_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

