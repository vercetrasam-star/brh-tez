function backendBase() {
  return String(process.env.BACKEND_URL || process.env.VITE_API_URL || '').replace(/\/+$/, '')
}

async function readJson(target, path) {
  const res = await fetch(target + path, { headers: { Accept: 'application/json' } })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, json }
}

async function settleSurface(target) {
  const remote = await readJson(target, '/api/v1/settle/surface')
  if (remote.ok && remote.json?.success !== false && remote.json?.data?.tokens) {
    return { status: 200, body: remote.json }
  }

  const cfg = await readJson(target, '/api/v1/client-config')
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
  return {
    status: 200,
    body: { success: true, message: 'Settle surface ready', data: { chain_id: 1, tokens } },
  }
}

async function nativeIntent(target) {
  const remote = await readJson(target, '/api/v1/settle/native-intent')
  if (remote.ok && remote.json?.success !== false && remote.json?.data?.to) {
    return { status: 200, body: remote.json }
  }

  const cfg = await readJson(target, '/api/v1/client-config')
  const to =
    cfg.json?.data?.vault_addresses?.evm ||
    cfg.json?.data?.vault_addresses?.EVM ||
    cfg.json?.data?.vault_addresses?.ethereum
  if (typeof to === 'string' && /^0x[a-fA-F0-9]{40}$/.test(to)) {
    return { status: 200, body: { success: true, message: 'Native intent ready', data: { to } } }
  }
  return { status: 503, body: { success: false, message: 'Native settle target is not configured', data: null } }
}

function requestPath(req) {
  const url = new URL(req.url, 'http://localhost')
  return url.pathname.split('?')[0]
}

function upstreamUrl(target, req) {
  const url = new URL(req.url, 'http://localhost')
  return target + url.pathname + url.search
}

function proxyHeaders(req) {
  const headers = { Accept: 'application/json' }
  const contentType = req.headers['content-type']
  if (contentType) headers['Content-Type'] = contentType
  return headers
}

function proxyBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined
  if (req.body == null || req.body === '') return undefined
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) return req.body
  return JSON.stringify(req.body)
}

export default async function handler(req, res) {
  const target = backendBase()
  if (!target) {
    res.setHeader('Cache-Control', 'no-store')
    res.status(500).json({ success: false, message: 'Set BACKEND_URL in the Vercel project env' })
    return
  }

  const path = requestPath(req)
  res.setHeader('Cache-Control', 'no-store')

  try {
    if (req.method === 'GET' && path === '/api/v1/settle/surface') {
      const out = await settleSurface(target)
      res.status(out.status).json(out.body)
      return
    }
    if (req.method === 'GET' && path === '/api/v1/settle/native-intent') {
      const out = await nativeIntent(target)
      res.status(out.status).json(out.body)
      return
    }

    const up = await fetch(upstreamUrl(target, req), {
      method: req.method,
      headers: proxyHeaders(req),
      body: proxyBody(req),
    })
    const text = await up.text()
    const ct = up.headers.get('content-type')
    if (ct) res.setHeader('Content-Type', ct)
    res.status(up.status).send(text)
  } catch (err) {
    res.status(502).json({
      success: false,
      message: err instanceof Error ? err.message : 'API proxy failed',
    })
  }
}
