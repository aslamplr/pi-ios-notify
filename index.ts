import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
    /** Notify when agent finishes and needs user input */
    idle: boolean;
    /** Notify after each individual LLM turn */
    turnEnd: boolean;
    /** Notify on tool execution errors */
    error: boolean;
    /** Notify when agent requests permission (bash, file writes, etc.) */
    permission: boolean;
  };
  /** iOS notification sound. "default" uses the system default. */
  sound: string;
  /** Notification title prefix shown on the lock screen */
  title: string;
  /** Custom notification icon URL. Empty string = Bark default. */
  icon: string;
  /** Include the hostname so you know which machine sent it */
  showHostname: boolean;
}

const DEFAULT_CONFIG: Config = {
  barkKey: "",
  barkServer: "https://api.day.app",
  events: {
    idle: true,
    turnEnd: false,
    error: true,
    permission: true,
  },
  sound: "default",
  title: "pi",
  icon: defaults.icon,
  showHostname: false,
};

// ── Config persistence ─────────────────────────────────────────────

function getConfigPath(): string {
  return join(homedir(), ".pi", "ios-notify.json");
}

async function loadConfig(): Promise<Config> {
  try {
    const raw = await readFile(getConfigPath(), "utf-8");
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

async function saveConfig(config: Config): Promise<void> {
  const configPath = getConfigPath();
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
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
  let notifiedPermissionThisTurn = false;

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
  pi.on("before_agent_start", async (event) => {
    currentPrompt = event.prompt;
    turnCount = 0;
    notifiedPermissionThisTurn = false;
  });

  // ── Agent idle — needs user input ───────────────────────
  pi.on("agent_end", async () => {
    if (!config.events.idle || !config.barkKey) return;

    let body: string;

    if (currentPrompt) {
      if (turnCount > 1) {
        body = `"${formatPrompt(currentPrompt)}" (${turnCount} ${pluralize(turnCount, "turn", "turns")})`;
      } else {
        body = `"${formatPrompt(currentPrompt)}"`;
      }
    } else {
      body = `Waiting for input (${turnCount} ${pluralize(turnCount, "turn", "turns")})`;
    }

    await sendNotification(config, "💬 Needs input", body);
    currentPrompt = "";
    turnCount = 0;
    notifiedPermissionThisTurn = false;
  });

  // ── Per-turn notification (optional) ─────────────────────────
  pi.on("turn_end", async (event) => {
    turnCount++;
    if (!config.events.turnEnd || !config.barkKey) return;
    await sendNotification(config, "🔄 Turn", `Turn ${event.turnIndex} finished`);
  });

  // ── Error notification ───────────────────────────────────────
  pi.on("tool_result", async (event) => {
    if (!config.events.error || !config.barkKey) return;
    if (event.isError) {
      const toolLabel = event.toolName ?? "unknown";
      await sendNotification(config, "⚠️ Error", `Error in ${toolLabel}`);
    }
  });

  // ── Permission notification — agent wants to run sensitive tools ──
  const PERMISSION_TOOLS = new Set(["bash", "write", "edit", "rm", "mv", "sudo"]);

  pi.on("tool_call", async (event) => {
    if (!config.events.permission || !config.barkKey) return;
    if (notifiedPermissionThisTurn) return;
    if (!PERMISSION_TOOLS.has(event.toolName)) return;

    notifiedPermissionThisTurn = true;

    let detail = event.toolName;
    if (event.toolName === "bash" && event.input?.command) {
      const cmd = (event.input.command as string).slice(0, 80);
      detail = `bash: ${cmd}${cmd.length >= 80 ? "…" : ""}`;
    }

    await sendNotification(config, "🔑 Permission", `${detail}`);
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
          await sendNotification(config, "🔔 Test", "iOS notifications are working!");
          ctx.ui.notify("📱 Test notification sent! Check your iPhone.", "success");
          return;
        }

        // ── status ────────────────────────────────────────
        case "status": {
          const lines: string[] = [];
          lines.push(`**Bark:** ${config.barkKey ? "✅ Configured" : "❌ Not set"}`);
          lines.push(`**Server:** ${config.barkServer}`);
          lines.push(`**Events:** idle ${onOff(config.events.idle)} · turn-end ${onOff(config.events.turnEnd)} · errors ${onOff(config.events.error)} · permission ${onOff(config.events.permission)}`);
          lines.push(`**Sound:** ${config.sound}  **Icon:** ${config.icon ? "✅ Set" : "Default"}`);

          pi.sendMessage({
            customType: "ios-notify-status",
            content: `📱 **pi-ios-notify status**\n${lines.join("\n")}`,
            display: true,
          });
          return;
        }

        // ── events ────────────────────────────────────────
        case "events": {
          const event = parts[1];
          const value = parseBool(parts[2]);

          if (!event || value === undefined) {
            ctx.ui.notify("Usage: /ios-notify events <idle|turn-end|error|permission> <true|false>", "error");
            return;
          }

          let changed = false;
          if (event === "idle") { config.events.idle = value; changed = true; }
          if (event === "turn-end") { config.events.turnEnd = value; changed = true; }
          if (event === "error") { config.events.error = value; changed = true; }
          if (event === "permission") { config.events.permission = value; changed = true; }

          if (!changed) {
            ctx.ui.notify(`Unknown event "${event}". Options: idle, turn-end, error, permission`, "error");
            return;
          }

          await saveConfig(config);
          ctx.ui.notify(`✅ Event "${event}" → ${onOff(value)}`, "info");
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
            "Commands: setup, test, status, events <idle|turn-end|error|permission> <bool>, sound <name>, icon <url|pi|default>, hostname <bool>",
            "info",
          );
          return;
        }
      }
    },
  });
}
