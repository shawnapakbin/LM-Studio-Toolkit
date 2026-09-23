/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          moduleResolution: "node",
          target: "ES2022",
          esModuleInterop: true,
          strict: true,
          declaration: false,
          sourceMap: true,
          resolveJsonModule: true,
        },
      },
    ],
  },
  collectCoverageFrom: ["tests/helpers/**/*.ts", "scripts/**/*.ts"],
  coveragePathIgnorePatterns: ["/node_modules/", "/dist/"],
  verbose: true,
};
