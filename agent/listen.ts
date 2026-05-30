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

import { type Log, formatEther } from 'viem'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { publicClient } from './src/client.js'
import { casinoRouletteABI, monadTokenABI, playlistBountyABI, loadDeployments } from './src/contracts.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const SCORE_LABEL: Record<number, string> = {
  1: '💀 catastrophic (100% slashed)', 2: '😱 terrible (80% slashed)',
  3: '😞 poor (60% slashed)',          4: '😐 below avg (40% slashed)',
  5: '😶 average (break even)',        6: '🙂 decent (+10%)',
  7: '😊 good (+20%)',                 8: '😃 great (+40%)',
  9: '🤩 excellent (+70%)',           10: '🏆 perfect (×2)',
}

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

// ── PlaylistBounty pretty printer ─────────────────────────────────────────────

function onPlaylistLogs(logs: Log[]) {
  for (const log of logs as any[]) {
    const block = log.blockNumber
    const tx    = (log.transactionHash as string).slice(0, 12) + '…'

    if (log.eventName === 'PlaylistSubmitted') {
      const { playlistId, roleId, songIds, stake } = log.args
      console.log(`\n[block ${block}] 📋 PlaylistSubmitted  tx=${tx}`)
      console.log(`  Playlist  : #${playlistId}`)
      console.log(`  Agent     : ${roleId}`)
      console.log(`  Songs     : [${(songIds as bigint[]).join(', ')}]`)
      console.log(`  Stake     : ${formatEther(BigInt(stake))} MON  →  contract`)

    } else if (log.eventName === 'PlaylistScored') {
      const { playlistId, roleId, score, agentPayout, treasuryDelta, treasuryGained } = log.args
      const scoreN   = Number(score)
      const payout   = BigInt(agentPayout)
      const tDelta   = BigInt(treasuryDelta)
      const arrow    = treasuryGained ? '→ treasury' : '← from treasury'
      console.log(`\n[block ${block}] 🎯 PlaylistScored  tx=${tx}`)
      console.log(`  Playlist  : #${playlistId}`)
      console.log(`  Oracle    : ${roleId}`)
      console.log(`  Score     : ${scoreN}/10  ${SCORE_LABEL[scoreN] ?? ''}`)
      console.log(`  Payout    : ${formatEther(payout)} MON  ← agent`)
      console.log(`  Treasury  : ${tDelta === 0n ? '±0' : formatEther(tDelta) + ' MON'}  ${tDelta === 0n ? '(break even)' : arrow}`)
    } else {
      onLogs('PlaylistBounty')([log])
    }
  }
}

// ── Exported watchers ─────────────────────────────────────────────────────────

export function watchCasino(address: `0x${string}`) {
  return publicClient.watchContractEvent({ address, abi: casinoRouletteABI, onLogs: onLogs('CasinoRoulette') })
}

export function watchToken(address: `0x${string}`) {
  return publicClient.watchContractEvent({ address, abi: monadTokenABI, onLogs: onLogs('MonadToken') })
}

export function watchPlaylist(address: `0x${string}`) {
  return publicClient.watchContractEvent({ address, abi: playlistBountyABI, onLogs: onPlaylistLogs })
}

// ── Standalone entry point ────────────────────────────────────────────────────

async function main() {
  const unwatchers: (() => void)[] = []

  // PlaylistBounty (standalone deployments file)
  const playlistPath = join(__dirname, 'playlist-deployments.json')
  if (existsSync(playlistPath)) {
    const dep = JSON.parse(readFileSync(playlistPath, 'utf-8'))
    if (dep.PlaylistBounty) {
      console.log('Watching PlaylistBounty :', dep.PlaylistBounty)
      unwatchers.push(watchPlaylist(dep.PlaylistBounty))
    }
  }

  // Casino + Token (optional — only if deployed)
  try {
    const dep = loadDeployments()
    console.log('Watching CasinoRoulette :', dep.CasinoRoulette)
    console.log('Watching MonadToken     :', dep.MonadToken)
    unwatchers.push(watchCasino(dep.CasinoRoulette), watchToken(dep.MonadToken))
  } catch {
    // casino not deployed — skip silently
  }

  if (unwatchers.length === 0) {
    console.error('No contracts found. Deploy first.')
    process.exit(1)
  }

  console.log('\nListening for events… (Ctrl+C to stop)\n')

  process.on('SIGINT', () => {
    unwatchers.forEach(u => u())
    console.log('\nStopped.')
    process.exit(0)
  })

  await new Promise(() => {})
}

main().catch((err) => { console.error(err); process.exit(1) })
