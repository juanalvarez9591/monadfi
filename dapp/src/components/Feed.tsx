import { useEffect, useRef, useState } from 'react'
import { publicClient } from '../wallet'
import type { Contracts } from '../contracts'
import { shortAddr, fmt } from '../wallet'
import { parseAbi } from 'viem'

interface FeedItem {
  id: string
  icon: string
  text: React.ReactNode
  time: string
}

export default function Feed({ contracts }: { contracts: Contracts }) {
  const [items, setItems] = useState<FeedItem[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  const push = (icon: string, text: React.ReactNode) => {
    const id = Math.random().toString(36).slice(2)
    const time = new Date().toLocaleTimeString()
    setItems(prev => [{ id, icon, text, time }, ...prev].slice(0, 50))
  }

  useEffect(() => {
    const unwatch = publicClient.watchContractEvent({
      address: contracts.casino.address,
      abi:     contracts.casino.abi,
      onLogs:  (logs: any[]) => {
        for (const log of logs) {
          const { eventName, args } = log
          if (eventName === 'PlayerContributed') {
            push('🎲', <>
              <span className="feed-addr">{shortAddr(args.player)}</span>{' '}
              staked <strong>{fmt(args.amount)} MTKN</strong>{' '}
              → pot is now <strong>{fmt(args.newTotalPot)} MTKN</strong>
            </>)
          } else if (eventName === 'GameOpened') {
            push('🏁', <>New game <strong>#{args.gameId?.toString()}</strong> opened. Window closes at {new Date(Number(args.windowClose) * 1000).toLocaleTimeString()}</>)
          } else if (eventName === 'GameResolved') {
            push('🏆', <>
              Game <strong>#{args.gameId?.toString()}</strong> resolved!{' '}
              Winner: <span className="feed-addr">{shortAddr(args.winner)}</span>{' '}
              won <strong>{fmt(args.payout)} MTKN</strong>
            </>)
          } else if (eventName === 'GameRefunded') {
            push('↩️', <>Game <strong>#{args.gameId?.toString()}</strong> was refunded — players can claim back their tokens.</>)
          } else if (eventName === 'RefundClaimed') {
            push('💸', <>
              <span className="feed-addr">{shortAddr(args.player)}</span>{' '}
              claimed <strong>{fmt(args.amount)} MTKN</strong> refund
            </>)
          }
        }
      },
    })
    return unwatch
  }, [contracts])

  return (
    <div className="card">
      <div className="card-title">Live Activity</div>
      {items.length === 0
        ? <div className="empty">Waiting for on-chain activity…</div>
        : (
          <div className="feed">
            {items.map(item => (
              <div key={item.id} className="feed-item">
                <span className="feed-icon">{item.icon}</span>
                <span className="feed-text">{item.text}</span>
                <span className="feed-time">{item.time}</span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )
      }
    </div>
  )
}
