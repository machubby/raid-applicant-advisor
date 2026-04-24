(function () {
  const data = window.RAID_DATA;
  const API_BASE = window.location.protocol === "file:" ? "http://127.0.0.1:4177" : "";
  const DECLINED_STORAGE_KEY = "raaDeclinedApplicantsV1";
  const ACCEPTED_STORAGE_KEY = "raaAcceptedApplicantsV1";
  const ADDON_IMPORT_STORAGE_KEY = "raaLastAddonImportSnapshotV1";
  const CLIENT_ID_STORAGE_KEY = "raaClientIdV1";
  const DECISION_POLL_INTERVAL_MS = 2500;
  const LOG_FETCH_CONCURRENCY = 3;
  const RAID_AVERAGE_BOSS_VALUE = "__raid_average__";
  const RAID_AVERAGE_BOSS_LABEL = "Raid average";
  const SCORE_MODE_RAID = "raid";
  const SCORE_MODE_MPLUS = "mplus";
  const MIN_SCORING_RAID_DIFFICULTY = 4;
  const MYTHIC_PLUS_RANGES = [
    { id: "2-3", label: "+2 to +3", shortLabel: "+2-3", min: 2, max: 3, targetScore: 500, targetRuns: 3 },
    { id: "4-6", label: "+4 to +6", shortLabel: "+4-6", min: 4, max: 6, targetScore: 1000, targetRuns: 4 },
    { id: "7-9", label: "+7 to +9", shortLabel: "+7-9", min: 7, max: 9, targetScore: 1500, targetRuns: 5 },
    { id: "10-11", label: "+10 to +11", shortLabel: "+10-11", min: 10, max: 11, targetScore: 1800, targetRuns: 6 },
    { id: "12-14", label: "+12 to +14", shortLabel: "+12-14", min: 12, max: 14, targetScore: 2200, targetRuns: 6 },
    { id: "15+", label: "+15 and up", shortLabel: "+15+", min: 15, max: null, targetScore: 2600, targetRuns: 7 },
  ];
  const DEFAULT_SCORE_RANKS = {
    parse: 1,
    kills: 2,
    raiderIo: 3,
    buffs: 4,
  };
  const SCORE_WEIGHT_BY_RANK = {
    1: 0.40,
    2: 0.40,
    3: 0.10,
    4: 0.10,
  };
  const WANTED_DPS_CLASS_BONUS_POINTS = 10;
  const SAME_TIER_BOSS_FALLBACK_MULTIPLIER = 0.5;
  const RAID_DIFFICULTIES = [5, 4, 3, 2];
  const DIFFICULTY_KEYS = {
    5: "mythic",
    4: "heroic",
    3: "normal",
    2: "lfr",
  };
  const DIFFICULTY_SHORT_NAMES = {
    5: "Mythic",
    4: "Heroic",
    3: "Normal",
    2: "LFR",
  };
  const DIFFICULTY_ABBREVIATIONS = {
    5: "M",
    4: "H",
    3: "N",
    2: "LFR",
  };
  const CLASS_OPTIONS = [
    "Death Knight",
    "Demon Hunter",
    "Druid",
    "Evoker",
    "Hunter",
    "Mage",
    "Monk",
    "Paladin",
    "Priest",
    "Rogue",
    "Shaman",
    "Warlock",
    "Warrior",
  ];
  const state = {
    hasWarcraftLogsCredentials: false,
    latestAnalysis: null,
    isFetchingLogs: false,
    isCheckingBridge: false,
    logFetchMessage: null,
    rateLimit: null,
    cacheSummary: null,
    clipboardBridge: null,
    bridgeInitialized: false,
    bridgeLatestHash: "",
    pendingBridgeExport: null,
    declinedApplicantKeys: loadDeclinedApplicantKeys(),
    acceptedApplicants: loadAcceptedApplicants(),
    debugApplicantOverrides: new Map(),
    clientId: loadClientId(),
    sharedDecisionRevision: null,
    sharedDecisionsLoaded: false,
    decisionRecords: {
      accepted: new Map(),
      declined: new Map(),
    },
    isSyncingDecisions: false,
    pendingAnalysisOptions: null,
    wantedDpsSlotAssignments: [],
    wantedDpsSlotPickerIndex: null,
    stickyBestDismissedKey: "",
    lastAddonImportSnapshot: loadAddonImportSnapshot(),
    newApplicantKeys: new Set(),
    lastImportedRosterKeys: new Set(),
    rosterSort: {
      key: "name",
      direction: "asc",
    },
  };

  const elements = {
    tankTarget: document.querySelector("#tankTarget"),
    healerTarget: document.querySelector("#healerTarget"),
    dpsTarget: document.querySelector("#dpsTarget"),
    raidName: document.querySelector("#raidName"),
    bossName: document.querySelector("#bossName"),
    encounterId: document.querySelector("#encounterId"),
    difficulty: document.querySelector("#difficulty"),
    metric: document.querySelector("#metric"),
    addonExport: document.querySelector("#addonExport"),
    importAddonExport: document.querySelector("#importAddonExport"),
    toggleAddonExport: document.querySelector("#toggleAddonExport"),
    addonExportArea: document.querySelector("#addonExportArea"),
    currentRoster: document.querySelector("#currentRoster"),
    applicants: document.querySelector("#applicants"),
    analyze: document.querySelector("#analyze"),
    fetchLogs: document.querySelector("#fetchLogs"),
    fetchRosterLogs: document.querySelector("#fetchRosterLogs"),
    loadDemo: document.querySelector("#loadDemo"),
    loadMythicPlusDebug: document.querySelector("#loadMythicPlusDebug"),
    recommendationsList: document.querySelector("#recommendationsList"),
    roleLens: document.querySelector("#roleLens"),
    stickyBestApplicant: document.querySelector("#stickyBestApplicant"),
    roleMeters: document.querySelector("#roleMeters"),
    raidVisual: document.querySelector("#raidVisual"),
    buffList: document.querySelector("#buffList"),
    scoreTable: document.querySelector("#scoreTable"),
    rosterStats: document.querySelector("#rosterStats"),
    fetchState: document.querySelector("#fetchState"),
    selectionCount: document.querySelector("#selectionCount"),
    compLabel: document.querySelector("#compLabel"),
    coverageLabel: document.querySelector("#coverageLabel"),
    scoreLabel: document.querySelector("#scoreLabel"),
    rosterStatsLabel: document.querySelector("#rosterStatsLabel"),
    serverState: document.querySelector("#serverState"),
    rateState: document.querySelector("#rateState"),
    inviteFilterSearch: document.querySelector("#inviteFilterSearch"),
    inviteFilterRole: document.querySelector("#inviteFilterRole"),
    inviteFilterClass: document.querySelector("#inviteFilterClass"),
    inviteFilterMinIlvl: document.querySelector("#inviteFilterMinIlvl"),
    inviteFilterFilled: document.querySelector("#inviteFilterFilled"),
    wantedDpsClassFilter: document.querySelector("#wantedDpsClassFilter"),
    wantedDpsClassChips: document.querySelector("#wantedDpsClassChips"),
    clearWantedDpsClasses: document.querySelector("#clearWantedDpsClasses"),
    declinedCount: document.querySelector("#declinedCount"),
    clearDeclined: document.querySelector("#clearDeclined"),
    acceptedCount: document.querySelector("#acceptedCount"),
    clearAccepted: document.querySelector("#clearAccepted"),
    resetScoreWeights: document.querySelector("#resetScoreWeights"),
    scoreMode: document.querySelector("#scoreMode"),
    mythicPlusRange: document.querySelector("#mythicPlusRange"),
    scoreParseRank: document.querySelector("#scoreParseRank"),
    scoreKillsRank: document.querySelector("#scoreKillsRank"),
    scoreRaiderIoRank: document.querySelector("#scoreRaiderIoRank"),
    scoreBuffRank: document.querySelector("#scoreBuffRank"),
    toastStack: document.querySelector("#toastStack"),
  };
  let addonImportTimer = null;
  let lastAutoImportedExport = "";
  let bridgePollTimer = null;
  let decisionPollTimer = null;

  init();

  function init() {
    populateRaidSelect();
    populateBossSelect();

    for (const difficulty of data.difficulties) {
      const option = document.createElement("option");
      option.value = String(difficulty.id);
      option.textContent = difficulty.name;
      elements.difficulty.append(option);
    }

    elements.currentRoster.value = "";
    elements.applicants.value = "";
    elements.addonExport.value = "";

    if (elements.analyze) elements.analyze.addEventListener("click", () => runAnalysis({ fetchLogs: false }));
    if (elements.fetchLogs) elements.fetchLogs.addEventListener("click", () => runAnalysis({ fetchLogs: true }));
    if (elements.fetchRosterLogs) elements.fetchRosterLogs.addEventListener("click", () => runAnalysis({ fetchLogs: true }));
    if (elements.loadDemo) elements.loadDemo.addEventListener("click", loadDemo);
    if (elements.loadMythicPlusDebug) elements.loadMythicPlusDebug.addEventListener("click", loadMythicPlusDebug);
    if (elements.importAddonExport) elements.importAddonExport.addEventListener("click", () => importAddonExport({ fetchLogs: true }));
    if (elements.addonExport) {
      elements.addonExport.addEventListener("paste", scheduleAddonExportImport);
      elements.addonExport.addEventListener("input", scheduleAddonExportImport);
    }
    if (elements.toggleAddonExport) {
      elements.toggleAddonExport.addEventListener("click", toggleAddonExportSection);
    }
    if (elements.rosterStats) {
      elements.rosterStats.addEventListener("click", handleRosterSortClick);
    }
    if (elements.recommendationsList) {
      elements.recommendationsList.addEventListener("click", handleRecommendationsClick);
    }
    if (elements.stickyBestApplicant) {
      elements.stickyBestApplicant.addEventListener("click", handleRecommendationsClick);
    }
    if (elements.roleLens) {
      elements.roleLens.addEventListener("click", handleRoleLensClick);
    }
    if (elements.raidVisual) {
      elements.raidVisual.addEventListener("click", handleRaidVisualClick);
    }
    if (elements.clearDeclined) {
      elements.clearDeclined.addEventListener("click", clearDeclinedApplicants);
    }
    if (elements.clearAccepted) {
      elements.clearAccepted.addEventListener("click", clearAcceptedApplicants);
    }
    if (elements.resetScoreWeights) {
      elements.resetScoreWeights.addEventListener("click", resetScoreWeights);
    }
    if (elements.wantedDpsClassChips) {
      elements.wantedDpsClassChips.addEventListener("click", handleWantedDpsClassClick);
    }
    if (elements.clearWantedDpsClasses) {
      elements.clearWantedDpsClasses.addEventListener("click", clearWantedDpsClasses);
    }
    if (elements.scoreMode) {
      const handleScoreModeChange = () => {
        syncModeUi();
        runAnalysis({ fetchLogs: state.hasWarcraftLogsCredentials });
      };
      elements.scoreMode.addEventListener("input", handleScoreModeChange);
      elements.scoreMode.addEventListener("change", handleScoreModeChange);
    }

    populateInviteClassFilter();
    populateWantedDpsClassFilter();

    for (const input of [
      elements.inviteFilterSearch,
      elements.inviteFilterRole,
      elements.inviteFilterClass,
      elements.inviteFilterMinIlvl,
      elements.inviteFilterFilled,
    ].filter(Boolean)) {
      input.addEventListener("input", () => {
        if (state.latestAnalysis) renderRecommendations(state.latestAnalysis);
      });
      input.addEventListener("change", () => {
        if (state.latestAnalysis) renderRecommendations(state.latestAnalysis);
      });
    }

    for (const input of [
      elements.tankTarget,
      elements.healerTarget,
      elements.dpsTarget,
      elements.currentRoster,
      elements.applicants,
      ...scoreWeightInputs(),
    ].filter(Boolean)) {
      input.addEventListener("input", () => runAnalysis({ fetchLogs: false }));
      input.addEventListener("change", () => runAnalysis({ fetchLogs: false }));
    }

    for (const input of [
      elements.bossName,
      elements.difficulty,
      elements.metric,
      elements.mythicPlusRange,
    ].filter(Boolean)) {
      input.addEventListener("input", () => runAnalysis({ fetchLogs: state.hasWarcraftLogsCredentials }));
      input.addEventListener("change", () => runAnalysis({ fetchLogs: state.hasWarcraftLogsCredentials }));
    }

    updateApplicantDecisionUi();
    syncModeUi();
    syncWantedDpsClassFilterUi();

    checkServer().then((health) => {
      if (health && health.hasWarcraftLogsCredentials) refreshRateLimit();
    });
    startBridgePolling();
    startDecisionPolling();
    window.addEventListener("scroll", updateStickyBestVisibility, { passive: true });
    window.addEventListener("resize", updateStickyBestVisibility, { passive: true });
    document.addEventListener("click", handleDocumentClick);
    syncSharedDecisions({ rerun: false }).finally(() => {
      runAnalysis({ fetchLogs: false });
    });
  }

  function apiFetch(path, options) {
    return fetch(`${API_BASE}${path}`, options);
  }

  function scoreWeightInputs() {
    return [
      elements.scoreParseRank,
      elements.scoreKillsRank,
      elements.scoreRaiderIoRank,
      elements.scoreBuffRank,
    ];
  }

  function difficultyKey(difficulty) {
    return DIFFICULTY_KEYS[Number(difficulty)] || "";
  }

  function difficultyShortName(difficulty) {
    return DIFFICULTY_SHORT_NAMES[Number(difficulty)] || "Parse";
  }

  function difficultyAbbreviation(difficulty) {
    return DIFFICULTY_ABBREVIATIONS[Number(difficulty)] || difficultyShortName(difficulty);
  }

  function relevantDifficultyColumns(target) {
    const selected = Number(target && target.difficulty) || null;
    const fallback = Number(target && target.fallbackDifficulty) || null;
    const difficulties = [];

    for (const difficulty of RAID_DIFFICULTIES) {
      if ((selected && difficulty >= selected) || difficulty === fallback) {
        difficulties.push(difficulty);
      }
    }

    return difficulties.length ? difficulties : RAID_DIFFICULTIES.slice(0, 2);
  }

  function relevantScoringDifficultyColumns(target) {
    const difficulties = relevantDifficultyColumns(target)
      .filter((difficulty) => Number(difficulty) >= MIN_SCORING_RAID_DIFFICULTY);
    return difficulties.length ? difficulties : [5, 4];
  }

  function populateRaidSelect() {
    if (!elements.raidName) return;

    const raids = data.raids && data.raids.length
      ? data.raids
      : [{ id: "all", name: "All raids", encounterIds: (data.encounters || []).map((encounter) => encounter.id).filter(Boolean) }];

    elements.raidName.innerHTML = "";
    for (const raid of raids) {
      const option = document.createElement("option");
      option.value = raid.id;
      option.textContent = raid.name;
      elements.raidName.append(option);
    }

    elements.raidName.addEventListener("change", () => {
      populateBossSelect({ preserveSelection: false });
      runAnalysis({ fetchLogs: state.hasWarcraftLogsCredentials });
    });
  }

  if (elements.bossName) {
    elements.bossName.addEventListener("change", () => {
      const option = elements.bossName.selectedOptions && elements.bossName.selectedOptions[0];
      if (elements.encounterId) elements.encounterId.value = option ? option.dataset.encounterId || "" : "";
    });
  }

  function populateBossSelect(options = {}) {
    if (!elements.bossName) return;

    const previousEncounterId = elements.encounterId && elements.encounterId.value;
    const previousValue = elements.bossName.value;
    const encounters = encountersForSelectedRaid().length
      ? encountersForSelectedRaid()
      : [{ id: "", name: "Selected boss", default: true }];

    elements.bossName.innerHTML = "";

    const raidAverageOption = document.createElement("option");
    raidAverageOption.value = RAID_AVERAGE_BOSS_VALUE;
    raidAverageOption.textContent = RAID_AVERAGE_BOSS_LABEL;
    raidAverageOption.dataset.raidAverage = "true";
    elements.bossName.append(raidAverageOption);

    for (const encounter of encounters) {
      const option = document.createElement("option");
      option.value = encounter.name;
      option.textContent = encounter.name;
      if (encounter.id) option.dataset.encounterId = String(encounter.id);
      if (encounter.default) option.selected = true;
      elements.bossName.append(option);
    }

    if (options.preserveSelection !== false) {
      const preserved = Array.from(elements.bossName.options || [])
        .find((option) => (previousEncounterId && option.dataset.encounterId === previousEncounterId) || option.value === previousValue);
      if (preserved) preserved.selected = true;
    }

    const selectedOption = elements.bossName.selectedOptions && elements.bossName.selectedOptions[0];
    if (elements.encounterId && selectedOption) {
      elements.encounterId.value = selectedOption.dataset.encounterId || "";
    }
  }

  function selectedRaid() {
    const raids = data.raids || [];
    if (!raids.length) return null;
    const id = String(elements.raidName && elements.raidName.value || "");
    return raids.find((raid) => raid.id === id) || raids[0] || null;
  }

  function encountersForSelectedRaid() {
    const raid = selectedRaid();
    const encounters = data.encounters || [];
    if (!raid || !Array.isArray(raid.encounterIds) || !raid.encounterIds.length) return encounters;

    const allowed = new Set(raid.encounterIds.map(String));
    return encounters.filter((encounter) => allowed.has(String(encounter.id)));
  }

  function setRaid(raid) {
    if (!raid || !elements.raidName || elements.raidName.value === raid.id) return false;
    elements.raidName.value = raid.id;
    populateBossSelect({ preserveSelection: false });
    return true;
  }

  function setBossToRaidAverage() {
    if (!elements.bossName) return false;
    const changed = elements.bossName.value !== RAID_AVERAGE_BOSS_VALUE;
    elements.bossName.value = RAID_AVERAGE_BOSS_VALUE;
    if (elements.encounterId) elements.encounterId.value = "";
    return changed;
  }

  function isMplusModeActive() {
    return Boolean(elements.scoreMode && elements.scoreMode.value === SCORE_MODE_MPLUS);
  }

  function setModeFieldVisibility(selector, hidden) {
    for (const field of document.querySelectorAll(selector)) {
      field.hidden = hidden;
      for (const input of field.querySelectorAll("input, select, button, textarea")) {
        input.disabled = hidden;
      }
    }
  }

  function syncModeUi() {
    const isMplus = isMplusModeActive();
    document.body.classList.toggle("is-mplus-mode", isMplus);
    setModeFieldVisibility("[data-raid-only]", isMplus);
    setModeFieldVisibility("[data-mplus-only]", !isMplus);
  }

  function raidZoneAnchorEncounterId() {
    const encounter = encountersForSelectedRaid().find((item) => item && item.id);
    return encounter ? Number(encounter.id) || null : null;
  }

  async function checkServer() {
    try {
      const response = await apiFetch("/api/health");
      const health = await response.json();
      state.hasWarcraftLogsCredentials = Boolean(health.hasWarcraftLogsCredentials);
      state.clipboardBridge = health.clipboardBridge || null;
      const bridgeLabel = state.clipboardBridge && state.clipboardBridge.enabled ? " + clipboard bridge" : "";
      setServerState(
        `${state.hasWarcraftLogsCredentials ? "Warcraft Logs connected" : "Manual parse mode"}${bridgeLabel}`,
        health.ok
      );
      updateRateState(health.rateLimit, health.cache);
      return health;
    } catch (error) {
      setServerState("Local server unavailable", false);
      setRateState("API usage unavailable", "warn");
      return null;
    }
  }

  function setServerState(label, ok) {
    elements.serverState.classList.toggle("is-ok", ok);
    elements.serverState.classList.toggle("is-warn", !state.hasWarcraftLogsCredentials);
    elements.serverState.querySelector("span:last-child").textContent = label;
  }

  async function refreshRateLimit() {
    if (!state.hasWarcraftLogsCredentials) return;

    setRateState("Checking API usage", "checking");
    try {
      const response = await apiFetch("/api/warcraftlogs/rate-limit");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Rate limit request failed.");
      updateRateState(payload.rateLimit, payload.cache);
    } catch (error) {
      setRateState("API usage unavailable", "warn");
    }
  }

  function updateRateState(rateLimit, cache) {
    if (cache) state.cacheSummary = cache;
    if (!rateLimit) {
      const cacheLabel = formatCacheSummary(state.cacheSummary);
      setRateState(cacheLabel ? `Usage pending - ${cacheLabel}` : "API usage unknown", "warn");
      return;
    }

    state.rateLimit = rateLimit;
    const spent = numberOrZero(rateLimit.pointsSpentThisHour);
    const limit = numberOrZero(rateLimit.limitPerHour);
    const percent = limit ? Math.round((spent / limit) * 100) : 0;
    const reset = formatDuration(rateLimit.pointsResetIn);
    const cacheLabel = formatCacheSummary(state.cacheSummary);
    const usage = limit ? `${spent}/${limit} pts (${percent}%)` : `${spent} pts`;
    const suffix = [reset ? `reset ${reset}` : "", cacheLabel].filter(Boolean).join(" - ");
    const status = percent >= 85 ? "hot" : percent >= 65 ? "warn" : "ok";

    setRateState(suffix ? `${usage} - ${suffix}` : usage, status);
  }

  function setRateState(label, status) {
    if (!elements.rateState) return;

    elements.rateState.classList.toggle("is-ok", status === "ok");
    elements.rateState.classList.toggle("is-warn", status === "warn");
    elements.rateState.classList.toggle("is-hot", status === "hot");
    elements.rateState.classList.toggle("is-checking", status === "checking");
    elements.rateState.querySelector("span:last-child").textContent = label;
  }

  function formatCacheSummary(cache) {
    if (!cache) return "";
    const hits = numberOrZero(cache.hits);
    const entries = numberOrZero(cache.entries);
    if (!hits && !entries) return "";
    return `${hits} cached${entries ? `, ${entries} stored` : ""}`;
  }

  function formatDuration(seconds) {
    const totalSeconds = Number(seconds);
    if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "";
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = Math.round(totalSeconds % 60);
    if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${remainingSeconds}s`;
  }

  function loadDeclinedApplicantKeys() {
    try {
      const raw = window.sessionStorage && window.sessionStorage.getItem(DECLINED_STORAGE_KEY);
      const keys = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(keys) ? keys.map(normalizeApplicantKey).filter(Boolean) : []);
    } catch (error) {
      return new Set();
    }
  }

  function saveDeclinedApplicantKeys() {
    try {
      if (window.sessionStorage) {
        window.sessionStorage.setItem(DECLINED_STORAGE_KEY, JSON.stringify([...state.declinedApplicantKeys]));
      }
    } catch (error) {
      // Session decline state is best-effort; in-memory state still works.
    }
  }

  function loadAcceptedApplicants() {
    try {
      const raw = window.sessionStorage && window.sessionStorage.getItem(ACCEPTED_STORAGE_KEY);
      const entries = raw ? JSON.parse(raw) : [];
      const accepted = new Map();
      if (!Array.isArray(entries)) return accepted;

      for (const entry of entries) {
        const key = normalizeApplicantKey(entry && entry.key);
        const line = String(entry && entry.line || "").trim();
        if (key && line) accepted.set(key, line);
      }

      return accepted;
    } catch (error) {
      return new Map();
    }
  }

  function saveAcceptedApplicants() {
    try {
      if (window.sessionStorage) {
        const entries = [...state.acceptedApplicants].map(([key, line]) => ({ key, line }));
        window.sessionStorage.setItem(ACCEPTED_STORAGE_KEY, JSON.stringify(entries));
      }
    } catch (error) {
      // Session accept state is best-effort; in-memory state still drives the planner.
    }
  }

  function loadClientId() {
    try {
      const stored = window.localStorage && window.localStorage.getItem(CLIENT_ID_STORAGE_KEY);
      if (stored) return stored;

      const generated = `client-${randomId()}`;
      if (window.localStorage) window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, generated);
      return generated;
    } catch (error) {
      return `client-${randomId()}`;
    }
  }

  function randomId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function startDecisionPolling() {
    if (decisionPollTimer) return;
    decisionPollTimer = window.setInterval(() => {
      syncSharedDecisions({ rerun: true, quiet: true, notifyRemote: true });
    }, DECISION_POLL_INTERVAL_MS);
  }

  async function syncSharedDecisions(options = {}) {
    if (state.isSyncingDecisions) return false;
    state.isSyncingDecisions = true;
    try {
      const response = await apiFetch("/api/decisions", { cache: "no-store" });
      const snapshot = await response.json();
      if (!response.ok) throw new Error(snapshot.error || "Decision sync failed.");
      return applySharedDecisionSnapshot(snapshot, options);
    } catch (error) {
      if (!options.quiet && state.sharedDecisionsLoaded) {
        setScoreLabel("Shared decisions unavailable; using this browser's state");
      }
      return false;
    } finally {
      state.isSyncingDecisions = false;
    }
  }

  async function postSharedDecision(action, payload) {
    const response = await apiFetch("/api/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, clientId: state.clientId, ...payload }),
    });
    const snapshot = await response.json();
    if (!response.ok) throw new Error(snapshot.error || "Decision sync failed.");
    applySharedDecisionSnapshot(snapshot, { rerun: false });
    return snapshot;
  }

  async function clearSharedDecisionsOnServer(scope, keys = null) {
    const body = { scope };
    if (Array.isArray(keys)) body.keys = keys;
    const response = await apiFetch("/api/decisions/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const snapshot = await response.json();
    if (!response.ok) throw new Error(snapshot.error || "Decision clear failed.");
    applySharedDecisionSnapshot(snapshot, { rerun: false });
    return snapshot;
  }

  function applySharedDecisionSnapshot(snapshot, options = {}) {
    const normalized = normalizeSharedDecisionSnapshot(snapshot);
    if (!normalized) return false;
    if (state.sharedDecisionsLoaded && normalized.revision === state.sharedDecisionRevision) return false;

    const previousAccepted = state.sharedDecisionsLoaded ? new Map(state.acceptedApplicants) : new Map();
    const previousDecisionRecords = state.decisionRecords || {
      accepted: new Map(),
      declined: new Map(),
    };
    const shouldNotifyRemote = Boolean(options.notifyRemote && state.sharedDecisionsLoaded);
    state.sharedDecisionRevision = normalized.revision;
    state.sharedDecisionsLoaded = true;
    state.acceptedApplicants = normalized.accepted;
    state.declinedApplicantKeys = normalized.declined;
    state.decisionRecords = {
      accepted: normalized.acceptedRecords,
      declined: normalized.declinedRecords,
    };
    saveAcceptedApplicants();
    saveDeclinedApplicantKeys();
    reconcileAcceptedDecisionTextareas(previousAccepted);
    updateApplicantDecisionUi();
    if (shouldNotifyRemote) {
      showRemoteDecisionToasts(previousDecisionRecords, state.decisionRecords);
    }

    if (options.rerun && !state.isFetchingLogs) {
      runAnalysis({ fetchLogs: false });
    }
    return true;
  }

  function normalizeSharedDecisionSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return null;
    const accepted = new Map();
    const declined = new Set();
    const acceptedRecords = new Map();
    const declinedRecords = new Map();

    for (const entry of Array.isArray(snapshot.accepted) ? snapshot.accepted : []) {
      const key = normalizeApplicantKey(entry && entry.key);
      const line = String(entry && entry.line || "").trim();
      if (key && line) {
        accepted.set(key, line);
        acceptedRecords.set(key, normalizeSharedDecisionRecord(entry, key, line));
      }
    }

    for (const entry of Array.isArray(snapshot.declined) ? snapshot.declined : []) {
      const key = normalizeApplicantKey(entry && entry.key);
      if (key) {
        declined.add(key);
        declinedRecords.set(key, normalizeSharedDecisionRecord(entry, key, ""));
      }
    }

    return {
      revision: Number(snapshot.revision) || 0,
      accepted,
      declined,
      acceptedRecords,
      declinedRecords,
    };
  }

  function normalizeSharedDecisionRecord(entry, key, line) {
    return {
      key,
      name: String(entry && entry.name || "").trim(),
      line,
      updatedBy: String(entry && entry.updatedBy || "").trim(),
      updatedAt: String(entry && entry.updatedAt || "").trim(),
    };
  }

  function showRemoteDecisionToasts(previousRecords, currentRecords) {
    for (const record of currentRecords.accepted.values()) {
      if (!isRemoteDecisionRecord(record)) continue;
      const previous = previousRecords.accepted && previousRecords.accepted.get(record.key);
      if (previous && previous.updatedAt === record.updatedAt) continue;
      showDecisionToast("accepted", record);
    }

    for (const record of currentRecords.declined.values()) {
      if (!isRemoteDecisionRecord(record)) continue;
      const previous = previousRecords.declined && previousRecords.declined.get(record.key);
      if (previous && previous.updatedAt === record.updatedAt) continue;
      showDecisionToast("declined", record);
    }
  }

  function isRemoteDecisionRecord(record) {
    return record && record.updatedBy && record.updatedBy !== state.clientId;
  }

  function showDecisionToast(action, record) {
    const player = record.name || decisionNameFromLine(record.line) || record.key || "Applicant";
    const verb = action === "accepted" ? "accepted" : "declined";
    showToast(
      `Applicant ${verb}`,
      `${formatTimestamp(new Date())} - ${player} was ${verb} by another browser`
    );
  }

  function decisionNameFromLine(line) {
    const identity = String(line || "").split(",")[0] || "";
    return identity.split("-")[0] || "";
  }

  function reconcileAcceptedDecisionTextareas(previousAccepted) {
    const acceptedEntries = [...state.acceptedApplicants];
    const acceptedKeys = new Set(acceptedEntries.map(([key]) => key));
    const removedLocalAcceptedKeys = new Set(
      [...previousAccepted]
        .filter(([key]) => !acceptedKeys.has(key) && !state.lastImportedRosterKeys.has(key))
        .map(([key]) => key)
    );

    if (removedLocalAcceptedKeys.size) {
      elements.currentRoster.value = removeLinesByApplicantKeys(textareaLines(elements.currentRoster), removedLocalAcceptedKeys).join("\n");
    }

    if (acceptedEntries.length) {
      elements.currentRoster.value = mergeAcceptedRosterLines(textareaLines(elements.currentRoster), acceptedEntries).join("\n");
      elements.applicants.value = removeLinesByApplicantKeys(textareaLines(elements.applicants), acceptedKeys).join("\n");
    }

    const restoredApplicantLines = [...previousAccepted]
      .filter(([key]) => removedLocalAcceptedKeys.has(key))
      .map(([, line]) => line)
      .filter(Boolean);
    if (restoredApplicantLines.length) {
      const existingApplicantKeys = new Set(
        parsePeople(elements.applicants.value, "applicant").map((applicant) => applicantKey(applicant))
      );
      const missingLines = restoredApplicantLines.filter((line) => {
        const key = applicantKeyFromLine(line);
        return key && !existingApplicantKeys.has(key);
      });
      if (missingLines.length) {
        elements.applicants.value = [...textareaLines(elements.applicants), ...missingLines].join("\n");
      }
    }
  }

  function loadAddonImportSnapshot() {
    try {
      const raw = window.sessionStorage && window.sessionStorage.getItem(ADDON_IMPORT_STORAGE_KEY);
      return normalizeAddonImportSnapshot(raw ? JSON.parse(raw) : null);
    } catch (error) {
      return null;
    }
  }

  function saveAddonImportSnapshot(snapshot) {
    try {
      if (window.sessionStorage) {
        window.sessionStorage.setItem(ADDON_IMPORT_STORAGE_KEY, JSON.stringify(snapshot));
      }
    } catch (error) {
      // The New badge can fall back to in-memory comparison when storage is unavailable.
    }
  }

  function normalizeAddonImportSnapshot(snapshot) {
    const importedApplicants = snapshot && snapshot.applicants && typeof snapshot.applicants === "object"
      ? snapshot.applicants
      : null;
    if (!importedApplicants) return null;

    const applicants = {};
    for (const [key, signature] of Object.entries(importedApplicants)) {
      const normalizedKey = normalizeApplicantKey(key);
      const normalizedSignature = String(signature || "").trim();
      if (normalizedKey && normalizedSignature) applicants[normalizedKey] = normalizedSignature;
    }

    return { applicants };
  }

  function buildAddonImportSnapshot(parsed) {
    const applicants = {};
    for (const line of parsed.applicants) {
      const applicant = parsePersonLine(line, Object.keys(applicants).length, "applicant");
      const key = applicantKey(applicant);
      if (key) applicants[key] = applicantImportSignature(line);
    }

    return { applicants };
  }

  function trackAddonImportChanges(snapshot) {
    const previousApplicants = state.lastAddonImportSnapshot && state.lastAddonImportSnapshot.applicants
      ? state.lastAddonImportSnapshot.applicants
      : {};
    const newApplicantKeys = new Set();

    for (const [key, signature] of Object.entries(snapshot.applicants)) {
      if (previousApplicants[key] !== signature) newApplicantKeys.add(key);
    }

    state.newApplicantKeys = newApplicantKeys;
    state.lastAddonImportSnapshot = snapshot;
    saveAddonImportSnapshot(snapshot);
  }

  function applicantImportSignature(line) {
    return String(line || "")
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .join(",");
  }

  function applicantKey(person) {
    if (!person) return "";
    return normalizeApplicantKey(`${person.name}|${person.realm}|${person.region || "US"}`);
  }

  function normalizeApplicantKey(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/-us$/i, "|us");
  }

  function textareaLines(textarea) {
    return textareaValueLines(textarea && textarea.value);
  }

  function textareaValueLines(value) {
    return String(value || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function applicantKeyFromLine(line, source = "applicant") {
    return applicantKey(parsePersonLine(line, 0, source));
  }

  function mergeAcceptedRosterLines(rosterLines, acceptedEntries = [...state.acceptedApplicants]) {
    const merged = [...rosterLines];
    const existingKeys = new Set(merged.map((line) => applicantKeyFromLine(line, "roster")).filter(Boolean));

    for (const [key, line] of acceptedEntries) {
      const normalizedKey = normalizeApplicantKey(key) || applicantKeyFromLine(line, "roster");
      if (!normalizedKey || existingKeys.has(normalizedKey) || !String(line || "").trim()) continue;
      merged.push(String(line).trim());
      existingKeys.add(normalizedKey);
    }

    return merged;
  }

  function removeLinesByApplicantKeys(lines, keys) {
    if (!keys || !keys.size) return lines;
    return lines.filter((line) => !keys.has(applicantKeyFromLine(line)));
  }

  function filterApplicantDecisionLines(lines, excludedKeys = new Set()) {
    return lines.filter((line) => {
      const key = applicantKeyFromLine(line);
      return key && !excludedKeys.has(key) && !state.declinedApplicantKeys.has(key) && !state.acceptedApplicants.has(key);
    });
  }

  function filterApplicantsAlreadyInRoster(applicants, roster) {
    const rosterKeys = new Set(roster.map((member) => applicantKey(member)).filter(Boolean));
    return applicants.filter((applicant) => !rosterKeys.has(applicantKey(applicant)));
  }

  function uniquePeopleByApplicantKey(people) {
    const seen = new Set();
    const unique = [];

    for (const person of people) {
      const key = applicantKey(person);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(person);
    }

    return unique;
  }

  function serializePersonLine(person) {
    if (!person) return "";

    const identity = `${person.name}-${person.realm}-${person.region || "US"}`;
    const fields = [
      identity,
      person.role || "",
      person.className || "",
      person.specName || "",
      formatExportNumber(person.primaryParse),
      formatExportNumber(person.fallbackParse),
      formatExportNumber(person.primaryKills),
      formatExportNumber(person.fallbackKills),
      formatExportNumber(firstPositiveNumber(person.mythicBestPerfAvg, bestPerfForDifficulty(person, state.latestAnalysis && state.latestAnalysis.target || {}, 5))),
      formatExportNumber(firstPositiveNumber(person.heroicBestPerfAvg, bestPerfForDifficulty(person, state.latestAnalysis && state.latestAnalysis.target || {}, 4))),
      formatExportNumber(person.itemLevel),
    ];
    const note = normalizeApplicationNote(person.applicationNote);
    if (note) fields.push(note);

    return fields.map(sanitizeExportField).join(",");
  }

  function clearAcceptedApplicantsConfirmedInRoster(rosterKeys) {
    let changed = false;
    const confirmedKeys = [];
    for (const key of state.acceptedApplicants.keys()) {
      if (!rosterKeys.has(key)) continue;
      state.acceptedApplicants.delete(key);
      confirmedKeys.push(key);
      changed = true;
    }

    if (changed) {
      saveAcceptedApplicants();
      updateApplicantDecisionUi();
      clearSharedDecisionsOnServer("accepted", confirmedKeys).catch(() => {});
    }
  }

  function formatExportNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    return Number.isInteger(number) ? String(number) : String(Math.round(number * 10) / 10);
  }

  function sanitizeExportField(value) {
    return String(value || "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/,/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function filterApplicantDecisionApplicants(applicants) {
    return applicants.filter((applicant) => {
      const key = applicantKey(applicant);
      return !state.declinedApplicantKeys.has(key) && !state.acceptedApplicants.has(key);
    });
  }

  function handleRoleLensClick(event) {
    const button = event.target.closest("[data-role-lens]");
    if (!button || !elements.roleLens) return;

    setActiveRoleLens(button.dataset.roleLens || "all");
    runAnalysis({ fetchLogs: false });
  }

  function setActiveRoleLens(value) {
    const lens = normalizeRoleLens(value);
    if (elements.roleLens) {
      for (const button of elements.roleLens.querySelectorAll("[data-role-lens]")) {
        button.classList.toggle("is-active", normalizeRoleLens(button.dataset.roleLens) === lens);
      }
    }

    if (elements.inviteFilterRole) {
      elements.inviteFilterRole.value = ["Tank", "Healer", "DPS"].includes(lens) ? lens : "";
    }

    syncWantedDpsClassFilterUi();
  }

  function activeRoleLens() {
    const active = elements.roleLens && elements.roleLens.querySelector("[data-role-lens].is-active");
    return normalizeRoleLens(active && active.dataset.roleLens);
  }

  function normalizeRoleLens(value) {
    const text = String(value || "all").trim();
    if (text === "needed") return "needed";
    if (text === "Tank" || text === "Healer" || text === "DPS") return text;
    return "all";
  }

  function handleWantedDpsClassClick(event) {
    const button = event.target.closest("[data-wanted-dps-class]");
    if (!button) return;

    button.classList.toggle("is-active");
    button.setAttribute("aria-pressed", button.classList.contains("is-active") ? "true" : "false");
    state.stickyBestDismissedKey = "";
    syncWantedDpsClassChipsUi();
    if (state.latestAnalysis) renderRecommendations(state.latestAnalysis);
  }

  function clearWantedDpsClasses() {
    if (!elements.wantedDpsClassChips) return;

    let changed = false;
    for (const button of elements.wantedDpsClassChips.querySelectorAll("[data-wanted-dps-class].is-active")) {
      button.classList.remove("is-active");
      button.setAttribute("aria-pressed", "false");
      changed = true;
    }

    syncWantedDpsClassChipsUi();

    if (changed && state.latestAnalysis) {
      renderRecommendations(state.latestAnalysis);
    }
  }

  function selectedWantedDpsClasses() {
    const selected = new Set();
    if (elements.wantedDpsClassChips) {
      for (const button of elements.wantedDpsClassChips.querySelectorAll("[data-wanted-dps-class].is-active")) {
        const className = normalizeWantedDpsClass(button.dataset.wantedDpsClass);
        if (className) selected.add(className);
      }
    }

    return selected;
  }

  function wantedDpsClassFilterEnabled(lens) {
    return lens === "needed" || lens === "DPS";
  }

  function syncWantedDpsClassFilterUi() {
    if (!elements.wantedDpsClassFilter) return;
    elements.wantedDpsClassFilter.hidden = !wantedDpsClassFilterEnabled(activeRoleLens());
    syncWantedDpsClassChipsUi();
  }

  function handleRaidVisualClick(event) {
    const classButton = event.target.closest("[data-set-wanted-dps-slot]");
    if (classButton) {
      event.preventDefault();
      const slotIndex = Number.parseInt(classButton.dataset.setWantedDpsSlot || "", 10);
      if (Number.isFinite(slotIndex)) {
        setWantedDpsSlotAssignment(slotIndex, classButton.dataset.wantedDpsClass || "");
      }
      return;
    }

    const clearButton = event.target.closest("[data-clear-wanted-dps-slot]");
    if (clearButton) {
      event.preventDefault();
      const slotIndex = Number.parseInt(clearButton.dataset.clearWantedDpsSlot || "", 10);
      if (Number.isFinite(slotIndex)) {
        setWantedDpsSlotAssignment(slotIndex, "");
      }
      return;
    }

    const slotButton = event.target.closest("[data-open-dps-slot-index]");
    if (!slotButton) return;

    event.preventDefault();
    const slotIndex = Number.parseInt(slotButton.dataset.openDpsSlotIndex || "", 10);
    if (!Number.isFinite(slotIndex)) return;

    state.wantedDpsSlotPickerIndex = state.wantedDpsSlotPickerIndex === slotIndex ? null : slotIndex;
    if (state.latestAnalysis) renderComposition(state.latestAnalysis);
  }

  function handleDocumentClick(event) {
    if (state.wantedDpsSlotPickerIndex === null) return;
    if (event.target.closest("[data-open-dps-slot-index]")) return;
    if (event.target.closest(".raid-slot-picker")) return;

    state.wantedDpsSlotPickerIndex = null;
    if (state.latestAnalysis) renderComposition(state.latestAnalysis);
  }

  function setWantedDpsSlotAssignment(slotIndex, className) {
    if (!Number.isInteger(slotIndex) || slotIndex < 0) return;

    const assignments = [...state.wantedDpsSlotAssignments];
    while (assignments.length <= slotIndex) assignments.push("");
    assignments[slotIndex] = normalizeWantedDpsClass(className);
    state.wantedDpsSlotAssignments = assignments;
    state.wantedDpsSlotPickerIndex = null;
    state.stickyBestDismissedKey = "";
    syncWantedDpsClassChipsUi();

    if (state.latestAnalysis) {
      renderRecommendations(state.latestAnalysis);
      renderComposition(state.latestAnalysis);
    }
  }

  function normalizeWantedDpsClass(value) {
    const className = String(value || "").trim();
    return CLASS_OPTIONS.includes(className) ? className : "";
  }

  function currentOpenDpsSlotCount() {
    if (!state.latestAnalysis) {
      return state.wantedDpsSlotAssignments.length;
    }

    return currentOpenDpsSlotCountFor(
      state.latestAnalysis.target && state.latestAnalysis.target.roles,
      state.latestAnalysis.currentRoleCounts || countRoles(state.latestAnalysis.roster || [])
    );
  }

  function currentOpenDpsSlotCountFor(targetRoles, counts) {
    const target = targetRoles ? Number(targetRoles.DPS) || 0 : 0;
    return Math.max(0, target - ((counts && counts.DPS) || 0));
  }

  function wantedDpsSlotAssignments(limit = currentOpenDpsSlotCount()) {
    return state.wantedDpsSlotAssignments
      .slice(0, Math.max(0, limit))
      .map(normalizeWantedDpsClass)
      .filter(Boolean);
  }

  function wantedDpsSlotClassCounts(limit = currentOpenDpsSlotCount()) {
    const counts = new Map();
    for (const className of wantedDpsSlotAssignments(limit)) {
      counts.set(className, (counts.get(className) || 0) + 1);
    }
    return counts;
  }

  function syncWantedDpsClassChipsUi() {
    if (!elements.wantedDpsClassChips) return;

    const counts = wantedDpsSlotClassCounts();
    for (const button of elements.wantedDpsClassChips.querySelectorAll("[data-wanted-dps-class]")) {
      const className = normalizeWantedDpsClass(button.dataset.wantedDpsClass);
      const slotCount = counts.get(className) || 0;
      button.classList.toggle("is-slotted", slotCount > 0);
      button.dataset.slotCount = slotCount ? String(slotCount) : "";
      button.replaceChildren(document.createTextNode(className || "Unknown"));
      if (slotCount > 0) {
        const badge = document.createElement("span");
        badge.className = "class-chip-count";
        badge.textContent = String(slotCount);
        button.append(badge);
      }
    }
  }

  function handleRecommendationsClick(event) {
    const stickyDismissButton = event.target.closest("[data-sticky-best-dismiss]");
    if (stickyDismissButton) {
      event.preventDefault();
      state.stickyBestDismissedKey = elements.stickyBestApplicant && elements.stickyBestApplicant.dataset.applicantKey || "";
      updateStickyBestVisibility();
      return;
    }

    const acceptButton = event.target.closest("[data-accept-key]");
    if (acceptButton) {
      event.preventDefault();
      acceptApplicant(acceptButton.dataset.acceptKey, acceptButton.dataset.acceptName || "Applicant");
      return;
    }

    const button = event.target.closest("[data-decline-key]");
    if (!button) return;

    event.preventDefault();
    declineApplicant(button.dataset.declineKey, button.dataset.declineName || "Applicant");
  }

  async function acceptApplicant(key, name) {
    const normalized = normalizeApplicantKey(key);
    if (!normalized || !state.latestAnalysis) return;

    const score = (state.latestAnalysis.allScores || []).find((item) => applicantKey(item.applicant) === normalized);
    const applicant = score && score.applicant;
    if (!applicant) return;

    const rosterMember = {
      ...applicant,
      id: `accepted-${normalized}`,
      source: "roster",
      line: serializePersonLine(applicant),
    };

    state.acceptedApplicants.set(normalized, rosterMember.line);
    state.declinedApplicantKeys.delete(normalized);
    saveAcceptedApplicants();
    saveDeclinedApplicantKeys();
    addAcceptedApplicantToTextareas(rosterMember);
    updateApplicantDecisionUi();
    setScoreLabel(`${name} accepted into the shared roster`);
    recomputeLatestAnalysisWithRosterMember(rosterMember);
    try {
      await postSharedDecision("accept", {
        key: normalized,
        name,
        line: rosterMember.line,
      });
    } catch (error) {
      setScoreLabel(`${name} accepted here; shared sync failed`);
    }
  }

  function addAcceptedApplicantToTextareas(applicant) {
    const line = serializePersonLine(applicant);
    const key = applicantKey(applicant);
    if (!line || !key) return;

    const rosterLines = mergeAcceptedRosterLines(textareaLines(elements.currentRoster), [[key, line]]);
    elements.currentRoster.value = rosterLines.join("\n");
    elements.applicants.value = removeLinesByApplicantKeys(textareaLines(elements.applicants), new Set([key])).join("\n");
  }

  function recomputeLatestAnalysisWithRosterMember(applicant) {
    if (!state.latestAnalysis) {
      runAnalysis({ fetchLogs: false });
      return;
    }

    const key = applicantKey(applicant);
    const roster = uniquePeopleByApplicantKey([...state.latestAnalysis.roster, applicant]);
    const applicants = state.latestAnalysis.applicants.filter((candidate) => applicantKey(candidate) !== key);
    const analysis = recommendApplicants({
      target: state.latestAnalysis.target,
      roster,
      applicants: filterApplicantDecisionApplicants(applicants),
    });
    state.latestAnalysis = analysis;
    render(analysis);
  }

  async function declineApplicant(key, name) {
    const normalized = normalizeApplicantKey(key);
    if (!normalized) return;

    state.declinedApplicantKeys.add(normalized);
    state.acceptedApplicants.delete(normalized);
    saveDeclinedApplicantKeys();
    saveAcceptedApplicants();
    updateApplicantDecisionUi();
    setScoreLabel(`${name} declined for everyone`);

    if (state.latestAnalysis) {
      const analysis = recommendApplicants({
        target: state.latestAnalysis.target,
        roster: state.latestAnalysis.roster,
        applicants: filterApplicantDecisionApplicants(state.latestAnalysis.applicants),
      });
      state.latestAnalysis = analysis;
      render(analysis);
    }

    try {
      await postSharedDecision("decline", {
        key: normalized,
        name,
      });
    } catch (error) {
      setScoreLabel(`${name} declined here; shared sync failed`);
    }
  }

  async function clearDeclinedApplicants() {
    if (!state.declinedApplicantKeys.size) return;

    state.declinedApplicantKeys.clear();
    saveDeclinedApplicantKeys();
    updateApplicantDecisionUi();
    setScoreLabel("Declined applicants cleared");
    runAnalysis({ fetchLogs: false });
    try {
      await clearSharedDecisionsOnServer("declined");
    } catch (error) {
      setScoreLabel("Declined cleared here; shared sync failed");
    }
  }

  async function clearAcceptedApplicants() {
    if (!state.acceptedApplicants.size) return;

    const acceptedEntries = [...state.acceptedApplicants];
    const localAcceptedKeys = new Set(
      acceptedEntries
        .map(([key]) => key)
        .filter((key) => !state.lastImportedRosterKeys.has(key))
    );
    const existingApplicantKeys = new Set(
      parsePeople(elements.applicants.value, "applicant").map((applicant) => applicantKey(applicant))
    );
    const restoredApplicantLines = acceptedEntries
      .filter(([key]) => localAcceptedKeys.has(key) && !existingApplicantKeys.has(key))
      .map(([, line]) => line)
      .filter(Boolean);

    elements.currentRoster.value = removeLinesByApplicantKeys(textareaLines(elements.currentRoster), localAcceptedKeys).join("\n");
    if (restoredApplicantLines.length) {
      elements.applicants.value = [...textareaLines(elements.applicants), ...restoredApplicantLines].join("\n");
    }

    state.acceptedApplicants.clear();
    saveAcceptedApplicants();
    updateApplicantDecisionUi();
    setScoreLabel("Accepted applicants cleared");
    runAnalysis({ fetchLogs: false });
    try {
      await clearSharedDecisionsOnServer("accepted");
    } catch (error) {
      setScoreLabel("Accepted cleared here; shared sync failed");
    }
  }

  function updateApplicantDecisionUi() {
    const declinedCount = state.declinedApplicantKeys.size;
    const acceptedCount = state.acceptedApplicants.size;
    if (elements.declinedCount) {
      elements.declinedCount.textContent = `${declinedCount} declined`;
    }
    if (elements.clearDeclined) {
      elements.clearDeclined.disabled = declinedCount === 0;
    }
    if (elements.acceptedCount) {
      elements.acceptedCount.textContent = `${acceptedCount} accepted`;
    }
    if (elements.clearAccepted) {
      elements.clearAccepted.disabled = acceptedCount === 0;
    }
  }

  function resetScoreWeights() {
    const pairs = [
      [elements.scoreParseRank, DEFAULT_SCORE_RANKS.parse],
      [elements.scoreKillsRank, DEFAULT_SCORE_RANKS.kills],
      [elements.scoreRaiderIoRank, DEFAULT_SCORE_RANKS.raiderIo],
      [elements.scoreBuffRank, DEFAULT_SCORE_RANKS.buffs],
    ];
    for (const [input, value] of pairs) {
      if (input) input.value = String(value);
    }
    runAnalysis({ fetchLogs: false });
  }

  function showClipboardToast(parsed) {
    showToast(
      "Game export received",
      `${formatTimestamp(new Date())} - ${parsed.roster.length} roster, ${parsed.applicants.length} applicants`
    );
  }

  function showToast(title, detail) {
    if (!elements.toastStack) return;

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = `
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(detail)}</span>
    `;
    elements.toastStack.append(toast);
    window.setTimeout(() => {
      toast.classList.add("is-hiding");
      window.setTimeout(() => toast.remove(), 260);
    }, 5200);
  }

  function toggleAddonExportSection() {
    if (!elements.addonExportArea || !elements.toggleAddonExport) return;
    const collapsed = elements.addonExportArea.classList.toggle("is-collapsed");
    elements.toggleAddonExport.textContent = collapsed ? "Show" : "Hide";
  }

  function formatTimestamp(date) {
    return date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function loadDemo() {
    state.debugApplicantOverrides = new Map();
    const rosterLines = textareaValueLines(data.demoRoster);
    state.lastImportedRosterKeys = new Set(rosterLines.map((line) => applicantKeyFromLine(line, "roster")).filter(Boolean));
    clearAcceptedApplicantsConfirmedInRoster(state.lastImportedRosterKeys);
    elements.currentRoster.value = mergeAcceptedRosterLines(rosterLines).join("\n");
    elements.applicants.value = filterApplicantDecisionLines(textareaValueLines(data.demoApplicants), state.lastImportedRosterKeys).join("\n");
    elements.addonExport.value = "";
    runAnalysis({ fetchLogs: false });
  }

  function loadMythicPlusDebug() {
    const debug = data.mythicPlusDebug || {};
    const rosterEntries = Array.isArray(debug.roster) ? debug.roster : [];
    const applicantEntries = Array.isArray(debug.applicants) ? debug.applicants : [];
    state.debugApplicantOverrides = buildDebugApplicantOverrides([...rosterEntries, ...applicantEntries]);
    const rosterLines = rosterEntries.map((entry) => String(entry.line || "").trim()).filter(Boolean);
    const applicantLines = applicantEntries.map((entry) => String(entry.line || "").trim()).filter(Boolean);

    if (elements.scoreMode) elements.scoreMode.value = SCORE_MODE_MPLUS;
    if (elements.mythicPlusRange) elements.mythicPlusRange.value = "7-9";
    syncModeUi();
    state.lastImportedRosterKeys = new Set(rosterLines.map((line) => applicantKeyFromLine(line, "roster")).filter(Boolean));
    clearAcceptedApplicantsConfirmedInRoster(state.lastImportedRosterKeys);
    elements.currentRoster.value = mergeAcceptedRosterLines(rosterLines).join("\n");
    elements.applicants.value = filterApplicantDecisionLines(applicantLines, state.lastImportedRosterKeys).join("\n");
    elements.addonExport.value = "";
    setScoreLabel("Loaded Mythic+ Raider.IO debug data");
    runAnalysis({ fetchLogs: false });
  }

  function buildDebugApplicantOverrides(entries) {
    const overrides = new Map();
    for (const entry of entries) {
      const line = String(entry && entry.line || "").trim();
      const key = applicantKeyFromLine(line);
      if (!key) continue;
      overrides.set(key, {
        raiderIoScore: firstNumber(entry.raiderIoScore),
        raiderIoBestTimedLevel: firstNumber(entry.raiderIoBestTimedLevel),
        raiderIoKeyRanges: normalizeRaiderIoKeyRanges(entry.raiderIoKeyRanges),
        raiderIoRunSummary: normalizeRaiderIoRunSummary(entry.raiderIoRunSummary, {
          ranges: entry.raiderIoKeyRanges,
          bestTimedLevel: entry.raiderIoBestTimedLevel,
        }),
        raiderIoProfileUrl: entry.raiderIoProfileUrl || null,
      });
    }
    return overrides;
  }

  function applyDebugApplicantOverride(person) {
    if (!person || !state.debugApplicantOverrides || !state.debugApplicantOverrides.size) return person;
    const override = state.debugApplicantOverrides.get(applicantKey(person));
    return override ? { ...person, ...override } : person;
  }

  function startBridgePolling() {
    if (bridgePollTimer || !window.fetch) return;

    checkBridgeExport();
    bridgePollTimer = window.setInterval(checkBridgeExport, 1500);
  }

  async function checkBridgeExport() {
    if (state.isCheckingBridge) return;

    state.isCheckingBridge = true;
    try {
      const response = await apiFetch("/api/bridge/export", { cache: "no-store" });
      if (!response.ok) return;

      const payload = await response.json();
      const latest = payload && payload.latest;
      if (!latest || !payload.text) {
        state.bridgeInitialized = true;
        return;
      }

      const fingerprint = latest.hash || String(latest.id || "");
      if (!fingerprint || fingerprint === state.bridgeLatestHash) return;
      if (!state.bridgeInitialized) {
        state.bridgeInitialized = true;
        state.bridgeLatestHash = fingerprint;
        return;
      }

      state.bridgeLatestHash = fingerprint;
      receiveBridgeExport({
        ...latest,
        text: payload.text,
      });
    } catch (error) {
      // Server might not be running yet. The next poll will try again.
    } finally {
      state.isCheckingBridge = false;
    }
  }

  function receiveBridgeExport(exportData) {
    if (!exportData || !exportData.text) return;

    if (state.isFetchingLogs) {
      state.pendingBridgeExport = exportData;
      setScoreLabel("Clipboard export queued");
      return;
    }

    applyBridgeExport(exportData);
  }

  function applyBridgeExport(exportData) {
    const raw = String(exportData.text || "").trim();
    if (!raw) return;

    elements.addonExport.value = raw;
    lastAutoImportedExport = raw;
    importAddonExport({ fetchLogs: true, automatic: true, preserveTarget: true, source: "clipboard" });
  }

  function consumePendingBridgeExport() {
    if (!state.pendingBridgeExport || state.isFetchingLogs) return;

    const pending = state.pendingBridgeExport;
    state.pendingBridgeExport = null;
    applyBridgeExport(pending);
  }

  function queuePendingAnalysis(options) {
    const next = {
      fetchLogs: Boolean(options && options.fetchLogs),
    };
    if (!state.pendingAnalysisOptions) {
      state.pendingAnalysisOptions = next;
      return;
    }

    state.pendingAnalysisOptions = {
      fetchLogs: Boolean(state.pendingAnalysisOptions.fetchLogs || next.fetchLogs),
    };
    updateFetchState();
  }

  function consumePendingAnalysis() {
    if (state.isFetchingLogs || !state.pendingAnalysisOptions) return;
    const next = state.pendingAnalysisOptions;
    state.pendingAnalysisOptions = null;
    runAnalysis(next);
  }

  function scheduleAddonExportImport() {
    window.clearTimeout(addonImportTimer);
    addonImportTimer = window.setTimeout(() => {
      const raw = elements.addonExport.value.trim();
      const looksLikeExport = /\bRAA_EXPORT_ESCAPED_V1\b|\bRAA_EXPORT_V1\b|\[ROSTER\]|\[APPLICANTS\]/i.test(raw);
      if (!raw || !looksLikeExport) return;

      importAddonExport({ fetchLogs: true, automatic: true, preserveTarget: true });
    }, 120);
  }

  function importAddonExport(options = {}) {
    state.debugApplicantOverrides = new Map();
    const raw = elements.addonExport.value;
    const decoded = decodeAddonExport(raw);
    if (decoded !== raw) {
      elements.addonExport.value = decoded;
    }

    const parsed = parseAddonExport(decoded);
    if (!parsed.roster.length && !parsed.applicants.length) {
      setScoreLabel("Paste addon export first");
      return;
    }

    const importSnapshot = buildAddonImportSnapshot(parsed);
    const contextSummary = applyAddonContext(parsed.context, {
      preserveTarget: options.preserveTarget !== undefined
        ? options.preserveTarget
        : Boolean(options.automatic || options.source === "clipboard"),
    });
    state.lastImportedRosterKeys = new Set(
      parsed.roster.map((line) => applicantKeyFromLine(line, "roster")).filter(Boolean)
    );
    clearAcceptedApplicantsConfirmedInRoster(state.lastImportedRosterKeys);

    if (parsed.roster.length) {
      elements.currentRoster.value = mergeAcceptedRosterLines(parsed.roster).join("\n");
    }

    if (parsed.applicants.length) {
      elements.applicants.value = filterApplicantDecisionLines(parsed.applicants, state.lastImportedRosterKeys).join("\n");
    }

    trackAddonImportChanges(importSnapshot);

    const label = options.source === "clipboard" ? "Clipboard import" : "Imported";
    const contextSuffix = contextSummary ? ` - ${contextSummary}` : "";
    setScoreLabel(`${label}: ${parsed.roster.length} roster, ${parsed.applicants.length} applicants${contextSuffix}`);
    if (options.source === "clipboard") {
      showClipboardToast(parsed);
    }
    runAnalysis({ fetchLogs: options.fetchLogs !== false });
    return parsed;
  }

  function applyAddonContext(context, options = {}) {
    if (!context || typeof context !== "object") return "";

    const difficulty = difficultyFromContext(context);
    const mythicPlusContext = isMythicPlusContext(context);
    const contextMythicPlusRange = mythicPlusRangeFromContext(context);
    const globalEncounter = encounterFromContext(context, { global: true });
    const contextRaid = raidFromContext(context, globalEncounter);
    const encounter = globalEncounter || encounterFromContext(context);
    const preserveTarget = Boolean(options.preserveTarget);
    const hasActivityContext = mythicPlusContext || hasRaidActivityContext(context);
    if (preserveTarget) {
      return preservedAddonContextSummary({
        context,
        difficulty,
        mythicPlusContext,
        contextMythicPlusRange,
        contextRaid,
        encounter,
      });
    }

    const changes = [];
    const desiredScoreMode = mythicPlusContext ? SCORE_MODE_MPLUS : SCORE_MODE_RAID;
    if (hasActivityContext && elements.scoreMode && elements.scoreMode.value !== desiredScoreMode) {
      elements.scoreMode.value = desiredScoreMode;
      changes.push(desiredScoreMode === SCORE_MODE_MPLUS ? "Mythic+" : "Raid");
    }
    syncModeUi();
    if (difficulty && elements.difficulty && elements.difficulty.value !== String(difficulty)) {
      elements.difficulty.value = String(difficulty);
      changes.push(difficultyShortName(difficulty));
    }
    if (contextMythicPlusRange && elements.mythicPlusRange && elements.mythicPlusRange.value !== contextMythicPlusRange.id) {
      elements.mythicPlusRange.value = contextMythicPlusRange.id;
      changes.push(contextMythicPlusRange.shortLabel);
    }
    if (contextRaid && setRaid(contextRaid)) {
      changes.push(contextRaid.name);
    }
    const encounterRaid = raidFromContext(context, encounter);
    if (encounterRaid && setRaid(encounterRaid)) {
      changes.push(encounterRaid.name);
    }
    if (encounter && elements.bossName) {
      const option = Array.from(elements.bossName.options || [])
        .find((item) => String(item.dataset.encounterId || "") === String(encounter.id || ""));
      if (option && elements.bossName.value !== option.value) {
        elements.bossName.value = option.value;
        if (elements.encounterId) elements.encounterId.value = option.dataset.encounterId || "";
        changes.push(encounter.name);
      }
    }
    if (!encounter && !mythicPlusContext && hasRaidActivityContext(context) && setBossToRaidAverage()) {
      changes.push(RAID_AVERAGE_BOSS_LABEL);
    }

    if (changes.length) return `Target ${changes.join(" ")}`;
    const label = firstContextText(context, "activityName", "listingName", "activityShortName");
    const hasProtectedText = hasProtectedContextText(context);
    if (label) {
      return hasProtectedText ? `Context ${label}; listing text protected` : `Context ${label}`;
    }
    if (hasProtectedText) {
      return "Context listing text protected; boss unchanged";
    }
    const groupType = firstContextText(context, "groupType");
    if (groupType) {
      return `Context ${groupType}; boss unchanged`;
    }
    return "";
  }

  function preservedAddonContextSummary({ context, difficulty, mythicPlusContext, contextMythicPlusRange, contextRaid, encounter }) {
    const targetParts = [];
    if (mythicPlusContext) targetParts.push("Mythic+");
    if (contextMythicPlusRange) targetParts.push(contextMythicPlusRange.shortLabel);
    if (!mythicPlusContext && difficulty) targetParts.push(difficultyShortName(difficulty));
    if (contextRaid) targetParts.push(contextRaid.name);
    if (encounter) targetParts.push(encounter.name);
    if (targetParts.length) return `Context ${targetParts.join(" ")}; kept current target`;

    const label = firstContextText(context, "activityName", "listingName", "activityShortName");
    const hasProtectedText = hasProtectedContextText(context);
    if (label) {
      return hasProtectedText
        ? `Context ${label}; listing text protected; kept current target`
        : `Context ${label}; kept current target`;
    }
    if (hasProtectedText) {
      return "Context listing text protected; kept current target";
    }
    const groupType = firstContextText(context, "groupType");
    if (groupType) {
      return `Context ${groupType}; kept current target`;
    }
    return "";
  }

  function hasRaidActivityContext(context) {
    return Boolean(
      firstContextText(context, "activityName", "activityShortName", "listingName", "difficultyName") ||
      firstNumber(context.activityId, context.groupFinderActivityGroupId, context.difficultyId)
    );
  }

  function isMythicPlusContext(context) {
    const text = contextSearchText(context);
    return /\bmythic\s*(\+|plus|keystone)\b/i.test(text) || /\bm\+\b/i.test(text) || /\+\s*\d{1,2}\b/.test(text);
  }

  function mythicPlusRangeFromContext(context) {
    const text = contextSearchText(context);
    const match = text.match(/(?:\+|key\s*level\s*|level\s*)(\d{1,2})\b/i);
    if (!match) return null;
    return mythicPlusRangeForLevel(Number(match[1]));
  }

  function raidFromContext(context, encounter) {
    const raids = data.raids || [];
    if (!raids.length) return null;

    if (encounter) {
      const encounterId = String(encounter.id || "");
      const raidByEncounter = raids.find((raid) => (raid.encounterIds || []).map(String).includes(encounterId));
      if (raidByEncounter) return raidByEncounter;
    }

    const haystack = normalizedSearchText(contextSearchText(context));
    if (!haystack) return null;

    return raids.find((raid) => {
      const names = [raid.name, ...(raid.aliases || [])];
      return names.some((name) => {
        const needle = normalizedSearchText(name);
        return needle && (haystack.includes(needle) || needle.includes(haystack));
      });
    }) || null;
  }

  function difficultyFromContext(context) {
    const text = contextSearchText(context);
    if (/\b(lfr|looking\s+for\s+raid)\b/i.test(text)) return 2;
    if (/\bnormal\b/i.test(text)) return 3;
    if (/\bheroic\b/i.test(text)) return 4;
    if (/\bmythic\b|\bmythic\s*\+|\bm\+/i.test(text)) return 5;

    const difficultyId = firstNumber(context.difficultyId, context.instanceDifficultyId);
    const difficultyIdMap = {
      14: 3,
      15: 4,
      16: 5,
      17: 2,
      23: 5,
      24: 3,
      33: 5,
    };
    return difficultyIdMap[difficultyId] || null;
  }

  function encounterFromContext(context, options = {}) {
    const haystack = normalizedSearchText(contextSearchText(context));
    if (!haystack) return null;

    const encounters = options.global ? (data.encounters || []) : encountersForSelectedRaid();
    return encounters.find((encounter) => {
      const normalizedName = normalizedSearchText(encounter.name);
      const firstClause = normalizedSearchText(String(encounter.name || "").split(",")[0]);
      return (normalizedName && haystack.includes(normalizedName)) || (firstClause && haystack.includes(firstClause));
    }) || null;
  }

  function contextSearchText(context) {
    return [
      context.activityName,
      context.activityShortName,
      context.listingName,
      context.comment,
      context.instanceName,
      context.mapName,
      context.difficultyName,
      context.instanceDifficultyName,
    ].map(readableContextValue).filter(Boolean).join(" ");
  }

  function firstContextText(context, ...keys) {
    for (const key of keys) {
      const value = readableContextValue(context[key]);
      if (value) return value;
    }

    return "";
  }

  function readableContextValue(value) {
    const text = String(value || "").trim();
    if (!text || isProtectedContextValue(text)) return "";
    return text;
  }

  function isProtectedContextValue(value) {
    const text = String(value || "").trim();
    return /^\|K.*\|k$/i.test(text);
  }

  function hasProtectedContextText(context) {
    if (stringFlag(context.listingTextProtected) || stringFlag(context.commentTextProtected)) return true;

    return [
      context.activityName,
      context.activityShortName,
      context.listingName,
      context.comment,
      context.instanceName,
      context.mapName,
      context.difficultyName,
      context.instanceDifficultyName,
    ].some(isProtectedContextValue);
  }

  function stringFlag(value) {
    return /^(1|true|yes)$/i.test(String(value || "").trim());
  }

  async function runAnalysis(options) {
    if (state.isFetchingLogs) {
      queuePendingAnalysis(options);
      return;
    }

    if (!options.fetchLogs) {
      state.logFetchMessage = null;
    }

    const target = readTarget();
    let roster = uniquePeopleByApplicantKey(
      parsePeople(mergeAcceptedRosterLines(textareaLines(elements.currentRoster)).join("\n"), "roster")
        .map(applyDebugApplicantOverride)
    );
    let applicants = filterApplicantsAlreadyInRoster(
      filterApplicantDecisionApplicants(parsePeople(elements.applicants.value, "applicant").map(applyDebugApplicantOverride)),
      roster
    );
    const rerender = () => {
      const analysis = recommendApplicants({ target, roster, applicants });
      state.latestAnalysis = analysis;
      render(analysis);
    };

    if (!options.fetchLogs) {
      rerender();
      return;
    }

    state.isFetchingLogs = true;
    setFetchButtonLoading(true);
    const fetchSourceLabel = target.scoreMode === SCORE_MODE_MPLUS ? "Raider.IO" : "Warcraft Logs";
    setLogProgress(`Checking ${fetchSourceLabel} connection`);
    rerender();

    const health = await checkServer();
    if (!health || (!health.hasWarcraftLogsCredentials && target.scoreMode !== SCORE_MODE_MPLUS)) {
      setLogProgress(target.scoreMode === SCORE_MODE_MPLUS ? "Server not available" : "Warcraft Logs credentials not loaded");
      rerender();
      finishLogFetch();
      return;
    }

    if (target.scoreMode !== SCORE_MODE_MPLUS && !target.encounterId && !target.bossName) {
      setLogProgress("Enter a boss name or encounter ID");
      rerender();
      finishLogFetch();
      return;
    }

    roster = await enrichWithWarcraftLogs(roster, target, "roster", (person, index, current) => {
      roster = current;
      rerender();
    });
    applicants = await enrichWithWarcraftLogs(applicants, target, "applicants", (person, index, current) => {
      applicants = current;
      rerender();
    });

    const allPeople = [...roster, ...applicants];
    const fetched = allPeople.filter((person) => person.logStatus === "live").length;
    const cached = allPeople.filter((person) => person.cacheHit).length;
    const noData = allPeople.filter((person) => person.logStatus === "no-data").length;
    const errors = allPeople.filter((person) => person.logStatus === "error").length;
    setLogProgress(`${fetchSourceLabel} fetched: ${fetched} live${cached ? `, ${cached} cached` : ""}${noData ? `, ${noData} no data` : ""}${errors ? `, ${errors} errors` : ""}`);
    rerender();
    finishLogFetch();
  }

  function readTarget() {
    const difficulty = Number(elements.difficulty.value);
    const difficultyInfo = data.difficulties.find((item) => item.id === difficulty) || data.difficulties[0];
    const raid = selectedRaid();
    const scoreMode = elements.scoreMode && elements.scoreMode.value === SCORE_MODE_MPLUS
      ? SCORE_MODE_MPLUS
      : SCORE_MODE_RAID;
    const mythicPlusRange = selectedMythicPlusRange();
    const bossOption = elements.bossName && elements.bossName.selectedOptions && elements.bossName.selectedOptions[0];
    const isRaidAverage = Boolean(bossOption && bossOption.dataset.raidAverage === "true");
    const bossName = bossOption
      ? bossOption.textContent.trim()
      : String(elements.bossName && elements.bossName.value || "").trim();
    const encounterId = Number(
      (!isRaidAverage && bossOption && bossOption.dataset.encounterId)
      || (elements.encounterId && elements.encounterId.value)
    ) || null;

    return {
      bossName: isRaidAverage ? RAID_AVERAGE_BOSS_LABEL : bossName || "Selected boss",
      encounterId: isRaidAverage ? null : encounterId,
      zoneAnchorEncounterId: isRaidAverage ? raidZoneAnchorEncounterId() : null,
      raidAverage: isRaidAverage,
      raidId: raid && raid.id,
      raidName: raid && raid.name,
      scoreMode,
      mythicPlusRange: mythicPlusRange.id,
      mythicPlusRangeLabel: mythicPlusRange.label,
      difficulty,
      fallbackDifficulty: difficultyInfo.fallback,
      metric: elements.metric.value,
      weights: readScoreWeights(scoreMode),
      roles: {
        Tank: clampNumber(elements.tankTarget.value, 0, 30),
        Healer: clampNumber(elements.healerTarget.value, 0, 30),
        DPS: clampNumber(elements.dpsTarget.value, 0, 30),
      },
    };
  }

  function raidLogTargetKey(target) {
    const scoreMode = String(target && target.scoreMode || SCORE_MODE_RAID);
    if (scoreMode !== SCORE_MODE_RAID) {
      return JSON.stringify({
        scoreMode,
        mythicPlusRange: String(target && target.mythicPlusRange || ""),
      });
    }

    return JSON.stringify({
      scoreMode,
      raidId: String(target && target.raidId || ""),
      encounterId: Number(target && target.encounterId) || null,
      zoneAnchorEncounterId: Number(target && target.zoneAnchorEncounterId) || null,
      raidAverage: Boolean(target && target.raidAverage),
      difficulty: Number(target && target.difficulty) || null,
      fallbackDifficulty: Number(target && target.fallbackDifficulty) || null,
      metric: String(target && target.metric || "auto"),
    });
  }

  function describeRaidLogTarget(target) {
    if (!target) return "";
    if (target.scoreMode === SCORE_MODE_MPLUS) {
      const range = mythicPlusRangeById(target.mythicPlusRange);
      return `Mythic+ ${range.shortLabel}`;
    }

    const parts = [];
    if (target.raidName) parts.push(target.raidName);
    if (target.raidAverage) parts.push(RAID_AVERAGE_BOSS_LABEL);
    else if (target.bossName) parts.push(target.bossName);
    if (target.difficulty) parts.push(difficultyShortName(target.difficulty));
    return parts.join(" ");
  }

  function hasTargetedRaidLogFields(applicant) {
    return Boolean(applicant && (
      applicant.logTargetKey ||
      applicant.logTargetLabel ||
      applicant.difficultyProfiles ||
      applicant.resolvedEncounterId ||
      applicant.logPartitionLabel
    ));
  }

  function raidLogDataMatchesTarget(applicant, target) {
    if (!target || target.scoreMode !== SCORE_MODE_RAID) return true;
    if (!hasTargetedRaidLogFields(applicant)) return true;
    const stored = String(applicant && applicant.logTargetKey || "").trim();
    if (!stored) return false;
    return stored === raidLogTargetKey(target);
  }

  function staleRaidLogData(applicant, target) {
    return Boolean(target && target.scoreMode === SCORE_MODE_RAID && hasTargetedRaidLogFields(applicant) && !raidLogDataMatchesTarget(applicant, target));
  }

  function selectedMythicPlusRange() {
    const wanted = String(elements.mythicPlusRange && elements.mythicPlusRange.value || "").trim();
    return MYTHIC_PLUS_RANGES.find((range) => range.id === wanted) || MYTHIC_PLUS_RANGES[3];
  }

  function mythicPlusRangeById(id) {
    return MYTHIC_PLUS_RANGES.find((range) => range.id === id) || selectedMythicPlusRange();
  }

  function mythicPlusRangeForLevel(level) {
    const number = Number(level);
    if (!Number.isFinite(number) || number <= 0) return null;
    return MYTHIC_PLUS_RANGES.find((range) => (
      number >= range.min && (range.max === null || number <= range.max)
    )) || MYTHIC_PLUS_RANGES[MYTHIC_PLUS_RANGES.length - 1];
  }

  function readScoreWeights(scoreMode = SCORE_MODE_RAID) {
    if (scoreMode === SCORE_MODE_MPLUS) {
      return {
        ranks: {
          parse: 4,
          kills: 4,
          raiderIo: 1,
          buffs: 4,
        },
        metricWeights: {
          parse: 0,
          kills: 0,
          raiderIo: 1,
          buffs: 0,
        },
      };
    }

    const ranks = uniqueScoreRanks({
      parse: readScoreRank(elements.scoreParseRank, DEFAULT_SCORE_RANKS.parse),
      kills: readScoreRank(elements.scoreKillsRank, DEFAULT_SCORE_RANKS.kills),
      raiderIo: readScoreRank(elements.scoreRaiderIoRank, DEFAULT_SCORE_RANKS.raiderIo),
      buffs: readScoreRank(elements.scoreBuffRank, DEFAULT_SCORE_RANKS.buffs),
    });
    writeScoreRankInputs(ranks);

    return {
      ranks,
      metricWeights: {
        parse: SCORE_WEIGHT_BY_RANK[ranks.parse],
        kills: SCORE_WEIGHT_BY_RANK[ranks.kills],
        raiderIo: SCORE_WEIGHT_BY_RANK[ranks.raiderIo],
        buffs: SCORE_WEIGHT_BY_RANK[ranks.buffs],
      },
    };
  }

  function readScoreRank(input, fallback) {
    return clampNumber(input && input.value, 1, 4) || fallback;
  }

  function uniqueScoreRanks(ranks) {
    const metrics = ["parse", "kills", "raiderIo", "buffs"];
    const used = new Set();
    const normalized = {};

    for (const metric of metrics) {
      const rank = ranks[metric];
      if (!used.has(rank)) {
        normalized[metric] = rank;
        used.add(rank);
        continue;
      }

      const fallback = metrics
        .map((item) => DEFAULT_SCORE_RANKS[item])
        .find((candidate) => !used.has(candidate));
      normalized[metric] = fallback || DEFAULT_SCORE_RANKS[metric];
      used.add(normalized[metric]);
    }

    return normalized;
  }

  function writeScoreRankInputs(ranks) {
    const pairs = [
      [elements.scoreParseRank, ranks.parse],
      [elements.scoreKillsRank, ranks.kills],
      [elements.scoreRaiderIoRank, ranks.raiderIo],
      [elements.scoreBuffRank, ranks.buffs],
    ];
    for (const [input, rank] of pairs) {
      if (input && input.value !== String(rank)) input.value = String(rank);
    }
  }

  async function enrichWithWarcraftLogs(people, target, label, onUpdate) {
    setLogProgress(`Fetching ${label || "logs"}`);
    const enriched = people.map((person) => ({
      ...person,
      logStatus: "pending",
      logError: null,
      cacheHit: false,
    }));
    if (onUpdate) onUpdate(null, -1, [...enriched]);

    let nextIndex = 0;
    let completed = 0;
    const workerCount = Math.min(LOG_FETCH_CONCURRENCY, Math.max(people.length, 1));

    async function fetchPerson(index) {
      const applicant = people[index];
      enriched[index] = {
        ...enriched[index],
        logStatus: "fetching",
        logError: null,
      };
      setLogProgress(`Fetching ${label || "logs"} ${completed + 1}/${people.length}: ${applicant.name}`);
      if (onUpdate) onUpdate(enriched[index], index, [...enriched]);

      try {
        const response = await apiFetch("/api/warcraftlogs/rankings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            applicant,
            target,
            fallbackDifficulty: target.fallbackDifficulty,
          }),
        });
        const rankings = await response.json();

        if (!response.ok) {
          throw new Error(rankings.error || "Warcraft Logs request failed.");
        }

        updateRateState(rankings.rateLimit, rankings.cache);
        const difficultyProfiles = buildDifficultyProfiles(rankings, target);
        const mythicProfile = profileForDifficulty(difficultyProfiles, 5);
        const heroicProfile = profileForDifficulty(difficultyProfiles, 4);
        const normalProfile = profileForDifficulty(difficultyProfiles, 3);
        const lfrProfile = profileForDifficulty(difficultyProfiles, 2);
        const logPartitionLabel = logPartitionLabelFromProfiles(difficultyProfiles);
        const selectedProfile = profileForDifficulty(difficultyProfiles, target.difficulty);
        const fallbackProfile = profileForDifficulty(difficultyProfiles, target.fallbackDifficulty);
        const primaryParse = firstNumber(rankings.primary && rankings.primary.percentile, selectedProfile && selectedProfile.bossParse);
        const fallbackParse = firstNumber(rankings.fallback && rankings.fallback.percentile, fallbackProfile && fallbackProfile.bossParse);
        const raiderIoRanges = normalizeRaiderIoKeyRanges(applicant.raiderIoKeyRanges || rankings.character && rankings.character.raiderIoKeyRanges);
        const raiderIoBestTimedLevel = firstNumber(applicant.raiderIoBestTimedLevel, rankings.character && rankings.character.raiderIoBestTimedLevel);
        const raiderIoRating = firstNumber(applicant.raiderIoScore, rankings.character && rankings.character.raiderIoScore);
        const raiderIoRunSummary = normalizeRaiderIoRunSummary(
          applicant.raiderIoRunSummary || rankings.character && rankings.character.raiderIoRunSummary,
          { ranges: raiderIoRanges, bestTimedLevel: raiderIoBestTimedLevel }
        );
        const hasRaiderIoValue = [raiderIoRating, raiderIoBestTimedLevel]
          .concat(Object.values(raiderIoRanges))
          .some((value) => value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) > 0);
        const hasLogValue = target.scoreMode === SCORE_MODE_MPLUS ? hasRaiderIoValue : [primaryParse, fallbackParse]
          .concat(Object.values(difficultyProfiles).flatMap((profile) => [
            profile && profile.bossParse,
            profile && profile.bossKills,
            profile && profile.bestPerfAvg,
            profile && profile.medianPerfAvg,
            profile && profile.kills,
          ]))
          .some((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));

        const enrichedPerson = {
          ...applicant,
          className: applicant.className || (rankings.character && rankings.character.className) || "",
          specName: applicant.specName || (rankings.character && rankings.character.specName) || "",
          itemLevel: firstPositiveNumber(applicant.itemLevel, rankings.character && rankings.character.itemLevel),
          raiderIoScore: raiderIoRating,
          raiderIoTimedTenPlus: firstNumber(applicant.raiderIoTimedTenPlus, rankings.character && rankings.character.raiderIoTimedTenPlus),
          raiderIoKeyRanges: raiderIoRanges,
          raiderIoBestTimedLevel,
          raiderIoRunSummary,
          raiderIoProfileUrl: applicant.raiderIoProfileUrl || (rankings.character && rankings.character.raiderIoProfileUrl) || null,
          primaryParse,
          primaryKills: firstNumber(rankings.primary && rankings.primary.kills, selectedProfile && selectedProfile.bossKills),
          fallbackParse,
          fallbackKills: firstNumber(rankings.fallback && rankings.fallback.kills, fallbackProfile && fallbackProfile.bossKills),
          difficultyProfiles,
          mythicBestPerfAvg: mythicProfile && mythicProfile.bestPerfAvg,
          heroicBestPerfAvg: heroicProfile && heroicProfile.bestPerfAvg,
          normalBestPerfAvg: normalProfile && normalProfile.bestPerfAvg,
          lfrBestPerfAvg: lfrProfile && lfrProfile.bestPerfAvg,
          mythicMedianPerfAvg: mythicProfile && mythicProfile.medianPerfAvg,
          heroicMedianPerfAvg: heroicProfile && heroicProfile.medianPerfAvg,
          normalMedianPerfAvg: normalProfile && normalProfile.medianPerfAvg,
          lfrMedianPerfAvg: lfrProfile && lfrProfile.medianPerfAvg,
          mythicKills: mythicProfile && mythicProfile.kills,
          heroicKills: heroicProfile && heroicProfile.kills,
          normalKills: normalProfile && normalProfile.kills,
          lfrKills: lfrProfile && lfrProfile.kills,
          mythicProgress: mythicProfile && mythicProfile.progress,
          heroicProgress: heroicProfile && heroicProfile.progress,
          normalProgress: normalProfile && normalProfile.progress,
          lfrProgress: lfrProfile && lfrProfile.progress,
          mythicEncounterRanks: mythicProfile && mythicProfile.encounterRanks,
          heroicEncounterRanks: heroicProfile && heroicProfile.encounterRanks,
          normalEncounterRanks: normalProfile && normalProfile.encounterRanks,
          lfrEncounterRanks: lfrProfile && lfrProfile.encounterRanks,
          resolvedEncounterId: rankings.encounterId,
          resolvedZoneName: rankings.zone && rankings.zone.name,
          logTargetKey: raidLogTargetKey(target),
          logTargetLabel: describeRaidLogTarget(target),
          logPartitionLabel,
          logStatus: hasLogValue ? "live" : "no-data",
          logError: hasLogValue ? null : (target.scoreMode === SCORE_MODE_MPLUS ? "No Raider.IO Mythic+ score or timed run data." : rankingReason(rankings)),
          cacheHit: Boolean(rankings.cache && rankings.cache.hit),
          cacheExpiresInSeconds: rankings.cache && rankings.cache.expiresInSeconds,
        };
        enriched[index] = enrichedPerson;
        completed += 1;
        setLogProgress(`Fetched ${label || "logs"} ${completed}/${people.length}: ${applicant.name}${enrichedPerson.cacheHit ? " (cached)" : ""}`);
        if (onUpdate) onUpdate(enrichedPerson, index, [...enriched]);
      } catch (error) {
        const enrichedPerson = {
          ...applicant,
          logStatus: "error",
          logError: error.message,
          cacheHit: false,
        };
        enriched[index] = enrichedPerson;
        completed += 1;
        setLogProgress(`Fetched ${label || "logs"} ${completed}/${people.length}: ${applicant.name} (error)`);
        if (onUpdate) onUpdate(enrichedPerson, index, [...enriched]);
      }
    }

    async function worker() {
      while (nextIndex < people.length) {
        const index = nextIndex;
        nextIndex += 1;
        await fetchPerson(index);
      }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    setLogProgress(`Fetched ${label || "logs"}: ${people.length}`);
    return enriched;
  }

  function setFetchButtonLoading(isLoading) {
    for (const button of [elements.fetchLogs, elements.fetchRosterLogs, elements.importAddonExport].filter(Boolean)) {
      button.disabled = isLoading;
      button.classList.toggle("is-loading", isLoading);
    }
  }

  function finishLogFetch() {
    state.isFetchingLogs = false;
    setFetchButtonLoading(false);
    updateFetchState();
    window.setTimeout(() => {
      consumePendingBridgeExport();
      consumePendingAnalysis();
    }, 0);
  }

  function setLogProgress(message) {
    state.logFetchMessage = message;
    setScoreLabel(message);
    updateFetchState();
  }

  function rankingReason(rankings) {
    const sources = [
      rankings.primary,
      rankings.fallback,
      rankings.zoneDifficulties && rankings.zoneDifficulties.mythic,
      rankings.zoneDifficulties && rankings.zoneDifficulties.heroic,
      rankings.zoneDifficulties && rankings.zoneDifficulties.normal,
      rankings.zoneDifficulties && rankings.zoneDifficulties.lfr,
      rankings.difficulties && rankings.difficulties.mythic,
      rankings.difficulties && rankings.difficulties.heroic,
      rankings.difficulties && rankings.difficulties.normal,
      rankings.difficulties && rankings.difficulties.lfr,
    ].filter(Boolean);

    const requestError = sources.find((source) => source.requestError && source.reason);
    if (requestError) return requestError.reason;

    const reason = sources.find((source) => source.reason);
    return reason ? reason.reason : "No public Warcraft Logs data for this raid.";
  }

  function buildDifficultyProfiles(rankings, target) {
    return RAID_DIFFICULTIES.reduce((profiles, difficulty) => {
      const ranking = rankingPayloadForDifficulty(rankings, difficulty);
      const zoneRanking = zonePayloadForDifficulty(rankings, difficulty);
      const encounterRanks = normalizeEncounterRanks(zoneRanking);
      const encounter = encounterRanks.find((rank) => String(rank.id) === String(target.encounterId || ""));
      const bossParse = firstNumber(ranking && ranking.percentile, encounter && encounter.percentile);
      const bossKills = firstNumber(ranking && ranking.kills, encounter && encounter.kills);

      profiles[String(difficulty)] = {
        difficulty,
        key: difficultyKey(difficulty),
        label: difficultyShortName(difficulty),
        bossParse,
        bossKills,
        bestPerfAvg: firstPositiveNumber(zoneRanking && zoneRanking.bestPerfAvg, ranking && ranking.bestPerfAvg, bossParse),
        medianPerfAvg: firstPositiveNumber(zoneRanking && zoneRanking.medianPerfAvg, encounter && encounter.medianPercent),
        kills: firstNumber(zoneRanking && zoneRanking.kills, ranking && ranking.kills),
        progress: raidProgression(zoneRanking),
        encounterRanks,
        partition: (zoneRanking && zoneRanking.partition) || (ranking && ranking.partition) || null,
      };
      return profiles;
    }, {});
  }

  function logPartitionLabelFromProfiles(profiles) {
    for (const difficulty of RAID_DIFFICULTIES) {
      const profile = profileForDifficulty(profiles, difficulty);
      const partition = profile && profile.partition;
      const label = partition && (partition.label || partition.compactName || partition.name);
      if (label) return label;
    }
    return "";
  }

  function rankingPayloadForDifficulty(rankings, difficulty) {
    if (!rankings) return null;

    const key = difficultyKey(difficulty);
    if (rankings.difficultyRankings && rankings.difficultyRankings[String(difficulty)]) {
      return rankings.difficultyRankings[String(difficulty)];
    }

    return rankings.difficulties && key ? rankings.difficulties[key] : null;
  }

  function zonePayloadForDifficulty(rankings, difficulty) {
    if (!rankings) return null;

    const key = difficultyKey(difficulty);
    if (rankings.zoneDifficultyRankings && rankings.zoneDifficultyRankings[String(difficulty)]) {
      return rankings.zoneDifficultyRankings[String(difficulty)];
    }

    return rankings.zoneDifficulties && key ? rankings.zoneDifficulties[key] : null;
  }

  function profileForDifficulty(profiles, difficulty) {
    if (!profiles || !difficulty) return null;
    return profiles[String(Number(difficulty))] || null;
  }

  function raidProgression(zoneRanking) {
    const encounterIds = (data.encounters || [])
      .map((encounter) => String(encounter.id || ""))
      .filter(Boolean);
    if (!zoneRanking || !encounterIds.length) return null;

    const encounters = zoneRanking.encounters || {};
    const killed = encounterIds.reduce((count, encounterId) => {
      const encounter = encounters[encounterId];
      return count + (encounter && Number(encounter.kills) > 0 ? 1 : 0);
    }, 0);

    if (killed === 0 && !zoneRanking.exists) return null;
    return {
      killed,
      total: encounterIds.length,
    };
  }

  function parsePeople(raw, source) {
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !isAddonExportMarker(line))
      .map((line, index) => parsePersonLine(line, index, source))
      .filter(Boolean);
  }

  function parseAddonExport(raw) {
    raw = decodeAddonExport(raw);
    const sections = {
      context: {},
      roster: [],
      applicants: [],
    };
    let section = null;

    for (const line of raw.split(/\r?\n/).map((item) => item.trim())) {
      if (!line || line === "RAA_EXPORT_V1") continue;

      const normalized = line.toUpperCase();
      if (normalized === "[CONTEXT]") {
        section = "context";
        continue;
      }

      if (normalized === "[ROSTER]") {
        section = "roster";
        continue;
      }

      if (normalized === "[APPLICANTS]") {
        section = "applicants";
        continue;
      }

      if (section === "context") {
        const contextEntry = parseContextLine(line);
        if (contextEntry) sections.context[contextEntry.key] = contextEntry.value;
        continue;
      }

      if (!section || isAddonExportMarker(line) || !line.includes(",")) continue;
      sections[section].push(line);
    }

    return sections;
  }

  function decodeAddonExport(raw) {
    const text = String(raw || "").trim();
    const match = text.match(/^RAA_EXPORT_ESCAPED_V1:(\S+)$/i);
    if (!match) return String(raw || "");

    try {
      return decodeURIComponent(match[1]);
    } catch (_error) {
      return String(raw || "");
    }
  }

  function parseContextLine(line) {
    const index = String(line || "").indexOf("=");
    if (index <= 0) return null;
    const key = normalizeContextKey(line.slice(0, index));
    const value = line.slice(index + 1).trim();
    return key && value ? { key, value } : null;
  }

  function normalizeContextKey(value) {
    return String(value || "")
      .trim()
      .replace(/[^a-zA-Z0-9]+(.)/g, (_, character) => character.toUpperCase())
      .replace(/^[A-Z]/, (character) => character.toLowerCase());
  }

  function isAddonExportMarker(line) {
    const normalized = String(line || "").trim().toUpperCase();
    return normalized === "RAA_EXPORT_V1" || normalized === "[CONTEXT]" || normalized === "[ROSTER]" || normalized === "[APPLICANTS]";
  }

  function parsePersonLine(line, index, source) {
    const parts = line.split(",").map((part) => part.trim());
    const identity = parseIdentity(parts[0] || "");
    if (!identity.name) return null;

    return {
      id: `${source}-${index}-${identity.name}-${identity.realm}`,
      source,
      line,
      name: identity.name,
      realm: identity.realm,
      region: identity.region,
      role: normalizeRole(parts[1]),
      className: normalizeClass(parts[2]),
      specName: parts[3] || "",
      primaryParse: parsePercentile(parts[4]),
      fallbackParse: parsePercentile(parts[5]),
      primaryKills: parseCount(parts[6]),
      fallbackKills: parseCount(parts[7]),
      mythicBestPerfAvg: parsePercentile(parts[8]),
      heroicBestPerfAvg: parsePercentile(parts[9]),
      itemLevel: parseItemLevel(parts[10]),
      applicationNote: normalizeApplicationNote(parts.slice(11).join(",")),
      logStatus: "manual",
    };
  }

  function parseIdentity(raw) {
    const pieces = raw.split("-").map((piece) => piece.trim()).filter(Boolean);
    const regionCandidate = pieces[pieces.length - 1];
    const hasRegion = /^(us|eu|kr|tw|cn)$/i.test(regionCandidate);
    const region = hasRegion ? regionCandidate.toUpperCase() : "US";
    const name = pieces[0] || "";
    const realmPieces = pieces.slice(1, hasRegion ? -1 : undefined);

    return {
      name,
      realm: realmPieces.join("-") || "area-52",
      region,
    };
  }

  function recommendApplicants({ target, roster, applicants }) {
    const startingCounts = countRoles(roster);
    const startingBuffs = coveredBuffs(roster);
    const rosterScores = scoreRosterMembers(roster, target);
    const allScores = applicants
      .map((applicant) => scoreApplicant(applicant, {
        target,
        roster,
        selected: [],
        currentBuffs: startingBuffs,
        counts: startingCounts,
        applyPreferenceBonus: true,
      }))
      .sort((a, b) => b.total - a.total)
      .map((score, index) => ({
        ...score,
        rank: index + 1,
      }));

    return {
      target,
      roster,
      applicants,
      selected: [],
      selectedScores: [],
      allScores,
      rosterScores,
      currentRoleCounts: startingCounts,
      selectedRoleCounts: { Tank: 0, Healer: 0, DPS: 0 },
      roleCounts: startingCounts,
      coveredBuffs: startingBuffs,
      missingBuffs: missingBuffs(roster),
    };
  }

  function scoreApplicant(applicant, context) {
    const settings = context.target.weights || readScoreWeights();
    const weights = settings.metricWeights || {};
    const isMplusMode = context.target.scoreMode === SCORE_MODE_MPLUS;
    const parse = isMplusMode ? disabledScore() : parseScore(applicant, context.target);
    const kills = isMplusMode ? disabledScore() : killScore(applicant, context.target);
    const raiderIo = raiderIoScore(applicant, context.target);
    const buffs = isMplusMode ? disabledScore() : buffScore(applicant, context.currentBuffs);
    const preference = isMplusMode ? disabledScore() : wantedDpsClassPreferenceScore(applicant, context);
    const exactContributions = {
      parse: parse.points * (weights.parse || 0),
      kills: kills.points * (weights.kills || 0),
      raiderIo: raiderIo.points * (weights.raiderIo || 0),
      buffs: buffs.points * (weights.buffs || 0),
      preference: preference.points,
    };
    const total = Math.round(Object.values(exactContributions).reduce((sum, value) => sum + value, 0));
    const contributions = roundContributionsToTotal(exactContributions, total);

    return {
      applicant,
      total,
      contributions,
      exactContributions,
      weights,
      parse,
      kills,
      raiderIo,
      buffs,
      preference,
      reasons: isMplusMode
        ? [...raiderIo.reasons]
        : [...preference.reasons, ...parse.reasons, ...kills.reasons, ...raiderIo.reasons, ...buffs.reasons],
      warnings: isMplusMode
        ? [...raiderIo.warnings]
        : [...preference.warnings, ...parse.warnings, ...kills.warnings, ...raiderIo.warnings],
    };
  }

  function disabledScore() {
    return {
      points: 0,
      reasons: [],
      warnings: [],
    };
  }

  function wantedDpsClassPreferenceScore(applicant, context) {
    if (!context || context.applyPreferenceBonus === false) return disabledScore();
    if (!context.target || context.target.scoreMode !== SCORE_MODE_RAID) return disabledScore();
    if (!applicant || applicant.role !== "DPS") return disabledScore();

    const className = normalizeWantedDpsClass(applicant.className);
    if (!className) return disabledScore();

    const openDpsSlots = currentOpenDpsSlotCountFor(
      context.target.roles,
      context.counts || countRoles(context.roster || [])
    );
    const desiredCount = wantedDpsSlotClassCounts(openDpsSlots).get(className) || 0;
    if (!desiredCount) return disabledScore();

    return {
      points: WANTED_DPS_CLASS_BONUS_POINTS,
      reasons: [`wanted DPS: ${className}${desiredCount > 1 ? ` (${desiredCount} slots)` : ""}`],
      warnings: [],
      desiredCount,
    };
  }

  function scoreRosterMembers(roster, target) {
    return roster.map((member, index) => {
      const peers = roster.filter((_, peerIndex) => peerIndex !== index);
      return scoreApplicant(member, {
        target,
        roster: peers,
        selected: [],
        currentBuffs: coveredBuffs(peers),
        counts: countRoles(peers),
        applyPreferenceBonus: false,
      });
    });
  }

  function rosterScoreForMember(analysis, member) {
    return (analysis.rosterScores || []).find((score) => score.applicant.id === member.id) || null;
  }

  function roundContributionsToTotal(contributions, total) {
    const metrics = ["parse", "kills", "raiderIo", "buffs", "preference"]
      .filter((metric) => Object.prototype.hasOwnProperty.call(contributions, metric));
    const rounded = {};
    const parts = metrics.map((metric, index) => {
      const value = Number(contributions[metric]) || 0;
      const floor = Math.floor(value);
      rounded[metric] = floor;
      return {
        metric,
        index,
        remainder: value - floor,
      };
    });

    let remaining = total - Object.values(rounded).reduce((sum, value) => sum + value, 0);
    parts.sort((left, right) => {
      if (right.remainder !== left.remainder) return right.remainder - left.remainder;
      return left.index - right.index;
    });

    for (let index = 0; remaining > 0 && parts.length; index += 1) {
      rounded[parts[index % parts.length].metric] += 1;
      remaining -= 1;
    }

    return rounded;
  }

  function parseScore(applicant, target) {
    const selectedDifficulty = Number(target.difficulty) || null;
    const fallbackDifficulty = Number(target && target.fallbackDifficulty) || null;
    const profiles = relevantScoringDifficultyColumns(target)
      .map((difficulty) => parseScoreForDifficulty(applicant, target, difficulty, selectedDifficulty))
      .filter((profile) => profile.available.length > 0);
    const warnings = [];

    if (!profiles.length) {
      return {
        points: 0,
        reasons: ["no parse data"],
        warnings: ["no relevant parse found"],
        source: "none",
      };
    }

    const byDifficulty = new Map(profiles.map((profile) => [Number(profile.difficulty), profile]));
    const best = selectParseProfile(applicant, target, byDifficulty, profiles, selectedDifficulty, fallbackDifficulty);
    if (!best || !best.available || !best.available.length) {
      return {
        points: 0,
        reasons: ["no parse data"],
        warnings: ["no selected or same-tier boss fallback found"],
        source: "none",
        difficulty: selectedDifficulty,
        multiplier: 0,
        label: difficultyShortName(selectedDifficulty),
      };
    }
    const reasonParts = best.available
      .slice()
      .sort((left, right) => right.value - left.value)
      .slice(0, 3)
      .map((part) => `${part.label} ${formatParse(part.value, { average: part.value % 1 !== 0 })}`);
    if (best.points < 40) warnings.push("low parse profile");

    const modifierLabel = best.multiplier > 1
      ? `boosted (${formatCreditPercent(best.multiplier)}) `
      : best.multiplier < 1
        ? `discounted (${formatCreditPercent(best.multiplier)}) `
        : "";
    const sourceLabel = best.label || difficultyShortName(best.difficulty);

    return {
      points: clampScore(best.points),
      reasons: [`parses: ${sourceLabel} ${modifierLabel}${reasonParts.join(", ")}`],
      warnings,
      source: best.source,
      difficulty: best.difficulty,
      multiplier: best.multiplier,
      label: best.label || difficultyShortName(best.difficulty),
    };
  }

  function selectParseProfile(applicant, target, byDifficulty, profiles, selectedDifficulty, fallbackDifficulty) {
    if (isBossTarget(target)) {
      const primary = byDifficulty.get(Number(selectedDifficulty));
      if (primary && primary.hasEncounterData) return primary;

      const higher = profiles
        .filter((profile) => Number(profile.difficulty) > Number(selectedDifficulty) && profile.hasEncounterData)
        .sort((left, right) => right.points - left.points);
      if (higher.length) return higher[0];

      const sameTierFallback = sameTierBossParseFallback(applicant, target, selectedDifficulty);
      if (sameTierFallback) return sameTierFallback;

      return {
        difficulty: selectedDifficulty,
        parts: [],
        available: [],
        rawPoints: 0,
        multiplier: 0,
        points: 0,
        source: "none",
        label: difficultyShortName(selectedDifficulty),
      };
    }

    const primary = byDifficulty.get(Number(selectedDifficulty));
    if (primary && primary.available.length) return primary;

    const fallback = byDifficulty.get(Number(fallbackDifficulty));
    if (fallback && fallback.available.length) return fallback;

    const higher = profiles
      .filter((profile) => Number(profile.difficulty) > Number(selectedDifficulty))
      .sort((left, right) => right.points - left.points);
    if (higher.length) return higher[0];

    return profiles.slice().sort((left, right) => right.points - left.points)[0];
  }

  function parseScoreForDifficulty(applicant, target, difficulty, selectedDifficulty) {
    const encounter = encounterRankForDifficulty(applicant, difficulty, target.encounterId, target);
    const parts = [
      parseScorePart(`${difficultyShortName(difficulty)} boss max`, bossParseForDifficulty(applicant, target, difficulty), 0.35, 1),
      parseScorePart(`${difficultyShortName(difficulty)} boss median`, encounter && encounter.medianPercent, 0.20, 1),
      parseScorePart(`${difficultyShortName(difficulty)} raid average`, bestPerfForDifficulty(applicant, target, difficulty), 0.25, 1),
      parseScorePart(`${difficultyShortName(difficulty)} raid median`, medianPerfForDifficulty(applicant, target, difficulty), 0.20, 1),
    ];
    const available = parts.filter((part) => part.value !== null);
    const weightSum = available.reduce((sum, part) => sum + part.weight, 0);
    const rawPoints = weightSum
      ? available.reduce((sum, part) => sum + part.value * part.weight, 0) / weightSum
      : 0;
    const multiplier = parseDifficultyMultiplier(difficulty, selectedDifficulty);

    return {
      difficulty,
      parts,
      available,
      rawPoints,
      multiplier,
      points: clampScore(rawPoints * multiplier),
      source: parseDifficultySource(difficulty, selectedDifficulty),
      label: difficultyShortName(difficulty),
      hasEncounterData: firstNumber(
        bossParseForDifficulty(applicant, target, difficulty),
        encounter && encounter.medianPercent
      ) !== null,
    };
  }

  function sameTierBossParseFallback(applicant, target, difficulty) {
    const otherBosses = otherEncounterRanksForDifficulty(applicant, difficulty, target)
      .filter((encounter) => firstNumber(encounter.percentile, encounter.medianPercent) !== null);
    if (!otherBosses.length) return null;

    const otherBossAverage = averageNumber(
      otherBosses
        .map((encounter) => firstNumber(encounter.percentile))
        .filter((value) => value !== null)
    );
    const otherBossMedian = averageNumber(
      otherBosses
        .map((encounter) => firstNumber(encounter.medianPercent))
        .filter((value) => value !== null)
    );
    const parts = [
      parseScorePart(`${difficultyShortName(difficulty)} other boss average`, otherBossAverage, 0.6, 1),
      parseScorePart(`${difficultyShortName(difficulty)} other boss median`, otherBossMedian, 0.4, 1),
    ];
    const available = parts.filter((part) => part.value !== null);
    if (!available.length) return null;

    const weightSum = available.reduce((sum, part) => sum + part.weight, 0);
    const rawPoints = weightSum
      ? available.reduce((sum, part) => sum + part.value * part.weight, 0) / weightSum
      : 0;

    return {
      difficulty,
      parts,
      available,
      rawPoints,
      multiplier: SAME_TIER_BOSS_FALLBACK_MULTIPLIER,
      points: clampScore(rawPoints * SAME_TIER_BOSS_FALLBACK_MULTIPLIER),
      source: "same-tier-fallback",
      label: `other ${difficultyShortName(difficulty)} bosses`,
      otherBossCount: otherBosses.length,
      hasEncounterData: false,
    };
  }

  function parseDifficultyMultiplier(difficulty, selectedDifficulty) {
    if (!difficulty || !selectedDifficulty) return 1;
    const delta = Number(difficulty) - Number(selectedDifficulty);
    if (delta > 0) return Math.min(1.25, 1 + (delta * 0.12));
    if (delta < 0) return Math.max(0.25, 1 + (delta * 0.45));
    return 1;
  }

  function parseDifficultySource(difficulty, selectedDifficulty) {
    if (Number(difficulty) > Number(selectedDifficulty)) return "higher";
    if (Number(difficulty) < Number(selectedDifficulty)) return "fallback";
    return "primary";
  }

  function parseScorePart(label, value, weight, multiplier) {
    const number = firstNumber(value);
    return {
      label,
      value: number === null ? null : clampScore(number),
      weight,
      multiplier,
    };
  }

  function killScore(applicant, target) {
    const profile = preferredKillProfileForTarget(applicant, target);
    const kills = Math.max(0, Math.round(Number(profile.kills) || 0));
    const scope = target && target.raidAverage ? "raid" : "boss";
    let basePoints = 0;
    let bucket = "0";
    if (kills >= 5) {
      basePoints = 100;
      bucket = "5+";
    } else if (kills >= 2) {
      basePoints = 75;
      bucket = "2-5";
    } else if (kills === 1) {
      basePoints = 45;
      bucket = "1";
    }
    const multiplier = firstNumber(
      profile && profile.multiplier,
      killDifficultyMultiplier(profile.difficulty, Number(target && target.difficulty) || null)
    ) || 0;
    const points = clampScore(basePoints * multiplier);
    const creditLabel = multiplier < 1 ? ` at ${formatCreditPercent(multiplier)}` : "";

    return {
      points,
      reasons: [`${profile.label} ${scope} kills: ${bucket}${creditLabel}`],
      warnings: [
        ...(kills === 0 ? [`no selected ${scope} kills`] : []),
        ...(multiplier < 1 && kills > 0 ? [`lower-difficulty ${scope} kills discounted`] : []),
      ],
      kills,
      bucket,
      difficulty: profile.difficulty,
      label: profile.label,
      scope: profile.scope || scope,
      multiplier,
      source: profile.source || "primary",
    };
  }

  function preferredKillProfileForTarget(applicant, target) {
    const selectedDifficulty = Number(target && target.difficulty) || null;
    const fallbackDifficulty = Number(target && target.fallbackDifficulty) || null;
    if (isBossTarget(target)) {
      const selectedKills = selectedDifficulty ? bossKillsForDifficulty(applicant, target, selectedDifficulty) : null;
      if (selectedKills !== null && selectedKills !== undefined && Number(selectedKills) > 0) {
        return {
          difficulty: selectedDifficulty,
          label: difficultyShortName(selectedDifficulty),
          kills: selectedKills,
          source: "primary",
        };
      }

      const higherBossProfile = higherDifficultyBossKillProfile(applicant, target, selectedDifficulty);
      if (higherBossProfile) return higherBossProfile;

      const sameTierFallback = sameTierBossKillFallback(applicant, target, selectedDifficulty);
      if (sameTierFallback) return sameTierFallback;

      return {
        difficulty: selectedDifficulty,
        label: difficultyShortName(selectedDifficulty),
        kills: selectedKills,
        source: "none",
      };
    }

    const selectedKills = selectedDifficulty ? bossKillsForDifficulty(applicant, target, selectedDifficulty) : null;
    if (selectedKills !== null && selectedKills !== undefined && Number(selectedKills) > 0) {
      return {
        difficulty: selectedDifficulty,
        label: difficultyShortName(selectedDifficulty),
        kills: selectedKills,
      };
    }

    const fallbackKills = fallbackDifficulty ? bossKillsForDifficulty(applicant, target, fallbackDifficulty) : null;
    if (fallbackKills !== null && fallbackKills !== undefined && Number(fallbackKills) > 0) {
      return {
        difficulty: fallbackDifficulty,
        label: difficultyShortName(fallbackDifficulty),
        kills: fallbackKills,
      };
    }

    if (selectedKills !== null && selectedKills !== undefined) {
      return {
        difficulty: selectedDifficulty,
        label: difficultyShortName(selectedDifficulty),
        kills: selectedKills,
      };
    }

    return bossKillProfileForTarget(applicant, target);
  }

  function higherDifficultyBossKillProfile(applicant, target, selectedDifficulty) {
    const higherDifficulties = relevantScoringDifficultyColumns(target)
      .filter((difficulty) => Number(difficulty) > Number(selectedDifficulty));
    const candidates = higherDifficulties
      .map((difficulty) => ({
        difficulty,
        label: difficultyShortName(difficulty),
        kills: bossKillsForDifficulty(applicant, target, difficulty),
        source: "higher",
      }))
      .filter((candidate) => candidate.kills !== null && candidate.kills !== undefined && Number(candidate.kills) > 0)
      .sort((left, right) => {
        if ((right.kills || 0) !== (left.kills || 0)) return (right.kills || 0) - (left.kills || 0);
        return Number(right.difficulty) - Number(left.difficulty);
      });
    return candidates[0] || null;
  }

  function sameTierBossKillFallback(applicant, target, difficulty) {
    const otherBosses = otherEncounterRanksForDifficulty(applicant, difficulty, target)
      .filter((encounter) => Number(encounter.kills) > 0);
    if (!otherBosses.length) return null;
    return {
      difficulty,
      label: `other ${difficultyShortName(difficulty)} bosses`,
      kills: otherBosses.length,
      multiplier: SAME_TIER_BOSS_FALLBACK_MULTIPLIER,
      source: "same-tier-fallback",
      scope: "other boss",
      otherBossCount: otherBosses.length,
    };
  }

  function killDifficultyMultiplier(difficulty, selectedDifficulty) {
    if (!difficulty || !selectedDifficulty) return 1;
    const delta = Number(difficulty) - Number(selectedDifficulty);
    if (delta >= 0) return 1;
    if (delta === -1) return 0.35;
    return 0.15;
  }

  function bossKillProfileForTarget(applicant, target) {
    const selectedDifficulty = Number(target && target.difficulty) || null;
    const fallbackDifficulty = Number(target && target.fallbackDifficulty) || null;
    const candidates = relevantScoringDifficultyColumns(target)
      .map((difficulty) => ({
        difficulty,
        label: difficultyShortName(difficulty),
        kills: bossKillsForDifficulty(applicant, target, difficulty),
        priority: selectedDifficulty && difficulty >= selectedDifficulty ? 1 : 0,
      }))
      .filter((candidate) => candidate.kills !== null && candidate.kills !== undefined);

    if (!candidates.length) {
      return {
        difficulty: selectedDifficulty,
        label: difficultyShortName(selectedDifficulty),
        kills: applicant.primaryKills,
      };
    }

    candidates.sort((left, right) => {
      const leftHasKills = (left.kills || 0) > 0;
      const rightHasKills = (right.kills || 0) > 0;
      if (rightHasKills !== leftHasKills) return Number(rightHasKills) - Number(leftHasKills);
      if (right.priority !== left.priority) return right.priority - left.priority;
      if ((right.kills || 0) !== (left.kills || 0)) return (right.kills || 0) - (left.kills || 0);
      if (right.difficulty !== left.difficulty) return right.difficulty - left.difficulty;
      return Number(right.difficulty === fallbackDifficulty) - Number(left.difficulty === fallbackDifficulty);
    });

    return candidates[0];
  }

  function mythicPlusStats(applicant, target) {
    const range = mythicPlusRangeById(target && target.mythicPlusRange);
    const rating = firstNumber(applicant && applicant.raiderIoScore);
    const ranges = normalizeRaiderIoKeyRanges(applicant && applicant.raiderIoKeyRanges);
    const runSummary = raiderIoRunSummary(applicant);
    const bestTimedLevel = firstNumber(applicant && applicant.raiderIoBestTimedLevel, runSummary.maxTimedLevel);
    const selectedRangeSummary = runSummary.ranges[range.id] || emptyRaiderIoRunSummary().ranges[range.id];
    const rangeCount = Math.max(numberOrZero(ranges[range.id]), numberOrZero(selectedRangeSummary.count));
    const atOrAboveCount = MYTHIC_PLUS_RANGES
      .filter((candidate) => candidate.min >= range.min)
      .reduce((sum, candidate) => {
        const summary = runSummary.ranges[candidate.id] || {};
        return sum + Math.max(numberOrZero(ranges[candidate.id]), numberOrZero(summary.count));
      }, 0);
    const timedRunCount = Math.max(
      numberOrZero(runSummary.timedRunCount),
      Object.values(ranges).reduce((sum, value) => sum + numberOrZero(value), 0)
    );

    return {
      range,
      rating,
      ranges,
      rangeCount,
      atOrAboveCount,
      timedRunCount,
      averageTimedLevel: firstNumber(runSummary.averageTimedLevel),
      medianTimedLevel: firstNumber(runSummary.medianTimedLevel),
      bestTimedLevel,
      runSummary,
      selectedRangeSummary,
    };
  }

  function weightedAverageAvailable(entries) {
    const usable = (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry && entry.value !== null && entry.value !== undefined)
      .map((entry) => ({
        value: Number(entry.value),
        weight: Number(entry.weight) || 0,
      }))
      .filter((entry) => Number.isFinite(entry.value) && Number.isFinite(entry.weight) && entry.weight > 0);
    if (!usable.length) return null;
    const totalWeight = usable.reduce((sum, entry) => sum + entry.weight, 0);
    if (!totalWeight) return null;
    return usable.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / totalWeight;
  }

  function mythicPlusLevelScore(level, range) {
    const number = Number(level);
    if (!Number.isFinite(number) || !range) return null;
    const lowerBound = range.min;
    const upperBound = range.max === null ? range.min + 2 : range.max;
    if (number >= upperBound) return 100;
    if (number >= lowerBound) {
      const span = Math.max(1, upperBound - lowerBound);
      return 70 + (((number - lowerBound) / span) * 30);
    }
    return clampScore((number / lowerBound) * 70);
  }

  function raiderIoScore(applicant, target) {
    const stats = mythicPlusStats(applicant, target);
    const {
      range,
      rating,
      rangeCount,
      atOrAboveCount,
      timedRunCount,
      averageTimedLevel,
      medianTimedLevel,
      bestTimedLevel,
    } = stats;

    if (rating === null && bestTimedLevel === null && !rangeCount && !atOrAboveCount && !timedRunCount) {
      return {
        points: 0,
        reasons: [`no Raider.IO ${range.shortLabel} data`],
        warnings: [`no Raider.IO ${range.shortLabel} data`],
        ...stats,
        components: {
          ratingPoints: 0,
          consistencyPoints: 0,
          peakPoints: 0,
          volumePoints: 0,
        },
      };
    }

    const ratingPoints = rating === null ? null : clampScore((rating / (range.targetScore + 150)) * 100);
    const consistencyLevel = weightedAverageAvailable([
      { value: averageTimedLevel, weight: 0.55 },
      { value: medianTimedLevel, weight: 0.45 },
    ]);
    const consistencyPoints = mythicPlusLevelScore(consistencyLevel, range);
    const peakPoints = mythicPlusLevelScore(bestTimedLevel, range);
    const volumePoints = timedRunCount
      ? clampScore((Math.min(Math.max(atOrAboveCount, rangeCount), range.targetRuns) / range.targetRuns) * 100)
      : null;
    const points = weightedAverageAvailable([
      { value: ratingPoints, weight: 0.45 },
      { value: consistencyPoints, weight: 0.25 },
      { value: peakPoints, weight: 0.20 },
      { value: volumePoints, weight: 0.10 },
    ]);
    const reasons = [];
    if (rating !== null) reasons.push(`Raider.IO ${Math.round(rating)} for ${range.shortLabel}`);
    if (rangeCount) reasons.push(`${rangeCount} timed ${range.shortLabel} key${rangeCount === 1 ? "" : "s"}`);
    if (atOrAboveCount && atOrAboveCount !== rangeCount) reasons.push(`${atOrAboveCount} timed key${atOrAboveCount === 1 ? "" : "s"} at or above ${range.shortLabel}`);
    if (averageTimedLevel !== null || medianTimedLevel !== null) {
      const averageLabel = averageTimedLevel === null ? "-" : formatKeyLevel(averageTimedLevel);
      const medianLabel = medianTimedLevel === null ? "-" : formatKeyLevel(medianTimedLevel);
      reasons.push(`timed keys avg ${averageLabel}, median ${medianLabel}`);
    }
    if (bestTimedLevel !== null) reasons.push(`best timed ${formatKeyLevel(bestTimedLevel)}`);

    return {
      points: points === null ? 0 : points,
      reasons: reasons.length ? reasons : [`Raider.IO ${range.shortLabel} activity found`],
      warnings: [],
      ...stats,
      components: {
        ratingPoints: ratingPoints === null ? 0 : ratingPoints,
        consistencyPoints: consistencyPoints === null ? 0 : consistencyPoints,
        peakPoints: peakPoints === null ? 0 : peakPoints,
        volumePoints: volumePoints === null ? 0 : volumePoints,
      },
    };
  }

  function normalizeRaiderIoKeyRanges(value) {
    const source = value && typeof value === "object" ? value : {};
    return MYTHIC_PLUS_RANGES.reduce((ranges, range) => {
      ranges[range.id] = Math.max(0, Math.round(firstNumber(source[range.id]) || 0));
      return ranges;
    }, {});
  }

  function emptyRaiderIoRunSummary() {
    return {
      timedRunCount: 0,
      averageTimedLevel: null,
      medianTimedLevel: null,
      maxTimedLevel: null,
      ranges: MYTHIC_PLUS_RANGES.reduce((summary, range) => {
        summary[range.id] = {
          count: 0,
          averageLevel: null,
          medianLevel: null,
          maxLevel: null,
        };
        return summary;
      }, {}),
    };
  }

  function normalizeRaiderIoRunSummary(value, fallback = {}) {
    const fallbackSummary = buildFallbackRaiderIoRunSummary(fallback.ranges, fallback.bestTimedLevel);
    const source = value && typeof value === "object" ? value : null;
    if (!source) return fallbackSummary;

    const summary = emptyRaiderIoRunSummary();
    summary.timedRunCount = Math.max(0, Math.round(firstNumber(source.timedRunCount) || 0));
    summary.averageTimedLevel = firstNumber(source.averageTimedLevel);
    summary.medianTimedLevel = firstNumber(source.medianTimedLevel);
    summary.maxTimedLevel = firstNumber(source.maxTimedLevel);

    const sourceRanges = source.ranges && typeof source.ranges === "object" ? source.ranges : {};
    for (const range of MYTHIC_PLUS_RANGES) {
      const entry = sourceRanges[range.id] && typeof sourceRanges[range.id] === "object" ? sourceRanges[range.id] : {};
      summary.ranges[range.id] = {
        count: Math.max(0, Math.round(firstNumber(entry.count) || 0)),
        averageLevel: firstNumber(entry.averageLevel),
        medianLevel: firstNumber(entry.medianLevel),
        maxLevel: firstNumber(entry.maxLevel),
      };
    }

    if (!summary.timedRunCount && fallbackSummary.timedRunCount) summary.timedRunCount = fallbackSummary.timedRunCount;
    summary.averageTimedLevel = firstNumber(summary.averageTimedLevel, fallbackSummary.averageTimedLevel);
    summary.medianTimedLevel = firstNumber(summary.medianTimedLevel, fallbackSummary.medianTimedLevel);
    summary.maxTimedLevel = firstNumber(summary.maxTimedLevel, fallbackSummary.maxTimedLevel);
    for (const range of MYTHIC_PLUS_RANGES) {
      const key = range.id;
      summary.ranges[key].count = Math.max(summary.ranges[key].count, fallbackSummary.ranges[key].count);
      summary.ranges[key].averageLevel = firstNumber(summary.ranges[key].averageLevel, fallbackSummary.ranges[key].averageLevel);
      summary.ranges[key].medianLevel = firstNumber(summary.ranges[key].medianLevel, fallbackSummary.ranges[key].medianLevel);
      summary.ranges[key].maxLevel = firstNumber(summary.ranges[key].maxLevel, fallbackSummary.ranges[key].maxLevel);
    }
    return summary;
  }

  function buildFallbackRaiderIoRunSummary(rangesValue, bestTimedLevel) {
    const ranges = normalizeRaiderIoKeyRanges(rangesValue);
    const levels = [];
    const summary = emptyRaiderIoRunSummary();
    let resolvedBestLevel = firstNumber(bestTimedLevel);

    for (const range of MYTHIC_PLUS_RANGES) {
      const count = numberOrZero(ranges[range.id]);
      const bucketLevels = [];
      for (let index = 0; index < count; index += 1) {
        const level = approximateRaiderIoLevelForRange(range, resolvedBestLevel);
        bucketLevels.push(level);
        levels.push(level);
        resolvedBestLevel = firstNumber(resolvedBestLevel, level);
      }
      const bucketSummary = summarizeKeyLevels(bucketLevels, firstNumber(resolvedBestLevel, range.max, range.min));
      summary.ranges[range.id] = {
        count,
        averageLevel: bucketSummary.averageLevel,
        medianLevel: bucketSummary.medianLevel,
        maxLevel: bucketSummary.maxLevel,
      };
    }

    const allSummary = summarizeKeyLevels(levels, resolvedBestLevel);
    summary.timedRunCount = levels.length;
    summary.averageTimedLevel = allSummary.averageLevel;
    summary.medianTimedLevel = allSummary.medianLevel;
    summary.maxTimedLevel = firstNumber(resolvedBestLevel, allSummary.maxLevel);
    return summary;
  }

  function summarizeKeyLevels(levels, bestTimedLevel) {
    const numbers = (Array.isArray(levels) ? levels : [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((left, right) => left - right);
    if (!numbers.length) {
      return {
        averageLevel: null,
        medianLevel: null,
        maxLevel: firstNumber(bestTimedLevel),
      };
    }

    const averageLevel = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
    const middle = Math.floor(numbers.length / 2);
    const medianLevel = numbers.length % 2
      ? numbers[middle]
      : (numbers[middle - 1] + numbers[middle]) / 2;
    return {
      averageLevel,
      medianLevel,
      maxLevel: firstNumber(bestTimedLevel, numbers[numbers.length - 1]),
    };
  }

  function approximateRaiderIoLevelForRange(range, bestTimedLevel) {
    if (!range) return null;
    if (range.max === null) {
      return Math.max(range.min, firstNumber(bestTimedLevel, range.min + 1) || range.min);
    }
    return (range.min + range.max) / 2;
  }

  function raiderIoRunSummary(applicant) {
    return normalizeRaiderIoRunSummary(
      applicant && applicant.raiderIoRunSummary,
      {
        ranges: applicant && applicant.raiderIoKeyRanges,
        bestTimedLevel: applicant && applicant.raiderIoBestTimedLevel,
      }
    );
  }

  function buffScore(applicant, currentBuffs) {
    const provided = buffsFor(applicant);
    const missing = provided.filter((buff) => (currentBuffs.get(buff.id) || 0) < desiredBuffCount(buff));
    const missedPoints = missing.reduce((sum, buff) => sum + buff.weight, 0);
    const points = (missedPoints / maxSingleApplicantBuffWeight()) * 100;
    const reasons = missing.length
      ? [`buffs: ${missing.map((buff) => buff.name).join(", ")}`]
      : ["buffs: none needed"];
    return { points: clampScore(points), reasons, provided, missing };
  }

  function buffsFor(person) {
    return data.buffs.filter((buff) => buff.providers.some((provider) => {
      const classMatches = sameText(provider.className, person.className);
      const specMatches = !provider.specName || sameText(provider.specName, person.specName);
      return classMatches && specMatches;
    }));
  }

  function maxSingleApplicantBuffWeight() {
    const providers = new Map();
    for (const buff of data.buffs) {
      for (const provider of buff.providers || []) {
        const key = `${provider.className || ""}|${provider.specName || ""}`;
        providers.set(key, (providers.get(key) || 0) + (buff.weight || 0));
      }
    }

    return Math.max(1, ...providers.values());
  }

  function clampScore(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(100, number));
  }

  function desiredBuffCount(buff) {
    const count = Number(buff && buff.desiredCount);
    return Number.isFinite(count) && count > 0 ? Math.round(count) : 1;
  }

  function coveredBuffs(people) {
    const covered = new Map();
    for (const person of people) {
      for (const buff of buffsFor(person)) {
        covered.set(buff.id, (covered.get(buff.id) || 0) + 1);
      }
    }
    return covered;
  }

  function missingBuffs(people) {
    const covered = coveredBuffs(people);
    return data.buffs.filter((buff) => (covered.get(buff.id) || 0) < desiredBuffCount(buff));
  }

  function countRoles(people) {
    return people.reduce((counts, person) => {
      counts[person.role] = (counts[person.role] || 0) + 1;
      return counts;
    }, { Tank: 0, Healer: 0, DPS: 0 });
  }

  function addRoleCounts(left, right) {
    return {
      Tank: (left.Tank || 0) + (right.Tank || 0),
      Healer: (left.Healer || 0) + (right.Healer || 0),
      DPS: (left.DPS || 0) + (right.DPS || 0),
    };
  }

  function rolesWithOpenSlots(targetRoles, counts) {
    return Object.keys(targetRoles).filter((role) => (counts[role] || 0) < targetRoles[role]);
  }

  function currentTotal(roster, selected) {
    return roster.length + selected.length;
  }

  function sumRoles(roles) {
    return Object.values(roles).reduce((sum, count) => sum + count, 0);
  }

  function roleCountLine(counts) {
    return `${counts.Tank || 0}-${counts.Healer || 0}-${counts.DPS || 0}`;
  }

  function render(analysis) {
    updateApplicantDecisionUi();
    updateFetchState(analysis);
    renderRecommendations(analysis);
    renderComposition(analysis);
    renderBuffs(analysis);
    renderScores(analysis);
    renderRosterStats(analysis);
  }

  function analysisTargetMatchesCurrentUi(analysis) {
    if (!analysis || !analysis.target) return true;
    return raidLogTargetKey(analysis.target) === raidLogTargetKey(readTarget());
  }

  function pendingTargetRefresh(analysis) {
    return Boolean(state.isFetchingLogs && analysis && !analysisTargetMatchesCurrentUi(analysis));
  }

  function updateFetchState(analysis = state.latestAnalysis) {
    if (!elements.fetchState) return;

    const currentTarget = readTarget();
    const currentLabel = describeRaidLogTarget(currentTarget) || "current target";
    const visibleLabel = analysis && analysis.target ? describeRaidLogTarget(analysis.target) : "";
    let mode = "idle";
    let text = "Ready";
    let title = state.logFetchMessage || text;

    if (pendingTargetRefresh(analysis)) {
      mode = "queued";
      text = `Queued ${currentLabel}`;
      title = `Refreshing ${currentLabel}. Current cards are still for ${visibleLabel || "the previous target"} until the active fetch finishes.`;
    } else if (state.isFetchingLogs) {
      mode = "fetching";
      text = `Fetching ${currentLabel}`;
      title = state.logFetchMessage || `Fetching logs for ${currentLabel}.`;
    } else if (visibleLabel) {
      mode = "ready";
      text = `Showing ${visibleLabel}`;
      title = `Scores shown for ${visibleLabel}.`;
    }

    elements.fetchState.textContent = text;
    elements.fetchState.className = `small-stat fetch-state is-${mode}`;
    elements.fetchState.title = title;
  }

  function populateInviteClassFilter() {
    if (!elements.inviteFilterClass) return;

    for (const className of CLASS_OPTIONS) {
      const option = document.createElement("option");
      option.value = className;
      option.textContent = className;
      elements.inviteFilterClass.append(option);
    }
  }

  function populateWantedDpsClassFilter() {
    if (!elements.wantedDpsClassChips) return;

    elements.wantedDpsClassChips.innerHTML = "";
    for (const className of CLASS_OPTIONS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `class-chip-toggle ${classColorClass(className)}`;
      button.dataset.wantedDpsClass = className;
      button.setAttribute("aria-pressed", "false");
      button.textContent = className;
      elements.wantedDpsClassChips.append(button);
    }

    syncWantedDpsClassChipsUi();
  }

  function filteredApplicantScores(analysis) {
    const scores = analysis.allScores || [];
    const search = String(elements.inviteFilterSearch && elements.inviteFilterSearch.value || "").trim().toLowerCase();
    const lens = activeRoleLens();
    const role = ["Tank", "Healer", "DPS"].includes(lens)
      ? lens
      : String(elements.inviteFilterRole && elements.inviteFilterRole.value || "").trim();
    const className = String(elements.inviteFilterClass && elements.inviteFilterClass.value || "").trim();
    const minIlvl = parseItemLevel(elements.inviteFilterMinIlvl && elements.inviteFilterMinIlvl.value);
    const hideFilled = Boolean(elements.inviteFilterFilled && elements.inviteFilterFilled.checked);
    const neededOnly = lens === "needed";
    const wantedDpsClasses = selectedWantedDpsClasses();
    const applyWantedDpsClasses = wantedDpsClassFilterEnabled(lens) && wantedDpsClasses.size > 0;
    const openRoles = new Set(rolesWithOpenSlots(
      analysis.target.roles,
      analysis.currentRoleCounts || countRoles(analysis.roster)
    ));

    return scores.filter((score) => {
      const applicant = score.applicant;
      const matchesSearch = !search || [
        applicant.name,
        applicant.realm,
        applicant.specName,
        applicant.className,
        applicant.role,
        applicant.itemLevel,
      ].some((value) => String(value || "").toLowerCase().includes(search));

      const matchesRole = !role || applicant.role === role;
      const matchesClass = !className || applicant.className === className;
      const matchesWantedDpsClass = !applyWantedDpsClasses
        || applicant.role !== "DPS"
        || wantedDpsClasses.has(applicant.className);
      const matchesIlvl = minIlvl === null || (applicant.itemLevel !== null && applicant.itemLevel >= minIlvl);
      const matchesFilled = (!hideFilled && !neededOnly) || openRoles.has(applicant.role);

      return matchesSearch && matchesRole && matchesClass && matchesWantedDpsClass && matchesIlvl && matchesFilled;
    });
  }

  function renderRecommendations(analysis) {
    elements.recommendationsList.innerHTML = "";

    const filteredScores = filteredApplicantScores(analysis);
    elements.selectionCount.textContent = `${filteredScores.length}/${analysis.allScores.length} shown`;
    if (pendingTargetRefresh(analysis)) {
      renderStickyBestCandidate([], analysis.target);
      const note = document.createElement("div");
      note.className = "sync-note";
      note.textContent = `Refreshing ${describeRaidLogTarget(readTarget())}. Scores below are still for ${describeRaidLogTarget(analysis.target)} until the new fetch finishes.`;
      elements.recommendationsList.append(note);
    } else {
      renderStickyBestCandidate(filteredScores, analysis.target);
    }

    if (!filteredScores.length) {
      elements.recommendationsList.append(emptyState("No matching applicants"));
      return;
    }

    for (const score of filteredScores) {
      const logsUrl = warcraftLogsUrl(score.applicant);
      const applicantClass = classColorClass(score.applicant.className);
      const declineKey = applicantKey(score.applicant);
      const loadingScore = ["pending", "fetching"].includes(score.applicant.logStatus);
      const scoreBadgeMarkup = loadingScore
        ? '<div class="score-badge loading">Loading...</div>'
        : scoreBadge(score, analysis.target);
      const isNewApplicant = score.applicant.source === "applicant" && state.newApplicantKeys.has(applicantKey(score.applicant));
      const newBadge = isNewApplicant ? '<span class="new-badge">New!</span>' : "";
      const row = document.createElement("article");
      row.className = `recommendation-card ${applicantClass}`;
      row.innerHTML = `
        <div class="rank" title="Overall score rank"><span>Rank</span><strong>${score.rank}</strong></div>
        <div class="candidate-main">
          <div class="candidate-line">
            <a class="logs-link class-text ${applicantClass}" href="${escapeAttribute(logsUrl)}" target="_blank" rel="noopener noreferrer" title="Open Warcraft Logs">
              <strong>${escapeHtml(score.applicant.name)}</strong>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14zM5 5h6v2H7v10h10v-4h2v6H5z"/></svg>
            </a>
            <span>${escapeHtml(score.applicant.realm)}-${escapeHtml(score.applicant.region)}</span>
            <span class="ilvl-chip ${score.applicant.itemLevel === null ? "is-empty" : ""}"><strong>ilvl</strong>${formatIlvl(score.applicant.itemLevel)}</span>
            ${newBadge}
            <button class="accept-button" type="button" data-accept-key="${escapeAttribute(declineKey)}" data-accept-name="${escapeAttribute(score.applicant.name)}" title="Add this applicant to the shared roster planner">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
              Accept
            </button>
            <button class="decline-button" type="button" data-decline-key="${escapeAttribute(declineKey)}" data-decline-name="${escapeAttribute(score.applicant.name)}" title="Hide this applicant for everyone viewing this server">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.41L10.59 13.41 4.29 19.71 2.88 18.3 9.17 12 2.88 5.71 4.29 4.29l6.3 6.3 6.29-6.3z"/></svg>
              Decline
            </button>
          </div>
          <div class="candidate-meta"><span class="class-text ${applicantClass}">${escapeHtml(score.applicant.specName)} ${escapeHtml(score.applicant.className)}</span> - ${escapeHtml(score.applicant.role)}</div>
          ${perfStrip(score, analysis.target)}
          ${analysis.target.scoreMode === SCORE_MODE_MPLUS ? "" : progressionStrip(score.applicant, analysis.target)}
          ${applicationNoteBlock(score.applicant)}
          <div class="reason-list">${displayReasons(score).slice(0, 4).map(reasonChip).join("")}</div>
        </div>
        ${scoreBadgeMarkup}
      `;
      elements.recommendationsList.append(row);
    }
  }

  function renderStickyBestCandidate(filteredScores, target) {
    if (!elements.stickyBestApplicant) return;

    const score = filteredScores && filteredScores[0];
    if (!score || !score.applicant) {
      elements.stickyBestApplicant.dataset.hasCandidate = "false";
      elements.stickyBestApplicant.dataset.applicantKey = "";
      elements.stickyBestApplicant.hidden = true;
      elements.stickyBestApplicant.innerHTML = "";
      return;
    }

    const applicant = score.applicant;
    const key = applicantKey(applicant);
    const applicantClass = classColorClass(applicant.className);
    const logsUrl = warcraftLogsUrl(applicant);
    const reason = displayReasons(score)[0] || "";
    const stale = staleRaidLogData(applicant, target);
    const scoreTitle = stale
      ? `Fetched for ${applicant.logTargetLabel || "another raid target"}; current target is ${describeRaidLogTarget(target) || "different target"}. Re-fetch logs for this fight.`
      : scoreBreakdownTitle(score);
    const scoreLabel = stale ? "Stale" : formatWeightedMetricScore(score.total, 1);
    const scoreClassName = stale ? "parse-none" : scoreClass(score.total);

    elements.stickyBestApplicant.dataset.hasCandidate = "true";
    elements.stickyBestApplicant.dataset.applicantKey = key;
    elements.stickyBestApplicant.innerHTML = `
      <div class="sticky-best-main">
        <span class="sticky-best-rank">#${escapeHtml(score.rank)}</span>
        <a class="logs-link compact class-text ${applicantClass}" href="${escapeAttribute(logsUrl)}" target="_blank" rel="noopener noreferrer" title="Open Warcraft Logs">
          <strong>${escapeHtml(applicant.name)}</strong>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14zM5 5h6v2H7v10h10v-4h2v6H5z"/></svg>
        </a>
        <span class="sticky-best-score ${scoreClassName}" title="${escapeAttribute(scoreTitle)}">${escapeHtml(scoreLabel)}</span>
        <span class="sticky-best-meta">${escapeHtml([applicant.specName, applicant.className, applicant.role].filter(Boolean).join(" "))}</span>
        ${reason ? `<span class="sticky-best-reason">${escapeHtml(reason)}</span>` : ""}
      </div>
      <div class="sticky-best-actions">
        <button class="accept-button" type="button" data-accept-key="${escapeAttribute(key)}" data-accept-name="${escapeAttribute(applicant.name)}" title="Add this applicant to the shared roster planner">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
          Accept
        </button>
        <button class="decline-button" type="button" data-decline-key="${escapeAttribute(key)}" data-decline-name="${escapeAttribute(applicant.name)}" title="Hide this applicant for everyone viewing this server">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.41L10.59 13.41 4.29 19.71 2.88 18.3 9.17 12 2.88 5.71 4.29 4.29l6.3 6.3 6.29-6.3z"/></svg>
          Decline
        </button>
        <button class="sticky-dismiss" type="button" data-sticky-best-dismiss title="Hide sticky candidate" aria-label="Hide sticky candidate">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.41L10.59 13.41 4.29 19.71 2.88 18.3 9.17 12 2.88 5.71 4.29 4.29l6.3 6.3 6.29-6.3z"/></svg>
        </button>
      </div>
    `;

    window.requestAnimationFrame(updateStickyBestVisibility);
  }

  function updateStickyBestVisibility() {
    if (!elements.stickyBestApplicant) return;
    if (elements.stickyBestApplicant.dataset.hasCandidate !== "true") {
      elements.stickyBestApplicant.hidden = true;
      return;
    }

    const key = elements.stickyBestApplicant.dataset.applicantKey || "";
    const firstCard = elements.recommendationsList && elements.recommendationsList.querySelector(".recommendation-card");
    if (!firstCard || key === state.stickyBestDismissedKey) {
      elements.stickyBestApplicant.hidden = true;
      return;
    }

    const listRect = elements.recommendationsList.getBoundingClientRect();
    const firstCardRect = firstCard.getBoundingClientRect();
    const shouldShow = firstCardRect.top < 0 && listRect.bottom > 88;
    elements.stickyBestApplicant.hidden = !shouldShow;
  }

  function displayReasons(score) {
    return score.reasons;
  }

  function scoreBadge(score, target) {
    if (!score || score.total === null || score.total === undefined) {
      return '<div class="score-badge parse-none">-</div>';
    }
    if (state.isFetchingLogs && raidLogTargetKey(target) !== raidLogTargetKey(readTarget())) {
      const title = `Refreshing ${describeRaidLogTarget(readTarget())}. This score still belongs to ${describeRaidLogTarget(target)}.`;
      return `<div class="score-badge parse-none" title="${escapeAttribute(title)}">Queued</div>`;
    }
    const pending = pendingScoreState(score, target);
    if (pending) {
      return `<div class="score-badge parse-none" title="${escapeAttribute(pending.title)}">${escapeHtml(pending.label)}</div>`;
    }
    if (score.applicant && staleRaidLogData(score.applicant, target)) {
      const currentTarget = describeRaidLogTarget(target);
      const sourceTarget = score.applicant.logTargetLabel || "another raid target";
      const title = `Fetched for ${sourceTarget}; current target is ${currentTarget || "different target"}. Re-fetch logs for this fight.`;
      return `<div class="score-badge parse-none" title="${escapeAttribute(title)}">Stale</div>`;
    }
    return `<div class="score-badge ${scoreClass(score.total)}" title="${escapeAttribute(scoreBreakdownTitle(score))}">${score.total}</div>`;
  }

  function scoreBreakdownTitle(score) {
    const contributions = score.contributions || {};
    if (score.applicant && score.raiderIo && score.weights && score.weights.raiderIo === 1 && score.weights.parse === 0) {
      return [
        `Overall ${formatWeightedMetricScore(score.total, 1)}`,
        `${raiderIoMetricLabel(score.raiderIo.range)} ${formatWeightedMetricScore(contributions.raiderIo, score.weights.raiderIo)} (${formatMetricScore(score.raiderIo.points)} raw)`,
      ].filter(Boolean).join(" - ");
    }

    return [
      `Overall ${formatWeightedMetricScore(score.total, 1)}`,
      score.parse ? `Parse ${formatWeightedMetricScore(contributions.parse, score.weights && score.weights.parse)} (${formatMetricScore(score.parse.points)} raw)` : "",
      score.kills ? `Kill Score ${formatWeightedMetricScore(contributions.kills, score.weights && score.weights.kills)} (${score.kills.kills || 0} kills, ${formatMetricScore(score.kills.points)} raw)` : "",
      score.raiderIo ? `${raiderIoMetricLabel(score.raiderIo.range)} ${formatWeightedMetricScore(contributions.raiderIo, score.weights && score.weights.raiderIo)} (${formatMetricScore(score.raiderIo.points)} raw)` : "",
      score.buffs ? `Buff ${formatWeightedMetricScore(contributions.buffs, score.weights && score.weights.buffs)} (${formatMetricScore(score.buffs.points)} raw)` : "",
      score.preference && score.preference.points ? `Wanted class fit ${formatWeightedMetricScore(contributions.preference, 1)}` : "",
    ].filter(Boolean).join(" - ");
  }

  function pendingScoreState(score, target) {
    const applicant = score && score.applicant;
    if (!state.isFetchingLogs || !applicant) return null;
    if (applicant.logStatus === "fetching") {
      return {
        label: "Fetching",
        title: `Fetching live logs for ${describeRaidLogTarget(target) || "the current target"}. Old manual values are hidden until this row finishes.`,
      };
    }
    if (applicant.logStatus === "pending") {
      return {
        label: "Queued",
        title: `Waiting to fetch live logs for ${describeRaidLogTarget(target) || "the current target"}. Old manual values are hidden until this row starts.`,
      };
    }
    return null;
  }

  function averageScoreLabel(scores, target) {
    const values = (scores || [])
      .filter((score) => !(score && score.applicant && staleRaidLogData(score.applicant, target)))
      .map((score) => score && score.total)
      .filter((value) => Number.isFinite(Number(value)));
    if (!values.length) return "-";

    const average = values.reduce((sum, value) => sum + Number(value), 0) / values.length;
    return Math.round(average * 10) / 10;
  }

  function renderComposition(analysis) {
    const roles = ["Tank", "Healer", "DPS"];
    elements.roleMeters.innerHTML = "";
    elements.raidVisual.innerHTML = "";

    if (state.wantedDpsSlotPickerIndex !== null && state.wantedDpsSlotPickerIndex >= currentOpenDpsSlotCount()) {
      state.wantedDpsSlotPickerIndex = null;
    }
    syncWantedDpsClassChipsUi();

    const target = analysis.target.roles;
    const currentCounts = analysis.currentRoleCounts || countRoles(analysis.roster);
    const dpsBreakdown = countMeleeRanged(analysis.roster);
    const averageScore = averageScoreLabel(analysis.rosterScores, analysis.target);
    const averageScoreMarkup = parseCell(averageScore, { average: true });
    elements.compLabel.textContent = `Target ${target.Tank}-${target.Healer}-${target.DPS}`;

    const summary = document.createElement("div");
    summary.className = "composition-summary";
    summary.innerHTML = `
      <span><strong>Current</strong>${roleCountLine(currentCounts)}</span>
      <span><strong>DPS Split</strong>${dpsBreakdown.melee} melee / ${dpsBreakdown.ranged} ranged${dpsBreakdown.unknown ? ` / ${dpsBreakdown.unknown} unk` : ""}</span>
      <span><strong>Avg Rating</strong>${averageScoreMarkup}</span>
    `;
    elements.roleMeters.append(summary);

    const wantedDpsCounts = wantedDpsSlotClassCounts(currentOpenDpsSlotCountFor(target, currentCounts));
    for (const role of roles) {
      const current = currentCounts[role] || 0;
      const wanted = target[role] || 0;
      const ratio = wanted ? Math.min(100, Math.round((current / wanted) * 100)) : 100;

      const meter = document.createElement("div");
      meter.className = "role-meter";
      meter.innerHTML = `
        <div class="meter-label">
          <span>${role}</span>
          <span><strong>${current}/${wanted}</strong><small>${Math.max(0, wanted - current)} open</small></span>
        </div>
        <div class="meter-track"><span style="width:${ratio}%"></span></div>
      `;
      elements.roleMeters.append(meter);
    }

    const groupedPeople = groupRaidVisualPeople(analysis);
    for (const role of roles) {
      const section = document.createElement("section");
      section.className = `raid-role-section ${roleClass(role)}`;

      const header = document.createElement("div");
      header.className = "raid-role-header";
      const wantedClassSummary = role === "DPS" ? summarizeWantedDpsCounts(wantedDpsCounts) : "";
      header.innerHTML = `
        <span>${role}</span>
        <small>${groupedPeople[role].length}/${target[role] || 0}${wantedClassSummary ? ` · ${escapeHtml(wantedClassSummary)}` : ""}</small>
      `;
      section.append(header);

      const grid = document.createElement("div");
      grid.className = `raid-role-grid ${roleClass(role)}`;

      const slots = groupedPeople[role];
      const totalSlots = target[role] || 0;
      for (let index = 0; index < totalSlots; index += 1) {
        const entry = slots[index];
        const person = entry && entry.person;
        const personClass = person ? classColorClass(person.className) : "";
        const emptySlotIndex = Math.max(0, index - slots.length);
        const assignedClass = role === "DPS" ? normalizeWantedDpsClass(state.wantedDpsSlotAssignments[emptySlotIndex]) : "";
        const assignedClassColor = assignedClass ? classColorClass(assignedClass) : "";
        const openPicker = role === "DPS" && !person && state.wantedDpsSlotPickerIndex === emptySlotIndex;
        const slot = document.createElement(person ? "a" : role === "DPS" ? "button" : "div");
        slot.className = person
          ? `raid-slot ${roleClass(person.role)} ${personClass} current`
          : `raid-slot ${roleClass(role)} empty${assignedClass ? ` targeted ${assignedClassColor}` : ""}${openPicker ? " is-editing" : ""}`;

        if (person) {
          const specLabel = person.specName ? `${person.specName} ` : "";
          slot.href = warcraftLogsUrl(person);
          slot.target = "_blank";
          slot.rel = "noopener noreferrer";
          slot.title = `Open Warcraft Logs: ${person.name} - ${specLabel}${person.className} (${person.role})`;
          slot.innerHTML = `
            <span class="raid-slot-name class-text ${personClass}">${escapeHtml(person.name)}</span>
            <span class="raid-slot-meta">${escapeHtml(specLabel + person.className)}</span>
          `;
        } else {
          if (role === "DPS") {
            slot.type = "button";
            slot.dataset.openDpsSlotIndex = String(emptySlotIndex);
            slot.title = assignedClass
              ? `Wanted DPS slot: ${assignedClass}. Click to change.`
              : "Open DPS slot. Click to set a wanted DPS class.";
            slot.innerHTML = `
              <span class="raid-slot-name${assignedClass ? ` class-text ${assignedClassColor}` : ""}">${escapeHtml(assignedClass || "Open")}</span>
              <span class="raid-slot-meta">${escapeHtml(assignedClass ? "Wanted DPS" : role)}</span>
              ${openPicker ? renderWantedDpsSlotPicker(emptySlotIndex, assignedClass) : ""}
            `;
          } else {
            slot.title = `Open ${role} slot`;
            slot.innerHTML = `
              <span class="raid-slot-name">Open</span>
              <span class="raid-slot-meta">${escapeHtml(role)}</span>
            `;
          }
        }

        grid.append(slot);
      }

      section.append(grid);
      elements.raidVisual.append(section);
    }
  }

  function renderWantedDpsSlotPicker(slotIndex, assignedClass) {
    const options = CLASS_OPTIONS.map((className) => `
      <button
        type="button"
        class="raid-slot-picker-option ${classColorClass(className)}${className === assignedClass ? " is-active" : ""}"
        data-set-wanted-dps-slot="${slotIndex}"
        data-wanted-dps-class="${escapeAttribute(className)}"
      >${escapeHtml(className)}</button>
    `).join("");

    return `
      <div class="raid-slot-picker" role="dialog" aria-label="Choose wanted DPS class">
        <div class="raid-slot-picker-title">Wanted DPS class</div>
        <div class="raid-slot-picker-grid">${options}</div>
        <div class="raid-slot-picker-actions">
          <button type="button" class="raid-slot-picker-clear" data-clear-wanted-dps-slot="${slotIndex}">${assignedClass ? "Clear slot" : "Close"}</button>
        </div>
      </div>
    `;
  }

  function summarizeWantedDpsCounts(counts) {
    const labels = Array.from(counts.entries())
      .filter(([, count]) => count > 0)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([className, count]) => `${count} ${className}`);

    if (!labels.length) return "";
    return labels.slice(0, 2).join(", ") + (labels.length > 2 ? ` +${labels.length - 2}` : "");
  }

  function renderBuffs(analysis) {
    elements.buffList.innerHTML = "";
    const covered = coveredBuffs(analysis.roster);
    const buffPeople = analysis.roster;
    const totalBuffSlots = data.buffs.reduce((sum, buff) => sum + desiredBuffCount(buff), 0);
    const coveredBuffSlots = data.buffs.reduce((sum, buff) => sum + Math.min(covered.get(buff.id) || 0, desiredBuffCount(buff)), 0);
    const missingCount = Math.max(0, totalBuffSlots - coveredBuffSlots);
    elements.coverageLabel.textContent = missingCount
      ? `${missingCount} needed - ${coveredBuffSlots}/${totalBuffSlots} covered`
      : `${coveredBuffSlots}/${totalBuffSlots} covered`;

    const sortedBuffs = [...data.buffs].sort((left, right) => {
      const leftCovered = (covered.get(left.id) || 0) >= desiredBuffCount(left);
      const rightCovered = (covered.get(right.id) || 0) >= desiredBuffCount(right);
      if (leftCovered !== rightCovered) return leftCovered ? 1 : -1;
      return (right.weight || 0) - (left.weight || 0);
    });

    for (const buff of sortedBuffs) {
      const item = document.createElement("div");
      const currentCount = covered.get(buff.id) || 0;
      const desiredCount = desiredBuffCount(buff);
      const isCovered = currentCount >= desiredCount;
      const countLabel = desiredCount > 1 ? `${Math.min(currentCount, desiredCount)}/${desiredCount}` : (isCovered ? "covered" : `+${buff.weight}`);
      const providers = buffPeople.filter((person) => buffsFor(person).some((personBuff) => personBuff.id === buff.id));
      const providerChips = providers.length
        ? providers.map(personProviderChip).join("")
        : buff.providers.map(providerClassChip).join("");
      item.className = isCovered ? "buff-item covered" : "buff-item missing";
      item.innerHTML = `
        <span class="buff-status"></span>
        <div class="buff-main">
          <div class="buff-title">
            <span>${escapeHtml(buff.name)}</span>
            <small>${escapeHtml(countLabel)}</small>
          </div>
          <div class="buff-providers">${providerChips}</div>
        </div>
      `;
      elements.buffList.append(item);
    }
  }

  function renderScores(analysis) {
    setScoreLabel(state.logFetchMessage || `${analysis.allScores.length} applicants`);
  }

  function handleRosterSortClick(event) {
    const button = event.target.closest("[data-roster-sort]");
    if (!button) return;

    const key = button.dataset.rosterSort;
    const current = state.rosterSort;
    state.rosterSort = {
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    };

    if (state.latestAnalysis) renderRosterStats(state.latestAnalysis);
  }

  function renderRosterStats(analysis) {
    elements.rosterStats.innerHTML = "";
    const rosterSummary = summarizeLogResults(analysis.roster, `${analysis.roster.length} members`);
    const shouldShowProgress = state.isFetchingLogs && !hasResolvedLogResults(analysis.roster);
    const ilvlSummary = averageIlvlLabel(analysis.roster);
    const perfColumns = performanceColumns(analysis.target);
    const gridTemplate = rosterGridTemplate(perfColumns.length);
    const progressHeaderLabel = analysis.target.scoreMode === SCORE_MODE_MPLUS ? "Timed" : "Progress";
    elements.rosterStatsLabel.textContent = shouldShowProgress
      ? (state.logFetchMessage || rosterSummary)
      : [rosterSummary, ilvlSummary].filter(Boolean).join(" - ");

    const header = document.createElement("div");
    header.className = "member-row member-header";
    header.style.gridTemplateColumns = gridTemplate;
    header.innerHTML = `
      <div>${rosterSortButton("name", "Member")}</div>
      <div>${rosterSortButton("score", "Score")}</div>
      <div>${rosterSortButton("role", "Role")}</div>
      <div>${rosterSortButton("itemLevel", "Ilvl")}</div>
      <div>${rosterSortButton("progress", progressHeaderLabel)}</div>
      ${perfColumns.map((column) => `<div title="${escapeAttribute(column.title)}">${rosterSortButton(column.sortKey, column.label)}</div>`).join("")}
      <div>${rosterSortButton("status", "Status")}</div>
    `;
    elements.rosterStats.append(header);

    const rosterIssues = renderRosterIssues(analysis.roster);
    if (rosterIssues) {
      elements.rosterStats.append(rosterIssues);
    }

    if (!analysis.roster.length) {
      elements.rosterStats.append(emptyState("No roster pasted"));
      return;
    }

    for (const member of sortedRosterMembers(analysis)) {
      const logsUrl = warcraftLogsUrl(member);
      const memberClass = classColorClass(member.className);
      const score = rosterScoreForMember(analysis, member);
      const row = document.createElement("div");
      row.className = `member-row ${memberClass}`;
      row.style.gridTemplateColumns = gridTemplate;
      row.innerHTML = `
        <div>
          <a class="logs-link compact class-text ${memberClass}" href="${escapeAttribute(logsUrl)}" target="_blank" rel="noopener noreferrer" title="Open Warcraft Logs">
            <strong>${escapeHtml(member.name)}</strong>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14zM5 5h6v2H7v10h10v-4h2v6H5z"/></svg>
          </a>
          <span class="class-text ${memberClass}">${escapeHtml(member.specName)} ${escapeHtml(member.className)}</span>
        </div>
        <div>${scoreBadge(score, analysis.target)}</div>
        <div>${escapeHtml(member.role)}</div>
        <div>${formatIlvl(member.itemLevel)}</div>
        <div>${analysis.target.scoreMode === SCORE_MODE_MPLUS ? mythicPlusTimedLabel(member, analysis.target) : progressionLabel(member, analysis.target)}</div>
        ${perfColumns.map((column) => `<div>${performanceColumnCell(member, analysis.target, column, { compact: true })}</div>`).join("")}
        <div>${rosterLogStatus(member, analysis.target)}</div>
      `;
      elements.rosterStats.append(row);
    }
  }

  function rosterGridTemplate(parseColumnCount) {
    return `minmax(170px, 1.3fr) 58px 76px 58px 88px repeat(${parseColumnCount}, 82px) minmax(86px, 0.7fr)`;
  }

  function rosterSortButton(key, label) {
    const isActive = state.rosterSort.key === key;
    const direction = isActive ? state.rosterSort.direction : "";
    const suffix = isActive ? `<span>${direction}</span>` : "";
    return `<button class="sort-button${isActive ? " is-active" : ""}" type="button" data-roster-sort="${escapeAttribute(key)}">${escapeHtml(label)}${suffix}</button>`;
  }

  function sortedRosterMembers(analysis) {
    const sort = state.rosterSort;
    return analysis.roster
      .map((member, index) => ({ member, index }))
      .sort((left, right) => {
        const comparison = compareRosterValues(
          rosterSortValue(left.member, sort.key, analysis),
          rosterSortValue(right.member, sort.key, analysis),
          sort.direction
        );
        if (comparison !== 0) return comparison;
        return left.index - right.index;
      })
      .map((entry) => entry.member);
  }

  function rosterSortValue(member, key, analysis) {
    if (key === "score") {
      const score = rosterScoreForMember(analysis, member);
      return score ? score.total : null;
    }
    if (key === "role") return member.role || "";
    if (key === "itemLevel") return member.itemLevel;
    if (key === "progress") {
      if (analysis.target && analysis.target.scoreMode === SCORE_MODE_MPLUS) {
        const stats = mythicPlusStats(member, analysis.target);
        return (numberOrZero(stats.bestTimedLevel) * 100) + numberOrZero(stats.atOrAboveCount);
      }
      return progressionSortValue(member, analysis.target);
    }
    if (key.startsWith("avg:")) return bestPerfForDifficulty(member, analysis.target, Number(key.slice(4)));
    if (key.startsWith("boss:")) return bossParseForDifficulty(member, analysis.target, Number(key.slice(5)));
    if (key.startsWith("mplus:")) return mythicPlusSortValue(member, analysis.target, key.slice(6));
    if (key === "mythicAvg") return bestPerfForDifficulty(member, analysis.target, 5);
    if (key === "heroicAvg") return bestPerfForDifficulty(member, analysis.target, 4);
    if (key === "target") return bossParseForDifficulty(member, analysis.target, analysis.target && analysis.target.difficulty);
    if (key === "fallback") return bossParseForDifficulty(member, analysis.target, analysis.target && analysis.target.fallbackDifficulty);
    if (key === "status") return logStatusSortValue(member, analysis.target);
    return `${member.name || ""} ${member.realm || ""}`;
  }

  function mythicPlusSortValue(member, target, metric) {
    const stats = mythicPlusStats(member, target);
    if (metric === "rating") return stats.rating;
    if (metric === "average") return stats.averageTimedLevel;
    if (metric === "median") return stats.medianTimedLevel;
    if (metric === "peak") return stats.bestTimedLevel;
    return null;
  }

  function compareRosterValues(left, right, direction) {
    const leftMissing = left === null || left === undefined || left === "";
    const rightMissing = right === null || right === undefined || right === "";
    if (leftMissing && rightMissing) return 0;
    if (leftMissing) return 1;
    if (rightMissing) return -1;

    const leftNumber = Number(left);
    const rightNumber = Number(right);
    const multiplier = direction === "asc" ? 1 : -1;
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return (leftNumber - rightNumber) * multiplier;
    }

    return String(left).localeCompare(String(right), undefined, {
      numeric: true,
      sensitivity: "base",
    }) * multiplier;
  }

  function logStatusSortValue(member, target) {
    if (staleRaidLogData(member, target)) return 3;
    const order = {
      live: 1,
      manual: 2,
      pending: 4,
      fetching: 5,
      "no-data": 6,
      error: 7,
    };
    return order[member.logStatus] || 8;
  }

  function specRangeType(person) {
    const className = String(person && person.className || "").trim();
    const specName = String(person && person.specName || "").trim();

    if (!className) return "unknown";

    const meleeSpecs = new Set([
      "Blood",
      "Frost",
      "Unholy",
      "Havoc",
      "Feral",
      "Survival",
      "Windwalker",
      "Retribution",
      "Assassination",
      "Outlaw",
      "Subtlety",
      "Enhancement",
      "Arms",
      "Fury",
    ]);

    const rangedSpecs = new Set([
      "Balance",
      "Devastation",
      "Augmentation",
      "Beast Mastery",
      "Marksmanship",
      "Arcane",
      "Fire",
      "Frost Mage",
      "Shadow",
      "Elemental",
      "Affliction",
      "Demonology",
      "Destruction",
    ]);

    if (className === "Mage") return "ranged";
    if (className === "Warlock") return "ranged";
    if (className === "Hunter") {
      return specName === "Survival" ? "melee" : "ranged";
    }
    if (className === "Evoker") {
      return specName === "Devastation" || specName === "Augmentation" ? "ranged" : "unknown";
    }
    if (className === "Druid") {
      if (specName === "Balance") return "ranged";
      if (specName === "Feral") return "melee";
    }
    if (className === "Shaman") {
      if (specName === "Elemental") return "ranged";
      if (specName === "Enhancement") return "melee";
    }
    if (className === "Priest" && specName === "Shadow") return "ranged";
    if (className === "Monk" && specName === "Windwalker") return "melee";
    if (className === "Paladin" && specName === "Retribution") return "melee";
    if (className === "Demon Hunter" && specName === "Havoc") return "melee";
    if (className === "Rogue") return "melee";
    if (className === "Warrior") return "melee";
    if (className === "Death Knight") return "melee";

    if (meleeSpecs.has(specName)) return "melee";
    if (rangedSpecs.has(specName)) return "ranged";

    return "unknown";
  }

  function countMeleeRanged(people) {
    return people.reduce((counts, person) => {
      if (person.role !== "DPS") return counts;

      const type = specRangeType(person);
      if (type === "melee") counts.melee += 1;
      else if (type === "ranged") counts.ranged += 1;
      else counts.unknown += 1;

      return counts;
    }, { melee: 0, ranged: 0, unknown: 0 });
  }

  function progressionSortValue(person, target) {
    return RAID_DIFFICULTIES.reduce((sum, difficulty) => {
      const progress = progressForDifficulty(person, difficulty, target);
      const killed = progress && Number(progress.killed);
      return sum + (Number.isFinite(killed) ? killed * Math.pow(100, difficulty - 2) : 0);
    }, 0);
  }

  function averageIlvlLabel(people) {
    const itemLevels = people
      .map((person) => person.itemLevel)
      .filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
    if (!itemLevels.length) return "";

    const averageItemLevel = itemLevels.reduce((sum, value) => sum + Number(value), 0) / itemLevels.length;
    return `${formatIlvl(averageItemLevel)} avg ilvl`;
  }

  function summarizeLogResults(people, fallbackLabel) {
    if (!people.length) return fallbackLabel;

    const fetched = people.filter((person) => person.logStatus === "live").length;
    const cached = people.filter((person) => person.cacheHit).length;
    const noData = people.filter((person) => person.logStatus === "no-data").length;
    const errors = people.filter((person) => person.logStatus === "error").length;
    const fetching = people.filter((person) => person.logStatus === "fetching").length;
    const queued = people.filter((person) => person.logStatus === "pending").length;

    if (!fetched && !cached && !noData && !errors && !fetching && !queued) {
      return fallbackLabel;
    }

    if (fetching || queued) {
      return `${fetched} live${cached ? `, ${cached} cached` : ""}${noData ? `, ${noData} no data` : ""}${errors ? `, ${errors} errors` : ""}${fetching ? `, ${fetching} fetching` : ""}${queued ? `, ${queued} queued` : ""}`;
    }

    return `${fetched} live${cached ? `, ${cached} cached` : ""}${noData ? `, ${noData} no data` : ""}${errors ? `, ${errors} errors` : ""}`;
  }

  function hasResolvedLogResults(people) {
    return people.some((person) => ["live", "no-data", "error"].includes(person.logStatus));
  }

  function renderRosterIssues(people) {
    const noDataNames = people.filter((person) => person.logStatus === "no-data").map((person) => person.name);
    const errorNames = people.filter((person) => person.logStatus === "error").map((person) => person.name);
    if (!noDataNames.length && !errorNames.length) return null;

    const banner = document.createElement("div");
    banner.className = "member-issue-banner";
    banner.innerHTML = [
      noDataNames.length ? `<span class="status-chip warn">No data: ${escapeHtml(formatNameList(noDataNames))}</span>` : "",
      errorNames.length ? `<span class="status-chip error">Errors: ${escapeHtml(formatNameList(errorNames))}</span>` : "",
    ].filter(Boolean).join("");
    return banner;
  }

  function formatNameList(names) {
    if (!names.length) return "";
    if (names.length <= 3) return names.join(", ");
    return `${names.slice(0, 3).join(", ")} +${names.length - 3} more`;
  }

  function setScoreLabel(value) {
    if (!elements.scoreLabel) return;
    elements.scoreLabel.textContent = value;
  }

  function reasonChip(reason) {
    return `<span class="reason-chip">${escapeHtml(reason)}</span>`;
  }

  function applicationNoteBlock(applicant) {
    const note = normalizeApplicationNote(applicant.applicationNote);
    if (!note) return "";
    return `
      <div class="application-note">
        <strong>Note</strong>
        <span>${escapeHtml(note)}</span>
      </div>
    `;
  }

  function progressionStrip(applicant, target) {
    const label = progressionLabel(applicant, target);
    if (label === "-") return "";

    return `<div class="progression-strip">${progressionChips(applicant, target)}</div>`;
  }

  function progressionChips(person, target) {
    return RAID_DIFFICULTIES
      .map((difficulty) => progressionChip(progressForDifficulty(person, difficulty, target), difficulty))
      .filter(Boolean)
      .join("");
  }

  function progressionChip(progress, difficulty) {
    if (!progress || !progress.total) return "";
    const key = difficultyKey(difficulty);
    return `<span class="progress-chip ${key}">${progress.killed}/${progress.total}${difficultyAbbreviation(difficulty)}</span>`;
  }

  function progressionLabel(person, target) {
    const label = progressionChips(person, target);
    return label || "-";
  }

  function mythicPlusTimedLabel(person, target) {
    const stats = mythicPlusStats(person, target);
    if (!stats.timedRunCount && stats.bestTimedLevel === null) return "-";
    const countLabel = stats.atOrAboveCount
      ? `${stats.atOrAboveCount} ${stats.range.shortLabel}`
      : `${stats.timedRunCount} run${stats.timedRunCount === 1 ? "" : "s"}`;
    const peakLabel = stats.bestTimedLevel === null ? "" : ` / ${formatKeyLevel(stats.bestTimedLevel)} peak`;
    return `${countLabel}${peakLabel}`;
  }

  function personProviderChip(person) {
    const className = classColorClass(person.className);
    const specLabel = person.specName ? `${person.specName} ` : "";
    const title = `${person.name} - ${specLabel}${person.className}`;
    return `<span class="class-chip ${className}" title="${escapeAttribute(title)}">${escapeHtml(person.name)}</span>`;
  }

  function providerClassChip(provider) {
    const className = classColorClass(provider.className);
    const specLabel = provider.specName ? `${provider.specName} ` : "";
    const label = `${specLabel}${provider.className}`;
    return `<span class="class-chip ${className} is-option">${escapeHtml(label)}</span>`;
  }

  function perfStrip(score, target) {
    const applicant = score.applicant;
    const contributions = score.contributions || {};
    const pending = pendingScoreState(score, target);
    if (pending) {
      return `
        <div class="perf-strip" aria-label="Score detail">
          <span title="${escapeAttribute(pending.title)}"><strong>Logs</strong>${escapeHtml(pending.label)}</span>
        </div>
      `;
    }
    if (target && target.scoreMode === SCORE_MODE_MPLUS) {
      const perfCells = performanceColumns(target)
        .map((column) => performanceColumnCell(applicant, target, column))
        .join("");
      return `
        <div class="perf-strip" aria-label="Score detail">
          ${perfCells}
          ${mplusVolumeCell(score.raiderIo)}
          ${scoreMetricChip(raiderIoMetricLabel(score.raiderIo.range), contributions.raiderIo, score.raiderIo.points, score.weights && score.weights.raiderIo, raiderIoScoreTitle(score.raiderIo))}
        </div>
      `;
    }

    const perfCells = performanceColumns(target)
      .map((column) => performanceColumnCell(applicant, target, column))
      .join("");
    return `
      <div class="perf-strip" aria-label="Score detail">
        ${perfCells}
          ${scoreMetricChip("Parse", contributions.parse, score.parse.points, score.weights && score.weights.parse, parseSourceLabel(score.parse.source, score.parse.multiplier))}
        ${scoreMetricChip("Kills", contributions.kills, score.kills.points, score.weights && score.weights.kills, killScoreTitle(score.kills))}
        ${scoreMetricChip(raiderIoMetricLabel(score.raiderIo.range), contributions.raiderIo, score.raiderIo.points, score.weights && score.weights.raiderIo, raiderIoScoreTitle(score.raiderIo))}
        ${scoreMetricChip("Buff", contributions.buffs, score.buffs.points, score.weights && score.weights.buffs, buffScoreTitle(score.buffs))}
      </div>
    `;
  }

  function scoreMetricChip(label, contribution, rawScore, weight, detail) {
    return `<span title="${escapeAttribute(weightedMetricTitle(label, contribution, rawScore, weight, detail))}"><strong>${escapeHtml(label)}</strong>${formatWeightedMetricScore(contribution, weight)}</span>`;
  }

  function performanceColumns(target) {
    if (target && target.scoreMode === SCORE_MODE_MPLUS) {
      return [
        {
          type: "mplus",
          metric: "rating",
          label: "RIO",
          sortKey: "mplus:rating",
          title: "Current Raider.IO Mythic+ score",
        },
        {
          type: "mplus",
          metric: "average",
          label: "Avg Key",
          sortKey: "mplus:average",
          title: "Average timed key level",
        },
        {
          type: "mplus",
          metric: "median",
          label: "Median",
          sortKey: "mplus:median",
          title: "Median timed key level",
        },
        {
          type: "mplus",
          metric: "peak",
          label: "Peak",
          sortKey: "mplus:peak",
          title: "Best timed key level",
        },
      ];
    }

    const selected = Number(target && target.difficulty) || null;
    const fallback = Number(target && target.fallbackDifficulty) || null;
    const columns = [
      {
        type: "avg",
        difficulty: 5,
        label: "Mythic Avg",
        sortKey: "avg:5",
        title: "Mythic raid average, with boss breakdown on hover",
      },
      {
        type: "avg",
        difficulty: 4,
        label: "Heroic Avg",
        sortKey: "avg:4",
        title: "Heroic raid average, with boss breakdown on hover",
      },
    ];

    if (selected && selected >= MIN_SCORING_RAID_DIFFICULTY) {
      columns.push({
        type: "boss",
        difficulty: selected,
        label: difficultyShortName(selected),
        sortKey: `boss:${selected}`,
        title: `Selected boss at ${difficultyShortName(selected)} difficulty`,
      });
    }

    if (fallback && fallback >= MIN_SCORING_RAID_DIFFICULTY) {
      columns.push({
        type: "boss",
        difficulty: fallback,
        label: difficultyShortName(fallback),
        sortKey: `boss:${fallback}`,
        title: `Selected boss at ${difficultyShortName(fallback)} difficulty`,
      });
    }

    return columns.slice(0, 4);
  }

  function performanceColumnCell(applicant, target, column, options = {}) {
    if (column.type === "mplus") {
      return mplusPerformanceCell(applicant, target, column, options);
    }
    if (column.type === "boss") {
      return bossDifficultyCell(applicant, target, column.difficulty, column.label, options);
    }

    return difficultySummaryCell(applicant, target, column.difficulty, column.label, options);
  }

  function mplusPerformanceCell(applicant, target, column, options = {}) {
    const stats = mythicPlusStats(applicant, target);
    const labelMarkup = options.compact ? "" : `<strong>${escapeHtml(column.label)}</strong>`;
    let value = "-";
    let title = column.title;
    if (column.metric === "rating") {
      value = stats.rating === null ? "-" : String(Math.round(stats.rating));
      title = stats.rating === null ? "No Raider.IO score found" : `${Math.round(stats.rating)} Raider.IO score`;
    } else if (column.metric === "average") {
      value = formatKeyLevel(stats.averageTimedLevel);
      title = stats.averageTimedLevel === null ? "No timed key average found" : `Average timed key level ${formatKeyLevel(stats.averageTimedLevel)}`;
    } else if (column.metric === "median") {
      value = formatKeyLevel(stats.medianTimedLevel);
      title = stats.medianTimedLevel === null ? "No timed key median found" : `Median timed key level ${formatKeyLevel(stats.medianTimedLevel)}`;
    } else if (column.metric === "peak") {
      value = formatKeyLevel(stats.bestTimedLevel);
      title = stats.bestTimedLevel === null ? "No timed key peak found" : `Best timed key level ${formatKeyLevel(stats.bestTimedLevel)}`;
    }
    return `<span class="difficulty-summary" title="${escapeAttribute(title)}">${labelMarkup}<span class="metric-value${value === "-" ? " is-empty" : ""}">${escapeHtml(value)}</span></span>`;
  }

  function mplusVolumeCell(score) {
    const range = score && score.range ? score.range : selectedMythicPlusRange();
    const count = numberOrZero(score && score.atOrAboveCount);
    const value = count ? `${count}/${range.targetRuns}` : `0/${range.targetRuns}`;
    const title = count
      ? `${count} timed key${count === 1 ? "" : "s"} at or above ${range.shortLabel}`
      : `No timed keys at or above ${range.shortLabel}`;
    return `<span title="${escapeAttribute(title)}"><strong>Timed</strong><span class="metric-value${count ? "" : " is-empty"}">${escapeHtml(value)}</span></span>`;
  }

  function weightedMetricTitle(label, contribution, rawScore, weight, detail) {
    const max = metricContributionMax(weight);
    return `${label}: ${formatWeightedMetricScore(contribution, weight)} rating points (${formatMetricScore(rawScore)} raw x ${max}%)${detail ? ` - ${detail}` : ""}`;
  }

  function difficultySummaryCell(applicant, target, difficulty, label, options = {}) {
    const value = bestPerfForDifficulty(applicant, target, difficulty);
    const encounters = encounterRanksForDifficulty(applicant, difficulty, target);
    const hasTooltip = encounters.length > 0;
    const labelMarkup = options.compact ? "" : `<strong>${escapeHtml(label)}</strong>`;
    const tooltip = hasTooltip ? difficultyParseTooltip(applicant, difficulty, label, value, encounters) : "";
    return `
      <span class="difficulty-summary${hasTooltip ? " has-tooltip" : ""}">
        ${labelMarkup}${parseCell(value, { average: true })}${tooltip}
      </span>
    `;
  }

  function bossDifficultyCell(applicant, target, difficulty, label, options = {}) {
    const value = bossParseForDifficulty(applicant, target, difficulty);
    const encounters = encounterRanksForDifficulty(applicant, difficulty, target);
    const hasTooltip = encounters.length > 0;
    const labelMarkup = options.compact ? "" : `<strong>${escapeHtml(label)}</strong>`;
    const tooltip = hasTooltip ? difficultyParseTooltip(applicant, difficulty, label, bestPerfForDifficulty(applicant, target, difficulty), encounters) : "";
    return `
      <span class="difficulty-summary${hasTooltip ? " has-tooltip" : ""}">
        ${labelMarkup}${parseCell(value)}${tooltip}
      </span>
    `;
  }

  function difficultyParseTooltip(applicant, difficulty, label, value, encounters) {
    const rows = encounters.map((encounter) => `
      <span class="parse-tooltip-row">
        <span>${escapeHtml(encounter.name)}</span>
        ${parseCell(encounter.percentile)}
        <small>${escapeHtml(formatKillCount(encounter.kills))}</small>
      </span>
    `).join("");
    const profile = profileForDifficulty(applicant.difficultyProfiles, difficulty);
    const totalKills = profile ? profile.kills : legacyDifficultyValue(applicant, difficulty, "Kills");
    const median = medianPerfForDifficulty(applicant, {}, difficulty);
    const summaryParts = [
      value !== null && value !== undefined ? `Best avg ${formatParse(value, { average: true })}` : "",
      median !== null && median !== undefined ? `Median ${formatParse(median, { average: true })}` : "",
      totalKills ? `${formatKillCount(totalKills)} raid total` : "",
      profile && profile.partition && profile.partition.label ? `WCL ${profile.partition.label}` : "",
    ].filter(Boolean);

    return `
      <span class="parse-tooltip" role="tooltip">
        <span class="parse-tooltip-title">${escapeHtml(label)} Boss Parses</span>
        ${summaryParts.length ? `<span class="parse-tooltip-summary">${escapeHtml(summaryParts.join(" - "))}</span>` : ""}
        <span class="parse-tooltip-row parse-tooltip-head">
          <span>Boss</span>
          <span>Best</span>
          <small>Kills</small>
        </span>
        ${rows}
      </span>
    `;
  }

  function encounterRanksForDifficulty(applicant, difficulty, target) {
    if (staleRaidLogData(applicant, target)) return [];
    const profile = profileForDifficulty(applicant.difficultyProfiles, difficulty);
    if (profile && Array.isArray(profile.encounterRanks)) return profile.encounterRanks;

    const encounters = legacyDifficultyValue(applicant, difficulty, "EncounterRanks");
    return Array.isArray(encounters) ? encounters : [];
  }

  function otherEncounterRanksForDifficulty(applicant, difficulty, target) {
    if (!isBossTarget(target)) return [];
    return encounterRanksForDifficulty(applicant, difficulty, target)
      .filter((encounter) => String(encounter.id) !== String(target && target.encounterId || ""));
  }

  function normalizeEncounterRanks(zoneRanking) {
    const encounters = zoneRanking && zoneRanking.encounters && typeof zoneRanking.encounters === "object"
      ? zoneRanking.encounters
      : {};
    const values = Object.values(encounters);
    const hasRankingSignal = values.some((encounter) => {
      const percentile = firstNumber(encounter.percentile);
      const kills = firstNumber(encounter.kills);
      return percentile !== null || (kills !== null && kills > 0);
    });
    if (!hasRankingSignal) return [];

    const rankedById = new Map(values.map((encounter) => [String(encounter.id || ""), encounter]));
    const knownRows = (data.encounters || []).map((encounter) => {
      const ranked = rankedById.get(String(encounter.id)) || {};
      return normalizeEncounterRankRow({
        ...ranked,
        id: encounter.id,
        name: ranked.name || encounter.name,
      });
    });
    const extraRows = values
      .filter((encounter) => !encounterNameForId(encounter.id))
      .map(normalizeEncounterRankRow)
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));

    return [...knownRows, ...extraRows];
  }

  function normalizeEncounterRankRow(encounter) {
    const id = String(encounter.id || "");
    return {
      id,
      name: encounter.name || encounterNameForId(id) || "Unknown boss",
      percentile: firstNumber(encounter.percentile),
      medianPercent: firstNumber(encounter.medianPercent),
      kills: firstNumber(encounter.kills) || 0,
      bestAmount: firstNumber(encounter.bestAmount),
    };
  }

  function encounterNameForId(id) {
    const encounter = (data.encounters || []).find((item) => String(item.id) === String(id));
    return encounter ? encounter.name : "";
  }

  function formatKillCount(value) {
    const kills = Math.max(0, Math.round(Number(value) || 0));
    return `${kills} kill${kills === 1 ? "" : "s"}`;
  }

  function formatPoints(value) {
    const rounded = Math.round(Number(value) || 0);
    return rounded > 0 ? `+${rounded}` : String(rounded);
  }

  function formatMetricScore(value) {
    return String(Math.round(clampScore(value)));
  }

  function formatWeightedMetricScore(value, weight) {
    return `${formatMetricScore(value)}/${metricContributionMax(weight)}`;
  }

  function metricContributionMax(weight) {
    return Math.round(clampScore((Number(weight) || 0) * 100));
  }

  function formatRaiderIoCount(value) {
    const number = firstNumber(value);
    return number === null ? "-" : String(Math.max(0, Math.round(number)));
  }

  function killScoreTitle(score) {
    const credit = score && Number(score.multiplier) > 0 && Number(score.multiplier) < 1
      ? `, ${formatCreditPercent(score.multiplier)}`
      : "";
    if (score && score.source === "same-tier-fallback") {
      return `${score.kills || 0} ${score.label || "same-tier"} kills (${score.bucket || "0"} bucket${credit})`;
    }
    return `${score.kills || 0} ${score.label || "selected"} ${score.scope || "boss"} kills (${score.bucket || "0"} bucket${credit})`;
  }

  function raiderIoScoreTitle(score) {
    const range = score && score.range ? score.range : selectedMythicPlusRange();
    if (!score || (score.rating === null && !score.rangeCount && !score.atOrAboveCount && score.bestTimedLevel === null)) {
      return `No Raider.IO ${range.shortLabel} data found`;
    }
    const parts = [];
    if (score.rating !== null && score.rating !== undefined) parts.push(`${Math.round(score.rating)} Raider.IO score`);
    if (score.averageTimedLevel !== null && score.averageTimedLevel !== undefined) parts.push(`avg ${formatKeyLevel(score.averageTimedLevel)}`);
    if (score.medianTimedLevel !== null && score.medianTimedLevel !== undefined) parts.push(`median ${formatKeyLevel(score.medianTimedLevel)}`);
    if (score.bestTimedLevel !== null && score.bestTimedLevel !== undefined) parts.push(`peak ${formatKeyLevel(score.bestTimedLevel)}`);
    if (score.rangeCount) parts.push(`${score.rangeCount} timed ${range.shortLabel} key${score.rangeCount === 1 ? "" : "s"}`);
    if (score.atOrAboveCount && score.atOrAboveCount !== score.rangeCount) parts.push(`${score.atOrAboveCount} timed at/above ${range.shortLabel}`);
    return parts.join(", ");
  }

  function raiderIoMetricLabel(range) {
    const resolved = range || selectedMythicPlusRange();
    return `M+ ${resolved.shortLabel}`;
  }

  function buffScoreTitle(score) {
    if (!score || !Array.isArray(score.missing) || !score.missing.length) {
      return "No currently needed buffs";
    }
    return `Needed buffs: ${score.missing.map((buff) => buff.name).join(", ")}`;
  }

  function formatIlvl(value) {
    if (value === null || value === undefined || value === "") return "-";
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return "-";
    return number % 1 === 0 ? String(number) : number.toFixed(1);
  }

  function formatKeyLevel(value) {
    if (value === null || value === undefined || value === "") return "-";
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return "-";
    return number % 1 === 0 ? `+${Math.round(number)}` : `+${number.toFixed(1)}`;
  }

  function parseSourceLabel(source, multiplier) {
    if (source === "primary") return "Using the selected boss and difficulty";
    if (source === "same-tier-fallback") {
      return `Using other bosses at this difficulty for fallback at ${formatCreditPercent(multiplier)}`;
    }
    if (source === "fallback") {
      return Number(multiplier) > 0 && Number(multiplier) < 1
        ? `Using fallback difficulty for this boss at ${formatCreditPercent(multiplier)}`
        : "Using fallback difficulty for this boss";
    }
    if (source === "higher") return "Using a higher-difficulty parse profile as an upgrade";
    return "No selected or fallback parse found";
  }

  function formatCreditPercent(multiplier) {
    const value = Number(multiplier);
    if (!Number.isFinite(value) || value <= 0) return "0% credit";
    return `${Math.round(value * 100)}% credit`;
  }

  function bossParseForDifficulty(applicant, target, difficulty) {
    if (staleRaidLogData(applicant, target)) return null;
    const profile = profileForDifficulty(applicant.difficultyProfiles, difficulty);
    if (profile && profile.bossParse !== null && profile.bossParse !== undefined) return profile.bossParse;

    if (Number(target && target.difficulty) === Number(difficulty)) {
      return applicant.primaryParse;
    }

    if (Number(target && target.fallbackDifficulty) === Number(difficulty)) {
      return applicant.fallbackParse;
    }

    return null;
  }

  function bossKillsForDifficulty(applicant, target, difficulty) {
    if (staleRaidLogData(applicant, target)) return null;
    const profile = profileForDifficulty(applicant.difficultyProfiles, difficulty);
    if (target && target.raidAverage && profile && profile.kills !== null && profile.kills !== undefined) {
      return profile.kills;
    }
    if (profile && profile.bossKills !== null && profile.bossKills !== undefined) return profile.bossKills;

    if (Number(target && target.difficulty) === Number(difficulty)) {
      return applicant.primaryKills;
    }

    if (Number(target && target.fallbackDifficulty) === Number(difficulty)) {
      return applicant.fallbackKills;
    }

    return null;
  }

  function bestPerfForDifficulty(applicant, target, difficulty) {
    if (staleRaidLogData(applicant, target)) return null;
    const profile = profileForDifficulty(applicant.difficultyProfiles, difficulty);
    if (profile && profile.bestPerfAvg !== null && profile.bestPerfAvg !== undefined) {
      return profile.bestPerfAvg;
    }

    const legacy = legacyDifficultyValue(applicant, difficulty, "BestPerfAvg");
    if (legacy !== null && legacy !== undefined) return legacy;

    if (Number(target && target.difficulty) === Number(difficulty)) {
      return applicant.primaryParse;
    }

    if (Number(target && target.fallbackDifficulty) === Number(difficulty)) {
      return applicant.fallbackParse;
    }

    return null;
  }

  function medianPerfForDifficulty(applicant, target, difficulty) {
    if (staleRaidLogData(applicant, target)) return null;
    const profile = profileForDifficulty(applicant.difficultyProfiles, difficulty);
    if (profile && profile.medianPerfAvg !== null && profile.medianPerfAvg !== undefined) {
      return profile.medianPerfAvg;
    }

    const legacy = legacyDifficultyValue(applicant, difficulty, "MedianPerfAvg");
    if (legacy !== null && legacy !== undefined) return legacy;

    const encounter = encounterRankForDifficulty(applicant, difficulty, target && target.encounterId, target);
    return encounter ? encounter.medianPercent : null;
  }

  function progressForDifficulty(applicant, difficulty, target) {
    if (staleRaidLogData(applicant, target)) return null;
    const profile = profileForDifficulty(applicant.difficultyProfiles, difficulty);
    if (profile && profile.progress) return profile.progress;
    return legacyDifficultyValue(applicant, difficulty, "Progress");
  }

  function isBossTarget(target) {
    return Boolean(target && !target.raidAverage && Number(target.encounterId));
  }

  function legacyDifficultyValue(applicant, difficulty, suffix) {
    const key = difficultyKey(difficulty);
    if (!key) return null;
    return applicant[`${key}${suffix}`];
  }

  function encounterRankForDifficulty(applicant, difficulty, encounterId, target) {
    const encounters = encounterRanksForDifficulty(applicant, Number(difficulty), target);
    return encounters.find((encounter) => String(encounter.id) === String(encounterId || "")) || null;
  }

  function rosterLogStatus(member, target) {
    if (staleRaidLogData(member, target)) {
      const targetLabel = describeRaidLogTarget(target);
      const sourceLabel = member.logTargetLabel || "another raid target";
      const title = `Fetched for ${sourceLabel}; current target is ${targetLabel || "different target"}. Re-fetch logs for this fight.`;
      return `<span class="status-chip warn" title="${escapeAttribute(title)}">Stale</span>`;
    }

    if (member.logStatus === "live") {
      const label = member.cacheHit ? "Cached" : member.resolvedZoneName || "Live";
      const titleParts = [
        member.cacheHit ? "Cached result" : member.resolvedZoneName || "Live Warcraft Logs result",
        member.logPartitionLabel ? logPartitionSummary(member.logPartitionLabel) : "",
        member.cacheHit && member.cacheExpiresInSeconds ? `expires in ${formatDuration(member.cacheExpiresInSeconds)}` : "",
      ].filter(Boolean);
      const title = titleParts.join(" - ");
      return `<span class="status-chip ok" title="${escapeAttribute(title)}">${escapeHtml(label)}</span>`;
    }

    if (member.logStatus === "error") {
      const message = shortError(member.logError || "Warcraft Logs error");
      return `<span class="status-chip error" title="${escapeAttribute(member.logError || "Warcraft Logs error")}">${escapeHtml(message)}</span>`;
    }

    if (member.logStatus === "no-data") {
      const message = shortError(member.logError || "No public data");
      return `<span class="status-chip warn" title="${escapeAttribute(member.logError || "No public Warcraft Logs data found")}">${escapeHtml(message)}</span>`;
    }

    if (member.logStatus === "fetching") {
      return `<span class="status-chip fetching">Fetching</span>`;
    }

    if (member.logStatus === "pending") {
      return `<span class="status-chip">Queued</span>`;
    }

    return `<span class="status-chip">Not fetched</span>`;
  }

  function logPartitionSummary(label) {
    return String(label || "").trim().toLowerCase() === "all"
      ? "WCL All partitions"
      : `WCL partition ${label}`;
  }

  function shortError(message) {
    const normalized = String(message || "").replace(/^Warcraft Logs GraphQL error:\s*/i, "").trim();
    if (/no public warcraft logs data/i.test(normalized)) return "No data";
    if (/character.*not found|not found/i.test(normalized)) return "Not found";
    if (/missing/i.test(normalized)) return "Missing data";
    if (/rate/i.test(normalized)) return "Rate limit";
    return normalized.length > 24 ? `${normalized.slice(0, 21)}...` : normalized;
  }

  function emptyState(text) {
    const element = document.createElement("div");
    element.className = "empty-state";
    element.textContent = text;
    return element;
  }

  function formatParse(value, options = {}) {
    if (value === null || value === undefined) return "-";
    const number = Number(value);
    if (!Number.isFinite(number)) return "-";
    if (options.average) return number.toFixed(1);
    return String(Math.floor(number));
  }

  function parseCell(value, options = {}) {
    return `<span class="parse-value ${parseClass(value)}">${escapeHtml(formatParse(value, options))}</span>`;
  }

  function parseClass(value) {
    if (value === null || value === undefined || value === "") return "parse-none";
    const number = Number(value);
    if (!Number.isFinite(number)) return "parse-none";
    const rounded = Math.floor(number);
    if (rounded >= 100) return "parse-gold";
    if (rounded >= 99) return "parse-pink";
    if (rounded >= 95) return "parse-orange";
    if (rounded >= 75) return "parse-purple";
    if (rounded >= 50) return "parse-blue";
    if (rounded >= 25) return "parse-green";
    return "parse-gray";
  }

  function scoreClass(value) {
    return parseClass(value);
  }

  function normalizeRole(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "tank") return "Tank";
    if (normalized === "healer" || normalized === "heal") return "Healer";
    return "DPS";
  }

  function normalizeClass(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function parsePercentile(value) {
    if (value === undefined || value === null || value === "") return null;
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return Math.max(0, Math.min(100, number));
  }

  function parseCount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
  }

  function parseItemLevel(value) {
    if (value === undefined || value === null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function normalizeApplicationNote(value) {
    const note = String(value || "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return note && !isProtectedContextValue(note) ? note : "";
  }

  function firstNumber(...values) {
    for (const value of values) {
      if (value === null || value === undefined || value === "") continue;
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }

    return null;
  }

  function firstPositiveNumber(...values) {
    for (const value of values) {
      if (value === null || value === undefined || value === "") continue;
      const number = Number(value);
      if (Number.isFinite(number) && number > 0) return number;
    }

    return null;
  }

  function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function clampNumber(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.max(min, Math.min(max, Math.round(number)));
  }

  function clampNumberWithDefault(input, fallback, min, max) {
    const value = input && "value" in input ? input.value : input;
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }

  function sameText(left, right) {
    return String(left || "").toLowerCase() === String(right || "").toLowerCase();
  }

  function normalizedSearchText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9+]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function groupRaidVisualPeople(analysis) {
    const grouped = {
      Tank: [],
      Healer: [],
      DPS: [],
    };

    for (const person of analysis.roster) {
      grouped[person.role].push({ person, isSelected: false });
    }

    return grouped;
  }

  function roleClass(role) {
    if (role === "Tank") return "tank";
    if (role === "Healer") return "healer";
    return "dps";
  }

  function classColorClass(className) {
    const slug = String(className || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    return slug ? `class-${slug}` : "class-unknown";
  }

  function initials(name) {
    return String(name || "?").slice(0, 2).toUpperCase();
  }

  function warcraftLogsUrl(applicant) {
    const region = encodeURIComponent(String(applicant.region || "US").toUpperCase());
    const realm = encodeURIComponent(warcraftLogsRealmSlug(applicant.realm));
    const name = encodeURIComponent(String(applicant.name || "").trim());
    return `https://www.warcraftlogs.com/character/${region}/${realm}/${name}`;
  }

  function warcraftLogsRealmSlug(realm) {
    const slug = String(realm || "")
      .trim()
      .toLowerCase()
      .replace(/['.]/g, "")
      .replace(/\s+/g, "-");

    if (slug === "area52") return "area-52";
    return slug;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }
})();
