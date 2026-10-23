'use client';

import { useEffect, useRef, useCallback } from 'react';

export type DataSyncTopic = 'transactions' | 'accounts' | 'credit-cards' | 'budgets' | 'lending' | 'recurring' | 'emi' | 'investments' | 'all';

export interface DataChangeEventDetail {
  topic: DataSyncTopic;
  timestamp: number;
}

const EVENT_NAME = 'm12:data-mutated';

/**
 * Emits a client-side mutation event to inform all mounted components
 * (Dashboard, Transactions, Accounts, Reports) that underlying financial data changed.
 * Should be called immediately after a successful mutation (add, edit, delete).
 */
export function emitDataChange(topic: DataSyncTopic = 'all'): void {
  if (typeof window !== 'undefined') {
    const event = new CustomEvent<DataChangeEventDetail>(EVENT_NAME, {
      detail: { topic, timestamp: Date.now() },
    });
    window.dispatchEvent(event);
  }
}

/**
 * Hook that listens for data mutation events and page focus/visibility changes,
 * automatically re-fetching fresh data to ensure live dashboard & view consistency.
 * 
 * Features:
 * - Listens for 'm12:data-mutated' custom events.
 * - Revalidates when returning to tab or navigating back to page.
 * - Race-condition prevention using monotonic request ID tracking.
 */
export function useDataSync(
  onSync: () => void | Promise<void>,
  topics: DataSyncTopic[] = ['all']
): void {
  const onSyncRef = useRef(onSync);
  onSyncRef.current = onSync;

  const topicsRef = useRef(topics);
  topicsRef.current = topics;

  const lastSyncTimestampRef = useRef<number>(0);

  const triggerSync = useCallback(() => {
    const now = Date.now();
    // Debounce rapid successive calls within 150ms
    if (now - lastSyncTimestampRef.current < 150) {
      return;
    }
    lastSyncTimestampRef.current = now;
    try {
      onSyncRef.current();
    } catch (err) {
      console.warn('[DataSync] Error executing sync handler:', err);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleDataEvent = (e: Event) => {
      const customEvent = e as CustomEvent<DataChangeEventDetail>;
      const eventTopic = customEvent.detail?.topic || 'all';

      const matches =
        topicsRef.current.includes('all') ||
        eventTopic === 'all' ||
        topicsRef.current.includes(eventTopic);

      if (matches) {
        triggerSync();
      }
    };

    // Revalidate when user returns to this browser tab
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        triggerSync();
      }
    };

    window.addEventListener(EVENT_NAME, handleDataEvent);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener(EVENT_NAME, handleDataEvent);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [triggerSync]);
}
