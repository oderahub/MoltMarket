"use client";
import { TrendingUp, Wallet, ArrowUpRight, Zap } from 'lucide-react';

interface AgentTreasuryProps {
  yieldSats: number;
  stakedAmount: number;
  onYieldPayment?: (amount: number) => void;
}

export default function AgentTreasury({ yieldSats, stakedAmount }: AgentTreasuryProps) {
  return (
    <div className="mt-8 border border-white/5 bg-terminal/50 p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-[10px] text-white/40 flex items-center gap-2 tracking-[0.2em]">
          <Wallet size={14} /> AGENT TREASURY (stSTXbtc)
        </h2>
        <span className="text-[9px] text-green-500 font-bold bg-green-500/10 px-2 py-0.5 border border-green-500/20 uppercase flex items-center gap-1">
          <Zap size={10} /> Yield Active
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-black/40 p-3 border border-white/5">
          <span className="text-[8px] text-white/30 uppercase block mb-1">Staked Principal</span>
          <div className="text-sm font-bold tabular-nums">
            {stakedAmount.toLocaleString()}.00
            <span className="text-[10px] opacity-50 text-stacks ml-1">stSTXbtc</span>
          </div>
        </div>
        <div className="bg-black/40 p-3 border border-white/5 relative overflow-hidden">
          <span className="text-[8px] text-white/30 uppercase block mb-1">Accrued Yield</span>
          <div className="text-sm font-bold tabular-nums text-green-400">
            +{yieldSats.toLocaleString()}
            <span className="text-[10px] opacity-50 text-white ml-1">sats</span>
          </div>
          <TrendingUp size={40} className="absolute -right-2 -bottom-2 text-green-500/10" />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="text-[9px] text-white/30 flex items-center gap-1">
          <ArrowUpRight size={12} /> StackingDAO Protocol v3
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-white/20">Cycle 114</span>
          <div className="w-16 h-1 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-green-500/50 w-[67%]" />
          </div>
        </div>
      </div>
    </div>
  );
}
