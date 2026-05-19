import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { join, dirname } from "node:path";
import { formatPrompt, pluralize, onOff, parseBool } from "./utils.js";
import defaults from "./defaults.json" with { type: "json" };

// ── Types ──────────────────────────────────────────────────────────

interface Config {
  /** Bark device key from the iOS app (e.g. from Settings → Servers) */
  barkKey: string;
  /** Custom Bark server URL. Defaults to https://api.day.app */
  barkServer: string;
  /** Which events trigger notifications */
  events: {
    /** Notify when agent finishes a response */
    agentEnd: boolean;
    /** Notify mid-turn when a configured prompt tool is called */
    promptTools: boolean;
    /** Notify after each individual LLM turn */
    turnEnd: boolean;
    /** Notify on tool execution errors */
    error: boolean;
  };
  /** Map of tool names to notification labels (e.g. ask_user: "Asking") */
  promptTools: Record<string, string>;
  /** iOS notification sound. "default" uses the system default. */
  sound: string;
  /** Notification title prefix shown on the lock screen */
  title: string;
  /** Custom notification icon URL. Empty string = Bark default. */
  icon: string;
  /** Include the hostname so you know which machine sent it */
  showHostname: boolean;
  /** Optional URL to open when notification is tapped (URL scheme) */
  url: string;
  /** Enable debug logging */
  debug: boolean;
}

const DEFAULT_CONFIG: Config = {
  barkKey: "",
  barkServer: "https://api.day.app",
  events: {
    agentEnd: true,
    promptTools: true,
    turnEnd: false,
    error: true,
  },
  promptTools: {
    ask_user: "Asking",
    "ask-user": "Asking",
    safe_shell_approve: "Permission",
  },
  sound: "default",
  title: "pi",
  icon: defaults.icon,
  showHostname: false,
  url: "",
  debug: false,
};

// ── Config persistence ─────────────────────────────────────────────

function getConfigPath(): string {
  return join(homedir(), ".pi", "ios-notify.json");
}

async function loadConfig(): Promise<Config> {
  try {
    const raw = await readFile(getConfigPath(), "utf-8");
    const saved = JSON.parse(raw);
    return {
      ...DEFAULT_CONFIG,
      ...saved,
      events: { ...DEFAULT_CONFIG.events, ...saved.events },
      promptTools: { ...DEFAULT_CONFIG.promptTools, ...saved.promptTools },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

async function saveConfig(config: Config): Promise<void> {
  const configPath = getConfigPath();
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
}

// ── Debug logging ─────────────────────────────────────────────────

function debugLog(ctx: ExtensionContext, config: Config, msg: string): void {
  if (!config.debug) return;
  ctx.ui.notify(`🔍 ${msg}`, "info");
}

// ── Bark notification ──────────────────────────────────────────────

interface BarkPayload {
  device_key?: string;
  title?: string;
  body?: string;
  sound?: string;
  group?: string;
  icon?: string;
  url?: string;
}

async function sendNotification(config: Config, titleSuffix: string, body: string): Promise<void> {
  if (!config.barkKey) return;

  const baseUrl = config.barkServer.replace(/\/+$/, "");
  const url = `${baseUrl}/push`;
  let title = config.title;
  if (titleSuffix) title += ` ${titleSuffix}`;
  if (config.showHostname) body += `\n\u2500\u2500 ${hostname()}`;

  const payload: BarkPayload = {
    device_key: config.barkKey,
    title,
    body,
    sound: config.sound,
    group: "pi-ios-notify",
  };

  if (config.icon) payload.icon = config.icon;
  if (config.url) payload.url = config.url;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`[pi-ios-notify] Bark returned ${response.status}: ${await response.text()}`);
    }
  } catch (err) {
    console.error("[pi-ios-notify] Failed to send notification:", err);
  }
}

// ── Extension entry point ──────────────────────────────────────────

