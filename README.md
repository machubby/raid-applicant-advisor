# Raid Applicant Advisor

A small local web app for ranking retail WoW raid applicants by:

- target composition, such as `2-4-14`
- missing raid buffs and utility
- Warcraft Logs boss parses with boss/difficulty dropdowns and difficulty fallback
- transparent per-applicant reasons

The first version is a website/companion app rather than a pure in-game addon. That is deliberate: Warcraft Logs requires OAuth and GraphQL calls, and those secrets should stay on a local server, not in the browser or in a WoW addon.

## Run

```powershell
$env:WCL_CLIENT_ID="your-client-id"
$env:WCL_CLIENT_SECRET="your-client-secret"
& "C:\Users\Matthew\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server.js
```

Then open:

```text
http://127.0.0.1:4177
```

Credentials are optional. Without them, the app uses the parse numbers included in the applicant input.

## WoW Applicant Exporter

The in-game bridge lives here:

```text
wow-addon/RaidApplicantAdvisorExporter
```

Copy that folder into:

```text
World of Warcraft\_retail_\Interface\AddOns\
```

Then reload WoW and use:

```text
/raa
/raa roster
/raa applicants
/raa debug
```

Copy `/raa` output into the website's **Addon Export** box. Pasting a full addon export automatically imports it and fetches logs; **Import + Logs** is still there as a manual retry button. The addon exports the active Group Finder context when Blizzard exposes it, plus names, realms, region, roles, classes, and specs. The website uses that context to auto-select obvious raid difficulties such as Mythic, Heroic, Normal, or LFR, and best-effort matches boss names when the listing text includes one. The website/server handles Warcraft Logs, because WoW addons cannot safely call Warcraft Logs directly.

`/raa debug` and the **Load Debug** button load a randomized built-in fake export fixture, which is useful for testing the clipboard bridge without waiting for real applicants. The debug pool always includes Pangar-Area52-US, Zws-Area52-US, Gobblezyn-Area52-US, Steei-Area52-US, and Slapsixnine-MoonGuard-US, using Raider.IO profile data captured on April 19, 2026 for their role, spec, class, and item level. Those characters can appear in either roster or applicants, and notes are randomized.

When the local server is running on Windows, it also starts a clipboard bridge. Copy a fresh `/raa` export in-game and the website will pick it up automatically, import it, and fetch logs. This removes the manual paste step; the browser still needs to be open to the app. To turn the bridge off for a session:

```powershell
$env:RAA_CLIPBOARD_BRIDGE="0"
```

### Game Rule Guardrails

This project keeps the WoW side inside normal addon boundaries:

- the addon is plain, visible Lua source in the `Interface\AddOns` folder
- the addon only reads Blizzard-provided group, roster, and applicant UI data
- the addon does not make network requests, inspect the game client, or modify game files
- the companion server only reads text that the player copied to the Windows clipboard
- nothing sends clicks, keypresses, invites, accepts, declines, or other gameplay actions back into WoW
- the addon is free, has no ads, and has no donation prompts in-game

The roster from the addon export is kept as internal state for composition, buff coverage, and roster stats. It is not a separate manual input in the UI.

The **Applicant Ranking** panel ranks applicants for roles that are still open in the current roster and includes score details in each row. Turn off **Needed roles only** if you want to inspect applicants for already-filled roles, and use **Min ilvl** to filter new addon exports by item level.

If an export does not include item level, **Import + Logs** attempts to fill it from Raider.IO character profile metadata while fetching Warcraft Logs. Exported addon item levels still win when present.

Use **Decline** on an applicant card to hide that player from scoring and future imports for the current browser session. This is local to the companion website and does not decline them in WoW. The **Scoring** panel under **Encounter** lets you rank the relative importance of parses, boss kills, Raider.IO timed +10 runs, and team buffs. The score weight values themselves stay fixed.

When the clipboard bridge receives a fresh in-game export, the website shows a timestamped toast. Warcraft Logs enrichment also adds general raid progression chips such as `3/9M` and `9/9H` when zone kill data is available.

## Applicant Format

One applicant per line:

```text
Name-Realm-US,Role,Class,Spec,PrimaryParse,FallbackParse
```

Examples:

```text
Kethra-Area-52-US,DPS,Mage,Frost,82,94
Marnok-Illidan-US,Tank,Death Knight,Blood,42,88
```

`PrimaryParse` means the selected boss and selected difficulty. `FallbackParse` means the same boss on the next easier difficulty.

New addon applicant exports can also include item level after the parse/stat columns:

```text
Name-Realm-US,Role,Class,Spec,PrimaryParse,FallbackParse,PrimaryKills,FallbackKills,MythicAvg,HeroicAvg,ItemLevel,ApplicationNote
```

Application notes are sanitized to keep the comma-separated export stable, then shown on applicant cards.

There is a captured sample export with fake `250-280` item levels in:

```text
fixtures/raa-export-with-fake-ilvls.txt
```

## Warcraft Logs Notes

The app uses the Warcraft Logs v2 GraphQL API when credentials are present. You need a client from the Warcraft Logs client management page.

Useful docs:

- https://www.warcraftlogs.com/api/docs
- https://www.warcraftlogs.com/v2-api-docs/warcraft/character.doc.html
- https://www.warcraftlogs.com/v2-api-docs/warcraft/encounter.doc.html

## Tuning

The buff table and score weights live in:

```text
public/raid-data.js
```

The scoring engine lives in:

```text
public/app.js
```
