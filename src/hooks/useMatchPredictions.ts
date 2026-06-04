import { useCallback, useEffect, useState } from 'react'
import { Contract, formatEther, id as ethersId, parseEther } from 'ethers'
import type { BrowserProvider, JsonRpcSigner } from 'ethers'
import { MATCH_PREDICTIONS_ABI } from '../contracts/abis'

const CONTRACT_ADDRESS = (import.meta.env.VITE_MATCH_PREDICTIONS_ADDRESS as string | undefined)?.trim()

const OUTCOME_INDEX = { home: 0, draw: 1, away: 2 } as const
type Outcome = keyof typeof OUTCOME_INDEX

export type MatchPool = {
  home: string
  draw: string
  away: string
  settled: boolean
  winner: Outcome | null
  myStake: Record<Outcome, string>
}

export type UseMatchPredictionsReturn = {
  isReady: boolean
  isOwner: boolean
  pool: MatchPool
  isPlacing: boolean
  txError: string | null
  placeBet: (matchId: string, outcome: Outcome, ethAmount: string) => Promise<void>
  settle: (matchId: string, outcome: Outcome) => Promise<void>
  claim: (matchId: string) => Promise<void>
  refresh: (matchId: string) => Promise<void>
}

const EMPTY_POOL: MatchPool = {
  home: '0', draw: '0', away: '0',
  settled: false, winner: null,
  myStake: { home: '0', draw: '0', away: '0' },
}

function matchIdBytes(matchId: string, cycle: number) {
  return ethersId(`FLWC_MATCH:${matchId}:${cycle}`)
}

export function useMatchPredictions(
  signer: JsonRpcSigner | null,
  provider: BrowserProvider | null,
  account: string | null,
  cycle: number,
): UseMatchPredictionsReturn {
  const [pool, setPool] = useState<MatchPool>(EMPTY_POOL)
  const [isOwner, setIsOwner] = useState(false)
  const [isPlacing, setIsPlacing] = useState(false)
  const [txError, setTxError] = useState<string | null>(null)

  const isReady = Boolean(CONTRACT_ADDRESS)

  const readContract = useCallback(() => {
    if (!CONTRACT_ADDRESS || !provider) return null
    return new Contract(CONTRACT_ADDRESS, MATCH_PREDICTIONS_ABI, provider)
  }, [provider])

  const writeContract = useCallback(() => {
    if (!CONTRACT_ADDRESS || !signer) return null
    return new Contract(CONTRACT_ADDRESS, MATCH_PREDICTIONS_ABI, signer)
  }, [signer])

  const refresh = useCallback(async (matchId: string) => {
    const c = readContract()
    if (!c) return

    const bid = matchIdBytes(matchId, cycle)

    try {
      const [poolResult, ownerAddr] = await Promise.all([
        c.getPool(bid),
        c.owner(),
      ])

      const homePool  = poolResult[0]
      const drawPool  = poolResult[1]
      const awayPool  = poolResult[2]
      const settled   = poolResult[3]
      const winnerIdx = Number(poolResult[4])

      const outcomes: Outcome[] = ['home', 'draw', 'away']
      const myStake: Record<Outcome, string> = { home: '0', draw: '0', away: '0' }

      if (account) {
        setIsOwner((ownerAddr as string).toLowerCase() === account.toLowerCase())
        const stakeResult = await c.myStakes(bid, account)
        myStake.home = formatEther(stakeResult[0])
        myStake.draw = formatEther(stakeResult[1])
        myStake.away = formatEther(stakeResult[2])
      }

      setPool({
        home: formatEther(homePool),
        draw: formatEther(drawPool),
        away: formatEther(awayPool),
        settled,
        winner: settled ? (outcomes[winnerIdx] ?? null) : null,
        myStake,
      })
    } catch {
      // Pool doesn't exist yet — that's fine, show empty
      setPool(EMPTY_POOL)
    }
  }, [account, readContract])

  useEffect(() => {
    if (!provider) setPool(EMPTY_POOL)
  }, [provider])

  const placeBet = useCallback(async (matchId: string, outcome: Outcome, ethAmount: string) => {
    const c = writeContract()
    if (!c) return
    setIsPlacing(true)
    setTxError(null)
    try {
      // Verify we're on Base (chainId 8453) before sending
      const network = await c.runner?.provider?.getNetwork?.()
      if (network && Number(network.chainId) !== 8453) {
        setTxError('Wrong network — switch MetaMask to Base mainnet and try again.')
        setIsPlacing(false)
        return
      }

      const value = parseEther(ethAmount)
      const tx = await c.placeBet(matchIdBytes(matchId, cycle), OUTCOME_INDEX[outcome], { value })
      await tx.wait()
      await refresh(matchId)
    } catch (err: any) {
      const reason = err?.reason
      const msg = err?.shortMessage ?? err?.message ?? 'Transaction failed'
      if (msg.includes('user rejected') || msg.includes('ACTION_REJECTED')) {
        setTxError('Transaction cancelled.')
      } else if (reason) {
        setTxError(reason)
      } else if (msg.includes('SETTLED')) {
        setTxError('This match is already settled.')
      } else if (msg.includes('missing revert data') || msg.includes('CALL_EXCEPTION')) {
        setTxError('Transaction failed. Make sure you are on Base mainnet and have enough ETH for gas.')
      } else {
        setTxError(msg)
      }
    } finally {
      setIsPlacing(false)
    }
  }, [writeContract, refresh])

  const settle = useCallback(async (matchId: string, outcome: Outcome) => {
    const c = writeContract()
    if (!c) return
    setTxError(null)
    try {
      const tx = await c.settle(matchIdBytes(matchId, cycle), OUTCOME_INDEX[outcome])
      await tx.wait()
      await refresh(matchId)
    } catch (err: any) {
      setTxError(err?.reason ?? err?.shortMessage ?? err?.message ?? 'Settle failed')
    }
  }, [writeContract, refresh])

  const claim = useCallback(async (matchId: string) => {
    const c = writeContract()
    if (!c) return
    setTxError(null)
    try {
      const tx = await c.claim(matchIdBytes(matchId, cycle))
      await tx.wait()
      await refresh(matchId)
    } catch (err: any) {
      setTxError(err?.reason ?? err?.shortMessage ?? err?.message ?? 'Claim failed')
    }
  }, [writeContract, refresh])

  return { isReady, isOwner, pool, isPlacing, txError, placeBet, settle, claim, refresh }
}
