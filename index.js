import { spawn } from "node:child_process";

// Notify the user when OMP needs tool approval
export default function customNotifications(pi) {
  pi.on("tool_approval_requested", () => {
    const notification = spawn(
      "/opt/homebrew/bin/terminal-notifier",
      [
        "-title",
        "OMP permission request",
        "-message",
        "A tool is waiting for your approval.",
        "-sound",
        "default",
        "-group",
        "omp-permission-approval",
      ],
      { stdio: "ignore" },
    );
    notification.on("error", (error) => {
      pi.logger?.warn(`Could not send approval notification: ${error.message}`);
    });
  });
}
