# First ten providers

The [selection registry](../catalog/toolchain.json) records the first ten underlying
providers and the alternatives considered. Selection follows game-domain coverage,
programmable interfaces, retained artifacts and observable failures. Existing
software on this machine was inspected only to decide how to provision a selected
provider. These are foundations for Nostalgia operations, not ten implemented MCP
wrappers or proof that the evaluation projects can already be completed.

The [Windows version/source lock](../catalog/toolchain.windows.lock.json) retains
this provisioning run's pins and download hashes. It records sources rather than
providing a universal installer. The local record and receipts retain paths and
operation evidence without copying machine-specific state into the repository.

REA studies implementation. StormLib and CascLib read Blizzard containers.
wow.export converts WoW-specific models/worlds. Blender authors 3D assets.
ImageMagick processes images; FFmpeg processes audio/video. Godot is the reference
production runtime. RenderDoc inspects our rendered builds. Frida supplies native
runtime observation and changes. Each provider's upstream documentation and
selection reason are linked in the registry.

## Local provisioning and identity

The initial Windows toolchain lives under
`%USERPROFILE%\.local\share\nostalgia\toolchain`. Portable distributions,
isolated Python environments and a source-built CascLib keep its dependencies
separate from global PATH and user game installations. Blender uses a fresh portable
distribution rather than the existing installation. No provider binaries or
game bytes belong in Git.

Provisioning receipts retain source URLs, archive/source identities, publisher
checksum comparisons where available, executable/library identities, versions,
commands, results and limits. A source-built library has an observed build hash;
that is not a publisher signature. Untested dependencies and game formats stay
explicit. HTTP-only viewer downloads are excluded from the selected providers.

The local machine record is `state/toolchain.local.json` (ignored by Git). To
inspect it, write a request with an absolute path:

```json
{"manifest_path":"C:\\Users\\bdf19\\workstation\\repos\\nostalgia\\state\\toolchain.local.json"}
```

```powershell
node dist/cli.js inspect-toolchain state/toolchain-request.json
```

The MCP equivalent is `inspect_toolchain`. It reads a regular JSON manifest up to
5 MiB, requires exactly the ten selected IDs, and streams hashes of listed regular
files. It never launches a provider. `files-matched` means those files match the
caller-supplied hashes; `needs-attention` identifies changed or unreadable files.
The record's verification field is historical evidence, not a health check rerun
now. Include the receipt itself among the hashed artifacts when retaining its
identity matters. Other dependency files remain outside inspection.

The manifest contains `schema_version: 1`, a UTC `recorded_at`, and ten `providers`.
Each entry has `id`, `version`, `mode`, `verification`, absolute `receipt_path`,
`limitations`, and `artifacts` containing absolute `path` and lowercase `sha256`.
Verification is `operation-verified`, `availability-verified`, or
`installed-untested`; none is a playable-session validation state.

## Domain operations to build over these providers

Use explicit game/build identity and selected inputs for archive inventory and
extraction. Preserve entry paths, container hashes, extraction parameters and
dependencies. Asset sorting must retain provenance and references: a sprite's
palette, an animation's timing/rig, a model's materials, a world's objects. A
filename or image similarity is a proposed classification until checked.

Authoring operations should retain native source, transformation scripts, outputs
and conversion losses. Runtime operations need exact process identity, measured
state meaning, original values, change lifetime and observed restoration. Build
checks need the actual result and player judgment. Shell availability alone does
not implement any of those contracts.

## What remains before the game evaluations

- **Diablo II:** MPQ extraction and extracted-table inspection are available;
  DC6/DCC sprites, palettes, COF animation composition and DS1/DT1 maps still need
  semantic providers. Real game archives and behavior have not been evaluated.
- **WoW/D2R:** CascLib needs testing against the selected local storage revision;
  not every distribution uses an admitted CASC layout. wow.export needs a checked
  automation bridge and conversion-fidelity evaluation.
- **Elder Scrolls:** Mutagen is the next candidate for typed plugin records and
  supported archives. This first toolchain does not unify all Scrolls games or ESO.
- **Other projects:** engine-specific importers, proprietary audio decoders,
  GPU texture tools, Minecraft APIs and legacy graphics tracing are separate gaps.
- **Generation:** model providers for voices, textures and other new content,
  asset catalog/search, gameplay telemetry, build adapters and live-change recovery
  remain to be integrated and evaluated.

The initial smoke operations use original synthetic material. They establish a
working operation at a pinned version, not game fidelity, creative quality or
general remake capability. Godot export templates and presets must match the
chosen runtime when producing standalone executables.

## Initial Windows results, 2026-10-10

| Provider | Version | Observed check |
|---|---|---|
| REA / Ghidra | 6.3.0 / 12.1.4, Temurin 21 | Scoped doctor; synthetic PE investigation and function returning 42 |
| StormLib | 9.40 | Compressed MPQ create, enumerate and extract; independent member read |
| CascLib | 3.0, source commit pinned in lock | Built DLL; empty local storage rejected as expected |
| wow.export | 0.2.19 | Portable package and executable identities; GUI not launched |
| Blender | 5.2.2 LTS | Fresh portable; original cube GLB export/import |
| ImageMagick | 7.1.2-33 | Transparent sprite sheet; independent pixel checks |
| FFmpeg / ffprobe | 9.0.2 | Tone conversion; independent decoded sample/frequency checks |
| Godot | 4.7.2 | Headless model import, resource-pack export and packed-script run |
| RenderDoc | 1.46 | Signed executable, CLI and unit-test entry point; capture untested |
| Frida | 17.23.3, tools 14.11.0 | Synthetic child value changed, restored and observed after detach |

Seven providers passed synthetic operations, two passed limited availability
checks, and wow.export has installation evidence only. All ten listed artifacts
and receipts match the local manifest. Reviewers independently checked code,
media, mesh structure, MPQ reading, live-state restoration and packed Godot output.

REA's existing connected MCP process keeps its original environment. The new
native prerequisites are available through the local scoped launcher:

```powershell
pwsh -NoProfile -File "$env:USERPROFILE\.local\share\nostalgia\toolchain\rea-native\launch-rea.ps1" doctor --provider ghidra --format json
```

Use `--mcp` with that launcher for a new process with those native prerequisites.
Existing agent registrations have not been rewritten. RenderDoc's default Vulkan
layer registration reports missing system registration; no administrative layer
change was made. OpenGL/D3D capture and replay remain untested here.
