/**
 * FLWC Settlement Bot — v2 (trustless)
 *
 * Lifecycle per match:
 *   1. openMatch()   — called ~2 min before kickoff (owner only)
 *   2. commitSeed()  — called right at kickoff (within 256 blocks ≈ 8.5 min)
 *   3. settle()      — called after kickoff + 20 min (anyone, trustless)
 */
import { JsonRpcProvider, Wallet, Contract, id as ethersId } from 'ethers'
import { createRequire } from 'module'
import * as dotenv from 'dotenv'

dotenv.config()
const require = createRequire(import.meta.url)
const roster  = require('../src/data/officialRoster.json')

// ── Config ────────────────────────────────────────────────────────────────────
const RPC_URL          = (process.env.BASE_RPC_URL             || 'https://mainnet.base.org').trim()
const PRIVATE_KEY      = process.env.BASE_PRIVATE_KEY?.trim()
const CONTRACT_ADDRESS = process.env.VITE_MATCH_PREDICTIONS_ADDRESS?.trim()
const EPOCH_ISO        = (process.env.VITE_FLWC_TOURNAMENT_START_AT || '2026-06-03T00:00:00.000Z').trim()

const MATCH_DURATION_MS  = 20 * 60 * 1000       // 20 min per match
const OPEN_BEFORE_MS     = 2  * 60 * 1000       // open match 2 min before kickoff
const COMMIT_WINDOW_SECS = 8  * 60              // commitSeed within 8 min of kickoff
const GRACE_WINDOW_MS    = 2  * 60 * 60 * 1000  // settle up to 2 h after match ends
const POLL_INTERVAL_MS   = 30_000               // poll every 30 s

const ABI = [
  'function openMatch(bytes32 matchId, uint64 kickoff, uint32 homeStrength, uint32 awayStrength) external',
  'function commitSeed(bytes32 matchId, uint32 blockNumber) external',
  'function settle(bytes32 matchId) external',
  'function ownerSettle(bytes32 matchId, uint8 winner) external',
  'function getPool(bytes32 matchId) external view returns (uint256 homePool, uint256 drawPool, uint256 awayPool, bool settled, uint8 winner, bool seedCommitted)',
  'function pools(bytes32) view returns (uint256 homePool, uint256 drawPool, uint256 awayPool, bytes32 seed, uint64 kickoff, uint32 seedBlock, uint32 homeStrength, uint32 awayStrength, uint8 winner, bool seedCommitted, bool settled)',
]

// ── Team strengths ────────────────────────────────────────────────────────────
function getTeamStrength(teamName) {
  const squad = roster.players
    .filter(p => p.team === teamName)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 11)
  if (!squad.length) return 78
  const total = squad.reduce(
    (sum, p) => sum + p.rating * 0.5 + p.attack * 0.22 + p.defense * 0.18 + p.pace * 0.1, 0
  )
  return Math.round(total / squad.length)
}

// ── Generate matches (mirrors frontend) ──────────────────────────────────────
function generateAllMatches() {
  const matches = []
  const teamsByGroup = {}
  for (const team of roster.teams) {
    if (!teamsByGroup[team.group]) teamsByGroup[team.group] = []
    teamsByGroup[team.group].push(team.name)
  }
  for (const [, teams] of Object.entries(teamsByGroup).sort(([a],[b]) => a.localeCompare(b))) {
    for (const [hi, ai] of [[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]]) {
      const n = matches.length + 1
      matches.push({
        id:   `FLWC-${String(n).padStart(3,'0')}`,
        home: teams[hi] || `Team ${hi+1}`,
        away: teams[ai] || `Team ${ai+1}`,
        slot: matches.length,
      })
    }
  }
  // Fill to 104
  while (matches.length < 104) {
    const n = matches.length + 1
    matches.push({ id: `FLWC-${String(n).padStart(3,'0')}`, home: 'TBD', away: 'TBD', slot: matches.length })
  }
  return matches
}

