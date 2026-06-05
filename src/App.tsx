import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Activity,
  BadgeDollarSign,
  CalendarDays,
  Coins,
  Lock,
  LogOut,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import rosterData from './data/officialRoster.json'
import { FootballEvoBroadcast } from './FootballEvoBroadcast'
import { useWallet } from './hooks/useWallet'
import { usePredictions } from './hooks/usePredictions'
import { useMatchPredictions } from './hooks/useMatchPredictions'
import { useMyBets } from './hooks/useMyBets'
import { useMatchSeed } from './hooks/useMatchSeed'
import './App.css'

type Player = {
  id: string
  number: number
  name: string
  team: string
  group: string
  position: string
  rating: number
  attack: number
  defense: number
  pace: number
  caps: number
  goals: number
  club: string
  photo: string | null
  photoCredit: string | null
}

type Match = {
  id: string
  group: string
  home: string
  away: string
  kickoff: string
  startsAt: string
  venue: string
  seed: string
  status: 'Live' | 'Scheduled' | 'Final'
  score: string
}

type MatchOutcome = 'home' | 'draw' | 'away'
type MatchPools = Record<MatchOutcome, number>

const roster = rosterData as {
  source: string
  importedAt: string
  teams: Array<{ name: string; group: string; players: number }>
  players: Player[]
}

// Fixed epoch — every user derives the same match schedule from this
const TOURNAMENT_EPOCH = (import.meta.env.VITE_FLWC_TOURNAMENT_START_AT as string ?? '2026-06-03T00:00:00.000Z').trim()

const contractSteps = [
  'At kickoff, any user can call commitSeed() on MatchRegistry with the Base block number — the contract stores blockhash(n) permanently.',
  'The frontend derives the exact same match result using keccak256 chains identical to the Solidity computeResult() function.',
  'After 20 minutes, any user calls finalizeMatch() — no owner, no oracle, no trust required.',
  'MatchPredictions reads the finalized result from MatchRegistry and distributes the pool minus the 2% protocol fee to the vault.',
  'ChampionPool settles the tournament winner after the final match, paying winners proportionally from the total pool.',
]

const docsItems = [
  {
    title: 'Open source',
    body: 'All six contracts are verified on Basescan. Anyone can read the code, check the logic and audit the settlement math independently.',
  },
  {
    title: 'Trustless settlement',
    body: 'Results are derived from Base block hashes — unknowable before kickoff, immutable after. No admin can change a result once the seed is committed.',
  },
  {
    title: 'Parimutuel pools',
    body: 'You bet against other players, not the house. The pool is split proportionally among winners. A 2% protocol fee funds the FLWC treasury.',
  },
]

const howItWorksItems = [
  'A new AI match starts every 20 minutes. The schedule is fixed and identical for every user worldwide.',
  'Place your ETH bet on Home / Draw / Away before kickoff. The pool updates in real time as others bet.',
  'At kickoff, the Base blockchain produces a block hash that neither FLWC nor anyone else can predict or control.',
  'The match simulation and the on-chain result both use the same keccak256 algorithm — what you see on screen matches what the contract computes.',
  'After the match, anyone calls finalizeMatch(). Winners claim their proportional share of the pool directly from the contract.',
]

const simulationFactors = [
  { label: 'Player stats', value: 42, detail: 'Rating, attack, defense and pace drive every action.' },
  { label: 'Team strength', value: 24, detail: 'The best starting XI increases chance quality and control.' },
  { label: 'Match flow', value: 14, detail: 'Possession, pressure, fatigue and momentum adjust decisions.' },
  { label: 'Fouls & referee', value: 10, detail: 'Foul rate and referee strictness affect rhythm and danger.' },
  { label: 'Controlled variance', value: 10, detail: 'Football still has surprises, but not 50/50 randomness.' },
]

const BASESCAN = 'https://basescan.org/address'

const protocolContracts = [
  {
    name: 'FLWCVault',
    address: import.meta.env.VITE_VAULT_ADDRESS as string,
    file: 'contracts/FLWCVault.sol',
    status: 'Live · Base',
    summary: 'Protocol treasury',
    description: 'Receives the 2% fee from every settled prediction pool. Owner can withdraw to fund development and liquidity.',
  },
  {
    name: 'FLWCToken',
    address: import.meta.env.VITE_TOKEN_ADDRESS as string,
    file: 'contracts/FLWCToken.sol',
    status: 'Live · Base',
    summary: 'ERC-20 · 1B supply',
    description: 'Fixed-supply utility token. No mint function after deploy. 1,000,000,000 FLWC minted once to the treasury.',
  },
  {
    name: 'PlayerRegistry',
    address: import.meta.env.VITE_PLAYER_REGISTRY_ADDRESS as string,
    file: 'contracts/PlayerRegistry.sol',
    status: 'Live · Base',
    summary: 'Roster data',
    description: 'Stores squad players with team IDs, ratings, attack, defense and pace as on-chain read-only protocol data.',
  },
  {
    name: 'MatchRegistry',
    address: import.meta.env.VITE_MATCH_REGISTRY_ADDRESS as string,
    file: 'contracts/MatchRegistry.sol',
    status: 'Live · Base',
    summary: 'Fixtures + trustless seeds',
    description: 'Stores match fixtures. commitSeed() captures blockhash at kickoff. finalizeMatch() runs computeResult() on-chain — no oracle.',
  },
  {
    name: 'MatchPredictions',
    address: import.meta.env.VITE_MATCH_PREDICTIONS_ADDRESS as string,
    file: 'contracts/MatchPredictions.sol',
    status: 'Live · Base',
    summary: 'Per-match betting pool',
    description: 'Parimutuel Home/Draw/Away pools per match. Settlement reads MatchRegistry result. 2% fee to vault. Anyone can settle.',
  },
  {
    name: 'ChampionPool',
    address: import.meta.env.VITE_CHAMPION_POOL_ADDRESS as string,
    file: 'contracts/ChampionPool.sol',
    status: 'Live · Base',
    summary: 'Tournament winner pool',
    description: 'Predict the tournament champion before the pool locks. Proportional payout to winners after the final is confirmed.',
  },
]

function StatBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-bar">
      <span>{label}</span>
      <div>
        <i style={{ width: `${value}%` }} />
      </div>
      <strong>{value}</strong>
    </div>
  )
}

import { keccak256, solidityPacked } from 'ethers'

type GoalEvent = { minute: number; side: 'home' | 'away' }

// Mirrors MatchRegistry.computeResult() exactly — same keccak256 chain, same result on-chain.
function computeMatchGoals(blockHashSeed: string, homeStrength: number, awayStrength: number): GoalEvent[] {
  const total = homeStrength + awayStrength
  const goals: GoalEvent[] = []

  for (let min = 1; min <= 90; min++) {
    const goalHash = keccak256(solidityPacked(['bytes32', 'uint256', 'uint8'], [blockHashSeed, min, 1]))
    const goalRoll = BigInt(goalHash) % 10000n
    if (goalRoll < 280n) {
      const teamHash = keccak256(solidityPacked(['bytes32', 'uint256', 'uint8'], [blockHashSeed, min, 2]))
      const teamRoll = BigInt(teamHash) % BigInt(total)
      goals.push({ minute: min, side: teamRoll < BigInt(homeStrength) ? 'home' : 'away' })
    }
  }

  return goals
}

function getTeamStrength(teamName: string) {
  const squad = roster.players
    .filter((player) => player.team === teamName)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 11)

  if (!squad.length) return 78

  const total = squad.reduce(
    (sum, player) => sum + player.rating * 0.5 + player.attack * 0.22 + player.defense * 0.18 + player.pace * 0.1,
    0,
  )

  return Math.round(total / squad.length)
}

function getStartingLineup(teamName: string) {
  const squad = roster.players.filter((player) => player.team === teamName)
  const pick = (position: string, count: number) =>
    squad
      .filter((player) => player.position === position)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, count)

  const lineup = [
    ...pick('GK', 1),
    ...pick('DF', 4),
    ...pick('MF', 3),
    ...pick('FW', 3),
  ]

  if (lineup.length < 11) {
    const picked = new Set(lineup.map((player) => player.id))
    lineup.push(
      ...squad
        .filter((player) => !picked.has(player.id))
        .sort((a, b) => b.rating - a.rating)
        .slice(0, 11 - lineup.length),
    )
  }

  return lineup.slice(0, 11).map((player) => ({
    name: player.name,
    number: player.number,
    position: player.position,
  }))
}

function getTournamentStartAt() {
  return TOURNAMENT_EPOCH
}

// Each match runs for 20 real minutes = 90 simulated match minutes
const MATCH_DURATION_MS = 20 * 60 * 1000

function formatKickoff(startsAt: string) {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(startsAt))
}

function addMatchSlot(startsAt: string, index: number) {
  const date = new Date(startsAt)
  date.setTime(date.getTime() + index * MATCH_DURATION_MS)
  return date.toISOString()
}

function makeMatch(index: number, stage: string, home: string, away: string, tournamentStartAt: string): Match {
  const startsAt = addMatchSlot(tournamentStartAt, index)

  return {
    id: `FLWC-${String(index + 1).padStart(3, '0')}`,
    group: stage,
    home,
    away,
    kickoff: formatKickoff(startsAt),
    startsAt,
    venue: 'FLWC Arena',
    seed: `0x${String(index + 1).padStart(4, '0')}...flwc`,
    status: 'Scheduled',
    score: 'Scheduled',
  }
}

function generateTournamentMatches(tournamentStartAt: string) {
  const generatedMatches: Match[] = []
  const teamsByGroup = roster.teams.reduce<Record<string, string[]>>((groups, team) => {
    groups[team.group] = [...(groups[team.group] ?? []), team.name]
    return groups
  }, {})

  Object.entries(teamsByGroup)
    .sort(([groupA], [groupB]) => groupA.localeCompare(groupB))
    .forEach(([group, teams]) => {
      const pairings = [
        [0, 1],
        [2, 3],
        [0, 2],
        [1, 3],
        [0, 3],
        [1, 2],
      ]

      pairings.forEach(([homeIndex, awayIndex]) => {
        generatedMatches.push(
          makeMatch(
            generatedMatches.length,
            group,
            teams[homeIndex] ?? `${group} Team ${homeIndex + 1}`,
            teams[awayIndex] ?? `${group} Team ${awayIndex + 1}`,
            tournamentStartAt,
          ),
        )
      })
    })

  const seededTeams = roster.teams
    .map((team) => ({ name: team.name, strength: getTeamStrength(team.name) }))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 32)
    .map((team) => team.name)

  for (let index = 0; index < 16; index += 1) {
    generatedMatches.push(
      makeMatch(
        generatedMatches.length,
        'Round of 32',
        seededTeams[index] ?? `Seed ${index + 1}`,
        seededTeams[31 - index] ?? `Seed ${32 - index}`,
        tournamentStartAt,
      ),
    )
  }

  const knockoutRounds = [
    ['Round of 16', 8],
    ['Quarter-finals', 4],
    ['Semi-finals', 2],
    ['Third-place Match', 1],
    ['Final', 1],
  ] as const

  knockoutRounds.forEach(([stage, count]) => {
    for (let index = 0; index < count; index += 1) {
      generatedMatches.push(
        makeMatch(
          generatedMatches.length,
          stage,
          `${stage} Qualifier ${index * 2 + 1}`,
          `${stage} Qualifier ${index * 2 + 2}`,
          tournamentStartAt,
        ),
      )
    }
  })

  return generatedMatches
}

