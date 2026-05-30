/**
 * loop-playlist.ts
 *
 * PlaylistBounty agent loop. All meaningful log output is derived from
 * on-chain events (PlaylistSubmitted / PlaylistScored) parsed from the
 * transaction receipt — not from view-call guesses after the fact.
 *
 * Also tracks wallet balance before/after each tx to show the real MON
 * flow between the dev wallet and the contract treasury.
 *
 * Usage:
 *   npm run loop:playlist -- <agentId> <walletIndex>
 *   LOOP_INTERVAL=10 npm run loop:playlist -- 4 0   # oracle, slower cadence
 */

import { formatEther, parseEventLogs } from 'viem'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { publicClient, getAnvilAccount, makeWalletClient } from './src/client.js'
import { runAgentOnce } from './src/execute.js'
import { playlistBountyABI } from './src/contracts.js'

const AGENT_ID     = parseInt(process.argv[2] ?? '1', 10)
const WALLET_INDEX = parseInt(process.argv[3] ?? '0', 10)
const API_URL      = process.env.API_URL ?? 'http://localhost:8080'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const ts    = () => new Date().toISOString()
const HR    = '─'.repeat(66)

function loadPlaylistDeployments() {
  const path = join(dirname(fileURLToPath(import.meta.url)), 'playlist-deployments.json')
  if (!existsSync(path)) throw new Error('playlist-deployments.json not found — run: npm run deploy:playlist')
  return JSON.parse(readFileSync(path, 'utf-8'))
}

function mon(wei: bigint, sign = false): string {
  const n = parseFloat(formatEther(wei < 0n ? -wei : wei))
  const prefix = sign ? (wei < 0n ? '-' : '+') : ''
  return `${prefix}${n.toFixed(4)} MON`
}

// Score → human label
const SCORE_LABEL: Record<number, string> = {
  1:  '💀  catastrophic  (100% slashed)',
  2:  '😱  terrible       (80% slashed)',
  3:  '😞  poor           (60% slashed)',
  4:  '😐  below average  (40% slashed)',
  5:  '😶  average        (break even)',
  6:  '🙂  decent         (+10% reward)',
  7:  '😊  good           (+20% reward)',
  8:  '😃  great          (+40% reward)',
  9:  '🤩  excellent      (+70% reward)',
  10: '🏆  perfect        (×2 stake)',
}

function detectRole(prompt: string): string {
  const m = prompt.match(/\b(agent_\d+|oracle_\d+)\b/)
  return m ? m[1] : 'unknown'
}

