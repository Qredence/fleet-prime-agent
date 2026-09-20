# Changesets

Add one Markdown file for each user-visible Fleet change. The frontmatter
declares the semver bump for `@qredence/fleet`; the body becomes part of the
package changelog.

Write the body for the people who will read it, not for a reviewer reading the
diff. It is published verbatim as the "What changed" section of the GitHub
release, with only the generated commit-hash prefix removed, so it is the
release note. Say what changed for a user and what they should do about it.

Create one interactively with `pnpm changeset`, select `@qredence/fleet`, and
choose the appropriate `patch`, `minor`, or `major` bump. Commit the generated
Markdown file with the change.

```md
---
"@qredence/fleet": patch
---

Describe the user-visible change, for a user rather than a reviewer.
Paragraphs are supported; leave a blank line between them.
```

Documentation-only, CI-only, and internal changes do not need a changeset;
the CI check classifies those paths as an explicit no-release path. The
CircleCI release-preparation job turns accumulated changesets into one version
pull request. Do not run `changeset publish` locally; CircleCI owns the
trusted npm publication.
