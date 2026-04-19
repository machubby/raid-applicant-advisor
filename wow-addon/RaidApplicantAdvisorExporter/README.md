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

Separate exports still work:

```text
/raa roster
/raa applicants
/raa debug
```

`/raa debug` opens the in-game window with a randomized built-in fixture export for testing the clipboard bridge without needing live applicants. The debug pool always includes Pangar-Area52-US, Zws-Area52-US, Gobblezyn-Area52-US, Steei-Area52-US, and Slapsixnine-MoonGuard-US, using Raider.IO profile data captured on April 19, 2026 for their role, spec, class, and item level. Those characters can appear in either roster or applicants, and notes are randomized.

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

Applicant exports include item level as a trailing field when Group Finder provides it:

```text
Name-Realm-Region,Role,Class,Spec,,,,,,,ItemLevel,ApplicationNote
```

The blank fields are reserved for website/server parse data, so older exports still work. Application notes are sanitized to remove commas and newlines before export. The website adds Warcraft Logs parses after you click **Logs**.

The export box refreshes automatically while it is open, but applicant updates are debounced to avoid noisy refresh loops while Group Finder records are still loading.
