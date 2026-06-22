'use strict'

const https = require('node:https')
const { isGeneratedCommentBody } = require('./comment.js')

const REQUEST_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const MAX_COMMENT_PAGES = 10
const MAX_ERROR_BODY_CHARS = 500

// --- HTTP transport -------------------------------------------------------------------------------------------------

function githubApiBase() {
  const base = new URL(process.env.GITHUB_API_URL || 'https://api.github.com')
  if (base.protocol !== 'https:') throw new Error(`GITHUB_API_URL must use https, got ${base.protocol}`)
  return base
}

function requestOptions(method, path, token, payload) {
  const base = githubApiBase()
  const basePath = base.pathname.replace(/\/+$/, '')
  return {
    hostname: base.hostname,
    port: base.port || undefined,
    path: `${basePath}${path}`,
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'remark',
      ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
    },
  }
}

function summarizeErrorBody(raw) {
  const text = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return ''
  return text.length > MAX_ERROR_BODY_CHARS ? `${text.slice(0, MAX_ERROR_BODY_CHARS)}...` : text
}

function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined
    let settled = false
    const settle = (fn, value) => {
      if (settled) return
      settled = true
      fn(value)
    }
    const options = requestOptions(method, path, token, payload)

    const req = https.request(options, (res) => {
      const chunks = []
      let bytes = 0
      res.on('data', (c) => {
        bytes += c.length
        if (bytes > MAX_RESPONSE_BYTES) {
          req.destroy(new Error(`GitHub API ${method} ${path} response exceeded ${MAX_RESPONSE_BYTES} bytes`))
          return
        }
        chunks.push(c)
      })
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString()
        if (res.statusCode >= 400) {
          const summary = summarizeErrorBody(raw)
          settle(
            reject,
            new Error(`GitHub API ${method} ${path} --> HTTP ${res.statusCode}${summary ? `: ${summary}` : ''}`),
          )
          return
        }
        try {
          settle(resolve, raw ? JSON.parse(raw) : null)
        } catch (err) {
          settle(reject, new Error(`GitHub API ${method} ${path} returned invalid JSON: ${err.message}`))
        }
      })
    })

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`GitHub API ${method} ${path} timed out after ${REQUEST_TIMEOUT_MS}ms`))
    })
    req.on('error', (err) => settle(reject, err))
    if (payload) req.write(payload)
    req.end()
  })
}

// --- Comment discovery ----------------------------------------------------------------------------------------------

/** Fetches all comments for a PR, handling pagination. */
async function listComments(token, repo, prNumber, _request = request) {
  const comments = []
  let page = 1
  for (;;) {
    if (page > MAX_COMMENT_PAGES) {
      throw new Error(`PR comment scan exceeded ${MAX_COMMENT_PAGES} pages while looking for remark comment`)
    }
    const batch = await _request('GET', `/repos/${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`, token)
    if (!Array.isArray(batch) || batch.length === 0) return comments
    comments.push(...batch)
    if (batch.length < 100) return comments
    page++
  }
}

/**
 * Returns the login of the token's own identity, or null when it cannot be determined.
 *
 * The default Actions GITHUB_TOKEN is a GitHub App installation token. GET /user returns
 * HTTP 403 for installation tokens because an installation has no associated user, so the
 * login is treated as unknown rather than fatal and comment matching degrades to the
 * generated-comment shape plus a Bot author.
 */
async function getAuthenticatedLogin(token, _request = request) {
  let user
  try {
    user = await _request('GET', '/user', token)
  } catch {
    return null
  }
  if (!user || typeof user.login !== 'string' || !user.login) return null
  return user.login
}

/**
 * Decides whether a comment is one Remark previously generated for this marker.
 *
 * The comment must have the generated shape (root marker plus footer). When the token
 * identity is known it must also be the author; when it cannot be determined, matching is
 * restricted to Bot authors as a best-effort defense against marker spoofing by human users.
 */
function isOwnGeneratedComment(comment, marker, login) {
  if (!isGeneratedCommentBody(comment?.body, marker)) return false
  return login ? comment?.user?.login === login : comment?.user?.type === 'Bot'
}

/** Returns the first PR comment Remark previously generated for the marker, or null. */
async function findComment(token, repo, prNumber, marker, _request = request) {
  const login = await getAuthenticatedLogin(token, _request)
  const comments = await listComments(token, repo, prNumber, _request)
  return comments.find((c) => isOwnGeneratedComment(c, marker, login)) ?? null
}

// --- Comment writes -------------------------------------------------------------------------------------------------

/** Posts a new PR comment and returns the created comment object. */
function createComment(token, repo, prNumber, body, _request = request) {
  return _request('POST', `/repos/${repo}/issues/${prNumber}/comments`, token, { body })
}

/** Updates an existing comment by ID and returns the updated comment object. */
function updateComment(token, repo, commentId, body, _request = request) {
  return _request('PATCH', `/repos/${repo}/issues/comments/${commentId}`, token, { body })
}

module.exports = {
  request,
  requestOptions,
  listComments,
  getAuthenticatedLogin,
  isOwnGeneratedComment,
  findComment,
  createComment,
  updateComment,
  REQUEST_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  MAX_COMMENT_PAGES,
  MAX_ERROR_BODY_CHARS,
  summarizeErrorBody,
}
