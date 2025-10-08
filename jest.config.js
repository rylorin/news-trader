module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  // The glob patterns Jest uses to detect test files
  testMatch: [
    // "**/__tests__/**/*.js?(x)",
    "**/?(*.)+(spec|test).ts?(x)",
    // "**/__tests__/**/*.+(ts|tsx|js|jsx)",
    // "**/tests/**/?(*.)+(spec|test).(ts|tsx|js|jsx)",
  ],
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/__tests__/**",
    "!src/index.ts", // Exclude main entry point from coverage
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  setupFilesAfterEnv: ["<rootDir>/src/__tests__/setup.ts"],
};
