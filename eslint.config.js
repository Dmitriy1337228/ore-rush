import stylistic from '@stylistic/eslint-plugin';

const rules = {
    curly: ['error', 'all'],
    '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: 'return' },
        { blankLine: 'always', prev: ['if', 'for', 'while'], next: '*' }
    ]
};

export default [
    {
        ignores: [
            'node_modules/**',
            'dist/**',
            'shots/**',
            'docs/**',
            'assets/**',
            '.kilo/**',
            'tests/characterization/golden/**'
        ]
    },
    {
        files: ['**/*.js', '**/*.mjs'],
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        plugins: { '@stylistic': stylistic },
        rules
    },
    {
        files: ['**/*.cjs'],
        languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs' },
        plugins: { '@stylistic': stylistic },
        rules
    }
];