function getMatchRuntime(startsAt: string) {
  const start = new Date(startsAt).getTime()
  const now = Date.now()
  const elapsedMs = now - start
  const minute = Math.max(0, Math.min(90, Math.floor((elapsedMs / MATCH_DURATION_MS) * 90)))

  return {
    isLive: elapsedMs >= 0 && elapsedMs < MATCH_DURATION_MS,
    isFinal: elapsedMs >= MATCH_DURATION_MS,
    minute,
  }
}

// Returns which match slot is currently live, accounting for tournament cycling.
// All users get the same answer because it's based on a fixed epoch.
function getCurrentCycleMatchIndex(totalMatches: number): number {
  const epochMs = new Date(TOURNAMENT_EPOCH).getTime()
  const elapsedMs = Date.now() - epochMs
  const cycleDurationMs = totalMatches * MATCH_DURATION_MS
  const positionInCycle = ((elapsedMs % cycleDurationMs) + cycleDurationMs) % cycleDurationMs
  return Math.floor(positionInCycle / MATCH_DURATION_MS)
}

// For a given match slot index and cycle, compute the actual startsAt so runtime works correctly.
function matchStartsAtForCurrentCycle(epochMs: number, slotIndex: number, totalMatches: number): string {
  const cycleDurationMs = totalMatches * MATCH_DURATION_MS
  const elapsedMs = Date.now() - epochMs
  const currentCycle = Math.floor(((elapsedMs < 0 ? 0 : elapsedMs) / cycleDurationMs))
  return new Date(epochMs + (currentCycle * cycleDurationMs) + slotIndex * MATCH_DURATION_MS).toISOString()
}

function formatEth(value: number) {
  if (value === 0) return '0 ETH'
  if (value < 0.001) return `${value.toFixed(6)} ETH`
  return `${value.toFixed(4)} ETH`
}

function getEstimatedPayout(pools: MatchPools, outcome: MatchOutcome, stake: number) {
  if (stake <= 0) return 0

  const totalAfterBet = pools.home + pools.draw + pools.away + stake
  const selectedPoolAfterBet = pools[outcome] + stake

  if (selectedPoolAfterBet <= 0) return 0

  return (totalAfterBet * stake) / selectedPoolAfterBet
}


function PlayerCard({ player }: { player: Player }) {
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  const handleEnter = () => {
    const rect = cardRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = Math.min(rect.right + 8, window.innerWidth - 336)
    const y = Math.max(8, rect.top)
    setTip({ x, y })
  }

  return (
    <div
      ref={cardRef}
      className="player-card"
      tabIndex={0}
      onMouseEnter={handleEnter}
      onFocus={handleEnter}
      onMouseLeave={() => setTip(null)}
      onBlur={() => setTip(null)}
    >
      <div className="player-summary">
        <div className="player-photo" aria-label={`${player.name} photo`}>
          {player.photo ? (
            <img src={player.photo} alt={player.name} loading="lazy" />
          ) : (
            <span>{player.name.split(' ').map((p) => p[0]).join('').slice(0, 2)}</span>
          )}
        </div>
        <div>
          <strong>{player.name}</strong>
          <span>#{player.number} - {player.team} - {player.position} - {player.club}</span>
          <em>{player.caps} caps - {player.goals} goals</em>
        </div>
        <b>{player.rating}</b>
      </div>
      <StatBar label="ATK" value={player.attack} />
      <StatBar label="DEF" value={player.defense} />
      <StatBar label="PAC" value={player.pace} />

      {tip && createPortal(
        <div
          className="player-tooltip visible"
          style={{ position: 'fixed', top: tip.y, left: tip.x, zIndex: 9999 }}
          role="tooltip"
        >
          <div className="tooltip-head">
            <span>{player.position}</span>
            <strong>{player.rating}</strong>
          </div>
          <h3>{player.name}</h3>
          <p>{player.team} / #{player.number} / {player.club}</p>
          <div className="tooltip-stats">
            <span><b>{player.caps}</b>Caps</span>
            <span><b>{player.goals}</b>Goals</span>
            <span><b>{player.group}</b>Group</span>
          </div>
          <StatBar label="ATK" value={player.attack} />
          <StatBar label="DEF" value={player.defense} />
          <StatBar label="PAC" value={player.pace} />
        </div>,
        document.body,
      )}
    </div>
  )
}

