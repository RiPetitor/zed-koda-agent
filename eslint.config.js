import globals from "globals";

export default [
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      // Errors
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-undef": "error",
      "no-const-assign": "error",
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",

      // Warnings
      "no-console": ["warn", { allow: ["error", "log"] }],
      "prefer-const": "warn",
      "no-var": "warn",

      // Style (handled by Prettier, but good to have)
      "semi": ["error", "always"],
      "quotes": ["error", "double", { avoidEscape: true }],
    },
  },
  {
    files: ["**/*.test.js"],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
  },
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "legacy/**",
      "*.min.js",
    ],
  },
];
