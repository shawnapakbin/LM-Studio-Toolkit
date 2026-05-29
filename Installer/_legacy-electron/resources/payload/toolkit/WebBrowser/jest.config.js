module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  moduleNameMapper: {
    "^@shared/(.*)$": "<rootDir>/../shared/$1",
    "^@shared$": "<rootDir>/../shared",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        diagnostics: false,
        tsconfig: {
          esModuleInterop: true,
          lib: ["ES2022", "DOM"],
          baseUrl: "../",
          paths: { "@shared/*": ["shared/*"] },
        },
      },
    ],
  },
  collectCoverageFrom: ["src/**/*.ts"],
  coveragePathIgnorePatterns: ["/node_modules/", "/tests/"],
  verbose: true,
};
