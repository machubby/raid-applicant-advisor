local ADDON_NAME = ...

local Exporter = {}
local DB

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

local function FormatApplicationNote(value)
  value = Trim(value)
  if value == "" then
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

local function SafeCall(fn, ...)
  local ok, result1, result2, result3, result4, result5, result6, result7, result8, result9, result10, result11, result12,
    result13, result14, result15, result16 = pcall(fn, ...)
  if ok then
    return true, result1, result2, result3, result4, result5, result6, result7, result8, result9, result10, result11,
      result12, result13, result14, result15, result16
  end

  return false, result1
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

function Exporter:ExportBoth(options)
  local rosterText, rosterStatus = self:ExportRoster()
  local applicantText, applicantStatus = self:ExportApplicants(options)
  local rosterCount = rosterText ~= "" and select(2, rosterText:gsub("\n", "\n")) + 1 or 0
  local applicantCount = applicantText ~= "" and select(2, applicantText:gsub("\n", "\n")) + 1 or 0

  local text = table.concat({
    "RAA_EXPORT_V1",
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
  frame:SetSize(720, 480)
  frame:SetPoint("CENTER")
  frame:SetMovable(true)
  frame:EnableMouse(true)
  frame:RegisterForDrag("LeftButton")
  frame:SetScript("OnDragStart", frame.StartMoving)
  frame:SetScript("OnDragStop", frame.StopMovingOrSizing)
  frame:Hide()

  frame.title = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlightLarge")
  frame.title:SetPoint("TOPLEFT", 16, -8)
  frame.title:SetText("Raid Applicant Advisor Exporter")

  frame.status = frame:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  frame.status:SetPoint("TOPLEFT", 18, -66)
  frame.status:SetPoint("RIGHT", -18, 0)
  frame.status:SetJustifyH("LEFT")
  frame.status:SetText("Choose what to export, then click Copy and press Ctrl+C.")

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
    Exporter:FocusExportText()
  end)
  selectButton:SetPoint("LEFT", refreshButton, "RIGHT", 8, 0)

  local debugButton = CreateButton(frame, "Load Debug", 96, function()
    Exporter:ShowDebugExport()
  end)
  debugButton:SetPoint("LEFT", selectButton, "RIGHT", 8, 0)

  local scrollFrame = CreateFrame("ScrollFrame", nil, frame, "UIPanelScrollFrameTemplate")
  scrollFrame:SetPoint("TOPLEFT", 18, -92)
  scrollFrame:SetPoint("BOTTOMRIGHT", -34, 18)

  local editBox = CreateFrame("EditBox", nil, scrollFrame)
  editBox:SetMultiLine(true)
  editBox:SetAutoFocus(false)
  editBox:SetFontObject(ChatFontNormal)
  editBox:SetWidth(650)
  if editBox.SetPropagateKeyboardInput then
    editBox:SetPropagateKeyboardInput(false)
  end
  editBox:SetScript("OnEditFocusGained", function(self)
    if self.SetPropagateKeyboardInput then
      self:SetPropagateKeyboardInput(false)
    end
  end)
  editBox:SetScript("OnEscapePressed", function(self)
    self:ClearFocus()
  end)
  editBox:SetScript("OnTextChanged", function(self)
    local parent = self:GetParent()
    if parent and parent.ScrollBar then
      parent:UpdateScrollChildRect()
    end
  end)

  scrollFrame:SetScrollChild(editBox)

  self.frame = frame
  self.editBox = editBox
  self.status = frame.status
end

function Exporter:FocusExportText(statusText)
  if not self.editBox then
    return
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

function Exporter:ShowDebugExport()
  RaidApplicantAdvisorExporterDB = RaidApplicantAdvisorExporterDB or {}
  DB = DB or RaidApplicantAdvisorExporterDB

  self:CreateFrame()
  DB.lastMode = "debug"
  self.editBox:SetText(DebugFixtureText())
  self.frame:Show()
  self:FocusExportText("Loaded randomized debug fixture. Press Ctrl+C now; the clipboard bridge should import it.")
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

  self.editBox:SetText(text)
  local target = "Addon Export"
  if mode == "roster" then
    target = "Roster"
  elseif mode == "applicants" then
    target = "Applicants"
  end

  self.status:SetText(status .. " Click Copy, press Ctrl+C, then paste into the website's " .. target .. " box.")
  self.frame:Show()
  if not options.preserveFocus then
    self:FocusExportText()
  end
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

    RaidApplicantAdvisorExporterDB = RaidApplicantAdvisorExporterDB or {}
    DB = RaidApplicantAdvisorExporterDB
    DB.lastMode = DB.lastMode or "both"
    return
  end

  if DB then
    Exporter:RefreshIfVisible(event)
  end
end)

SLASH_RAIDADVISOREXPORTER1 = "/raa"
SLASH_RAIDADVISOREXPORTER2 = "/raidapplicants"
SlashCmdList.RAIDADVISOREXPORTER = function(message)
  message = Trim(message):lower()

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

  Print("Use /raa, /raa applicants, /raa roster, or /raa debug.")
end
