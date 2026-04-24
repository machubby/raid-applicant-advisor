local ADDON_NAME = ...
local ADDON_VERSION = "0.1.22"

local Exporter = {}
local DB
local SafeCall

local AUTO_COPY_DELAY_SECONDS = 0.45
local AUTO_COPY_RETRY_SECONDS = 0.75
local AUTO_COPY_MAX_ATTEMPTS = 3
local DEBUG_AUTO_INTERVAL_SECONDS = 6

local CLASS_NAMES = {
  DEATHKNIGHT = "Death Knight",
  DEMONHUNTER = "Demon Hunter",
  DRUID = "Druid",
  EVOKER = "Evoker",
  HUNTER = "Hunter",
  MAGE = "Mage",
  MONK = "Monk",
  PALADIN = "Paladin",
  PRIEST = "Priest",
  ROGUE = "Rogue",
  SHAMAN = "Shaman",
  WARLOCK = "Warlock",
  WARRIOR = "Warrior",
}

local REGION_NAMES = {
  [1] = "US",
  [2] = "KR",
  [3] = "EU",
  [4] = "TW",
  [5] = "CN",
  [21] = "US",
  [22] = "KR",
  [23] = "EU",
  [24] = "TW",
  [25] = "CN",
  [26] = "US",
  [50] = "US",
  [57] = "US",
  [71] = "US",
  [72] = "KR",
  [73] = "EU",
  [74] = "TW",
  [75] = "CN",
  [76] = "US",
}

local ACTIVE_APPLICANT_STATUS = {
  applied = true,
  invited = true,
  inviteaccepted = true,
}

local function Print(message)
  DEFAULT_CHAT_FRAME:AddMessage("|cffffc86aRAA Exporter:|r " .. tostring(message))
end

local function EnsureDB()
  RaidApplicantAdvisorExporterDB = RaidApplicantAdvisorExporterDB or {}
  DB = DB or RaidApplicantAdvisorExporterDB
  DB.lastMode = DB.lastMode or "both"
  return DB
end

local function Trim(value)
  return tostring(value or ""):match("^%s*(.-)%s*$")
end

local function NormalizeRealm(value)
  value = Trim(value)
  if value == "" then
    value = GetNormalizedRealmName and GetNormalizedRealmName() or GetRealmName()
  end

  value = value:gsub("%s+", "")
  value = value:gsub("%.", "")
  return value
end

local function RegionName()
  local id = GetCurrentRegion and GetCurrentRegion() or 1
  return REGION_NAMES[id] or "US"
end

local function ClassName(classToken, localizedClass)
  if classToken and CLASS_NAMES[classToken] then
    return CLASS_NAMES[classToken]
  end

  return Trim(localizedClass)
end

local function RoleName(assignedRole, tank, healer, damage, specRole)
  local role = assignedRole
  if not role or role == "" or role == "NONE" then
    role = specRole
  end

  if not role or role == "" or role == "NONE" then
    if tank then
      role = "TANK"
    elseif healer then
      role = "HEALER"
    elseif damage then
      role = "DAMAGER"
    end
  end

  if role == "TANK" then
    return "Tank"
  end

  if role == "HEALER" then
    return "Healer"
  end

  return "DPS"
end

local function SplitCharacterName(fullName)
  local name, realm = strsplit("-", Trim(fullName), 2)
  name = Trim(name)
  realm = NormalizeRealm(realm)
  return name, realm
end

local function FormatItemLevel(value)
  local number = tonumber(value)
  if not number or number <= 0 then
    return ""
  end

  if math.floor(number) == number then
    return tostring(number)
  end

  return string.format("%.1f", number)
end

local function IsProtectedTextValue(value)
  value = Trim(value)
  return value:match("^|K.*|k$") ~= nil
end

local function FormatApplicationNote(value)
  value = Trim(value)
  if value == "" then
    return ""
  end

  if IsProtectedTextValue(value) then
    return ""
  end

  value = value:gsub("[\r\n\t]+", " ")
  value = value:gsub(",", " ")
  value = value:gsub("%s+", " ")
  return Trim(value)
end

local function ApplicantNote(applicantData)
  if not applicantData then
    return ""
  end

  return FormatApplicationNote(
    applicantData.comment or
    applicantData.note or
    applicantData.message or
    applicantData.applicationText or
    applicantData.description
  )
end

local function FormatContextValue(value)
  value = Trim(value)
  if value == "" then
    return ""
  end

  value = value:gsub("[\r\n\t]+", " ")
  value = value:gsub("%s+", " ")
  return Trim(value)
end

local function IsProtectedContextValue(value)
  return IsProtectedTextValue(value)
end

local function AddContextLine(lines, key, value)
  value = FormatContextValue(value)
  if value ~= "" and not IsProtectedContextValue(value) then
    table.insert(lines, key .. "=" .. value)
  end
end

local function AddProtectedContextLine(lines, key, value)
  if IsProtectedContextValue(value) then
    table.insert(lines, key .. "=true")
  end
end

local function FirstContextValue(...)
  for index = 1, select("#", ...) do
    local value = select(index, ...)
    if value ~= nil and FormatContextValue(value) ~= "" then
      return value
    end
  end

  return nil
end

local function FirstActivityID(activeEntry)
  local activityID = FirstContextValue(activeEntry.activityID, activeEntry.activityId, activeEntry.activity)
  if activityID then
    return tonumber(activityID) or activityID
  end

  local activityIDs = activeEntry.activityIDs or activeEntry.activityIds
  if type(activityIDs) == "table" then
    for _, value in ipairs(activityIDs) do
      if value then
        return tonumber(value) or value
      end
    end
  end

  return nil
end

local function ActiveEntryInfo()
  if not C_LFGList or not C_LFGList.GetActiveEntryInfo then
    return {}
  end

  local ok, result1, result2, result3, result4, result5, result6, result7, result8, result9, result10 =
    SafeCall(C_LFGList.GetActiveEntryInfo)
  if not ok then
    return {}
  end

  if type(result1) == "table" then
    return result1
  end

  return {
    activityID = result1,
    requiredItemLevel = result2,
    honorLevel = result3,
    name = result4,
    comment = result5,
    voiceChat = result6,
    duration = result7,
    autoAccept = result8,
    privateGroup = result9,
    questID = result10,
  }
end

