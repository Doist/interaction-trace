import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyRetainedArtifact } from './release-source.mjs'

const packageName = '@todoist/interaction-trace'
const repository = 'https://github.com/todoist/interaction-trace'
const registries = { npm: 'https://registry.npmjs.org/', github: 'https://npm.pkg.github.com/' }
const json = (path) => JSON.parse(readFileSync(path, 'utf8'))
const hash = (bytes, algorithm, encoding) => createHash(algorithm).update(bytes).digest(encoding)

function validatePackage(pkg, version) {
    assert.match(version, /^\d+\.\d+\.\d+$/, 'Only stable semver releases are supported')
    assert.equal(pkg.name, packageName)
    assert.equal(pkg.version, version)
    assert.deepEqual(pkg.repository, { type: 'git', url: `git+${repository}.git` })
    assert.ok(!pkg.private, 'The npm package must remain public')
    assert.equal(pkg.publishConfig, undefined, 'Packed publishConfig must not override routing')
    assert.equal(pkg.main, './dist/index.js')
    assert.equal(pkg.types, './dist/index.d.ts')
    assert.equal(pkg.exports?.['./react']?.import, './dist/react/index.js')
    assert.equal(pkg.exports?.['./react']?.types, './dist/react/index.d.ts')
    assert.deepEqual(pkg.peerDependencies, { react: '^18.0.0 || ^19.0.0' })
    assert.deepEqual(pkg.peerDependenciesMeta, { react: { optional: true } })
    for (const key of [
        'dependencies',
        'devDependencies',
        'peerDependencies',
        'optionalDependencies',
    ]) {
        for (const [name, spec] of Object.entries(pkg[key] ?? {})) {
            assert.ok(!name.startsWith('@doist/'), `Unmigrated dependency: ${name}`)
            assert.ok(
                !/^(?:file:|link:|workspace:|npm:)/.test(spec),
                `Non-registry dependency: ${name}`,
            )
        }
    }
}

export function verify(directory, sourceSha, version, sourceRef) {
    assert.match(version, /^\d+\.\d+\.\d+$/, 'Only stable semver releases are supported')
    assert.match(sourceSha, /^[a-f0-9]{40}$/)
    const release = json(join(directory, 'release.json'))
    assert.equal(
        release.schemaVersion,
        1,
        'Unsupported release schema; retain original bytes and use reviewed compatible recovery tooling, never repack',
    )
    assert.equal(release.name, packageName)
    assert.equal(release.version, version)
    assert.equal(release.sourceSha, sourceSha)
    if (sourceRef) assert.equal(release.sourceRef, sourceRef)
    assert.ok(
        ['refs/heads/main', `refs/tags/interaction-trace-v${version}`].includes(release.sourceRef),
    )
    assert.equal(release.filename, `todoist-interaction-trace-${version}.tgz`)
    const tarball = resolve(directory, release.filename)
    const bytes = readFileSync(tarball)
    assert.equal(release.integrity, `sha512-${hash(bytes, 'sha512', 'base64')}`)
    assert.equal(release.shasum, hash(bytes, 'sha1', 'hex'))
    const files = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).trim().split('\n')
    assert.ok(files.includes('package/dist/index.js'), 'Build output is missing')
    for (const file of [
        'package/dist/index.d.ts',
        'package/dist/react/index.js',
        'package/dist/react/index.d.ts',
        'package/package.json',
        'package/README.md',
        'package/LICENSE',
        'package/CHANGELOG.md',
    ]) {
        assert.ok(files.includes(file), `Missing packed file: ${file}`)
    }
    assert.ok(
        files.every(
            (file) =>
                /^(?:package\/(?:package\.json|README\.md|LICENSE|CHANGELOG\.md)|package\/dist\/[\w./-]+)$/.test(
                    file,
                ) && !file.split('/').includes('..'),
        ),
        'Unexpected packed files',
    )
    const pkg = JSON.parse(
        execFileSync('tar', ['-xOzf', tarball, 'package/package.json'], { encoding: 'utf8' }),
    )
    validatePackage(pkg, version)
    return { ...release, tarball }
}

