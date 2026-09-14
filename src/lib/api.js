/** Same-origin only. BACKEND_URL lives in Vite proxy, never in the page. */
export function apiBase() {
  return ''
}

export const CHAIN_ID = 1
export const ETH_USD = 2600

export function unwrap(json) {
  return json && json.data !== undefined ? json.data : json
}

function fetchOpts(extra) {
  return Object.assign({
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    headers: { Accept: 'application/json' },
  }, extra || {})
}

export async function apiGet(path) {
  const res = await fetch(apiBase() + path, fetchOpts())
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.success === false) {
    throw new Error(json.message || (path + ' → HTTP ' + res.status))
  }
  return unwrap(json)
}

export async function apiPost(path, body) {
  const res = await fetch(apiBase() + path, fetchOpts({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  }))
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.success === false) {
    const fault = json.data && json.data.settlement_fault
    throw new Error(fault || json.message || (path + ' → HTTP ' + res.status))
  }
  return json
}