// ── Cycle helpers ─────────────────────────────────────────────────────────────
const EPOCH_MS = new Date(EPOCH_ISO).getTime()

function kickoffMs(slot, cycle, total) {
  return EPOCH_MS + (cycle * total + slot) * MATCH_DURATION_MS
}
function matchIdBytes(id, cycle) {
  return ethersId(`FLWC_MATCH:${id}:${cycle}`)
}
function currentCycle(total) {
  return Math.floor(Math.max(0, Date.now() - EPOCH_MS) / (total * MATCH_DURATION_MS))
}

// ── RPC helper (direct fetch, avoids ethers quirks) ───────────────────────────
async function rpcCall(method, params) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`RPC ${method}: ${data.error.message}`)
  return data.result
}

async function getLatestBlock() {
  const b = await rpcCall('eth_getBlockByNumber', ['latest', false])
  return { number: parseInt(b.number, 16), timestamp: parseInt(b.timestamp, 16) }
}

// Find a block number whose timestamp is closest to targetSec
async function blockAtTimestamp(targetSec) {
  const latest = await getLatestBlock()
  const secsAgo = Math.max(0, latest.timestamp - targetSec)
  // Base: ~2 blocks/sec
  return Math.max(1, latest.number - Math.round(secsAgo * 2))
}

// ── Main tick ─────────────────────────────────────────────────────────────────
async function tick(contract, matches) {
  const now   = Date.now()
  const total = matches.length
  const cycle = currentCycle(total)

  // Look at current cycle + previous (catch missed)
  for (const c of [cycle, cycle - 1].filter(x => x >= 0)) {
    for (const m of matches) {
      const kickoff    = kickoffMs(m.slot, c, total)
      const matchEnd   = kickoff + MATCH_DURATION_MS
      const kickoffSec = Math.floor(kickoff / 1000)
      const bid        = matchIdBytes(m.id, c)

      // ── 1. openMatch — 2 min before kickoff ──────────────────────────────
      if (now >= kickoff - OPEN_BEFORE_MS && now < kickoff + 60_000) {
        try {
          const pool = await contract.getPool(bid)
          const kickoffOnChain = pool[0] // homePool is [0], but we need kickoff from pools()
          // Check via pools() to see if already opened
          const raw = await contract.pools(bid)
          if (raw.kickoff === 0n) {
            const homeStr = getTeamStrength(m.home)
            const awayStr = getTeamStrength(m.away)
            console.log(`[${ts()}] OPEN ${m.id} c${c}: ${m.home}(${homeStr}) vs ${m.away}(${awayStr})`)
            const tx = await contract.openMatch(bid, kickoffSec, homeStr, awayStr)
            await tx.wait()
            console.log(`  ✓ openMatch tx ${tx.hash}`)
          }
        } catch (err) {
          const msg = err.shortMessage ?? err.message
          if (!msg.includes('EXISTS')) console.error(`  ✗ openMatch ${m.id} c${c}:`, msg)
        }
      }

      // ── 2. commitSeed — within 8 min of kickoff ──────────────────────────
      if (now >= kickoff && now < kickoff + COMMIT_WINDOW_SECS * 1000) {
        try {
          const raw = await contract.pools(bid)
          if (raw.kickoff !== 0n && !raw.seedCommitted) {
            const latest = await getLatestBlock()
            // Use a block from a few blocks after kickoff to be safe
            const blockNum = await blockAtTimestamp(kickoffSec)
            console.log(`[${ts()}] COMMIT_SEED ${m.id} c${c} blockNum=${blockNum}`)
            const tx = await contract.commitSeed(bid, blockNum)
            await tx.wait()
            console.log(`  ✓ commitSeed tx ${tx.hash}`)
          }
        } catch (err) {
          const msg = err.shortMessage ?? err.message
          if (!msg.includes('ALREADY_COMMITTED') && !msg.includes('BLOCK_TOO_OLD')) {
            console.error(`  ✗ commitSeed ${m.id} c${c}:`, msg)
          }
        }
      }

      // ── 3. settle — after match ends ─────────────────────────────────────
      if (now >= matchEnd && now - matchEnd <= GRACE_WINDOW_MS) {
        try {
          const pool = await contract.getPool(bid)
          const [homePool, drawPool, awayPool, settled, , seedCommitted] = pool
          if (settled) continue

          const totalPool = homePool + drawPool + awayPool
          if (totalPool === 0n) continue  // no bets, skip

          if (seedCommitted) {
            console.log(`[${ts()}] SETTLE ${m.id} c${c}: ${m.home} vs ${m.away}`)
            const tx = await contract.settle(bid)
            await tx.wait()
            console.log(`  ✓ settle tx ${tx.hash}`)
          } else {
            // Seed was not committed in time — owner fallback
            // Compute winner manually from block hash
            console.log(`[${ts()}] OWNER_SETTLE (no seed) ${m.id} c${c}`)
            const { keccak256, solidityPacked } = await import('ethers')
            const blockHash = await (async () => {
              const bnum = await blockAtTimestamp(kickoffSec)
              const b = await rpcCall('eth_getBlockByNumber', [`0x${bnum.toString(16)}`, false])
              return b?.hash ?? null
            })()
            if (!blockHash) { console.warn(`  no block hash for ${m.id}`); continue }
            const homeStr = getTeamStrength(m.home)
            const awayStr = getTeamStrength(m.away)
            const t = BigInt(homeStr + awayStr)
            let h = 0, a = 0
            for (let min = 1; min <= 90; min++) {
              const gr = BigInt(keccak256(solidityPacked(['bytes32','uint256','uint8'], [blockHash, min, 1]))) % 10000n
              if (gr < 280n) {
                const tr = BigInt(keccak256(solidityPacked(['bytes32','uint256','uint8'], [blockHash, min, 2]))) % t
                if (tr < BigInt(homeStr)) h++; else a++
              }
            }
            const outcome = h > a ? 0 : h === a ? 1 : 2
            const tx = await contract.ownerSettle(bid, outcome)
            await tx.wait()
            console.log(`  ✓ ownerSettle (${['Home','Draw','Away'][outcome]}) tx ${tx.hash}`)
          }
        } catch (err) {
          const msg = err.shortMessage ?? err.message
          if (!msg.includes('ALREADY_SETTLED')) console.error(`  ✗ settle ${m.id} c${c}:`, msg)
        }
      }
    }
  }
}

