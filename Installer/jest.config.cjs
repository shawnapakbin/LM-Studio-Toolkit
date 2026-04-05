module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  extensionsToTreatAsEsm: [],
  moduleNameMapper: {
    // Stub electron so main-process modules can be imported in tests
    "^electron$": "<rootDir>/tests/__mocks__/electron.ts",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.test.json" }],
  },
  collectCoverageFrom: ["src/main/**/*.ts"],
  coveragePathIgnorePatterns: ["/node_modules/", "/tests/", "src/main/index.ts"],
  verbose: true,
};
