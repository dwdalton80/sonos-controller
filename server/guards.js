import net from 'net'

/** True for loopback, RFC1918, CGNAT-free private ranges and .local names. */
export function isLocalHost(hostname) {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (h === 'localhost' || h.endsWith('.local')) return true
  const kind = net.isIP(h)
  if (kind === 4) {
    const [a, b] = h.split('.').map(Number)
    if (a === 127 || a === 10) return true
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    return false
  }
  if (kind === 6) {
    return h === '::1' || h.startsWith('fc') || h.startsWith('fd')
  }
  return false
}

/**
 * Where the Sonos HTTP API may live: a LAN/loopback host, plain http, and
 * never the cloud-metadata / link-local range.
 */
export function isAllowedProxyTarget(targetUrl) {
  let u
  try { u = new URL(targetUrl) } catch { return false }
  if (u.protocol !== 'http:') return false
  if (u.hostname.startsWith('169.254.')) return false
  return isLocalHost(u.hostname)
}

/**
 * Blocks drive-by requests from other websites and DNS-rebinding:
 *  - the Host header must be a local name/IP
 *  - a browser-sent Origin must be this same server
 */
export function isTrustedRequest(req) {
  const host = req.headers.host || ''
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
  if (!isLocalHost(hostname)) return false
  const origin = req.headers.origin
  if (origin) {
    try { if (new URL(origin).host !== host) return false } catch { return false }
  }
  return true
}
