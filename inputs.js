'use strict'

const fs = require('node:fs')
const path = require('node:path')

const BODY_FILE_LIMIT_BYTES = 65_000

// --- Raw inputs ------------------------------------------------------------------------------------------------------

function input(name, env = process.env) {
  return env[`INPUT_${name}`] ?? ''
}

// --- Primitive parsing ----------------------------------------------------------------------------------------------

function parsePositiveInteger(name, raw) {
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name.toLowerCase()} must be a positive integer, got ${JSON.stringify(raw)}`)
  }
  return n
}

// --- Pull request number --------------------------------------------------------------------------------------------

function eventPrNumber(env = process.env, fsImpl = fs) {
  const eventPath = env.GITHUB_EVENT_PATH
  if (!eventPath) return null

  let event
  try {
    event = JSON.parse(fsImpl.readFileSync(eventPath, 'utf8'))
  } catch (err) {
    throw new Error(`could not read GITHUB_EVENT_PATH ${JSON.stringify(eventPath)}: ${err.message}`, { cause: err })
  }

  const raw =
    event?.pull_request?.number ??
    (event?.issue?.pull_request ? event.issue.number : null) ??
    (event?.pull_request ? event.number : null)

  return raw ? parsePositiveInteger('PR-NUMBER', raw) : null
}

function prNumberInput(name, env = process.env, fsImpl = fs) {
  const raw = input(name, env).trim()
  if (raw) return parsePositiveInteger(name, raw)

  const inferred = eventPrNumber(env, fsImpl)
  if (inferred) return inferred

  throw new Error(`${name.toLowerCase()} input is required when the event payload has no pull request number`)
}

// --- Comment body ---------------------------------------------------------------------------------------------------

function containedPath(root, file) {
  const relative = path.relative(root, file)
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function bodyInput(env = process.env, fsImpl = fs) {
  const body = input('BODY', env)
  const bodyFile = input('BODY-FILE', env).trim()

  if (bodyFile && body.trim()) {
    throw new Error('body and body-file inputs are mutually exclusive')
  }
  if (!bodyFile) return body

  if (path.isAbsolute(bodyFile)) {
    throw new Error('body-file must be a relative path inside GITHUB_WORKSPACE')
  }

  const workspace = env.GITHUB_WORKSPACE || process.cwd()
  const file = path.resolve(workspace, bodyFile)
  try {
    const root = fsImpl.realpathSync(workspace)
    const resolved = fsImpl.realpathSync(file)
    if (!containedPath(root, resolved)) {
      throw new Error('resolved path is outside GITHUB_WORKSPACE')
    }

    const stat = fsImpl.statSync(resolved)
    if (!stat.isFile()) throw new Error('resolved path is not a regular file')
    if (stat.size > BODY_FILE_LIMIT_BYTES) {
      throw new Error(`file is ${stat.size} bytes, which exceeds the ${BODY_FILE_LIMIT_BYTES} byte limit`)
    }

    return fsImpl.readFileSync(resolved, 'utf8')
  } catch (err) {
    throw new Error(`body-file ${JSON.stringify(bodyFile)} could not be read: ${err.message}`, { cause: err })
  }
}

// --- Enumerated inputs ----------------------------------------------------------------------------------------------

function booleanInput(name, env = process.env) {
  const raw = input(name, env).trim().toLowerCase()
  if (!raw) return false
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new Error(`${name.toLowerCase()} must be "true" or "false", got ${JSON.stringify(raw)}`)
}

function modeInput(name, env = process.env) {
  const raw = input(name, env).trim().toLowerCase() || 'upsert'
  if (raw !== 'upsert' && raw !== 'create') {
    throw new Error(`${name.toLowerCase()} must be "upsert" or "create", got ${JSON.stringify(raw)}`)
  }
  return raw
}

function commentKeyInput(name, env = process.env) {
  const raw = input(name, env).trim() || 'default'
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(raw)) {
    throw new Error(
      `${name.toLowerCase()} "${raw}" is invalid -- use only letters, digits, hyphens, and underscores, starting with a letter or digit`,
    )
  }
  return raw
}

// --- Public API ------------------------------------------------------------------------------------------------------

function readInputs(env = process.env, fsImpl = fs) {
  return {
    token: input('GITHUB-TOKEN', env),
    prNumber: prNumberInput('PR-NUMBER', env, fsImpl),
    body: bodyInput(env, fsImpl),
    commentKey: commentKeyInput('COMMENT-KEY', env),
    mode: modeInput('MODE', env),
    skipUnchanged: booleanInput('SKIP-UNCHANGED', env),
  }
}

module.exports = {
  BODY_FILE_LIMIT_BYTES,
  input,
  eventPrNumber,
  prNumberInput,
  bodyInput,
  booleanInput,
  modeInput,
  commentKeyInput,
  readInputs,
}
