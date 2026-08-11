const path = require("path");

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: path.resolve(__dirname, "tsconfig.test.json"),
      },
    ],
  },
  moduleNameMapper: {
    "^llm-toolkit-calculator/dist/calculator$": "<rootDir>/../../Calculator/src/calculator",
    "^llm-toolkit-clock/dist/clock$": "<rootDir>/../../Clock/src/clock",
    "^llm-toolkit-ask-user/dist/(.*)$": "<rootDir>/../../AskUser/src/$1",
    "^llm-toolkit-document-scraper/dist/(.*)$": "<rootDir>/../../DocumentScraper/src/$1",
    "^@shared/types$": "<rootDir>/../../shared/types",
  },
};
