# PS1 Session Reports

Put one small evidence record here for every real multiplayer attempt, including failures that isolate a useful cause.

Recommended filename:

`YYYY-MM-DD-<game-id>-<short-result>.md`

## Template

```yaml
schema: nostalgia.ps1-session/0.1
date: YYYY-MM-DD
game_id: twisted-metal-2-ps1
result: playable | partial | blocked
stress_level_reached: L0 | L1 | L2 | L3 | L4 | L5 | L6
players:
  humans: 2
  logical: 2
runtime:
  id: duckstation
  version: exact-version
transport:
  id: parsec-remote-couch
content:
  region: unknown
  revision: unknown
  sha256: optional-hash-of-player-owned-content
controllers:
  - player: 1
    source: host
    emulated_slot: port-1
  - player: 2
    source: parsec-guest
    emulated_slot: port-2
multitap: none
save_backup_created: true
completed_match_or_session: true
recovery_tested: false
symptoms: []
fixes: []
private_data_removed: true
```

Then add a short human note:

```text
What we tried:
What happened:
What failed:
What fixed it:
What should become recipe knowledge:
```

Do not commit IP addresses, account credentials, BIOS/game/save bytes, or other unnecessary private state.
