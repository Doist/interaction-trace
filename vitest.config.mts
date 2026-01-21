import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        environment: 'happy-dom',
        include: ['src/**/*.test.{ts,mts,tsx}'],
        watchExclude: ['node_modules', 'dist'],
    },
})
