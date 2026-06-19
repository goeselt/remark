# Remark

GitHub Action that creates and updates pull request comments with stable Markdown section markers.

Use Remark when several workflow steps should share one PR comment without overwriting each other. The action finds a
comment by `comment-key`, updates it in place by default, and can merge independently replaceable sections from H1
headlines.

## Getting Started

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  pull-requests: write # create and update PR comments

jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - uses: goeselt/remark@v1
        with:
          comment-key: ci-report
          body: |
            # Tests

            All tests passed.
```

Remark stores a hidden marker in the generated comment:

```markdown
<!-- remark:ci-report -->
```

Subsequent runs with the same `comment-key` update that comment instead of creating a new one. When `body` contains H1
headlines, each H1 becomes a section; matching sections are replaced and unrelated stored sections are preserved. Remark
only reuses comments it recognizes as its own generated output -- the hidden marker plus timestamp footer, written by
the token's own login when that login is readable, or by a bot account otherwise. A plain user comment that merely
contains the marker is ignored.

```yaml
- uses: goeselt/remark@v1
  with:
    comment-key: ci-report
    body: |
      # Lint

      Pedant found no issues.

- uses: goeselt/remark@v1
  with:
    comment-key: ci-report
    body: |
      # Tests

      All tests passed.
```

The resulting comment contains both `Lint` and `Tests`. A later run that writes `# Tests` replaces only the `Tests`
section.

For append-only logs or audit trails, set `mode: create`.

```yaml
- uses: goeselt/remark@v1
  with:
    comment-key: deployment-log
    mode: create
    body: |
      Deployment preview is ready.
```

Use `body-file` when another step writes a larger Markdown report:

```yaml
- run: npm test -- --reporter markdown > report.md

- uses: goeselt/remark@v1
  with:
    comment-key: test-report
    body-file: report.md
```

## Inputs

| Input            | Default | Description                                                                        |
| ---------------- | ------- | ---------------------------------------------------------------------------------- |
| `github-token`   | token   | GitHub token for reading and writing PR comments.                                  |
| `pr-number`      | event   | Pull request number. Inferred from PR event payloads when omitted.                 |
| `body`           |         | Inline Markdown content to write. Mutually exclusive with `body-file`.             |
| `body-file`      |         | Path to a Markdown file to write, resolved from `GITHUB_WORKSPACE`.                |
| `comment-key`    | default | Identifier for the target comment. Use distinct keys for independent notes.        |
| `mode`           | upsert  | `upsert` updates or creates by `comment-key`; `create` always posts new.           |
| `skip-unchanged` | false   | Skip updating an existing `upsert` comment when only the footer timestamp changed. |

Set either `body` or `body-file`. If neither is set, the action fails before writing a comment.

`comment-key` may contain letters, digits, hyphens, and underscores, and must start with a letter or digit.

`pr-number` is inferred for pull request events. Set it only when the workflow event payload does not identify a pull
request, such as `workflow_dispatch` or `push`.

## Outputs

| Output        | Description                        |
| ------------- | ---------------------------------- |
| `comment-id`  | Numeric ID of the written comment. |
| `comment-url` | HTML URL of the written comment.   |

## Section Merging

Incoming H1 headlines are converted to lowercase ASCII slugs. For example, `# Test Results` becomes `test-results`. When
a headline has no ASCII text, Remark falls back to a stable codepoint slug, so a check-mark-only heading becomes
`h-2705`. Section slugs must be non-empty and unique within one `body`.

If an existing comment is found and the incoming `body` contains H1 sections, Remark preserves stored sections whose
slugs are not present in the incoming body. If the incoming `body` has no H1 headlines, the whole comment body is
replaced.

For the exact parent/child replacement model, including why a parent heading may delete omitted child headings, see the
[Section Hierarchy](docs/section-hierarchy.md) guide.

Set `skip-unchanged: true` to avoid rewriting an existing `upsert` comment when the rendered content is unchanged.

Fork pull requests may run with a read-only `GITHUB_TOKEN`, depending on repository and organization settings. If a
workflow can read the PR but cannot write the comment, pass a token with `issues: write` or `pull-requests: write`, or
run the commenting step from a trusted workflow.

Remark appends a visible timestamp footer and enforces GitHub's comment size limit before writing. For body file rules,
reserved markers, and parallel update guidance, see the [Section Hierarchy](docs/section-hierarchy.md) guide.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [LICENSE](LICENSE).
