import { useEffect, useState } from 'react'

// Always call Base public RPC directly — never goes through MetaMask
const BASE_RPC = 'https://mainnet.base.org'

async function rpc(method: string, params: unknown[]): Promise<any> {
  const res = await fetch(BASE_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const json = await res.json()
  if (json.error) throw new Error(json.error.message)
  return json.result
}

async function getLatestBlock(): Promise<{ number: number; timestamp: number }> {
  const raw = await rpc('eth_getBlockByNumber', ['latest', false])
  return { number: parseInt(raw.number, 16), timestamp: parseInt(raw.timestamp, 16) }
}

async function getBlockByNumber(n: number): Promise<{ hash: string; number: number } | null> {
  const raw = await rpc('eth_getBlockByNumber', [`0x${n.toString(16)}`, false])
  if (!raw) return null
  return { hash: raw.hash, number: parseInt(raw.number, 16) }
}

type SeedState = {
  seed: string | null
  blockNumber: number | null
  loading: boolean
}

export function useMatchSeed(startsAt: string): SeedState {
  const [state, setState] = useState<SeedState>({ seed: null, blockNumber: null, loading: false })

  useEffect(() => {
    let cancelled = false
    const startMs = new Date(startsAt).getTime()

    async function fetchSeed() {
      if (Date.now() < startMs) return

      setState(s => ({ ...s, loading: true }))
      try {
        const latest = await getLatestBlock()
        if (cancelled) return

        const startSec = Math.floor(startMs / 1000)
        const secsAgo = Math.max(0, latest.timestamp - startSec)
        // Base: ~1 block every 2 seconds
        const blocksAgo = Math.round(secsAgo * 0.5)
        const targetNum = Math.max(1, latest.number - blocksAgo)

        const block = await getBlockByNumber(targetNum)
        if (!block || cancelled) return

        setState({ seed: block.hash, blockNumber: block.number, loading: false })
      } catch {
        if (!cancelled) setState(s => ({ ...s, loading: false }))
      }
    }

    fetchSeed()

    const msUntilStart = startMs - Date.now()
    let timer: ReturnType<typeof setTimeout> | null = null
    if (msUntilStart > 0) {
      timer = setTimeout(fetchSeed, msUntilStart + 1000)
    }

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [startsAt])

  return state
}
