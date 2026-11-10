# Releasing interaction-trace

## Migration gates and release policy

The migration target is **@todoist/interaction-trace@1.1.4**, public on npm and
**internal** on GitHub Packages. GitHub visibility is independent of repository
and npm visibility. Preserve the existing transferred GitHub package and its ACL.
The package has no runtime dependencies; its optional React peer remains
`^18.0.0 || ^19.0.0`, including the `/react` entry point.

Preparation is **WAITING_FOR_PUBLICATION**: `@todoist/tsconfig@2.0.2` must exist in
both registries before this draft can merge. The committed lockfile intentionally
retains its old, real registry resolution; no alias or invented integrity is a
substitute. After the tooling release, finalize in this same branch:

```sh
npm view @todoist/tsconfig@2.0.2 version dist --json --registry=https://registry.npmjs.org/
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm run build
node --test .github/scripts/*.test.mjs
```

Use `.node-version` (22.22.2) and a fresh dependency directory/cache. Verify the
upstream GitHub copy/access separately. The tooling producer's later formatter
consumer PR is not a prerequisite. Review and commit the actual generated lock;
rerun checks and update the existing draft before human merge.

Release-please remains the release policy. Explicit component `interaction-trace`
preserves `interaction-trace-v<version>` tags across the scope change. Source and
release manifest remain 1.1.3 until the normal release PR advances them. The
migration's `fix:` squash commit requests the next patch, 1.1.4. Before merging
that release PR, reconcile intervening changes: `feat:` means minor and breaking
changes mean major; notify downstream owners if the computed target changes.
Do not force 1.1.4 over a newer release, rewrite old tags, or repair old releases.

At preparation, source/GitHub release is 1.1.3, while old npm `latest` and GitHub
package versions stop at 1.1.0. This does not make 1.1.1–1.1.3 publication part of
the migration. The unrelated draft semantic-release PR #78 is not adopted.
Future releases continue from the normal manifest/component-tag baseline, rather
than a new scoped-tag history. C04's semantic-release reset does not apply.

## Workflow and access setup

Only authorized operators execute the commands below at cutover; none are
preparation checks. Do not dispatch or publish to rehearse. Merge gates:

- Organization rename complete; repository is `todoist/interaction-trace`.
- Actual upstream publication, finalized lock and fresh checks above.
- GitHub package remains **internal**, linked to `todoist/interaction-trace`.
  Preserve inheritance as intended and grant this publisher Write under Manage
  Actions access. Grant Read to `todoist/todoist-web`, `todoist/comms-web`, and
  `todoist/automations` where their scope routes through GitHub. Test their actual
  workflow tokens; org membership does not prove access.
- Create/protect the `package-release` environment with maintainer approval and
  **main-only** deployment branch policy before any publish dispatch. No such
  environment existed at preparation. Confirm Actions allowlists and protected
  tag rules; do not bypass them.
- For local GitHub reads use a classic PAT with `read:packages`, repository read
  access and any required SSO authorization. `GH_TOKEN` is used only by `gh` for
  repository/run evidence; `NODE_AUTH_TOKEN` is used only in isolated GitHub npm
  subprocesses. Neither enters npmjs subprocesses. Never paste values into logs.

Settings after rename:

