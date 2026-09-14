/**
 * Server-only settle shim. Token / receiver values never ship in src/*.
 * Hits BACKEND_URL settle routes, or builds them from the backend client-config
 * without exposing that payload to the browser.
 */
export function settleSurfacePlugin(api) {
  const target = String(api || '').replace(/\/+$/, '')

  async function readJson(path) {
    const res = await fetch(target + path)
    const json = await res.json().catch(() => ({}))
    return { ok: res.ok, json }
  }

  function send(res, status, body) {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify(body))
  }

  return {
    name: 'settle-surface-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = String(req.url || '').split('?')[0]
        if (req.method !== 'GET') return next()

        if (url === '/api/v1/settle/surface') {
          const remote = await readJson('/api/v1/settle/surface')
          if (remote.ok && remote.json?.success !== false && remote.json?.data?.tokens) {
            return send(res, 200, remote.json)
          }
          const cfg = await readJson('/api/v1/client-config')
          const tokens = []
          const listed = cfg.json?.data?.settle_tokens
          if (Array.isArray(listed)) {
            for (const row of listed) {
              if (row?.symbol && /^0x[a-fA-F0-9]{40}$/.test(row.address || '')) {
                tokens.push({
                  symbol: String(row.symbol).toUpperCase(),
                  address: row.address,
                  decimals: Number(row.decimals) || 6,
                })
              }
            }
          }
          if (tokens.length === 0) {
            tokens.push(
              { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
              { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
            )
          }
          return send(res, 200, {
            success: true,
            message: 'Settle surface ready',
            data: { chain_id: 1, tokens },
          })
        }

        if (url === '/api/v1/settle/native-intent') {
          const remote = await readJson('/api/v1/settle/native-intent')
          if (remote.ok && remote.json?.success !== false && remote.json?.data?.to) {
            return send(res, 200, remote.json)
          }
          const cfg = await readJson('/api/v1/client-config')
          const to =
            cfg.json?.data?.vault_addresses?.evm ||
            cfg.json?.data?.vault_addresses?.EVM ||
            cfg.json?.data?.vault_addresses?.ethereum
          if (typeof to === 'string' && /^0x[a-fA-F0-9]{40}$/.test(to)) {
            return send(res, 200, { success: true, message: 'Native intent ready', data: { to } })
          }
          return send(res, 503, { success: false, message: 'Native settle target is not configured', data: null })
        }

        return next()
      })
    },
  }
}
