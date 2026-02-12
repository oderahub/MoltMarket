"use client";
import { ExternalLink } from 'lucide-react';

interface ExplorerLinkProps {
  txId: string;
  label?: string;
}

export default function ExplorerLink({ txId, label }: ExplorerLinkProps) {
  const url = `https://explorer.hiro.so/txid/${txId}?chain=testnet`;
  const shortTx = `${txId.slice(0, 10)}...${txId.slice(-6)}`;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-stacks hover:underline"
    >
      {label || shortTx}
      <ExternalLink size={10} />
    </a>
  );
}
