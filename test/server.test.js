import test from 'node:test'
import assert from 'node:assert/strict'
import { findDue, buildCommands, startScheduler } from '../server/scheduler.js'
import { isAllowedProxyTarget, isTrustedRequest } from '../server/guards.js'

const sched = (o = {}) => ({ id: 's1', enabled: true, days: [1], time: '07:00', profileId: 'p1', ...o })
const monday = (h, m) => new Date(2026, 10, 9, h, m, 0) // Mon 9 Nov 2026

test('findDue: fires at the scheduled minute', () => {
  assert.equal(findDue([sched()], monday(7, 0), {}).length, 1)
})
test('findDue: not before, not on other days, not when disabled', () => {
  assert.equal(findDue([sched()], monday(6, 59), {}).length, 0)
  assert.equal(findDue([sched({ days: [2] })], monday(7, 0), {}).length, 0)
  assert.equal(findDue([sched({ enabled: false })], monday(7, 0), {}).length, 0)
})
test('findDue: catches up within grace window, not beyond', () => {
  assert.equal(findDue([sched()], monday(7, 4), {}).length, 1)
  assert.equal(findDue([sched()], monday(7, 6), {}).length, 0)
})
test('findDue: does not refire once marked', () => {
  const [d] = findDue([sched()], monday(7, 0), {})
  assert.equal(findDue([sched()], monday(7, 1), { [d.key]: true }).length, 0)
})
test('buildCommands: sub gain only when sub enabled; room is encoded', () => {
  const cfg = { host: '10.0.0.5', port: '5005', room: 'Living Room' }
  const on = buildCommands(cfg, { volume: 30, bass: 1, treble: 0, nightMode: true, speechEnhancement: false, subwooferEnabled: true, subwooferGain: 4 })
  const off = buildCommands(cfg, { volume: 30, bass: 1, treble: 0, subwooferEnabled: false })
  assert.ok(on.some((u) => u.endsWith('/Living%20Room/sub/gain/4')))
  assert.ok(!off.some((u) => u.includes('sub/gain')))
})
test('scheduler tick applies profile once and records state', async () => {
  let data = {
    'sonos-config': { host: '10.0.0.5', port: '5005', room: 'Den' },
    'sonos-profiles': [{ id: 'p1', name: 'Night', volume: 20, bass: 0, treble: 0, subwooferEnabled: false }],
    'sonos-schedules': [sched()],
  }
  const calls = []
  const store = { read: async () => data, write: async (p) => { data = { ...data, ...p } } }
  const s = startScheduler(store, { fetcher: async (u) => { calls.push(u); return { ok: true } }, now: () => monday(7, 0), log: () => {} })
  await new Promise((r) => setTimeout(r, 50))
  await s.tick(); await s.tick()
  s.stop()
  assert.equal(calls.length, 6)                       // applied exactly once
  assert.equal(data['sonos-active-profile'], 'p1')
})
test('proxy target allowlist', () => {
  for (const ok of ['http://192.168.1.20:5005/Den/state', 'http://localhost:5005/x', 'http://10.1.2.3:5005/x', 'http://sonos.local:5005/x'])
    assert.ok(isAllowedProxyTarget(ok), ok)
  for (const bad of ['http://example.com/x', 'https://192.168.1.2/x', 'http://169.254.169.254/latest', 'http://8.8.8.8/x', 'file:///etc/passwd', 'nonsense'])
    assert.ok(!isAllowedProxyTarget(bad), bad)
})
test('trusted request: blocks foreign Origin and rebinding Host', () => {
  assert.ok(isTrustedRequest({ headers: { host: 'localhost:3000' } }))
  assert.ok(isTrustedRequest({ headers: { host: '192.168.1.5:3000', origin: 'http://192.168.1.5:3000' } }))
  assert.ok(!isTrustedRequest({ headers: { host: 'localhost:3000', origin: 'https://evil.com' } }))
  assert.ok(!isTrustedRequest({ headers: { host: 'evil.com:3000' } }))
})

import { mergeLogEntries } from '../src/lib/mergeLog.js'

test('scheduler writes a log entry with the previous profile as "before"', async () => {
  let data = {
    'sonos-config': { host: '10.0.0.5', port: '5005', room: 'Den' },
    'sonos-profiles': [
      { id: 'p0', name: 'Music', volume: 50, bass: 0, treble: 0 },
      { id: 'p1', name: 'Night', volume: 20, bass: 0, treble: 0 },
    ],
    'sonos-active-profile': 'p0',
    'sonos-schedules': [sched()],
  }
  const store = { read: async () => data, write: async (p) => { data = { ...data, ...p } } }
  const s = startScheduler(store, { fetcher: async () => ({ ok: true }), now: () => monday(7, 0), log: () => {} })
  await new Promise((r) => setTimeout(r, 50))
  s.stop()
  const [e] = data['sonos-server-log']
  assert.equal(e.type, 'schedule_fired')
  assert.equal(e.what, 'Night')
  assert.equal(e.before, 'Music')
  assert.equal(data['sonos-server-log'].length, 1)
})
test('mergeLogEntries: dedupes by id, sorts newest first, returns same ref when nothing new', () => {
  const local = [{ id: '1', timestamp: 100 }]
  const same = mergeLogEntries(local, [{ id: '1', timestamp: 100 }])
  assert.equal(same, local)
  const merged = mergeLogEntries(local, [{ id: 'srv-a', timestamp: 200 }, { id: '1', timestamp: 100 }])
  assert.deepEqual(merged.map((e) => e.id), ['srv-a', '1'])
})

import { createStore } from '../server/store.js'
import os from 'os'
import fsp from 'fs/promises'
import pathMod from 'path'

test('store: concurrent writes to different keys are all kept', async () => {
  const dir = await fsp.mkdtemp(pathMod.join(os.tmpdir(), 'sonos-store-'))
  const store = createStore(pathMod.join(dir, 'data.json'))
  await Promise.all(['a', 'b', 'c', 'd', 'e'].map((k, i) => store.write({ [k]: i })))
  assert.deepEqual(await store.read(), { a: 0, b: 1, c: 2, d: 3, e: 4 })
  await fsp.rm(dir, { recursive: true })
})
