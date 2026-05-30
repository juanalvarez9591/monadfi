/**
 * register.ts
 *
 * Reads playlist-deployments.json + ABI from out/ and registers the contract
 * with the Go API so agents can discover it at runtime.
 *
 * Usage:
 *   npm run register
 *   API_URL=http://localhost:9090 npm run register
 */

import { loadDeployments, loadContract } from './src/contracts.js'

const API_URL = process.env.API_URL ?? 'http://localhost:8080'

const ARTIFACT_MAP: Record<string, { file: string; contract: string }> = {
  PlaylistBounty: { file: 'PlaylistBounty', contract: 'PlaylistBounty' },
}

async function main() {
  const deployments = loadDeployments()
  const skip = new Set(['chainId', 'deployedAt'])

  for (const [name, address] of Object.entries(deployments)) {
    if (skip.has(name)) continue

    const mapping = ARTIFACT_MAP[name]
    if (!mapping) {
      console.warn(`  skipping ${name} — no artifact mapping defined`)
      continue
    }

    const { abi } = loadContract(mapping.file, mapping.contract)

    const res = await fetch(`${API_URL}/contracts`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        address,
        abi:        JSON.stringify(abi),
        chainId:    deployments.chainId,
        deployedAt: deployments.deployedAt,
      }),
    })

    if (!res.ok) {
      throw new Error(`Failed to register ${name}: ${await res.text()}`)
    }

    const saved = await res.json()
    console.log(`  ${name}  ${address}  (id: ${saved.id})`)
  }
}

console.log(`Registering contracts with ${API_URL}`)
main().catch(e => { console.error(e); process.exit(1) })
