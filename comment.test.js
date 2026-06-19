'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  COMMENT_BODY_LIMIT,
  slugify,
  parseSections,
  parseStoredSections,
  mergeSections,
  buildFooter,
  buildCommentBody,
  rootMarker,
  assertNoReservedMarkers,
  isGeneratedCommentBody,
  normalizeForComparison,
  sameGeneratedContent,
} = require('./comment.js')

const FIXED_DATE = new Date('2024-06-18T14:32:00Z')

// --- slugify --------------------------------------------------------------------------------------------------------

test('slugify converts uppercase to lowercase', () => {
  assert.equal(slugify('Status Report'), 'status-report')
})

test('slugify replaces spaces with hyphens', () => {
  assert.equal(slugify('my cool title'), 'my-cool-title')
})

test('slugify collapses multiple spaces', () => {
  assert.equal(slugify('a  b'), 'a-b')
})

test('slugify removes non-ASCII characters (umlauts)', () => {
  assert.equal(slugify('\u00dcberpr\u00fcfung'), 'berprfung')
})

test('slugify removes emoji', () => {
  assert.equal(slugify('Status \u{1f680}'), 'status')
})

test('slugify uses codepoint fallback when no ASCII text remains', () => {
  assert.equal(slugify('\u{1f680}'), 'h-1f680')
  assert.equal(slugify('!!!'), 'h-21-21-21')
})

test('slugify trims leading and trailing hyphens', () => {
  assert.equal(slugify('  hello  '), 'hello')
})

test('slugify returns empty string for empty input', () => {
  assert.equal(slugify(''), '')
  assert.equal(slugify(null), '')
})

test('slugify handles existing hyphens', () => {
  assert.equal(slugify('already-slugified'), 'already-slugified')
})

// --- parseSections --------------------------------------------------------------------------------------------------

test('parseSections returns null when no H1 headlines present', () => {
  assert.equal(parseSections('Just some text\n## Sub only'), null)
  assert.equal(parseSections(''), null)
  assert.equal(parseSections('no headlines here'), null)
})

test('parseSections returns a single section for one H1', () => {
  const sections = parseSections('# Status\nAll good')
  assert.deepEqual(sections, [{ slug: 'status', content: '# Status\nAll good' }])
})

test('parseSections includes H2+ content in the parent H1 section', () => {
  const sections = parseSections('# Status\nOK\n## Details\nMore info')
  assert.equal(sections.length, 1)
  assert.equal(sections[0].slug, 'status')
  assert.ok(sections[0].content.includes('## Details'))
})

test('parseSections returns multiple sections for multiple H1s', () => {
  const sections = parseSections('# Status\nOK\n# Results\nPassed')
  assert.deepEqual(sections, [
    { slug: 'status', content: '# Status\nOK' },
    { slug: 'results', content: '# Results\nPassed' },
  ])
})

test('parseSections trims trailing whitespace from each section content', () => {
  const sections = parseSections('# Status\nOK   \n\n')
  assert.equal(sections[0].content, '# Status\nOK')
})

test('parseSections supports a headline that only contains symbols', () => {
  const sections = parseSections('# \u{1f680}\u{1f680}\u{1f680}\nLaunched')
  assert.deepEqual(sections, [{ slug: 'h-1f680-1f680-1f680', content: '# \u{1f680}\u{1f680}\u{1f680}\nLaunched' }])
})

test('parseSections throws on a whitespace-only headline', () => {
  assert.throws(() => parseSections('#   '), /empty slug/)
})

test('parseSections throws on duplicate slugs', () => {
  assert.throws(() => parseSections('# Status\nA\n# Status\nB'), /duplicate section slug/)
})

test('parseSections treats a H1 with no following content as a valid section', () => {
  const sections = parseSections('# Status')
  assert.deepEqual(sections, [{ slug: 'status', content: '# Status' }])
})

// --- parseStoredSections --------------------------------------------------------------------------------------------

test('parseStoredSections returns empty array when no section markers present', () => {
  assert.deepEqual(parseStoredSections('no markers'), [])
  assert.deepEqual(parseStoredSections(''), [])
})

test('parseStoredSections parses a single stored section', () => {
  const body = '<!-- remark:default -->\n<!-- section:status -->\n# Status\nOK\n<!-- /section:status -->'
  assert.deepEqual(parseStoredSections(body), [{ slug: 'status', content: '# Status\nOK' }])
})

