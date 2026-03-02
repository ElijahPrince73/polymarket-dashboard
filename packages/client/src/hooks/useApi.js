import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export default function useApi(url) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const initialFetchDone = useRef(false);

  const unwrapResponse = useCallback((payload) => {
    if (payload && typeof payload === 'object' && payload.success === true && 'data' in payload) {
      return payload.data;
    }
    return payload;
  }, []);

  const fetchData = useCallback(async () => {
    // Only show loading spinner on initial fetch, not on polls
    if (!initialFetchDone.current) {
      setLoading(true);
    }
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }
      const json = await response.json();
      setData(unwrapResponse(json));
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      initialFetchDone.current = true;
      setLoading(false);
    }
  }, [url, unwrapResponse]);

  useEffect(() => {
    let isMounted = true;

    const run = async () => {
      if (!isMounted) return;
      await fetchData();
    };

    run();
    const intervalId = setInterval(run, 5000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [fetchData]);

  return useMemo(
    () => ({
      data,
      loading,
      error,
      refetch: fetchData,
    }),
    [data, loading, error, fetchData]
  );
}
