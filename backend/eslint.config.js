import tseslint from 'typescript-eslint';

/** Layer import boundaries — run `npm run check:layers` for enforcement. */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['src/common/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/mcq/**', '**/story/**', '**/trailer/**'],
              message: 'common must not import vertical modules',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/capabilities/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/mcq/**', '**/story/**', '**/trailer/**'],
              message: 'capabilities must not import vertical modules',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/story/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/mcq/**'],
              message: 'story must not import mcq modules',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/trailer/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/mcq/**', '**/story/**'],
              message: 'trailer must not import mcq or story modules',
            },
          ],
        },
      ],
    },
  }
);
