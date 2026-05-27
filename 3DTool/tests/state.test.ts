import { stateManager } from "../src/state";

describe("stateManager", () => {
  beforeEach(() => {
    // Reset state before each test
    stateManager.pollInteractions(); // clear queue
    stateManager.currentWorkspace = null;
    stateManager.currentFile = null;
  });

  test("should add and poll interactions", () => {
    const event = stateManager.addInteraction({
      x: 1,
      y: 2,
      z: 3,
      meshId: "test-mesh",
      prompt: "make it bigger",
    });

    expect(event.id).toBeDefined();
    expect(event.timestamp).toBeDefined();
    expect(event.prompt).toBe("make it bigger");

    const polled = stateManager.pollInteractions();
    expect(polled.length).toBe(1);
    expect(polled[0].id).toBe(event.id);

    // Queue should be empty after polling
    const polled2 = stateManager.pollInteractions();
    expect(polled2.length).toBe(0);
  });

  test("should set file and maintain current workspace", () => {
    stateManager.setFile("/test/workspace", "model.obj");
    expect(stateManager.currentWorkspace).toBe("/test/workspace");
    expect(stateManager.currentFile).toBe("model.obj");
  });
});
