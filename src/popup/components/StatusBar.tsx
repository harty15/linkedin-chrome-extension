import React from 'react';
import type { SyncState } from '@/types';

interface StatusBarProps {
  isAuthenticated: boolean;
  syncState: SyncState | null;
}

export function StatusBar({ isAuthenticated, syncState }: StatusBarProps) {
  const status = syncState?.status || 'idle';

  const getStatusInfo = () => {
    if (!isAuthenticated) {
      return { color: 'gray', text: 'Not signed in' };
    }

    switch (status) {
      case 'syncing':
        return { color: 'blue', text: 'Syncing...' };
      case 'completed':
        return { color: 'green', text: 'Sync complete' };
      case 'error':
        return { color: 'red', text: 'Sync failed' };
      case 'paused':
        return { color: 'yellow', text: 'Paused' };
      default:
        return { color: 'green', text: 'Ready' };
    }
  };

  const statusInfo = getStatusInfo();

  const colorClasses = {
    gray: 'bg-gray-400',
    blue: 'bg-blue-500 animate-pulse',
    green: 'bg-green-500',
    red: 'bg-red-500',
    yellow: 'bg-yellow-500',
  };

  return (
    <footer className="border-t border-gray-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${colorClasses[statusInfo.color as keyof typeof colorClasses]}`} />
          <span className="text-xs text-gray-500">{statusInfo.text}</span>
        </div>
        
        <div className="flex items-center gap-3">
          <a
            href="https://app.yourcrm.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-linkedin-blue hover:underline"
          >
            Open CRM
          </a>
          <a
            href="https://docs.yourcrm.com/help"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Help
          </a>
        </div>
      </div>
    </footer>
  );
}

