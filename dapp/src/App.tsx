import { useWallet, shortAddr } from './wallet'
import { useContracts } from './contracts'
import Game from './components/Game'
import Feed from './components/Feed'

export default function App() {
  const { address, wrongNetwork, connecting, walletClient, connect, switchToAnvil } = useWallet()
  const { contracts, error } = useContracts()

  return (
    <>
      <header>
        <div className="logo">
          🎰 Casino<span className="gold">Roulette</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {wrongNetwork && (
            <button className="wallet-btn" onClick={switchToAnvil} style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>
              ⚠️ Switch to Anvil
            </button>
          )}
          <button className={`wallet-btn ${address ? 'connected' : ''}`} onClick={connect} disabled={connecting}>
            <span className="dot" />
            {connecting ? 'Connecting…' : address ? shortAddr(address) : 'Connect Wallet'}
          </button>
        </div>
      </header>

      <main>
        {error && (
          <div className="network-warn">
            ⚠️ {error} — make sure the API is running and contracts are deployed.
          </div>
        )}
        {wrongNetwork && (
          <div className="network-warn">
            ⚠️ Wrong network. Click "Switch to Anvil" to connect to the local chain (chain ID 31337).
          </div>
        )}

        {!contracts ? (
          <div className="empty" style={{ marginTop: 80 }}>
            {error ? error : 'Loading contracts…'}
          </div>
        ) : (
          <>
            <Game contracts={contracts} address={address} walletClient={walletClient} />
            <Feed contracts={contracts} />
          </>
        )}
      </main>
    </>
  )
}
