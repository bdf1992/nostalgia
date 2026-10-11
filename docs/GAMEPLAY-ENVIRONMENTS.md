# Managed gameplay environments

Every Nostalgia agent should use `start_gameplay_environment` when it needs a
playable workspace for a player, itself, or joint work. The shared CLI command
is `start-gameplay-environment`. Starting a session returns its identity, owned
working directory, checkpoint, runtime identity, gameplay URL and private local
session path. Inspect, input and stop operations use that path.

The default provider runs captured HTML browser games in Playwright Chromium.
It supports keyboard input, viewport clicks, bounded waits, visible text and actual
rendered frames. User/shared sessions show a browser window; agent sessions run
headless. The Windows native provider selects hidden Booth/ProtoInput or
foreground Computer Use, with ME3 for Elden Ring; see [native gameplay](NATIVE-GAMEPLAY.md) for its host setup,
separate saves and recovery boundaries. Other native games, emulators and engine
exports need their own adapters.
The command must report unsupported capability rather than launch a native game
in the player's normal installation under an isolation label.

## Start, use, observe and stop

```powershell
npm ci
npm run provision:browser
npm run build
node dist/cli.js start-gameplay-environment start.json
```

An example `start.json`, using absolute paths chosen for this run:

```json
{
  "checkpoint": "C:\\GameWork\\baseline",
  "destination": "C:\\GameWork\\session-001",
  "entrypoint": "index.html",
  "audience": "agent",
  "network": {"mode": "isolated", "allowed_origins": []},
  "lifetime_seconds": 3600
}
```

The checkpoint must include the entrypoint and every required game file. The
destination must be absent and its parent must exist. The command verifies the
checkpoint, restores its files under `destination/game`, starts a loopback static
host, creates a fresh browser context, loads the entrypoint and captures an initial
observation. Existing destinations, overlapping paths and directory aliases are
refused before session writes. Captured paths are the static host's allowlist;
files outside that set, traversal and links are refused.

The CLI launcher prints the session record and remains alive to own the browser
and servers. Keep that process or the originating MCP server running. Other CLI
processes and agents can use the private session path for control. This path is
a capability: its file includes a local control token. Do not share its contents
or commit it. The gameplay page is served separately from the authenticated
control host. A gameplay URL opened in another browser is outside the managed
context's request policy and observation surface.

Write `session.json` requests containing the returned path:

```json
{"session_path":"C:\\GameWork\\session-001\\session.json"}
```

```powershell
node dist/cli.js inspect-gameplay-environment session.json
node dist/cli.js stop-gameplay-environment session.json
```

For input, `action.json` is:

```json
{"session_path":"C:\\GameWork\\session-001\\session.json","action":{"kind":"key","key":"ArrowRight"}}
```

```powershell
node dist/cli.js act-in-gameplay-environment action.json
```

The other actions are `{"kind":"click","x":80,"y":620}` and
`{"kind":"wait","milliseconds":100}`. Coordinates refer to a 1280×720 viewport.
Observations return bounded visible text and a PNG frame. MCP additionally exposes
the frame as image content. An input acknowledgment establishes only that the
input was attempted and observed; judge its meaning against the actual game.

Stop closes owned resources and retains files and records. It does not restore
state changed during play. Start another absent session from the same verified
checkpoint for a fresh comparison. Browser storage is separate per context and
does not import the player's normal browser profile. Closing a session does not
constitute a process-memory checkpoint.

## Isolation and networking

`isolated` mode permits the managed browser's HTTP and WebSocket requests to its
own game host. `networked` mode additionally permits declared exact HTTP/HTTPS
origins, for example `https://example.test`; corresponding WebSocket origins use
that policy. Requests to unlisted origins and the control host are refused.
Service workers are blocked, popups are refused, downloads are disabled and
navigation outside the captured entrypoint is refused. There is no wildcard
network permission. Allowing a service does not grant authority to alter it.
Networked contexts grant Chromium's local-network-access permission to the
captured page origin; the exact HTTP/WebSocket allowlist still applies.

This is workspace, browser-storage and application-request isolation. It is not
an OS network sandbox: WebRTC, DNS and browser background traffic are outside
the tested request policy. It does not expose a LAN game server, implement
multiplayer, or change host firewall settings. A networked game's server and
multiplayer behavior require their own supported adapter and tests.

For native software, research an appropriate profile, emulator save-state or VM
adapter and verify its file/state boundaries and input/observation route. Windows
Sandbox supports a separate kernel, configurable networking and folder mapping,
but host support and actual game compatibility must be established first.
[Microsoft's configuration reference](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file)

## Original playable fixture

```powershell
npm run play:fixture
npm run play:fixture -- --user
```

The fixture supplies a canvas, movement, attacks, a collect button and per-context
browser storage. It uses original code and graphics. This is an executable test
of launching, playing, observing and stopping; it is not Diablo or an ARPG quality
evaluation. Fixture runs and session receipts remain under ignored `state/`.

Use preserved-gameplay assertions and intentional-change criteria from the
[baseline evaluation](BASELINE-EVALUATION.md) and [game study](GAME-STUDY.md)
guides when evaluating a real project. Retain the session/checkpoint identity,
actual observations and action journal with the study records. The journal is
bounded; it is not a complete recording of manual play.

## Why this first provider

Playwright supplies fresh browser contexts and input/observation APIs, with HTTP
and WebSocket routing available for declared application-request policies. It
supports both visible play and agent operation without modifying a user's browser
profile. The project pins Playwright and provisions its corresponding Chromium;
cache garbage collection is disabled during provisioning to retain other projects'
browser revisions. Runtime identity is recorded at launch.
[Context isolation](https://playwright.dev/docs/browser-contexts),
[network routing](https://playwright.dev/docs/network),
[WebSocket routing](https://playwright.dev/docs/api/class-browsercontext#browser-context-route-web-socket).
