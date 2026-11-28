import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { profileDir } from '../../src/main/core/profile-dir.ts'

test('profileDir keeps an Arc Shell profile and otherwise uses the YARC one', (t) => {
  const appData = mkdtempSync(join(tmpdir(), 'yarc-appdata-'))
  t.after(() => rmSync(appData, { recursive: true, force: true }))

  assert.equal(profileDir(appData, 'YARC'), join(appData, 'YARC'))

  mkdirSync(join(appData, 'Arc Shell'))
  assert.equal(profileDir(appData, 'YARC'), join(appData, 'Arc Shell'))
  assert.equal(profileDir(appData, 'YARC (dev)'), join(appData, 'YARC (dev)'))

  mkdirSync(join(appData, 'YARC'))
  assert.equal(profileDir(appData, 'YARC'), join(appData, 'YARC'))
})
