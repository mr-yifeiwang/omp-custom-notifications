import { spawn } from "node:child_process";

// Notify the user when OMP needs attention
export default function customNotifications(pi) {
  let retrying = false;
  let retryFailureNotified = false;

  function notify(title, message, group) {
    const notification = spawn(
      "/opt/homebrew/bin/terminal-notifier",
      [
        "-title",
        title,
        "-message",
        message,
        "-sound",
        "default",
        "-group",
        group,
      ],
      { stdio: "ignore" },
    );
    notification.on("error", (error) => {
      pi.logger?.warn(`Could not send notification: ${error.message}`);
    });
  }
  // Track retry completion separately from intermediate provider errors
  pi.on("before_agent_start", () => {
    retryFailureNotified = false;
  });

  pi.on("auto_retry_start", () => {
    retrying = true;
  });

  pi.on("auto_retry_end", (event, ctx) => {
    retrying = false;
    if (event.success || !ctx.hasUI) return;
    retryFailureNotified = true;
    notify(
      "OMP error",
      "The request failed or its retry was cancelled. Check the session for details.",
      "omp-error",
    );
  });

  // Notify when an assistant response finishes or fails
  pi.on("agent_end", (event, ctx) => {
    if (!ctx.hasUI || event.isTerminal === false) return;
    const last = event.messages.at(-1);
    if (last?.role === "assistant" && last.stopReason === "error") {
      if (retrying || retryFailureNotified) return;
      notify(
        "OMP error",
        "The assistant encountered an error. Check the session for details.",
        "omp-error",
      );
      return;
    }
    if (
      last?.role !== "assistant" ||
      last.stopReason !== "stop" ||
      !last.content.some((part) => part.type === "text" && part.text.trim())
    )
      return;
    notify(
      "OMP response ready",
      "The assistant has finished responding.",
      "omp-response-ready",
    );
  });

  // Notify when a tool requires approval
  pi.on("tool_approval_requested", () => {
    notify(
      "OMP permission request",
      "A tool is waiting for your approval.",
      "omp-permission-approval",
    );
  });

  // Notify when a question requires an answer
  pi.on("tool_execution_start", (event, ctx) => {
    if (event.toolName !== "ask" || !ctx.hasUI) return;
    notify(
      "OMP question",
      "The assistant is waiting for your answer.",
      "omp-question",
    );
  });
}
