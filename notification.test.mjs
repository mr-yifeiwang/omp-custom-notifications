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
