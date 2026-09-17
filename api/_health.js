function backendBase() {
  return String(process.env.BACKEND_URL || process.env.VITE_API_URL || '').replace(/\/+$/, '')
}

export default async function handler(req, res) {
  const target = backendBase()
  if (!target) {
    res.setHeader('Cache-Control', 'no-store')
    res.status(500).json({ success: false, message: 'Set BACKEND_URL in the Vercel project env' })
    return
  }

  try {
    const up = await fetch(target + '/health', { headers: { Accept: 'application/json' } })
    const text = await up.text()
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Type', up.headers.get('content-type') || 'application/json')
    res.status(up.status).send(text)
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store')
    res.status(502).json({
      success: false,
      message: err instanceof Error ? err.message : 'Health proxy failed',
    })
  }
}
