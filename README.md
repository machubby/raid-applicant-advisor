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

To expose the app from your PC through a real HTTPS domain, see:

```text
PUBLIC_DOMAIN.md
```

For a temporary no-domain Cloudflare Quick Tunnel, run:

```powershell
.\scripts\Start-RAA-Share.ps1
```

It starts the local server if needed, starts the tunnel, prints the exact buddy link, and copies it to your clipboard when possible.

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
/raa copy
/raa auto on
/raa roster
/raa applicants
/raa debug
/raa debugauto
```

Copy `/raa` output into the website's **Addon Export** box. Pasting a full addon export automatically imports it and fetches logs; **Import + Logs** is still there as a manual retry button. The addon exports the active Group Finder context when Blizzard exposes it, plus names, realms, region, roles, classes, and specs. The website uses that context to auto-select obvious raid difficulties such as Mythic, Heroic, Normal, or LFR, and best-effort matches boss names when the listing text includes one. The website/server handles Warcraft Logs, because WoW addons cannot safely call Warcraft Logs directly.

Some Group Finder listing names/comments are returned to addons as protected tokens such as `|K...|k` rather than readable text. When that happens, the website ignores the protected title/comment and falls back to readable activity context such as the raid name and difficulty. `groupType=party` or `groupType=raid` only describes your current group state; it does not identify the encounter by itself.

When an addon export identifies the raid activity and difficulty but not a specific boss, the website switches the boss selector to **Raid average**. Boss-specific parse/kill cells stay empty, but raid-average and progression data can still score from Warcraft Logs zone rankings.

`/raa copy` opens the one-line copy box directly. `/raa auto on` watches Group Finder applicant changes and automatically opens that copy box when a new active applicant appears; use `/raa auto off` to stop it and `/raa auto status` to check it.

`/raa debug` and the **Load Debug** button load a built-in fake export fixture, which is useful for testing the clipboard bridge without waiting for real applicants. The debug roster stays stable for the current UI session, while applicants change on each debug export. `/raa debugauto` toggles a simulator that opens a fresh debug copy box every few seconds, so you can test the new-applicant workflow with a constant roster. The debug pool always includes Pangar-Area52-US, Zws-Area52-US, Gobblezyn-Area52-US, Steei-Area52-US, and Slapsixnine-MoonGuard-US, using Raider.IO profile data captured on April 19, 2026 for their role, spec, class, and item level.

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

Use **Accept** on an applicant card to add that player to the shared server-side roster planner and remove them from the applicant ranking pool for everyone viewing the same server. Use **Decline** to hide that player from scoring and future imports for everyone viewing the same server. Both actions are only planning decisions in the companion website; they do not invite, accept, decline, click, or send anything back into WoW. The **Scoring** panel under **Encounter** lets you rank the relative importance of parses, boss kills, Raider.IO Mythic+ experience, and team buffs. The score weight values themselves stay fixed.

When another browser accepts or declines an applicant, connected browsers show a toast so co-leads can see shared decisions as they happen.

For Mythic+ groups, switch **Scoring > Mode** to **Mythic+ Raider.IO**. In that mode the applicant score is based on Raider.IO instead of raid parses, boss kills, or raid-buff coverage. Use **M+ Range** to scale the score around the key range you are actually running: `+2 to +3`, `+4 to +6`, `+7 to +9`, `+10 to +11`, `+12 to +14`, or `+15 and up`. The **M+ Debug** button loads fixed fake Raider.IO applicants so you can test the range behavior without spending API calls.

When the clipboard bridge receives a fresh in-game export, the website shows a timestamped toast. Warcraft Logs enrichment also adds general raid progression chips such as `3/9M` and `9/9H` when zone kill data is available.

Warcraft Logs raid-zone ranking data is cached per character, zone, difficulty, and metric. After the first pull for a raid, swapping between bosses in that same raid should reuse the cached zone data instead of spending fresh API points for every boss selection.

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
