import type { Configuration } from 'lint-staged'

const config: Configuration = {
    '*.{js,ts,mjs,tsx,json,md}': 'biome check --write --no-errors-on-unmatched',
    '*.{ts,tsx}': () => 'tsc --noEmit',
}

export default config
