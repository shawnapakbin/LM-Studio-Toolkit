/**
 * CLI skills command — unit tests with mocked HTTP
 */

import fs from "fs";
import { Command } from "commander";
import { registerSkillsCommands } from "../src/commands/skills";

jest.mock("../src/http", () => ({
  toolPost: jest.fn(),
  printResult: jest.fn(),
  handleError: jest.fn(),
}));

import { handleError, printResult, toolPost } from "../src/http";

const mockToolPost = toolPost as jest.MockedFunction<typeof toolPost>;
const mockPrintResult = printResult as jest.MockedFunction<typeof printResult>;
const mockHandleError = handleError as jest.MockedFunction<typeof handleError>;

function makeProgram() {
  const program = new Command();
  program.exitOverride();
  registerSkillsCommands(program);
  return program;
}

beforeEach(() => jest.clearAllMocks());

describe("skills command", () => {
  describe("skills list", () => {
    it("posts list_skills action", async () => {
      const result = { skills: [] };
      mockToolPost.mockResolvedValue(result);

      await makeProgram().parseAsync(["node", "llm", "skills", "list"]);

      expect(mockToolPost).toHaveBeenCalledWith(expect.stringContaining("/tools/skills"), {
        action: "list_skills",
      });
      expect(mockPrintResult).toHaveBeenCalledWith(result);
    });

    it("calls handleError on failure", async () => {
      mockToolPost.mockRejectedValue(new Error("HTTP 500"));
      await makeProgram().parseAsync(["node", "llm", "skills", "list"]);
      expect(mockHandleError).toHaveBeenCalled();
    });
  });

  describe("skills get", () => {
    it("posts get_skill action with name", async () => {
      const result = { name: "my-skill", template: "echo {{msg}}" };
      mockToolPost.mockResolvedValue(result);

      await makeProgram().parseAsync(["node", "llm", "skills", "get", "my-skill"]);

      expect(mockToolPost).toHaveBeenCalledWith(expect.any(String), {
        action: "get_skill",
        name: "my-skill",
      });
      expect(mockPrintResult).toHaveBeenCalledWith(result);
    });
  });

  describe("skills run", () => {
    it("posts execute_skill with name and empty params by default", async () => {
      mockToolPost.mockResolvedValue({ output: "done" });

      await makeProgram().parseAsync(["node", "llm", "skills", "run", "my-skill"]);

      expect(mockToolPost).toHaveBeenCalledWith(expect.any(String), {
        action: "execute_skill",
        name: "my-skill",
        params: {},
      });
    });

    it("parses --params JSON and includes in request", async () => {
      mockToolPost.mockResolvedValue({});

      await makeProgram().parseAsync([
        "node",
        "llm",
        "skills",
        "run",
        "my-skill",
        "--params",
        '{"key":"value"}',
      ]);

      expect(mockToolPost).toHaveBeenCalledWith(expect.any(String), {
        action: "execute_skill",
        name: "my-skill",
        params: { key: "value" },
      });
    });

    it("calls handleError on HTTP failure", async () => {
      mockToolPost.mockRejectedValue(new Error("HTTP 404"));
      await makeProgram().parseAsync(["node", "llm", "skills", "run", "missing"]);
      expect(mockHandleError).toHaveBeenCalled();
    });
  });

  describe("skills define", () => {
    it("reads JSON file and posts define_skill action", async () => {
      const skillDef = { name: "new-skill", template: "echo {{x}}" };
      jest.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(skillDef));
      mockToolPost.mockResolvedValue({ created: true });

      await makeProgram().parseAsync(["node", "llm", "skills", "define", "skill.json"]);

      expect(mockToolPost).toHaveBeenCalledWith(expect.any(String), {
        action: "define_skill",
        ...skillDef,
      });
    });
  });

  describe("skills delete", () => {
    it("posts delete_skill action with name", async () => {
      mockToolPost.mockResolvedValue({ deleted: true });

      await makeProgram().parseAsync(["node", "llm", "skills", "delete", "old-skill"]);

      expect(mockToolPost).toHaveBeenCalledWith(expect.any(String), {
        action: "delete_skill",
        name: "old-skill",
      });
    });
  });
});
