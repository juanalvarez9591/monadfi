import { useEffect, useState, useCallback } from 'react'
import { parseEther, maxUint256 } from 'viem'
import { publicClient, fmt, shortAddr } from '../wallet'
import type { Contracts } from '../contracts'

interface GameState {
  id: bigint
  state: number  // 0=None 1=Open 2=Resolved 3=Refunded
  windowClose: bigint
  totalPot: bigint
  winner: string
  players: string[]
  myContribution: bigint
}

const STATE_LABELS: Record<number, string> = { 0: 'none', 1: 'open', 2: 'resolved', 3: 'refunded' }
const STATE_NAMES:  Record<number, string> = { 0: 'No Game', 1: 'Open', 2: 'Resolved', 3: 'Refunded' }

function useTimer(windowClose: bigint) {
  const [remaining, setRemaining] = useState(0)
  useEffect(() => {
    const update = () => setRemaining(Math.max(0, Number(windowClose) - Math.floor(Date.now() / 1000)))
    update()
    const t = setInterval(update, 1000)
    return () => clearInterval(t)
  }, [windowClose])
  const m = Math.floor(remaining / 60).toString().padStart(2, '0')
  const s = (remaining % 60).toString().padStart(2, '0')
  return { remaining, display: `${m}:${s}` }
}

