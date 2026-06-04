/**
 * FLWC Settlement Bot
 * Runs 24/7 — detects finished matches, computes winner from Base block hash,
 * and calls settle() on the MatchPredictions contract automatically.
 */
import { JsonRpcProvider, Wallet, Contract, id as ethersId, keccak256, solidityPacked } from 'ethers'
import { createRequire } from 'module'
import * as dotenv from 'dotenv'

dotenv.config()
const require = createRequire(import.meta.url)
const roster  = require('../src/data/officialRoster.json')

// ── Config ────────────────────────────────────────────────────────────────────
const RPC_URL          = process.env.BASE_RPC_URL             || 'https://mainnet.base.org'
const PRIVATE_KEY      = process.env.BASE_PRIVATE_KEY
const CONTRACT_ADDRESS = process.env.VITE_MATCH_PREDICTIONS_ADDRESS
const EPOCH_ISO        = process.env.VITE_FLWC_TOURNAMENT_START_AT || '2026-06-03T00:00:00.000Z'
const MATCH_DURATION_MS = 20 * 60 * 1000   // 20 real minutes per match
const GRACE_WINDOW_MS  = 2 * 60 * 60 * 1000 // settle up to 2 hours after match ends
const POLL_INTERVAL_MS = 45_000              // check every 45 seconds

const ABI = [
  'function settle(bytes32 matchId, uint8 winner) external',
  'function pools(bytes32) view returns (uint256 homePool, uint256 drawPool, uint256 awayPool, uint8 winner, bool settled)',
]

// ── Mirror of frontend getTeamStrength ────────────────────────────────────────
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

// ── Mirror of Solidity MatchRegistry.computeResult ────────────────────────────
// Returns 0=Home wins, 1=Draw, 2=Away wins
function computeWinner(blockHash, homeStrength, awayStrength) {
  const total = BigInt(homeStrength + awayStrength)
  let home = 0, away = 0

  for (let min = 1; min <= 90; min++) {
    const goalRoll = BigInt(keccak256(solidityPacked(['bytes32','uint256','uint8'], [blockHash, min, 1]))) % 10000n
    if (goalRoll < 280n) {
      const teamRoll = BigInt(keccak256(solidityPacked(['bytes32','uint256','uint8'], [blockHash, min, 2]))) % total
      if (teamRoll < BigInt(homeStrength)) home++
      else away++
    }
  }

  return home > away ? 0 : home === away ? 1 : 2
}

// ── Mirror of frontend generateTournamentMatches ──────────────────────────────
function generateAllMatches() {
  const matches = []
  const teamsByGroup = {}

  for (const team of roster.teams) {
    if (!teamsByGroup[team.group]) teamsByGroup[team.group] = []
    teamsByGroup[team.group].push(team.name)
  }

  for (const [group, teams] of Object.entries(teamsByGroup).sort(([a],[b]) => a.localeCompare(b))) {
    for (const [hi, ai] of [[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]]) {
      matches.push({
        id: `FLWC-${String(matches.length+1).padStart(3,'0')}`,
        home: teams[hi] || `${group} Team ${hi+1}`,
        away: teams[ai] || `${group} Team ${ai+1}`,
        slot: matches.length,
      })
    }
  }

  // Round of 32
  const seeded = roster.teams
    .map(t => ({ name: t.name, str: getTeamStrength(t.name) }))
    .sort((a,b) => b.str - a.str).slice(0, 32).map(t => t.name)

  for (let i = 0; i < 16; i++) {
    matches.push({
      id: `FLWC-${String(matches.length+1).padStart(3,'0')}`,
      home: seeded[i]    || `Seed ${i+1}`,
      away: seeded[31-i] || `Seed ${32-i}`,
      slot: matches.length,
    })
  }

  // Knockout
  for (const [stage, count] of [['Round of 16',8],['Quarter-finals',4],['Semi-finals',2],['Third-place Match',1],['Final',1]]) {
    for (let i = 0; i < count; i++) {
      matches.push({
        id:   `FLWC-${String(matches.length+1).padStart(3,'0')}`,
        home: `${stage} Q${i*2+1}`,
        away: `${stage} Q${i*2+2}`,
        slot: matches.length,
      })
    }
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
  const elapsed = Date.now() - EPOCH_MS
  return Math.floor(Math.max(0, elapsed) / (total * MATCH_DURATION_MS))
}

// ── Fetch block hash closest to a given timestamp ─────────────────────────────
async function fetchBlockHashAt(timestampMs) {
  const targetSec = Math.floor(timestampMs / 1000)

  const post = (method, params) => fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc:'2.0', id:1, method, params }),
  }).then(r => r.json()).then(d => d.result)

  const latest = await post('eth_getBlockByNumber', ['latest', false])
  if (!latest) return null

  const latestNum = parseInt(latest.number, 16)
  const latestTs  = parseInt(latest.timestamp, 16)
  const secsAgo   = Math.max(0, latestTs - targetSec)
  const targetNum = Math.max(1, latestNum - Math.round(secsAgo * 0.5))

  const block = await post('eth_getBlockByNumber', [`0x${targetNum.toString(16)}`, false])
  return block?.hash ?? null
}

