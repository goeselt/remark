'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')
const { escapeWorkflowCommandValue, log, fail, warn, setOutput } = require('./workflow.js')

function captureStdout(fn) {
  const chunks = []
  const originalWrite = process.stdout.write
  process.stdout.write = (chunk) => {
    chunks.push(chunk)
    return true
  }
  try {
    fn()
  } finally {
    process.stdout.write = originalWrite
  }
  return chunks.join('')
}

test('escapeWorkflowCommandValue escapes percent, CR, and LF', () => {
  assert.equal(escapeWorkflowCommandValue('a%b\rc\nd'), 'a%25b%0Dc%0Ad')
})

test('log prefixes the message with [remark]', () => {
  const out = captureStdout(() => log('hello'))
  assert.equal(out, '[remark] hello\n')
})

test('log escapes workflow command control characters', () => {
  const out = captureStdout(() => log('line\n::warning::injected'))
  assert.equal(out, '[remark] line%0A::warning::injected\n')
})

test('fail emits a GitHub error annotation', () => {
  const out = captureStdout(() => fail('something broke'))
  assert.equal(out, '::error title=Remark::something broke\n')
})

test('warn emits a GitHub warning annotation', () => {
  const out = captureStdout(() => warn('take care'))
  assert.equal(out, '::warning title=Remark::take care\n')
})

test('setOutput writes name=value to GITHUB_OUTPUT file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remark-output-'))
  const outputFile = path.join(dir, 'out')
  setOutput('comment-id', '123', { GITHUB_OUTPUT: outputFile })
  assert.equal(fs.readFileSync(outputFile, 'utf8'), 'comment-id=123\n')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('setOutput is a no-op when GITHUB_OUTPUT is not set', () => {
  assert.doesNotThrow(() => setOutput('comment-id', '123', {}))
})
