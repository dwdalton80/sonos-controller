import http from 'http'

const TICK_MS = 15_000
const GRACE_MIN = 5          // fire late (e.g. after sleep) if within this window
const MAX_STATE_KEYS = 200
const MAX_LOG = 100

const onOff = (v) => (v ? 'on' : 'off')

/** Schedules due now that have not yet fired today. Pure — easy to test. */
export function findDue(schedules, now, fired) {
  const due = []
  const today = dayKey(now)
  for (const s of schedules || []) {
    if (!s.enabled || !Array.isArray(s.days) || !s.days.includes(now.getDay())) continue
    const [hh, mm] = String(s.time).split(':').map(Number)
    if (Number.isNaN(hh) || Number.isNaN(mm)) continue
    const at = new Date(now)
    at.setHours(hh, mm, 0, 0)
    const lateMin = (now - at) / 60000
    if (lateMin < 0 || lateMin > GRACE_MIN) continue
    const key = `${s.id}:${today}`
    if (fired[key]) continue
    due.push({ schedule: s, key })
  }
  return due
}

function dayKey(d) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

export function buildCommands(config, profile) {
  const base = `http://${config.host}:${config.port}/${encodeURIComponent(config.room)}`
  const subOn = profile.subwooferEnabled !== false
  return [
    `${base}/volume/${profile.volume}`,
    `${base}/bass/${profile.bass}`,
    `${base}/treble/${profile.treble}`,
    `${base}/nightmode/${onOff(profile.nightMode)}`,
    `${base}/speechenhancement/${onOff(profile.speechEnhancement)}`,
    `${base}/sub/${subOn ? 'on' : 'off'}`,
    ...(subOn ? [`${base}/sub/gain/${profile.subwooferGain}`] : []),
  ]
}

function get(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 8000 }, (res) => {
      res.resume()
      resolve({ ok: res.statusCode < 500, status: res.statusCode })
    })
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }) })
    req.on('error', (e) => resolve({ ok: false, error: e.code || e.message }))
  })
}

export async function applyProfile(config, profile, fetcher = get) {
  const commands = buildCommands(config, profile)
  const results = await Promise.all(commands.map(fetcher))
  return { ok: results.some((r) => r.ok), failures: results.filter((r) => !r.ok).length, total: results.length }
}

/**
 * Starts the background runner. `store` = { read(), write(patch) }.
 * Reads schedules/profiles/config from the store on every tick, so edits made
 * in the UI take effect without a restart.
 */
export function startScheduler(store, { fetcher, now = () => new Date(), log = console.log } = {}) {
  let fired = null
  let running = false

  const tick = async () => {
    if (running) return
    running = true
    try {
      const data = await store.read()
      if (fired === null) fired = { ...(data['sonos-scheduler-state'] || {}) }
      const due = findDue(data['sonos-schedules'], now(), fired)
      for (const { schedule, key } of due) {
        fired[key] = true   // mark first: never double-fire, even if apply fails
        const profile = (data['sonos-profiles'] || []).find((p) => p.id === schedule.profileId)
        const config = data['sonos-config']
        if (!profile || !config) { log(`[scheduler] skipped ${schedule.id}: missing profile or config`); continue }
        const r = await applyProfile(config, profile, fetcher)
        log(`[scheduler] "${profile.name}" → ${r.ok ? 'applied' : 'FAILED'} (${r.total - r.failures}/${r.total} commands)`)
        if (r.ok) {
          const prev = (data['sonos-profiles'] || []).find((p) => p.id === data['sonos-active-profile'])
          const entry = {
            id: `srv-${key}`,
            timestamp: Date.now(),
            type: 'schedule_fired',
            action: 'Schedule Fired',
            what: profile.name,
            before: prev?.name ?? null,
            after: profile.name,
          }
          data['sonos-active-profile'] = profile.id
          const log = [entry, ...(data['sonos-server-log'] || [])].slice(0, MAX_LOG)
          data['sonos-server-log'] = log
          await store.write({ 'sonos-active-profile': profile.id, 'sonos-server-log': log })
        }
      }
      if (due.length) {
        const keys = Object.keys(fired)
        if (keys.length > MAX_STATE_KEYS) keys.slice(0, keys.length - MAX_STATE_KEYS / 2).forEach((k) => delete fired[k])
        await store.write({ 'sonos-scheduler-state': fired })
      }
    } catch (e) {
      log('[scheduler] tick error:', e.message)
    } finally {
      running = false
    }
  }

  tick()
  const id = setInterval(tick, TICK_MS)
  return { stop: () => clearInterval(id), tick }
}
