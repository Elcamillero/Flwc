/**
 * One-shot: settle a specific matchId manually.
 * Usage: node bot/settle-one.mjs <matchId> <outcome 0=Home 1=Draw 2=Away>
 */
import { JsonRpcProvider, Wallet, Contract, formatEther } from 'ethers'
import * as dotenv from 'dotenv'
dotenv.config()

const [,, MATCH_ID, OUTCOME] = process.argv

if (!MATCH_ID || OUTCOME === undefined) {
  console.log('Usage: node bot/settle-one.mjs <matchId> <outcome>')
  process.exit(1)
}

const provider = new JsonRpcProvider(process.env.BASE_RPC_URL || 'https://mainnet.base.org')
const wallet   = new Wallet(process.env.BASE_PRIVATE_KEY, provider)
const contract = new Contract(
  process.env.VITE_MATCH_PREDICTIONS_ADDRESS,
  [
    'function settle(bytes32,uint8) external',
    'function getPool(bytes32) view returns (uint256,uint256,uint256,bool,uint8)',
    'function stakes(bytes32,uint8,address) view returns (uint256)',
  ],
  wallet
)

const pool = await contract.getPool(MATCH_ID)
console.log('Pool state:')
console.log('  Home pool:', formatEther(pool[0]), 'ETH')
console.log('  Draw pool:', formatEther(pool[1]), 'ETH')
console.log('  Away pool:', formatEther(pool[2]), 'ETH')
console.log('  Settled:  ', pool[3])
console.log('  Outcome:  ', ['Home','Draw','Away'][OUTCOME])

if (pool[3]) {
  console.log('Already settled! Winner:', ['Home','Draw','Away'][Number(pool[4])])
  process.exit(0)
}

console.log('\nSettling...')
const tx = await contract.settle(MATCH_ID, Number(OUTCOME))
console.log('tx sent:', tx.hash)
await tx.wait()
console.log('✓ Settled!')

// Confirm
const after = await contract.getPool(MATCH_ID)
console.log('Winner:', ['Home','Draw','Away'][Number(after[4])])
console.log('Total pool:', formatEther(after[0]+after[1]+after[2]), 'ETH — claimable now')
