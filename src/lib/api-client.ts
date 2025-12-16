import { supabase, type Contact } from './supabase';
import { storage } from './storage';
import { createLogger } from './logger';
import type { LinkedInContact, LinkedInProfile, BulkImportResponse, QuickAddResponse, ContactExistsResponse } from '@/types';

const logger = createLogger('api-client');

/**
 * Convert scraped LinkedIn contact to database format
 */
function toDbContact(contact: LinkedInContact): Omit<Contact, 'id' | 'created_at' | 'updated_at'> {
  return {
    name: contact.name,
    title: contact.title || null,
    company: contact.company || null,
    occupation: contact.occupation || null,
    linkedin_url: contact.linkedin_url,
    profile_image_url: contact.profile_image_url || null,
    connected_at: contact.connected_at || null,
    source: contact.source || 'linkedin_extension',
    needs_enrichment: true,
    scraped_at: new Date().toISOString(),
  };
}

/**
 * Compute a hash of profile data for change detection
 */
function computeProfileHash(profile: LinkedInProfile): string {
  // Create a deterministic string of the key profile data
  const data = JSON.stringify({
    name: profile.name,
    headline: profile.occupation,
    location: profile.location,
    about: profile.about,
    experiences: (profile.experiences || []).map(e => ({
      title: e.position_title,
      company: e.institution_name,
      from: e.from_date,
      to: e.to_date,
    })),
    educations: (profile.educations || []).map(e => ({
      school: e.institution_name,
      degree: e.degree,
    })),
    skills: (profile.skills || []).slice(0, 20), // Only compare top 20 skills
  });
  
  // Simple hash function (djb2)
  let hash = 5381;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) + hash) + data.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

/**
 * API Client for communicating with Supabase
 */
class APIClient {
  // ============ Contact Methods ============

  /**
   * Bulk import LinkedIn contacts (basic info only)
   */
  async bulkImportContacts(contacts: LinkedInContact[]): Promise<BulkImportResponse> {
    const startTime = Date.now();
    logger.info(`Bulk importing ${contacts.length} contacts`);

    // Create sync history entry
    const { data: syncEntry, error: syncError } = await supabase
      .from('sync_history')
      .insert({
        sync_type: 'bulk' as const,
        status: 'in_progress' as const,
        total_found: contacts.length,
        metadata: { source: 'linkedin_extension' },
      })
      .select()
      .single();

    if (syncError) {
      logger.error('Failed to create sync history entry', syncError);
    }

    let newCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    const dbContacts = contacts.map(toDbContact);

    // Upsert contacts
    const { data, error } = await supabase
      .from('contacts')
      .upsert(dbContacts, { 
        onConflict: 'linkedin_url',
        ignoreDuplicates: false 
      })
      .select();

    if (error) {
      logger.error('Upsert failed:', error);
      errors.push(error.message);
      skippedCount += contacts.length;
    } else {
      newCount = data?.length || 0;
    }

    const duration = Date.now() - startTime;

    // Update sync history
    if (syncEntry) {
      await supabase
        .from('sync_history')
        .update({
          status: errors.length === contacts.length ? 'failed' : 'completed',
          new_contacts: newCount,
          updated_contacts: updatedCount,
          skipped_contacts: skippedCount,
          completed_at: new Date().toISOString(),
          duration_ms: duration,
          error_message: errors.length > 0 ? errors.join('; ') : null,
        })
        .eq('id', syncEntry.id);
    }

    await storage.updateSyncState({
      last_sync: Date.now(),
      total_synced: await this.getTotalContacts(),
    });

    return {
      success: errors.length < contacts.length,
      new_count: newCount,
      updated_count: updatedCount,
      skipped_count: skippedCount,
      duration_ms: duration,
    };
  }

