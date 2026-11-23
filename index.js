import { spawn } from "node:child_process";
import { parse } from "parse5";

// Extract the first question from an ask form without including answer options
function questionText(html) {
  if (typeof html !== "string") return "";
  const tree = parse(html);
  const find = (node, predicate) => {
    if (predicate(node)) return node;
    for (const child of node.childNodes ?? []) {
      const found = find(child, predicate);
      if (found) return found;
    }
  };
  const text = (node) => {
    if (node.nodeName === "#text") return node.value;
    if (["script", "style", "select", "textarea"].includes(node.tagName))
      return "";
    return (node.childNodes ?? []).map(text).join("");
  };
  const form = find(tree, (node) => node.tagName === "form");
  if (!form) return "";
  const candidate = find(form, (node) => {
    if (["legend", "p", "h1", "h2", "h3"].includes(node.tagName))
      return !!text(node).trim();
    if (node.tagName !== "label") return false;
    const choice = find(
      node,
      (child) =>
        child.tagName === "input" &&
        child.attrs?.some(
          (attr) =>
            attr.name === "type" &&
            ["radio", "checkbox"].includes(attr.value.toLowerCase()),
        ),
    );
    return !choice && !!text(node).trim();
  });
  return candidate ? text(candidate).replace(/\s+/g, " ").trim() : "";
}

// Notify the user when OMP needs attention
export default function customNotifications(pi) {
  let retrying = false;
  let retryFailureNotified = false;

  function notify(title, message, group, ctx) {
    const session =
      pi.getSessionName?.()?.trim() ||
      ctx?.sessionManager?.getSessionId()?.slice(0, 8) ||
      "Session";
    const notification = spawn(
      "terminal-notifier",
      [
        "-title",
        title ? `OMP [${title}]` : "OMP",
        "-subtitle",
        session,
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

  function firstLine(text, fallback) {
    return typeof text === "string"
      ? text.trim().split(/\r?\n/, 1)[0] || fallback
      : fallback;
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
      "Error",
      firstLine(
        event.finalError,
        "The request failed. Check the session for details.",
      ),
      "omp-error",
      ctx,
    );
  });

  // Notify when an assistant response finishes or fails
  pi.on("agent_end", (event, ctx) => {
    if (!ctx.hasUI || event.isTerminal === false) return;
    const last = event.messages.at(-1);
    if (last?.role === "assistant" && last.stopReason === "error") {
      if (retrying || retryFailureNotified) return;
      notify(
        "Error",
        firstLine(
          last.errorMessage,
          "The request failed. Check the session for details.",
        ),
        "omp-error",
        ctx,
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
      "",
      firstLine(
        last.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join(""),
        "Response ready",
      ),
      "omp-response-ready",
      ctx,
    );
  });

  // Notify when a tool requires approval
  pi.on("tool_approval_requested", (event, ctx) => {
    const tool = event.toolName || "Tool";
    const detail = event.reason
      ? `${tool} — ${event.reason}`
      : `${tool} requires approval.`;
    notify(
      "Permission Request",
      firstLine(detail, "A tool is waiting for your approval."),
      "omp-permission-approval",
      ctx,
    );
  });

  // Notify when @gotgenes/pi-permission-system requires approval
  pi.events?.on("permissions:ui_prompt", (event) => {
    const surface = firstLine(event?.surface, "Tool");
    const value = firstLine(event?.value, "");
    notify(
      "Permission Request",
      value ? `${surface} — ${value}` : `${surface} requires approval.`,
      "omp-permission-approval",
    );
  });

  // Notify when a question requires an answer
  pi.on("tool_execution_start", (event, ctx) => {
    if (event.toolName !== "ask" || !ctx.hasUI) return;
    notify(
      "Question",
      questionText(event.args?.html) ||
        "The assistant is waiting for your answer.",
      "omp-question",
      ctx,
    );
  });
}
