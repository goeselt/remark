'use strict'

const { EventEmitter } = require('node:events')
const https = require('node:https')
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  request,
  listComments,
  getAuthenticatedLogin,
  findComment,
  createComment,
  updateComment,
  REQUEST_TIMEOUT_MS,
  MAX_ERROR_BODY_CHARS,
  MAX_COMMENT_PAGES,
  summarizeErrorBody,
} = require('./github.js')
const { buildCommentBody } = require('./comment.js')

const MARKER = '<!-- remark:default -->'
const FIXED_DATE = new Date('2024-06-18T14:32:00Z')
const LOGIN = 'github-actions[bot]'

function makeComment(id, body, login = LOGIN, type = 'Bot') {
  return { id, body, html_url: `https://github.com/owner/repo/pull/1#issuecomment-${id}`, user: { login, type } }
}

function generatedBody(text = 'hello') {
  return buildCommentBody('default', text, null, FIXED_DATE)
}

function mockFindRequest(pages) {
  let page = 0
  return (method, path) => {
    if (method === 'GET' && path === '/user') return Promise.resolve({ login: LOGIN })
    return Promise.resolve(pages[page++] ?? [])
  }
}

// Mimics the default installation GITHUB_TOKEN, for which GET /user returns HTTP 403.
function mockFindRequestNoUser(pages) {
  let page = 0
  return (method, path) => {
    if (method === 'GET' && path === '/user') return Promise.reject(new Error('HTTP 403'))
    return Promise.resolve(pages[page++] ?? [])
  }
}

// --- findComment ----------------------------------------------------------------------------------------------------

test('findComment returns null when no comments exist', async () => {
  const mockRequest = mockFindRequest([[]])
  const result = await findComment('token', 'owner/repo', 1, MARKER, mockRequest)
  assert.equal(result, null)
})

test('findComment returns the generated comment with the marker', async () => {
  const target = makeComment(42, generatedBody('some content'))
  const mockRequest = mockFindRequest([[makeComment(1, 'unrelated'), target]])
  const result = await findComment('token', 'owner/repo', 1, MARKER, mockRequest)
  assert.equal(result.id, 42)
})

test('findComment ignores marker squatting in non-generated comments', async () => {
  const target = makeComment(42, generatedBody('real bot content'))
  const mockRequest = mockFindRequest([[makeComment(1, `${MARKER}\nattacker content`, 'attacker'), target]])
  const result = await findComment('token', 'owner/repo', 1, MARKER, mockRequest)
  assert.equal(result.id, 42)
})

test('findComment ignores generated comments from a different author', async () => {
  const target = makeComment(42, generatedBody('real bot content'))
  const mockRequest = mockFindRequest([
    [makeComment(1, generatedBody('spoofed generated content'), 'attacker'), target],
  ])
  const result = await findComment('token', 'owner/repo', 1, MARKER, mockRequest)
  assert.equal(result.id, 42)
})

test('findComment returns null when no comment contains the marker', async () => {
  const mockRequest = mockFindRequest([[makeComment(1, 'no marker here')]])
  const result = await findComment('token', 'owner/repo', 1, MARKER, mockRequest)
  assert.equal(result, null)
})

test('findComment uses listComments and therefore handles pagination', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => makeComment(i + 1, 'no marker'))
  const page2 = [makeComment(101, generatedBody('content'))]
  const mockRequest = mockFindRequest([page1, page2])
  const result = await findComment('token', 'owner/repo', 1, MARKER, mockRequest)
  assert.equal(result.id, 101)
})

test('getAuthenticatedLogin returns the token login', async () => {
  const mockRequest = () => Promise.resolve({ login: LOGIN })
  await assert.doesNotReject(() => getAuthenticatedLogin('token', mockRequest))
  assert.equal(await getAuthenticatedLogin('token', mockRequest), LOGIN)
})

test('getAuthenticatedLogin returns null when GitHub omits login', async () => {
  const mockRequest = () => Promise.resolve({})
  assert.equal(await getAuthenticatedLogin('token', mockRequest), null)
})

test('getAuthenticatedLogin returns null when GET /user is inaccessible (installation token)', async () => {
  const mockRequest = () => Promise.reject(new Error('HTTP 403'))
  assert.equal(await getAuthenticatedLogin('token', mockRequest), null)
})

test('findComment matches a Bot author when the token identity is unknown', async () => {
  const human = makeComment(1, generatedBody('human spoof'), 'attacker', 'User')
  const target = makeComment(42, generatedBody('bot content'), LOGIN, 'Bot')
  const mockRequest = mockFindRequestNoUser([[human, target]])
  const result = await findComment('token', 'owner/repo', 1, MARKER, mockRequest)
  assert.equal(result.id, 42)
})

test('findComment ignores non-Bot generated comments when the token identity is unknown', async () => {
  const human = makeComment(1, generatedBody('human spoof'), 'attacker', 'User')
  const mockRequest = mockFindRequestNoUser([[human]])
  const result = await findComment('token', 'owner/repo', 1, MARKER, mockRequest)
  assert.equal(result, null)
})

// --- createComment --------------------------------------------------------------------------------------------------

