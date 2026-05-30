/**
 * listen.ts
 *
 * Real-time event watcher for MonadToken and CasinoRoulette.
 * Logs every emitted event with its decoded args, block number, and tx hash.
 *
 * The agent swarm can import `watchCasino` / `watchToken` directly
 * to react to on-chain state changes.
 *
 * Usage:
 *   npm run listen
 */

import { type Log } from 'viem'
import { publicClient } from './src/client.js'
import { casinoRouletteABI, monadTokenABI, loadDeployments } from './src/contracts.js'

// ── Generic event printer ─────────────────────────────────────────────────────

function onLogs(label: string) {
  return (logs: Log[]) => {
    for (const log of logs as any[]) {
      console.log(`\n[block ${log.blockNumber}] ${label} → ${log.eventName}`)
      console.log('  args:', JSON.stringify(log.args, (_, v) =>
        typeof v === 'bigint' ? v.toString() : v, 2))
      console.log('  tx  :', log.transactionHash)
    }
  }
}

// ── Exported watchers (usable by agent swarm) ─────────────────────────────────

export function watchCasino(address: `0x${string}`) {
  return publicClient.watchContractEvent({
    address,
    abi:    casinoRouletteABI,
    onLogs: onLogs('CasinoRoulette'),
  })
}

export function watchToken(address: `0x${string}`) {
  return publicClient.watchContractEvent({
    address,
    abi:    monadTokenABI,
    onLogs: onLogs('MonadToken'),
  })
}

// ── Standalone entry point ────────────────────────────────────────────────────

async function main() {
  const deployments = loadDeployments()

  console.log('Watching CasinoRoulette:', deployments.CasinoRoulette)
  console.log('Watching MonadToken    :', deployments.MonadToken)
  console.log('Press Ctrl+C to stop\n')

  const unwatchCasino = watchCasino(deployments.CasinoRoulette)
  const unwatchToken  = watchToken(deployments.MonadToken)

  process.on('SIGINT', () => {
    unwatchCasino()
    unwatchToken()
    console.log('\nStopped.')
    process.exit(0)
  })

  // Keep alive
  await new Promise(() => {})
}

main().catch((err) => { console.error(err); process.exit(1) })
