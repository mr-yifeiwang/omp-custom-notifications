import { spawn } from "node:child_process";

// Notify the user when OMP needs attention
export default function customNotifications(pi) {
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

  // Notify when an assistant response is complete
  pi.on("agent_end", (event, ctx) => {
    if (!ctx.hasUI || event.isTerminal === false) return;
    const last = event.messages.at(-1);
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
}
