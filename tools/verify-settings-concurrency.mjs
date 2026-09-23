import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-concurrency-'))
process.env.DSH_HOME = root
const host = await import('../index.js')
const routes = new Map()
const skills = new Map()
const disposers = []
const ctx = {
  get(name) {
    if (name === 'webServer') return { register(route) { routes.set(route.path, route.handler); return () => {} } }
    if (name === 'skills') return { register(skill) { skills.set(skill.name, skill); return () => skills.delete(skill.name) } }
  },
  effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) },
  inject() {},
}
function call(route, payload) {
  return new Promise((resolve, reject) => {
    const req = { method: 'PUT', on(event, callback) {
      if (event === 'data') callback(Buffer.from(JSON.stringify(payload)))
      if (event === 'end') callback()
      return this
    } }
    const res = { writeHead(status) { this.status = status }, end(text) { resolve({ status: this.status, body: JSON.parse(text) }) } }
    Promise.resolve(routes.get(route)(req, res)).catch(reject)
  })
}
try {
  const preset = host.standardCompositionCandidates()[0]
  fs.mkdirSync(path.dirname(preset), { recursive: true })
  fs.writeFileSync(preset, "- id: compaction-basic\n  name: '@deepseek-ai/dsh-compaction-basic'\n")
  const settingsFile = path.join(root, 'dsh-cache-control', 'settings.json')
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true })
  fs.writeFileSync(settingsFile, JSON.stringify(host.DEFAULTS))
  await host.apply(ctx)
  const results = await Promise.all([
    call('/cc/settings.json', { gateEnabled: true }),
    call('/cc/settings.json', { ponytailEnabled: true }),
    call('/cc/settings.json', { shapeEnabled: false }),
    call('/cc/review.json', { enabled: false }),
  ])
  assert(results.every(r => r.status === 200), 'all concurrent writes succeed')
  const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
  assert.equal(saved.gateEnabled, true, 'concurrent saves preserve the gate toggle')
  assert.equal(saved.ponytailEnabled, true, 'concurrent saves preserve the ponytail toggle')
  assert.equal(saved.shapeEnabled, false)
  assert.equal(saved.reviewSkillEnabled, false)
  const forged = await call('/cc/settings.json', { compactionBackup: { text: 'must not become preset content', at: 1 } })
  assert.equal(forged.status, 200)
  assert.equal(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).compactionBackup, null, 'backup is host-owned')
  await call('/cc/settings.json', { reviewSkillEnabled: true })
  assert(skills.has('auto-code-review'), 'main settings route must synchronize skill registration')
  const invalid = await call('/cc/settings.json', null)
  assert.equal(invalid.status, 400)
  assert.equal((await call('/cc/settings.json', { gateEnabled: false })).status, 200, 'failed mutation must not poison the queue')
  assert.equal(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).gateEnabled, false)
  assert(!fs.readdirSync(path.dirname(settingsFile)).some(n => n.endsWith('.tmp')), 'atomic save leaves no temporary file')
  console.log('PASS: concurrent settings/review saves retain all changes, protect backup and synchronize skills')
} finally {
  for (const dispose of disposers.reverse()) dispose()
  fs.rmSync(root, { recursive: true, force: true })
}
