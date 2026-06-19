'use strict'

const { readInputs } = require('./inputs.js')
const { buildCommentBody, rootMarker, sameGeneratedContent } = require('./comment.js')
const { findComment, createComment, updateComment } = require('./github.js')
const { log, fail, setOutput } = require('./workflow.js')

async function run(inputs, repo, api = null) {
  const _find = api?.find ?? findComment
  const _create = api?.create ?? createComment
  const _update = api?.update ?? updateComment

  if (!inputs.token) throw new Error('github-token input is empty')
  if (!inputs.body.trim()) throw new Error('body input is empty')
  if (!repo) throw new Error('GITHUB_REPOSITORY environment variable is not set')

  const marker = rootMarker(inputs.commentKey)
  log(`mode=${inputs.mode} key=${inputs.commentKey} pr=${inputs.prNumber}`)

  let comment
  if (inputs.mode === 'create') {
    const body = buildCommentBody(inputs.commentKey, inputs.body)
    comment = await _create(inputs.token, repo, inputs.prNumber, body)
    log('comment=created')
  } else {
    const existing = await _find(inputs.token, repo, inputs.prNumber, marker)
    const body = buildCommentBody(inputs.commentKey, inputs.body, existing?.body ?? null)

    if (existing) {
      if (inputs.skipUnchanged && sameGeneratedContent(existing.body, body)) {
        comment = existing
        log('comment=unchanged')
      } else {
        comment = await _update(inputs.token, repo, existing.id, body)
        log('comment=updated')
      }
    } else {
      comment = await _create(inputs.token, repo, inputs.prNumber, body)
      log('comment=created')
    }
  }

  setOutput('comment-id', String(comment.id))
  setOutput('comment-url', comment.html_url)
  log(`result=done comment-id=${comment.id}`)
}

async function main() {
  const inputs = readInputs()
  const repo = process.env.GITHUB_REPOSITORY ?? ''
  await run(inputs, repo)
}

if (require.main === module) {
  main().catch((err) => {
    fail(err.message)
    process.exit(1)
  })
}

module.exports = { main, run }
