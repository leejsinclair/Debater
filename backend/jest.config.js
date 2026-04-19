module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Default test run excludes browser UI tests (they require a real browser + network)
  testMatch: ['**/__tests__/**/*.test.ts'],
  testPathIgnorePatterns:
    process.env.JEST_BROWSER === 'true' ? [] : ['browser-ui\\.test\\.ts'],
};
