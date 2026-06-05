import { useCallback, useEffect, useState } from 'react'
import { Contract, formatEther, id as ethersId } from 'ethers'
import type { BrowserProvider } from 'ethers'
import { MATCH_PREDICTIONS_ABI } from '../contracts/abis'
import rosterData from '../data/officialRoster.json'

const CONTRACT_ADDRESS = (import.meta.env.VITE_MATCH_PREDICTIONS_ADDRESS as string | undefined)?.trim()
const SCAN_BLOCKS = 100_000 // ~2 days on Base
const CHUNK = 9_000

export type MyBet = {
  matchId: string
  matchLabel: string   // e.g. "Brazil vs Argentina"
  home: string
  away: string
  outcome: 'home' | 'draw' | 'away'
  amount: string
  settled: boolean
  won: boolean | null
  claimable: boolean
  claimed: boolean
}

function outcomeLabel(n: number): 'home' | 'draw' | 'away' {
  return (['home', 'draw', 'away'] as const)[n] ?? 'home'
}

// Build match list once — mirrors frontend generateTournamentMatches
function buildMatchMap(): Map<string, { home: string; away: string; id: string }> {
  const map = new Map<string, { home: string; away: string; id: string }>()
  const roster = rosterData as { teams: Array<{ name: string; group: string }> }

  const byGroup: Record<string, string[]> = {}
  for (const t of roster.teams) {
    if (!byGroup[t.group]) byGroup[t.group] = []
    byGroup[t.group].push(t.name)
  }

  const matches: { id: string; home: string; away: string }[] = []
  for (const [, teams] of Object.entries(byGroup).sort(([a], [b]) => a.localeCompare(b))) {
    for (const [hi, ai] of [[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]] as [number,number][]) {
      matches.push({ id: `FLWC-${String(matches.length+1).padStart(3,'0')}`, home: teams[hi] ?? '?', away: teams[ai] ?? '?' })
    }
  }
  // R32 + knockouts (placeholders)
  for (let i = matches.length; i < 104; i++) {
    matches.push({ id: `FLWC-${String(i+1).padStart(3,'0')}`, home: 'TBD', away: 'TBD' })
  }

  for (let cycle = 0; cycle <= 5; cycle++) {
    for (const m of matches) {
      const bid = ethersId(`FLWC_MATCH:${m.id}:${cycle}`).toLowerCase()
      map.set(bid, m)
    }
  }
  return map
}

const MATCH_MAP = buildMatchMap()

function findMatch(matchId: string): { home: string; away: string; id: string } | null {
  return MATCH_MAP.get(matchId.toLowerCase()) ?? null
}

function findMatchLabel(matchId: string): string {
  const m = findMatch(matchId)
  if (m) return `${m.home} vs ${m.away}`
  for (let cycle = 0; cycle <= 3; cycle++) {
    for (let i = 1; i <= 104; i++) {
      const id = `FLWC-${String(i).padStart(3, '0')}`
      if (ethersId(`FLWC_MATCH:${id}:${cycle}`).toLowerCase() === matchId.toLowerCase()) {
        return `${id} · cycle ${cycle}`
      }
    }
  }
  return matchId.slice(0, 10) + '…'
}

export function useMyBets(provider: BrowserProvider | null, account: string | null) {
  const [bets, setBets] = useState<MyBet[]>([])
  const [loading, setLoading] = useState(false)

  const scan = useCallback(async () => {
    if (!provider || !account || !CONTRACT_ADDRESS) return
    setLoading(true)

    try {
      const c = new Contract(CONTRACT_ADDRESS, [
        ...MATCH_PREDICTIONS_ABI,
        'event BetPlaced(bytes32 indexed matchId, address indexed user, uint8 outcome, uint256 amount)',
      ], provider)

      const latest = await provider.getBlockNumber()
      const from = Math.max(0, latest - SCAN_BLOCKS)

      const allEvents: any[] = []
      for (let start = from; start < latest; start += CHUNK) {
        const end = Math.min(start + CHUNK - 1, latest)
        try {
          const evs = await c.queryFilter(c.filters.BetPlaced(null, account), start, end)
          allEvents.push(...evs)
        } catch { /* rate limit — skip chunk */ }
      }

      // Dedupe by matchId+outcome, pick latest
      const seen = new Map<string, any>()
      for (const e of allEvents) {
        const key = `${e.args.matchId}-${e.args.outcome}`
        seen.set(key, e)
      }

      const results: MyBet[] = []
      for (const e of seen.values()) {
        const { matchId, outcome, amount } = e.args
        try {
          const pool = await c.getPool(matchId)
          const settled: boolean = pool[3]
          const winner = Number(pool[4])
          const outcomeNum = Number(outcome)
          const myStake = await c.myStakes(matchId, account)
          const myOutcomeStake = [myStake[0], myStake[1], myStake[2]][outcomeNum]

          const won = settled ? outcomeNum === winner : null
          const claimable = settled && won === true && myOutcomeStake > 0n
          const claimed = settled && won === true && myOutcomeStake === 0n

          // Skip already claimed or lost
          if (settled && !claimable && claimed === false && won === false) {
            // lost bet — still show it greyed out? only if recent
          }

          const matchInfo = findMatch(matchId)

          results.push({
            matchId,
            matchLabel: matchInfo ? `${matchInfo.home} vs ${matchInfo.away}` : findMatchLabel(matchId),
            home: matchInfo?.home ?? '?',
            away: matchInfo?.away ?? '?',
            outcome: outcomeLabel(outcomeNum),
            amount: formatEther(amount),
            settled,
            won,
            claimable,
            claimed: settled && won === true && myOutcomeStake === 0n,
          })
        } catch { /* pool read failed */ }
      }

      // Sort: claimable first, then unsettled, then rest
      results.sort((a, b) => {
        if (a.claimable && !b.claimable) return -1
        if (!a.claimable && b.claimable) return 1
        if (!a.settled && b.settled) return -1
        if (a.settled && !b.settled) return 1
        return 0
      })

      setBets(results)
    } finally {
      setLoading(false)
    }
  }, [provider, account])

  useEffect(() => {
    if (account && provider) scan()
  }, [account, provider, scan])

  return { bets, loading, refresh: scan }
}
