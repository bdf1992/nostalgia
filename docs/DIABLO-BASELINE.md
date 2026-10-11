# First Diablo baseline

The provisional target for Bdo's ARPG study is current stable Diablo II:
Resurrected on PC, offline, with the Resurrected expansion-era rules as the first
reference. This is a recommendation from the stated Diablo II starting point,
not a selected local installation or a validated mod combination. Respect an
explicit user choice. Pin the actual executable, storage build, game era, mods,
profile, controls and runtime after discovering the installation.

Blizzard's current release has distinct Classic, Resurrected and Reign of the
Warlock eras, with character transfers proceeding forward. Its current Steam
offering includes the newer DLC. A current installation therefore does not alone
identify the intended baseline rules. The inspected official patch notes include
3.1.2; that is a research observation, not proof that no later patch exists.
[Blizzard's era and distribution description](https://news.blizzard.com/en-us/article/24243863/rain-annihilation-in-reign-of-the-warlock),
[patch notes inspected](https://news.blizzard.com/en-us/article/24271875/reign-of-the-warlock-3-1-2-patch-notes).

Prefer this route for modern PC presentation and continued official support.
Use an older original Diablo II build when a required mod or investigated mechanic
depends on it, with compatibility evidence and its own baseline. D2RMM is a
candidate programmable data-mod provider, not an automatic dependency or a
validated current-era conversion.
[D2RMM upstream](https://github.com/olegbl/d2rmm),
[inspected release](https://github.com/olegbl/d2rmm/releases/tag/v1.9.1).

## Native adapter admission

Before launch, establish the complete installation and data boundary, how to
redirect or isolate profiles and saves, dependencies on Steam/Battle.net and
external authentication, the intended game era, and whether a copied installation
actually runs. A save backup alone does not redirect a game's subsequent writes.
Do not transfer an existing character's era merely to prepare a test.

The first scenarios should retain observed launch/character identity, controlled
movement and targeting, one fixed combat interaction, item pickup/inventory,
and save/load. Use a dedicated test character/profile. Pin inputs and tolerances
before comparison. Run the unchanged replica, restore fresh state and repeat.
Measure technical behavior separately from the player's judgment of control feel.

REA's inspected native UI observer is tied to macOS targets and its new-process
capture does not support native Windows. It is not a ready Windows Diablo control
adapter. The implemented Nostalgia browser environment also does not launch
Diablo. Native input, rendered observation and lifecycle ownership remain work.

## Local discovery, 2026-10-10

Steam is present in the inspected registry and standard library location.
The inspected library manifests have no installed Diablo entry; standard D2R
installation and saved-game paths were also absent. This does not establish
whether the user owns the game, has another library, or uses another machine.
No game or save was copied, changed or launched.