  /**
   * Quick add a single contact
   */
  async quickAddContact(contact: LinkedInContact): Promise<QuickAddResponse> {
    logger.info(`Quick adding contact: ${contact.name}`);

    const dbContact = toDbContact(contact);

    const { data, error } = await supabase
      .from('contacts')
      .upsert(dbContact, { 
        onConflict: 'linkedin_url',
        ignoreDuplicates: false 
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to add contact', error);
      throw new Error(error.message);
    }

    await supabase.from('sync_history').insert({
      sync_type: 'quick_add' as const,
      status: 'completed' as const,
      total_found: 1,
      new_contacts: 1,
      completed_at: new Date().toISOString(),
    });

    return {
      success: true,
      contact: { id: data.id, name: data.name },
      status: 'created',
    };
  }

  /**
   * Check if a contact already exists
   */
  async checkContactExists(linkedinUrl: string): Promise<ContactExistsResponse> {
    const { data, error } = await supabase
      .from('contacts')
      .select('id, name, last_contact_date, relationship_score')
      .eq('linkedin_url', linkedinUrl)
      .maybeSingle();

    if (error) {
      logger.error('Error checking contact', error);
      throw new Error(error.message);
    }

    return {
      exists: !!data,
      contact: data ? {
        id: data.id,
        name: data.name,
        last_contact: data.last_contact_date,
        relationship_score: data.relationship_score,
      } : null,
    };
  }

  /**
   * Check if a profile has changed since last scrape
   */
  async checkProfileChanged(profile: LinkedInProfile): Promise<boolean> {
    const newHash = computeProfileHash(profile);
    
    // Get existing hash from contacts table
    const { data } = await supabase
      .from('contacts')
      .select('data_hash')
      .eq('linkedin_url', profile.linkedin_url)
      .maybeSingle();
    
    if (!data?.data_hash) {
      // No existing record, this is new
      return true;
    }
    
    return data.data_hash !== newHash;
  }

  /**
   * Save a fully scraped LinkedIn profile with all details
   * - Saves to contacts table (main record)
   * - Saves to relational tables (experiences, educations, skills)
   * - Saves to linkedin_profiles table (full snapshot)
   * - Saves to profile_snapshots (for history)
   */
  async saveFullProfile(profile: LinkedInProfile): Promise<{ success: boolean; id?: string }> {
    logger.info(`Saving full profile: ${profile.name}`);

    try {
      const dataHash = computeProfileHash(profile);
      const currentExp = profile.experiences?.find(exp => !exp.to_date);

      // 1. Upsert main contact record
      const contactData = {
        name: profile.name,
        title: currentExp?.position_title || profile.title || null,
        company: currentExp?.institution_name || profile.company || null,
        occupation: profile.occupation || null,
        linkedin_url: profile.linkedin_url,
        profile_image_url: profile.profile_image_url || null,
        connected_at: profile.connected_at || null,
        source: profile.source || 'linkedin_extension',
        needs_enrichment: false,
        scraped_at: profile.scraped_at,
        location: profile.location || null,
        headline: profile.occupation || null,
        about: profile.about || null,
        data_hash: dataHash,
        // Store full data as JSONB for quick access
        linkedin_data: {
          experiences: profile.experiences || [],
          educations: profile.educations || [],
          skills: profile.skills || [],
          open_to_work: profile.open_to_work || false,
        },
      };

      const { data: contactResult, error: contactError } = await supabase
        .from('contacts')
        .upsert(contactData, { onConflict: 'linkedin_url' })
        .select('id')
        .single();

      if (contactError) {
        logger.error('Failed to save contact:', contactError);
        return { success: false };
      }

      const contactId = contactResult.id;

      // 2. Save to relational experiences table
      if (profile.experiences && profile.experiences.length > 0) {
        // Delete existing experiences for this contact
        await supabase.from('experiences').delete().eq('contact_id', contactId);

        // Insert new experiences
        const experienceRecords = profile.experiences.map(exp => ({
          contact_id: contactId,
          position_title: exp.position_title,
          company_name: exp.institution_name,
          company_linkedin_url: exp.linkedin_url,
          location: exp.location,
          start_date: exp.from_date,
          end_date: exp.to_date,
          is_current: !exp.to_date,
          duration: exp.duration,
          description: exp.description,
        }));

        const { error: expError } = await supabase.from('experiences').insert(experienceRecords);
        if (expError) {
          logger.warn('Failed to save experiences:', expError.message);
        }
      }

      // 3. Save to relational educations table
      if (profile.educations && profile.educations.length > 0) {
        // Delete existing educations
        await supabase.from('educations').delete().eq('contact_id', contactId);

        // Insert new educations
        const educationRecords = profile.educations.map(edu => ({
          contact_id: contactId,
          institution_name: edu.institution_name,
          institution_linkedin_url: edu.linkedin_url,
          degree: edu.degree,
          field_of_study: edu.field_of_study,
          start_date: edu.from_date,
          end_date: edu.to_date,
          description: edu.description,
        }));

        const { error: eduError } = await supabase.from('educations').insert(educationRecords);
        if (eduError) {
          logger.warn('Failed to save educations:', eduError.message);
        }
      }

      // 4. Save to relational skills table
      if (profile.skills && profile.skills.length > 0) {
        // Delete existing skills
        await supabase.from('skills').delete().eq('contact_id', contactId);

        // Insert new skills
        const skillRecords = profile.skills.map(skill => ({
          contact_id: contactId,
          skill_name: skill,
        }));

        const { error: skillError } = await supabase.from('skills').insert(skillRecords);
        if (skillError) {
          logger.warn('Failed to save skills:', skillError.message);
        }
      }

      // 5. Save to linkedin_profiles table (full profile snapshot)
      const nameParts = profile.name.split(' ');
      const linkedinProfileData = {
        contact_id: contactId,
        linkedin_url: profile.linkedin_url,
        full_name: profile.name,
        first_name: nameParts[0] || null,
        last_name: nameParts.slice(1).join(' ') || null,
        headline: profile.occupation || null,
        location: profile.location || null,
        about: profile.about || null,
        profile_image_url: profile.profile_image_url || null,
        current_title: currentExp?.position_title || profile.title || null,
        current_company: currentExp?.institution_name || profile.company || null,
        experience: profile.experiences || [],
        education: profile.educations || [],
        skills: profile.skills || [],
        scrape_status: 'complete',
        scraped_at: profile.scraped_at,
      };

      await supabase
        .from('linkedin_profiles')
        .upsert(linkedinProfileData, { onConflict: 'linkedin_url' });

      // 6. Save snapshot for history tracking
      await supabase.from('profile_snapshots').insert({
        contact_id: contactId,
        linkedin_url: profile.linkedin_url,
        snapshot_data: {
          name: profile.name,
          occupation: profile.occupation,
          location: profile.location,
          about: profile.about,
          experiences: profile.experiences,
          educations: profile.educations,
          skills: profile.skills,
        },
        data_hash: dataHash,
        scraped_at: profile.scraped_at,
      });

      // 7. Update scrape_queue status
      await supabase
        .from('scrape_queue')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('linkedin_url', profile.linkedin_url);

      logger.info(`Full profile saved: ${profile.name} (${contactId})`);
      return { success: true, id: contactId };

    } catch (error) {
      logger.error('Error saving full profile:', error);
      return { success: false };
    }
  }

  /**
   * Get total contact count
   */
  async getTotalContacts(): Promise<number> {
    const { count, error } = await supabase
      .from('contacts')
      .select('*', { count: 'exact', head: true });

    if (error) {
      logger.error('Failed to get contact count', error);
      return 0;
    }

    return count || 0;
  }

  /**
   * Get sync stats
   */
  async getSyncStats(): Promise<{ total_contacts: number; last_sync: string | null }> {
    const [contactCount, lastSync] = await Promise.all([
      this.getTotalContacts(),
      supabase
        .from('sync_history')
        .select('completed_at')
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    return {
      total_contacts: contactCount,
      last_sync: lastSync.data?.completed_at || null,
    };
  }

  // ============ Auth Methods (placeholder) ============

  async signIn(email: string, _password: string): Promise<{ token: string; user: { id: string; email: string; name: string } }> {
    const mockUser = { id: 'local-user', email, name: email.split('@')[0] };
    await storage.setAuth({ token: 'local-session', user: mockUser });
    return { token: 'local-session', user: mockUser };
  }

  async signInWithGoogle(_googleToken: string): Promise<{ token: string; user: { id: string; email: string; name: string } }> {
    return this.signIn('google-user@gmail.com', '');
  }

  async getCurrentUser(): Promise<{ id: string; email: string; name: string } | null> {
    const auth = await storage.getAuth();
    return auth.user || null;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const { error } = await supabase.from('contacts').select('id').limit(1);
      return !error;
    } catch {
      return false;
    }
  }
}

// Export singleton instance
export const apiClient = new APIClient();
