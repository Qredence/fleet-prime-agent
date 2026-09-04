# Releasing Fleet

Fleet releases publish the `@qredence/fleet` launcher/distribution package and its GitHub release artifacts. The package version is read from `packages/fleet-web/package.json`; Changesets owns versioning and release notes.

## Before the release PR

For a user-visible package change, add a Changeset. Documentation-only, CI-only, and internal changes that do not affect the published package do not need one.

Run the checks relevant to the change, normally:

~~~bash
pnpm run check
pnpm run check:changeset
pnpm run test:release
~~~

Packaging changes should also pass:

~~~bash
pnpm run build:web:release
pnpm run check:package
pnpm run check:web:release
~~~

Do not publish or create a release as a local validation step.

## Automated release flow

1. Changes land on `main` with the required CI checks green.
2. The `release-prepare` job runs with the release-automation credentials, computes the next version, and runs `pnpm run release:prepare`. It creates or reuses the Changesets release pull request.
3. Review and merge the generated release pull request through the normal protected-branch process.
4. After the release commit passes CI, the `release-publish` job builds or consumes the verified package artifact and runs `pnpm run release:publish`.
5. Publication uses the repository's configured npm/GitHub release credentials, verifies package metadata and checksums, publishes the immutable npm version, waits for registry visibility, and creates the matching GitHub release with the package artifact and checksums.

Each release lane has a serial group, publication waits for the verified CI artifact, and the guarded scripts handle reruns against the existing release version and artifact expectations.

## One-time CircleCI and npm setup

Create these least-privilege contexts in CircleCI:

1. `release-automation`: `GITHUB_TOKEN` with only the repository permissions needed to create or update the release pull request. It is used only by `release-prepare`.
2. `github-release`: `GITHUB_TOKEN` with repository Contents read/write for the release tag, release, and two assets. It is used only after npm has been verified.

Restrict both contexts to this project and `main`; for the publishing context, also disallow SSH reruns with the CircleCI expression `pipeline.git.branch == "main" and not job.ssh.enabled`.

Before enabling either release job, verify the context metadata without printing secret values:

~~~bash
circleci context get release-automation --json
circleci context get github-release --json
~~~

Confirm that each response names only `GITHUB_TOKEN`, includes the `fleet-prime-agent` project restriction, and restricts the branch to `main`. Confirm that `github-release` also includes `not job.ssh.enabled`. The release-automation token needs only the repository Pull requests and Contents read/write access required to create the generated release PR; the publishing token needs Contents read/write for the tag, release, and assets.

Configure npm Trusted Publishing for `@qredence/fleet` with the CircleCI organization, project, pipeline-definition, and repository details from `.circleci/info.yml` and CircleCI Project Settings. Bind it to the release project/context as supported by npm. Do not store `NPM_TOKEN`; the publish job uses the CircleCI OIDC exchange. npm package access should require trusted publishing and two-factor authentication as available.

The publish job uses the Node 22.23.2 LTS executor and pins npm 11.15.0. This is separate from the package's minimum runtime of Node 22.12.0 because npm trusted publishing requires npm 11.15.0 and Node 22.14.0 or later.

If a versioning commit passed validation before the publish configuration was fixed, manually trigger the `ci` workflow on `main` with the `release_retry=true` pipeline parameter. This guarded recovery switch sets `FORCE_RELEASE=1` only for that explicit run; it does not change normal release detection.

## Branch protection rollout

After this configuration is pushed, prove a pull request reports the CircleCI aggregate status `ci/circleci: ci-success`. Then make that status required on `main` and remove the obsolete GitHub Actions `build-check-test` requirement. Do this only after the proof run; repository files cannot change GitHub's branch-protection settings.

## Failure and retry handling

Never republish a published version with a different tarball checksum. The publication script refuses that state. Investigate the artifact, tag, registry metadata, and job output; use the release workflow's retry path only after the expected version and checksum are confirmed.

Do not manually edit generated changelogs or release tags to bypass Changesets. If the release is not ready, fix the source change or release PR and let the guarded job run again.

## Rollback

Published npm versions are immutable. Do not unpublish a production version as a routine rollback. First pause the release context and identify the last known-good stable version, then move only the `latest` dist-tag:

~~~bash
npm dist-tag add @qredence/fleet@<known-good-version> latest
npm view @qredence/fleet dist-tags versions
~~~

Consumers pinned to the bad version are not rewritten, and existing local installs are unaffected. Fix the source, add a Changeset, and publish a new version after the incident. Record the incident, affected version, restored tag, and follow-up release in the GitHub release notes.

Runtime upgrades are a separate operation; follow `docs/guides/upstream-runtime.md` before releasing a new runtime pin.
