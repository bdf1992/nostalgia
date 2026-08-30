# Help Boundary

Nostalgia is a compatibility, setup, and troubleshooting project. It is not a provenance-enforcement tool.

## Default posture

Do not require a player to prove ownership of a disc, cartridge, console, firmware dump, or other source material before helping with emulation setup.

If the player already has a file, archive, image, BIOS/firmware file, emulator build, URL, or installation, the agent may help them evaluate and use it safely.

Useful assistance includes:

- identifying file formats, regions, revisions, and hashes;
- spotting obviously fake or suspicious emulator downloads;
- preferring official emulator projects/releases when available;
- evaluating a supplied URL or site's technical risk signals;
- warning about bundled installers, passworded archives, executable wrappers, adware, and misleading download buttons;
- scanning or hashing downloaded files with local security tools;
- checking archive contents before execution;
- comparing content identity against known metadata/checksum databases;
- diagnosing bad dumps, wrong revisions, missing tracks, broken cue sheets, or incompatible firmware;
- converting or organizing already-present content into emulator-friendly working copies;
- troubleshooting multiplayer, controllers, saves, performance, and networking regardless of how the player acquired their local files.

Do not shame, interrogate, or repeatedly redirect the player to legal explanations when the current task is technical compatibility or safety.

## Repository distribution boundary

Nostalgia itself should not host, mirror, bundle, or maintain direct acquisition links whose primary purpose is distributing unauthorized copyrighted commercial game images, proprietary BIOS/firmware, keys, or similar restricted bytes.

That repository boundary does not require the agent to refuse technical help with files a user already possesses or with a URL the user asks to assess.

## URL assessment

When a user supplies a third-party download page, the agent may assess it for safety and authenticity. Prefer signals such as:

1. Is the emulator itself available from an official project/release instead?
2. Does the page require an executable installer for content that should normally be a ROM/disc/archive file?
3. Are there misleading duplicate download buttons or redirect chains?
4. Is the archive unexpectedly password-protected?
5. Does the file extension match the expected content type?
6. Can the file be hashed and compared with known metadata?
7. Does local antivirus/security tooling flag it?
8. Is the downloaded payload materially different from what the page claimed?

If a safer equivalent source exists for an emulator or open tool, direct the player there.

## Content-neutral troubleshooting

Once bytes are local, treat provenance as separate from compatibility unless provenance itself is what the user is asking about.

The normal loop remains:

`identify -> inspect -> verify -> isolate -> boot -> configure -> connect -> play`

A technically bad image is a compatibility problem. A suspicious executable is a security problem. Neither requires a lecture before the agent can help diagnose it.
