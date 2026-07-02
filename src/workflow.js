'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')

function escapeWorkflowCommandValue(value) {
  return String(value ?? '')
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')
}

function log(message) {
  process.stdout.write(`[remark] ${escapeWorkflowCommandValue(message)}\n`)
}

function fail(message) {
  process.stdout.write(`::error title=Remark::${escapeWorkflowCommandValue(message)}\n`)
}

function setOutput(name, value, env = process.env) {
  const outputFile = env.GITHUB_OUTPUT
  if (!outputFile) return
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(String(name))) {
    throw new Error(`invalid output name ${JSON.stringify(name)}`)
  }

  const text = String(value ?? '')
  if (!/[\r\n]/.test(text)) {
    fs.appendFileSync(outputFile, `${name}=${text}\n`)
    return
  }

  // Multiline values must use the heredoc format; a plain name=value line would let embedded newlines inject outputs.
  const delimiter = `ghadelimiter_${crypto.randomUUID()}`
  if (text.includes(delimiter)) {
    throw new Error(`output value for ${JSON.stringify(name)} contains the heredoc delimiter`)
  }
  fs.appendFileSync(outputFile, `${name}<<${delimiter}\n${text}\n${delimiter}\n`)
}

module.exports = { escapeWorkflowCommandValue, log, fail, setOutput }
