import {
  createPublicClient,
  createWalletClient,
  createTestClient,
  http,
  defineChain,
} from 'viem'
import { anvil } from 'viem/chains'
import { mnemonicToAccount, privateKeyToAccount, type HDAccount } from 'viem/accounts'

export const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'

const CHAIN_ID = process.env.CHAIN_ID ? parseInt(process.env.CHAIN_ID, 10) : 31337

const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  blockExplorers: {
    default: { name: 'MonadExplorer', url: 'https://testnet.monadexplorer.com' },
  },
})

export const chain =
  CHAIN_ID === 10143 ? monadTestnet :
  CHAIN_ID !== 31337 ? defineChain({
    id: CHAIN_ID,
    name: 'Custom',
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  }) : anvil

export const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL),
})

// Anvil test client — only valid in local dev mode (CHAIN_ID 31337)
export const testClient = createTestClient({
  chain: anvil,
  mode: 'anvil',
  transport: http(RPC_URL),
})

// Anvil's deterministic default mnemonic — all 10 pre-funded accounts derive from this
export const ANVIL_MNEMONIC =
  'test test test test test test test test test test test junk'

/** Returns one of anvil's 10 pre-funded accounts (index 0–9). Local dev only. */
export function getAnvilAccount(index: number): HDAccount {
  return mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: index })
}

/**
 * Returns the dev account from PRIVATE_KEY env var.
 * Use for testnet (CHAIN_ID=10143) or any non-anvil network.
 */
export function getDevAccount() {
  const pk = process.env.PRIVATE_KEY
  if (!pk) throw new Error('PRIVATE_KEY env var not set — required for non-anvil networks')
  return privateKeyToAccount(pk as `0x${string}`)
}

type AnyAccount = HDAccount | ReturnType<typeof privateKeyToAccount>

/** Creates a wallet client for the given account against the configured chain. */
export function makeWalletClient(account: AnyAccount) {
  return createWalletClient({
    account,
    chain,
    transport: http(RPC_URL),
  })
}

/** Fast-forward anvil's clock by `seconds` and mine one block. Local dev only. */
export async function timeTravel(seconds: number): Promise<void> {
  await testClient.increaseTime({ seconds })
  await testClient.mine({ blocks: 1 })
}