- [Repository Actions](https://github.com/todoist/interaction-trace/settings/actions)
- [Environments](https://github.com/todoist/interaction-trace/settings/environments)
- [GitHub package settings](https://github.com/orgs/todoist/packages/npm/interaction-trace/settings)
- [npm package access/trusted publishing](https://www.npmjs.com/package/@todoist/interaction-trace/access)

Henning routes these actions to the existing package/GitHub administrators; the
D06 named assignment source was not available in the supplied evidence.

`release-please.yml` runs on main pushes and may create/update the normal release
PR. Its release-PR merge creates the normal tag/GitHub release and dispatches
`pack.yml` at that exact tag. **It does not publish to a registry.** `pack.yml`
uses GitHub-hosted `ubuntu-latest`, Node from `.node-version`, npm 11.21.2, and
read-only contents permission. It installs, checks, tests, builds and packs once,
with install/pack lifecycle scripts disabled. Artifact retention is 90 days or
the organization cap. Preserve the original download and checksums externally.

`publish.yml` is a separate main-only `workflow_dispatch`, serialized under
`interaction-trace-publication`, using `package-release`, `ubuntu-latest`, the
same Node/npm versions and `contents: read`, `actions: read`, `packages: write`,
`id-token: write`. It accepts a **successful original pack run ID**, stable
version, destination `npm|github|both`, and `latest|recovery`. There is no reusable
caller. It never installs/rebuilds the package or calculates another version.

## First real artifact and interactive npm publication

After the normal release PR/tag has been reviewed and merged, use its automatic
pack run. Only if no retained/published artifact exists may an authorized
maintainer request a new pack run:

```sh
gh workflow run pack.yml --repo todoist/interaction-trace --ref interaction-trace-v1.1.4
gh run list --repo todoist/interaction-trace --workflow pack.yml --json databaseId,headSha,headBranch,event,conclusion --limit 10
```

Do not repack to complete a partial publication. From the reviewed main checkout,
set these values from the real successful run, and obtain GitHub read credentials
through the existing secure authentication flow:

```sh
VERSION=1.1.4
PACK_RUN_ID=ACTUAL_SUCCESSFUL_PACK_RUN_ID
RELEASE_SHA=ACTUAL_40_CHARACTER_RUN_SHA
RELEASE_DIR=$(mktemp -d)
SOURCE_OUTPUT=$(mktemp)
GITHUB_REPOSITORY=todoist/interaction-trace SOURCE_RUN_ID="$PACK_RUN_ID" RELEASE_VERSION="$VERSION" GITHUB_OUTPUT="$SOURCE_OUTPUT" node .github/scripts/release-source.mjs run
cat "$SOURCE_OUTPUT"
gh run download "$PACK_RUN_ID" --repo todoist/interaction-trace --name "interaction-trace-$VERSION" --dir "$RELEASE_DIR"
node .github/scripts/release.mjs verify "$RELEASE_DIR" "$RELEASE_SHA" "$VERSION"
```

Check output `sha` equals `RELEASE_SHA`; retain the run URL, source SHA/ref,
`release.json` and `todoist-interaction-trace-1.1.4.tgz`. Back up the original ZIP
and its authenticated artifact metadata before expiry:

```sh
gh api "repos/todoist/interaction-trace/actions/runs/$PACK_RUN_ID/artifacts?per_page=100" > "$RELEASE_DIR/artifacts.json"
ARTIFACT_ID=$(node -e 'const d = require(process.argv[1]); const a = d.artifacts.filter(x => x.name === "interaction-trace-" + process.argv[2]); if (a.length !== 1) process.exit(1); console.log(a[0].id)' "$RELEASE_DIR/artifacts.json" "$VERSION")
gh api "repos/todoist/interaction-trace/actions/artifacts/$ARTIFACT_ID/zip" > "$RELEASE_DIR/retained.zip"
```
The source verifier checks
successful completed run, repository/head repository, exact workflow ID/path,
manual event, main/version-tag ref, exact normal release tag SHA and main
ancestry. Pack checkout is `github.sha`, never a separate moving source input.
`release.json` schema version 1 is supported. Later workflow maintenance does not
invalidate an original run: no equality with current workflow bytes is required.
Unsupported metadata requires reviewed compatible recovery tooling and the original
artifact, never a repack. `release.json` alone is not source evidence. Download only from that validated
run; the normal release tag must remain intact for later retries.

For the first npm identity, in an interactive terminal (with `GH_TOKEN` and
`NODE_AUTH_TOKEN` available for isolated GitHub read checks):

```sh
SOURCE_RUN_ID="$PACK_RUN_ID" node .github/scripts/release.mjs bootstrap "$RELEASE_DIR" "$RELEASE_SHA" "$VERSION" latest
```

This revalidates the source run and the selected artifact's run/SHA/name and
GitHub-provided SHA-256 ZIP digest. It downloads that archive and requires both
local files to equal its original bytes, preventing substitution with a rebuilt
tarball and self-declared metadata. It checks the exact version in **both** registries,
then runs interactive `npm login` and `npm publish` with terminal IO for both
2FA challenges. It repeats both-registry preflight after login. npm publication
uses the retained tarball, `--ignore-scripts --access=public --provenance=false`
and an isolated npmjs scope mapping/user/global configuration. No global npm
settings change; temporary login credentials are deleted afterwards.

A conflicting same-version copy blocks every write, even an npm-only bootstrap
or a GitHub-only retry. Network/auth errors fail closed. GitHub package-level
metadata must be readable before any registry write: an unreadable/hidden 404 is
an access/transfer blocker, not permission to create another package. Inspect
and restore the transferred internal package/access before continuing.

Complete the GitHub mirror using the original run:

```sh
gh workflow run publish.yml --repo todoist/interaction-trace --ref main -f source_run_id="$PACK_RUN_ID" -f version="$VERSION" -f destination=github -f dist_tag=latest
```

Retain the same artifact for every retry. After both copies exist, verify exact
integrities and tags with isolated registry configuration:

```sh
RELEASE_DIR="$RELEASE_DIR" RELEASE_SHA="$RELEASE_SHA" VERSION="$VERSION" node --input-type=module <<'JS'
import { verify, withRegistry, registryMetadata, assertSameArtifact } from './.github/scripts/release.mjs'
const release = verify(process.env.RELEASE_DIR, process.env.RELEASE_SHA, process.env.VERSION)
for (const destination of ['npm', 'github']) {
    withRegistry(destination, (run, registry) => {
        assertSameArtifact(registryMetadata(run, registry, `${release.name}@${release.version}`), release)
        console.log(destination, registryMetadata(run, registry, release.name, 'dist-tags'))
        const result = run(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', `${release.name}@${release.version}`])
        if (result.status !== 0) throw new Error(`${destination} fresh install failed`)
    })
}
JS
gh api orgs/todoist/packages/npm/interaction-trace --jq '{name,visibility,repository:.repository.full_name}'
```

Expect internal visibility and repository `todoist/interaction-trace`. These
isolated installs are deleted afterwards. Repeat GitHub access verification with
actual consumer workflow credentials in the three named repositories, then resume
their blocked consumer drafts and run their normal fresh installs/checks. No new-scope artifact, install, publication
or OIDC path was verified by preparation.

## Future releases, retries and recovery

After the real npm package exists, configure npm trusted publishing close to the
next real release: owner `todoist`, repository `interaction-trace`, workflow
**publish.yml**, environment **package-release**, direct npm publish enabled.
This uses GitHub-hosted runners, Node >=22.14 and npm >=11.5.1; the workflow pins
npm 11.21.2. New connections need a successful real publish within two days.
Until then record configured/unverified. Manual bootstrap does not validate OIDC.
Cross-run publication explicitly disables automatic provenance because the
publisher run can have a different SHA from the actual build.

For subsequent real releases with trust configured:

```sh
gh workflow run publish.yml --repo todoist/interaction-trace --ref main -f source_run_id="$PACK_RUN_ID" -f version="$VERSION" -f destination=both -f dist_tag=latest
```

For a partial failure, use the same command with the missing destination and
**original** run/version. Both registries are preflighted before each write;
identical existing copies are skipped, conflicting bytes fail. Do not bump,
rebuild, overwrite, or automatically promote an existing recovery-tag copy.

If a newer version is already `latest` in the missing destination, the default
path refuses to downgrade it. Use `-f dist_tag=recovery` explicitly to fill the
older mirror. Its owner records latest before/after and removes the temporary
recovery tag only after verification through isolated, authenticated dist-tag controls. For example, after confirming
`latest` is unchanged, a GitHub package maintainer with write credentials can run:

```sh
RELEASE_DIR="$RELEASE_DIR" RELEASE_SHA="$RELEASE_SHA" VERSION="$VERSION" SOURCE_RUN_ID="$PACK_RUN_ID" node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { verify, withRegistry, preflightRegistries, registryMetadata } from './.github/scripts/release.mjs'
import { verifyRetainedArtifact } from './.github/scripts/release-source.mjs'
const release = verify(process.env.RELEASE_DIR, process.env.RELEASE_SHA, process.env.VERSION)
verifyRetainedArtifact(process.env.SOURCE_RUN_ID, release, process.env.RELEASE_DIR)
preflightRegistries(release)
withRegistry('github', (run, registry) => {
    const before = registryMetadata(run, registry, release.name, 'dist-tags')
    assert.equal(before.recovery, release.version)
    const result = run(['dist-tag', 'rm', release.name, 'recovery', `--registry=${registry}`], { stdio: 'inherit' })
    if (result.status !== 0) throw new Error('Recovery tag cleanup failed')
    assert.equal(registryMetadata(run, registry, release.name, 'dist-tags').latest, before.latest)
})
JS
```

This cleanup is a later operator mutation, not a preparation check. This package has no `internal` release channel; GitHub
**internal visibility** is not a dist-tag.

For expired Actions artifacts, restore the original retained ZIP and extracted
files (never rebuild). Set `RETAINED_ARCHIVE_PATH` to that ZIP; the helper checks
it against GitHub's live immutable artifact digest and compares extracted bytes.
This requires the artifact metadata and original run/release evidence to remain
readable. A local JSON/digest receipt alone is not trusted evidence. An
authorized local operator can invoke the identical helper with GitHub write
credentials, in coordination with maintainers so no publication overlaps:

```sh
RETAINED_ARCHIVE_PATH="$RELEASE_DIR/retained.zip" SOURCE_RUN_ID="$PACK_RUN_ID" node .github/scripts/release.mjs publish "$RELEASE_DIR" "$RELEASE_SHA" "$VERSION" github recovery
```

If original bytes or trusted run/release evidence are unavailable, stop for a
maintainer decision. Recovery is not permission to republish another artifact
under the same version. Do not run manual bootstrap concurrently with a workflow.

References: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/),
[npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/),
[GitHub npm authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry),
[GitHub package permissions](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility).
