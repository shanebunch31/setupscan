import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildRevisionDefine, resolveBuildRevision } from '../config/buildRevision.js'

test('build revision prefers a supplied generic GIT_COMMIT_SHA', () => {
  let readGit = false
  assert.equal(resolveBuildRevision('  supplied-sha  ', () => { readGit = true; return 'checkout-sha' }), 'supplied-sha')
  assert.equal(readGit, false)
})

test('build revision falls back to the current Git checkout when GIT_COMMIT_SHA is absent', () => {
  assert.equal(resolveBuildRevision(undefined, () => ' checkout-sha\n'), 'checkout-sha')
  assert.equal(resolveBuildRevision('', () => 'checkout-sha'), 'checkout-sha')
})

test('unavailable Git metadata returns null without throwing', () => {
  assert.equal(resolveBuildRevision(undefined, () => { throw new Error('Git metadata unavailable') }), null)
  assert.equal(resolveBuildRevision(undefined, () => '  '), null)
  assert.equal(resolveBuildRevision(undefined), null)
})

test('resolved build revision is mapped to VITE_GIT_COMMIT for Vite replacement', () => {
  assert.deepEqual(buildRevisionDefine('deployed-sha'), {
    'import.meta.env.VITE_GIT_COMMIT': '"deployed-sha"',
  })
  assert.deepEqual(buildRevisionDefine(null), {
    'import.meta.env.VITE_GIT_COMMIT': 'null',
  })
})
