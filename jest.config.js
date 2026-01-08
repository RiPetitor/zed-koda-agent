export default {
  testEnvironment: "node",
  transform: {},
  moduleFileExtensions: ["js", "mjs"],
  testMatch: ["**/src/**/*.test.js"],
  verbose: true,
  testTimeout: 10000,
  transformIgnorePatterns: [],
  injectGlobals: true,
  roots: ["<rootDir>/src"],

  // Coverage configuration
  collectCoverageFrom: [
    "src/**/*.js",
    "!src/**/*.test.js",
    "!src/**/__mocks__/**",
    "!src/**/index.js",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "text-summary", "lcov"],
  coverageThreshold: {
    global: {
      branches: 40,
      functions: 40,
      lines: 40,
      statements: 40,
    },
  },

  // Force exit after tests complete
  forceExit: true,
};