test('createComment posts to the correct endpoint and returns the comment', async () => {
  let captured = null
  const mockRequest = (method, path, token, body) => {
    captured = { method, path, body }
    return Promise.resolve(makeComment(99, body.body))
  }
  const result = await createComment('token', 'owner/repo', 7, 'hello world', mockRequest)
  assert.equal(captured.method, 'POST')
  assert.ok(captured.path.includes('/repos/owner/repo/issues/7/comments'))
  assert.equal(captured.body.body, 'hello world')
  assert.equal(result.id, 99)
})

// --- updateComment --------------------------------------------------------------------------------------------------

test('updateComment patches the correct comment endpoint', async () => {
  let captured = null
  const mockRequest = (method, path, token, body) => {
    captured = { method, path, body }
    return Promise.resolve(makeComment(42, body.body))
  }
  const result = await updateComment('token', 'owner/repo', 42, 'updated body', mockRequest)
  assert.equal(captured.method, 'PATCH')
  assert.ok(captured.path.includes('/repos/owner/repo/issues/comments/42'))
  assert.equal(captured.body.body, 'updated body')
  assert.equal(result.id, 42)
})

// --- listComments ---------------------------------------------------------------------------------------------------

test('listComments returns all comments from a single page', async () => {
  const page = [makeComment(1, 'a'), makeComment(2, 'b')]
  let calls = 0
  const mockRequest = () => {
    calls++
    return Promise.resolve(page)
  }
  const result = await listComments('token', 'owner/repo', 1, mockRequest)
  assert.equal(calls, 1)
  assert.deepEqual(result, page)
})

test('listComments fetches subsequent pages when a full page of 100 is returned', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => makeComment(i + 1, 'body'))
  const page2 = [makeComment(101, 'last')]
  let calls = 0
  const mockRequest = () => Promise.resolve(calls++ === 0 ? page1 : page2)
  const result = await listComments('token', 'owner/repo', 1, mockRequest)
  assert.equal(calls, 2)
  assert.equal(result.length, 101)
})

test('listComments returns an empty array when the first page is empty', async () => {
  const mockRequest = () => Promise.resolve([])
  const result = await listComments('token', 'owner/repo', 1, mockRequest)
  assert.deepEqual(result, [])
})

test('listComments fails after the maximum scan depth', async () => {
  const fullPage = Array.from({ length: 100 }, (_, i) => makeComment(i + 1, 'body'))
  const mockRequest = () => Promise.resolve(fullPage)
  await assert.rejects(() => listComments('token', 'owner/repo', 1, mockRequest), /comment scan exceeded/)
  assert.equal(MAX_COMMENT_PAGES, 10)
})

// --- request --------------------------------------------------------------------------------------------------------

test('summarizeErrorBody normalizes whitespace and truncates long bodies', () => {
  const raw = `first\n\n${'x'.repeat(MAX_ERROR_BODY_CHARS + 20)}`
  const summary = summarizeErrorBody(raw)
  assert.ok(summary.startsWith('first x'))
  assert.ok(summary.endsWith('...'))
  assert.ok(summary.length <= MAX_ERROR_BODY_CHARS + 3)
})

test('request times out stalled GitHub API calls', async () => {
  const originalRequest = https.request
  let timeoutMs = 0
  let destroyedWith = null

  https.request = () => {
    const req = new EventEmitter()
    let onTimeout = () => {}

    req.setTimeout = (ms, callback) => {
      timeoutMs = ms
      onTimeout = callback
      return req
    }
    req.destroy = (err) => {
      destroyedWith = err
      req.emit('error', err)
      return req
    }
    req.end = () => onTimeout()
    req.write = () => {}

    return req
  }

  try {
    await assert.rejects(() => request('GET', '/slow', 'token'), /timed out after/)
    assert.equal(timeoutMs, REQUEST_TIMEOUT_MS)
    assert.match(destroyedWith.message, /timed out after/)
  } finally {
    https.request = originalRequest
  }
})

test('request rejects on HTTP 4xx responses', async () => {
  const originalRequest = https.request
  https.request = (options, callback) => {
    const req = new EventEmitter()
    req.setTimeout = () => req
    req.write = () => {}
    req.end = () => {
      const res = new EventEmitter()
      res.statusCode = 404
      callback(res)
      res.emit('data', Buffer.from('not found'))
      res.emit('end')
    }
    req.destroy = () => req
    return req
  }

  try {
    await assert.rejects(() => request('GET', '/missing', 'token'), /HTTP 404/)
  } finally {
    https.request = originalRequest
  }
})

test('request truncates long HTTP error bodies', async () => {
  const originalRequest = https.request
  https.request = (options, callback) => {
    const req = new EventEmitter()
    req.setTimeout = () => req
    req.write = () => {}
    req.end = () => {
      const res = new EventEmitter()
      res.statusCode = 500
      callback(res)
      res.emit('data', Buffer.from('x'.repeat(MAX_ERROR_BODY_CHARS + 100)))
      res.emit('end')
    }
    req.destroy = () => req
    return req
  }

  try {
    await assert.rejects(
      () => request('GET', '/failure', 'token'),
      (err) => err.message.includes('...') && err.message.length < MAX_ERROR_BODY_CHARS + 80,
    )
  } finally {
    https.request = originalRequest
  }
})
