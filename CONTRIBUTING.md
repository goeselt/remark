# Contributing to Remark

## Design

Pure Node.js standard library -- no runtime dependencies, no build step. `index.js` is committed as-is and referenced
directly by `action.yml` (`runs.using: node24`).

Remark has one job: write a pull request comment, either as a fresh comment or as an update to the comment identified by
`comment-key`. H1 headings in the incoming body are treated as independently replaceable sections so separate workflow
steps can share one generated comment.

| File          | Responsibility                                                                     |
| ------------- | ---------------------------------------------------------------------------------- |
| `action.yml`  | Public GitHub Action metadata: inputs, outputs, runtime, and branding.             |
| `index.js`    | Event adapter: input validation, comment-key lookup, create/update flow, outputs.  |
| `comment.js`  | Comment markers, section parsing/merging/rendering, footer, and size guard.        |
| `github.js`   | GitHub REST calls for listing, creating, and updating issue comments.              |
| `inputs.js`   | GitHub Action input parsing and validation.                                        |
| `workflow.js` | Workflow command escaping, logs, errors, warnings, and outputs.                    |
| `*.test.js`   | Unit tests with fake API/request boundaries; no network or real PR comment writes. |
| `README.md`   | User-facing examples, section model, input reference, and output reference.        |

Keep `index.js` boring. It should read as: parse inputs, resolve the repository, find or create the target comment,
write outputs, and set the exit code. Prefer moving formatting into `comment.js`, GitHub API behavior into `github.js`,
and Actions input/output details into `inputs.js` or `workflow.js`.

## Behavior Contract

Preserve these user-visible rules unless the change is intentional, documented, and tested:

- `upsert` finds the generated comment for `comment-key`; if none exists, it creates one.
- `create` always posts a new comment. It does not read or merge existing comments.
- `skip-unchanged` applies only to existing `upsert` comments and compares rendered content without the generated
  timestamp footer.
- `body` and `body-file` are mutually exclusive.
- `body-file` must resolve to a regular file inside `GITHUB_WORKSPACE`; absolute paths, traversal, and symlink escapes
  fail closed.
- `pr-number` is inferred from `pull_request` events and PR `issue_comment` events when the input is omitted.
- A `body` with no H1 headings replaces the whole generated comment body.
- A `body` with H1 headings replaces only matching H1 sections and preserves unrelated stored H1 sections.
- H2 and deeper headings belong to the nearest previous H1. They are not independently replaceable.
- Replacing an H1 replaces its nested H2+ content; omitted nested headings are deleted.
- Duplicate H1 slugs fail instead of guessing which section should win.
- Reserved marker syntax in incoming `body` fails closed: `<!-- remark:`, `<!-- section:`, and `<!-- /section:`.
- The action only reuses existing generated comments with the marker and footer it writes. It matches the
  `github-token`'s own login when that login is readable, and otherwise restricts to Bot authors (the default
  `GITHUB_TOKEN` is an installation token whose login `GET /user` cannot read).

## Test Map

Use the test files as the fastest way to rediscover the project after time away:

| Test file          | Contract covered                                                                  |
| ------------------ | --------------------------------------------------------------------------------- |
| `comment.test.js`  | Slugging, reserved markers, generated-comment shape, H1 parsing, merge rendering. |
| `github.test.js`   | GitHub API paths, pagination, scan limits, author matching, marker-squat defense. |
| `inputs.test.js`   | Action input parsing, PR-number inference, `body-file`, defaults, validation.     |
| `index.test.js`    | `upsert` and `create` orchestration, outputs, top-level validation.               |
| `workflow.test.js` | Workflow command escaping and output file writes.                                 |

## Maintainer Map

If you change:

- Comment marker syntax, H1 slugging, section merge behavior, footer text, or size limits, update `comment.js` and
  `comment.test.js`.
- GitHub REST behavior, pagination, request timeouts, response limits, or comment matching, update `github.js` and
  `github.test.js`.
- Inputs, defaults, `body-file`, PR-number inference, validation errors, output names, logs, or exit behavior, update
  `inputs.js`, `index.js`, `workflow.js`, their tests, `action.yml`, and usually `README.md`.
- Workflow command escaping or output writing, update `workflow.js` and `workflow.test.js`.
- Public usage examples or behavior guarantees, update `README.md`.
- Section ownership or replacement semantics, update `comment.js`, `comment.test.js`, readme, and
  `docs/section-hierarchy.md`.

## Invariants

- No runtime dependencies and no build step. This action should be easy to inspect from the checked-in source.
- Use the `github-token` input for every GitHub operation; do not read ambient token environment variables directly.
- Keep GitHub API calls bounded with explicit request timeouts and response-size limits.
- Keep GitHub API error messages concise; do not emit unbounded raw response bodies into workflow annotations.
- Keep PR comment scanning bounded; do not silently scan unbounded pages.
- Escape GitHub workflow-command values before writing annotations or logs.
- Keep generated markers stable: `<!-- remark:<comment-key> -->` identifies the target comment, and section markers
  identify replaceable H1 sections.
- Reuse only valid generated comments (marker plus footer); match the token's own login when it is readable and
  otherwise restrict to Bot authors. Do not identify comments by marker text alone.
- Preserve unrelated stored sections when updating a sectioned comment.
- Keep `skip-unchanged` comparison footer-insensitive; otherwise every run appears changed.
- Reject duplicate or empty section slugs instead of guessing which section should win.
- Reject incoming reserved marker syntax before rendering or merging.
- Validate `comment-key` before using it in a hidden marker.
- Keep `body-file` workspace-contained, regular-file-only, and size-checked before reading.
- Enforce the comment body size limit before calling the GitHub API.
- Remember that Remark rejects its own marker syntax, not arbitrary Markdown. Do not describe it as a Markdown
  sanitizer.
- Keep `github-token` inside the Node HTTPS request path. If this project ever shells out to `gh`, `git`, `curl`, or
  similar tools, add request-scoped token handling before doing so.
- Treat concurrent writes to the same `comment-key` as a known caller responsibility. Document workflow-level
  `concurrency` instead of hiding the read-merge-write model.
- Keep tests isolated from the network and from real repositories.

## Development Setup

- Node.js 20 or later

No dependencies to install.

## Local Verification

Fast path:

```bash
npm test
```

Lint:

```bash
docker pull ghcr.io/goeselt/pedant:latest
docker run --rm -v "$(pwd):/work" ghcr.io/goeselt/pedant:latest
```

## Submitting Changes

Commit messages and PR titles must follow [Conventional Commits](https://www.conventionalcommits.org/). The PR title is
validated automatically by `goeselt/intent` and determines the version bump on merge.
