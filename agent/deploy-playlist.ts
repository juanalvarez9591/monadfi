/**
 * deploy-playlist.ts
 *
 * Deploys PlaylistBounty to a running Anvil instance, pre-funds the treasury
 * so the contract can pay out rewards for high-scoring playlists, and saves
 * the address to deployments.json.
 *
 * Usage:
 *   npm run deploy:playlist
 *   RPC_URL=http://... npm run deploy:playlist
 */

import { parseEther } from 'viem'
import { writeFileSync, existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { publicClient, getAnvilAccount, getDevAccount, makeWalletClient } from './src/client.js'
import { playlistBountyABI, playlistBountyBytecode } from './src/contracts.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PLAYLIST_DEPLOYMENTS = join(__dirname, 'playlist-deployments.json')

function savePlaylistDeployment(address: string, chainId: number) {
  const existing = existsSync(PLAYLIST_DEPLOYMENTS)
    ? JSON.parse(readFileSync(PLAYLIST_DEPLOYMENTS, 'utf-8'))
    : {}
  writeFileSync(PLAYLIST_DEPLOYMENTS, JSON.stringify({ ...existing, PlaylistBounty: address, chainId, deployedAt: new Date().toISOString() }, null, 2))
}

// Initial treasury seed — enough to cover ~50 score-10 payouts of 0.01 MON each.
const TREASURY_SEED = parseEther('1')

async function main() {
  const chain    = await publicClient.getChainId()
  const deployer = process.env.PRIVATE_KEY ? getDevAccount() : getAnvilAccount(0)
  const wallet   = makeWalletClient(deployer)

  console.log(`Chain ID  : ${chain}`)
  console.log(`Deployer  : ${deployer.address}\n`)

  // ── Deploy PlaylistBounty ─────────────────────────────────────────────────
  process.stdout.write('Deploying PlaylistBounty…  ')
  const hash = await wallet.deployContract({
    abi:      playlistBountyABI,
    bytecode: playlistBountyBytecode,
    args:     [],
    value:    TREASURY_SEED,   // constructor is payable — seeds the treasury
  })
  const { contractAddress } = await publicClient.waitForTransactionReceipt({ hash })
  if (!contractAddress) throw new Error('PlaylistBounty deployment failed — no address in receipt')
  console.log(contractAddress)
  console.log(`Treasury seeded with ${TREASURY_SEED} wei (${Number(TREASURY_SEED) / 1e18} MON)`)

  // ── Persist to playlist-deployments.json (standalone, no casino required) ──
  savePlaylistDeployment(contractAddress, chain)
  console.log('\nSaved → playlist-deployments.json ✓')
  console.log(`\nPlaylistBounty: ${contractAddress}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
