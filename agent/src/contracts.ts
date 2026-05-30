import { readFileSync, writeFileSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import type { Abi, Hex, Address } from 'viem'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '../../out')
const DEPLOYMENTS_PATH = join(__dirname, '../playlist-deployments.json')

// ── ABI + bytecode loading ────────────────────────────────────────────────────

function loadArtifact(solidityFile: string, contractName: string) {
  const path = join(OUT_DIR, `${solidityFile}.sol`, `${contractName}.json`)
  if (!existsSync(path)) {
    throw new Error(
      `Artifact not found: ${path}\nRun: forge build`
    )
  }
  return JSON.parse(readFileSync(path, 'utf-8'))
}

const playlistArtifact = loadArtifact('PlaylistBounty', 'PlaylistBounty')

export const playlistBountyABI:       Abi = playlistArtifact.abi
export const playlistBountyBytecode:  Hex = playlistArtifact.bytecode.object

// ── Deployment registry ───────────────────────────────────────────────────────

export interface Deployments {
  PlaylistBounty:  Address
  chainId:         number
  deployedAt:      string
}

export function loadDeployments(): Deployments {
  if (!existsSync(DEPLOYMENTS_PATH)) {
    throw new Error('playlist-deployments.json not found — run: npm run deploy:playlist')
  }
  return JSON.parse(readFileSync(DEPLOYMENTS_PATH, 'utf-8'))
}

export function saveDeployments(d: Deployments): void {
  writeFileSync(DEPLOYMENTS_PATH, JSON.stringify(d, null, 2))
}

// ── Generic ABI loader (for future contracts) ─────────────────────────────────

/**
 * Load any compiled contract's ABI + bytecode by name.
 * Follows the Foundry out/ convention: out/<File>.sol/<Contract>.json
 */
export function loadContract(solidityFile: string, contractName: string) {
  const artifact = loadArtifact(solidityFile, contractName)
  return {
    abi:      artifact.abi as Abi,
    bytecode: artifact.bytecode.object as Hex,
  }
}
