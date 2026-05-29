import { useEffect, useRef, useState } from 'react';

export function useOrchestrationLive(): number {
  const [revision, setRevision] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const closedByUnmountRef = useRef(false);

  useEffect(() => {
    closedByUnmountRef.current = false;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/admin/ws`;
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data || '{}')) as { type?: string };
          if (data.type === 'orchestration:update') {
            setRevision((value) => value + 1);
          }
        } catch {
          // Ignore parse errors from non-JSON events.
        }
      };

      wsRef.current.onclose = () => {
        if (closedByUnmountRef.current) return;
        reconnectTimerRef.current = window.setTimeout(connect, 1500);
      };
    };

    connect();

    return () => {
      closedByUnmountRef.current = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      wsRef.current?.close();
    };
  }, []);

  return revision;
}
