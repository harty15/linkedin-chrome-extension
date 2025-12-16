import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { AuthScreen } from './components/AuthScreen';
import { SyncScreen } from './components/SyncScreen';
import { StatusBar } from './components/StatusBar';
import type { AuthState, SyncState } from '@/types';

export default function App() {
  const [authState, setAuthState] = useState<AuthState | null>(null);
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load initial state - BYPASS AUTH FOR NOW
  useEffect(() => {
    async function loadState() {
      try {
        // TEMPORARY: Bypass auth - set as authenticated
        setAuthState({
          is_authenticated: true,
          token: 'dev-token',
          user: {
            id: 'dev-user',
            email: 'dev@localhost',
            name: 'Developer',
          },
        });

        // Get sync status
        const syncResponse = await chrome.runtime.sendMessage({ type: 'GET_SYNC_STATUS' });
        if (syncResponse.success) {
          setSyncState(syncResponse.data);
        }
      } catch (err) {
        console.error('Failed to load state:', err);
        // Don't show error, just set default state
        setAuthState({
          is_authenticated: true,
          token: 'dev-token',
          user: { id: 'dev-user', email: 'dev@localhost', name: 'Developer' },
        });
      } finally {
        setLoading(false);
      }
    }

    loadState();
  }, []);

  // Listen for sync progress updates
  useEffect(() => {
    const listener = (message: { type: string; data: SyncState }) => {
      if (message.type === 'SYNC_PROGRESS' || message.type === 'PROGRESS_UPDATE') {
        setSyncState(message.data);
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const handleSignIn = async (token: string, user: AuthState['user']) => {
    setAuthState({
      is_authenticated: true,
      token,
      user,
    });
  };

  const handleSignOut = async () => {
    await chrome.runtime.sendMessage({ type: 'SIGN_OUT' });
    setAuthState({
      is_authenticated: false,
      token: null,
      user: null,
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-4 border-linkedin-blue border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen p-4">
        <div className="text-center">
          <div className="text-4xl mb-2">⚠️</div>
          <p className="text-gray-600">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-linkedin-blue text-white rounded-lg"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      <Header user={authState?.user || null} onSignOut={handleSignOut} />

      <main className="flex-1 overflow-auto">
        {!authState?.is_authenticated ? (
          <AuthScreen onSignIn={handleSignIn} />
        ) : (
          <SyncScreen syncState={syncState} onSyncStateChange={setSyncState} />
        )}
      </main>

      <StatusBar 
        isAuthenticated={authState?.is_authenticated || false}
        syncState={syncState}
      />
    </div>
  );
}

