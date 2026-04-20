(function () {
  const data = window.RAID_DATA;
  const API_BASE = window.location.protocol === "file:" ? "http://127.0.0.1:4177" : "";
  const DECLINED_STORAGE_KEY = "raaDeclinedApplicantsV1";
  const ADDON_IMPORT_STORAGE_KEY = "raaLastAddonImportSnapshotV1";
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
    lastAddonImportSnapshot: loadAddonImportSnapshot(),
    newApplicantKeys: new Set(),
    rosterSort: {
      key: "name",
      direction: "asc",
    },
  };

  const elements = {
    tankTarget: document.querySelector("#tankTarget"),
    healerTarget: document.querySelector("#healerTarget"),
    dpsTarget: document.querySelector("#dpsTarget"),
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
    recommendationsList: document.querySelector("#recommendationsList"),
    roleMeters: document.querySelector("#roleMeters"),
    raidVisual: document.querySelector("#raidVisual"),
    buffList: document.querySelector("#buffList"),
    scoreTable: document.querySelector("#scoreTable"),
    rosterStats: document.querySelector("#rosterStats"),
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
    declinedCount: document.querySelector("#declinedCount"),
    clearDeclined: document.querySelector("#clearDeclined"),
    resetScoreWeights: document.querySelector("#resetScoreWeights"),
    scoreParseRank: document.querySelector("#scoreParseRank"),
    scoreKillsRank: document.querySelector("#scoreKillsRank"),
    scoreRaiderIoRank: document.querySelector("#scoreRaiderIoRank"),
    scoreBuffRank: document.querySelector("#scoreBuffRank"),
    toastStack: document.querySelector("#toastStack"),
  };
  let addonImportTimer = null;
  let lastAutoImportedExport = "";
  let bridgePollTimer = null;

  init();

  function init() {
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
    if (elements.clearDeclined) {
      elements.clearDeclined.addEventListener("click", clearDeclinedApplicants);
    }
    if (elements.resetScoreWeights) {
      elements.resetScoreWeights.addEventListener("click", resetScoreWeights);
    }

    populateInviteClassFilter();

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
    ].filter(Boolean)) {
      input.addEventListener("input", () => runAnalysis({ fetchLogs: state.hasWarcraftLogsCredentials }));
      input.addEventListener("change", () => runAnalysis({ fetchLogs: state.hasWarcraftLogsCredentials }));
    }

    updateDeclinedUi();

    checkServer().then((health) => {
      if (health && health.hasWarcraftLogsCredentials) refreshRateLimit();
    });
    startBridgePolling();
    runAnalysis({ fetchLogs: false });
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

  function populateBossSelect() {
    if (!elements.bossName) return;

    const encounters = data.encounters && data.encounters.length
      ? data.encounters
      : [{ id: "", name: "Selected boss", default: true }];

    for (const encounter of encounters) {
      const option = document.createElement("option");
      option.value = encounter.name;
      option.textContent = encounter.name;
      if (encounter.id) option.dataset.encounterId = String(encounter.id);
      if (encounter.default) option.selected = true;
      elements.bossName.append(option);
    }

    const selectedOption = elements.bossName.selectedOptions && elements.bossName.selectedOptions[0];
    if (elements.encounterId && selectedOption) {
      elements.encounterId.value = selectedOption.dataset.encounterId || "";
    }

    elements.bossName.addEventListener("change", () => {
      const option = elements.bossName.selectedOptions && elements.bossName.selectedOptions[0];
      if (elements.encounterId) elements.encounterId.value = option ? option.dataset.encounterId || "" : "";
    });
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

  function filterDeclinedApplicants(applicants) {
    return applicants.filter((applicant) => !state.declinedApplicantKeys.has(applicantKey(applicant)));
  }

  function handleRecommendationsClick(event) {
    const button = event.target.closest("[data-decline-key]");
    if (!button) return;

    event.preventDefault();
    declineApplicant(button.dataset.declineKey, button.dataset.declineName || "Applicant");
  }

  function declineApplicant(key, name) {
    const normalized = normalizeApplicantKey(key);
    if (!normalized) return;

    state.declinedApplicantKeys.add(normalized);
    saveDeclinedApplicantKeys();
    updateDeclinedUi();
    setScoreLabel(`${name} declined for this session`);

    if (state.latestAnalysis) {
      const analysis = recommendApplicants({
        target: state.latestAnalysis.target,
        roster: state.latestAnalysis.roster,
        applicants: filterDeclinedApplicants(state.latestAnalysis.applicants),
      });
      state.latestAnalysis = analysis;
      render(analysis);
    }
  }

  function clearDeclinedApplicants() {
    if (!state.declinedApplicantKeys.size) return;

    state.declinedApplicantKeys.clear();
    saveDeclinedApplicantKeys();
    updateDeclinedUi();
    setScoreLabel("Declined applicants cleared");
    runAnalysis({ fetchLogs: false });
  }

  function updateDeclinedUi() {
    const count = state.declinedApplicantKeys.size;
    if (elements.declinedCount) {
      elements.declinedCount.textContent = `${count} declined`;
    }
    if (elements.clearDeclined) {
      elements.clearDeclined.disabled = count === 0;
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
    if (!elements.toastStack) return;

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = `
      <strong>Game export received</strong>
      <span>${escapeHtml(formatTimestamp(new Date()))} - ${parsed.roster.length} roster, ${parsed.applicants.length} applicants</span>
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
    elements.currentRoster.value = data.demoRoster;
    elements.applicants.value = data.demoApplicants;
    elements.addonExport.value = "";
    runAnalysis({ fetchLogs: false });
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
    importAddonExport({ fetchLogs: true, automatic: true, source: "clipboard" });
  }

  function consumePendingBridgeExport() {
    if (!state.pendingBridgeExport || state.isFetchingLogs) return;

    const pending = state.pendingBridgeExport;
    state.pendingBridgeExport = null;
    applyBridgeExport(pending);
  }

  function scheduleAddonExportImport() {
    window.clearTimeout(addonImportTimer);
    addonImportTimer = window.setTimeout(() => {
      const raw = elements.addonExport.value.trim();
      const looksLikeExport = /\bRAA_EXPORT_ESCAPED_V1\b|\bRAA_EXPORT_V1\b|\[ROSTER\]|\[APPLICANTS\]/i.test(raw);
      if (!raw || !looksLikeExport) return;

      importAddonExport({ fetchLogs: true, automatic: true });
    }, 120);
  }

  function importAddonExport(options = {}) {
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
    const contextSummary = applyAddonContext(parsed.context);

    if (parsed.roster.length) {
      elements.currentRoster.value = parsed.roster.join("\n");
    }

    if (parsed.applicants.length) {
      elements.applicants.value = parsed.applicants.join("\n");
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

  function applyAddonContext(context) {
    if (!context || typeof context !== "object") return "";

    const changes = [];
    const difficulty = difficultyFromContext(context);
    if (difficulty && elements.difficulty && elements.difficulty.value !== String(difficulty)) {
      elements.difficulty.value = String(difficulty);
      changes.push(difficultyShortName(difficulty));
    }

    const encounter = encounterFromContext(context);
    if (encounter && elements.bossName) {
      const option = Array.from(elements.bossName.options || [])
        .find((item) => String(item.dataset.encounterId || "") === String(encounter.id || ""));
      if (option && elements.bossName.value !== option.value) {
        elements.bossName.value = option.value;
        if (elements.encounterId) elements.encounterId.value = option.dataset.encounterId || "";
        changes.push(encounter.name);
      }
    }

    if (changes.length) return `Target ${changes.join(" ")}`;
    const label = firstContextText(context, "activityName", "listingName", "activityShortName");
    return label ? `Context ${label}` : "";
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

  function encounterFromContext(context) {
    const haystack = normalizedSearchText(contextSearchText(context));
    if (!haystack) return null;

    return (data.encounters || []).find((encounter) => {
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
    ].filter(Boolean).join(" ");
  }

  function firstContextText(context, ...keys) {
    for (const key of keys) {
      const value = String(context[key] || "").trim();
      if (value) return value;
    }

    return "";
  }

  async function runAnalysis(options) {
    if (state.isFetchingLogs) return;

    if (!options.fetchLogs) {
      state.logFetchMessage = null;
    }

    const target = readTarget();
    let roster = parsePeople(elements.currentRoster.value, "roster");
    let applicants = filterDeclinedApplicants(parsePeople(elements.applicants.value, "applicant"));
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
    setLogProgress("Checking Warcraft Logs connection");
    rerender();

    const health = await checkServer();
    if (!health || !health.hasWarcraftLogsCredentials) {
      setLogProgress("Warcraft Logs credentials not loaded");
      rerender();
      finishLogFetch();
      return;
    }

    if (!target.encounterId && !target.bossName) {
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
    setLogProgress(`Logs fetched: ${fetched} live${cached ? `, ${cached} cached` : ""}${noData ? `, ${noData} no data` : ""}${errors ? `, ${errors} errors` : ""}`);
    rerender();
    finishLogFetch();
  }

  function readTarget() {
    const difficulty = Number(elements.difficulty.value);
    const difficultyInfo = data.difficulties.find((item) => item.id === difficulty) || data.difficulties[0];
    const bossOption = elements.bossName && elements.bossName.selectedOptions && elements.bossName.selectedOptions[0];
    const bossName = bossOption
      ? bossOption.textContent.trim()
      : String(elements.bossName && elements.bossName.value || "").trim();
    const encounterId = Number(
      (bossOption && bossOption.dataset.encounterId)
      || (elements.encounterId && elements.encounterId.value)
    ) || null;

    return {
      bossName: bossName || "Selected boss",
      encounterId,
      difficulty,
      fallbackDifficulty: difficultyInfo.fallback,
      metric: elements.metric.value,
      weights: readScoreWeights(),
      roles: {
        Tank: clampNumber(elements.tankTarget.value, 0, 30),
        Healer: clampNumber(elements.healerTarget.value, 0, 30),
        DPS: clampNumber(elements.dpsTarget.value, 0, 30),
      },
    };
  }

  function readScoreWeights() {
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

    for (let index = 0; index < people.length; index += 1) {
      const applicant = people[index];
      enriched[index] = {
        ...enriched[index],
        logStatus: "fetching",
        logError: null,
      };
      setLogProgress(`Fetching ${label || "logs"} ${index + 1}/${people.length}: ${applicant.name}`);
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
        const selectedProfile = profileForDifficulty(difficultyProfiles, target.difficulty);
        const fallbackProfile = profileForDifficulty(difficultyProfiles, target.fallbackDifficulty);
        const primaryParse = firstNumber(rankings.primary && rankings.primary.percentile, selectedProfile && selectedProfile.bossParse);
        const fallbackParse = firstNumber(rankings.fallback && rankings.fallback.percentile, fallbackProfile && fallbackProfile.bossParse);
        const hasLogValue = [primaryParse, fallbackParse]
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
          raiderIoScore: firstNumber(applicant.raiderIoScore, rankings.character && rankings.character.raiderIoScore),
          raiderIoTimedTenPlus: firstNumber(applicant.raiderIoTimedTenPlus, rankings.character && rankings.character.raiderIoTimedTenPlus),
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
          logStatus: hasLogValue ? "live" : "no-data",
          logError: hasLogValue ? null : rankingReason(rankings),
          cacheHit: Boolean(rankings.cache && rankings.cache.hit),
          cacheExpiresInSeconds: rankings.cache && rankings.cache.expiresInSeconds,
        };
        enriched[index] = enrichedPerson;
        setLogProgress(`Fetched ${label || "logs"} ${index + 1}/${people.length}: ${applicant.name}${enrichedPerson.cacheHit ? " (cached)" : ""}`);
        if (onUpdate) onUpdate(enrichedPerson, index, [...enriched]);
      } catch (error) {
        const enrichedPerson = {
          ...applicant,
          logStatus: "error",
          logError: error.message,
          cacheHit: false,
        };
        enriched[index] = enrichedPerson;
        setLogProgress(`Fetched ${label || "logs"} ${index + 1}/${people.length}: ${applicant.name} (error)`);
        if (onUpdate) onUpdate(enrichedPerson, index, [...enriched]);
      }
    }

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
    window.setTimeout(consumePendingBridgeExport, 0);
  }

  function setLogProgress(message) {
    state.logFetchMessage = message;
    setScoreLabel(message);
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
      };
      return profiles;
    }, {});
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
    const parse = parseScore(applicant, context.target);
    const kills = killScore(applicant, context.target);
    const raiderIo = raiderIoScore(applicant);
    const buffs = buffScore(applicant, context.currentBuffs);
    const exactContributions = {
      parse: parse.points * (weights.parse || 0),
      kills: kills.points * (weights.kills || 0),
      raiderIo: raiderIo.points * (weights.raiderIo || 0),
      buffs: buffs.points * (weights.buffs || 0),
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
      reasons: [...parse.reasons, ...kills.reasons, ...raiderIo.reasons, ...buffs.reasons],
      warnings: [...parse.warnings, ...kills.warnings, ...raiderIo.warnings],
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
      });
    });
  }

  function rosterScoreForMember(analysis, member) {
    return (analysis.rosterScores || []).find((score) => score.applicant.id === member.id) || null;
  }

  function roundContributionsToTotal(contributions, total) {
    const metrics = ["parse", "kills", "raiderIo", "buffs"];
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
    const profiles = relevantDifficultyColumns(target)
      .map((difficulty) => parseScoreForDifficulty(applicant, target, difficulty, selectedDifficulty))
      .filter((profile) => profile.available.length > 0)
      .sort((left, right) => right.points - left.points);
    const warnings = [];

    if (!profiles.length) {
      return {
        points: 0,
        reasons: ["no parse data"],
        warnings: ["no relevant parse found"],
        source: "none",
      };
    }

    const best = profiles[0];
    const reasonParts = best.available
      .slice()
      .sort((left, right) => right.value - left.value)
      .slice(0, 3)
      .map((part) => `${part.label} ${formatParse(part.value, { average: part.value % 1 !== 0 })}`);
    if (best.points < 40) warnings.push("low parse profile");

    return {
      points: clampScore(best.points),
      reasons: [`parses: ${difficultyShortName(best.difficulty)} ${best.multiplier > 1 ? "boosted " : ""}${reasonParts.join(", ")}`],
      warnings,
      source: best.source,
      difficulty: best.difficulty,
      multiplier: best.multiplier,
    };
  }

  function parseScoreForDifficulty(applicant, target, difficulty, selectedDifficulty) {
    const encounter = encounterRankForDifficulty(applicant, difficulty, target.encounterId);
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
    };
  }

  function parseDifficultyMultiplier(difficulty, selectedDifficulty) {
    if (!difficulty || !selectedDifficulty) return 1;
    const delta = Number(difficulty) - Number(selectedDifficulty);
    if (delta > 0) return Math.min(1.45, 1 + (delta * 0.18));
    if (delta < 0) return Math.max(0.65, 1 + (delta * 0.15));
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
    const profile = bossKillProfileForTarget(applicant, target);
    const kills = Math.max(0, Math.round(Number(profile.kills) || 0));
    let points = 0;
    let bucket = "0";
    if (kills >= 5) {
      points = 100;
      bucket = "5+";
    } else if (kills >= 2) {
      points = 75;
      bucket = "2-5";
    } else if (kills === 1) {
      points = 45;
      bucket = "1";
    }

    return {
      points,
      reasons: [`${profile.label} boss kills: ${bucket}`],
      warnings: kills === 0 ? ["no selected boss kills"] : [],
      kills,
      bucket,
      difficulty: profile.difficulty,
      label: profile.label,
    };
  }

  function bossKillProfileForTarget(applicant, target) {
    const selectedDifficulty = Number(target && target.difficulty) || null;
    const fallbackDifficulty = Number(target && target.fallbackDifficulty) || null;
    const candidates = relevantDifficultyColumns(target)
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

  function raiderIoScore(applicant) {
    const timedTenPlus = firstNumber(applicant.raiderIoTimedTenPlus);
    if (timedTenPlus === null) {
      return {
        points: 0,
        reasons: ["no Raider.IO 10+ data"],
        warnings: ["no Raider.IO timed 10+ data"],
        timedTenPlus: null,
      };
    }

    const count = Math.max(0, Math.round(timedTenPlus));
    return {
      points: clampScore((Math.min(count, 10) / 10) * 100),
      reasons: [`Raider.IO: ${count} timed +10${count === 1 ? "" : "s"}`],
      warnings: [],
      timedTenPlus: count,
    };
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
    updateDeclinedUi();
    renderRecommendations(analysis);
    renderComposition(analysis);
    renderBuffs(analysis);
    renderScores(analysis);
    renderRosterStats(analysis);
  }

  function populateInviteClassFilter() {
    if (!elements.inviteFilterClass) return;

    const classes = [
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

    for (const className of classes) {
      const option = document.createElement("option");
      option.value = className;
      option.textContent = className;
      elements.inviteFilterClass.append(option);
    }
  }

  function filteredApplicantScores(analysis) {
    const scores = analysis.allScores || [];
    const search = String(elements.inviteFilterSearch && elements.inviteFilterSearch.value || "").trim().toLowerCase();
    const role = String(elements.inviteFilterRole && elements.inviteFilterRole.value || "").trim();
    const className = String(elements.inviteFilterClass && elements.inviteFilterClass.value || "").trim();
    const minIlvl = parseItemLevel(elements.inviteFilterMinIlvl && elements.inviteFilterMinIlvl.value);
    const hideFilled = Boolean(elements.inviteFilterFilled && elements.inviteFilterFilled.checked);
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
      const matchesIlvl = minIlvl === null || (applicant.itemLevel !== null && applicant.itemLevel >= minIlvl);
      const matchesFilled = !hideFilled || openRoles.has(applicant.role);

      return matchesSearch && matchesRole && matchesClass && matchesIlvl && matchesFilled;
    });
  }

  function renderRecommendations(analysis) {
    elements.recommendationsList.innerHTML = "";

    const filteredScores = filteredApplicantScores(analysis);
    elements.selectionCount.textContent = `${filteredScores.length}/${analysis.allScores.length} shown`;

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
        : scoreBadge(score);
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
            <button class="decline-button" type="button" data-decline-key="${escapeAttribute(declineKey)}" data-decline-name="${escapeAttribute(score.applicant.name)}" title="Hide this applicant for the current browser session">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.41L10.59 13.41 4.29 19.71 2.88 18.3 9.17 12 2.88 5.71 4.29 4.29l6.3 6.3 6.29-6.3z"/></svg>
              Decline
            </button>
          </div>
          <div class="candidate-meta"><span class="class-text ${applicantClass}">${escapeHtml(score.applicant.specName)} ${escapeHtml(score.applicant.className)}</span> - ${escapeHtml(score.applicant.role)}</div>
          ${perfStrip(score, analysis.target)}
          ${progressionStrip(score.applicant)}
          ${applicationNoteBlock(score.applicant)}
          <div class="reason-list">${displayReasons(score).slice(0, 4).map(reasonChip).join("")}</div>
        </div>
        ${scoreBadgeMarkup}
      `;
      elements.recommendationsList.append(row);
    }
  }

  function displayReasons(score) {
    return score.reasons;
  }

  function scoreBadge(score) {
    if (!score || score.total === null || score.total === undefined) {
      return '<div class="score-badge parse-none">-</div>';
    }
    return `<div class="score-badge ${scoreClass(score.total)}" title="${escapeAttribute(scoreBreakdownTitle(score))}">${score.total}</div>`;
  }

  function scoreBreakdownTitle(score) {
    const contributions = score.contributions || {};
    return [
      `Overall ${score.total}`,
      score.parse ? `Parse ${formatMetricScore(contributions.parse)} (${formatMetricScore(score.parse.points)} raw)` : "",
      score.kills ? `Kills ${formatMetricScore(contributions.kills)} (${formatMetricScore(score.kills.points)} raw)` : "",
      score.raiderIo ? `M+ 10s ${formatMetricScore(contributions.raiderIo)} (${formatMetricScore(score.raiderIo.points)} raw)` : "",
      score.buffs ? `Buff ${formatMetricScore(contributions.buffs)} (${formatMetricScore(score.buffs.points)} raw)` : "",
    ].filter(Boolean).join(" - ");
  }

  function averageScoreLabel(scores) {
    const values = (scores || [])
      .map((score) => score && score.total)
      .filter((value) => Number.isFinite(Number(value)));
    if (!values.length) return "-";

    const average = values.reduce((sum, value) => sum + Number(value), 0) / values.length;
    return String(Math.round(average));
  }

  function renderComposition(analysis) {
    const roles = ["Tank", "Healer", "DPS"];
    elements.roleMeters.innerHTML = "";
    elements.raidVisual.innerHTML = "";

    const target = analysis.target.roles;
    const currentCounts = analysis.currentRoleCounts || countRoles(analysis.roster);
    const dpsBreakdown = countMeleeRanged(analysis.roster);
    const averageScore = averageScoreLabel(analysis.rosterScores);
    elements.compLabel.textContent = `Target ${target.Tank}-${target.Healer}-${target.DPS}`;

    const summary = document.createElement("div");
    summary.className = "composition-summary";
    summary.innerHTML = `
      <span><strong>Current</strong>${roleCountLine(currentCounts)}</span>
      <span><strong>DPS Split</strong>${dpsBreakdown.melee} melee / ${dpsBreakdown.ranged} ranged${dpsBreakdown.unknown ? ` / ${dpsBreakdown.unknown} unk` : ""}</span>
      <span><strong>Avg Rating</strong>${averageScore}</span>
    `;
    elements.roleMeters.append(summary);

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
      header.innerHTML = `
        <span>${role}</span>
        <small>${groupedPeople[role].length}/${target[role] || 0}</small>
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
        const slot = document.createElement("div");
        slot.className = person
          ? `raid-slot ${roleClass(person.role)} ${personClass} current`
          : `raid-slot ${roleClass(role)} empty`;

        if (person) {
          const specLabel = person.specName ? `${person.specName} ` : "";
          slot.title = `Roster: ${person.name} - ${specLabel}${person.className} (${person.role})`;
          slot.innerHTML = `
            <span class="raid-slot-name class-text ${personClass}">${escapeHtml(person.name)}</span>
            <span class="raid-slot-meta">${escapeHtml(specLabel + person.className)}</span>
          `;
        } else {
          slot.title = `Open ${role} slot`;
          slot.innerHTML = `
            <span class="raid-slot-name">Open</span>
            <span class="raid-slot-meta">${escapeHtml(role)}</span>
          `;
        }

        grid.append(slot);
      }

      section.append(grid);
      elements.raidVisual.append(section);
    }
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
      <div>${rosterSortButton("progress", "Progress")}</div>
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
        <div>${scoreBadge(score)}</div>
        <div>${escapeHtml(member.role)}</div>
        <div>${formatIlvl(member.itemLevel)}</div>
        <div>${progressionLabel(member)}</div>
        ${perfColumns.map((column) => `<div>${performanceColumnCell(member, analysis.target, column, { compact: true })}</div>`).join("")}
        <div>${rosterLogStatus(member)}</div>
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
    if (key === "progress") return progressionSortValue(member);
    if (key.startsWith("avg:")) return bestPerfForDifficulty(member, analysis.target, Number(key.slice(4)));
    if (key.startsWith("boss:")) return bossParseForDifficulty(member, analysis.target, Number(key.slice(5)));
    if (key === "mythicAvg") return bestPerfForDifficulty(member, analysis.target, 5);
    if (key === "heroicAvg") return bestPerfForDifficulty(member, analysis.target, 4);
    if (key === "target") return member.primaryParse;
    if (key === "fallback") return member.fallbackParse;
    if (key === "status") return logStatusSortValue(member);
    return `${member.name || ""} ${member.realm || ""}`;
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

  function logStatusSortValue(member) {
    const order = {
      live: 1,
      manual: 2,
      pending: 3,
      fetching: 4,
      "no-data": 5,
      error: 6,
    };
    return order[member.logStatus] || 7;
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

  function progressionSortValue(person) {
    return RAID_DIFFICULTIES.reduce((sum, difficulty) => {
      const progress = progressForDifficulty(person, difficulty);
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

  function progressionStrip(applicant) {
    const label = progressionLabel(applicant);
    if (label === "-") return "";

    return `<div class="progression-strip">${progressionChips(applicant)}</div>`;
  }

  function progressionChips(person) {
    return RAID_DIFFICULTIES
      .map((difficulty) => progressionChip(progressForDifficulty(person, difficulty), difficulty))
      .filter(Boolean)
      .join("");
  }

  function progressionChip(progress, difficulty) {
    if (!progress || !progress.total) return "";
    const key = difficultyKey(difficulty);
    return `<span class="progress-chip ${key}">${progress.killed}/${progress.total}${difficultyAbbreviation(difficulty)}</span>`;
  }

  function progressionLabel(person) {
    const label = progressionChips(person);
    return label || "-";
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
    const perfCells = performanceColumns(target)
      .map((column) => performanceColumnCell(applicant, target, column))
      .join("");
    return `
      <div class="perf-strip" aria-label="Score detail">
        ${perfCells}
        <span title="${escapeAttribute(weightedMetricTitle("Parse", contributions.parse, score.parse.points, score.weights && score.weights.parse, parseSourceLabel(score.parse.source)))}"><strong>Parse</strong>${formatMetricScore(contributions.parse)}</span>
        <span title="${escapeAttribute(weightedMetricTitle("Kills", contributions.kills, score.kills.points, score.weights && score.weights.kills, killScoreTitle(score.kills)))}"><strong>Kills</strong>${formatMetricScore(contributions.kills)}</span>
        <span title="${escapeAttribute(weightedMetricTitle("M+ 10s", contributions.raiderIo, score.raiderIo.points, score.weights && score.weights.raiderIo, raiderIoScoreTitle(score.raiderIo)))}"><strong>M+ 10s</strong>${formatMetricScore(contributions.raiderIo)}</span>
        <span title="${escapeAttribute(weightedMetricTitle("Buff", contributions.buffs, score.buffs.points, score.weights && score.weights.buffs, buffScoreTitle(score.buffs)))}"><strong>Buff</strong>${formatMetricScore(contributions.buffs)}</span>
      </div>
    `;
  }

  function performanceColumns(target) {
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

    if (selected === 2) {
      columns.push({
        type: "avg",
        difficulty: 3,
        label: "Normal Avg",
        sortKey: "avg:3",
        title: "Normal raid average, with boss breakdown on hover",
      });
    }

    if (selected) {
      columns.push({
        type: "boss",
        difficulty: selected,
        label: difficultyShortName(selected),
        sortKey: `boss:${selected}`,
        title: `Selected boss at ${difficultyShortName(selected)} difficulty`,
      });
    }

    if (fallback) {
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
    if (column.type === "boss") {
      return bossDifficultyCell(applicant, target, column.difficulty, column.label, options);
    }

    return difficultySummaryCell(applicant, target, column.difficulty, column.label, options);
  }

  function weightedMetricTitle(label, contribution, rawScore, weight, detail) {
    const percentage = Math.round((Number(weight) || 0) * 100);
    return `${label}: ${formatMetricScore(contribution)} rating points (${formatMetricScore(rawScore)} raw x ${percentage}%)${detail ? ` - ${detail}` : ""}`;
  }

  function difficultySummaryCell(applicant, target, difficulty, label, options = {}) {
    const value = bestPerfForDifficulty(applicant, target, difficulty);
    const encounters = encounterRanksForDifficulty(applicant, difficulty);
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
    const encounters = encounterRanksForDifficulty(applicant, difficulty);
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

  function encounterRanksForDifficulty(applicant, difficulty) {
    const profile = profileForDifficulty(applicant.difficultyProfiles, difficulty);
    if (profile && Array.isArray(profile.encounterRanks)) return profile.encounterRanks;

    const encounters = legacyDifficultyValue(applicant, difficulty, "EncounterRanks");
    return Array.isArray(encounters) ? encounters : [];
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

  function formatRaiderIoCount(value) {
    const number = firstNumber(value);
    return number === null ? "-" : String(Math.max(0, Math.round(number)));
  }

  function killScoreTitle(score) {
    return `${score.kills || 0} ${score.label || "selected"} boss kills (${score.bucket || "0"} bucket)`;
  }

  function raiderIoScoreTitle(score) {
    if (!score || score.timedTenPlus === null || score.timedTenPlus === undefined) {
      return "No Raider.IO timed +10 data found";
    }
    return `${score.timedTenPlus} timed +10 keys found from Raider.IO run data`;
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

  function parseSourceLabel(source) {
    if (source === "primary") return "Using the selected boss and difficulty";
    if (source === "fallback") return "Using fallback difficulty for this boss";
    if (source === "higher") return "Using a higher-difficulty parse profile as an upgrade";
    return "No selected or fallback parse found";
  }

  function bossParseForDifficulty(applicant, target, difficulty) {
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
    const profile = profileForDifficulty(applicant.difficultyProfiles, difficulty);
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
    const profile = profileForDifficulty(applicant.difficultyProfiles, difficulty);
    if (profile && profile.medianPerfAvg !== null && profile.medianPerfAvg !== undefined) {
      return profile.medianPerfAvg;
    }

    const legacy = legacyDifficultyValue(applicant, difficulty, "MedianPerfAvg");
    if (legacy !== null && legacy !== undefined) return legacy;

    const encounter = encounterRankForDifficulty(applicant, difficulty, target && target.encounterId);
    return encounter ? encounter.medianPercent : null;
  }

  function progressForDifficulty(applicant, difficulty) {
    const profile = profileForDifficulty(applicant.difficultyProfiles, difficulty);
    if (profile && profile.progress) return profile.progress;
    return legacyDifficultyValue(applicant, difficulty, "Progress");
  }

  function legacyDifficultyValue(applicant, difficulty, suffix) {
    const key = difficultyKey(difficulty);
    if (!key) return null;
    return applicant[`${key}${suffix}`];
  }

  function encounterRankForDifficulty(applicant, difficulty, encounterId) {
    const encounters = encounterRanksForDifficulty(applicant, Number(difficulty));
    return encounters.find((encounter) => String(encounter.id) === String(encounterId || "")) || null;
  }

  function rosterLogStatus(member) {
    if (member.logStatus === "live") {
      const label = member.cacheHit ? "Cached" : member.resolvedZoneName || "Live";
      const title = member.cacheHit ? `Cached result${member.cacheExpiresInSeconds ? `, expires in ${formatDuration(member.cacheExpiresInSeconds)}` : ""}` : member.resolvedZoneName || "Live Warcraft Logs result";
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
    return String(value || "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
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
