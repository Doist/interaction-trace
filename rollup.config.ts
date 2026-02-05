import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import type { RollupOptions } from 'rollup'

const config: RollupOptions = {
    input: {
        index: 'src/index.ts',
        'react/index': 'src/react/index.ts',
    },
    output: {
        dir: 'dist',
        format: 'esm',
        entryFileNames: '[name].js',
        preserveModules: true,
        preserveModulesRoot: 'src',
        sourcemap: true,
    },
    external: ['react'],
    plugins: [
        resolve({ extensions: ['.ts', '.tsx'] }),
        typescript({
            tsconfig: './tsconfig.json',
            declaration: true,
            declarationDir: 'dist',
            exclude: ['**/*.test.ts'],
        }),
    ],
}

export default config
