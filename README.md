# pi-ios-notify 📱

Send iOS push notifications via [Bark](https://github.com/Finb/Bark) when pi completes agent turns. Get notified right on your iPhone when long-running tasks finish, errors occur, or after each individual turn — without watching the terminal.

**Package:** `@aslamplr/pi-ios-notify`
**Repository:** [github.com/aslamplr/pi-ios-notify](https://github.com/aslamplr/pi-ios-notify)

[![CI](https://github.com/aslamplr/pi-ios-notify/actions/workflows/ci.yml/badge.svg)](https://github.com/aslamplr/pi-ios-notify/actions/workflows/ci.yml)

## How it works

```
pi (your Mac)
  │
  │ agent completes a turn → extension fires
  │
  ▼
pi-ios-notify extension
  │
  │ POST https://api.day.app/YOUR_KEY
  │ { title: "✅ pi Complete", body: "…" }
  │
  ▼
Bark server → Apple Push Notification service → Your iPhone 📱
```

## Prerequisites

1. **Bark iOS app** — [Free on the App Store](https://apps.apple.com/app/id1403753865)
2. **A computer running pi** (macOS, Linux, or Windows)
3. pi 0.50+ (uses native `fetch` and `ExtensionAPI`)

## Installation

### via npm

```bash
pi install npm:@aslamplr/pi-ios-notify
```

### via git

```bash
pi install git:github.com/aslamplr/pi-ios-notify
```

### Manual (local path)

```bash
pi install /path/to/pi-ios-notify
```

### Quick test (no install)

```bash
pi -e /path/to/pi-ios-notify
```

## Setup

### 1. Get your Bark device key

1. Install [Bark](https://apps.apple.com/app/id1403753865) on your iPhone
2. Open the app — you'll see your device key URL, like:
   ```
   https://api.day.app/YOUR_DEVICE_KEY_HERE
   ```
3. Copy the `YOUR_DEVICE_KEY_HERE` part (the UUID string)

### 2. Configure the extension

Inside pi, run:

```
/ios-notify setup
```

Paste your Bark device key when prompted.

### 3. Test it

```
/ios-notify test
```

You should receive a "🔔 Test" notification on your iPhone within a second or two.

## Commands

| Command | Description |
|---------|-------------|
| `/ios-notify setup` | Enter your Bark device key |
| `/ios-notify test` | Send a test notification |
| `/ios-notify status` | Show current configuration |
| `/ios-notify events <type> <true\|false>` | Enable/disable notification types (`agent-end`, `prompt-tools`, `turn-end`, `error`) |
| `/ios-notify prompt-tools list` | List configured prompt tool names and labels |
| `/ios-notify prompt-tools add <name> [label]` | Add a tool name to watch with optional label |
| `/ios-notify prompt-tools remove <name>` | Remove a tool from the watch list |
| `/ios-notify prompt-tools clear` | Remove all prompt tools |
| `/ios-notify sound <name>` | Set notification sound |
| `/ios-notify icon <url|pi|default>` | Set a custom notification icon |
| `/ios-notify url <value>` | Set optional URL to open when notification is tapped (URL scheme, e.g. `ssh://user@host`) |
| `/ios-notify debug <on\|off>` | Enable/disable debug logging |
| `/ios-notify hostname <true\|false>` | Append hostname to notifications |

### Notification events

| Event | Default | Description |
|-------|---------|-------------|
| `agent-end` | ✅ on | Notify when agent finishes a response |
| `prompt-tools` | ✅ on | Notify mid-turn when a configured tool calls for user input |
| `turn-end` | ❌ off | Notify after each individual LLM turn (can be noisy!) |
| `error` | ✅ on | Notify when a tool execution fails |

Toggle with:

```
/ios-notify events agent-end false
/ios-notify events prompt-tools false
/ios-notify events turn-end true
/ios-notify events error false
```

### Prompt tools

Prompt tools are tools registered by extensions that may ask for user input mid-turn (e.g. `ask_user` from pi-ask-user, `safe_shell_approve` from pi-safe-shell). When the LLM calls one of these tools, you get notified immediately.

Configure which tools to watch:

```
/ios-notify prompt-tools list
/ios-notify prompt-tools add my_custom_tool "My Label"
/ios-notify prompt-tools remove ask_user
```

The label is shown as the notification title suffix. Default configured tools:

| Tool | Label | Source |
|------|-------|--------|
| `ask_user` | Asking | pi-ask-user extension |
| `ask-user` | Asking | pi-ask-user extension |
| `safe_shell_approve` | Permission | pi-safe-shell extension |

### Cross-extension notifications

Any extension can send a push notification by emitting an event on pi's [shared event bus](https://pi.dev/docs/latest/extensions#pi-events):

```typescript
pi.events.emit("pi-ios-notify:notify", {
  title: "🔒 Approval needed",
  body: "bash: rm -rf node_modules",
  source: "safe-shell", // optional
});
```

pi-ios-notify listens for `pi-ios-notify:notify` and forwards the `title` and `body` to Bark. The emitter controls the notification content entirely. Requires the `prompt-tools` event toggle to be enabled.

See the companion extension [@aslamplr/pi-safe-shell](https://github.com/aslamplr/pi-safe-shell) for a usage example — it emits `pi-ios-notify:notify` before blocking on user approval prompts.

### Custom icon

```
/ios-notify icon https://example.com/my-icon.png
```

Use `default` to reset to Bark's default icon, or `pi` to use the pi logo:

```
/ios-notify icon pi
/ios-notify icon default
```

### Notification URL

Set a URL that opens when the notification is tapped. Supports any URL scheme:

```
/ios-notify url ssh://user@myserver          # opens Termius/Blink (SSH)
/ios-notify url https://my-dashboard.com      # opens Safari
/ios-notify url pi://settings                 # custom scheme
/ios-notify url ""                            # clear (no-op on tap)
```

### Debug mode

Enable debug logging to see why notifications are or aren't firing:

```
/ios-notify debug on
```

Output appears in pi's stderr with `[pi-ios-notify:debug]` prefix. Each event handler logs its name, relevant config state, and throttle flags:

```
[pi-ios-notify:debug] tool_call name=ask_user inPromptTools=true promptTools=true throttled=false
[pi-ios-notify:debug] send title="pi Asking" body="ask_user"
[pi-ios-notify:debug] agent_end agentEnd=true
[pi-ios-notify:debug] send title="pi ✅ Complete" body="..."
```

Turn off with:

```
/ios-notify debug off
```

### Notification sounds

Bark supports various iOS notification sounds. Change with:

```
/ios-notify sound birdsong
```

Common sounds: `default`, `minuet`, `alarm`, `anticipate`, `birdsong`, `bloom`, `calypso`, `chime`, `descant`, `electronic`, `fanfare`, `horn`, `ladder`, `mazurka`, `nightingale`, `piano`, `rocket`, `sirius`, `strums`, `suspense`, `telegraph`, `tiptoes`, `tritone`, `tuberose`, `twinkle`.

## Configuration file

The extension stores its config at `~/.pi/ios-notify.json`. You can edit it directly:

```json
{
  "barkKey": "YOUR_DEVICE_KEY",
  "barkServer": "https://api.day.app",
  "events": {
    "agentEnd": true,
    "promptTools": true,
    "turnEnd": false,
    "error": true
  },
  "promptTools": {
    "ask_user": "Asking",
    "ask-user": "Asking",
    "safe_shell_approve": "Permission"
  },
  "sound": "default",
  "title": "pi",
  "icon": "",
  "showHostname": false,
  "url": ""
}
```

Add more tools directly in the config:

```json
{
  "promptTools": {
    "ask_user": "Asking",
    "safe_shell_approve": "Permission",
    "my_custom_tool": "Waiting"
  }
}
```

### Custom Bark server

If you self-host Bark, set the server:

```json
{
  "barkServer": "https://bark.yourdomain.com",
  "barkKey": "YOUR_KEY"
}
```

## What notifications look like

| Event | Notification |
|-------|-------------|
| Agent completes response | ✅ **pi Complete** — `"refactor the auth module to use JWT" (3 turns)` |
| Prompt tool called mid-turn | 💬 **pi Asking** — `ask_user` |
| Prompt tool called mid-turn | 💬 **pi Permission** — `safe_shell_approve` |
| Cross-extension event emit | 💬 **pi {emitter's title}** — `{emitter's body}` |
| Each turn | 🔄 **pi Turn** — `Turn 3 finished` |
| Tool error | ⚠️ **pi Error** — `Error in bash` |

## Privacy

- Only the Bark device key and notification content are sent to the Bark server
- Your code or conversation content is never transmitted — only the prompt summary you see
- Bark stores notification content encrypted on their server
- You can optionally set up [end-to-end encryption](https://github.com/Finb/Bark#encryption) in the Bark app

## Project structure

```
pi-ios-notify/
├── index.ts        # Extension entry point (no compilation needed)
├── package.json    # Package manifest with pi.extensions entry
└── README.md       # This file
```

Standard npm package layout — the `pi.extensions` field in `package.json` tells pi where to find entry points.

## Development

```bash
git clone <repo-url>
cd pi-ios-notify
# No npm install needed (pure TypeScript / Node built-ins only)
```

Load for testing:

```bash
pi -e /path/to/pi-ios-notify
```

Reload changes:

```
/reload
```

## Tests

```bash
npm test
```

Runs [vitest](https://vitest.dev/) on the extracted utility functions (`utils.test.ts`):

- `formatPrompt` — truncation, edge cases
- `pluralize` — singular, plural, auto-pluralize
- `onOff` — boolean to on/off
- `parseBool` — all truthy/falsy strings, edge cases

## ⚖️ No Warranty

**THIS SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.** The authors make no representations that this extension will deliver notifications reliably or in a timely manner. You are responsible for testing notification delivery and configuring appropriate settings.

---

## License

MIT

## Credits

- [Bark](https://github.com/Finb/Bark) — the wonderful free iOS push notification app
- Inspired by [doublezz10/opencode_ios_notifications](https://github.com/doublezz10/opencode_ios_notifications), [Stephanvs/opencode-ntfy](https://github.com/Stephanvs/opencode-ntfy), and [blanboom/bark-notification-for-claude-codex-opencode](https://github.com/blanboom/bark-notification-for-claude-codex-opencode)
