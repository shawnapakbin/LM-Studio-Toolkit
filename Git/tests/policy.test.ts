import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  canAmendCommit,
  canForceDeleteBranch,
  canForcePush,
  canHardReset,
  getGitWorkspaceRoot,
  isSafeBranchName,
  validateCloneUrl,
  validateCommitMessage,
  validateRepoPath,
} from "../src/policy";

describe("Git policy", () => {
  test("validates repo path existence and .git folder", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "git-policy-"));

    const missing = validateRepoPath(path.join(tmp, "missing"));
    expect(missing.valid).toBe(false);

    const notRepo = validateRepoPath(tmp);
    expect(notRepo.valid).toBe(false);

    fs.mkdirSync(path.join(tmp, ".git"));
    const isRepo = validateRepoPath(tmp);
    expect(isRepo.valid).toBe(true);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("enforces safe branch names and force restrictions", () => {
    expect(isSafeBranchName("main").safe).toBe(false);
    expect(isSafeBranchName("feature good").safe).toBe(false);
    expect(isSafeBranchName(".hidden").safe).toBe(false);
    expect(isSafeBranchName("feature/login").safe).toBe(true);

    expect(canForcePush("master").allowed).toBe(false);
    expect(canForcePush("feature/login").allowed).toBe(true);
    expect(canForceDeleteBranch("develop").allowed).toBe(false);
    expect(canForceDeleteBranch("feature/login").allowed).toBe(true);
  });

  test("validates commit messages", () => {
    expect(validateCommitMessage("ok").valid).toBe(false);
    expect(validateCommitMessage("wip").valid).toBe(false);
    expect(validateCommitMessage("A".repeat(101)).valid).toBe(false);
    expect(validateCommitMessage("feat: add tests").valid).toBe(true);
  });

  test("validates clone urls", () => {
    expect(validateCloneUrl("file:///tmp/repo").safe).toBe(false);
    expect(validateCloneUrl("http://example.com/repo.git").safe).toBe(false);
    expect(validateCloneUrl("ftp://example.com/repo.git").safe).toBe(false);
    expect(validateCloneUrl("https://example.com/repo.git").safe).toBe(true);
    expect(validateCloneUrl("git@github.com:owner/repo.git").safe).toBe(true);
  });

  test("returns workspace root and amend/hard-reset policy", () => {
    const prior = process.env.GIT_WORKSPACE_ROOT;
    process.env.GIT_WORKSPACE_ROOT = ".";

    expect(path.isAbsolute(getGitWorkspaceRoot())).toBe(true);
    expect(canHardReset().allowed).toBe(true);
    expect(canAmendCommit("main").warning).toContain("protected branch");
    expect(canAmendCommit("feature/login").allowed).toBe(true);

    if (prior === undefined) {
      delete process.env.GIT_WORKSPACE_ROOT;
    } else {
      process.env.GIT_WORKSPACE_ROOT = prior;
    }
  });
});
