import assert from 'node:assert/strict'
import {
    appendFileSync,
    chmodSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
    bootstrap,
    pack,
    preflight,
    preflightRegistries,
    publish,
    registryMetadata,
    verify,
    withRegistry,
} from './release.mjs'

const registry = 'https://registry.npmjs.org/'
const release = {
    name: '@todoist/interaction-trace',
    version: '1.1.4',
    tarball: '/retained/package.tgz',
    integrity: 'sha512-example',
    shasum: 'example-sha1',
}
const success = (value) => ({ status: 0, stdout: JSON.stringify(value) })
const missing = { status: 1, stdout: JSON.stringify({ error: { code: 'E404' } }) }

test('an identical existing release is verified without publication', () => {
    const calls = []
    publish(
        release,
        'npm',
        (args) => {
            calls.push(args)
            return success(release)
        },
        registry,
    )
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], 'view')
})

test('a conflicting existing release fails without publication', () => {
    const calls = []
    assert.throws(
        () =>
            publish(
                release,
                'npm',
                (args) => {
                    calls.push(args)
                    return success({ integrity: 'sha512-different' })
                },
                registry,
            ),
        /integrity differs/,
    )
    assert.equal(calls.length, 1)
})

test('only a missing version publishes the supplied tarball and verifies the result', () => {
    for (const destination of ['npm', 'github']) {
        const calls = []
        const results = [missing, success({ latest: '1.1.3' }), success({}), success(release)]
        publish(
            release,
            destination,
            (args) => {
                calls.push(args)
                return results.shift()
            },
            registry,
        )
        assert.equal(calls.length, 4)
        assert.deepEqual(calls[2], [
            'publish',
            release.tarball,
            '--ignore-scripts',
            '--tag=latest',
            `--registry=${registry}`,
            ...(destination === 'npm' ? ['--access=public', '--provenance=false'] : []),
        ])
    }
})

test('authentication/network errors and mismatched post-publish checks fail closed', () => {
    for (const code of ['E401', 'E403', 'ETIMEDOUT']) {
        assert.throws(
            () =>
                registryMetadata(
                    () => ({ status: 1, stdout: JSON.stringify({ error: { code } }) }),
                    registry,
                    'pkg@1.0.0',
                ),
            /lookup failed/,
        )
    }
    const results = [missing, success({}), success({}), success({ shasum: 'different' })]
    assert.throws(
        () => publish(release, 'github', () => results.shift(), registry),
        /checksum differs/,
    )
})

test('explicit isolated scope routing overrides inherited npm configuration', () => {
    const previous = process.env.npm_config_registry
    process.env.npm_config_registry = 'https://wrong.invalid/'
    try {
        withRegistry('npm', (run, expectedRegistry) => {
            const result = run(['config', 'get', '@todoist:registry'])
            assert.equal(result.status, 0)
            assert.equal(result.stdout.trim(), expectedRegistry)
            assert.equal(run(['config', 'get', 'registry']).stdout.trim(), expectedRegistry)
        })
    } finally {
        if (previous === undefined) delete process.env.npm_config_registry
        else process.env.npm_config_registry = previous
    }
})

