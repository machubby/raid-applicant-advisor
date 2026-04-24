# Raid Applicant Advisor Exporter

Tiny Retail WoW addon that exports Group Finder applicants and your current group/raid roster for the local Raid Applicant Advisor website.

## Install

Copy the `RaidApplicantAdvisorExporter` folder into:

```text
World of Warcraft\_retail_\Interface\AddOns\
```

Restart WoW or run `/reload`, then enable **Raid Applicant Advisor Exporter** on the character select addon screen.

## Use

Open your Group Finder listing so you can see applicants, then run:

```text
/raa
```

The addon opens a copyable box with the active Group Finder context, roster, and applicants. Click **Copy**, press `Ctrl+C`, then paste into the website's **Addon Export** field and click **Import**.

For the fastest clipboard-bridge workflow, use:

```text
/raa copy
/raa auto on
```

`/raa copy` opens the one-line copy box directly. `/raa auto on` watches Group Finder applicant changes and automatically opens that copy box when a new active applicant appears. Existing applicants become the baseline when you enable it, so it should only pop for later arrivals. Use `/raa auto off` to stop it and `/raa auto status` to check the current state.

Separate exports still work:

```text
/raa roster
/raa applicants
/raa debug
/raa debugauto
```

`/raa debug` opens the in-game window with a built-in fixture export for testing the clipboard bridge without needing live applicants. The debug roster is stable for the current UI session, while the applicant list changes on each debug export. `/raa debugauto` toggles a simulator that opens a fresh debug copy box every few seconds so you can test the new-applicant auto-open workflow while the roster stays constant. The debug pool always includes Pangar-Area52-US, Zws-Area52-US, Gobblezyn-Area52-US, Steei-Area52-US, and Slapsixnine-MoonGuard-US, using Raider.IO profile data captured on April 19, 2026 for their role, spec, class, and item level.

The export format is:

```text
Name-Realm-Region,Role,Class,Spec
```

Full `/raa` exports also include a `[CONTEXT]` section when Blizzard exposes active Group Finder listing data:

```text
[CONTEXT]
activityName=Chimaerus, the Undreamt God - Heroic
difficultyName=Heroic
listingName=Heroic Chimaerus
```

The website uses that context to auto-select obvious raid difficulties such as Mythic, Heroic, Normal, or LFR, and best-effort matches boss names when the listing text includes one.

Some Group Finder listing names/comments are returned to addons as protected tokens such as `|K...|k` rather than readable text. When that happens, the export marks the listing/comment text as protected and the website keeps the currently selected boss.

Applicant exports include item level as a trailing field when Group Finder provides it:

```text
Name-Realm-Region,Role,Class,Spec,,,,,,,ItemLevel,ApplicationNote
```

The blank fields are reserved for website/server parse data, so older exports still work. Application notes are sanitized to remove commas and newlines before export. The website adds Warcraft Logs parses after you click **Logs**.

The export box refreshes automatically while it is open, but applicant updates are debounced to avoid noisy refresh loops while Group Finder records are still loading.
