# Booth gameplay v1

Source-only prototype package. See [BOOTH-GAMEPLAY.md](../../docs/BOOTH-GAMEPLAY.md)
for provisioning, authored fixture replays, exact-process admission and lifecycle.

- `version.json`, `patches/`: official upstream pin and reviewed source changes.
- `provision.ps1`, `build_support.py`: isolated normal build and local artifact pins.
- `native/`: persistent headless controller and desktop-bound GUI supervisor.
- `controller_bridge.py`, `bind_owned.py`, `booth_driver.py`: explicit local providers.
- `fixtures/`, `tests/`: original fixture and repeatable evaluations.
- `licenses/`: upstream/dependency notices, including OpenXinput GPL terms.

Compiled bytes and machine paths belong in a local workspace. `local/` is ignored.
This package does not register MCP tools or authorize game launches by default.
