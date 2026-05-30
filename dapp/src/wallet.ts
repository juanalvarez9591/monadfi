import { createWalletClient, createPublicClient, custom, http, formatEther } from 'viem'
import { anvil } from 'viem/chains'
import { useState, useEffect, useCallback } from 'react'

export const ANVIL_CHAIN_ID = 31337

export const publicClient = createPublicClient({
  chain: anvil,
  transport: http('http://127.0.0.1:8545'),
  pollingInterval: 2000,
})

declare global { interface Window { ethereum?: any } }

export function useWallet() {
  const [address, setAddress]       = useState<`0x${string}` | null>(null)
  const [chainId, setChainId]       = useState<number | null>(null)
  const [connecting, setConnecting] = useState(false)

  const walletClient = address
    ? createWalletClient({ account: address, chain: anvil, transport: custom(window.ethereum) })
    : null

  const connect = useCallback(async () => {
    if (!window.ethereum) { alert('MetaMask not found. Install it at metamask.io'); return }
    setConnecting(true)
    try {
      const accounts: string[] = await window.ethereum.request({ method: 'eth_requestAccounts' })
      setAddress(accounts[0] as `0x${string}`)
      const cid = await window.ethereum.request({ method: 'eth_chainId' })
      setChainId(parseInt(cid, 16))
    } finally { setConnecting(false) }
  }, [])

  const switchToAnvil = async () => {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x7a69' }],
      })
    } catch {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: '0x7a69',
          chainName: 'Anvil Local',
          rpcUrls: ['http://127.0.0.1:8545'],
          nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
        }],
      })
    }
  }

  useEffect(() => {
    if (!window.ethereum) return
    window.ethereum.on('accountsChanged', (accs: string[]) => setAddress((accs[0] as `0x${string}`) ?? null))
    window.ethereum.on('chainChanged', (cid: string) => setChainId(parseInt(cid, 16)))
    window.ethereum.request({ method: 'eth_accounts' }).then((accs: string[]) => {
      if (accs[0]) setAddress(accs[0] as `0x${string}`)
    })
    window.ethereum.request({ method: 'eth_chainId' }).then((cid: string) => setChainId(parseInt(cid, 16)))
  }, [])

  const wrongNetwork = chainId !== null && chainId !== ANVIL_CHAIN_ID

  return { address, chainId, wrongNetwork, connecting, walletClient, connect, switchToAnvil }
}

export function fmt(wei: bigint, dp = 2) {
  return parseFloat(formatEther(wei)).toFixed(dp)
}

export function shortAddr(addr: string) {
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}
