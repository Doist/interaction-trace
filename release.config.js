/**
 * @type {import('semantic-release').GlobalConfig}
 */
export default {
    branches: ['main'],
    plugins: [
        ['@semantic-release/commit-analyzer', { preset: 'conventionalcommits' }],
        ['@semantic-release/release-notes-generator', { preset: 'conventionalcommits' }],
        '@semantic-release/changelog',
        '@semantic-release/npm',
        [
            '@semantic-release/git',
            {
                assets: ['CHANGELOG.md', 'package.json', 'package-lock.json'],
                // biome-ignore lint/suspicious/noTemplateCurlyInString: semantic-release template syntax, not JS template literals
                message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
            },
        ],
        '@semantic-release/github',
        [
            '@semantic-release/exec',
            {
                verifyConditionsCmd: 'echo "package-published=false" >> $GITHUB_OUTPUT',
                successCmd: 'echo "package-published=true" >> $GITHUB_OUTPUT',
            },
        ],
    ],
}
