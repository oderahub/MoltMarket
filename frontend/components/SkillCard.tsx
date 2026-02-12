"use client";
import { Zap, Bitcoin } from 'lucide-react';

interface SkillCardProps {
  title: string;
  desc: string;
  price: string;
  isSbtc?: boolean;
  onExecute: () => void;
}

export default function SkillCard({ title, desc, price, isSbtc, onExecute }: SkillCardProps) {
  return (
    <div className="group bg-terminal border border-terminal-border p-4 rounded-none hover:bg-white/[0.02] hover:border-stacks transition-all cursor-pointer relative border-l-2 border-l-transparent hover:border-l-stacks">
      <div className="flex justify-between items-start mb-2">
        <h3 className="text-sm font-bold tracking-tight text-white/90 uppercase">{title}</h3>
        <span className={`text-[9px] font-bold px-1 border ${isSbtc ? 'text-stacks border-stacks/30 bg-stacks/10' : 'text-blue-400 border-blue-400/30 bg-blue-400/10'}`}>
          {isSbtc ? "BTC-NATIVE" : "STX-L2"}
        </span>
      </div>
      <p className="text-[10px] text-white/40 mb-6 font-sans leading-tight h-8">{desc}</p>
      <div className="flex justify-between items-end">
        <div>
          <span className="text-[8px] block opacity-30 uppercase tracking-tighter mb-1">Current Ask</span>
          <span className="text-sm font-bold text-white tabular-nums flex items-center gap-1">
            {isSbtc && <Bitcoin size={12} className="text-stacks" />}
            {price}
          </span>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('Execute clicked:', title);
            onExecute();
          }}
          className="bg-stacks text-white p-2 hover:bg-white hover:text-black transition-all shadow-[3px_3px_0px_0px_rgba(255,107,0,0.3)] active:shadow-none active:translate-x-[1px] active:translate-y-[1px]"
        >
          <Zap size={14} fill="currentColor" />
        </button>
      </div>
    </div>
  );
}
