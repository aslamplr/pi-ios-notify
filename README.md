# pi-ios-notify 📱

Send iOS push notifications via [Bark](https://github.com/Finb/Bark) when pi completes agent turns. Get notified right on your iPhone when long-running tasks finish, errors occur, or after each individual turn — without watching the terminal.

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
pi install npm:pi-ios-notify
# or from the source directory:
pi install /path/to/pi-ios-notify
```

### via git

```bash
pi install git:github.com/your-username/pi-ios-notify
```

### Manual (local path)

From the project root:

```bash
pi install /Users/aslam/Documents/code/pi/workspace1/pi-ios-notify
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
| `/ios-notify events <type> <true\|false>` | Enable/disable notification types (`idle`, `turn-end`, `error`, `permission`) |
| `/ios-notify sound <name>` | Set notification sound |
| `/ios-notify icon <url|pi|default>` | Set a custom notification icon |
| `/ios-notify hostname <true\|false>` | Append hostname to notifications |

### Notification events

| Event | Default | Description |
|-------|---------|-------------|
| `idle` | ✅ on | Notify when agent finishes and needs your input |
| `turn-end` | ❌ off | Notify after each individual LLM turn (can be noisy!) |
| `error` | ✅ on | Notify when a tool execution fails |
| `permission` | ✅ on | Notify when agent requests permission (bash, file writes, etc.) |

Toggle with:

```
/ios-notify events idle false
/ios-notify events turn-end true
/ios-notify events permission false
```

### Custom icon

Bark supports a custom notification icon via URL. Set it to any publicly accessible image:

```
/ios-notify icon https://example.com/my-icon.png
```

Use `default` to reset to Bark's default icon, or `pi` to use the pi logo:

```
/ios-notify icon pi
/ios-notify icon default
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
    "turnEnd": false,
    "error": true
  },
  "sound": "default",
  "title": "pi",
  "showHostname": false
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
| Agent idle — needs your input | `💬 pi Needs input` — `"refactor the auth module to use JWT"` |
| Each turn | `🔄 pi Turn` — `Turn 3 finished` |
| Tool error | `⚠️ pi Error` — `Error in bash` |
| Permission requested | `🔑 pi Permission` — `bash: rm -rf node_modules` |

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


## Credits

- [Bark](https://github.com/Finb/Bark) — the wonderful free iOS push notification app
- Inspired by [doublezz10/opencode_ios_notifications](https://github.com/doublezz10/opencode_ios_notifications), [Stephanvs/opencode-ntfy](https://github.com/Stephanvs/opencode-ntfy), and [blanboom/bark-notification-for-claude-codex-opencode](https://github.com/blanboom/bark-notification-for-claude-codex-opencode)
