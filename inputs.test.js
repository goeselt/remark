'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  BODY_FILE_LIMIT_BYTES,
  eventPrNumber,
  prNumberInput,
  bodyInput,
  booleanInput,
  modeInput,
  commentKeyInput,
  readInputs,
} = require('./inputs.js')

function env(overrides = {}) {
  return {
    'INPUT_GITHUB-TOKEN': 'ghp_test',
    'INPUT_PR-NUMBER': '42',
    INPUT_BODY: '# Status\nOK',
    'INPUT_COMMENT-KEY': 'default',
    INPUT_MODE: 'upsert',
    'INPUT_SKIP-UNCHANGED': 'false',
    ...overrides,
  }
}

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remark-inputs-'))
  try {
    return fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// --- prNumberInput --------------------------------------------------------------------------------------------------

test('parsePositiveInteger rules apply to inferred PR numbers', () => {
  withTempDir((dir) => {
    const eventPath = path.join(dir, 'event.json')
    fs.writeFileSync(eventPath, JSON.stringify({ pull_request: { number: '1.5' } }))
    assert.throws(() => prNumberInput('PR-NUMBER', { GITHUB_EVENT_PATH: eventPath }), /must be a positive integer/)
  })
})

test('eventPrNumber reads pull_request.number from GITHUB_EVENT_PATH', () => {
  withTempDir((dir) => {
    const eventPath = path.join(dir, 'event.json')
    fs.writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 123 } }))
    assert.equal(eventPrNumber({ GITHUB_EVENT_PATH: eventPath }), 123)
  })
})

test('eventPrNumber reads issue.number for PR issue_comment events', () => {
  withTempDir((dir) => {
    const eventPath = path.join(dir, 'event.json')
    fs.writeFileSync(eventPath, JSON.stringify({ issue: { number: 124, pull_request: {} } }))
    assert.equal(eventPrNumber({ GITHUB_EVENT_PATH: eventPath }), 124)
  })
})

test('prNumberInput prefers explicit input over event payload', () => {
  withTempDir((dir) => {
    const eventPath = path.join(dir, 'event.json')
    fs.writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 123 } }))
    assert.equal(prNumberInput('PR-NUMBER', { 'INPUT_PR-NUMBER': '7', GITHUB_EVENT_PATH: eventPath }), 7)
  })
})

test('prNumberInput throws when no explicit or inferred PR number exists', () => {
  assert.throws(() => prNumberInput('PR-NUMBER', {}), /event payload has no pull request number/)
})

// --- bodyInput ------------------------------------------------------------------------------------------------------

test('bodyInput returns inline body when body-file is not set', () => {
  assert.equal(bodyInput({ INPUT_BODY: '# Status\nOK' }), '# Status\nOK')
})

test('bodyInput reads body-file relative to GITHUB_WORKSPACE', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, 'report.md'), '# Report\nOK')
    assert.equal(bodyInput({ 'INPUT_BODY-FILE': 'report.md', GITHUB_WORKSPACE: dir }), '# Report\nOK')
  })
})

test('bodyInput rejects absolute body-file paths', () => {
  assert.throws(() => bodyInput({ 'INPUT_BODY-FILE': '/etc/hostname' }), /relative path/)
})

test('bodyInput rejects body-file paths outside GITHUB_WORKSPACE', () => {
  withTempDir((dir) => {
    const parent = path.dirname(dir)
    fs.writeFileSync(path.join(parent, 'outside-report.md'), '# Outside')
    try {
      assert.throws(
        () => bodyInput({ 'INPUT_BODY-FILE': '../outside-report.md', GITHUB_WORKSPACE: dir }),
        /outside GITHUB_WORKSPACE/,
      )
    } finally {
      fs.rmSync(path.join(parent, 'outside-report.md'), { force: true })
    }
  })
})

test('bodyInput rejects symlinks that resolve outside GITHUB_WORKSPACE', () => {
  withTempDir((dir) => {
    const outside = path.join(os.tmpdir(), `remark-outside-${process.pid}.md`)
    fs.writeFileSync(outside, '# Outside')
    try {
      fs.symlinkSync(outside, path.join(dir, 'report.md'))
      assert.throws(() => bodyInput({ 'INPUT_BODY-FILE': 'report.md', GITHUB_WORKSPACE: dir }), /outside/)
    } finally {
      fs.rmSync(outside, { force: true })
    }
  })
})

test('bodyInput rejects directories', () => {
  withTempDir((dir) => {
    fs.mkdirSync(path.join(dir, 'report.md'))
    assert.throws(() => bodyInput({ 'INPUT_BODY-FILE': 'report.md', GITHUB_WORKSPACE: dir }), /regular file/)
  })
})

test('bodyInput rejects body-file larger than the byte limit', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, 'report.md'), 'x'.repeat(BODY_FILE_LIMIT_BYTES + 1))
    assert.throws(() => bodyInput({ 'INPUT_BODY-FILE': 'report.md', GITHUB_WORKSPACE: dir }), /byte limit/)
  })
})

