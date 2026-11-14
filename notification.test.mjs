import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";

// Verify approval notifications describe the requested tool and reason
test("approval requests show the tool and approval reason", async () => {
  const originalSpawn = childProcess.spawn;
  let invocation;
  childProcess.spawn = (command, args) => {
    invocation = { command, args };
    return new EventEmitter();
  };
  syncBuiltinESMExports();

  try {
    const { default: extension } = await import("./index.js");
    let handler;
    extension({
      on(event, fn) {
        if (event === "tool_approval_requested") handler = fn;
      },
    });
    assert.equal(typeof handler, "function");
    handler({
      toolName: "synthetic_tool",
      reason: "Restricted folder: /synthetic",
      input: { secret: "synthetic-secret" },
    });
    assert.equal(invocation.command, "/opt/homebrew/bin/terminal-notifier");
    assert.ok(invocation.args.includes("OMP [Permission Request]"));
    assert.ok(
      invocation.args.includes(
        "synthetic_tool — Restricted folder: /synthetic",
      ),
    );
    const soundIndex = invocation.args.indexOf("-sound");
    assert.ok(soundIndex >= 0);
    assert.equal(invocation.args[soundIndex + 1], "default");
    assert.ok(!invocation.args.join(" ").includes("synthetic-secret"));
  } finally {
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
  }
});

// Verify completed response notifications include their first line
test("completed responses notify once with the session and first response line", async () => {
  const originalSpawn = childProcess.spawn;
  const invocations = [];
  childProcess.spawn = (command, args) => {
    invocations.push({ command, args });
    return new EventEmitter();
  };
  syncBuiltinESMExports();
  try {
    const { default: extension } = await import("./index.js");
    const handlers = {};
    extension({
      getSessionName() {
        return "Synthetic session";
      },
      on(event, fn) {
        handlers[event] = fn;
      },
    });
    assert.equal(typeof handlers.agent_end, "function");
    const message = {
      role: "assistant",
      stopReason: "stop",
      content: [
        { type: "text", text: "First synthetic line\nSecond synthetic line" },
      ],
    };
    handlers.agent_end(
      { messages: [message], isTerminal: false },
      { hasUI: true },
    );
    handlers.agent_end(
      { messages: [{ ...message, stopReason: "aborted" }] },
      { hasUI: true },
    );
    handlers.agent_end({ messages: [message] }, { hasUI: false });
    assert.equal(invocations.length, 0);
    handlers.agent_end(
      { messages: [message], isTerminal: true },
      { hasUI: true },
    );
    assert.equal(invocations.length, 1);
    assert.ok(invocations[0].args.includes("OMP"));
    assert.ok(invocations[0].args.includes("Synthetic session"));
    assert.ok(invocations[0].args.includes("First synthetic line"));
    assert.ok(!invocations[0].args.join(" ").includes("Second synthetic line"));
    assert.ok(invocations[0].args.includes("default"));
  } finally {
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
  }
});

// Verify questions include the question text rather than answer options
test("interactive ask requests show the form question", async () => {
  const originalSpawn = childProcess.spawn;
  const invocations = [];
  childProcess.spawn = (command, args) => {
    invocations.push({ command, args });
    return new EventEmitter();
  };
  syncBuiltinESMExports();
  try {
    const { default: extension } = await import("./index.js");
    const handlers = {};
    extension({
      on(event, fn) {
        handlers[event] = fn;
      },
    });
    assert.equal(typeof handlers.tool_execution_start, "function");
    handlers.tool_execution_start({ toolName: "read" }, { hasUI: true });
    handlers.tool_execution_start({ toolName: "ask" }, { hasUI: false });
    assert.equal(invocations.length, 0);
    handlers.tool_execution_start(
      {
        toolName: "ask",
        args: {
          html: "<form><fieldset><legend>Choose &amp; proceed?</legend><label><input type='radio' name='choice' value='yes'>Yes</label></fieldset></form>",
        },
      },
      { hasUI: true },
    );
    assert.equal(invocations.length, 1);
    assert.ok(invocations[0].args.includes("OMP [Question]"));
    assert.ok(invocations[0].args.includes("default"));
    assert.ok(invocations[0].args.includes("Choose & proceed?"));
    assert.ok(!invocations[0].args.includes("Yes"));
    handlers.tool_execution_start(
      {
        toolName: "ask",
        args: {
          html: "<form><label>Project name? <input name='project'></label></form>",
        },
      },
      { hasUI: true },
    );
    assert.ok(invocations[1].args.includes("Project name?"));
  } finally {
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
  }
});

// Verify retry attempts remain silent until the retry chain fails or is cancelled
test("connection retries notify only when the retry chain ends unsuccessfully", async () => {
  const originalSpawn = childProcess.spawn;
  const invocations = [];
  childProcess.spawn = (command, args) => {
    invocations.push({ command, args });
    return new EventEmitter();
  };
  syncBuiltinESMExports();
  try {
    const { default: extension } = await import("./index.js");
    const handlers = {};
    extension({
      on(event, fn) {
        handlers[event] = fn;
      },
    });
    const failure = {
      role: "assistant",
      stopReason: "error",
      content: [],
      errorMessage: "Couldn't connect to example.invalid (connection refused).",
    };
    handlers.agent_end(
      { messages: [failure], isTerminal: false },
      { hasUI: true },
    );
    handlers.auto_retry_start({ attempt: 1 }, { hasUI: true });
    handlers.agent_end(
      { messages: [failure], isTerminal: false },
      { hasUI: true },
    );
    handlers.auto_retry_start({ attempt: 2 }, { hasUI: true });
    assert.equal(invocations.length, 0);
    handlers.auto_retry_end(
      { success: false, finalError: "Retry cancelled" },
      {
        hasUI: true,
        sessionManager: { getSessionId: () => "synthetic-session-id" },
      },
    );
    assert.equal(invocations.length, 1);
    assert.ok(invocations[0].args.includes("OMP [Error]"));
    assert.ok(invocations[0].args.includes("syntheti"));
    assert.ok(invocations[0].args.includes("Retry cancelled"));
    assert.ok(invocations[0].args.includes("default"));
    assert.ok(!invocations[0].args.join(" ").includes("example.invalid"));
    handlers.agent_end(
      { messages: [failure], isTerminal: true },
      { hasUI: true },
    );
    assert.equal(invocations.length, 1);
    handlers.before_agent_start({});
    handlers.agent_end(
      { messages: [failure], isTerminal: true },
      { hasUI: true },
    );
    assert.equal(invocations.length, 2);
    assert.ok(
      invocations[1].args.includes(
        "Couldn't connect to example.invalid (connection refused).",
      ),
    );
    handlers.auto_retry_start({ attempt: 1 }, { hasUI: true });
    handlers.auto_retry_end({ success: true }, { hasUI: true });
    assert.equal(invocations.length, 2);
  } finally {
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
  }
});
