import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = 'todoist/interaction-trace'
const workflowPath = '.github/workflows/pack.yml'
const tagName = (version) => `interaction-trace-v${version}`

export function validateSourceRun(run, workflowId, version, tagSha, compare) {
    assert.match(version, /^\d+\.\d+\.\d+$/)
    assert.equal(run.repository.full_name.toLowerCase(), repository)
    assert.equal(run.head_repository.full_name.toLowerCase(), repository)
    assert.equal(run.workflow_id, workflowId)
    assert.equal(run.path, workflowPath)
    assert.equal(run.event, 'workflow_dispatch')
    assert.equal(run.status, 'completed')
    assert.equal(run.conclusion, 'success')
    assert.match(run.head_sha, /^[a-f0-9]{40}$/)
    assert.ok(['main', tagName(version)].includes(run.head_branch), 'Untrusted source ref')
    assert.equal(run.head_sha, tagSha, 'Run must build the exact release tag commit')
    assert.ok(
        ['ahead', 'identical'].includes(compare(run.head_sha, 'main').status),
        'Source must be on reviewed main history',
    )
    // pack.yml checks out the event commit directly: no separate source input or moving ref.
    return {
        sha: run.head_sha,
        ref: run.head_branch === 'main' ? 'refs/heads/main' : `refs/tags/${run.head_branch}`,
    }
}

function api(path) {
    return JSON.parse(
        execFileSync('gh', ['api', `repos/${repository}/${path}`], { encoding: 'utf8' }),
    )
}

function releaseCommit(version) {
    const tag = tagName(version)
    const release = api(`releases/tags/${tag}`)
    assert.equal(release.tag_name, tag)
    assert.equal(release.draft, false)
    assert.equal(release.prerelease, false)
    return api(`commits/${tag}`).sha
}

export function verifySourceRun(
    runId,
    version,
    attempt = process.env.SOURCE_RUN_ATTEMPT ?? '1',
    readApi = api,
) {
    assert.match(runId, /^[1-9][0-9]*$/)
    assert.match(version, /^\d+\.\d+\.\d+$/)
    assert.match(attempt, /^[1-9][0-9]*$/)
    const run = readApi(`actions/runs/${runId}/attempts/${attempt}`)
    assert.equal(String(run.id), runId)
    assert.equal(String(run.run_attempt), attempt)
    const workflow = readApi('actions/workflows/pack.yml')
    const tag = tagName(version)
    const record = readApi(`releases/tags/${tag}`)
    assert.equal(record.tag_name, tag)
    assert.equal(record.draft, false)
    assert.equal(record.prerelease, false)
    return validateSourceRun(
        run,
        workflow.id,
        version,
        readApi(`commits/${tag}`).sha,
        (base, head) => readApi(`compare/${base}...${head}`),
    )
}

export function validateArtifactRecord(artifact, runId, release) {
    assert.equal(artifact.name, `interaction-trace-${release.version}`)
    assert.equal(String(artifact.workflow_run.id), runId)
    assert.equal(artifact.workflow_run.head_sha, release.sourceSha)
    assert.match(artifact.digest, /^sha256:[a-f0-9]{64}$/)
    assert.ok(Number.isSafeInteger(artifact.id) && artifact.id > 0)
}

export function verifyArtifactArchive(bytes, digest, directory, filename) {
    assert.equal(
        `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        digest,
        'Archive differs from the immutable GitHub artifact digest; never repack',
    )
    const temporary = mkdtempSync(join(tmpdir(), 'interaction-trace-source-'))
    try {
        const archive = join(temporary, 'artifact.zip')
        writeFileSync(archive, bytes)
        const files = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' })
            .trim()
            .split('\n')
            .sort()
        assert.deepEqual(files, [filename, 'release.json'].sort(), 'Unexpected artifact contents')
        for (const file of files) {
            assert.deepEqual(
                readFileSync(join(directory, file)),
                execFileSync('unzip', ['-p', archive, file], { maxBuffer: 32 * 1024 * 1024 }),
                `Local ${file} differs from the trusted run artifact`,
            )
        }
    } finally {
        rmSync(temporary, { recursive: true, force: true })
    }
}

export function verifyRetainedArtifact(runId, release, directory) {
    const attempt = process.env.SOURCE_RUN_ATTEMPT ?? String(release.sourceRunAttempt ?? 1)
    assert.equal(
        String(release.sourceRunAttempt ?? 1),
        attempt,
        'Select the original artifact attempt',
    )
    if (release.sourceRunId) assert.equal(release.sourceRunId, runId)
    const source = verifySourceRun(runId, release.version, attempt)
    assert.equal(release.sourceSha, source.sha)
    assert.equal(release.sourceRef, source.ref)
    const listing = api(`actions/runs/${runId}/artifacts?per_page=100`)
    assert.ok(listing.total_count <= 100, 'Ambiguous artifact listing')
    const matches = listing.artifacts.filter(
        (item) => item.name === `interaction-trace-${release.version}`,
    )
    assert.equal(
        matches.length,
        1,
        'Original artifact metadata unavailable; retain backups and seek maintainer recovery, never repack',
    )
    const artifact = matches[0]
    validateArtifactRecord(artifact, runId, release)
    // An archived original ZIP works after expiry if GitHub still retains its trusted
    // metadata. A self-declared release.json or local digest receipt is insufficient.
    const backup = process.env.RETAINED_ARCHIVE_PATH
    assert.ok(
        backup || !artifact.expired,
        'Original artifact expired; supply its retained ZIP, never repack',
    )
    const bytes = backup
        ? readFileSync(backup)
        : execFileSync('gh', ['api', `repos/${repository}/actions/artifacts/${artifact.id}/zip`], {
              maxBuffer: 32 * 1024 * 1024,
          })
    verifyArtifactArchive(bytes, artifact.digest, directory, release.filename)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    assert.equal(process.env.GITHUB_REPOSITORY?.toLowerCase(), repository)
    const [command] = process.argv.slice(2)
    if (command === 'pack') {
        const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
        const sha = process.env.GITHUB_SHA
        assert.match(sha, /^[a-f0-9]{40}$/)
        assert.ok(
            ['refs/heads/main', `refs/tags/${tagName(pkg.version)}`].includes(
                process.env.GITHUB_REF,
            ),
        )
        assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sha)
        assert.equal(
            releaseCommit(pkg.version),
            sha,
            'Only the normal release commit can be packed',
        )
        const comparison = api(`compare/${sha}...main`)
        assert.ok(
            ['ahead', 'identical'].includes(comparison.status),
            'Release source must be on main',
        )
    } else if (command === 'run') {
        const runId = process.env.SOURCE_RUN_ID
        const version = process.env.RELEASE_VERSION
        const source = verifySourceRun(runId, version)
        appendFileSync(process.env.GITHUB_OUTPUT, `sha=${source.sha}\nref=${source.ref}\n`)
        console.log(`Verified pack run ${runId} from reviewed release commit ${source.sha}`)
    } else throw new Error('Expected pack or run')
}
