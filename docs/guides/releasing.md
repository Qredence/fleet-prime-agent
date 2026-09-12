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
4. After the release commit passes CI, the `release-publish` job is the production Smart Deployment: it plans a CircleCI deploy marker, publishes the immutable npm version, and creates the matching GitHub release.
5. Publication uses npm Trusted Publishing (CircleCI OIDC) plus the `github-release` context for the GitHub tag and assets. The job verifies package metadata and checksums, waits for registry visibility, then marks the CircleCI deployment `SUCCESS` or `FAILED`.

Each release lane has a serial group, publication waits for the verified CI artifact, and the guarded scripts handle reruns against the existing release version and artifact expectations. A successful publication is a CircleCI Smart Deployment of `@qredence/fleet` in `production`.

## One-time CircleCI and npm setup

Create these least-privilege contexts in CircleCI:

1. `release-automation`: `GITHUB_TOKEN` with only the repository permissions needed to create or update the release pull request. It is used only by `release-prepare`.
2. `github-release`: `GITHUB_TOKEN` with repository Contents read/write for the release tag, release, and two assets. It is used only after npm has been verified.
3. `npm-dist-tag-deploy`: `NPM_TOKEN` with only the scoped npm dist-tag permission needed to promote an already-published version to `latest`. Restrict it to this project and `main`.
4. `npm-dist-tag-rollback`: `NPM_TOKEN` with only the scoped npm dist-tag permission needed to restore `latest`. Restrict it to this project and `main`.

Restrict both contexts to this project and `main`; for the publishing context, also disallow SSH reruns with the CircleCI expression `pipeline.git.branch == "main" and not job.ssh.enabled`.

Before enabling either release job, verify the context metadata without printing secret values:

~~~bash
circleci context get release-automation --json
circleci context get github-release --json
~~~

Confirm that each response names only `GITHUB_TOKEN`, includes the `fleet-prime-agent` project restriction, and restricts the branch to `main`. Confirm that `github-release` also includes `not job.ssh.enabled`. The release-automation token needs only the repository Pull requests and Contents read/write access required to create the generated release PR; the publishing token needs Contents read/write for the tag, release, and assets.

Configure npm Trusted Publishing for `@qredence/fleet` with the CircleCI organization, project, pipeline-definition, context, and repository details from `.circleci/info.yml` and CircleCI Project Settings. Enable direct `npm publish` and do not use staged publishing in CI. npm's current Trusted Publisher UI always lists staged publishing as allowed; the editable control is direct publish. Do not store `NPM_TOKEN` for publication; the publish job uses the CircleCI OIDC exchange. Dist-tag promotion and rollback remain separate token-authenticated operations. npm package access should require trusted publishing and two-factor authentication as available.

The publish job uses the Node 22.23.2 LTS executor and pins npm 11.15.0. This is separate from the package's minimum runtime of Node 22.12.0 because npm trusted publishing requires npm 11.15.0 and Node 22.14.0 or later.

If a versioning commit passed validation before the publish configuration was fixed, manually trigger the `ci` workflow on `main` with the `release_retry=true` pipeline parameter. This guarded recovery switch sets `FORCE_RELEASE=1` only for that explicit run; it does not change normal release detection.

## Branch protection

Pull requests should report the CircleCI aggregate status `ci/circleci: ci-success`. Keep that status required on `main`.

## Failure and retry handling

Never republish a published version with a different tarball checksum. The publication script refuses that state. Investigate the artifact, tag, registry metadata, and job output; use the release workflow's retry path only after the expected version and checksum are confirmed.

Do not manually edit generated changelogs or release tags to bypass Changesets. If the release is not ready, fix the source change or release PR and let the guarded job run again.

## CircleCI Smart Deployments

npm publication is a CircleCI Smart Deployment, not a laptop `npm publish`. The Deploys timeline is the source of truth for what shipped:

<https://app.circleci.com/deploys/circleci/SomxVLJYMpo86z6XUrZBUq>

Each deploy records:

- component: `@qredence/fleet`
- environment: `production`
- version: the exact stable `@qredence/fleet` package version

`release-prepare` is not a production deployment. Only `release-publish` plans and updates the `fleet-release` marker around the npm/GitHub publication.

The project has three CircleCI pipeline definitions for this:

| Pipeline | Config | Role |
| --- | --- | --- |
| `fleet-prime-agent` | `.circleci/config.yml` | CI, Changesets prepare, and the production npm Smart Deployment (`release-publish`) |
| `fleet-prime-agent-deploy` | `.circleci/deploy.yml` | Deploys UI deploy pipeline: promote an already-published version to npm `latest` (`fleet-deploy` marker, `type: release` job) |
| `fleet-prime-agent-rollback` | `.circleci/rollback.yml` | Deploys UI rollback pipeline: restore npm `latest` to an older published version (`fleet-rollback` marker) |

The deploy pipeline validates the CircleCI current-version fence and target version before mutating the dist-tag. It never republishes a tarball.

Protection level is Smart Deployments **deploy tracking**: deploy markers plus the deploy and rollback pipelines. There is no `validation` block on the release job, so CircleCI does not run continuous validation or automatic rollback. Operators promote and roll back from the Deploys UI.

Manual rollback from that UI is equivalent to:

~~~bash
circleci deploy rollback <target-version> \
  --component @qredence/fleet \
  --environment production \
  --from <current-version> \
  --reason "<incident reason>"
~~~

The rollback pipeline verifies that npm `latest` still equals `<current-version>` and that `<target-version>` is an already-published older version before running `npm dist-tag add @qredence/fleet@<target-version> latest`. It never unpublishes or repackages an npm version. Publication, dist-tag promotion, and rollback share the `fleet-release-operations` serial group so they cannot race.

For a non-mutating rollback check, run the helper with `ROLLBACK_DRY_RUN=1` and a verified current/target pair. The helper still reads npm metadata and enforces the current-version fence and target validation, but skips `npm dist-tag add`.

## Rollback

Published npm versions are immutable. Do not unpublish a production version as a routine rollback. Use the CircleCI Deploys rollback control, which runs `.circleci/rollback.yml` and moves only the npm `latest` dist-tag.

If the Deploys UI cannot run, pause the release context, identify the last known-good stable version from the Deploys timeline, and move only `latest`:

~~~bash
npm dist-tag add @qredence/fleet@<known-good-version> latest
npm view @qredence/fleet dist-tags versions
~~~

Consumers pinned to the bad version are not rewritten, and existing local installs are unaffected. Fix the source, add a Changeset, and publish a new version after the incident. Record the incident, affected version, restored tag, and follow-up release in the GitHub release notes.

Runtime upgrades are a separate operation; follow `docs/guides/upstream-runtime.md` before releasing a new runtime pin.