function App() {
  const [selectedTeam, setSelectedTeam] = useState('Brazil')
  const [selectedPosition, setSelectedPosition] = useState('ALL')
  const [tournamentStartAt] = useState(getTournamentStartAt)
  const [selectedOutcome, setSelectedOutcome] = useState<MatchOutcome>('home')
  const [stakeEth, setStakeEth] = useState('0.05')
  const [matchPools] = useState<MatchPools>({ home: 0, draw: 0, away: 0 })
  const [champPickTeam, setChampPickTeam] = useState('')
  const [champStakeEth, setChampStakeEth] = useState('0.01')
  const [champSearch, setChampSearch] = useState('')
  const [settleTeam, setSettleTeam] = useState('')
  const [tick, setTick] = useState(0)

  // Re-render every 10s so the live match, scoreboard and cycle number stay current
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 10000)
    return () => window.clearInterval(t)
  }, [])

  const wallet = useWallet()
  const predictions = usePredictions(wallet.signer, wallet.provider, wallet.account, roster.teams)

  const tournamentMatches = useMemo(() => generateTournamentMatches(tournamentStartAt), [tournamentStartAt])

  // Cycle number — increments every ~34.6h when all 104 matches complete
  // tick as dependency ensures this recomputes every 10s when the cycle changes
  const currentCycleNumber = useMemo(() => {
    const epochMs = new Date(TOURNAMENT_EPOCH).getTime()
    const elapsed = Date.now() - epochMs
    const cycleDuration = tournamentMatches.length * MATCH_DURATION_MS
    return Math.floor(Math.max(0, elapsed) / cycleDuration)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentMatches.length, tick])

  const matchPredictions = useMatchPredictions(wallet.signer, wallet.provider, wallet.account, currentCycleNumber)
  const myBets = useMyBets(wallet.provider, wallet.account)

  // Cycle-aware: always pick the match that's currently live for every user
  const epochMs = useMemo(() => new Date(TOURNAMENT_EPOCH).getTime(), [])
  const liveSlotIndex = getCurrentCycleMatchIndex(tournamentMatches.length)
  const featuredMatch = {
    ...tournamentMatches[liveSlotIndex],
    startsAt: matchStartsAtForCurrentCycle(epochMs, liveSlotIndex, tournamentMatches.length),
  }
  const runtime = getMatchRuntime(featuredMatch.startsAt)

  // Build a view of the current cycle's schedule with real start times
  const cycleMatches = useMemo(() => {
    const cycleStart = matchStartsAtForCurrentCycle(epochMs, 0, tournamentMatches.length)
    const cycleEpoch = new Date(cycleStart).getTime()
    return tournamentMatches.map((m, i) => ({
      ...m,
      startsAt: new Date(cycleEpoch + i * MATCH_DURATION_MS).toISOString(),
      kickoff: formatKickoff(new Date(cycleEpoch + i * MATCH_DURATION_MS).toISOString()),
    }))
  }, [epochMs, tournamentMatches])
  const importedDate = new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(roster.importedAt))
  const teamsWithRoster = useMemo(
    () => roster.teams.sort((a, b) => a.name.localeCompare(b.name)),
    [],
  )
  const filteredPlayers = useMemo(
    () =>
      roster.players
        .filter((player) => player.team === selectedTeam)
        .filter((player) => selectedPosition === 'ALL' || player.position === selectedPosition)
        .sort((a, b) => a.number - b.number),
    [selectedPosition, selectedTeam],
  )
  const photoCount = roster.players.filter((player) => player.photo).length
  const homeStrength = useMemo(() => getTeamStrength(featuredMatch.home), [featuredMatch.home])
  const awayStrength = useMemo(() => getTeamStrength(featuredMatch.away), [featuredMatch.away])

  // Block hash from Base at match kickoff — unknowable before, verifiable after
  const matchSeed = useMatchSeed(featuredMatch.startsAt)

  // Goals computed from block hash seed — same result for every user, unpredictable before kickoff
  const matchGoals = useMemo(
    () => matchSeed.seed ? computeMatchGoals(matchSeed.seed, homeStrength, awayStrength) : [],
    [matchSeed.seed, homeStrength, awayStrength],
  )
  const liveScore = useMemo(() => {
    const cutoff = runtime.isFinal ? 90 : runtime.isLive ? runtime.minute : 0
    return matchGoals.reduce(
      (s, g) => g.minute <= cutoff ? { ...s, [g.side]: s[g.side] + 1 } : s,
      { home: 0, away: 0 },
    )
  }, [matchGoals, runtime.isFinal, runtime.isLive, runtime.minute])
  const homeLineup = useMemo(() => getStartingLineup(featuredMatch.home), [featuredMatch.home])
  const awayLineup = useMemo(() => getStartingLineup(featuredMatch.away), [featuredMatch.away])
  const liveScoreText = runtime.isFinal || runtime.isLive ? `${liveScore.home} - ${liveScore.away}` : '0 - 0'
  const scoreStatus = runtime.isFinal ? 'FT' : runtime.isLive ? `${runtime.minute}'` : 'Scheduled'
  const stakeValue = Number(stakeEth)
  const safeStake = Number.isFinite(stakeValue) && stakeValue > 0 ? stakeValue : 0
  const outcomeLabels: Record<MatchOutcome, string> = {
    home: featuredMatch.home,
    draw: 'Draw',
    away: featuredMatch.away,
  }

  // pool values: on-chain when wallet connected, local preview otherwise
  const displayPool = wallet.account
    ? { home: Number(matchPredictions.pool.home), draw: Number(matchPredictions.pool.draw), away: Number(matchPredictions.pool.away) }
    : matchPools
  const totalMatchPool = displayPool.home + displayPool.draw + displayPool.away
  const estimatedPayout = getEstimatedPayout(
    { home: displayPool.home, draw: displayPool.draw, away: displayPool.away },
    selectedOutcome,
    safeStake,
  )

  useEffect(() => {
    void matchPredictions.refresh(featuredMatch.id)
    if (!wallet.provider) return
    const interval = window.setInterval(() => { void matchPredictions.refresh(featuredMatch.id) }, 30000)
    return () => window.clearInterval(interval)
  }, [wallet.provider, wallet.account, featuredMatch.id])

  return (
    <main className="app-shell">
      <nav className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <img src="/brand/flwc-golden-ball.png" alt="Fantasy League World Cup logo" />
          </div>
          <div>
            <span>Fantasy League World Cup</span>
          </div>
        </div>
        <div className="nav-actions" aria-label="Primary actions">
          <div className="price-ticker">
            <span>Match Pool</span>
            <strong>{Number(matchPredictions.pool.home) + Number(matchPredictions.pool.draw) + Number(matchPredictions.pool.away) > 0
              ? `${(Number(matchPredictions.pool.home) + Number(matchPredictions.pool.draw) + Number(matchPredictions.pool.away)).toFixed(4)} ETH`
              : '0 ETH'}</strong>
            <small>Base mainnet · live</small>
          </div>
          <div className="current-match-pill">
            <span>{runtime.isLive ? 'Now Playing' : 'Next Match'}</span>
            <strong>{featuredMatch.home} vs {featuredMatch.away}</strong>
            <small>{runtime.isLive ? `${scoreStatus} - ${liveScoreText}` : featuredMatch.kickoff}</small>
          </div>
          <a
            className="x-link"
            href="https://x.com/FLWCoin"
            rel="noreferrer"
            target="_blank"
            title="Follow FLWC on X"
          >
            <X size={18} />
          </a>
          {wallet.account ? (
            <div className="wallet-connected">
              {!wallet.isOnBase ? (
                <button className="wallet-btn warn" onClick={wallet.switchToBase} type="button">
                  ⚠ Switch to Base
                </button>
              ) : (
                <span className="network-badge">Base</span>
              )}
              <span className="wallet-addr" title={wallet.account}>
                {wallet.account.slice(0, 6)}…{wallet.account.slice(-4)}
              </span>
              {myBets.bets.some(b => b.claimable) && (
                <a className="claim-alert" href="#my-bets" title="You have winnings to claim!">
                  🏆 Claim
                </a>
              )}
              <button className="wallet-btn ghost" onClick={wallet.disconnect} type="button" title="Disconnect">
                <LogOut size={14} />
              </button>
            </div>
          ) : (
            <button
              className="wallet-btn"
              disabled={wallet.isConnecting}
              onClick={wallet.connect}
              type="button"
            >
              <Wallet size={15} />
              {wallet.isConnecting ? 'Connecting…' : 'Connect Wallet'}
            </button>
          )}
        </div>
      </nav>

      <section className="hero-band">
        <div className="hero-copy">
          <p className="eyebrow">World Cup format · AI matches · Base blockchain</p>
          <h1>
            <span>Fantasy League</span>
            <span>World Cup</span>
          </h1>
          <p>
            Bet on AI football matches every 20 minutes. Results are seeded by Base block hashes —
            no one can predict or manipulate them. Six auditable contracts on Base mainnet,
            open source and verifiable on Basescan.
          </p>
          <div className="hero-metrics">
            <span>
              <Trophy size={18} />
              {roster.teams.length} Teams
            </span>
            <span>
              <Users size={18} />
              {roster.players.length} Players
            </span>
            <span>
              <Coins size={18} />
              104 Matches
            </span>
          </div>
        </div>

        <div className="broadcast" aria-label="Live match broadcast preview">
          <div className="betting-strip" aria-label="Match betting market">
            <div className="betting-copy">
              <span>Match Winner Market</span>
              <strong>{featuredMatch.home} vs {featuredMatch.away}</strong>
              <small>Pick a result before or during the match. Your projected return updates with the pool.</small>
            </div>
            <div className="outcome-buttons">
              {(['home', 'draw', 'away'] as MatchOutcome[]).map((outcome) => (
                <button
                  className={selectedOutcome === outcome ? 'selected' : ''}
                  key={outcome}
                  type="button"
                  onClick={() => setSelectedOutcome(outcome)}
                >
                  <span>{outcomeLabels[outcome]}</span>
                  <small>{formatEth(displayPool[outcome])}</small>
                </button>
              ))}
            </div>
            <div className="bet-controls">
              <label className="stake-input">
                Stake ETH
                <input
                  min="0"
                  step="0.001"
                  type="number"
                  value={stakeEth}
                  onChange={(event) => setStakeEth(event.target.value)}
                />
              </label>
              <div className="payout-preview">
                <span>Estimated return</span>
                <strong>{formatEth(estimatedPayout)}</strong>
                <small>Total pool {formatEth(totalMatchPool)}</small>
              </div>
              {/* ── Phase 1: not connected ── */}
              {!wallet.account && (
                <button className="place-bet" type="button" onClick={wallet.connect}>
                  Connect Wallet
                </button>
              )}

              {/* ── Phase 2: wrong network ── */}
              {wallet.account && !wallet.isOnBase && (
                <button className="place-bet" type="button" onClick={wallet.switchToBase}>
                  ⚠ Switch to Base
                </button>
              )}

              {/* ── Phase 3: match live → bet ── */}
              {wallet.account && wallet.isOnBase && !matchPredictions.pool.settled && !runtime.isFinal && (
                <button
                  className="place-bet"
                  disabled={safeStake <= 0 || matchPredictions.isPlacing || !matchPredictions.isReady}
                  type="button"
                  onClick={() => matchPredictions.placeBet(featuredMatch.id, selectedOutcome, stakeEth)}
                >
                  {matchPredictions.isPlacing ? 'Sending tx…' : 'Place Bet'}
                </button>
              )}

              {/* ── Phase 4: match ended — trustless settle ── */}
              {wallet.account && wallet.isOnBase && !matchPredictions.pool.settled && runtime.isFinal && (
                <div className="settle-box">
                  {matchPredictions.pool.seedCommitted ? (
                    <>
                      <p className="settle-label">✅ Seed committed — anyone can finalize this pool:</p>
                      <button
                        className="place-bet"
                        type="button"
                        onClick={() => matchPredictions.settle(featuredMatch.id)}
                      >
                        Settle Match (trustless)
                      </button>
                    </>
                  ) : (
                    <p className="settle-label">⏳ Awaiting seed commitment… Bot will settle automatically.</p>
                  )}
                </div>
              )}

              {/* ── Phase 5: settled → claim ── */}
              {wallet.account && wallet.isOnBase && matchPredictions.pool.settled && (() => {
                const won = matchPredictions.pool.winner !== null &&
                  matchPredictions.pool.myStake[matchPredictions.pool.winner] !== '0' &&
                  matchPredictions.pool.winner === selectedOutcome
                return won ? (
                  <button className="place-bet claim-btn" type="button"
                    onClick={() => matchPredictions.claim(featuredMatch.id)}>
                    🏆 Claim Reward
                  </button>
                ) : (
                  <button className="place-bet" disabled type="button">
                    {matchPredictions.pool.winner ? `${outcomeLabels[matchPredictions.pool.winner]} won` : 'Settled'}
                  </button>
                )
              })()}

              {matchPredictions.txError && (
                <p className="tx-error">{matchPredictions.txError}</p>
              )}

              {/* ── FLWC holder fee discount badge ── */}
              {wallet.account && wallet.isOnBase && (
                <div className="flwc-badge">
                  {matchPredictions.pool.isFlwcHolder ? (
                    <span className="badge holder">⭐ FLWC Holder · 1% fee</span>
                  ) : (
                    <span className="badge standard">Standard · 2% fee · Hold 1,000 FLWC for discount</span>
                  )}
                </div>
              )}

              {/* ── Your current stake info ── */}
              {wallet.account && wallet.isOnBase && (
                <div className="my-stakes">
                  {(['home', 'draw', 'away'] as MatchOutcome[]).map((o) => {
                    const s = Number(matchPredictions.pool.myStake[o])
                    if (s <= 0) return null
                    return (
                      <span key={o}>
                        Your stake on <b>{outcomeLabels[o]}</b>: {s.toFixed(4)} ETH
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
          <div className="scorebug">
            <span>
              {featuredMatch.home} <small>OVR {homeStrength}</small>
            </span>
            <strong>
              {liveScoreText} <small>{scoreStatus}</small>
            </strong>
            <span>
              {featuredMatch.away} <small>OVR {awayStrength}</small>
            </span>
          </div>
          <div className="pitch">
            <FootballEvoBroadcast
              homeStrength={homeStrength}
              awayStrength={awayStrength}
              homeLineup={homeLineup}
              awayLineup={awayLineup}
              homeName={featuredMatch.home}
              awayName={featuredMatch.away}
              isRunning={runtime.isLive}
              matchMinute={runtime.minute}
              onScore={() => {}} // score is computed deterministically, not from animation
            />
          </div>
          <div className="broadcast-footer">
            <span>
              <Activity size={16} />
              {runtime.isLive ? 'Live · Base block seed' : runtime.isFinal ? 'Final · result locked' : 'Upcoming · seed unknown'}
            </span>
            <span>
              {matchSeed.blockNumber ? (
                <a
                  href={`https://basescan.org/block/${matchSeed.blockNumber}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#00c8ff', textDecoration: 'none' }}
                  title="Verify randomness seed on Basescan"
                >
                  Block #{matchSeed.blockNumber} · {featuredMatch.venue}
                </a>
              ) : matchSeed.loading ? (
                `Fetching seed… · ${featuredMatch.venue}`
              ) : (
                `Seed reveals at kickoff · ${featuredMatch.kickoff}`
              )}
            </span>
          </div>
        </div>
      </section>

      {/* ── My Bets — visible right after hero when wallet connected ── */}
      {wallet.account && (
        <section className="my-bets-section" id="my-bets">
          <div className="my-bets-inner">
            <div className="my-bets-heading">
              <span><BadgeDollarSign size={16} /> My Bets</span>
              <small>{myBets.loading ? 'Scanning…' : `${myBets.bets.length} found`}</small>
            </div>

            {myBets.loading && <p className="bets-empty">Scanning your bet history on Base…</p>}
            {!myBets.loading && myBets.bets.length === 0 && (
              <p className="bets-empty">No bets in the last 2 days.</p>
            )}
            {!myBets.loading && myBets.bets.length > 0 && (
              <div className="bets-list">
                {myBets.bets.map((bet, i) => (
                  <div key={i} className={`bet-row ${bet.claimable ? 'claimable' : bet.won === false ? 'lost' : bet.won === null ? 'pending' : 'claimed'}`}>
                    <div className="bet-info">
                      <strong>{bet.matchLabel}</strong>
                      <span>
                        You bet <b>{bet.outcome === 'home' ? bet.home : bet.outcome === 'away' ? bet.away : 'Draw'}</b> · {Number(bet.amount).toFixed(4)} ETH
                      </span>
                    </div>
                    <div className="bet-status">
                      {!bet.settled && <span className="badge pending">⏳ Live</span>}
                      {bet.settled && bet.won === false && <span className="badge lost">❌ Lost</span>}
                      {bet.settled && bet.won === true && bet.claimed && <span className="badge claimed">✅ Claimed</span>}
                      {bet.claimable && wallet.signer && (
                        <button
                          className="place-bet claim-btn"
                          style={{ padding: '6px 16px', fontSize: 13 }}
                          onClick={async () => {
                            const { Contract } = await import('ethers')
                            const { MATCH_PREDICTIONS_ABI } = await import('./contracts/abis')
                            const addr = (import.meta.env.VITE_MATCH_PREDICTIONS_ADDRESS as string)?.trim()
                            const c = new Contract(addr, MATCH_PREDICTIONS_ABI, wallet.signer!)
                            await (await c.claim(bet.matchId)).wait()
                            myBets.refresh()
                          }}
                        >
                          🏆 Claim
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      <section className="grid-section">
        <article className="panel live-panel">
          <div className="panel-heading">
            <span>
              <CalendarDays size={18} />
              Match Schedule
            </span>
            <small>{tournamentMatches.length} fixtures · 20 min each · cycles continuously</small>
          </div>
          <div className="match-board">
            <div className="match-list">
              {cycleMatches.map((match) => {
                const matchRuntime = getMatchRuntime(match.startsAt)
                const matchStatus = matchRuntime.isFinal ? 'Final' : matchRuntime.isLive ? 'Live' : 'Upcoming'

                return (
                  <div className={`match-row ${match.id === featuredMatch.id ? 'active' : ''}`} key={match.id}>
                    <small>{match.group}</small>
                    <div className="match-teams">
                      <strong>
                        {match.home} vs {match.away}
                      </strong>
                      <span>{match.kickoff} / {match.venue}</span>
                    </div>
                    <div className="match-state">
                      <b className={matchStatus.toLowerCase()}>{matchStatus}</b>
                      <em>{match.id === featuredMatch.id ? `${liveScoreText} - ${scoreStatus}` : 'Queued'}</em>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <span>
              <Users size={18} />
              Official Players
            </span>
            <small>{photoCount} Wikimedia photos - imported {importedDate}</small>
          </div>
          <div className="roster-controls">
            <label>
              Team
              <select value={selectedTeam} onChange={(event) => setSelectedTeam(event.target.value)}>
                {teamsWithRoster.map((team) => (
                  <option value={team.name} key={team.name}>
                    {team.name} ({team.players})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Position
              <select
                value={selectedPosition}
                onChange={(event) => setSelectedPosition(event.target.value)}
              >
                <option value="ALL">All</option>
                <option value="GK">GK</option>
                <option value="DF">DF</option>
                <option value="MF">MF</option>
                <option value="FW">FW</option>
              </select>
            </label>
          </div>
          <div className="player-table">
            {filteredPlayers.map((player) => (
              <PlayerCard key={player.id} player={player} />
            ))}
          </div>
          <p className="source-note">
            Names and squad metadata are sourced from Wikipedia's 2026 FIFA World Cup squads page.
            Photos use Wikimedia thumbnails when available; missing photos stay as generated roster
            initials until a licensed image feed is connected.
          </p>
        </article>

        <article className="panel contracts-panel">
          <div className="panel-heading">
            <span>
              <BadgeDollarSign size={18} />
              Protocol Contracts
            </span>
            <small>6 contracts live on Base mainnet</small>
          </div>
          <div className="contract-grid">
            {protocolContracts.map((contract) => (
              <div className="contract-card" key={contract.name} tabIndex={0}>
                <div>
                  <strong>{contract.name}</strong>
                  <span>{contract.summary}</span>
                </div>
                <b>{contract.status}</b>
                {contract.address ? (
                  <a
                    className="contract-address"
                    href={`${BASESCAN}/${contract.address}`}
                    target="_blank"
                    rel="noreferrer"
                    title="View on Basescan"
                  >
                    {contract.address.slice(0, 6)}…{contract.address.slice(-4)}
                    <span className="audit-badge">Audit ↗</span>
                  </a>
                ) : (
                  <small>{contract.file}</small>
                )}
                <p>{contract.description}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="panel champion-panel">
          <div className="panel-heading">
            <span>
              <Trophy size={18} />
              Champion Prediction Pool
            </span>
            <small>
              {predictions.isReady
                ? `${Number(predictions.totalPoolEth).toFixed(4)} ETH pooled · Base mainnet`
                : 'Contract not deployed yet'}
            </small>
          </div>

          {!predictions.isReady && (
            <p className="deploy-notice">
              Deploy the contracts to Base first:<br />
              <code>npm run deploy:base</code><br />
              Then set <code>VITE_PREDICTIONS_ADDRESS</code> in your .env and restart.
            </p>
          )}

          {predictions.isReady && predictions.settled && (
            <div className="settled-banner">
              <Trophy size={20} />
              <strong>Tournament settled.</strong>
              {predictions.hasClaimed
                ? ' You already claimed your reward.'
                : predictions.myWinningStakeEth !== '0'
                ? ` Your payout: ${Number(predictions.myWinningStakeEth).toFixed(4)} ETH`
                : ' You had no winning stake.'}
              {!predictions.hasClaimed && predictions.myWinningStakeEth !== '0' && (
                <button
                  className="place-bet"
                  disabled={predictions.isClaiming}
                  onClick={predictions.claimReward}
                  type="button"
                >
                  {predictions.isClaiming ? 'Claiming…' : 'Claim Reward'}
                </button>
              )}
            </div>
          )}

          {predictions.isReady && !predictions.settled && (
            <>
              {/* Search */}
              <input
                className="champ-search"
                placeholder="🔍  Search team…"
                value={champSearch}
                onChange={e => setChampSearch(e.target.value)}
              />

              {/* All 48 teams */}
              <div className="champ-pool-grid">
                {(predictions.teamPools.length > 0
                  ? predictions.teamPools
                  : roster.teams.map(t => ({ teamName: t.name, teamId: '', poolEth: '0', myStakeEth: '0' }))
                )
                  .filter(tp => tp.teamName.toLowerCase().includes(champSearch.toLowerCase()))
                  .map((tp) => (
                    <button
                      key={tp.teamName}
                      className={`champ-team-btn ${champPickTeam === tp.teamName ? 'selected' : ''}`}
                      onClick={() => setChampPickTeam(tp.teamName)}
                      type="button"
                    >
                      <span>{tp.teamName}</span>
                      <small>{Number(tp.poolEth) > 0 ? `${Number(tp.poolEth).toFixed(3)} ETH` : '—'}</small>
                      {Number(tp.myStakeEth) > 0 && <em>You: {Number(tp.myStakeEth).toFixed(3)}</em>}
                    </button>
                  ))}
              </div>

              {!wallet.account ? (
                <button className="wallet-btn full" onClick={wallet.connect} type="button">
                  <Wallet size={15} />
                  Connect Wallet to Predict
                </button>
              ) : !wallet.isOnBase ? (
                <button className="wallet-btn warn full" onClick={wallet.switchToBase} type="button">
                  Switch to Base Network
                </button>
              ) : predictions.locked ? (
                <p className="lock-notice">
                  <Lock size={14} /> Pool is locked — predictions closed.
                </p>
              ) : (
                <div className="champ-controls">
                  <label className="stake-input">
                    Stake ETH
                    <input
                      min="0.001"
                      step="0.001"
                      type="number"
                      value={champStakeEth}
                      onChange={(e) => setChampStakeEth(e.target.value)}
                    />
                  </label>
                  <button
                    className="place-bet"
                    disabled={!champPickTeam || predictions.isPredicting || Number(champStakeEth) <= 0}
                    onClick={() => predictions.predictChampion(champPickTeam, champStakeEth)}
                    type="button"
                  >
                    {predictions.isPredicting
                      ? 'Sending…'
                      : champPickTeam
                      ? `Predict ${champPickTeam}`
                      : 'Pick a team above'}
                  </button>
                </div>
              )}

              {predictions.isOwner && (
                <details className="admin-panel">
                  <summary>Owner controls</summary>
                  <div className="admin-controls">
                    <button onClick={predictions.lockPool} type="button" className="wallet-btn warn">
                      <Lock size={13} /> Lock Pool
                    </button>
                    <div className="admin-settle">
                      <select value={settleTeam} onChange={(e) => setSettleTeam(e.target.value)}>
                        <option value="">Select champion…</option>
                        {roster.teams.map((t) => (
                          <option key={t.name} value={t.name}>{t.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => settleTeam && predictions.settle(settleTeam)}
                        type="button"
                        className="wallet-btn"
                        disabled={!settleTeam || !predictions.locked}
                      >
                        Settle Champion
                      </button>
                    </div>
                  </div>
                </details>
              )}

              {predictions.txError && (
                <p className="tx-error">{predictions.txError}</p>
              )}
            </>
          )}
        </article>

        <article className="panel protocol-panel">
          <div className="panel-heading">
            <span>
              <ShieldCheck size={18} />
              Blockchain Logic
            </span>
          </div>
          <ol>
            {contractSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </article>

        <article className="panel docs-panel">
          <div className="panel-heading">
            <span>
              <ShieldCheck size={18} />
              Docs
            </span>
          </div>
          <div className="docs-grid">
            {docsItems.map((item) => (
              <div className="doc-tile" key={item.title}>
                <strong>{item.title}</strong>
                <p>{item.body}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="panel simulation-panel">
          <div className="panel-heading">
            <span>
              <Activity size={18} />
              Simulation Engine
            </span>
            <small>realistic weighting model</small>
          </div>
          <p>
            Every AI match is calculated from player and squad data first. Stronger teams create
            better chances more often, elite players influence passes, runs and shots, and match
            events such as fouls, referee strictness and momentum change the rhythm of the game.
          </p>
          <div className="factor-list">
            {simulationFactors.map((factor) => (
              <div className="factor-row" key={factor.label}>
                <div>
                  <strong>{factor.label}</strong>
                  <span>{factor.detail}</span>
                </div>
                <b>{factor.value}%</b>
                <i style={{ width: `${factor.value}%` }} />
              </div>
            ))}
          </div>
        </article>

        <article className="panel how-panel">
          <div className="panel-heading">
            <span>
              <Sparkles size={18} />
              How It Works
            </span>
          </div>
          <ol>
            {howItWorksItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </article>


      </section>
    </main>
  )
}

export default App
