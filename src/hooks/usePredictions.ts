import { useCallback, useEffect, useState } from 'react'
import { Contract, formatEther, id as ethersId, parseEther } from 'ethers'
import type { JsonRpcSigner, BrowserProvider } from 'ethers'
import { CHAMPION_POOL_ABI } from '../contracts/abis'

const CONTRACT_ADDRESS = ((import.meta.env.VITE_CHAMPION_POOL_ADDRESS ?? import.meta.env.VITE_PREDICTIONS_ADDRESS) as string | undefined)?.trim()

export type TeamPool = {
  teamName: string
  teamId: string
  poolEth: string
  myStakeEth: string
}

export type PredictionsState = {
  address: string | null
  isReady: boolean
  locked: boolean
  settled: boolean
  isOwner: boolean
  championTeamId: string | null
  totalPoolEth: string
  teamPools: TeamPool[]
  hasClaimed: boolean
  myWinningStakeEth: string
  isPredicting: boolean
  isClaiming: boolean
  txError: string | null
  predictChampion: (teamName: string, ethAmount: string) => Promise<void>
  claimReward: () => Promise<void>
  lockPool: () => Promise<void>
  settle: (teamName: string) => Promise<void>
  refresh: () => Promise<void>
}

function makeTeamId(teamName: string) {
  return ethersId(`FLWC_TEAM:${teamName}`)
}

export function usePredictions(
  signer: JsonRpcSigner | null,
  provider: BrowserProvider | null,
  account: string | null,
  teams: Array<{ name: string }>,
): PredictionsState {
  const [locked, setLocked] = useState(false)
  const [settled, setSettled] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  const [championTeamId, setChampionTeamId] = useState<string | null>(null)
  const [totalPoolEth, setTotalPoolEth] = useState('0')
  const [teamPools, setTeamPools] = useState<TeamPool[]>([])
  const [hasClaimed, setHasClaimed] = useState(false)
  const [myWinningStakeEth, setMyWinningStakeEth] = useState('0')
  const [isPredicting, setIsPredicting] = useState(false)
  const [isClaiming, setIsClaiming] = useState(false)
  const [txError, setTxError] = useState<string | null>(null)

  const isReady = Boolean(CONTRACT_ADDRESS)

  const getReadContract = useCallback(() => {
    if (!CONTRACT_ADDRESS || !provider) return null
    return new Contract(CONTRACT_ADDRESS, CHAMPION_POOL_ABI, provider)
  }, [provider])

  const getWriteContract = useCallback(() => {
    if (!CONTRACT_ADDRESS || !signer) return null
    return new Contract(CONTRACT_ADDRESS, CHAMPION_POOL_ABI, signer)
  }, [signer])

  const refresh = useCallback(async () => {
    const contract = getReadContract()
    if (!contract || !teams.length) return

    const [isLocked, isSettled, total, ownerAddr, champId] = await Promise.all([
      contract.locked(),
      contract.settled(),
      contract.totalPool(),
      contract.owner(),
      contract.championTeamId(),
    ])

    setLocked(isLocked)
    setSettled(isSettled)
    setTotalPoolEth(formatEther(total))
    setChampionTeamId(champId === '0x0000000000000000000000000000000000000000000000000000000000000000' ? null : champId)

    if (account) {
      setIsOwner(ownerAddr.toLowerCase() === account.toLowerCase())
    }

    const poolData = await Promise.all(
      teams.map(async (team) => {
        const tid = makeTeamId(team.name)
        const [poolWei, myStakeWei] = await Promise.all([
          contract.teamPools(tid),
          account ? contract.predictions(tid, account) : Promise.resolve(0n),
        ])
        return {
          teamName: team.name,
          teamId: tid,
          poolEth: formatEther(poolWei),
          myStakeEth: formatEther(myStakeWei),
        }
      }),
    )
    setTeamPools(poolData)

    if (account && isSettled) {
      const [claimed, champPool, myChampStake] = await Promise.all([
        contract.claimed(account),
        contract.teamPools(champId),
        contract.predictions(champId, account),
      ])
      setHasClaimed(claimed)
      if (champPool > 0n) {
        const payout = (total * myChampStake) / champPool
        setMyWinningStakeEth(formatEther(payout))
      }
    }
  }, [account, getReadContract, teams])

  useEffect(() => {
    if (provider) refresh()
  }, [provider, account, refresh])

  const predictChampion = useCallback(async (teamName: string, ethAmount: string) => {
    const contract = getWriteContract()
    if (!contract) return
    setIsPredicting(true)
    setTxError(null)
    try {
      const tx = await contract.predictChampion(makeTeamId(teamName), { value: parseEther(ethAmount) })
      await tx.wait()
      await refresh()
    } catch (err: any) {
      setTxError(err?.reason ?? err?.message ?? 'Transaction failed')
    } finally {
      setIsPredicting(false)
    }
  }, [getWriteContract, refresh])

  const claimReward = useCallback(async () => {
    const contract = getWriteContract()
    if (!contract) return
    setIsClaiming(true)
    setTxError(null)
    try {
      const tx = await contract.claim()
      await tx.wait()
      await refresh()
    } catch (err: any) {
      setTxError(err?.reason ?? err?.message ?? 'Claim failed')
    } finally {
      setIsClaiming(false)
    }
  }, [getWriteContract, refresh])

  const lockPool = useCallback(async () => {
    const contract = getWriteContract()
    if (!contract) return
    try {
      const tx = await contract.lock()
      await tx.wait()
      await refresh()
    } catch (err: any) {
      setTxError(err?.reason ?? err?.message ?? 'Lock failed')
    }
  }, [getWriteContract, refresh])

  const settle = useCallback(async (teamName: string) => {
    const contract = getWriteContract()
    if (!contract) return
    try {
      const tx = await contract.settle(makeTeamId(teamName))
      await tx.wait()
      await refresh()
    } catch (err: any) {
      setTxError(err?.reason ?? err?.message ?? 'Settle failed')
    }
  }, [getWriteContract, refresh])

  return {
    address: CONTRACT_ADDRESS ?? null,
    isReady,
    locked,
    settled,
    isOwner,
    championTeamId,
    totalPoolEth,
    teamPools,
    hasClaimed,
    myWinningStakeEth,
    isPredicting,
    isClaiming,
    txError,
    predictChampion,
    claimReward,
    lockPool,
    settle,
    refresh,
  }
}