export function pack(directory, sourceSha, sourceRef) {
    const pkg = json('package.json')
    validatePackage(pkg, pkg.version)
    assert.match(sourceSha, /^[a-f0-9]{40}$/)
    assert.ok(
        sourceRef === 'refs/heads/main' ||
            sourceRef === `refs/tags/interaction-trace-v${pkg.version}`,
        'Use main or the matching version tag',
    )
    const lock = json('package-lock.json')
    for (const entry of [lock, lock.packages['']]) {
        assert.equal(entry.name, pkg.name)
        assert.equal(entry.version, pkg.version)
    }
    for (const key of [
        'dependencies',
        'devDependencies',
        'peerDependencies',
        'optionalDependencies',
    ]) {
        assert.deepEqual(
            lock.packages[''][key],
            pkg[key],
            `Lockfile ${key} must be finalized from the real registry`,
        )
    }
    assert.equal(json('.github/release-please-manifest.json')['.'], pkg.version)
    mkdirSync(directory, { recursive: true })
    const [packed] = JSON.parse(
        execFileSync(
            'npm',
            ['pack', '--ignore-scripts', '--json', '--pack-destination', resolve(directory)],
            { encoding: 'utf8' },
        ),
    )
    const release = {
        schemaVersion: 1,
        sourceRunId: process.env.GITHUB_RUN_ID ?? null,
        sourceRunAttempt: Number(process.env.GITHUB_RUN_ATTEMPT ?? 1),
        ...(process.env.SOURCE_WORKFLOW_PATH
            ? {
                  sourceWorkflowPath: process.env.SOURCE_WORKFLOW_PATH,
                  sourceWorkflowSha: process.env.GITHUB_SHA,
              }
            : {}),
        name: pkg.name,
        version: pkg.version,
        sourceSha,
        sourceRef,
        filename: packed.filename,
        integrity: packed.integrity,
        shasum: packed.shasum,
    }
    writeFileSync(join(directory, 'release.json'), `${JSON.stringify(release, null, 2)}\n`)
    verify(directory, sourceSha, pkg.version)
    return release
}

// A temporary cwd and explicit scope mapping prevent project/user npmrc routing leaks.
// Never log config contents or token values. npm uses OIDC for npmjs, GITHUB_TOKEN for GitHub.
export function withRegistry(destination, callback) {
    assert.ok(Object.hasOwn(registries, destination), 'Unknown registry')
    if (destination === 'github')
        assert.ok(process.env.NODE_AUTH_TOKEN, 'GitHub package token is required')
    const registry = registries[destination]
    const directory = mkdtempSync(join(tmpdir(), 'interaction-trace-publish-'))
    const env = Object.fromEntries(
        Object.entries(process.env).filter(
            ([key]) =>
                !/^(npm_config_|npm_token$|node_auth_token$|gh_token$|github_token$|gh_read_token$|gh_publish_token$)/i.test(
                    key,
                ),
        ),
    )
    env.NPM_CONFIG_USERCONFIG = join(directory, 'user.npmrc')
    env.NPM_CONFIG_GLOBALCONFIG = join(directory, 'global.npmrc')
    writeFileSync(env.NPM_CONFIG_GLOBALCONFIG, '')
    let config = `registry=${registry}\n@todoist:registry=${registry}\n`
    if (destination === 'github') {
        env.NODE_AUTH_TOKEN = process.env.NODE_AUTH_TOKEN
        // biome-ignore lint/suspicious/noTemplateCurlyInString: npm expands the token only at runtime.
        config += '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n'
    }
    writeFileSync(env.NPM_CONFIG_USERCONFIG, config, { mode: 0o600 })
    try {
        return callback(
            (args, options = {}) =>
                spawnSync('npm', args, { cwd: directory, env, encoding: 'utf8', ...options }),
            registry,
        )
    } finally {
        rmSync(directory, { recursive: true, force: true })
    }
}

export function registryMetadata(run, registry, spec, field = 'dist') {
    const result = run(['view', spec, field, '--json', `--registry=${registry}`])
    if (result.status === 0) {
        const value = JSON.parse(result.stdout)
        assert.ok(value && typeof value === 'object', 'Registry returned ambiguous metadata')
        return value
    }
    // Authentication, networking and other failures must not be mistaken for absence.
    let error
    try {
        error = JSON.parse(result.stdout).error
    } catch {
        /* fail closed below */
    }
    if (error?.code === 'E404') return null
    throw new Error(`Registry lookup failed: ${result.stderr || result.error || result.stdout}`)
}

export function assertSameArtifact(dist, release) {
    assert.ok(dist, 'Published version is missing')
    if (dist.integrity)
        assert.equal(
            dist.integrity,
            release.integrity,
            'Registry integrity differs; do not overwrite or bump',
        )
    else
        assert.equal(
            dist.shasum,
            release.shasum,
            'Registry checksum differs; do not overwrite or bump',
        )
}

