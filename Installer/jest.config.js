/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

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
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: { module: "CommonJS", moduleResolution: "node" } }],
  },
  collectCoverageFrom: ["src/main/**/*.ts"],
  coveragePathIgnorePatterns: ["/node_modules/", "/tests/", "src/main/index.ts"],
  verbose: true,
};
