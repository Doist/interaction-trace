import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
    validateArtifactRecord,
    validateSourceRun,
    verifyArtifactArchive,
    verifySourceRun,
} from './release-source.mjs'

const sha = 'a'.repeat(40)
const run = {
    repository: { full_name: 'todoist/interaction-trace' },
    head_repository: { full_name: 'todoist/interaction-trace' },
    workflow_id: 123,
    path: '.github/workflows/pack.yml',
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
    head_branch: 'interaction-trace-v1.1.4',
    head_sha: sha,
}
const reviewed = () => ({ status: 'ahead' })

test('accepts exact normal release tag or main run on reviewed history', () => {
    assert.deepEqual(validateSourceRun(run, 123, '1.1.4', sha, reviewed), {
        sha,
        ref: 'refs/tags/interaction-trace-v1.1.4',
    })
    assert.equal(
        validateSourceRun({ ...run, head_branch: 'main' }, 123, '1.1.4', sha, reviewed).ref,
        'refs/heads/main',
    )
})

test('rejects PR artifacts, foreign repositories, wrong workflow and unsuccessful runs', () => {
    for (const patch of [
        { event: 'pull_request' },
        { event: 'push' },
        { repository: { full_name: 'fork/interaction-trace' } },
        { head_repository: { full_name: 'fork/interaction-trace' } },
        { workflow_id: 456 },
        { path: '.github/workflows/untrusted.yml' },
        { conclusion: 'failure' },
        { status: 'in_progress' },
        { head_branch: 'feature' },
        { head_branch: 'interaction-trace-v1.1.3' },
    ])
        assert.throws(() => validateSourceRun({ ...run, ...patch }, 123, '1.1.4', sha, reviewed))
})

test('rejects a declared build SHA different from the run/tag or outside main ancestry', () => {
    assert.throws(
        () => validateSourceRun(run, 123, '1.1.4', 'b'.repeat(40), reviewed),
        /exact release tag commit/,
    )
    for (const status of ['behind', 'diverged']) {
        assert.throws(
            () => validateSourceRun(run, 123, '1.1.4', sha, () => ({ status })),
            /reviewed main history/,
        )
    }
})

test('local tarballs must equal the selected immutable run artifact, not self-declared hashes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'interaction-trace-archive-test-'))
    const filename = 'todoist-interaction-trace-1.1.4.tgz'
    const release = { filename, version: '1.1.4', sourceSha: sha }
    try {
        writeFileSync(join(directory, filename), 'original synthetic bytes')
        writeFileSync(join(directory, 'release.json'), JSON.stringify(release))
        const archive = join(directory, 'original.zip')
        execFileSync('zip', ['-q', archive, filename, 'release.json'], { cwd: directory })
        const bytes = readFileSync(archive)
        const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
        const artifact = {
            id: 456,
            name: 'interaction-trace-1.1.4',
            workflow_run: { id: 123, head_sha: sha },
            digest,
        }
        validateArtifactRecord(artifact, '123', release)
        verifyArtifactArchive(bytes, digest, directory, filename)
        assert.throws(() => validateArtifactRecord(artifact, '789', release))
        assert.throws(() =>
            validateArtifactRecord(
                { ...artifact, workflow_run: { id: 123, head_sha: 'b'.repeat(40) } },
                '123',
                release,
            ),
        )
        assert.throws(
            () => verifyArtifactArchive(Buffer.from('another zip'), digest, directory, filename),
            /immutable GitHub artifact digest/,
        )
        writeFileSync(join(directory, filename), 'repacked synthetic bytes')
        writeFileSync(
            join(directory, 'release.json'),
            JSON.stringify({ ...release, integrity: 'recomputed' }),
        )
        assert.throws(
            () => verifyArtifactArchive(bytes, digest, directory, filename),
            /differs from the trusted run artifact/,
        )
    } finally {
        rmSync(directory, { recursive: true, force: true })
    }
})

// A failed rerun must not replace the historical success used by the retained artifact.
test('uses the original successful attempt even when the latest run failed', () => {
    const readApi = (path) => {
        if (path === 'actions/runs/777')
            return { ...run, id: 777, run_attempt: 2, conclusion: 'failure' }
        if (path === 'actions/runs/777/attempts/1') return { ...run, id: 777, run_attempt: 1 }
        if (path === 'actions/runs/777/attempts/2')
            return { ...run, id: 777, run_attempt: 2, conclusion: 'failure' }
        if (path === 'actions/workflows/pack.yml') return { id: 123 }
        if (path === 'releases/tags/interaction-trace-v1.1.4')
            return { tag_name: 'interaction-trace-v1.1.4', draft: false, prerelease: false }
        if (path === 'commits/interaction-trace-v1.1.4') return { sha }
        if (path === `compare/${sha}...main`) return { status: 'ahead' }
        throw new Error(`Unexpected API read: ${path}`)
    }
    assert.equal(verifySourceRun('777', '1.1.4', '1', readApi).sha, sha)
    assert.throws(() => verifySourceRun('777', '1.1.4', '2', readApi))
    assert.throws(() => verifySourceRun('777', '1.1.4', '../1', readApi))
})

test('existing-release tooling binds distinct reviewed workflow and immutable tag commits', () => {
    const workflowSha = 'b'.repeat(40)
    const recovery = {
        ...run,
        path: '.github/workflows/pack-existing-release.yml',
        head_branch: 'main',
        head_sha: workflowSha,
    }
    const seen = []
    const source = validateSourceRun(recovery, 123, '1.1.4', sha, (base, head) => {
        seen.push([base, head])
        return { status: 'ahead' }
    })
    assert.deepEqual(source, { sha, ref: 'refs/tags/interaction-trace-v1.1.4' })
    assert.deepEqual(seen, [
        [sha, 'main'],
        [workflowSha, 'main'],
    ])
    assert.throws(() =>
        validateSourceRun({ ...recovery, head_branch: 'feature' }, 123, '1.1.4', sha, reviewed),
    )
    for (const unreviewed of [sha, workflowSha]) {
        assert.throws(() =>
            validateSourceRun(recovery, 123, '1.1.4', sha, (base) => ({
                status: base === unreviewed ? 'diverged' : 'ahead',
            })),
        )
    }
})

test('existing-release artifact records bind the workflow SHA separately from the tag SHA', () => {
    const workflowSha = 'b'.repeat(40)
    const release = {
        version: '1.1.4',
        sourceSha: sha,
        sourceWorkflowSha: workflowSha,
        sourceWorkflowPath: '.github/workflows/pack-existing-release.yml',
    }
    const artifact = {
        id: 456,
        name: 'interaction-trace-1.1.4',
        digest: `sha256:${'c'.repeat(64)}`,
        workflow_run: { id: 123, head_sha: workflowSha },
    }
    validateArtifactRecord(artifact, '123', release)
    assert.throws(() =>
        validateArtifactRecord(
            { ...artifact, workflow_run: { id: 123, head_sha: sha } },
            '123',
            release,
        ),
    )
    assert.throws(() =>
        validateArtifactRecord(artifact, '123', { ...release, sourceWorkflowSha: undefined }),
    )
})
