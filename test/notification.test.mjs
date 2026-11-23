import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter, once } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Verify a notifier installed outside the default Homebrew path receives notifications
test("notifications reach terminal-notifier on PATH", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omp-notifier-test-"));
  const previousPath = process.env.PATH;
  const previousOutput = process.env.OMP_TEST_NOTIFICATION;
  const output = join(dir, "notification");
  const originalSpawn = childProcess.spawn;
  let notification;
  childProcess.spawn = (...args) => {
    notification = originalSpawn(...args);
    return notification;
  };
  syncBuiltinESMExports();
  try {
    const executable = join(dir, "terminal-notifier");
    await writeFile(
      executable,
      '#!/bin/sh\nprintf "%s\\n" "$@" > "$OMP_TEST_NOTIFICATION"\n',
    );
    await chmod(executable, 0o755);
    process.env.PATH = dir;
    process.env.OMP_TEST_NOTIFICATION = output;
    const { default: extension } = await import("../index.js");
    let handler;
    extension({
      on(event, fn) {
        if (event === "tool_approval_requested") handler = fn;
      },
    });
    handler({ toolName: "synthetic_tool", reason: "Synthetic approval" });
    const [exitCode] = await once(notification, "close");
    assert.equal(exitCode, 0);
    const content = await readFile(output, "utf8");
    assert.match(content, /synthetic_tool — Synthetic approval/);
  } finally {
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousOutput === undefined) delete process.env.OMP_TEST_NOTIFICATION;
    else process.env.OMP_TEST_NOTIFICATION = previousOutput;
    await rm(dir, { recursive: true, force: true });
  }
});

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
    const { default: extension } = await import("../index.js");
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

// Verify permission-system prompts reach the user with their session and request
test("permission system prompts send an approval notification", async () => {
  const originalSpawn = childProcess.spawn;
  const invocations = [];
  childProcess.spawn = (command, args) => {
    invocations.push({ command, args });
    return new EventEmitter();
  };
  syncBuiltinESMExports();
  try {
    const { default: extension } = await import("../index.js");
    const events = new EventEmitter();
    const handlers = new Map();
    extension({ events, on: (name, handler) => handlers.set(name, handler) });
    handlers.get("session_start")?.(
      {},
      {
        hasUI: true,
        sessionManager: { getSessionId: () => "12345678-synthetic" },
      },
    );
    events.emit("permissions:ui_prompt", {
      requestId: "synthetic-request",
      source: "tool_call",
      surface: "bash",
      value: "synthetic-command",
      agentName: null,
      request: {},
      forwarding: null,
    });
    assert.equal(invocations.length, 1);
    assert.ok(invocations[0].args.includes("OMP [Permission Request]"));
    assert.ok(invocations[0].args.includes("Session"));
    assert.ok(invocations[0].args.includes("bash — synthetic-command"));
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
    const { default: extension } = await import("../index.js");
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
    const { default: extension } = await import("../index.js");
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
    const { default: extension } = await import("../index.js");
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
