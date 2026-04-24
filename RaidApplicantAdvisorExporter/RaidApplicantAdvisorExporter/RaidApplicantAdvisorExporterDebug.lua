local DEBUG_ANCHOR_CHARACTERS = {
  {
    name = "Pangar",
    realm = "Area52",
    region = "US",
    role = "Tank",
    className = "Warrior",
    specName = "Protection",
    itemLevel = 275.9,
  },
  {
    name = "Zws",
    realm = "Area52",
    region = "US",
    role = "Healer",
    className = "Druid",
    specName = "Restoration",
    itemLevel = 278.5,
  },
  {
    name = "Gobblezyn",
    realm = "Area52",
    region = "US",
    role = "Tank",
    className = "Monk",
    specName = "Brewmaster",
    itemLevel = 277,
  },
  {
    name = "Steei",
    realm = "Area52",
    region = "US",
    role = "DPS",
    className = "Evoker",
    specName = "Augmentation",
    itemLevel = 279.6,
  },
  {
    name = "Slapsixnine",
    realm = "MoonGuard",
    region = "US",
    role = "DPS",
    className = "Mage",
    specName = "Frost",
    itemLevel = 277.3,
  },
}

local DEBUG_FILLER_CHARACTERS = {
  { name = "Machubby", realm = "Area52", region = "US", role = "DPS", className = "Paladin", specs = { "Retribution" } },
  { name = "Uncdk", realm = "Illidan", region = "US", role = "Tank", className = "Death Knight", specs = { "Blood" } },
  { name = "Habfael", realm = "Area52", region = "US", role = "DPS", className = "Warlock", specs = { "Demonology" } },
  { name = "Iwyn", realm = "Area52", region = "US", role = "DPS", className = "Mage", specs = { "Frost" } },
  { name = "Shiro", realm = "Area52", region = "US", role = "Healer", className = "Priest", specs = { "Holy" } },
  { name = "Dayzo", realm = "Sargeras", region = "US", role = "Healer", className = "Druid", specs = { "Restoration" } },
  { name = "Treenutt", realm = "Area52", region = "US", role = "DPS", className = "Evoker", specs = { "Augmentation" } },
  { name = "Rouzerad", realm = "QuelThalas", region = "US", role = "DPS", className = "Druid", specs = { "Balance" } },
  { name = "Lushan", realm = "QuelThalas", region = "US", role = "DPS", className = "Paladin", specs = { "Retribution" } },
  { name = "Sungjinwaa", realm = "Area52", region = "US", role = "DPS", className = "Demon Hunter", specs = { "Havoc" } },
  { name = "Movaria", realm = "Illidan", region = "US", role = "DPS", className = "Demon Hunter", specs = { "Devourer" } },
  { name = "Banzy", realm = "Area52", region = "US", role = "Tank", className = "Death Knight", specs = { "Blood", "Unholy" } },
  { name = "Boneheimer", realm = "Azralon", region = "US", role = "Healer", className = "Shaman", specs = { "Restoration" } },
  { name = "Candlepaw", realm = "WyrmrestAccord", region = "US", role = "DPS", className = "Mage", specs = { "Frost" } },
  { name = "Abirnar", realm = "Caelestrasz", region = "US", role = "Tank", className = "Druid", specs = { "Guardian" } },
  { name = "Iamfiredup", realm = "Area52", region = "US", role = "DPS", className = "Mage", specs = { "Frost", "Fire" } },
  { name = "Pwarr", realm = "Hakkar", region = "US", role = "Tank", className = "Warrior", specs = { "Protection" } },
}

local DEBUG_NOTES = {
  "can flex for comp",
  "strong selected difficulty logs",
  "has raid utility covered",
  "friend of guild",
  "available for full clear",
  "needs summon",
  "comfortable with assigned kicks",
  "can swap spec if needed",
}

local debugRunCounter = 0
local debugRandomSeeded = false
local debugRosterCharacters = nil

local function DebugSeedRandom()
  if debugRandomSeeded then
    return
  end

  debugRandomSeeded = true
  local seed = 7919
  if GetServerTime then
    seed = seed + GetServerTime()
  elseif time then
    seed = seed + time()
  end
  if GetTime then
    seed = seed + math.floor(GetTime() * 1000)
  end

  math.randomseed(seed)
  math.random()
  math.random()
  math.random()
end