function ts() { return new Date().toISOString() }

// ── Entry ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!PRIVATE_KEY)      throw new Error('Missing BASE_PRIVATE_KEY')
  if (!CONTRACT_ADDRESS) throw new Error('Missing VITE_MATCH_PREDICTIONS_ADDRESS')

  const provider = new JsonRpcProvider(RPC_URL)
  const wallet   = new Wallet(PRIVATE_KEY, provider)
  const contract = new Contract(CONTRACT_ADDRESS, ABI, wallet)
  const matches  = generateAllMatches()
  const { formatEther } = await import('ethers')
  const balance  = await provider.getBalance(wallet.address)

  console.log('═══════════════════════════════════════════')
  console.log('  FLWC Settlement Bot v2 (trustless)')
  console.log('═══════════════════════════════════════════')
  console.log(`  Wallet   : ${wallet.address}`)
  console.log(`  Balance  : ${formatEther(balance)} ETH`)
  console.log(`  Contract : ${CONTRACT_ADDRESS}`)
  console.log(`  Matches  : ${matches.length} / cycle`)
  console.log(`  Epoch    : ${EPOCH_ISO}`)
  console.log(`  Cycle    : ${currentCycle(matches.length)}`)
  console.log('═══════════════════════════════════════════')

  await tick(contract, matches)
  setInterval(() => tick(contract, matches).catch(console.error), POLL_INTERVAL_MS)
}

main().catch(err => { console.error(err); process.exit(1) })