// A synthetic package fixture exercises integrity/metadata checks, never a release artifact.
test('pack rejects stale locks, mismatched source and corrupted bytes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'interaction-release-test-'))
    const cwd = process.cwd()
    const sourceSha = '0'.repeat(40)
    const pkg = {
        name: release.name,
        version: release.version,
        main: './dist/index.js',
        types: './dist/index.d.ts',
        exports: {
            './react': { import: './dist/react/index.js', types: './dist/react/index.d.ts' },
        },
        peerDependencies: { react: '^18.0.0 || ^19.0.0' },
        peerDependenciesMeta: { react: { optional: true } },
        repository: {
            type: 'git',
            url: 'git+https://github.com/todoist/interaction-trace.git',
        },
        files: ['dist', 'README.md', 'LICENSE', 'CHANGELOG.md'],
        devDependencies: { '@todoist/tsconfig': '2.0.2' },
    }
    try {
        mkdirSync(join(directory, 'dist/react'), { recursive: true })
        mkdirSync(join(directory, '.github'))
        for (const file of [
            'dist/index.js',
            'dist/index.d.ts',
            'dist/react/index.js',
            'dist/react/index.d.ts',
        ])
            writeFileSync(join(directory, file), '// synthetic fixture\n')
        for (const file of ['README.md', 'LICENSE', 'CHANGELOG.md'])
            writeFileSync(join(directory, file), 'fixture\n')
        writeFileSync(join(directory, 'package.json'), JSON.stringify(pkg))
        writeFileSync(
            join(directory, '.github/release-please-manifest.json'),
            JSON.stringify({ '.': pkg.version }),
        )
        const lock = {
            name: pkg.name,
            version: pkg.version,
            packages: { '': { name: pkg.name, version: pkg.version } },
        }
        writeFileSync(join(directory, 'package-lock.json'), JSON.stringify(lock))
        process.chdir(directory)
        assert.throws(
            () => pack(join(directory, 'artifact'), sourceSha, 'refs/heads/main'),
            /Lockfile devDependencies/,
        )
        lock.packages[''].devDependencies = pkg.devDependencies
        lock.packages[''].peerDependencies = pkg.peerDependencies
        writeFileSync(join(directory, 'package-lock.json'), JSON.stringify(lock))
        const packed = pack(join(directory, 'artifact'), sourceSha, 'refs/heads/main')
        verify(join(directory, 'artifact'), sourceSha, pkg.version, 'refs/heads/main')
        assert.throws(() => verify(join(directory, 'artifact'), '1'.repeat(40), pkg.version))
        assert.throws(() =>
            verify(join(directory, 'artifact'), sourceSha, pkg.version, 'refs/tags/wrong'),
        )
        assert.throws(
            () => pack(join(directory, 'artifact'), sourceSha, 'refs/tags/v0.0.0'),
            /matching version tag/,
        )
        const metadataPath = join(directory, 'artifact/release.json')
        const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
        writeFileSync(metadataPath, JSON.stringify({ ...metadata, schemaVersion: 2 }))
        assert.throws(
            () => verify(join(directory, 'artifact'), sourceSha, pkg.version),
            /never repack/,
        )
        writeFileSync(metadataPath, JSON.stringify(metadata))
        appendFileSync(join(directory, 'artifact', packed.filename), 'modified')
        assert.throws(() => verify(join(directory, 'artifact'), sourceSha, pkg.version))
    } finally {
        process.chdir(cwd)
        rmSync(directory, { recursive: true, force: true })
    }
})

test('older mirror recovery cannot downgrade latest and supports an explicit recovery tag', () => {
    const calls = []
    const results = [missing, success({ latest: '1.1.5' })]
    assert.throws(
        () =>
            publish(
                release,
                'npm',
                (args) => {
                    calls.push(args)
                    return results.shift()
                },
                registry,
            ),
        /use recovery tag to preserve latest/,
    )
    assert.equal(
        calls.some((args) => args[0] === 'publish'),
        false,
    )

    const recoveryCalls = []
    const recoveryResults = [missing, success({}), success(release)]
    publish(
        release,
        'npm',
        (args) => {
            recoveryCalls.push(args)
            return recoveryResults.shift()
        },
        registry,
        'recovery',
    )
    assert.ok(recoveryCalls[1].includes('--tag=recovery'))
    assert.ok(recoveryCalls[1].includes('--provenance=false'))
    assert.equal(recoveryCalls[1].includes('--tag=latest'), false)
})

// Login and publication are stubs here; this test never authenticates or writes remotely.
test('interactive bootstrap uses the same collision and latest guards after login', () => {
    const failedCalls = []
    assert.throws(
        () =>
            bootstrap(
                release,
                (args) => {
                    failedCalls.push(args)
                    return { status: 1 }
                },
                registry,
            ),
        /Interactive npm login failed/,
    )
    assert.equal(failedCalls.length, 1)
    const calls = []
    const results = [success({}), missing, success({ latest: '1.1.5' })]
    assert.throws(
        () =>
            bootstrap(
                release,
                (args, options) => {
                    calls.push({ args, options })
                    return results.shift()
                },
                registry,
            ),
        /use recovery tag to preserve latest/,
    )
    assert.deepEqual(calls[0], {
        args: ['login', `--registry=${registry}`],
        options: { stdio: 'inherit' },
    })
    assert.equal(
        calls.some(({ args }) => args[0] === 'publish'),
        false,
    )
})

