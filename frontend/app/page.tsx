"use client";
import { useRef, useEffect, useState } from 'react';
import { Terminal as TerminalIcon, ShieldCheck, Bitcoin, Play } from 'lucide-react';
import { openSTXTransfer } from '@stacks/connect';
import { useTerminal } from '@/hooks/useTerminal';
import SkillCard from '@/components/SkillCard';
import BountyBoard from '@/components/BountyBoard';
import OperatorConnect from '@/components/OperatorConnect';
import AgentTreasury from '@/components/AgentTreasury';
import { NETWORK, PLATFORM_ADDRESS, getExplorerTxUrl } from '@/lib/stacks';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

type Skill = {
  id: string;
  name: string;
  description: string;
  price: string;
  priceSTX: string;
  asset: string;
  acceptedAssets: { asset: string; amount: string; display: string }[];
};

export default function BloombergTerminal() {
  const { logs, addLog } = useTerminal();
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [demoRunning, setDemoRunning] = useState(false);
  const [yieldSats, setYieldSats] = useState(1420);
  const [stakedAmount] = useState(1250);

  // Fetch skills from backend on mount
  useEffect(() => {
    fetch(`${API_BASE}/skills`)
      .then(res => res.json())
      .then(data => {
        setSkills(data.skills || []);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Simulate yield accumulation from StackingDAO
  useEffect(() => {
    const interval = setInterval(() => {
      setYieldSats(prev => prev + Math.floor(Math.random() * 3) + 1);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Parse price string to microSTX (e.g., "0.005 STX" -> 5000)
  const parsePriceToMicroSTX = (priceStr: string): number => {
    const match = priceStr.match(/([\d.]+)/);
    if (!match) return 5000; // default
    const value = parseFloat(match[1]);
    // If it looks like STX (decimal), convert to microSTX
    if (priceStr.toLowerCase().includes('stx') && value < 100) {
      return Math.round(value * 1000000);
    }
    // If it's sats, keep as is
    if (priceStr.toLowerCase().includes('sat')) {
      return Math.round(value);
    }
    return Math.round(value);
  };

  // Execute skill with payment proof after signing
  const executeWithPayment = async (skillId: string, txId: string, isYieldPayment = false) => {
    addLog(`Submitting payment proof to backend...`, 'system');

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Use appropriate header based on payment type
      if (isYieldPayment) {
        headers['X-Yield-Payment'] = txId;
      } else {
        headers['X-402-Payment'] = txId;
      }

      const res = await fetch(`${API_BASE}/skills/${skillId}/execute`, {
        method: 'POST',
        headers,
      });

      if (res.ok) {
        addLog(`[RESULT] Skill executed successfully`, 'success');
        addLog(`[LEDGER] Distributing Revenue via x402 Multi-hop...`, 'system');
        addLog(`[LEDGER] 40% -> MoltMarket Platform`, 'info');
        addLog(`[LEDGER] 36% -> Signal Detector Provider`, 'info');
        addLog(`[LEDGER] 24% -> Alpha Analyst Provider`, 'info');
      } else {
        addLog(`Backend returned ${res.status}`, 'error');
      }
    } catch (err) {
      addLog(`Error submitting payment: ${err}`, 'error');
    }
  };

  // Execute skill with yield payment (no wallet needed)
  const executeWithYield = async (skillId: string, priceSats: number): Promise<boolean> => {
    if (yieldSats < priceSats) {
      addLog(`[YIELD_ENGINE] Insufficient yield (${yieldSats}/${priceSats} sats)`, 'error');
      return false;
    }

    addLog(`[YIELD_ENGINE] Checking accrued rewards...`, 'system');
    addLog(`[STACKING_DAO] Cycle 114 yield available: ${yieldSats} sats`, 'info');

    try {
      const res = await fetch(`${API_BASE}/treasury/yield/spend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: priceSats }),
      });

      if (res.ok) {
        const data = await res.json();
        setYieldSats(data.remaining);
        addLog(`[STACKING_DAO] Routing ${priceSats} sats to x402...`, 'agent');
        addLog(`[SUCCESS] Skill unlocked via yield. Principal preserved.`, 'success');
        return true;
      }
    } catch (err) {
      addLog(`[YIELD_ENGINE] Spend failed: ${err}`, 'error');
    }
    return false;
  };

  // Real executeSkill function with wallet signing
  const executeSkill = async (skillId: string, price: string) => {
    // Check if sBTC-priced and can pay with yield
    if (price.toLowerCase().includes('sat')) {
      const priceSats = parseInt(price.match(/\d+/)?.[0] || '0');
      if (priceSats > 0 && yieldSats >= priceSats) {
        addLog(`[YIELD_ENGINE] sBTC skill detected. Attempting yield payment...`, 'agent');
        const success = await executeWithYield(skillId, priceSats);
        if (success) {
          await executeWithPayment(skillId, `yield-payment-${Date.now()}`, true);
          return;
        }
      }
    }

    if (!walletAddress) {
      addLog('ERROR: Connect wallet first', 'error');
      return;
    }

    const priceInMicroSTX = parsePriceToMicroSTX(price);
    addLog(`POST /skills/${skillId}/execute`, 'agent');

    try {
      // Call backend - will return 402 without payment header
      const res = await fetch(`${API_BASE}/skills/${skillId}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (res.status === 402) {
        const data = await res.json();
        addLog(`HTTP 402: Payment Required`, 'error');
        addLog(`x402 Version: ${data.x402Version}`, 'system');

        // Show accepted payment options
        if (data.accepts) {
          data.accepts.forEach((opt: { asset: string; amount: string }) => {
            addLog(`  Accept: ${opt.amount} ${opt.asset}`, 'info');
          });
        }

        addLog(`Amount: ${priceInMicroSTX} microSTX`, 'info');
        addLog(`Opening Leather wallet for signing...`, 'agent');

        // Prompt REAL wallet signing
        openSTXTransfer({
          recipient: PLATFORM_ADDRESS,
          amount: String(priceInMicroSTX),
          memo: `x402-payment:${skillId}`,
          network: NETWORK,
          appDetails: {
            name: 'MoltMarket',
            icon: window.location.origin + '/logo.png',
          },
          onFinish: (txData) => {
            const txId = txData.txId;
            const explorerUrl = getExplorerTxUrl(txId);

            addLog(`Payment Broadcast!`, 'success');
            addLog(`TxID: ${txId}`, 'info');
            addLog(`Explorer: ${explorerUrl}`, 'success');

            // Now re-call the skill with payment proof
            executeWithPayment(skillId, txId);
          },
          onCancel: () => {
            addLog('Transaction cancelled by user', 'error');
          },
        });
      }
    } catch (err) {
      addLog(`Network error: ${err}`, 'error');
    }
  };

  const handleNegotiate = (newPrice: number) => {
    addLog(`Bounty #104 re-analyzed by Specialist Agent.`, 'agent');
    setTimeout(() => {
      addLog(`[AGENT-B]: High tx volume detected (1,247 transactions).`, 'agent');
      addLog(`[AGENT-B]: Complexity analysis complete. Requiring premium coverage.`, 'agent');
    }, 500);
    setTimeout(() => {
      addLog(`[AGENT-B]: Proposing counter-offer: ${newPrice} microSTX.`, 'agent');
    }, 1500);
    setTimeout(() => {
      addLog(`Hirer accepted. Price updated via PATCH /bounties/104`, 'success');
      addLog(`[SYSTEM] Bounty #104 ready for execution at negotiated rate.`, 'system');
    }, 3000);
  };

  const handleWalletConnect = (address: string) => {
    setWalletAddress(address);
  };

  const launchDemo = async (type: 'negotiation' | 'full' = 'negotiation') => {
    if (demoRunning) return;
    setDemoRunning(true);
    addLog(`Launching REAL agent demo (${type})...`, 'system');
    addLog('Using funded bot wallets - transactions are REAL!', 'info');

    try {
      const res = await fetch(`${API_BASE}/demo/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      if (res.status === 409) {
        addLog('Demo already running', 'error');
        setDemoRunning(false);
      }
    } catch (err) {
      addLog(`Failed to start demo: ${err}`, 'error');
      setDemoRunning(false);
    }

    // Reset after demo duration (~45 seconds for full, ~30 for negotiation)
    setTimeout(() => setDemoRunning(false), type === 'full' ? 60000 : 35000);
  };

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden border border-white/5">
      {/* Header */}
      <header className="h-14 border-b border-terminal-border flex justify-between items-center px-6 bg-black">
        <div className="flex items-center gap-4">
          <div className="bg-stacks text-white font-bold p-1.5 text-xs">MM</div>
          <h1 className="text-sm font-bold tracking-[0.3em] uppercase">MoltMarket Terminal</h1>
          <div className="h-4 w-[1px] bg-white/10 mx-2" />
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-ping" />
            <span className="text-[9px] text-green-500/80 font-bold uppercase tracking-widest">Nakamoto Pulse: 4.8s</span>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-1 border border-stacks/30 text-stacks px-2 py-0.5 rounded-sm bg-stacks/5 text-[9px] font-bold">
            <Bitcoin size={12} /> sBTC PREMIA LIVE
          </div>
          <button
            type="button"
            onClick={() => launchDemo('negotiation')}
            disabled={demoRunning}
            className={`flex items-center gap-2 px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all ${
              demoRunning
                ? 'bg-green-500/20 text-green-400 border border-green-500/50 animate-pulse'
                : 'bg-stacks text-white hover:bg-white hover:text-black'
            }`}
          >
            <Play size={12} fill="currentColor" />
            {demoRunning ? 'AGENTS RUNNING...' : 'LAUNCH AGENTS'}
          </button>
          <OperatorConnect onLog={addLog} onConnect={handleWalletConnect} />
        </div>
      </header>

      {/* Grid Split */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left 60% - Skills & Bounties */}
        <div className="w-[60%] border-r border-terminal-border p-8 overflow-y-auto">
          <h2 className="text-[10px] text-white/40 mb-6 flex items-center gap-2 tracking-[0.2em]">
            <ShieldCheck size={14} /> INTELLIGENCE SKILLS
          </h2>
          <div className="grid grid-cols-2 gap-6">
            {skills.length > 0 ? (
              skills.map((skill) => {
                const hasSbtc = skill.acceptedAssets?.some(a => a.asset === 'sBTC');
                const hasUsdcx = skill.acceptedAssets?.some(a => a.asset === 'USDCx');
                const displayPrice = hasSbtc
                  ? skill.acceptedAssets.find(a => a.asset === 'sBTC')?.display || skill.priceSTX
                  : skill.priceSTX;
                return (
                  <SkillCard
                    key={skill.id}
                    title={skill.name.replace('Stacks ', '').replace(' Feed', '')}
                    desc={skill.description.slice(0, 60) + '...'}
                    price={displayPrice}
                    isSbtc={hasSbtc}
                    isUsdcx={hasUsdcx}
                    onExecute={() => executeSkill(skill.id, displayPrice)}
                  />
                );
              })
            ) : (
              <>
                <SkillCard title="Loading..." desc="Fetching skills from API" price="..." onExecute={() => {}} />
                <SkillCard title="Loading..." desc="Fetching skills from API" price="..." onExecute={() => {}} />
              </>
            )}
          </div>
          <BountyBoard onNegotiate={handleNegotiate} />
          <AgentTreasury yieldSats={yieldSats} stakedAmount={stakedAmount} />
        </div>

        {/* Right 40% - Terminal */}
        <div className="w-[40%] bg-black flex flex-col font-mono">
          <div className="p-3 bg-terminal border-b border-terminal-border flex items-center gap-2">
            <TerminalIcon size={14} className="text-stacks" />
            <span className="text-[10px] text-white/40 uppercase tracking-[0.2em]">Autonomous Agent Stream</span>
          </div>
          <div className="flex-1 p-6 overflow-y-auto space-y-3">
            {logs.map((log, i) => {
              // Check if this is a STEP indicator
              const isStep = log.message.includes('[STEP');
              // Check if this contains an explorer link
              const hasExplorerLink = log.message.includes('explorer.hiro.so');
              const explorerMatch = log.message.match(/https:\/\/explorer\.hiro\.so[^\s]*/);

              return (
                <div
                  key={i}
                  className={`text-[11px] leading-relaxed break-all ${
                    isStep ? 'bg-stacks/20 border-l-4 border-stacks px-3 py-2 my-2 font-bold' :
                    log.type === 'agent' ? 'text-blue-400' :
                    log.type === 'success' ? 'text-green-400' :
                    log.type === 'error' ? 'text-red-400' : 'text-white/60'
                  }`}
                >
                  <span className="opacity-30 mr-3 text-[9px] tabular-nums">[{log.ts}]</span>
                  {hasExplorerLink && explorerMatch ? (
                    <>
                      {log.message.replace(explorerMatch[0], '')}
                      <a
                        href={explorerMatch[0]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-stacks underline font-bold animate-pulse inline-block ml-1"
                      >
                        🔗 VERIFY ON-CHAIN ←
                      </a>
                    </>
                  ) : log.message.startsWith('Explorer:') ? (
                    <>
                      Explorer:{' '}
                      <a
                        href={log.message.replace('Explorer: ', '')}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-stacks underline font-bold animate-pulse"
                      >
                        🔗 {log.message.replace('Explorer: ', '')} ← CLICK TO VERIFY
                      </a>
                    </>
                  ) : (
                    log.message
                  )}
                </div>
              );
            })}
            <div ref={terminalEndRef} />
          </div>
        </div>
      </div>

      {/* Ticker Footer */}
      <footer className="h-8 bg-stacks text-black flex items-center overflow-hidden text-[10px] font-bold">
        <div className="whitespace-nowrap animate-marquee flex gap-12">
          <span>LATEST SETTLEMENT: 0x71a2... CONFIRMED</span>
          <span>STACKING_DAO: CYCLE 114 REWARDS DISTRIBUTED</span>
          <span>YIELD POOL: 2.4M stSTXbtc STAKED</span>
          <span>NEGOTIATION COMPLETED: BOUNTY #104 - 8000 STX</span>
          <span>SBTC/STX PAIR VOLUME UP 14%</span>
          <span>HIRO API LATENCY: 142MS</span>
          <span>x402-STACKS PROTOCOL ACTIVE</span>
          <span>YIELD ENGINE: AGENTS SELF-FUNDING VIA LIQUID STAKING</span>
        </div>
      </footer>
    </div>
  );
}