export default function Game({
  contracts, address, walletClient,
}: {
  contracts: Contracts
  address: `0x${string}` | null
  walletClient: any
}) {
  const [game, setGame]         = useState<GameState | null>(null)
  const [tokenBal, setTokenBal] = useState<bigint>(0n)
  const [allowance, setAllowance] = useState<bigint>(0n)
  const [amount, setAmount]     = useState('100')
  const [busy, setBusy]         = useState(false)
  const [txMsg, setTxMsg]       = useState('')

  const refresh = useCallback(async () => {
    try {
      const [idRaw, gameData] = await publicClient.readContract({
        address: contracts.casino.address, abi: contracts.casino.abi,
        functionName: 'getCurrentGame',
      }) as [bigint, any]

      const players = idRaw > 0n
        ? await publicClient.readContract({ address: contracts.casino.address, abi: contracts.casino.abi, functionName: 'getPlayers', args: [idRaw] }) as string[]
        : []

      const myContrib = (address && idRaw > 0n)
        ? await publicClient.readContract({ address: contracts.casino.address, abi: contracts.casino.abi, functionName: 'myContribution', args: [idRaw, address] }) as bigint
        : 0n

      setGame({
        id: idRaw, state: gameData.state,
        windowClose: gameData.windowClose, totalPot: gameData.totalPot,
        winner: gameData.winner, players, myContribution: myContrib,
      })

      if (address) {
        const bal = await publicClient.readContract({ address: contracts.token.address, abi: contracts.token.abi, functionName: 'balanceOf', args: [address] }) as bigint
        const all = await publicClient.readContract({ address: contracts.token.address, abi: contracts.token.abi, functionName: 'allowance', args: [address, contracts.casino.address] }) as bigint
        setTokenBal(bal)
        setAllowance(all)
      }
    } catch {}
  }, [contracts, address])

  useEffect(() => { refresh(); const t = setInterval(refresh, 3000); return () => clearInterval(t) }, [refresh])

  const { remaining, display: timerDisplay } = useTimer(game?.windowClose ?? 0n)

  const amountWei = (() => { try { return parseEther(amount || '0') } catch { return 0n } })()
  const needsApproval = allowance < amountWei

  const approve = async () => {
    if (!walletClient) return
    setBusy(true); setTxMsg('Approving MTKN…')
    try {
      const hash = await walletClient.writeContract({ address: contracts.token.address, abi: contracts.token.abi, functionName: 'approve', args: [contracts.casino.address, maxUint256] })
      await publicClient.waitForTransactionReceipt({ hash })
      setTxMsg('Approved ✓')
      refresh()
    } catch (e: any) { setTxMsg('Error: ' + e.shortMessage ?? e.message) }
    setBusy(false)
  }

  const contribute = async () => {
    if (!walletClient || !game) return
    setBusy(true); setTxMsg('Sending transaction…')
    try {
      const hash = await walletClient.writeContract({ address: contracts.casino.address, abi: contracts.casino.abi, functionName: 'contribute', args: [game.id, amountWei] })
      await publicClient.waitForTransactionReceipt({ hash })
      setTxMsg(`Staked ${amount} MTKN ✓`)
      refresh()
    } catch (e: any) { setTxMsg('Error: ' + (e.shortMessage ?? e.message)) }
    setBusy(false)
  }

  const claimRefund = async () => {
    if (!walletClient || !game) return
    setBusy(true); setTxMsg('Claiming refund…')
    try {
      const hash = await walletClient.writeContract({ address: contracts.casino.address, abi: contracts.casino.abi, functionName: 'claimRefund', args: [game.id] })
      await publicClient.waitForTransactionReceipt({ hash })
      setTxMsg('Refund claimed ✓')
      refresh()
    } catch (e: any) { setTxMsg('Error: ' + (e.shortMessage ?? e.message)) }
    setBusy(false)
  }

  const isOpen     = game?.state === 1
  const isAccepting = isOpen && remaining > 0
  const isResolved  = game?.state === 2
  const isRefunded  = game?.state === 3
  const isWinner    = isResolved && address && game?.winner.toLowerCase() === address.toLowerCase()

  return (
    <>
      {/* Winner banner */}
      {isWinner && (
        <div className="winner-banner">
          <h2>🏆 You Won!</h2>
          <p>Congratulations — you took the pot!</p>
        </div>
      )}
      {isResolved && !isWinner && game?.winner !== '0x0000000000000000000000000000000000000000' && (
        <div className="winner-banner" style={{ borderColor: 'var(--primary)' }}>
          <h2 style={{ color: 'var(--primary)' }}>Game Resolved</h2>
          <div className="winner-addr">Winner: {shortAddr(game.winner)}</div>
        </div>
      )}

      <div className="grid2">
        {/* Left — game info */}
        <div>
          <div className="card">
            <div className="card-title">Current Game {game?.id ? `#${game.id}` : ''}</div>
            <div style={{ marginBottom: 16 }}>
              <span className={`state-badge ${STATE_LABELS[game?.state ?? 0]}`}>
                {isOpen && <span className="pulse" />}
                {STATE_NAMES[game?.state ?? 0]}
              </span>
            </div>

            <div className="pot-amount">{game ? fmt(game.totalPot) : '0.00'}</div>
            <div className="pot-label">MTKN in pot</div>

            <div className="stats-row">
              <div className="stat">
                <div className="slabel">Players</div>
                <div className="sval">{game?.players.length ?? 0}</div>
              </div>
              <div className="stat">
                <div className="slabel">{isAccepting ? 'Closes In' : 'Window'}</div>
                <div className={`sval timer ${isAccepting && remaining < 60 ? 'urgent' : ''}`}>
                  {isAccepting ? timerDisplay : isOpen ? 'Closed' : '—'}
                </div>
              </div>
              <div className="stat">
                <div className="slabel">My Stake</div>
                <div className="sval" style={{ color: 'var(--primary)', fontSize: 16 }}>
                  {game ? fmt(game.myContribution) : '0'} <span style={{ fontSize: 11, color: 'var(--muted)' }}>MTKN</span>
                </div>
              </div>
            </div>
          </div>

          {/* Players list */}
          {game && game.players.length > 0 && (
            <div className="card">
              <div className="card-title">Players ({game.players.length})</div>
              <div className="players-list">
                {game.players.map(p => {
                  const contrib = 0n  // fetched separately if needed
                  const isMe = address && p.toLowerCase() === address.toLowerCase()
                  return (
                    <div key={p} className="player-row">
                      <span className={`player-addr ${isMe ? 'me' : ''}`}>
                        {isMe ? '⭐ You' : shortAddr(p)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right — actions */}
        <div>
          <div className="card">
            <div className="card-title">Place Your Bet</div>

            {!address ? (
              <div className="empty">Connect your wallet to play</div>
            ) : !isAccepting && !isRefunded ? (
              <div className="empty" style={{ padding: '20px 0' }}>
                {isResolved ? 'Game resolved. Waiting for next round…' : 'No active game right now.'}
              </div>
            ) : isRefunded ? (
              <>
                <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>This game was refunded. Claim your tokens back.</p>
                <button className="btn gold" onClick={claimRefund} disabled={busy}>
                  {busy ? 'Processing…' : '↩️ Claim Refund'}
                </button>
              </>
            ) : (
              <>
                <div className="balance-row">
                  <span className="blabel">Your MTKN Balance</span>
                  <span className="bval">{fmt(tokenBal)} MTKN</span>
                </div>

                <div className="amount-wrap">
                  <input
                    type="number" min="1" value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="100"
                  />
                  <span className="token-tag">MTKN</span>
                </div>

                <div className="quick-row">
                  {['50', '100', '500', '1000'].map(v => (
                    <button key={v} className={`qbtn ${amount === v ? 'active' : ''}`} onClick={() => setAmount(v)}>{v}</button>
                  ))}
                </div>

                {game.myContribution > 0n && (
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
                    Your current stake: <strong style={{ color: 'var(--primary)' }}>{fmt(game.myContribution)} MTKN</strong>
                    {' '}({game.totalPot > 0n ? ((Number(game.myContribution) / Number(game.totalPot)) * 100).toFixed(1) : 0}% of pot)
                  </div>
                )}

                {needsApproval ? (
                  <button className="btn primary" onClick={approve} disabled={busy}>
                    {busy ? 'Approving…' : '🔓 Approve MTKN'}
                  </button>
                ) : (
                  <button className="btn gold" onClick={contribute} disabled={busy || amountWei === 0n || amountWei > tokenBal}>
                    {busy ? 'Processing…' : `🎲 Stake ${amount || '0'} MTKN`}
                  </button>
                )}
              </>
            )}

            {txMsg && (
              <div style={{ marginTop: 12, fontSize: 13, color: txMsg.startsWith('Error') ? 'var(--red)' : 'var(--green)', textAlign: 'center' }}>
                {txMsg}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