async function main() {
  const dep  = loadPlaylistDeployments()
  if (!dep.PlaylistBounty) throw new Error('PlaylistBounty not deployed')

  const wallet       = getAnvilAccount(WALLET_INDEX)
  const walletClient = makeWalletClient(wallet)
  const contractAddr = dep.PlaylistBounty as `0x${string}`

  const treasury = () =>
    publicClient.getBalance({ address: contractAddr })
  const walletBal = () =>
    publicClient.getBalance({ address: wallet.address })

  console.log(HR)
  console.log(`  🎵  PlaylistBounty Agent Loop`)
  console.log(`  Agent ID  : ${AGENT_ID}`)
  console.log(`  Wallet    : ${wallet.address}`)
  console.log(`  Contract  : ${contractAddr}`)
  console.log(`  API       : ${API_URL}`)
  console.log(HR)
  console.log('  Waiting for loop activation (POST /agents/{id}/loop/start)…\n')

  let iter = 0

  while (true) {
    // ── Poll loop state ───────────────────────────────────────────────────────
    const loopRes   = await fetch(`${API_URL}/agents/${AGENT_ID}/loop/status`)
    const loopState = await loopRes.json()

    if (!loopState.running) {
      await sleep(3000)
      continue
    }

    const agentRes = await fetch(`${API_URL}/agents/${AGENT_ID}`)
    if (!agentRes.ok) throw new Error('agent not found')
    const agent    = await agentRes.json()
    const role     = detectRole(agent.prompt)
    const isOracle = role.startsWith('oracle')

    iter++

    // ── Balances BEFORE ───────────────────────────────────────────────────────
    const [walletBefore, treasuryBefore] = await Promise.all([walletBal(), treasury()])

    console.log(`\n${HR}`)
    console.log(`  [${ts()}]  tick #${iter}  role=${role}  ${isOracle ? '⚖️  scorer' : '🎵  curator'}`)
    console.log(`  Wallet   : ${mon(walletBefore)}   Contract : ${mon(treasuryBefore)}`)

    // ── Run one agent iteration ───────────────────────────────────────────────
    let lastAction = 'no-op'
    try {
      const outcome = await runAgentOnce(agent, wallet, walletClient)
      lastAction    = outcome.summary

      if (outcome.status === 'no-op') {
        console.log(`  💤  no-op${isOracle ? ' — no pending playlists to score' : ' — waiting'}`)

      } else if (outcome.status === 'skipped') {
        console.log(`  ⏭️   skipped: ${outcome.summary}`)

      } else if (outcome.status === 'sent' && outcome.receipt) {
        const receipt = outcome.receipt
        const tx      = receipt.transactionHash

        // ── Parse events from the receipt ─────────────────────────────────────
        const events = parseEventLogs({ abi: playlistBountyABI, logs: receipt.logs })

        // ── Balances AFTER ────────────────────────────────────────────────────
        const [walletAfter, treasuryAfter] = await Promise.all([walletBal(), treasury()])
        // wallet delta includes gas cost; separate it out isn't needed — show gross
        const walletDelta   = walletAfter - walletBefore
        const treasuryDelta = treasuryAfter - treasuryBefore

        console.log(`  ✅  tx ${tx}  block #${receipt.blockNumber}`)

        for (const ev of events) {
          if (ev.eventName === 'PlaylistSubmitted') {
            const { playlistId, roleId, name, songIds, stake } = ev.args as any
            console.log(``)
            console.log(`  📋  EVENT: PlaylistSubmitted`)
            console.log(`      Playlist ID : #${playlistId}`)
            console.log(`      Role        : ${roleId}`)
            console.log(`      Name        : "${name}"`)
            console.log(`      Songs       : [${(songIds as bigint[]).join(', ')}]`)
            console.log(`      Stake sent  : ${mon(BigInt(stake))}`)

          } else if (ev.eventName === 'RoundComplete') {
            const { round, poolSize, totalScore, avgScore10x } = ev.args as any
            const avg = (Number(avgScore10x) / 10).toFixed(1)
            const bar = '█'.repeat(Math.round(Number(avgScore10x) / 10))
            console.log(``)
            console.log(`  🏁  EVENT: RoundComplete`)
            console.log(`      Round       : #${round}`)
            console.log(`      Pool size   : ${poolSize} playlists`)
            console.log(`      Total score : ${totalScore}`)
            console.log(`      Avg score   : ${avg}/10  ${bar}`)

          } else if (ev.eventName === 'PlaylistScored') {
            const { playlistId, roleId, score, agentPayout, treasuryDelta: evDelta, treasuryGained } = ev.args as any
            const scoreN    = Number(score)
            const payout    = BigInt(agentPayout)
            const evTrsDelta = BigInt(evDelta)

            console.log(``)
            console.log(`  🎯  EVENT: PlaylistScored`)
            console.log(`      Playlist ID   : #${playlistId}`)
            console.log(`      Scored by     : ${roleId}`)
            console.log(`      Score         : ${scoreN}/10  ${SCORE_LABEL[scoreN] ?? ''}`)
            console.log(`      Agent payout  : ${mon(payout)}`)
            if (treasuryGained) {
              console.log(`      Treasury gain : +${mon(evTrsDelta)}  (slashed from stake)`)
            } else if (evTrsDelta > 0n) {
              console.log(`      Treasury paid : -${mon(evTrsDelta)}  (reward bonus)`)
            } else {
              console.log(`      Treasury      : no change  (break even)`)
            }
          }
        }

        // ── Net flow summary ──────────────────────────────────────────────────
        console.log(``)
        console.log(`  💸  MON flow this tick`)
        console.log(`      Wallet   : ${mon(walletBefore)} → ${mon(walletAfter)}  (${mon(walletDelta, true)})`)
        console.log(`      Contract : ${mon(treasuryBefore)} → ${mon(treasuryAfter)}  (${mon(treasuryDelta, true)})`)

      } else if (outcome.status === 'reverted') {
        console.log(`  ❌  reverted: ${outcome.summary}`)
      }

    } catch (err: any) {
      lastAction = `error: ${err.message}`
      console.error(`  ❌  ERROR: ${err.message}`)
    }

    // ── Report tick to API ────────────────────────────────────────────────────
    await fetch(`${API_URL}/agents/${AGENT_ID}/loop/tick`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ lastAction }),
    })

    await sleep(loopState.interval * 1000)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
