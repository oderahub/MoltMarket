import { STACKS_TESTNET, STACKS_MAINNET } from '@stacks/network';

// Use testnet for demo - switch to STACKS_MAINNET for production
export const NETWORK = STACKS_TESTNET;
export const IS_TESTNET = true;

// Explorer URLs
export const getExplorerTxUrl = (txId: string) => {
  const base = 'https://explorer.hiro.so/txid';
  const chain = IS_TESTNET ? '?chain=testnet' : '';
  return `${base}/${txId}${chain}`;
};

export const getExplorerAddressUrl = (address: string) => {
  const base = 'https://explorer.hiro.so/address';
  const chain = IS_TESTNET ? '?chain=testnet' : '';
  return `${base}/${address}${chain}`;
};

// App details for wallet prompts
export const APP_DETAILS = {
  name: 'MoltMarket',
  icon: typeof window !== 'undefined' ? window.location.origin + '/logo.png' : '/logo.png',
};

// Platform receiving address - REPLACE with your testnet address
export const PLATFORM_ADDRESS = 'ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC';
