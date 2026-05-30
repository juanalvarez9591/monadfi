import { useState, useEffect } from 'react'
import type { Abi, Address } from 'viem'

export interface ContractConfig {
  address: Address
  abi: Abi
}

export interface Contracts {
  casino: ContractConfig
  token:  ContractConfig
}

export function useContracts() {
  const [contracts, setContracts] = useState<Contracts | null>(null)
  const [error, setError]         = useState('')

  useEffect(() => {
    fetch('/api/contracts')
      .then(r => r.json())
      .then((list: any[]) => {
        const casino = list.find(c => c.name === 'CasinoRoulette')
        const token  = list.find(c => c.name === 'MonadToken')
        if (!casino || !token) throw new Error('Contracts not deployed yet. Run: make all')
        setContracts({
          casino: { address: casino.address as Address, abi: casino.abi },
          token:  { address: token.address  as Address, abi: token.abi  },
        })
      })
      .catch(e => setError(e.message))
  }, [])

  return { contracts, error }
}
