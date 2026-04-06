module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  moduleNameMapper: {
    "^@shared/(.*)$": "<rootDir>/../shared/$1",
    "^\\.\\./\\.\\./\\.\\./AgentRunner/src/(.*)$": "<rootDir>/../AgentRunner/src/$1",
  },
  collectCoverageFrom: ["src/**/*.ts"],
  coveragePathIgnorePatterns: ["/node_modules/", "/tests/"],
  verbose: true,
};
