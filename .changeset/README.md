# Changesets

Add one Markdown file for each user-visible Fleet change. The frontmatter
declares the semver bump for `@qredence/fleet`; the body becomes part of the
package changelog.

```md
---
"@qredence/fleet": patch
---

Describe the user-visible change.
```

Documentation-only, CI-only, and internal changes do not need a changeset;
the CI check classifies those paths as an explicit no-release path. The
CircleCI release-preparation job turns accumulated changesets into one version
pull request. Do not run `changeset publish` locally; CircleCI owns the
trusted npm publication.
