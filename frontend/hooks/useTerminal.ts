import { useState, useEffect, useCallback } from 'react';

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
    const ws = new WebSocket('ws://localhost:3000/ws');

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        addLog(data.message, data.type || 'info');
      } catch {
        addLog(event.data, 'info');
      }
    };

    ws.onopen = () => addLog('Terminal Link Established.', 'system');
    ws.onerror = () => addLog('Terminal Link Error.', 'error');
    ws.onclose = () => addLog('Terminal Link Closed.', 'system');

    return () => ws.close();
  }, [addLog]);

  return { logs, addLog };
}
