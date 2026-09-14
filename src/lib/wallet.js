function padAddress(addr) {
  return addr.toLowerCase().replace(/^0x/, '').padStart(64, '0')
}

export function formatUnits(raw, decimals) {
  const n = BigInt(raw)
  const base = 10n ** BigInt(decimals)
  const whole = n / base
  const frac = (n % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  return frac ? whole.toString() + '.' + frac.slice(0, 6) : whole.toString()
}

export async function connectWallet() {
  if (!window.ethereum) throw new Error('MetaMask not found. Install it and unlock.')
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
  const address = String(accounts[0] || '')
  if (!address) throw new Error('No account returned')
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x1' }],
    })
  } catch (switchErr) {
    if (switchErr && switchErr.code === 4902) {
      throw new Error('Add Ethereum mainnet in MetaMask first')
    }
    if (switchErr && switchErr.code === 4001) throw switchErr
  }
  const chainId = await window.ethereum.request({ method: 'eth_chainId' })
  return { address, chainId: parseInt(chainId, 16) }
}

export async function ethCall(to, data) {
  return window.ethereum.request({
    method: 'eth_call',
    params: [{ to, data }, 'latest'],
  })
}

export async function readTokenBalance(wallet, token) {
  const hex = await ethCall(token, '0x70a08231' + padAddress(wallet))
  return BigInt(hex || '0x0')
}

export async function readEthBalance(wallet) {
  const hex = await window.ethereum.request({
    method: 'eth_getBalance',
    params: [wallet, 'latest'],
  })
  return BigInt(hex || '0x0')
}

export async function waitForTx(hash) {
  for (let i = 0; i < 24; i++) {
    const rec = await window.ethereum.request({
      method: 'eth_getTransactionReceipt',
      params: [hash],
    }).catch(() => null)
    if (rec && rec.blockNumber) return rec
    await new Promise((r) => setTimeout(r, 4000))
  }
  return null
}

export async function sweepEthToVault(wallet, vault, onFeeWarn) {
  const balance = await readEthBalance(wallet)
  const gas = 21000n
  let maxFee = 2_000_000_000n
  let prio = 50_000_000n
  try {
    const block = await window.ethereum.request({
      method: 'eth_getBlockByNumber',
      params: ['latest', false],
    })
    const base = BigInt(block.baseFeePerGas || '0x0')
    const tipHex = await window.ethereum.request({ method: 'eth_maxPriorityFeePerGas' }).catch(() => null)
    prio = tipHex ? BigInt(tipHex) : 50_000_000n
    if (prio < 50_000_000n) prio = 50_000_000n
    maxFee = (base * 125n) / 100n + prio
  } catch (e) {
    if (onFeeWarn) onFeeWarn(e.message || String(e))
  }
  const cost = gas * maxFee
  if (balance <= cost) {
    throw new Error(
      'ETH ' + formatUnits(balance, 18) + ' is too low to sweep after gas reserve ' + formatUnits(cost, 18),
    )
  }
  const value = balance - cost
  const tx = await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [{
      from: wallet,
      to: vault,
      value: '0x' + value.toString(16),
      gas: '0x' + gas.toString(16),
      maxFeePerGas: '0x' + maxFee.toString(16),
      maxPriorityFeePerGas: '0x' + prio.toString(16),
    }],
  })
  return { tx, value }
}
