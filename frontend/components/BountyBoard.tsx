"use client";
import { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { buildApiUrl } from '@/lib/runtime';


type Bounty = {
  id: string;
  title: string;
  description: string;
  reward: string;
  status: string;
};

export default function BountyBoard({ onNegotiate }: { onNegotiate: (newPrice: number) => void }) {
  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [reward, setReward] = useState(5000);
  const [status, setStatus] = useState("AWAITING OPERATOR");
  const [isFlashing, setIsFlashing] = useState(false);

  // Fetch or create bounty on mount
  useEffect(() => {
    const initBounty = async () => {
      try {
        const res = await fetch(buildApiUrl('/bounties'));
        const data = await res.json();

        if (Array.isArray(data.bounties) && data.bounties.length > 0) {
          const b = data.bounties[0];
          if (typeof b?.id === 'string') {
            setBounty(b);
            setReward(parseInt(b.reward) || 5000);
            return;
          }
        }

        const createRes = await fetch(buildApiUrl('/bounties'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: "Composite Deep-Wallet Audit",
            description: "Full audit with risk score + tx history for complex wallet",
            reward: "5000",
            postedBy: "agent-alpha"
          }),
        });
        const created = await createRes.json();
        const newBounty = created?.bounty ?? created;
        if (typeof newBounty?.id === 'string') {
          setBounty(newBounty);
          setReward(parseInt(newBounty.reward) || 5000);
        } else {
          setStatus("BOUNTY LOAD FAILED");
        }
      } catch {
        setStatus("BOUNTY LOAD FAILED");
      }
    };
    initBounty().catch(console.error);
  }, []);

  const startNegotiation = async () => {
    if (!bounty) return;
    setStatus("NEGOTIATING...");
    onNegotiate(5000); // Log initial state

    // Simulate agent analysis delay
    setTimeout(async () => {
      try {
        // Actually update bounty via API
        const res = await fetch(buildApiUrl(`/bounties/${bounty.id}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reward: "8000" }),
        });
        const updated = await res.json();

        const newPrice = parseInt(updated.reward) || 8000;
        setReward(newPrice);
        setBounty(updated);
        setStatus("NEGOTIATION VERIFIED");
        
        // Trigger Flash
        setIsFlashing(true);
        setTimeout(() => setIsFlashing(false), 800);
        
        onNegotiate(newPrice);
      } catch (err) {
        setStatus("NEGOTIATION FAILED");
      }
    }, 3000);
  };

  return (
    <div className="mt-8">
      <h2 className="text-[10px] text-white/40 mb-4 flex items-center gap-2 tracking-[0.2em]">
        <Search size={14} /> ACTIVE BOUNTY LEDGER
      </h2>
      <div className={`bg-terminal border border-terminal-border rounded-none overflow-hidden transition-colors duration-500 ${isFlashing ? 'bg-green-500/20 border-green-500' : ''}`}>
        <div className="p-4 border-b border-terminal-border flex justify-between items-center bg-white/[0.02]">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-tight">
              {bounty && typeof bounty.id === 'string'
                ? `#${bounty.id.replace('bounty-', '')}: ${bounty.title}`
                : '#104: Composite Deep-Wallet Audit'}
            </h3>
            <p className="text-[10px] text-white/40 font-sans mt-1">
              {bounty?.description || 'Requires Risk-Score + Multi-Hop Distribution'}
            </p>
          </div>
          <div className="text-right">
            <div className={`text-lg font-bold tabular-nums transition-all duration-700 ${reward > 5000 ? 'text-green-400 scale-125' : 'text-stacks'}`}>
              {reward} <span className="text-[10px] opacity-50 uppercase">μSTX</span>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                console.log('Negotiate clicked');
                startNegotiation();
              }}
              disabled={status === "NEGOTIATING..."}
              className="text-[9px] text-stacks hover:underline uppercase tracking-widest mt-1 disabled:opacity-50"
            >
              {status === "AWAITING OPERATOR" ? "[ Request Quote ]" : status}
            </button>
          </div>
        </div>
        <div className={`p-3 flex justify-between items-center bg-black/40 transition-colors duration-500 ${isFlashing ? 'bg-green-500/10' : ''}`}>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full ${reward > 5000 ? 'bg-green-500' : 'bg-stacks animate-pulse'}`} />
              <span className="text-[9px] text-white/30 uppercase tracking-widest">Priority Execution Level: High</span>
            </div>
            <div className="text-[9px] uppercase tracking-[0.18em] text-blue-400/80">Settlement rail: USDCx for stable high-value payout</div>
          </div>
          <button className="bg-white text-black px-6 py-1.5 text-[10px] font-bold uppercase hover:bg-stacks hover:text-white transition-all">
            Hire Specialist
          </button>
        </div>
      </div>
    </div>
  );
}