export default async function (pi: ExtensionAPI) {
  const config = await loadConfig();

  // Track state across events in the same prompt cycle
  let currentPrompt = "";
  let turnCount = 0;
  let notifiedErrorThisTurn = false;
  let notifiedPromptToolThisTurn = false;

  // ── Notify user on first load if unconfigured ────────────────
  if (!config.barkKey) {
    pi.on("session_start", async (_event, ctx) => {
      ctx.ui.notify(
        "📱 pi-ios-notify: No Bark key set. Run /ios-notify setup to configure.",
        "info",
      );
    });
  }

  // ── Capture user prompts & reset per-turn state ──────────
  pi.on("before_agent_start", async (event, ctx) => {
    debugLog(ctx, config, `before_agent_start prompt="${formatPrompt(event.prompt)}"`);
    currentPrompt = event.prompt;
    turnCount = 0;
    notifiedErrorThisTurn = false;
    notifiedPromptToolThisTurn = false;
  });

  // ── Agent completed a response ───────────────────────
  pi.on("agent_end", async (_event, ctx) => {
    debugLog(ctx, config, `agent_end agentEnd=${config.events.agentEnd}`);
    if (!config.events.agentEnd || !config.barkKey) return;

    let body: string;

    if (currentPrompt) {
      if (turnCount > 1) {
        body = `"${formatPrompt(currentPrompt)}" (${turnCount} ${pluralize(turnCount, "turn", "turns")})`;
      } else {
        body = `"${formatPrompt(currentPrompt)}"`;
      }
    } else {
      body = `Completed (${turnCount} ${pluralize(turnCount, "turn", "turns")})`;
    }

    await sendNotification(config, "✅ Complete", body);
    currentPrompt = "";
    turnCount = 0;
    notifiedErrorThisTurn = false;
    notifiedPromptToolThisTurn = false;
  });

  // ── Per-turn notification (optional) ─────────────────────────
  pi.on("turn_end", async (event, ctx) => {
    turnCount++;
    debugLog(ctx, config, `turn_end index=${event.turnIndex} turnEnd=${config.events.turnEnd}`);
    if (!config.events.turnEnd || !config.barkKey) return;
    await sendNotification(config, "🔄 Turn", `Turn ${event.turnIndex} finished`);
  });

  // ── Error notification (throttled: once per turn) ──────────
  pi.on("tool_result", async (event, ctx) => {
    debugLog(ctx, config, `tool_result name=${event.toolName} isError=${event.isError} error=${config.events.error} throttled=${notifiedErrorThisTurn}`);
    if (!config.events.error || !config.barkKey) return;
    if (notifiedErrorThisTurn) return;
    if (!event.isError) return;

    notifiedErrorThisTurn = true;
    const toolLabel = event.toolName ?? "unknown";
    await sendNotification(config, "⚠️ Error", `Error in ${toolLabel}`);
  });

  // ── Prompt tool notification (throttled: once per turn) ──
  pi.on("tool_call", async (event, ctx) => {
    const label = config.promptTools[event.toolName];
    debugLog(ctx, config, `tool_call name=${event.toolName} inPromptTools=${!!label} promptTools=${config.events.promptTools} throttled=${notifiedPromptToolThisTurn}`);
    if (!config.events.promptTools || !config.barkKey) return;
    if (notifiedPromptToolThisTurn) return;
    if (!label) return;

    notifiedPromptToolThisTurn = true;
    await sendNotification(config, label, event.toolName);
  });

  // ── Cross-extension notification event ─────────────────────
  // Any extension can emit pi-ios-notify:notify with { title, body, source? }
  pi.events.on("pi-ios-notify:notify", (data: unknown) => {
    const { title, body } = data as { title?: string; body?: string };
    if (!title || !body) return;
    if (!config.events.promptTools || !config.barkKey) return;
    sendNotification(config, title, body);
  });

  // ── /ios-notify command ──────────────────────────────────────
  pi.registerCommand("ios-notify", {
    description: "Configure iOS notifications via Bark",
    handler: async (_args, ctx) => {
      const parts = (_args ?? "").trim().split(/\s+/);
      const cmd = parts[0]?.toLowerCase();

      switch (cmd) {
        // ── setup ─────────────────────────────────────────
        case "setup": {
          const key = await ctx.ui.input("Bark device key:", config.barkKey);
          if (key && key.trim()) {
            config.barkKey = key.trim();
            await saveConfig(config);
            ctx.ui.notify("✅ Bark key saved. Run /ios-notify test to verify.", "info");
          } else {
            ctx.ui.notify("Setup cancelled.", "info");
          }
          return;
        }

        // ── test ──────────────────────────────────────────
        case "test": {
          if (!config.barkKey) {
            ctx.ui.notify("❌ No Bark key set. Run /ios-notify setup first.", "error");
            return;
          }
          debugLog(ctx, config, "send test notification");
          await sendNotification(config, "🔔 Test", "iOS notifications are working!");
          ctx.ui.notify("📱 Test notification sent! Check your iPhone.", "success");
          return;
        }

        // ── status ────────────────────────────────────────
        case "status": {
          const lines: string[] = [];
          lines.push(`Bark: ${config.barkKey ? "✅" : "❌"}  Server: ${config.barkServer}`);
          lines.push(`Events: agent-end:${onOff(config.events.agentEnd)}  prompt-tools:${onOff(config.events.promptTools)}  turn-end:${onOff(config.events.turnEnd)}  errors:${onOff(config.events.error)}`);
          const toolNames = Object.keys(config.promptTools);
          lines.push(`Prompt tools: ${toolNames.length ? toolNames.join(", ") : "none"}`);
          lines.push(`Sound: ${config.sound}  Icon: ${config.icon ? "✅" : "default"}  Debug: ${onOff(config.debug)}`);
          lines.push(`URL: ${config.url || "not set"}`);

          ctx.ui.notify(`📱 pi-ios-notify status\n${lines.join("\n")}`, "info");
          return;
        }

        // ── events ────────────────────────────────────────
        case "events": {
          const event = parts[1];
          const value = parseBool(parts[2]);

          if (!event || value === undefined) {
            ctx.ui.notify("Usage: /ios-notify events <agent-end|prompt-tools|turn-end|error> <true|false>", "error");
            return;
          }

          let changed = false;
          if (event === "agent-end") { config.events.agentEnd = value; changed = true; }
          if (event === "prompt-tools") { config.events.promptTools = value; changed = true; }
          if (event === "turn-end") { config.events.turnEnd = value; changed = true; }
          if (event === "error") { config.events.error = value; changed = true; }

          if (!changed) {
            ctx.ui.notify(`Unknown event "${event}". Options: agent-end, prompt-tools, turn-end, error`, "error");
            return;
          }

          await saveConfig(config);
          ctx.ui.notify(`✅ Event "${event}" → ${onOff(value)}`, "info");
          return;
        }

        // ── prompt-tools ─────────────────────────────────
        case "prompt-tools": {
          const sub = parts[1]?.toLowerCase();

          if (sub === "list") {
            const names = Object.keys(config.promptTools);
            if (names.length === 0) {
              ctx.ui.notify("No prompt tools configured.", "info");
            } else {
              const formatted = names.map(n => `  • ${n} → "${config.promptTools[n]}"`).join("\n");
              pi.sendMessage({
                customType: "ios-notify-prompt-tools",
                content: `🔧 **Configured prompt tools:**\n${formatted}`,
                display: true,
              });
            }
            return;
          }

          if (sub === "add") {
            const toolName = parts[2];
            const label = parts.slice(3).join(" ") || toolName;
            if (!toolName) {
              ctx.ui.notify("Usage: /ios-notify prompt-tools add <tool-name> [label]", "error");
              return;
            }
            config.promptTools[toolName] = label;
            await saveConfig(config);
            ctx.ui.notify(`✅ Added "${toolName}" → "${label}"`, "info");
            return;
          }

          if (sub === "remove") {
            const toolName = parts[2];
            if (!toolName) {
              ctx.ui.notify("Usage: /ios-notify prompt-tools remove <tool-name>", "error");
              return;
            }
            if (!config.promptTools[toolName]) {
              ctx.ui.notify(`"${toolName}" not in configured prompt tools.`, "error");
              return;
            }
            delete config.promptTools[toolName];
            await saveConfig(config);
            ctx.ui.notify(`✅ Removed "${toolName}"`, "info");
            return;
          }

          if (sub === "clear") {
            config.promptTools = {};
            await saveConfig(config);
            ctx.ui.notify("✅ All prompt tools cleared.", "info");
            return;
          }

          ctx.ui.notify("Usage: /ios-notify prompt-tools <list|add|remove|clear> ...", "error");
          return;
        }

        // ── sound ─────────────────────────────────────────
        case "sound": {
          const sound = parts[1];
          if (!sound) {
            ctx.ui.notify("Usage: /ios-notify sound <name>. Pick from Bark app sounds.", "error");
            return;
          }
          config.sound = sound;
          await saveConfig(config);
          ctx.ui.notify(`✅ Sound set to "${sound}"`, "info");
          return;
        }

        // ── icon ──────────────────────────────────────────
        case "icon": {
          const iconVal = parts.slice(1).join(" ");
          if (!iconVal || iconVal === "default") {
            config.icon = "";
            await saveConfig(config);
            ctx.ui.notify("✅ Icon reset to Bark default.", "info");
          } else if (iconVal === "pi") {
            config.icon = defaults.icon;
            await saveConfig(config);
            ctx.ui.notify("✅ Icon set to pi default icon.", "info");
          } else {
            config.icon = iconVal;
            await saveConfig(config);
            ctx.ui.notify("✅ Custom icon set. Send a test to verify.", "info");
          }
          return;
        }

        // ── url ───────────────────────────────────────────
        case "url": {
          const urlVal = parts.slice(1).join(" ");
          config.url = urlVal;
          await saveConfig(config);
          ctx.ui.notify(`${urlVal ? `✅ URL set to "${urlVal}"` : "✅ URL cleared"}`, "info");
          return;
        }

        // ── debug ────────────────────────────────────────
        case "debug": {
          const val = parseBool(parts[1]);
          if (val === undefined) {
            ctx.ui.notify("Usage: /ios-notify debug <on|off>", "error");
            return;
          }
          config.debug = val;
          await saveConfig(config);
          ctx.ui.notify(`✅ Debug logging → ${onOff(val)}`, "info");
          return;
        }

        // ── hostname ──────────────────────────────────────
        case "hostname": {
          const val = parseBool(parts[1]);
          if (val === undefined) {
            ctx.ui.notify("Usage: /ios-notify hostname <true|false>", "error");
            return;
          }
          config.showHostname = val;
          await saveConfig(config);
          ctx.ui.notify(`✅ Show hostname → ${onOff(val)}`, "info");
          return;
        }

        default: {
          ctx.ui.notify(
            "Commands: setup, test, status, events <agent-end|prompt-tools|turn-end|error> <bool>, prompt-tools <list|add|remove|clear>, sound <name>, icon <url|pi|default>, url <value>, debug <on|off>, hostname <bool>",
            "info",
          );
          return;
        }
      }
    },
  });
}
