'use client';

import { useEffect, useRef, useState } from 'react';

import { apiFetch } from '../lib/api-client';

export type DirectoryFailure = 'error' | 'offline' | 'forbidden' | 'not-found' | null;

interface UseScopedDirectoryOptions<T> {
  enabled?: boolean;
  parse: (value: unknown) => T;
  url: string;
}

export interface ScopedDirectoryState<T> {
  data: T | null;
  failure: DirectoryFailure;
  loading: boolean;
  retry: () => void;
  stale: boolean;
}

export function useScopedDirectory<T>({
  enabled = true,
  parse,
  url
}: UseScopedDirectoryOptions<T>): ScopedDirectoryState<T> {
  const [data, setData] = useState<T | null>(null);
  const dataRef = useRef<T | null>(null);
  const lastSuccessfulUrlRef = useRef<string | null>(null);
  const previousUrlRef = useRef<string | null>(null);
  const [failure, setFailure] = useState<DirectoryFailure>(null);
  const [loading, setLoading] = useState(enabled);
  const [stale, setStale] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!enabled) {
      dataRef.current = null;
      setData(null);
      setFailure(null);
      setLoading(false);
      setStale(false);
      previousUrlRef.current = null;
      return;
    }

    const urlChanged = previousUrlRef.current !== url;
    previousUrlRef.current = url;
    if (urlChanged) {
      dataRef.current = null;
      setData(null);
      setStale(false);
    }

    const controller = new AbortController();

    const load = async () => {
      setLoading(true);
      setFailure(null);
      try {
        const response = await apiFetch(url, { signal: controller.signal });

        if (response.status === 401) {
          dataRef.current = null;
          setData(null);
          window.location.assign('/login?reason=expired');
          return;
        }
        if (response.status === 403) {
          dataRef.current = null;
          setData(null);
          setFailure('forbidden');
          return;
        }
        if (response.status === 404) {
          dataRef.current = null;
          setData(null);
          setFailure('not-found');
          return;
        }
        if (!response.ok) {
          throw new Error('directory request failed');
        }

        const parsed = parse(await response.json());
        dataRef.current = parsed;
        lastSuccessfulUrlRef.current = url;
        setData(parsed);
        setStale(false);
      } catch {
        if (controller.signal.aborted) {
          return;
        }

        if (dataRef.current !== null && lastSuccessfulUrlRef.current === url) {
          setStale(true);
        } else {
          dataRef.current = null;
          setData(null);
          setFailure(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error');
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => controller.abort();
  }, [enabled, parse, retryKey, url]);

  return {
    data,
    failure,
    loading,
    retry: () => setRetryKey((value) => value + 1),
    stale
  };
}
