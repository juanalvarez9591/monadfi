/**
 * deploy-generic.ts
 *
 * Deploy ANY Foundry-compiled contract to the running chain and record its
 * address. This is the contract-agnostic counterpart to deploy.ts (which knows
 * the MonadToken→CasinoRoulette dependency).
 *
 * Usage:
 *   npm run deploy:any -- <Contract> [constructorArgsJSON]
 *   npm run deploy:any -- MonadToken '["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"]'
 *
 * <Contract> is the Foundry artifact name (assumes file <Contract>.sol/<Contract>.json).
 * Writes the address to deployments.json under that name.
 */

import { writeFileSync, readFileSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { publicClient, getAnvilAccount, makeWalletClient } from './src/client.js'
import { loadContract } from './src/contracts.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEPLOYMENTS = join(__dirname, 'deployments.json')

const name = process.argv[2] ?? process.env.CONTRACT
if (!name) { console.error('Usage: npm run deploy:any -- <Contract> [argsJSON]'); process.exit(1) }

const argsJSON = process.argv[3] ?? process.env.CONTRACT_ARGS ?? '[]'
let args: unknown[]
try { args = JSON.parse(argsJSON) } catch { console.error(`bad args JSON: ${argsJSON}`); process.exit(1) }

async function main() {
  const chain = await publicClient.getChainId()
  const deployer = getAnvilAccount(0)
  const wallet = makeWalletClient(deployer)
  const { abi, bytecode } = loadContract(name!, name!)

  console.log(`Chain ID : ${chain}`)
  console.log(`Deployer : ${deployer.address}`)
  console.log(`Deploying ${name} with args ${JSON.stringify(args)}…`)

  const hash = await wallet.deployContract({ abi, bytecode, args: args as any })
  const { contractAddress } = await publicClient.waitForTransactionReceipt({ hash })
  if (!contractAddress) throw new Error(`${name} deployment failed — no address in receipt`)
  console.log(`  ${name} → ${contractAddress}`)

  const existing = existsSync(DEPLOYMENTS) ? JSON.parse(readFileSync(DEPLOYMENTS, 'utf-8')) : {}
  existing[name!] = contractAddress
  existing.chainId = chain
  existing.deployedAt = new Date().toISOString()
  writeFileSync(DEPLOYMENTS, JSON.stringify(existing, null, 2))
  console.log('Saved → deployments.json ✓')
}

main().catch((e) => { console.error(e); process.exit(1) })
