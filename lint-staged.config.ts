import type { Configuration } from 'lint-staged'

const config: Configuration = {
    '*.{js,ts,mjs,mts,tsx,json,md}': 'biome check --write --no-errors-on-unmatched',
    '*.{ts,mts,tsx}': () => 'tsc --noEmit',
}

export default config
