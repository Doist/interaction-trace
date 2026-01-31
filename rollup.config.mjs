import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'

export default {
    input: {
        index: 'src/index.mts',
        'react/index': 'src/react/index.mts',
    },
    output: {
        dir: 'dist',
        format: 'esm',
        entryFileNames: '[name].mjs',
        preserveModules: true,
        preserveModulesRoot: 'src',
        sourcemap: true,
    },
    external: ['react'],
    plugins: [
        resolve({ extensions: ['.mts', '.ts', '.tsx'] }),
        typescript({
            tsconfig: './tsconfig.json',
            declaration: true,
            declarationDir: 'dist',
            exclude: ['**/*.test.mts', '**/*.test.ts'],
        }),
    ],
}