local function ActivityInfo(activityID)
  if not activityID or not C_LFGList then
    return {}
  end

  if C_LFGList.GetActivityInfoTable then
    local ok, activityInfo = SafeCall(C_LFGList.GetActivityInfoTable, activityID)
    if ok and type(activityInfo) == "table" then
      return activityInfo
    end
  end

  if C_LFGList.GetActivityInfo then
    local ok, name, shortName, categoryID, groupFinderActivityGroupID, itemLevel, filters, minLevel, maxPlayers,
      displayType, orderIndex, useHonorLevel, showQuickJoinToast, isMythicPlusActivity, isRatedPvpActivity,
      isCurrentRaidActivity = SafeCall(C_LFGList.GetActivityInfo, activityID)
    if ok then
      return {
        fullName = name,
        shortName = shortName,
        categoryID = categoryID,
        groupFinderActivityGroupID = groupFinderActivityGroupID,
        itemLevel = itemLevel,
        filters = filters,
        minLevel = minLevel,
        maxPlayers = maxPlayers,
        displayType = displayType,
        orderIndex = orderIndex,
        useHonorLevel = useHonorLevel,
        showQuickJoinToast = showQuickJoinToast,
        isMythicPlusActivity = isMythicPlusActivity,
        isRatedPvpActivity = isRatedPvpActivity,
        isCurrentRaidActivity = isCurrentRaidActivity,
      }
    end
  end

  return {}
end

local function DifficultyName(difficultyID)
  if not difficultyID or not GetDifficultyInfo then
    return ""
  end

  local ok, name = SafeCall(GetDifficultyInfo, difficultyID)
  if ok then
    return name
  end

  return ""
end

local function BuildLine(name, realm, region, role, className, specName, itemLevel, applicationNote)
  local fields = {
    Trim(name) .. "-" .. NormalizeRealm(realm) .. "-" .. region,
    Trim(role),
    Trim(className),
    Trim(specName),
  }

  local formattedItemLevel = FormatItemLevel(itemLevel)
  if formattedItemLevel ~= "" then
    fields[5] = ""
    fields[6] = ""
    fields[7] = ""
    fields[8] = ""
    fields[9] = ""
    fields[10] = ""
    fields[11] = formattedItemLevel
  end

  local formattedApplicationNote = FormatApplicationNote(applicationNote)
  if formattedApplicationNote ~= "" then
    for index = 5, 11 do
      fields[index] = fields[index] or ""
    end
    fields[12] = formattedApplicationNote
  end

  return table.concat(fields, ",")
end

local function SpecInfoByID(specID)
  if not specID or specID == 0 or not GetSpecializationInfoByID then
    return "", nil
  end

  local _, specName, _, _, _, specRole = GetSpecializationInfoByID(specID)
  return Trim(specName), specRole
end

local function PlayerSpecNameAndRole()
  if not GetSpecialization or not GetSpecializationInfo then
    return "", nil
  end

  local specIndex = GetSpecialization()
  if not specIndex then
    return "", nil
  end

  local _, specName, _, _, _, specRole = GetSpecializationInfo(specIndex)
  return Trim(specName), specRole
end

local function UnitSpecNameAndRole(unit)
  if UnitIsUnit(unit, "player") then
    return PlayerSpecNameAndRole()
  end

  return "", nil
end

local function ShouldIncludeApplicant(applicantData)
  if not applicantData or not applicantData.applicantID then
    return false
  end

  return ACTIVE_APPLICANT_STATUS[applicantData.applicationStatus or ""] == true
end

function SafeCall(fn, ...)
  local ok, result1, result2, result3, result4, result5, result6, result7, result8, result9, result10, result11, result12,
    result13, result14, result15, result16 = pcall(fn, ...)
  if ok then
    return true, result1, result2, result3, result4, result5, result6, result7, result8, result9, result10, result11,
      result12, result13, result14, result15, result16
  end

  return false, result1
end

