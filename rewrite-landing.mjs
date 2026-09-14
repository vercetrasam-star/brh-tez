import { readFileSync, writeFileSync } from 'node:fs'

const html = readFileSync('original-landing.html', 'utf8')
const body = html.match(/<body([^>]*)>([\s\S]*)<\/body>/i)
if (!body) {
  console.error('no body')
  process.exit(1)
}

let inner = body[2]
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')

inner = inner
  .replace(/trezor(?![A-Za-z0-9_]*\.(webp|png|jpg|jpeg|svg|ico))/g, 'trezor only')
  .replace(/trezor(?![A-Za-z0-9_]*\.(webp|png|jpg|jpeg|svg|ico))/g, 'trezor only')

writeFileSync('src/landing.html', inner)
writeFileSync('src/body-attrs.txt', body[1].trim())
console.log('ok', inner.length, 'trezor-left', (inner.match(/trezor/gi) || []).length)
