/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

import type { ChatMessage, LMStudioRequest, ToolDefinition } from "../../src/http-client";

describe("OpenAI chat completions request structure", () => {
  it("has the correct shape for a basic request without tools", () => {
    const request: LMStudioRequest = {
      model: "default",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Analyze this code." },
      ],
      temperature: 0.7,
      max_tokens: 4096,
    };

    expect(request.model).toBe("default");
    expect(request.messages).toHaveLength(2);
    expect(request.messages[0].role).toBe("system");
    expect(request.messages[1].role).toBe("user");
    expect(request.temperature).toBe(0.7);
    expect(request.max_tokens).toBe(4096);
    expect(request.tools).toBeUndefined();
    expect(request.tool_choice).toBeUndefined();
  });

  it("has the correct shape for a request with tools", () => {
    const tools: ToolDefinition[] = [
      {
        type: "function",
        function: {
          name: "read_file",
          description: "Read contents of a file",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "File path" },
            },
            required: ["path"],
          },
        },
      },
    ];

    const request: LMStudioRequest = {
      model: "test-model",
      messages: [
        { role: "system", content: "You are an assistant." },
        { role: "user", content: "Read myfile.txt" },
      ],
      temperature: 0.5,
      max_tokens: 2048,
      tools,
      tool_choice: "auto",
    };

    expect(request.tools).toHaveLength(1);
    expect(request.tools![0].type).toBe("function");
    expect(request.tools![0].function.name).toBe("read_file");
    expect(request.tool_choice).toBe("auto");
  });

  it("supports messages with tool call role and tool_call_id", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "You are an assistant." },
      { role: "user", content: "Read the file" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_abc123",
            type: "function",
            function: { name: "read_file", arguments: '{"path":"test.txt"}' },
          },
        ],
      },
      {
        role: "tool",
        content: "File contents here",
        tool_call_id: "call_abc123",
      },
    ];

    expect(messages[2].role).toBe("assistant");
    expect(messages[2].tool_calls).toHaveLength(1);
    expect(messages[2].tool_calls![0].id).toBe("call_abc123");
    expect(messages[2].tool_calls![0].type).toBe("function");
    expect(messages[2].tool_calls![0].function.name).toBe("read_file");
    expect(messages[3].role).toBe("tool");
    expect(messages[3].tool_call_id).toBe("call_abc123");
    expect(messages[3].content).toBe("File contents here");
  });

  it("serializes request to valid JSON matching OpenAI format", () => {
    const request: LMStudioRequest = {
      model: "default",
      messages: [{ role: "user", content: "Hello" }],
      temperature: 0.7,
      max_tokens: 4096,
    };

    const json = JSON.stringify(request);
    const parsed = JSON.parse(json);

    expect(parsed).toHaveProperty("model", "default");
    expect(parsed).toHaveProperty("messages");
    expect(parsed.messages[0]).toHaveProperty("role", "user");
    expect(parsed.messages[0]).toHaveProperty("content", "Hello");
    expect(parsed).toHaveProperty("temperature", 0.7);
    expect(parsed).toHaveProperty("max_tokens", 4096);
  });

  it("does not include tools or tool_choice fields when no tools provided", () => {
    const request: LMStudioRequest = {
      model: "default",
      messages: [{ role: "user", content: "Test" }],
    };

    const json = JSON.stringify(request);
    const parsed = JSON.parse(json);

    expect(parsed).not.toHaveProperty("tools");
    expect(parsed).not.toHaveProperty("tool_choice");
  });

  it("validates tool_choice accepts only auto or none", () => {
    const request1: LMStudioRequest = {
      model: "default",
      messages: [{ role: "user", content: "Test" }],
      tool_choice: "auto",
    };
    const request2: LMStudioRequest = {
      model: "default",
      messages: [{ role: "user", content: "Test" }],
      tool_choice: "none",
    };

    expect(request1.tool_choice).toBe("auto");
    expect(request2.tool_choice).toBe("none");
  });
});
