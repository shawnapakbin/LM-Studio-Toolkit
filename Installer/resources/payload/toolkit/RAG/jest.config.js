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
  moduleNameMapper: {
    "^@shared/(.*)$": "<rootDir>/../shared/$1",
    "^@shared$": "<rootDir>/../shared",
  },
  collectCoverageFrom: ["src/**/*.ts"],
  coveragePathIgnorePatterns: ["/node_modules/", "/tests/"],
  verbose: true,
};
