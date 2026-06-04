import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserProvider, JsonRpcSigner } from 'ethers'

const BASE_CHAIN_ID = 8453
const BASE_CHAIN_HEX = '0x2105'

const BASE_NETWORK_PARAMS = {
  chainId: BASE_CHAIN_HEX,
  chainName: 'Base',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://mainnet.base.org'],
  blockExplorerUrls: ['https://basescan.org'],
}

export type WalletState = {
  account: string | null
  chainId: number | null
  signer: JsonRpcSigner | null
  provider: BrowserProvider | null
  isConnecting: boolean
  isOnBase: boolean
  error: string | null
  connect: () => Promise<void>
  disconnect: () => void
  switchToBase: () => Promise<void>
}

export function useWallet(): WalletState {
  const [account, setAccount] = useState<string | null>(null)
  const [chainId, setChainId] = useState<number | null>(null)
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null)
  const [provider, setProvider] = useState<BrowserProvider | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Track whether listeners are already registered so we never double-add
  const listenersAttached = useRef(false)

  const refresh = useCallback(async (browserProvider: BrowserProvider) => {
    try {
      const network = await browserProvider.getNetwork()
      const accounts = await browserProvider.listAccounts()
      const currentChainId = Number(network.chainId)
      setChainId(currentChainId)
      if (accounts.length > 0) {
        setAccount(accounts[0].address)
        setSigner(await browserProvider.getSigner())
      } else {
        setAccount(null)
        setSigner(null)
      }
    } catch {
      // provider may have been disconnected
    }
  }, [])

  const connect = useCallback(async () => {
    const eth = (window as any).ethereum
    if (!eth) { setError('MetaMask not found. Install it from metamask.io'); return }
    setIsConnecting(true)
    setError(null)
    try {
      await eth.request({ method: 'eth_requestAccounts' })
      const bp = new BrowserProvider(eth)
      setProvider(bp)
      await refresh(bp)
    } catch (err: any) {
      setError(err?.message ?? 'Connection failed')
    } finally {
      setIsConnecting(false)
    }
  }, [refresh])

  const disconnect = useCallback(() => {
    setAccount(null)
    setSigner(null)
    setProvider(null)
    setChainId(null)
  }, [])

  const switchToBase = useCallback(async () => {
    const eth = (window as any).ethereum
    if (!eth) return
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BASE_CHAIN_HEX }] })
    } catch (err: any) {
      if (err.code === 4902) {
        await eth.request({ method: 'wallet_addEthereumChain', params: [BASE_NETWORK_PARAMS] })
      }
    }
  }, [])

  // Register MetaMask listeners exactly once
  useEffect(() => {
    const eth = (window as any).ethereum
    if (!eth || listenersAttached.current) return
    listenersAttached.current = true

    const bp = new BrowserProvider(eth)

    // Auto-connect if already approved
    bp.listAccounts().then((accounts) => {
      if (accounts.length > 0) {
        setProvider(bp)
        refresh(bp)
      }
    }).catch(() => {})

    const onAccountsChanged = () => refresh(bp)
    const onChainChanged = () => refresh(bp)

    eth.on('accountsChanged', onAccountsChanged)
    eth.on('chainChanged', onChainChanged)

    return () => {
      eth.removeListener('accountsChanged', onAccountsChanged)
      eth.removeListener('chainChanged', onChainChanged)
      listenersAttached.current = false
    }
  }, [refresh])

  return {
    account, chainId, signer, provider, isConnecting,
    isOnBase: chainId === BASE_CHAIN_ID,
    error, connect, disconnect, switchToBase,
  }
}