test('parseStoredSections parses multiple stored sections in order', () => {
  const body = [
    '<!-- remark:default -->',
    '<!-- section:status -->',
    '# Status',
    '<!-- /section:status -->',
    '<!-- section:results -->',
    '# Results',
    'Passed',
    '<!-- /section:results -->',
  ].join('\n')
  const sections = parseStoredSections(body)
  assert.equal(sections.length, 2)
  assert.equal(sections[0].slug, 'status')
  assert.equal(sections[1].slug, 'results')
})

test('parseStoredSections ignores mismatched open/close tags', () => {
  const body = '<!-- section:alpha -->\ncontent\n<!-- /section:beta -->'
  assert.deepEqual(parseStoredSections(body), [])
})

test('parseStoredSections handles multi-line section content', () => {
  const body = '<!-- section:report -->\nline1\nline2\nline3\n<!-- /section:report -->'
  assert.deepEqual(parseStoredSections(body), [{ slug: 'report', content: 'line1\nline2\nline3' }])
})

// --- mergeSections --------------------------------------------------------------------------------------------------

test('mergeSections replaces a stored section with an incoming one of the same slug', () => {
  const stored = [{ slug: 'status', content: 'old' }]
  const incoming = [{ slug: 'status', content: 'new' }]
  assert.deepEqual(mergeSections(stored, incoming), [{ slug: 'status', content: 'new' }])
})

test('mergeSections keeps stored sections that are not in incoming', () => {
  const stored = [
    { slug: 'status', content: 'A' },
    { slug: 'other', content: 'B' },
  ]
  const incoming = [{ slug: 'status', content: 'A updated' }]
  const result = mergeSections(stored, incoming)
  assert.equal(result.length, 2)
  assert.equal(result.find((s) => s.slug === 'other').content, 'B')
})

test('mergeSections appends incoming sections not present in stored', () => {
  const stored = [{ slug: 'status', content: 'A' }]
  const incoming = [{ slug: 'results', content: 'B' }]
  const result = mergeSections(stored, incoming)
  assert.equal(result.length, 2)
  assert.equal(result[1].slug, 'results')
})

test('mergeSections preserves the order of stored sections', () => {
  const stored = [
    { slug: 'b', content: 'B' },
    { slug: 'a', content: 'A' },
  ]
  const incoming = [{ slug: 'a', content: 'A updated' }]
  const result = mergeSections(stored, incoming)
  assert.deepEqual(
    result.map((s) => s.slug),
    ['b', 'a'],
  )
})

test('mergeSections handles empty stored', () => {
  const incoming = [{ slug: 'status', content: 'new' }]
  assert.deepEqual(mergeSections([], incoming), incoming)
})

// --- buildFooter ----------------------------------------------------------------------------------------------------

test('buildFooter produces a correctly formatted UTC timestamp', () => {
  const footer = buildFooter(FIXED_DATE)
  assert.equal(footer, '_Last updated: 2024-06-18 14:32 UTC - Generated by Remark_')
})

test('buildFooter zero-pads month, day, hour, and minute', () => {
  const footer = buildFooter(new Date('2024-01-05T09:04:00Z'))
  assert.ok(footer.includes('2024-01-05 09:04 UTC'))
})

test('sameGeneratedContent ignores only the generated footer timestamp', () => {
  const first = buildCommentBody('default', '# Status\nOK', null, new Date('2024-06-18T14:32:00Z'))
  const second = buildCommentBody('default', '# Status\nOK', null, new Date('2024-06-18T15:45:00Z'))
  const changed = buildCommentBody('default', '# Status\nChanged', null, new Date('2024-06-18T15:45:00Z'))

  assert.equal(sameGeneratedContent(first, second), true)
  assert.equal(sameGeneratedContent(first, changed), false)
  assert.ok(!normalizeForComparison(first).includes('Last updated'))
})

test('sameGeneratedContent accepts the legacy lowercase generated footer', () => {
  const current = buildCommentBody('default', '# Status\nOK', null, new Date('2024-06-18T14:32:00Z'))
  const legacy = current.replace('Generated by Remark', 'Generated by remark')

  assert.equal(sameGeneratedContent(current, legacy), true)
})

// --- buildCommentBody ------------------------------------------------------------------------------------------------

test('buildCommentBody includes the root marker', () => {
  const body = buildCommentBody('default', 'Hello world', null, FIXED_DATE)
  assert.ok(body.includes(rootMarker('default')))
})

test('isGeneratedCommentBody requires root marker as first line and generated footer', () => {
  const body = buildCommentBody('default', 'Hello world', null, FIXED_DATE)
  assert.equal(isGeneratedCommentBody(body, rootMarker('default')), true)
  assert.equal(isGeneratedCommentBody(`prefix\n${body}`, rootMarker('default')), false)
  assert.equal(isGeneratedCommentBody(rootMarker('default'), rootMarker('default')), false)
})