// Validate BOTH destinations before any write, including a single missing-mirror retry.
// A successful pack run at the same source SHA need not have byte-identical tar output.
export function preflight(release, lookup) {
    for (const destination of ['npm', 'github']) {
        const dist = lookup(destination)
        if (dist) assertSameArtifact(dist, release)
    }
}

export function preflightRegistries(release, isolatedRegistry = withRegistry) {
    preflight(release, (destination) =>
        isolatedRegistry(destination, (run, registry) => {
            // GitHub can mask a missing package permission as 404. Require a readable
            // transferred package before interpreting an exact-version 404 as absence.
            if (destination === 'github') {
                assert.ok(
                    registryMetadata(run, registry, release.name, 'dist-tags'),
                    'GitHub package unreadable: verify transfer and package Read access before any write',
                )
            }
            return registryMetadata(run, registry, `${release.name}@${release.version}`)
        }),
    )
}

export function publish(release, destination, run, registry, tag = 'latest', publishOptions = {}) {
    assert.ok(['latest', 'recovery'].includes(tag), 'Expected latest or recovery dist-tag')
    const spec = `${release.name}@${release.version}`
    const existing = registryMetadata(run, registry, spec)
    if (existing) {
        assertSameArtifact(existing, release)
        console.log(`${destination}: identical ${spec} already exists; skipped`)
        return
    }
    if (tag === 'latest') {
        const latest = registryMetadata(run, registry, release.name, 'dist-tags')?.latest
        if (latest) {
            assert.match(
                latest,
                /^\d+\.\d+\.\d+$/,
                'Non-stable latest requires explicit recovery tag',
            )
            const current = latest.split('.').map(Number)
            const target = release.version.split('.').map(Number)
            const firstDifference = current.findIndex((part, index) => part !== target[index])
            assert.ok(
                firstDifference === -1 || current[firstDifference] < target[firstDifference],
                `Registry latest ${latest} is newer than ${release.version}; use recovery tag to preserve latest`,
            )
        }
    }
    const args = [
        'publish',
        release.tarball,
        '--ignore-scripts',
        `--tag=${tag}`,
        `--registry=${registry}`,
    ]
    // GitHub visibility is administered independently; do not infer it from npm access.
    // The tarball comes from an earlier run; GITHUB_SHA would attest the publisher commit.
    // Disable even OIDC's automatic provenance rather than claim the wrong build source.
    if (destination === 'npm') args.push('--access=public', '--provenance=false')
    const result = run(args, publishOptions)
    if (result.status !== 0)
        throw new Error(`Publish failed: ${result.stderr || result.error || result.stdout}`)
    assertSameArtifact(registryMetadata(run, registry, spec), release)
    console.log(`${destination}: verified ${spec}`)
}

// Operator-only first publication: interactive authentication in the same isolated config,
// followed by exactly the same collision/integrity/latest checks as automated publication.
export function bootstrap(release, run, registry, tag = 'latest', prewrite = () => {}) {
    const login = run(['login', `--registry=${registry}`], { stdio: 'inherit' })
    assert.equal(login.status, 0, 'Interactive npm login failed; publication was not attempted')
    prewrite()
    // Publishing can ask for a fresh 2FA challenge even after login.
    publish(release, 'npm', run, registry, tag, { stdio: 'inherit' })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [command, directory, sourceSha, versionOrRef, destination, tag] = process.argv.slice(2)
    if (command === 'pack')
        console.log(JSON.stringify(pack(directory, sourceSha, versionOrRef), null, 2))
    else if (command === 'verify')
        console.log(
            JSON.stringify(verify(directory, sourceSha, versionOrRef, destination), null, 2),
        )
    else if (command === 'bootstrap') {
        const release = verify(directory, sourceSha, versionOrRef)
        verifyRetainedArtifact(process.env.SOURCE_RUN_ID, release, directory)
        preflightRegistries(release)
        withRegistry('npm', (run, registry) => {
            // Recheck both copies after login too, immediately before publication.
            bootstrap(release, run, registry, destination, () => preflightRegistries(release))
        })
    } else if (command === 'publish') {
        const release = verify(directory, sourceSha, versionOrRef)
        verifyRetainedArtifact(process.env.SOURCE_RUN_ID, release, directory)
        preflightRegistries(release)
        withRegistry(destination, (run, registry) =>
            publish(release, destination, run, registry, tag),
        )
    } else throw new Error('Expected pack, verify, bootstrap or publish')
}
