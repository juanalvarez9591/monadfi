/**
 * fund.ts
 *
 * Generates N deterministic agent wallets and:
 *   1. Sends 1 ETH to each (for gas)
 *   2. Mints 10,000 MTKN to each
 *   3. Approves CasinoRoulette to spend each wallet's tokens
 *
 * Usage:
 *   npm run fund           # funds 5 wallets (default)
 *   npm run fund -- 20     # funds 20 wallets
 */

import { parseEther } from 'viem'
import { publicClient, getAnvilAccount, makeWalletClient } from './src/client.js'
import { monadTokenABI, loadDeployments } from './src/contracts.js'
import { getAgentWallets, printWallets } from './src/wallets.js'

const N = parseInt(process.argv[2] ?? '5', 10)
if (isNaN(N) || N < 1) { console.error('Usage: npm run fund -- <N>'); process.exit(1) }

const TOKEN_AMOUNT   = parseEther('10000')
const APPROVAL_LIMIT = parseEther('1000000') // max allowance — agents never need to re-approve
const ETH_GAS_BUDGET = parseEther('1')

async function main() {
  const deployments  = loadDeployments()
  const house        = getAnvilAccount(0)
  const houseWallet  = makeWalletClient(house)
  const agents       = getAgentWallets(N)

  console.log(`House    : ${house.address}`)
  console.log(`Token    : ${deployments.MonadToken}`)
  console.log(`Casino   : ${deployments.CasinoRoulette}`)
  console.log(`\nFunding ${N} agent wallets:\n`)
  printWallets(agents)
  console.log()

  for (const [i, agent] of agents.entries()) {
    process.stdout.write(`[${i}] ${agent.address}  `)

    // 1. ETH for gas
    const ethTx = await houseWallet.sendTransaction({
      to:    agent.address,
      value: ETH_GAS_BUDGET,
    })
    await publicClient.waitForTransactionReceipt({ hash: ethTx })
    process.stdout.write('ETH ✓  ')

    // 2. Mint tokens
    const mintTx = await houseWallet.writeContract({
      address:      deployments.MonadToken,
      abi:          monadTokenABI,
      functionName: 'mint',
      args:         [agent.address, TOKEN_AMOUNT],
    })
    await publicClient.waitForTransactionReceipt({ hash: mintTx })
    process.stdout.write('mint ✓  ')

    // 3. Approve CasinoRoulette (done by the agent itself)
    const agentWallet = makeWalletClient(agent)
    const approveTx   = await agentWallet.writeContract({
      address:      deployments.MonadToken,
      abi:          monadTokenABI,
      functionName: 'approve',
      args:         [deployments.CasinoRoulette, APPROVAL_LIMIT],
    })
    await publicClient.waitForTransactionReceipt({ hash: approveTx })
    console.log('approve ✓')
  }

  console.log('\nAll wallets funded.')
}

main().catch((err) => { console.error(err); process.exit(1) })
