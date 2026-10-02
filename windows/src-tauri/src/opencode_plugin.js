// __MARKER__ — Awuuu for OpenCode. Installed and removed from Awuuu's Settings.
//
// Shows OpenCode sessions in Awuuu's island and lets permission requests be
// answered there. Every call goes through awuuu-hook.exe, which exits at once
// when Awuuu is not running; anything that goes wrong here is swallowed, so
// this plugin can never break OpenCode.

import { spawn } from "node:child_process";

const HOOK = "__AWUUU_HOOK__";
/** A permission request waits at most this long for a click in the island. */
const DECISION_MS = 112_000;

/** Hands one event to Awuuu. With `wait`, resolves to what the hook printed. */
function send(event, payload, wait = false) {
  return new Promise((resolve) => {
    try {
      const child = spawn(HOOK, ["--agent", "opencode", event], {
        stdio: ["pipe", wait ? "pipe" : "ignore", "ignore"],
        windowsHide: true,
      });
      let out = "";
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve(out);
      };
      child.on("error", finish);
      if (wait) {
        child.stdout.on("data", (d) => (out += d));
        child.on("close", finish);
        setTimeout(() => {
          try { child.kill(); } catch {}
          finish();
        }, DECISION_MS);
      } else {
        child.unref();
        finish();
      }
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify(payload));
    } catch {
      resolve("");
    }
  });
}

function textOf(parts) {
  return (parts ?? [])
    .filter((p) => p && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join(" ")
    .trim();
}

export const AwuuuPlugin = async ({ client, directory }) => {
  const cwd = directory;

  /** The last thing the assistant said in a session, for the island's log. */
  async function lastAnswer(sessionID) {
    try {
      const res = await client.session.messages({ path: { id: sessionID } });
      const messages = res?.data ?? res ?? [];
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m?.info?.role === "assistant") return textOf(m.parts).slice(0, 2000);
      }
    } catch {}
    return "";
  }

  return {
    event: async ({ event }) => {
      try {
        const props = event?.properties ?? {};
        switch (event?.type) {
          case "session.created":
            await send("SessionStart", { session_id: props.info?.id, cwd });
            break;
          case "session.idle": {
            const id = props.sessionID;
            await send("Stop", { session_id: id, cwd, last_assistant_message: await lastAnswer(id) });
            break;
          }
          case "session.error":
            await send("StopFailure", {
              session_id: props.sessionID,
              cwd,
              message: String(props.error?.data?.message ?? props.error?.name ?? "error"),
            });
            break;
          case "session.deleted":
            await send("SessionEnd", { session_id: props.info?.id, cwd });
            break;
        }
      } catch {}
    },

    "chat.message": async (input, output) => {
      try {
        await send("UserPromptSubmit", { session_id: input.sessionID, cwd, prompt: textOf(output?.parts) });
      } catch {}
    },

    "tool.execute.before": async (input, output) => {
      try {
        await send("PreToolUse", {
          session_id: input.sessionID,
          cwd,
          tool_name: input.tool,
          tool_input: output?.args ?? {},
          tool_use_id: input.callID,
        });
      } catch {}
    },

    "tool.execute.after": async (input) => {
      try {
        await send("PostToolUse", {
          session_id: input.sessionID,
          cwd,
          tool_name: input.tool,
          tool_input: input.args ?? {},
          tool_use_id: input.callID,
        });
      } catch {}
    },

    // Answer from the island; no answer leaves OpenCode's own prompt in place.
    "permission.ask": async (input, output) => {
      try {
        const pattern = Array.isArray(input.pattern) ? input.pattern.join(" ") : input.pattern;
        const reply = await send(
          "PermissionRequest",
          {
            session_id: input.sessionID,
            cwd,
            tool_name: input.type,
            tool_input: { command: pattern || input.title, description: input.title, ...(input.metadata ?? {}) },
            tool_use_id: input.callID,
          },
          true,
        );
        const v = JSON.parse(reply.trim() || "{}");
        if (v.status === "allow" || v.status === "deny") output.status = v.status;
      } catch {}
    },
  };
};
