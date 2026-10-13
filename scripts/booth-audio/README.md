# Booth audio source

This folder contains the process-loopback capture helper, a private HTTP gameplay provider and per-process CoreAudio control. The user interface belongs to Workstation’s existing Booth. Nostalgia supplies authenticated PCM and leased gamepad actions, registered against its exact owned recording. There is no custom viewer page.

Read [BOOTH-AUDIO.md](../../docs/BOOTH-AUDIO.md) for prerequisites and protocol, [NATIVE-GAMEPLAY.md](../../docs/NATIVE-GAMEPLAY.md) for host configuration and [ROUTING.md](ROUTING.md) for per-app routing. Build outputs and private access receipts stay in ignored repository state.

Admission requires an actual Cable session for the owned game. Shutdown revokes Booth capabilities, quiesces the game/controller, closes capture, restores saved app render preferences, then closes the owned desktop. Retain unresolved cleanup failures; do not remove the desktop before restoration.

Upstream licenses are retained in LICENSE-Microsoft.txt and LICENSE-EarTrumpet.txt. No game, driver, runtime or compiled executable is distributed here.
