# Releasing Fleet

Fleet publishes one public package, `@qredence/fleet`, from the
`packages/fleet-prime` workspace. The checked-in package manifest is the
source of truth for its version. The current public baseline is `0.5.0`; the
bootstrap Changeset in this repository makes the first automated release
`0.5.1`.

The upstream engine version is pinned in `PRIME_AGENT_RUNTIME.json`. Fleet
does not vendor or republish that engine; it consumes the checksum-pinned
upstream tarballs declared in `packages/fleet-prime/package.json`.

## Release flow

1. For a user-visible package change, add a Markdown file under `.changeset/`
   with a `patch`, `minor`, or `major` bump for `@qredence/fleet`.
2. Open a pull request to `main`. CircleCI must pass `ci-success`, including
   build/check, web JUnit tests, and the Linux and macOS packed-artifact
   installs.
3. After the change PR merges, CircleCI's serialized `release-prepare` job
   derives the planned version into `FLEET_RELEASE_VERSION`, runs
   `changeset status`, then creates or reuses one
   `release/fleet-vX.Y.Z` pull request. It commits the `changeset version`
   result through the GitHub API, including the package manifest and
   generated changelog.
4. Review and merge the release pull request. Its versioned commit must pass
   the same CircleCI aggregate status.
5. The main-branch `release-publish` job recognizes the versioning commit,
   attaches the already verified tarball, and checks that the stable version
   is unpublished and newer than npm `latest`.
6. CircleCI obtains a short-lived npm trusted-publishing credential through
   OIDC, publishes the exact tarball, waits for registry visibility, and
   compares the registry tarball SHA-256 with the CI artifact.
7. After npm verification, the job creates `vX.Y.Z` at `CIRCLE_SHA1`, verifies
   that the tag resolves to that exact commit, and creates or reuses the
   GitHub release with the tarball and `SHA256SUMS`.

Stable `latest` releases are the only supported channel. Do not create a
release tag manually and do not run `changeset publish` locally. A rerun after
a successful npm publish verifies the immutable version and completes GitHub
release assets without publishing the version again.

## Local validation

Use the repository's pnpm workspace for development:

```bash
pnpm install
pnpm run build:web:release
pnpm run check
pnpm run test:release
pnpm run check:package --out-dir dist-release
```

`check:package` builds no code itself. It expects the generated
`packages/fleet-prime/dist/web/launcher.mjs`, inspects the npm dry-run file
list and final tarball, installs that exact tarball into an isolated global
npm prefix, starts the real server, probes its HTTP surface, and runs the
`fleet-agent agent --help` upstream handoff. It rejects source, test, and
development files outside the package allowlist.

To inspect the pending release without consuming its Changeset:

```bash
pnpm exec changeset status
pnpm run release:prepare --dry-run
```

Run `changeset version` only in a disposable branch or worktree when you need
to inspect the generated version and changelog. The CircleCI release-preparation
job is the owner of the release PR.

## Supported installation contract

The npm package supports macOS (`darwin`) and Linux (`linux`) on Node.js
22.12.0 or later. Windows is intentionally unsupported and is excluded in the
package manifest. Python 3.10 or later is required for the managed IPython
kernel. Source installation remains available through `fleet-prime.sh`, but
npm installation is the production distribution path.

The package exposes both `fleet-agent` and `fleet-prime`. The command
`fleet-agent agent` continues to hand off to the upstream Prime Agent CLI.
Runtime imports in the bundled server must either be included in the bundle or
listed as direct production dependencies of `@qredence/fleet`; transitive
workspace dependencies are not a runtime contract.

## One-time CircleCI and npm setup

Create these least-privilege contexts in CircleCI:

1. `release-automation`: `GITHUB_TOKEN` with only the repository permissions
   needed to create or update the release pull request. It is used only by
   `release-prepare`.
2. `github-release`: `GITHUB_TOKEN` with repository Contents read/write for
   the release tag, release, and two assets. It is used only after npm has
   been verified.

Restrict both contexts to this project and `main`; for the publishing context,
also disallow SSH reruns with the CircleCI expression
`pipeline.git.branch == "main" and not job.ssh.enabled`.

Before enabling either release job, verify the context metadata in CircleCI
without attempting to print secret values:

```bash
circleci context get release-automation --json
circleci context get github-release --json
```

Confirm that each response names only `GITHUB_TOKEN`, includes the
`fleet-prime-agent` project restriction, and restricts the branch to `main`.
Confirm that `github-release` also includes `not job.ssh.enabled`. The
release-automation token needs only repository Pull requests and Contents
read/write access required to create the generated release PR; the publishing
token needs Contents read/write for the tag, release, and assets.

Configure npm Trusted Publishing for `@qredence/fleet` with the CircleCI
organization, project, pipeline-definition, and repository details from
`.circleci/info.yml` and CircleCI Project Settings. Bind it to the release
project/context as supported by npm. Do not store `NPM_TOKEN`; the publish job
uses the CircleCI OIDC exchange. npm's package access should require trusted
publishing (and two-factor authentication as available).

The publish job uses the Node 22.23.2 LTS executor and pins npm 11.15.0. This
is separate from the package's minimum runtime of Node 22.12.0 because npm
trusted publishing requires npm 11.15.0 and Node 22.14.0 or later.

The `nightly` workflow in `.circleci/config.yml` is a scheduled health check.
Configure the corresponding CircleCI schedule for `main` if the project is
using schedule triggers. It runs the supported Node LTS validation lane plus
the Node 22.12.0 Linux/macOS artifact smoke lanes. Cache changes should be
based on CircleCI Insights: retain the lockfile-keyed pnpm-store cache only
when its restore-to-save ratio is at least 10:1, and keep a single cache
writer.

Smart Deployments is deliberately not a publish gate. Fleet has no monitored
hosted deployment or safe automatic rollback target for an npm artifact; it
will be reconsidered when such a deployment exists.

## Branch protection rollout

After this configuration is pushed, prove a pull request reports the CircleCI
aggregate status `ci/circleci: ci-success`. Then make that status required on
`main` and remove the obsolete GitHub Actions `build-check-test` requirement.
Do this only after the proof run; the repository files cannot change GitHub's
branch-protection settings.

## Rollback

Published npm versions are immutable. Do not unpublish a production version
as a routine rollback. First pause the release context and identify the last
known-good stable version, then move only the `latest` dist-tag:

```bash
npm dist-tag add @qredence/fleet@<known-good-version> latest
npm view @qredence/fleet dist-tags versions
```

Consumers pinned to the bad version are not rewritten, and existing local
installs are unaffected. Fix the source, add a Changeset, and publish a new
version after the incident. Record the incident, affected version, restored
tag, and follow-up release in the GitHub release notes.

## Runtime upgrades

Upgrade the pinned upstream runtime only through the documented runtime
workflow. Update `PRIME_AGENT_RUNTIME.json`, install with pnpm, run the runtime
and adapter checks, rebuild the release bundle, and rerun the packed-artifact
verification. Never copy the upstream source tree into this repository.
