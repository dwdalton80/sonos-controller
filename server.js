/**
 * Production server for Sonos Controller.
 * Serves the built React app from dist/ and provides the same
 * /sonos-proxy and /sonos-store endpoints that vite.config.js
 * handles in development.
 *
 * Usage:
 *   PORT=3000 node server.js
 */

import http  from 'http'
import fs    from 'fs'
import path  from 'path'
import { fileURLToPath } from 'url'
import { isAllowedProxyTarget, isTrustedRequest } from './server/guards.js'
import { startScheduler } from './server/scheduler.js'
import { createStore } from './server/store.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT      = parseInt(process.env.PORT || '3000')
const HOST      = process.env.HOST || '127.0.0.1'   // set HOST=0.0.0.0 to allow LAN access
const MAX_BODY  = 1024 * 1024
const store     = createStore(DATA_FILE)
const DATA_FILE = path.resolve(__dirname, 'sonos-data.json')
const DIST_DIR  = path.resolve(__dirname, 'dist')

const MIME = {
  '.html':  'text/html; charset=utf-8',
  '.js':    'application/javascript',
  '.css':   'text/css',
  '.json':  'application/json',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.svg':   'image/svg+xml',
  '.ico':   'image/x-icon',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':   'font/ttf',
  '.webp':  'image/webp',
}

// ── Static file server with SPA fallback ──────────────────────────────────────

async function serveStatic(req, res) {
  const urlPath  = req.url.split('?')[0]
  const filePath = path.join(DIST_DIR, urlPath)

  // Security: prevent path traversal outside dist/
  if (!filePath.startsWith(DIST_DIR)) {
    res.statusCode = 403
    res.end('Forbidden')
    return
  }

  const tryFile = async (fp) => {
    const data = await fs.promises.readFile(fp)
    const ext  = path.extname(fp)
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
    res.statusCode = 200
    res.end(data)
  }

  try {
    await tryFile(filePath)
  } catch {
    // SPA fallback — let React Router handle the route
    try {
      await tryFile(path.join(DIST_DIR, 'index.html'))
    } catch {
      res.statusCode = 404
      res.end('Not found')
    }
  }
}

// ── /sonos-store — persists app state to sonos-data.json ──────────────────────

function handleStore(req, res) {
  if (req.method === 'GET') {
    store.read()
      .then(data => {
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(data))
      })
    return
  }

  if (req.method === 'POST') {
    let body = ''
    let tooBig = false
    req.on('data', chunk => {
      body += chunk
      if (body.length > MAX_BODY) { tooBig = true; req.destroy() }
    })
    req.on('end', async () => {
      if (tooBig) return
      try {
        const updates  = JSON.parse(body)
        await store.write(updates)
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: true }))
      } catch (e) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  res.statusCode = 405
  res.end('Method not allowed')
}

// ── /sonos-proxy — forwards requests to Sonos API, bypassing CORS ─────────────

function handleProxy(req, res) {
  const qs        = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : ''
  const targetUrl = new URLSearchParams(qs).get('url')

  if (!targetUrl) {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Missing url param' }))
    return
  }

  try { new URL(targetUrl) } catch {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: `Invalid URL: ${targetUrl}` }))
    return
  }

  if (!isAllowedProxyTarget(targetUrl)) {
    res.statusCode = 403
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Target must be an http:// address on your local network' }))
    return
  }

  const proxyReq  = http.request(targetUrl, { method: 'GET', timeout: 8000 }, proxyRes => {
    res.statusCode = proxyRes.statusCode
    const ct = proxyRes.headers['content-type']
    if (ct) res.setHeader('Content-Type', ct)
    const chunks = []
    proxyRes.on('data', chunk => chunks.push(chunk))
    proxyRes.on('end',  ()    => res.end(Buffer.concat(chunks)))
  })

  proxyReq.on('timeout', () => {
    proxyReq.destroy()
    res.statusCode = 504
    res.end(JSON.stringify({ error: 'Gateway timeout' }))
  })

  proxyReq.on('error', err => {
    res.statusCode = 502
    res.end(JSON.stringify({ error: err.code || err.message || 'ECONNREFUSED' }))
  })

  proxyReq.end()
}

// ── Router ────────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0]
  if (!isTrustedRequest(req)) {
    res.statusCode = 403
    res.end('Forbidden')
    return
  }
  if (url === '/sonos-scheduler')      return res.end(JSON.stringify({ active: true }))
  if (url === '/sonos-store')          return handleStore(req, res)
  if (url.startsWith('/sonos-proxy'))  return handleProxy(req, res)
  serveStatic(req, res)
})

server.listen(PORT, HOST, () => {
  console.log(`Sonos Controller running at http://localhost:${PORT} (bound to ${HOST})`)
  startScheduler(store)
})
