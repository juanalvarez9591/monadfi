import {
  createPublicClient,
  createWalletClient,
  createTestClient,
  http,
} from 'viem'
import { anvil } from 'viem/chains'
import { mnemonicToAccount, type HDAccount } from 'viem/accounts'

export const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'

// Anvil's deterministic default mnemonic — all 10 pre-funded accounts derive from this
export const ANVIL_MNEMONIC =
  'test test test test test test test test test test test junk'

export const publicClient = createPublicClient({
  chain: anvil,
  transport: http(RPC_URL),
})

// Anvil test client — exposes time-travel, mining, impersonation, etc.
export const testClient = createTestClient({
  chain: anvil,
  mode: 'anvil',
  transport: http(RPC_URL),
})

/** Returns one of anvil's 10 pre-funded accounts (index 0–9). */
export function getAnvilAccount(index: number): HDAccount {
  return mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: index })
}

/** Creates a wallet client for the given account against the local chain. */
export function makeWalletClient(account: HDAccount) {
  return createWalletClient({
    account,
    chain: anvil,
    transport: http(RPC_URL),
  })
}

/**
 * Fast-forward anvil's clock and mine one block.
 * Essential for time-windowed contracts like CasinoRoulette.
 */
export async function timeTravel(seconds: number): Promise<void> {
  await testClient.increaseTime({ seconds })
  await testClient.mine({ blocks: 1 })
}