test('isGeneratedCommentBody accepts the legacy lowercase generated footer', () => {
  const body = buildCommentBody('default', 'Hello world', null, FIXED_DATE).replace(
    'Generated by Remark',
    'Generated by remark',
  )

  assert.equal(isGeneratedCommentBody(body, rootMarker('default')), true)
})

test('buildCommentBody includes the footer', () => {
  const body = buildCommentBody('default', 'Hello world', null, FIXED_DATE)
  assert.ok(body.includes('_Last updated: 2024-06-18 14:32 UTC - Generated by Remark_'))
})

test('buildCommentBody ends with the footer', () => {
  const body = buildCommentBody('default', 'Hello world', null, FIXED_DATE)

  assert.ok(body.endsWith('_Last updated: 2024-06-18 14:32 UTC - Generated by Remark_'))
})

test('buildCommentBody writes whole-body content when no H1 headlines', () => {
  const body = buildCommentBody('default', '## Sub only\nsome text', null, FIXED_DATE)
  assert.ok(body.includes('## Sub only'))
  assert.ok(!body.includes('<!-- section:'))
})

test('buildCommentBody wraps H1 sections in section markers when sections present', () => {
  const body = buildCommentBody('default', '# Status\nOK', null, FIXED_DATE)
  assert.ok(body.includes('<!-- section:status -->'))
  assert.ok(body.includes('<!-- /section:status -->'))
  assert.ok(body.includes('# Status'))
})

test('buildCommentBody uses the comment-key in the root marker', () => {
  const body = buildCommentBody('my-key', '# Test\ncontent', null, FIXED_DATE)
  assert.ok(body.includes('<!-- remark:my-key -->'))
})

test('buildCommentBody merges sections when existingBody is provided and has sections', () => {
  const existing = [
    '<!-- remark:default -->',
    '<!-- section:status -->',
    '# Status',
    'old',
    '<!-- /section:status -->',
    '<!-- section:results -->',
    '# Results',
    'Passed',
    '<!-- /section:results -->',
    '',
    '_Last updated: 2024-06-18 10:00 UTC - Generated by remark_',
  ].join('\n')

  const updated = buildCommentBody('default', '# Status\nnew', existing, FIXED_DATE)

  assert.ok(updated.includes('# Status\nnew'))
  assert.ok(updated.includes('# Results'))
  assert.ok(updated.includes('Passed'))
})

test('buildCommentBody replaces whole content when incoming has no H1s even if existing has sections', () => {
  const existing = '<!-- remark:default -->\n<!-- section:status -->\n# Status\nOK\n<!-- /section:status -->'
  const updated = buildCommentBody('default', 'plain text, no headings', existing, FIXED_DATE)
  assert.ok(!updated.includes('<!-- section:status -->'))
  assert.ok(updated.includes('plain text, no headings'))
})

test('buildCommentBody appends a new section to an existing comment with different sections', () => {
  const existing = [
    '<!-- remark:default -->',
    '<!-- section:status -->',
    '# Status',
    'OK',
    '<!-- /section:status -->',
    '',
    '_Last updated: ..._',
  ].join('\n')

  const updated = buildCommentBody('default', '# Results\nPassed', existing, FIXED_DATE)

  assert.ok(updated.includes('<!-- section:status -->'))
  assert.ok(updated.includes('<!-- section:results -->'))
})

test('buildCommentBody throws when body would exceed the size limit', () => {
  const huge = `# Section\n${'x'.repeat(COMMENT_BODY_LIMIT)}`
  assert.throws(() => buildCommentBody('default', huge, null, FIXED_DATE), /exceeds the/)
})

test('buildCommentBody rejects reserved remark markers in incoming body', () => {
  assert.throws(() => buildCommentBody('default', '<!-- remark:other -->'), /reserved remark marker/)
  assert.throws(() => buildCommentBody('default', '<!-- section:status -->'), /reserved remark marker/)
  assert.throws(() => buildCommentBody('default', '<!-- /section:status -->'), /reserved remark marker/)
})

test('assertNoReservedMarkers allows ordinary HTML comments', () => {
  assert.doesNotThrow(() => assertNoReservedMarkers('<!-- ordinary note -->'))
})

test('buildCommentBody creates fresh sections when existingBody is null', () => {
  const body = buildCommentBody('default', '# Status\nOK\n# Results\nDone', null, FIXED_DATE)
  const stored = require('./comment.js').parseStoredSections(body)
  assert.equal(stored.length, 2)
  assert.equal(stored[0].slug, 'status')
  assert.equal(stored[1].slug, 'results')
})