local function DebugPick(values)
  return values[math.random(1, #values)]
end

local function DebugCopyCharacter(character)
  local copy = {}
  for key, value in pairs(character) do
    copy[key] = value
  end
  return copy
end

local function DebugShuffle(values)
  for index = #values, 2, -1 do
    local swapIndex = math.random(1, index)
    values[index], values[swapIndex] = values[swapIndex], values[index]
  end
  return values
end

local function DebugTakeRandom(source, count)
  local shuffled = {}
  for index, character in ipairs(source) do
    shuffled[index] = DebugCopyCharacter(character)
  end
  DebugShuffle(shuffled)

  local selected = {}
  for index = 1, math.min(count, #shuffled) do
    selected[#selected + 1] = shuffled[index]
  end
  return selected
end

local function DebugLine(character, runId, index, stableNote)
  local specName = character.specName or DebugPick(character.specs or { "" })
  local itemLevel = tostring(character.itemLevel or math.random(250, 280))
  local note = stableNote and "debug stable roster" or DebugPick(DEBUG_NOTES)
  if not stableNote and index == 1 then
    note = note .. " debug batch " .. tostring(runId)
  end

  return table.concat({
    character.name .. "-" .. character.realm .. "-" .. (character.region or "US"),
    character.role,
    character.className,
    specName,
    "",
    "",
    "",
    "",
    "",
    "",
    itemLevel,
    note,
  }, ",")
end

local function DebugCharacterKey(character)
  return tostring(character.name or "") .. "-" .. tostring(character.realm or "") .. "-" .. tostring(character.region or "US")
end

local function DebugAddRosterCharacter(roster, count, character)
  if character.role ~= "DPS" and character.role ~= "Tank" and character.role ~= "Healer" then
    return false
  end

  if character.role == "Tank" and count.Tank >= 2 then
    return false
  end

  if character.role == "Healer" and count.Healer >= 4 then
    return false
  end

  local copy = DebugCopyCharacter(character)
  copy.specName = copy.specName or DebugPick(copy.specs or { "" })
  copy.itemLevel = copy.itemLevel or math.random(250, 280)
  roster[#roster + 1] = copy
  count[character.role] = count[character.role] + 1
  return true
end

local function DebugBuildStableRoster()
  if debugRosterCharacters then
    return debugRosterCharacters
  end

  DebugSeedRandom()

  local rosterCount = 14
  local roster = {}
  local count = { Tank = 0, Healer = 0, DPS = 0 }
  local anchors = DebugTakeRandom(DEBUG_ANCHOR_CHARACTERS, #DEBUG_ANCHOR_CHARACTERS)

  for _, character in ipairs(anchors) do
    if #roster < rosterCount then
      DebugAddRosterCharacter(roster, count, character)
    end
  end

  local needed = rosterCount - #roster
  local fillers = DebugTakeRandom(DEBUG_FILLER_CHARACTERS, needed + 8)
  local fillerIndex = 1
  while #roster < rosterCount and fillerIndex <= #fillers do
    local filler = fillers[fillerIndex]
    fillerIndex = fillerIndex + 1
    DebugAddRosterCharacter(roster, count, filler)
  end

  if #roster == 0 then
    roster[#roster + 1] = DebugCopyCharacter(DEBUG_ANCHOR_CHARACTERS[1])
  end

  DebugShuffle(roster)

  debugRosterCharacters = roster
  return debugRosterCharacters
end

local function DebugBuildChangingApplicants(roster, runId)
  local rosterKeys = {}
  local pool = {}
  local applicantCount = math.random(3, 7)

  for _, character in ipairs(roster or {}) do
    rosterKeys[DebugCharacterKey(character)] = true
  end

  local function addPoolCharacters(source)
    for _, character in ipairs(source) do
      if not rosterKeys[DebugCharacterKey(character)] then
        pool[#pool + 1] = DebugCopyCharacter(character)
      end
    end
  end

  addPoolCharacters(DEBUG_ANCHOR_CHARACTERS)
  addPoolCharacters(DEBUG_FILLER_CHARACTERS)

  local applicants = DebugTakeRandom(pool, applicantCount)
  applicants[#applicants + 1] = {
    name = "Debugapp" .. tostring(runId),
    realm = "Area52",
    region = "US",
    role = (runId % 5 == 0) and "Healer" or "DPS",
    className = (runId % 5 == 0) and "Priest" or "Hunter",
    specName = (runId % 5 == 0) and "Holy" or "Survival",
    itemLevel = 260 + (runId % 18),
  }

  DebugShuffle(applicants)
  return applicants
end

function RaidApplicantAdvisorExporterResetDebugRoster()
  debugRosterCharacters = nil
end

function RaidApplicantAdvisorExporterBuildDebugExport()
  DebugSeedRandom()
  debugRunCounter = debugRunCounter + 1

  local roster = DebugBuildStableRoster()
  local applicants = DebugBuildChangingApplicants(roster, debugRunCounter)

  local lines = {
    "RAA_EXPORT_V1",
    "[CONTEXT]",
    "activityName=Chimaerus, the Undreamt God - Heroic",
    "activityShortName=Heroic Chimaerus",
    "listingName=Debug Heroic Chimaerus",
    "difficultyName=Heroic",
    "groupType=raid",
    "[ROSTER]",
  }
  for index, character in ipairs(roster) do
    lines[#lines + 1] = DebugLine(character, debugRunCounter, index, true)
  end

  lines[#lines + 1] = "[APPLICANTS]"
  for index, character in ipairs(applicants) do
    lines[#lines + 1] = DebugLine(character, debugRunCounter, index)
  end

  return table.concat(lines, "\n")
end