// ── Main tick ─────────────────────────────────────────────────────────────────
async function tick(contract, matches) {
  const now   = Date.now()
  const total = matches.length
  const cycle = currentCycle(total)

  // Check current cycle and one back (in case something was missed)
  for (const c of [cycle, cycle - 1].filter(x => x >= 0)) {
    for (const m of matches) {
      const start = kickoffMs(m.slot, c, total)
      const end   = start + MATCH_DURATION_MS

      if (now < end)             continue  // match not finished
      if (now - end > GRACE_WINDOW_MS) continue  // too old, skip

      const bid = matchIdBytes(m.id, c)

      try {
        const pool = await contract.pools(bid)
        if (pool.settled) continue

        const totalPool = pool.homePool + pool.drawPool + pool.awayPool
        if (totalPool === 0n) continue  // no bets, no need to settle

        const blockHash = await fetchBlockHashAt(start)
        if (!blockHash) { console.warn(`No block hash for ${m.id} cycle ${c}`); continue }

        const homeStr  = getTeamStrength(m.home)
        const awayStr  = getTeamStrength(m.away)
        const outcome  = computeWinner(blockHash, homeStr, awayStr)
        const label    = ['Home','Draw','Away'][outcome]

        console.log(`[${new Date().toISOString()}] Settling ${m.id} c${c}: ${m.home} vs ${m.away} → ${label}`)

        const tx = await contract.settle(bid, outcome)
        await tx.wait()
        console.log(`  ✓ tx ${tx.hash}`)

      } catch (err) {
        console.error(`  ✗ ${m.id} c${c}:`, err.shortMessage ?? err.message)
      }
    }
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────
async function main() {
  if (!PRIVATE_KEY)      throw new Error('Missing BASE_PRIVATE_KEY in .env')
  if (!CONTRACT_ADDRESS) throw new Error('Missing VITE_MATCH_PREDICTIONS_ADDRESS in .env')

  const provider = new JsonRpcProvider(RPC_URL)
  const wallet   = new Wallet(PRIVATE_KEY, provider)
  const contract = new Contract(CONTRACT_ADDRESS, ABI, wallet)
  const matches  = generateAllMatches()

  const balance = await provider.getBalance(wallet.address)
  const { formatEther } = await import('ethers')

  console.log('═══════════════════════════════════════')
  console.log('  FLWC Settlement Bot')
  console.log('═══════════════════════════════════════')
  console.log(`  Wallet   : ${wallet.address}`)
  console.log(`  Balance  : ${formatEther(balance)} ETH`)
  console.log(`  Contract : ${CONTRACT_ADDRESS}`)
  console.log(`  Matches  : ${matches.length} per cycle`)
  console.log(`  Epoch    : ${EPOCH_ISO}`)
  console.log(`  Cycle    : ${currentCycle(matches.length)}`)
  console.log('═══════════════════════════════════════')

  // First tick immediately, then poll
  await tick(contract, matches)
  setInterval(() => tick(contract, matches).catch(console.error), POLL_INTERVAL_MS)
}

main().catch(err => { console.error(err); process.exit(1) })