test('bodyInput throws when body and body-file are both set', () => {
  assert.throws(() => bodyInput({ INPUT_BODY: 'inline', 'INPUT_BODY-FILE': 'report.md' }), /mutually exclusive/)
})

test('bodyInput throws when body-file cannot be read', () => {
  assert.throws(() => bodyInput({ 'INPUT_BODY-FILE': 'missing.md' }), /could not be read/)
})

// --- modeInput ------------------------------------------------------------------------------------------------------

test('booleanInput defaults to false when empty', () => {
  assert.equal(booleanInput('SKIP-UNCHANGED', {}), false)
})

test('booleanInput accepts true and false', () => {
  assert.equal(booleanInput('SKIP-UNCHANGED', { 'INPUT_SKIP-UNCHANGED': 'true' }), true)
  assert.equal(booleanInput('SKIP-UNCHANGED', { 'INPUT_SKIP-UNCHANGED': 'false' }), false)
})

test('booleanInput throws on invalid values', () => {
  assert.throws(() => booleanInput('SKIP-UNCHANGED', { 'INPUT_SKIP-UNCHANGED': 'yes' }), /must be "true" or "false"/)
})

test('modeInput accepts "upsert"', () => {
  assert.equal(modeInput('MODE', { INPUT_MODE: 'upsert' }), 'upsert')
})

test('modeInput accepts "create"', () => {
  assert.equal(modeInput('MODE', { INPUT_MODE: 'create' }), 'create')
})

test('modeInput is case-insensitive', () => {
  assert.equal(modeInput('MODE', { INPUT_MODE: 'UPSERT' }), 'upsert')
})

test('modeInput defaults to "upsert" when empty', () => {
  assert.equal(modeInput('MODE', {}), 'upsert')
})

test('modeInput throws on an invalid mode', () => {
  assert.throws(() => modeInput('MODE', { INPUT_MODE: 'replace' }), /must be "upsert" or "create"/)
})

// --- commentKeyInput ------------------------------------------------------------------------------------------------

test('commentKeyInput accepts a valid key', () => {
  assert.equal(commentKeyInput('COMMENT-KEY', { 'INPUT_COMMENT-KEY': 'my-key' }), 'my-key')
})

test('commentKeyInput accepts alphanumeric with underscores and hyphens', () => {
  assert.equal(commentKeyInput('COMMENT-KEY', { 'INPUT_COMMENT-KEY': 'key_1-a' }), 'key_1-a')
})

test('commentKeyInput defaults to "default" when empty', () => {
  assert.equal(commentKeyInput('COMMENT-KEY', {}), 'default')
})

test('commentKeyInput throws when key starts with a hyphen', () => {
  assert.throws(() => commentKeyInput('COMMENT-KEY', { 'INPUT_COMMENT-KEY': '-bad' }), /is invalid/)
})

test('commentKeyInput throws when key contains special characters', () => {
  assert.throws(() => commentKeyInput('COMMENT-KEY', { 'INPUT_COMMENT-KEY': 'bad key!' }), /is invalid/)
})

// --- readInputs -----------------------------------------------------------------------------------------------------

test('readInputs returns all parsed inputs', () => {
  const inputs = readInputs(env())
  assert.equal(inputs.token, 'ghp_test')
  assert.equal(inputs.prNumber, 42)
  assert.equal(inputs.body, '# Status\nOK')
  assert.equal(inputs.commentKey, 'default')
  assert.equal(inputs.mode, 'upsert')
  assert.equal(inputs.skipUnchanged, false)
})

test('readInputs uses default comment-key when not provided', () => {
  const inputs = readInputs(env({ 'INPUT_COMMENT-KEY': '' }))
  assert.equal(inputs.commentKey, 'default')
})

test('readInputs uses default mode when not provided', () => {
  const inputs = readInputs(env({ INPUT_MODE: '' }))
  assert.equal(inputs.mode, 'upsert')
})

test('readInputs parses skip-unchanged', () => {
  const inputs = readInputs(env({ 'INPUT_SKIP-UNCHANGED': 'true' }))
  assert.equal(inputs.skipUnchanged, true)
})

test('readInputs uses inferred PR number when pr-number input is empty', () => {
  withTempDir((dir) => {
    const eventPath = path.join(dir, 'event.json')
    fs.writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 55 } }))
    const inputs = readInputs(env({ 'INPUT_PR-NUMBER': '', GITHUB_EVENT_PATH: eventPath }))
    assert.equal(inputs.prNumber, 55)
  })
})

test('readInputs reads body from body-file', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, 'report.md'), '# Report\nOK')
    const inputs = readInputs(env({ INPUT_BODY: '', 'INPUT_BODY-FILE': 'report.md', GITHUB_WORKSPACE: dir }))
    assert.equal(inputs.body, '# Report\nOK')
  })
})

test('readInputs throws when pr-number is missing', () => {
  assert.throws(() => readInputs(env({ 'INPUT_PR-NUMBER': '' })), /pull request number/)
})
