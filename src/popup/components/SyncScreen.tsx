import React, { useState, useEffect } from 'react';
import type { SyncState } from '@/types';

interface SyncScreenProps {
  syncState: SyncState | null;
  onSyncStateChange: (state: SyncState) => void;
}

export function SyncScreen({ syncState }: SyncScreenProps) {
  const [linkedInStatus, setLinkedInStatus] = useState<{
    loggedIn: boolean;
    hasHeaders: boolean;
  } | null>(null);

  const status = syncState?.status || 'idle';
  const progress = syncState?.progress;
  const lastSync = syncState?.last_sync;
  const totalSynced = syncState?.total_synced || 0;

  // Check LinkedIn status on mount
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS' })
      .then(response => {
        if (response.success) {
          setLinkedInStatus({
            loggedIn: response.data.linkedin_logged_in,
            hasHeaders: response.data.has_headers,
          });
        }
      })
      .catch(() => {});
  }, []);

  const formatLastSync = (timestamp: number | null | undefined): string => {
    if (!timestamp) return 'Never';
    
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hr ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    
    return date.toLocaleDateString();
  };

  const getNextSyncTime = (): string => {
    if (!lastSync) return 'Soon';
    
    const nextSync = lastSync + (12 * 60 * 60 * 1000); // 12 hours
    const now = Date.now();
    
    if (now >= nextSync) return 'Soon';
    
    const diffMs = nextSync - now;
    const diffHours = Math.floor(diffMs / 3600000);
    const diffMins = Math.floor((diffMs % 3600000) / 60000);
    
    if (diffHours > 0) {
      return `${diffHours}h ${diffMins}m`;
    }
    return `${diffMins}m`;
  };

  const handleManualSync = async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'START_BULK_SYNC' });
    } catch (err) {
      console.error('Failed to start sync:', err);
    }
  };

  const handleEnrichProfiles = async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'START_ENRICHMENT', data: { limit: 50 } });
    } catch (err) {
      console.error('Failed to start enrichment:', err);
    }
  };

  return (
    <div className="p-6">
      {/* LinkedIn Status Banner */}
      {linkedInStatus && !linkedInStatus.loggedIn && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-xl">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="font-medium text-yellow-800 text-sm">Not logged into LinkedIn</p>
              <p className="text-xs text-yellow-600">Visit LinkedIn to enable sync</p>
            </div>
          </div>
        </div>
      )}

      {/* Status Banner */}
      <div className={`mb-6 p-4 rounded-xl ${
        status === 'syncing' ? 'bg-blue-50 border border-blue-100' :
        status === 'error' ? 'bg-red-50 border border-red-100' :
        'bg-green-50 border border-green-100'
      }`}>
        <div className="flex items-center gap-3">
          {status === 'syncing' ? (
            <>
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-blue-900">Syncing via Voyager API...</p>
                <p className="text-sm text-blue-600">
                  {progress?.current || 0} / {progress?.total || '?'} connections
                </p>
              </div>
            </>
          ) : status === 'error' ? (
            <>
              <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
                <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="font-medium text-red-900">Sync Error</p>
                <p className="text-sm text-red-600 truncate">{syncState?.error || 'Unknown error'}</p>
              </div>
            </>
          ) : (
            <>
              <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="font-medium text-green-900">Auto-Sync Active</p>
                <p className="text-sm text-green-600">Next sync in {getNextSyncTime()}</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <p className="text-gray-500 text-xs mb-1">Total Contacts</p>
          <p className="text-2xl font-bold text-gray-900">{totalSynced.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <p className="text-gray-500 text-xs mb-1">Last Synced</p>
          <p className="text-sm font-medium text-gray-900">{formatLastSync(lastSync)}</p>
        </div>
      </div>

      {/* Progress Bar (when syncing) */}
      {status === 'syncing' && progress?.total && (
        <div className="mb-6">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Progress</span>
            <span>{Math.round(((progress.current || 0) / progress.total) * 100)}%</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-linkedin-blue to-linkedin-light transition-all duration-300"
              style={{ width: `${((progress.current || 0) / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Info Card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-linkedin-blue/10 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-linkedin-blue" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.32 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.79M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z"/>
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Voyager API Sync</h3>
            <p className="text-sm text-gray-500 mt-1">
              Uses LinkedIn's internal API for fast, reliable sync. 
              No visible tabs or browser automation.
            </p>
          </div>
        </div>

        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2 text-gray-600">
            <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>Truly headless (no tabs opened)</span>
          </div>
          <div className="flex items-center gap-2 text-gray-600">
            <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>Structured data (no DOM scraping)</span>
          </div>
          <div className="flex items-center gap-2 text-gray-600">
            <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>Auto-syncs every 12 hours</span>
          </div>
          <div className="flex items-center gap-2 text-gray-600">
            <svg className={`w-4 h-4 ${linkedInStatus?.hasHeaders ? 'text-green-500' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className={linkedInStatus?.hasHeaders ? '' : 'text-gray-400'}>
              Session headers {linkedInStatus?.hasHeaders ? 'captured' : 'pending'}
            </span>
          </div>
        </div>
      </div>

      {/* Action Buttons (only when not syncing) */}
      {status !== 'syncing' && (
        <div className="mt-6 space-y-3">
          <button
            onClick={handleManualSync}
            className="w-full py-3 bg-linkedin-blue text-white font-medium rounded-lg hover:bg-linkedin-blue/90 transition"
          >
            Sync Connections
          </button>
          
          <button
            onClick={handleEnrichProfiles}
            className="w-full py-3 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 transition flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Enrich Profiles
          </button>
          
          <p className="text-xs text-gray-400 text-center">
            {linkedInStatus?.hasHeaders 
              ? 'Ready - session headers captured' 
              : 'Visit LinkedIn to capture session'}
          </p>
        </div>
      )}
    </div>
  );
}
