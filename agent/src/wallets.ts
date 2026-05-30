import { mnemonicToAccount, type HDAccount } from 'viem/accounts'

/**
 * Fixed mnemonic for deterministic agent wallets.
 * Every run with the same index produces the same address — predictable for testing.
 * Never use this mnemonic on mainnet or any funded network.
 */
export const AGENT_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

/** Derive a single agent wallet at the given BIP-44 index. */
export function getAgentWallet(index: number): HDAccount {
  return mnemonicToAccount(AGENT_MNEMONIC, { addressIndex: index })
}

/** Derive N agent wallets starting at index 0. */
export function getAgentWallets(count: number): HDAccount[] {
  return Array.from({ length: count }, (_, i) => getAgentWallet(i))
}

/** Pretty-print a wallet list (useful for debugging). */
export function printWallets(wallets: HDAccount[]): void {
  for (const [i, w] of wallets.entries()) {
    console.log(`  [${i}] ${w.address}`)
  }
}