test('preflight rejects a conflicting completed destination before a mirror retry', () => {
    for (const conflict of ['npm', 'github']) {
        const checked = []
        assert.throws(
            () =>
                preflight(release, (destination) => {
                    checked.push(destination)
                    return destination === conflict ? { integrity: 'sha512-other-build' } : null
                }),
            /integrity differs/,
        )
        assert.ok(checked.includes(conflict))
    }
    const checked = []
    preflight(release, (destination) => {
        checked.push(destination)
        return destination === 'npm' ? release : null
    })
    assert.deepEqual(checked, ['npm', 'github'])
})

test('interactive bootstrap preserves the terminal for publication 2FA, with metadata captured', () => {
    const calls = []
    const results = [success({}), missing, success({}), success({}), success(release)]
    bootstrap(
        release,
        (args, options) => {
            calls.push({ args, options })
            return results.shift()
        },
        registry,
    )
    assert.deepEqual(calls.filter(({ args }) => args[0] === 'publish')[0].options, {
        stdio: 'inherit',
    })
    assert.ok(
        calls
            .filter(({ args }) => args[0] === 'view')
            .every(({ options }) => options === undefined),
    )
})

test('a GitHub package 404 is ambiguous and blocks even an npm-only first publication', () => {
    const reads = []
    assert.throws(
        () =>
            preflightRegistries(release, (destination, callback) =>
                callback((args) => {
                    reads.push({ destination, args })
                    return missing
                }, destination),
            ),
        /GitHub package unreadable/,
    )
    assert.deepEqual(
        reads.map(({ destination }) => destination),
        ['npm', 'github'],
    )
    const exactReads = []
    preflightRegistries(release, (destination, callback) =>
        callback((args) => {
            exactReads.push({ destination, args })
            return args[1] === release.name ? success({ latest: '1.1.0' }) : missing
        }, destination),
    )
    assert.equal(exactReads.filter(({ args }) => args[1].includes('@1.1.4')).length, 2)
})

test('bootstrap rechecks cross-registry conflicts after login before any publication', () => {
    const calls = []
    assert.throws(
        () =>
            bootstrap(
                release,
                (args) => {
                    calls.push(args)
                    return success({})
                },
                registry,
                'latest',
                () => {
                    preflight(release, () => ({ integrity: 'sha512-conflict-during-login' }))
                },
            ),
        /integrity differs/,
    )
    assert.deepEqual(calls, [['login', `--registry=${registry}`]])
})

test('GitHub read credentials are absent from the isolated npmjs subprocess', () => {
    const directory = mkdtempSync(join(tmpdir(), 'interaction-trace-auth-test-'))
    const keys = [
        'NODE_AUTH_TOKEN',
        'GH_TOKEN',
        'GITHUB_TOKEN',
        'GH_READ_TOKEN',
        'GH_PUBLISH_TOKEN',
        'NPM_TOKEN',
    ]
    const previous = Object.fromEntries(['PATH', ...keys].map((key) => [key, process.env[key]]))
    try {
        const executable = join(directory, 'npm')
        writeFileSync(
            executable,
            `#!/usr/bin/env node\nconsole.log(JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.map(k => [k, Boolean(process.env[k])]))))\n`,
        )
        chmodSync(executable, 0o700)
        process.env.PATH = `${directory}:${process.env.PATH}`
        for (const key of keys) process.env[key] = 'synthetic-test-credential'
        withRegistry('npm', (run) => {
            const result = run(['--version'])
            assert.equal(result.status, 0)
            assert.deepEqual(
                JSON.parse(result.stdout),
                Object.fromEntries(keys.map((key) => [key, false])),
            )
        })
        withRegistry('github', (run) => {
            const result = run(['--version'])
            assert.equal(result.status, 0)
            assert.deepEqual(
                JSON.parse(result.stdout),
                Object.fromEntries(keys.map((key) => [key, key === 'NODE_AUTH_TOKEN'])),
            )
        })
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
        rmSync(directory, { recursive: true, force: true })
    }
})
