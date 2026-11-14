import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";

// Verify approval notifications request a sound without exposing tool arguments
test("approval requests produce an audible notification without exposing arguments", async () => {
  const originalSpawn = childProcess.spawn;
  let invocation;
  childProcess.spawn = (command, args) => {
    invocation = { command, args };
    return new EventEmitter();
  };
  syncBuiltinESMExports();

  try {
    const source = await readFile(
      new URL("./index.js", import.meta.url),
      "utf8",
    );
    const { default: extension } = await import(
      `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
    );
    let handler;
    extension({
      on(event, fn) {
        if (event === "tool_approval_requested") handler = fn;
      },
    });
    assert.equal(typeof handler, "function");
    handler({
      toolName: "synthetic_tool",
      input: { secret: "synthetic-secret" },
    });
    assert.equal(invocation.command, "/opt/homebrew/bin/terminal-notifier");
    assert.ok(invocation.args.includes("OMP permission request"));
    const soundIndex = invocation.args.indexOf("-sound");
    assert.ok(soundIndex >= 0);
    assert.equal(invocation.args[soundIndex + 1], "default");
    assert.ok(!invocation.args.join(" ").includes("synthetic-secret"));
  } finally {
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
  }
});

// Verify only completed assistant responses trigger a private notification
test("completed responses notify once without exposing response text", async () => {
  const originalSpawn = childProcess.spawn;
  const invocations = [];
  childProcess.spawn = (command, args) => {
    invocations.push({ command, args });
    return new EventEmitter();
  };
  syncBuiltinESMExports();
  try {
    const source = await readFile(
      new URL("./index.js", import.meta.url),
      "utf8",
    );
    const { default: extension } = await import(
      `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
    );
    const handlers = {};
    extension({
      on(event, fn) {
        handlers[event] = fn;
      },
    });
    assert.equal(typeof handlers.agent_end, "function");
    const message = {
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "text", text: "synthetic-secret" }],
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
    assert.ok(invocations[0].args.includes("OMP response ready"));
    assert.ok(invocations[0].args.includes("default"));
    assert.ok(!invocations[0].args.join(" ").includes("synthetic-secret"));
  } finally {
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
  }
});

// Verify questions trigger an audible notification without disclosing form content
test("interactive ask requests notify without exposing the question", async () => {
  const originalSpawn = childProcess.spawn;
  const invocations = [];
  childProcess.spawn = (command, args) => {
    invocations.push({ command, args });
    return new EventEmitter();
  };
  syncBuiltinESMExports();
  try {
    const source = await readFile(
      new URL("./index.js", import.meta.url),
      "utf8",
    );
    const { default: extension } = await import(
      `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
    );
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
      { toolName: "ask", args: { html: "<form>synthetic-secret</form>" } },
      { hasUI: true },
    );
    assert.equal(invocations.length, 1);
    assert.ok(invocations[0].args.includes("OMP question"));
    assert.ok(invocations[0].args.includes("default"));
    assert.ok(!invocations[0].args.join(" ").includes("synthetic-secret"));
  } finally {
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
  }
});
