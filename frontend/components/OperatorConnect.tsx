"use client";
import { useState, useEffect } from 'react';
import { getExplorerAddressUrl } from '@/lib/stacks';

// Extend Window interface for Stacks wallet providers
declare global {
  interface Window {
    StacksProvider?: {
      request: (method: string, params?: unknown) => Promise<unknown>;
    };
    LeatherProvider?: {
      request: (method: string, params?: unknown) => Promise<unknown>;
    };
  }
}

interface OperatorConnectProps {
  onLog: (message: string, type: 'info' | 'success' | 'error' | 'agent' | 'system') => void;
  onConnect?: (address: string) => void;
}

export default function OperatorConnect({ onLog, onConnect }: OperatorConnectProps) {
  const [addr, setAddr] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  // Check if already connected on mount
  useEffect(() => {
    const checkConnection = async () => {
      try {
        // Try direct provider first
        const provider = window.LeatherProvider || window.StacksProvider;
        if (provider) {
          const response = await provider.request('getAddresses') as { addresses: Array<{ address: string }> };
          const stxAddr = response.addresses?.find((a) =>
            a.address.startsWith('ST') || a.address.startsWith('SP')
          );
          if (stxAddr) {
            const shortAddr = `${stxAddr.address.slice(0, 6)}...${stxAddr.address.slice(-4)}`;
            setAddr(shortAddr);
            onConnect?.(stxAddr.address);
          }
        }
      } catch {
        // Not connected, that's fine
      }
    };
    checkConnection();
  }, [onConnect]);

  const auth = async () => {
    setIsConnecting(true);
    onLog('Awaiting Operator Handshake...', 'system');

    try {
      // Try direct provider approach first (most reliable with Leather)
      const provider = window.LeatherProvider || window.StacksProvider;

      if (provider) {
        onLog('Leather wallet detected, requesting addresses...', 'info');

        // Direct wallet request - this will prompt the user to connect
        const response = await provider.request('getAddresses') as {
          addresses: Array<{ address: string; symbol?: string }>
        };

        onLog(`Got ${response.addresses?.length || 0} addresses`, 'info');

        // Find STX address (testnet starts with ST, mainnet with SP)
        const stxAddr = response.addresses?.find((a) =>
          a.address.startsWith('ST') || a.address.startsWith('SP')
        );

        if (stxAddr) {
          const fullAddr = stxAddr.address;
          const shortAddr = `${fullAddr.slice(0, 6)}...${fullAddr.slice(-4)}`;

          setAddr(shortAddr);
          onConnect?.(fullAddr);

          onLog(`Operator ${shortAddr} Provisioned.`, 'success');
          onLog(`Address: ${fullAddr}`, 'info');
          onLog(`Explorer: ${getExplorerAddressUrl(fullAddr)}`, 'info');
          onLog(`Agent Session Key Generated.`, 'system');
          onLog(`MoltMarket Kernel v1.0.4 initialized...`, 'system');
        } else {
          onLog('No STX address found in wallet response', 'error');
        }
      } else {
        // Fallback: try @stacks/connect library
        onLog('No direct provider, trying @stacks/connect...', 'info');
        const { connect, request } = await import('@stacks/connect');

        await connect({ approvedProviderIds: ['LeatherProvider'] });
        const response = await request('getAddresses') as {
          addresses: Array<{ address: string }>
        };

        const stxAddr = response.addresses?.find((a) =>
          a.address.startsWith('ST') || a.address.startsWith('SP')
        );

        if (stxAddr) {
          const fullAddr = stxAddr.address;
          const shortAddr = `${fullAddr.slice(0, 6)}...${fullAddr.slice(-4)}`;

          setAddr(shortAddr);
          onConnect?.(fullAddr);

          onLog(`Operator ${shortAddr} Provisioned.`, 'success');
          onLog(`Address: ${fullAddr}`, 'info');
          onLog(`Explorer: ${getExplorerAddressUrl(fullAddr)}`, 'info');
          onLog(`Agent Session Key Generated.`, 'system');
          onLog(`MoltMarket Kernel v1.0.4 initialized...`, 'system');
        } else {
          onLog('No STX address found', 'error');
        }
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      if (errMsg.includes('User rejected') || errMsg.includes('cancelled') || errMsg.includes('denied')) {
        onLog('Operator Handshake Cancelled.', 'error');
      } else {
        onLog(`Wallet error: ${errMsg}`, 'error');
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      const { disconnect } = await import('@stacks/connect');
      disconnect();
      setAddr(null);
      onLog('Operator disconnected.', 'system');
    } catch {
      setAddr(null);
    }
  };

  return (
    <button
      type="button"
      onClick={addr ? handleDisconnect : auth}
      disabled={isConnecting}
      className="border border-white/10 px-4 py-1.5 flex items-center gap-3 hover:border-stacks transition-all bg-white/5 disabled:opacity-70"
    >
      <div className={`w-1.5 h-1.5 rounded-full ${
        addr ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' :
        isConnecting ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'
      }`} />
      <span className="text-[10px] font-bold tracking-[0.1em] uppercase">
        {addr ? `SESSION: ${addr}` : isConnecting ? "CONNECTING..." : "AUTH_OPERATOR"}
      </span>
    </button>
  );
}
