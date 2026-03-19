import { useState, useEffect, useCallback } from 'react';
import { getWebSocketUrl } from '@/lib/runtime';

export type LogEntry = {
  type: 'info' | 'success' | 'error' | 'agent' | 'system';
  message: string;
  category?: string;
  ts: string;
};

export function useTerminal() {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    const newLog: LogEntry = {
      message: `> ${message}`,
      type,
      ts: new Date().toLocaleTimeString(),
    };
    setLogs((prev) => [...prev, newLog].slice(-1000));
  }, []);

  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: NodeJS.Timeout;
    let reconnectAttempts = 0;
    const maxReconnectDelay = 10000;

    const connect = () => {
      const wsUrl = getWebSocketUrl();
      ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          addLog(data.message, data.type || 'info');
        } catch {
          addLog(event.data, 'info');
        }
      };

      ws.onopen = () => {
        reconnectAttempts = 0;
        addLog('Terminal Link Established.', 'system');
      };

      ws.onerror = () => {
        if (reconnectAttempts === 0) {
          addLog('Terminal Link Error. Backend might be asleep...', 'error');
        }
      };

      ws.onclose = () => {
        if (reconnectAttempts === 0) {
          addLog('Terminal Link Closed. Attempting reconnect...', 'system');
        }
        
        // Auto-reconnect with exponential backoff
        const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), maxReconnectDelay);
        reconnectAttempts++;
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null; // Prevent reconnect loop on unmount
        ws.close();
      }
    };
  }, [addLog]);

  return { logs, addLog };
}