local function ActiveApplicantKey(applicantID, applicantData)
  local memberNames = {}
  local memberCount = applicantData and applicantData.numMembers or 0

  if C_LFGList and C_LFGList.GetApplicantMemberInfo then
    for memberIndex = 1, memberCount do
      local memberOk, fullName = SafeCall(C_LFGList.GetApplicantMemberInfo, applicantID, memberIndex)
      if memberOk and fullName and Trim(fullName) ~= "" then
        memberNames[#memberNames + 1] = Trim(fullName)
      end
    end
  end

  table.sort(memberNames)
  if #memberNames > 0 then
    return tostring(applicantID) .. ":" .. table.concat(memberNames, ";")
  end

  return tostring(applicantID)
end

function Exporter:ReadActiveApplicantKeys()
  local keys = {}
  local count = 0

  if not C_LFGList or not C_LFGList.GetApplicants or not C_LFGList.GetApplicantInfo then
    return keys, count
  end

  local ok, applicants = SafeCall(C_LFGList.GetApplicants)
  if not ok then
    return keys, count
  end

  applicants = applicants or {}
  for _, applicantID in ipairs(applicants) do
    local applicantOk, applicantData = SafeCall(C_LFGList.GetApplicantInfo, applicantID)
    if applicantOk and ShouldIncludeApplicant(applicantData) then
      keys[ActiveApplicantKey(applicantID, applicantData)] = true
      count = count + 1
    end
  end

  return keys, count
end

function Exporter:CaptureApplicantBaseline()
  local keys, count = self:ReadActiveApplicantKeys()
  self.knownApplicantKeys = keys
  self.knownApplicantCount = count
  return count
end

local function CountNewApplicantKeys(previousKeys, currentKeys)
  local count = 0
  previousKeys = previousKeys or {}

  for key in pairs(currentKeys or {}) do
    if not previousKeys[key] then
      count = count + 1
    end
  end

  return count
end

function Exporter:ExportApplicants(options)
  options = options or {}
  if not C_LFGList or not C_LFGList.GetApplicants then
    return "", "Group Finder applicant API is unavailable."
  end

  if C_LFGList.RefreshApplicants and not options.skipRefresh then
    SafeCall(C_LFGList.RefreshApplicants)
  end

  local region = RegionName()
  local lines = {}
  local ok, applicants = SafeCall(C_LFGList.GetApplicants)
  if not ok then
    return "", "Could not read Group Finder applicants yet."
  end

  applicants = applicants or {}
  local skipped = 0
  local pending = 0

  for _, applicantID in ipairs(applicants) do
    local applicantOk, applicantData = SafeCall(C_LFGList.GetApplicantInfo, applicantID)

    if applicantOk and ShouldIncludeApplicant(applicantData) then
      local memberCount = applicantData.numMembers or 0
      local applicationNote = ApplicantNote(applicantData)

      for memberIndex = 1, memberCount do
        local memberOk, fullName, classToken, localizedClass, level, itemLevel, honorLevel, tank, healer, damage, assignedRole,
          relationship, dungeonScore, pvpItemLevel, factionGroup, raceID, specID =
          SafeCall(C_LFGList.GetApplicantMemberInfo, applicantID, memberIndex)

        if memberOk and fullName then
          local name, realm = SplitCharacterName(fullName)
          local specName, specRole = SpecInfoByID(specID)
          local role = RoleName(assignedRole, tank, healer, damage, specRole)
          local className = ClassName(classToken, localizedClass)
          table.insert(lines, BuildLine(name, realm, region, role, className, specName, itemLevel, applicationNote))
        else
          pending = pending + 1
        end
      end
    elseif applicantOk then
      skipped = skipped + 1
    else
      pending = pending + 1
    end
  end

  local suffix = ""
  if skipped > 0 then
    suffix = " Skipped " .. skipped .. " inactive applicant records."
  end
  if pending > 0 then
    suffix = suffix .. " " .. pending .. " applicant record(s) still loading."
  end

  return table.concat(lines, "\n"), "Exported " .. #lines .. " applicant member(s)." .. suffix
end

local function GroupUnits()
  local units = {}

  if IsInRaid() then
    for index = 1, GetNumGroupMembers() do
      table.insert(units, "raid" .. index)
    end
  elseif IsInGroup() then
    table.insert(units, "player")
    for index = 1, GetNumSubgroupMembers() do
      table.insert(units, "party" .. index)
    end
  else
    table.insert(units, "player")
  end

  return units
end

function Exporter:ExportRoster()
  local region = RegionName()
  local lines = {}

  for _, unit in ipairs(GroupUnits()) do
    if UnitExists(unit) and UnitIsPlayer(unit) then
      local name, realm = UnitFullName(unit)
      local localizedClass, classToken = UnitClass(unit)
      local specName, specRole = UnitSpecNameAndRole(unit)
      local assignedRole = UnitGroupRolesAssigned(unit)
      local role = RoleName(assignedRole, nil, nil, true, specRole)
      local className = ClassName(classToken, localizedClass)
      table.insert(lines, BuildLine(name, realm, region, role, className, specName))
    end
  end

  return table.concat(lines, "\n"), "Exported " .. #lines .. " roster member(s)."
end

function Exporter:ExportContext()
  local activeEntry = ActiveEntryInfo()
  local activityID = FirstActivityID(activeEntry)
  local activityInfo = ActivityInfo(activityID)
  local difficultyID = FirstContextValue(
    activityInfo.difficultyID,
    activityInfo.difficultyId,
    activeEntry.difficultyID,
    activeEntry.difficultyId
  )
  local lines = {}
  local groupType = IsInRaid() and "raid" or (IsInGroup() and "party" or "solo")
  local groupSize = GetNumGroupMembers and GetNumGroupMembers() or 1
  local instanceName, instanceType, instanceDifficultyID, instanceDifficultyName = nil, nil, nil, nil
  if GetInstanceInfo then
    local ok, name, typeName, difficulty, difficultyName = SafeCall(GetInstanceInfo)
    if ok then
      instanceName = name
      instanceType = typeName
      instanceDifficultyID = difficulty
      instanceDifficultyName = difficultyName
    end
  end

  AddContextLine(lines, "exportedAt", date and date("!%Y-%m-%dT%H:%M:%SZ") or "")
  AddContextLine(lines, "groupType", groupType)
  AddContextLine(lines, "groupSize", groupSize)
  AddContextLine(lines, "activityId", activityID)
  AddContextLine(lines, "activityName", FirstContextValue(activityInfo.fullName, activityInfo.name, activityInfo.activityName))
  AddContextLine(lines, "activityShortName", activityInfo.shortName)
  AddContextLine(lines, "listingName", FirstContextValue(activeEntry.name, activeEntry.title))
  AddProtectedContextLine(lines, "listingTextProtected", FirstContextValue(activeEntry.name, activeEntry.title))
  AddContextLine(lines, "comment", activeEntry.comment)
  AddProtectedContextLine(lines, "commentTextProtected", activeEntry.comment)
  AddContextLine(lines, "categoryId", activityInfo.categoryID)
  AddContextLine(lines, "groupFinderActivityGroupId", activityInfo.groupFinderActivityGroupID)
  AddContextLine(lines, "difficultyId", difficultyID)
  AddContextLine(lines, "difficultyName", FirstContextValue(activityInfo.difficultyName, DifficultyName(difficultyID)))
  AddContextLine(lines, "minItemLevel", FirstContextValue(activeEntry.requiredItemLevel, activityInfo.itemLevel))
  AddContextLine(lines, "instanceName", instanceName)
  AddContextLine(lines, "instanceType", instanceType)
  AddContextLine(lines, "instanceDifficultyId", instanceDifficultyID)
  AddContextLine(lines, "instanceDifficultyName", instanceDifficultyName)

  return table.concat(lines, "\n")
end

function Exporter:ExportBoth(options)
  local rosterText, rosterStatus = self:ExportRoster()
  local applicantText, applicantStatus = self:ExportApplicants(options)
  local contextText = self:ExportContext()
  local rosterCount = rosterText ~= "" and select(2, rosterText:gsub("\n", "\n")) + 1 or 0
  local applicantCount = applicantText ~= "" and select(2, applicantText:gsub("\n", "\n")) + 1 or 0

  local text = table.concat({
    "RAA_EXPORT_V1",
    "[CONTEXT]",
    contextText,
    "[ROSTER]",
    rosterText,
    "[APPLICANTS]",
    applicantText,
  }, "\n")

  return text, "Exported " .. rosterCount .. " roster member(s) and " .. applicantCount .. " applicant member(s)."
end

local function CreateButton(parent, text, width, onClick)
  local button = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
  button:SetSize(width, 24)
  button:SetText(text)
  button:SetScript("OnClick", onClick)
  return button
end

local function CreateExportPanel(parent)
  local panel = CreateFrame("Frame", nil, parent)
  panel:SetFrameLevel(parent:GetFrameLevel() + 1)

  local bg = panel:CreateTexture(nil, "BACKGROUND")
  bg:SetAllPoints()
  bg:SetColorTexture(0.01, 0.01, 0.01, 0.78)

  local function addLine(pointA, pointB, height, width)
    local line = panel:CreateTexture(nil, "BORDER")
    line:SetColorTexture(0.62, 0.48, 0.16, 0.85)
    line:SetPoint(pointA)
    line:SetPoint(pointB)
    if height then
      line:SetHeight(height)
    end
    if width then
      line:SetWidth(width)
    end
  end

  addLine("TOPLEFT", "TOPRIGHT", 1, nil)
  addLine("BOTTOMLEFT", "BOTTOMRIGHT", 1, nil)
  addLine("TOPLEFT", "BOTTOMLEFT", nil, 1)
  addLine("TOPRIGHT", "BOTTOMRIGHT", nil, 1)

  return panel
end

local function PreviewExportText(text)
  text = tostring(text or "")
  if text == "" then
    return ""
  end

  local sections = {
    CONTEXT = {},
    ROSTER = {},
    APPLICANTS = {},
  }
  local currentSection

  for line in (text .. "\n"):gmatch("(.-)\n") do
    local section = line:match("^%[(.-)%]$")
    if section then
      currentSection = section
    elseif currentSection and sections[currentSection] then
      sections[currentSection][#sections[currentSection] + 1] = line
    end
  end

  local function cleanLine(line)
    line = Trim(line)
    if #line > 96 then
      line = line:sub(1, 96) .. "..."
    end
    return line
  end

  local function nonEmptyLines(lines)
    local result = {}
    for _, line in ipairs(lines) do
      line = cleanLine(line)
      if line ~= "" then
        result[#result + 1] = line
      end
    end
    return result
  end

  local function contextValue(key)
    for _, line in ipairs(sections.CONTEXT) do
      local value = line:match("^" .. key .. "=(.*)$")
      if value then
        return cleanLine(value)
      end
    end
    return ""
  end

  local roster = nonEmptyLines(sections.ROSTER)
  local applicants = nonEmptyLines(sections.APPLICANTS)
  local previewLines = {
    "Export ready. Click Copy for the full text.",
    "Format: RAA_EXPORT_V1",
  }

  local listing = contextValue("listingName")
  local activity = contextValue("activityName")
  local difficulty = contextValue("difficultyName")
  if listing ~= "" then
    previewLines[#previewLines + 1] = "Listing: " .. listing
  elseif activity ~= "" then
    previewLines[#previewLines + 1] = "Activity: " .. activity
  end
  if difficulty ~= "" then
    previewLines[#previewLines + 1] = "Difficulty: " .. difficulty
  end

  previewLines[#previewLines + 1] = ""
  previewLines[#previewLines + 1] = "Roster: " .. #roster .. " member(s)"
  for index = 1, math.min(#roster, 8) do
    previewLines[#previewLines + 1] = "  " .. roster[index]
  end
  if #roster > 8 then
    previewLines[#previewLines + 1] = "  ... " .. (#roster - 8) .. " more roster member(s)"
  end

  previewLines[#previewLines + 1] = ""
  previewLines[#previewLines + 1] = "Applicants: " .. #applicants .. " member(s)"
  if #applicants == 0 then
    previewLines[#previewLines + 1] = "  No active applicant rows returned right now."
  else
    for index = 1, math.min(#applicants, 6) do
      previewLines[#previewLines + 1] = "  " .. applicants[index]
    end
    if #applicants > 6 then
      previewLines[#previewLines + 1] = "  ... " .. (#applicants - 6) .. " more applicant member(s)"
    end
  end

  return table.concat(previewLines, "\n")
end

local function EncodeExportText(text)
  text = tostring(text or "")
  local encoded = text:gsub("([^A-Za-z0-9_%.%-%~])", function(character)
    return string.format("%%%02X", string.byte(character))
  end)
  return "RAA_EXPORT_ESCAPED_V1:" .. encoded
end

local function EncodedExportTextOrEmpty(text)
  text = tostring(text or "")
  if text == "" then
    return ""
  end

  return EncodeExportText(text)
end

local function CountExportSectionLines(text, sectionName)
  text = tostring(text or "")
  local inSection = false
  local count = 0

  for line in (text .. "\n"):gmatch("(.-)\n") do
    local section = line:match("^%[(.-)%]$")
    if section then
      inSection = section == sectionName
    elseif inSection and Trim(line) ~= "" then
      count = count + 1
    end
  end

  return count
end

local COPY_POPUP_NAME = "RAA_EXPORT_COPY_POPUP"

local function PopupEditBox(popup)
  if not popup then
    return nil
  end

  return popup.editBox or popup.EditBox
end

local function EnsureCopyPopup()
  if not StaticPopupDialogs or StaticPopupDialogs[COPY_POPUP_NAME] then
    return
  end

  StaticPopupDialogs[COPY_POPUP_NAME] = {
    text = "Raid Applicant Advisor export text. Press Ctrl+C, then close this box.",
    button1 = CLOSE or "Close",
    hasEditBox = true,
    editBoxWidth = 640,
    maxLetters = 999999,
    timeout = 0,
    whileDead = true,
    hideOnEscape = true,
    OnShow = function(popup, data)
      local editBox = PopupEditBox(popup)
      if not editBox then
        return
      end

      if editBox.SetMultiLine then
        editBox:SetMultiLine(true)
      end
      if editBox.SetMaxLetters then
        editBox:SetMaxLetters(999999)
      end
      editBox:SetAutoFocus(true)
      editBox:SetText(data or "")
      editBox:SetFocus()
      editBox:HighlightText()
    end,
    EditBoxOnEnterPressed = function(editBox)
      editBox:GetParent():Hide()
    end,
    EditBoxOnEscapePressed = function(editBox)
      editBox:GetParent():Hide()
    end,
  }
end

local function DebugFixtureText()
  if type(RaidApplicantAdvisorExporterBuildDebugExport) == "function" then
    local ok, text = pcall(RaidApplicantAdvisorExporterBuildDebugExport)
    if ok and type(text) == "string" and text ~= "" then
      return text
    end
  end

  if type(RaidApplicantAdvisorExporterDebugExport) == "string" and RaidApplicantAdvisorExporterDebugExport ~= "" then
    return RaidApplicantAdvisorExporterDebugExport
  end

  return "RAA_EXPORT_V1\n[ROSTER]\n[APPLICANTS]"
end

function Exporter:CreateFrame()
  if self.frame then
    return
  end

  local frame = CreateFrame("Frame", "RaidApplicantAdvisorExporterFrame", UIParent, "BasicFrameTemplateWithInset")
  frame:SetSize(720, 552)
  frame:SetPoint("CENTER")
  frame:SetMovable(true)
  frame:EnableMouse(true)
  frame:RegisterForDrag("LeftButton")
  frame:SetScript("OnDragStart", frame.StartMoving)
  frame:SetScript("OnDragStop", frame.StopMovingOrSizing)
  frame:Hide()

  frame.title = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlightLarge")
  frame.title:SetPoint("TOPLEFT", 16, -8)
  frame.title:SetText("Raid Applicant Advisor Exporter v" .. ADDON_VERSION)

  frame.status = frame:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  frame.status:SetPoint("TOPLEFT", 18, -66)
  frame.status:SetPoint("RIGHT", -18, 0)
  frame.status:SetJustifyH("LEFT")
  frame.status:SetText("Choose what to export. The live bridge text below updates in place; click Copy or press Ctrl+C there.")

  local applicantsButton = CreateButton(frame, "Applicants", 96, function()
    Exporter:ShowExport("applicants")
  end)
  applicantsButton:SetPoint("TOPLEFT", 16, -36)

  local bothButton = CreateButton(frame, "Both", 62, function()
    Exporter:ShowExport("both")
  end)
  bothButton:SetPoint("LEFT", applicantsButton, "RIGHT", 8, 0)

  local rosterButton = CreateButton(frame, "Roster", 78, function()
    Exporter:ShowExport("roster")
  end)
  rosterButton:SetPoint("LEFT", bothButton, "RIGHT", 8, 0)

  local refreshButton = CreateButton(frame, "Refresh", 78, function()
    if DB.lastMode == "debug" then
      Exporter:ShowDebugExport()
    else
      Exporter:ShowExport(DB.lastMode or "applicants")
    end
  end)
  refreshButton:SetPoint("LEFT", rosterButton, "RIGHT", 8, 0)

  local selectButton = CreateButton(frame, "Copy", 68, function()
    Exporter:CopyExportText()
  end)
  selectButton:SetPoint("LEFT", refreshButton, "RIGHT", 8, 0)

  local debugButton = CreateButton(frame, "Load Debug", 96, function()
    Exporter:ShowDebugExport()
  end)
  debugButton:SetPoint("LEFT", selectButton, "RIGHT", 8, 0)

  local exportPanel = CreateExportPanel(frame)
  exportPanel:SetPoint("TOPLEFT", 18, -92)
  exportPanel:SetPoint("BOTTOMRIGHT", -34, 94)

  local plainPreview = exportPanel:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  plainPreview:SetPoint("TOPLEFT", exportPanel, "TOPLEFT", 8, -8)
  plainPreview:SetPoint("BOTTOMRIGHT", exportPanel, "BOTTOMRIGHT", -8, 8)
  plainPreview:SetJustifyH("LEFT")
  plainPreview:SetJustifyV("TOP")
  plainPreview:SetTextColor(1, 0.96, 0.78, 1)
  plainPreview:SetText("")
  if plainPreview.SetFont then
    plainPreview:SetFont(STANDARD_TEXT_FONT or "Fonts\\FRIZQT__.TTF", 12, "")
  end
  if plainPreview.SetSpacing then
    plainPreview:SetSpacing(3)
  end

  local scrollFrame = CreateFrame("ScrollFrame", nil, frame, "UIPanelScrollFrameTemplate")
  scrollFrame:SetFrameLevel(exportPanel:GetFrameLevel() + 1)
  scrollFrame:SetPoint("TOPLEFT", exportPanel, "TOPLEFT", 8, -8)
  scrollFrame:SetPoint("BOTTOMRIGHT", exportPanel, "BOTTOMRIGHT", -28, 8)

  local scrollChild = CreateFrame("Frame", nil, scrollFrame)
  scrollChild:SetSize(620, 2000)

  local preview = scrollChild:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  preview:SetPoint("TOPLEFT", scrollChild, "TOPLEFT", 4, -4)
  preview:SetPoint("RIGHT", scrollChild, "RIGHT", -4, 0)
  preview:SetJustifyH("LEFT")
  preview:SetJustifyV("TOP")
  preview:SetTextColor(1, 0.96, 0.78, 1)
  preview:SetText("")
  if preview.SetWordWrap then
    preview:SetWordWrap(true)
  end
  if preview.SetNonSpaceWrap then
    preview:SetNonSpaceWrap(true)
  end

  local editBox = CreateFrame("EditBox", nil, scrollChild)
  editBox:SetMultiLine(true)
  editBox:SetAutoFocus(false)
  if editBox.SetFont then
    editBox:SetFont(STANDARD_TEXT_FONT or "Fonts\\FRIZQT__.TTF", 12, "")
  else
    editBox:SetFontObject(GameFontHighlightSmall)
  end
  editBox:SetWidth(620)
  editBox:SetHeight(2000)
  if editBox.SetMaxLetters then
    editBox:SetMaxLetters(999999)
  end
  editBox:SetFrameLevel(scrollFrame:GetFrameLevel() + 1)
  editBox:SetPoint("TOPLEFT", scrollChild, "TOPLEFT", 0, 0)
  editBox:SetJustifyH("LEFT")
  editBox:SetJustifyV("TOP")
  editBox:SetTextColor(1, 0.96, 0.78, 0.02)
  editBox:SetAlpha(1)
  editBox:Show()

  if editBox.SetTextInsets then
    editBox:SetTextInsets(4, 4, 4, 4)
  end

  if editBox.SetPropagateKeyboardInput then
    editBox:SetPropagateKeyboardInput(false)
  end

  editBox:SetScript("OnEditFocusGained", function(self)
    if self.SetPropagateKeyboardInput then
      self:SetPropagateKeyboardInput(false)
    end
  end)

  editBox:SetScript("OnKeyDown", function(self, key)
    if key == "C" and IsControlKeyDown() then
      self:HighlightText()
      return true
    end
    if key == "A" and IsControlKeyDown() then
      self:HighlightText()
      return true
    end
  end)

  editBox:SetScript("OnEscapePressed", function(self)
    self:ClearFocus()
  end)

  editBox:SetScript("OnTextChanged", function(self)
    if Exporter.preview then
      Exporter.preview:SetText(self:GetText() or "")
    end
    local parent = self:GetParent()
    local scrollParent = parent and parent:GetParent()
    if scrollParent and scrollParent.UpdateScrollChildRect then
      scrollParent:UpdateScrollChildRect()
    end
  end)

  scrollFrame:SetScrollChild(scrollChild)
  scrollFrame:SetVerticalScroll(0)
  scrollFrame:Hide()

  local bridgePanel = CreateExportPanel(frame)
  bridgePanel:SetHeight(58)
  bridgePanel:SetPoint("BOTTOMLEFT", 18, 18)
  bridgePanel:SetPoint("BOTTOMRIGHT", -34, 18)

  local bridgeLabel = bridgePanel:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
  bridgeLabel:SetPoint("TOPLEFT", 10, -8)
  bridgeLabel:SetJustifyH("LEFT")
  bridgeLabel:SetText("Live Bridge Text (single line)")

  local bridgeEditBox = CreateFrame("EditBox", nil, bridgePanel, "InputBoxTemplate")
  bridgeEditBox:SetAutoFocus(false)
  if bridgeEditBox.SetFont then
    bridgeEditBox:SetFont(STANDARD_TEXT_FONT or "Fonts\\FRIZQT__.TTF", 12, "")
  else
    bridgeEditBox:SetFontObject(GameFontHighlightSmall)
  end
  if bridgeEditBox.SetMaxLetters then
    bridgeEditBox:SetMaxLetters(999999)
  end
  bridgeEditBox:SetHeight(24)
  bridgeEditBox:SetPoint("TOPLEFT", bridgeLabel, "BOTTOMLEFT", 0, -6)
  bridgeEditBox:SetPoint("RIGHT", bridgePanel, "RIGHT", -10, 0)
  bridgeEditBox:SetJustifyH("LEFT")
  bridgeEditBox:SetTextColor(1, 0.96, 0.78, 1)
  if bridgeEditBox.SetPropagateKeyboardInput then
    bridgeEditBox:SetPropagateKeyboardInput(false)
  end

  bridgeEditBox:SetScript("OnKeyDown", function(self, key)
    if key == "C" and IsControlKeyDown() then
      self:HighlightText()
      return true
    end
    if key == "A" and IsControlKeyDown() then
      self:HighlightText()
      return true
    end
  end)

  bridgeEditBox:SetScript("OnEscapePressed", function(self)
    self:ClearFocus()
  end)

  self.frame = frame
  self.scrollFrame = scrollFrame
  self.scrollChild = scrollChild
  self.plainPreview = plainPreview
  self.preview = preview
  self.editBox = editBox
  self.bridgeEditBox = bridgeEditBox
  self.status = frame.status
end

function Exporter:SetExportText(text)
  text = tostring(text or "")
  local previewHadFocus = self.editBox and self.editBox.HasFocus and self.editBox:HasFocus()
  local bridgeHadFocus = self.bridgeEditBox and self.bridgeEditBox.HasFocus and self.bridgeEditBox:HasFocus()
  self.lastExportText = text
  self.lastEncodedExportText = EncodedExportTextOrEmpty(text)
  if DB then
    DB.lastExport = text
  end

  if self.preview then
    self.preview:SetText(text)
  end
  if self.plainPreview then
    self.plainPreview:SetText(PreviewExportText(text))
    self.plainPreview:Show()
  end

  if self.editBox then
    self.editBox:SetText(text)
    self.editBox:SetCursorPosition(0)
    self.editBox:SetAlpha(1)
    self.editBox:Show()
  end

  if self.bridgeEditBox then
    self.bridgeEditBox:SetText(self.lastEncodedExportText or "")
    self.bridgeEditBox:SetCursorPosition(0)
  end

  local contentHeight = 2000
  if self.preview and self.preview.GetStringHeight then
    contentHeight = math.max(contentHeight, (self.preview:GetStringHeight() or 0) + 24)
  end

  if self.scrollChild then
    self.scrollChild:SetHeight(contentHeight)
  end
  if self.preview then
    self.preview:SetHeight(contentHeight)
  end
  if self.editBox then
    self.editBox:SetHeight(contentHeight)
  end
  if self.scrollFrame then
    self.scrollFrame:UpdateScrollChildRect()
    self.scrollFrame:SetVerticalScroll(0)
  end

  if previewHadFocus and self.editBox then
    self.editBox:SetFocus()
    self.editBox:SetCursorPosition(0)
    self.editBox:HighlightText()
  elseif bridgeHadFocus and self.bridgeEditBox then
    self.bridgeEditBox:SetFocus()
    self.bridgeEditBox:SetCursorPosition(0)
    self.bridgeEditBox:HighlightText()
  end
end

function Exporter:CreateCopyFrame()
  if self.copyFrame then
    return
  end

  local frame = CreateFrame("Frame", "RaidApplicantAdvisorExporterCopyFrame", UIParent, "BasicFrameTemplateWithInset")
  frame:SetSize(760, 190)
  frame:SetPoint("CENTER", UIParent, "CENTER", 0, 40)
  frame:SetFrameStrata("DIALOG")
  frame:SetMovable(true)
  frame:EnableMouse(true)
  frame:RegisterForDrag("LeftButton")
  frame:SetScript("OnDragStart", frame.StartMoving)
  frame:SetScript("OnDragStop", frame.StopMovingOrSizing)
  frame:Hide()

  frame.title = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlightLarge")
  frame.title:SetPoint("TOPLEFT", 16, -8)
  frame.title:SetText("Copy Raid Applicant Advisor Export")

  frame.help = frame:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  frame.help:SetPoint("TOPLEFT", 18, -38)
  frame.help:SetPoint("RIGHT", -18, 0)
  frame.help:SetJustifyH("LEFT")
  frame.help:SetText("Press Ctrl+C. If the website clipboard bridge is running, it should import automatically.")

  local panel = CreateExportPanel(frame)
  panel:SetPoint("TOPLEFT", 18, -62)
  panel:SetPoint("BOTTOMRIGHT", -34, 44)

  local editBox = CreateFrame("EditBox", nil, panel, "InputBoxTemplate")
  editBox:SetAutoFocus(false)
  if editBox.SetFont then
    editBox:SetFont(STANDARD_TEXT_FONT or "Fonts\\FRIZQT__.TTF", 12, "")
  else
    editBox:SetFontObject(GameFontHighlightSmall)
  end
  editBox:SetSize(690, 24)
  if editBox.SetMaxLetters then
    editBox:SetMaxLetters(999999)
  end
  editBox:SetPoint("TOPLEFT", panel, "TOPLEFT", 10, -18)
  editBox:SetJustifyH("LEFT")
  editBox:SetTextColor(1, 0.96, 0.78, 1)
  if editBox.SetPropagateKeyboardInput then
    editBox:SetPropagateKeyboardInput(false)
  end
  editBox:SetScript("OnEscapePressed", function(self)
    self:ClearFocus()
    frame:Hide()
  end)

  frame.note = panel:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
  frame.note:SetPoint("TOPLEFT", editBox, "BOTTOMLEFT", 0, -14)
  frame.note:SetPoint("RIGHT", panel, "RIGHT", -10, 0)
  frame.note:SetJustifyH("LEFT")
  frame.note:SetText("It is intentionally one line; the website decodes it back into the normal multiline export.")

  local closeButton = CreateButton(frame, "Close", 88, function()
    frame:Hide()
  end)
  closeButton:SetPoint("BOTTOMRIGHT", -18, 14)

  self.copyFrame = frame
  self.copyEditBox = editBox
end

function Exporter:ShowCopyFrame(text)
  self:CreateCopyFrame()
  local copyText = EncodeExportText(text)
  self.copyEditBox:SetText(copyText)
  self.copyFrame:Show()
  self.copyEditBox:SetFocus()
  self.copyEditBox:SetCursorPosition(0)
  self.copyEditBox:HighlightText()
  if C_Timer and C_Timer.After then
    C_Timer.After(0.05, function()
      if Exporter.copyFrame and Exporter.copyFrame:IsShown() and Exporter.copyEditBox then
        Exporter.copyEditBox:SetFocus()
        Exporter.copyEditBox:SetCursorPosition(0)
        Exporter.copyEditBox:HighlightText()
      end
    end)
  end
end

function Exporter:HasExportText()
  return self.lastExportText and self.lastExportText ~= ""
end

function Exporter:FocusExportText(statusText)
  if not self.editBox then
    return
  end

  if self.lastExportText then
    self.editBox:SetText(self.lastExportText)
  end
  self.editBox:SetFocus()
  self.editBox:SetCursorPosition(0)
  self.editBox:HighlightText()
  if self.status then
    self.status:SetText(statusText or "Export text selected. Press Ctrl+C now, then paste into the website.")
  end

  if C_Timer and C_Timer.After then
    C_Timer.After(0.05, function()
      if Exporter.editBox and Exporter.frame and Exporter.frame:IsShown() then
        Exporter.editBox:SetFocus()
        Exporter.editBox:SetCursorPosition(0)
        Exporter.editBox:HighlightText()
      end
    end)
  end
end

function Exporter:FocusBridgeExportText(statusText)
  if not self.bridgeEditBox then
    return
  end

  self.bridgeEditBox:SetText(self.lastEncodedExportText or EncodedExportTextOrEmpty(self.lastExportText))
  self.bridgeEditBox:SetFocus()
  self.bridgeEditBox:SetCursorPosition(0)
  self.bridgeEditBox:HighlightText()
  if self.status then
    self.status:SetText(statusText or "Live bridge text selected. Press Ctrl+C now, then paste into the website.")
  end

  if C_Timer and C_Timer.After then
    C_Timer.After(0.05, function()
      if Exporter.bridgeEditBox and Exporter.frame and Exporter.frame:IsShown() then
        Exporter.bridgeEditBox:SetFocus()
        Exporter.bridgeEditBox:SetCursorPosition(0)
        Exporter.bridgeEditBox:HighlightText()
      end
    end)
  end
end

function Exporter:OpenCopyPopup()
  EnsureCopyPopup()
  if StaticPopup_Show then
    StaticPopup_Show(COPY_POPUP_NAME, nil, nil, self.lastExportText or "")
  end
end

function Exporter:TrySetClipboard(text)
  if C_Clipboard and C_Clipboard.SetClipboard then
    local ok = SafeCall(C_Clipboard.SetClipboard, text)
    return ok
  end

  return false
end

function Exporter:CopyExportText()
  local text = self.lastExportText or (self.editBox and self.editBox:GetText()) or ""
  if text == "" then
    if self.status then
      self.status:SetText("No export text is loaded yet. Click Applicants, Both, Roster, or Load Debug first.")
    end
    return
  end

  if self:TrySetClipboard(text) then
    if self.status then
      self.status:SetText("Export copied to clipboard. Paste it into the website's Addon Export box.")
    end
    return
  end

  self:FocusBridgeExportText("Live bridge text selected. Press Ctrl+C there, then paste into the website.")
end

function Exporter:OpenCopyForText(text, statusText, options)
  options = options or {}
  text = tostring(text or "")
  if text == "" then
    return
  end

  EnsureDB()
  self:CreateFrame()
  local shouldFocusBridge = options.focusBridge
  if shouldFocusBridge == nil then
    shouldFocusBridge = not (self.frame and self.frame:IsShown())
      or (self.bridgeEditBox and self.bridgeEditBox.HasFocus and self.bridgeEditBox:HasFocus())
  end

  self:SetExportText(text)
  self.frame:Show()

  if shouldFocusBridge then
    self:FocusBridgeExportText(statusText)
  elseif self.status and statusText then
    self.status:SetText(statusText)
  end
end

function Exporter:OpenCurrentCopyExport(options)
  options = options or {}
  EnsureDB()

  local text, status = self:ExportBoth(options)
  self:OpenCopyForText(text, status .. " Live bridge text selected; press Ctrl+C.")
end

function Exporter:QueueApplicantAutoCopy(newApplicantCount)
  EnsureDB()
  if not DB.autoOpenOnApplicants or self.autoCopyQueued then
    return
  end

  self.autoCopyQueued = true

  local function openCopy(attempt)
    attempt = attempt or 1
    Exporter.autoCopyQueued = false
    EnsureDB()

    if not DB.autoOpenOnApplicants then
      return
    end

    local text, status = Exporter:ExportBoth({ skipRefresh = true })
    local applicantLines = CountExportSectionLines(text, "APPLICANTS")
    local expectedApplicantGroups = Exporter.knownApplicantCount or 0
    if applicantLines < expectedApplicantGroups and expectedApplicantGroups > 0 and attempt < AUTO_COPY_MAX_ATTEMPTS and C_Timer and C_Timer.After then
      Exporter.autoCopyQueued = true
      C_Timer.After(AUTO_COPY_RETRY_SECONDS, function()
        openCopy(attempt + 1)
      end)
      return
    end

    Exporter:OpenCopyForText(
      text,
      status .. " New applicant detected (" .. tostring(newApplicantCount) .. "); press Ctrl+C."
    )
  end

  if C_Timer and C_Timer.After then
    C_Timer.After(AUTO_COPY_DELAY_SECONDS, openCopy)
  else
    openCopy()
  end
end

function Exporter:HandleApplicantListUpdated()
  EnsureDB()

  if not DB.autoOpenOnApplicants then
    return
  end

  local currentKeys, currentCount = self:ReadActiveApplicantKeys()

  if not self.knownApplicantKeys then
    self.knownApplicantKeys = currentKeys
    self.knownApplicantCount = currentCount
    return
  end

  local newApplicantCount = CountNewApplicantKeys(self.knownApplicantKeys, currentKeys)
  self.knownApplicantKeys = currentKeys
  self.knownApplicantCount = currentCount

  if newApplicantCount > 0 then
    self:QueueApplicantAutoCopy(newApplicantCount)
  end
end

function Exporter:SetAutoOpenOnApplicants(enabled)
  EnsureDB()
  DB.autoOpenOnApplicants = enabled and true or false

  if DB.autoOpenOnApplicants then
    local count = self:CaptureApplicantBaseline()
    Print("Auto-open copy is ON. Current applicant baseline: " .. tostring(count) .. ".")
  else
    Print("Auto-open copy is OFF.")
  end
end

function Exporter:ShowAutoOpenStatus()
  EnsureDB()
  local status = DB.autoOpenOnApplicants and "ON" or "OFF"
  local baseline = self.knownApplicantCount
  if baseline == nil then
    baseline = self:CaptureApplicantBaseline()
  end

  Print("Auto-open copy is " .. status .. ". Current applicant baseline: " .. tostring(baseline) .. ".")
end

function Exporter:ShowDebugAutoExport()
  EnsureDB()
  DB.lastMode = "debug"
  self:OpenCopyForText(DebugFixtureText(), "Debug applicant list changed. Press Ctrl+C to test the bridge.")
end

function Exporter:ScheduleDebugApplicantSimulator(immediate)
  EnsureDB()

  if not DB.debugApplicantSimulator or self.debugApplicantTimerQueued then
    return
  end

  self.debugApplicantTimerQueued = true
  local delay = immediate and 0.1 or DEBUG_AUTO_INTERVAL_SECONDS

  local function tick()
    Exporter.debugApplicantTimerQueued = false
    EnsureDB()

    if not DB.debugApplicantSimulator then
      return
    end

    Exporter:ShowDebugAutoExport()
    Exporter:ScheduleDebugApplicantSimulator(false)
  end

  if C_Timer and C_Timer.After then
    C_Timer.After(delay, tick)
  else
    tick()
  end
end

function Exporter:SetDebugApplicantSimulator(enabled)
  EnsureDB()
  DB.debugApplicantSimulator = enabled and true or false

  if DB.debugApplicantSimulator then
    Print("Debug applicant simulator is ON. It will refresh the live bridge text every " .. tostring(DEBUG_AUTO_INTERVAL_SECONDS) .. " seconds.")
    self:ScheduleDebugApplicantSimulator(true)
  else
    Print("Debug applicant simulator is OFF.")
  end
end

function Exporter:ShowLastExport()
  RaidApplicantAdvisorExporterDB = RaidApplicantAdvisorExporterDB or {}
  DB = DB or RaidApplicantAdvisorExporterDB

  self:CreateFrame()
  local text = self.lastExportText or DB.lastExport or ""
  self:SetExportText(text)
  self.frame:Show()
  if self.status then
    if text ~= "" then
      self.status:SetText("Loaded the last saved export. Click Copy or press Ctrl+C in the live bridge box, then paste into the website.")
    else
      self.status:SetText("No previous export is saved yet. Use /raa while your listing is active.")
    end
  end
end

function Exporter:ShowDebugExport()
  RaidApplicantAdvisorExporterDB = RaidApplicantAdvisorExporterDB or {}
  DB = DB or RaidApplicantAdvisorExporterDB

  self:CreateFrame()
  DB.lastMode = "debug"
  self:SetExportText(DebugFixtureText())
  self.frame:Show()
  if self.status then
    self.status:SetText("Loaded debug fixture with stable roster and changing applicants. Click Copy or press Ctrl+C in the live bridge box.")
  end
end

function Exporter:ShowExport(mode, options)
  options = options or {}
  RaidApplicantAdvisorExporterDB = RaidApplicantAdvisorExporterDB or {}
  DB = DB or RaidApplicantAdvisorExporterDB

  self:CreateFrame()

  if mode ~= "roster" and mode ~= "applicants" then
    mode = "both"
  end

  DB.lastMode = mode

  local text, status
  if mode == "roster" then
    text, status = self:ExportRoster()
  elseif mode == "applicants" then
    text, status = self:ExportApplicants(options)
  else
    text, status = self:ExportBoth(options)
  end

  if options.preserveExistingOnEmpty and Trim(text) == "" and self:HasExportText() then
    if self.status then
      self.status:SetText(status .. " Keeping the previous export while Group Finder finishes loading.")
    end
    self.frame:Show()
    return
  end

  self:SetExportText(text)

  local target = "Addon Export"
  if mode == "roster" then
    target = "Roster"
  elseif mode == "applicants" then
    target = "Applicants"
  end

  self.status:SetText(status .. " Click Copy or press Ctrl+C in the live bridge box, then paste into the website's " .. target .. " box.")
  self.frame:Show()
end

function Exporter:RefreshIfVisible(event)
  if not self.frame or not self.frame:IsShown() then
    return
  end

  if DB.lastMode == "debug" then
    return
  end

  if event == "GROUP_ROSTER_UPDATE" and DB.lastMode ~= "roster" and DB.lastMode ~= "both" then
    return
  end

  if event ~= "GROUP_ROSTER_UPDATE" and DB.lastMode == "roster" then
    return
  end

  if self.refreshQueued then
    return
  end

  self.refreshQueued = true
  local mode = DB.lastMode or "applicants"
  local function refresh()
    Exporter.refreshQueued = false
    if not Exporter.frame or not Exporter.frame:IsShown() then
      return
    end

    local ok, errorMessage = pcall(function()
      Exporter:ShowExport(mode, {
        skipRefresh = true,
        preserveFocus = true,
        preserveExistingOnEmpty = true,
      })
    end)

    if not ok then
      if Exporter.status then
        Exporter.status:SetText("Applicant refresh failed briefly; click Refresh to try again.")
      end
      Print("Applicant refresh failed: " .. tostring(errorMessage))
    end
  end

  if C_Timer and C_Timer.After then
    C_Timer.After(0.35, refresh)
  else
    refresh()
  end
end

local eventFrame = CreateFrame("Frame")
eventFrame:RegisterEvent("ADDON_LOADED")
eventFrame:RegisterEvent("GROUP_ROSTER_UPDATE")
eventFrame:RegisterEvent("LFG_LIST_APPLICANT_LIST_UPDATED")
eventFrame:RegisterEvent("LFG_LIST_APPLICANT_UPDATED")
eventFrame:SetScript("OnEvent", function(_, event, ...)
  if event == "ADDON_LOADED" then
    local loadedName = ...
    if loadedName ~= ADDON_NAME then
      return
    end

    EnsureDB()
    if DB.autoOpenOnApplicants and C_Timer and C_Timer.After then
      C_Timer.After(1, function()
        Exporter:CaptureApplicantBaseline()
      end)
    elseif DB.autoOpenOnApplicants then
      Exporter:CaptureApplicantBaseline()
    end

    if DB.debugApplicantSimulator then
      Exporter:ScheduleDebugApplicantSimulator(true)
    end
    return
  end

  if DB then
    if event == "LFG_LIST_APPLICANT_LIST_UPDATED" or event == "LFG_LIST_APPLICANT_UPDATED" then
      Exporter:HandleApplicantListUpdated()
    end

    Exporter:RefreshIfVisible(event)
  end
end)

SLASH_RAIDADVISOREXPORTER1 = "/raa"
SLASH_RAIDADVISOREXPORTER2 = "/raidapplicants"
SlashCmdList.RAIDADVISOREXPORTER = function(message)
  message = Trim(message):lower()
  local command, rest = message:match("^(%S*)%s*(.-)$")
  command = command or ""
  rest = Trim(rest or "")
  local restCommand, restArgs = rest:match("^(%S*)%s*(.-)$")
  restCommand = restCommand or ""
  restArgs = Trim(restArgs or "")

  if command == "copy" then
    Exporter:OpenCurrentCopyExport()
    return
  end

  if command == "auto" then
    if rest == "on" or rest == "1" or rest == "true" then
      Exporter:SetAutoOpenOnApplicants(true)
    elseif rest == "off" or rest == "0" or rest == "false" then
      Exporter:SetAutoOpenOnApplicants(false)
    elseif rest == "status" then
      Exporter:ShowAutoOpenStatus()
    else
      EnsureDB()
      Exporter:SetAutoOpenOnApplicants(not DB.autoOpenOnApplicants)
    end
    return
  end

  if command == "debugauto" or command == "sim" or (command == "debug" and (restCommand == "auto" or restCommand == "watch" or restCommand == "sim")) then
    EnsureDB()
    local debugAutoArg = rest
    if command == "debug" then
      debugAutoArg = restArgs
    end

    if debugAutoArg == "on" or debugAutoArg == "1" or debugAutoArg == "true" then
      Exporter:SetDebugApplicantSimulator(true)
    elseif debugAutoArg == "off" or debugAutoArg == "0" or debugAutoArg == "false" then
      Exporter:SetDebugApplicantSimulator(false)
    else
      Exporter:SetDebugApplicantSimulator(not DB.debugApplicantSimulator)
    end
    return
  end

  if command == "debugcopy" or (command == "debug" and (rest == "copy" or rest == "open")) then
    Exporter:ShowDebugAutoExport()
    return
  end

  if message == "roster" or message == "group" or message == "raid" then
    Exporter:ShowExport("roster")
    return
  end

  if message == "applicants" or message == "apps" then
    Exporter:ShowExport("applicants")
    return
  end

  if message == "both" or message == "all" or message == "" then
    Exporter:ShowExport("both")
    return
  end

  if message == "debug" or message == "fixture" or message == "test" then
    Exporter:ShowDebugExport()
    return
  end

  if message == "last" or message == "previous" then
    Exporter:ShowLastExport()
    return
  end

  if message == "version" then
    Print("Version " .. ADDON_VERSION)
    return
  end

  Print("Use /raa, /raa copy, /raa auto, /raa applicants, /raa roster, /raa debug, /raa debugauto, /raa last, or /raa version.")
end
