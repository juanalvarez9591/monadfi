/**
 * deploy.ts
 *
 * Deploys MonadToken + CasinoRoulette to a running anvil instance and writes
 * the addresses to deployments.json.
 *
 * Usage:
 *   npm run deploy
 *   RPC_URL=http://... npm run deploy
 */

import { publicClient, getAnvilAccount, makeWalletClient } from './src/client.js'
import {
  monadTokenABI,        monadTokenBytecode,
  casinoRouletteABI,    casinoRouletteBytecode,
  saveDeployments,
} from './src/contracts.js'

async function main() {
  const chain = await publicClient.getChainId()
  const deployer = getAnvilAccount(0) // anvil account #0 — pre-funded with 10k ETH
  const wallet   = makeWalletClient(deployer)

  console.log(`Chain ID : ${chain}`)
  console.log(`Deployer : ${deployer.address}\n`)

  // ── MonadToken ───────────────────────────────────────────────────────────────
  process.stdout.write('Deploying MonadToken…  ')
  const tokenHash = await wallet.deployContract({
    abi:      monadTokenABI,
    bytecode: monadTokenBytecode,
    args:     [deployer.address],
  })
  const { contractAddress: tokenAddress } =
    await publicClient.waitForTransactionReceipt({ hash: tokenHash })
  if (!tokenAddress) throw new Error('MonadToken deployment failed — no address in receipt')
  console.log(tokenAddress)

  // ── CasinoRoulette ───────────────────────────────────────────────────────────
  process.stdout.write('Deploying CasinoRoulette…  ')
  const casinoHash = await wallet.deployContract({
    abi:      casinoRouletteABI,
    bytecode: casinoRouletteBytecode,
    args:     [deployer.address, tokenAddress],
  })
  const { contractAddress: casinoAddress } =
    await publicClient.waitForTransactionReceipt({ hash: casinoHash })
  if (!casinoAddress) throw new Error('CasinoRoulette deployment failed — no address in receipt')
  console.log(casinoAddress)

  // ── Persist ──────────────────────────────────────────────────────────────────
  saveDeployments({
    MonadToken:     tokenAddress,
    CasinoRoulette: casinoAddress,
    chainId:        chain,
    deployedAt:     new Date().toISOString(),
  })

  console.log('\nSaved → deployments.json ✓')
}

main().catch((err) => { console.error(err); process.exit(1) })
