module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  collectCoverageFrom: ["scripts/**/*.js"],
  coveragePathIgnorePatterns: ["/node_modules/", "/tests/"],
  verbose: true,
};
