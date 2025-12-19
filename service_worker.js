const PRESETS = {
  mobile: { width: 390, height: 844, badgeText: "M", title: "Mobile (390×844)" },
  tablet: { width: 768, height: 1024, badgeText: "T", title: "Tablet (768×1024)" }
};

const DEFAULT_PRESET_ID = "mobile";
const SELECTED_PRESET_KEY = "selectedPreset";

const storage = {
  async get(key) {
    return await chrome.storage.local.get(key);
  },
  async set(obj) {
    await chrome.storage.local.set(obj);
  },
  async remove(key) {
    await chrome.storage.local.remove(key);
  }
};

function restoreKey(windowId) {
  return `restoreBounds:${windowId}`;
}

async function setBadge(windowId, presetId) {
  try {
    const badgeText = presetId ? PRESETS[presetId]?.badgeText : "";
    await chrome.action.setBadgeText({ windowId, text: badgeText ?? "" });
    await chrome.action.setBadgeBackgroundColor({
      windowId,
      color: badgeText ? "#2563eb" : "#000000"
    });
  } catch {
    // Ignore badge failures (e.g., older Chrome versions).
  }
}

async function getSelectedPresetId() {
  const selected = await storage.get(SELECTED_PRESET_KEY);
  const presetId = selected?.[SELECTED_PRESET_KEY];
  return PRESETS[presetId] ? presetId : DEFAULT_PRESET_ID;
}

async function setSelectedPresetId(presetId) {
  if (!PRESETS[presetId]) return;
  await storage.set({ [SELECTED_PRESET_KEY]: presetId });
}

async function ensureNormalState(windowId) {
  const win = await chrome.windows.get(windowId);
  if (win.state !== "normal") {
    await chrome.windows.update(windowId, { state: "normal" });
  }
}

function captureBounds(win) {
  return {
    left: typeof win.left === "number" ? win.left : 0,
    top: typeof win.top === "number" ? win.top : 0,
    width: typeof win.width === "number" ? win.width : undefined,
    height: typeof win.height === "number" ? win.height : undefined,
    state: win.state
  };
}

async function applyPreset(windowId, presetId) {
  const preset = PRESETS[presetId] ?? PRESETS[DEFAULT_PRESET_ID];
  if (!preset) return;

  const win = await chrome.windows.get(windowId);
  const key = restoreKey(windowId);

  const existing = await storage.get(key);
  const restore = existing?.[key];

  const bounds = restore?.bounds ?? captureBounds(win);
  await storage.set({ [key]: { bounds, presetId, storedAt: restore?.storedAt ?? Date.now() } });

  await ensureNormalState(windowId);
  await chrome.windows.update(windowId, {
    left: bounds.left,
    top: bounds.top,
    width: preset.width,
    height: preset.height,
    focused: true
  });

  await setBadge(windowId, presetId);
}

async function restoreWindow(windowId, bounds) {
  await ensureNormalState(windowId);

  const { left, top, width, height, state } = bounds ?? {};

  await chrome.windows.update(windowId, {
    left: typeof left === "number" ? left : undefined,
    top: typeof top === "number" ? top : undefined,
    width: typeof width === "number" ? width : undefined,
    height: typeof height === "number" ? height : undefined,
    focused: true,
    state: "normal"
  });

  if (state && state !== "normal") {
    try {
      await chrome.windows.update(windowId, { state });
    } catch {
      // Some states may be disallowed depending on platform/window type.
    }
  }
}

async function toggleWindow(windowId) {
  const key = restoreKey(windowId);
  const existing = await storage.get(key);
  const restore = existing?.[key];

  if (restore?.bounds) {
    await restoreWindow(windowId, restore.bounds);
    await storage.remove(key);
    await setBadge(windowId, null);
    return;
  }

  const presetId = await getSelectedPresetId();
  await applyPreset(windowId, presetId);
}

const MENU_ID_MOBILE = "preset-mobile";
const MENU_ID_TABLET = "preset-tablet";
const MENU_ID_RESTORE = "restore";

async function setupContextMenus() {
  await chrome.contextMenus.removeAll();

  chrome.contextMenus.create({
    id: MENU_ID_MOBILE,
    title: PRESETS.mobile.title,
    contexts: ["action"]
  });
  chrome.contextMenus.create({
    id: MENU_ID_TABLET,
    title: PRESETS.tablet.title,
    contexts: ["action"]
  });
  chrome.contextMenus.create({
    id: "sep-1",
    type: "separator",
    contexts: ["action"]
  });
  chrome.contextMenus.create({
    id: MENU_ID_RESTORE,
    title: "Restore previous size",
    contexts: ["action"]
  });
}

chrome.action.onClicked.addListener(async (tab) => {
  const windowId = tab?.windowId;
  if (typeof windowId !== "number") return;

  try {
    await toggleWindow(windowId);
  } catch (err) {
    console.error("Toggle failed:", err);
    try {
      await storage.remove(restoreKey(windowId));
      await setBadge(windowId, null);
    } catch {
      // Ignore cleanup failures.
    }
  }
});

chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus().catch((err) => console.error("Context menu init failed:", err));
});

chrome.runtime.onStartup?.addListener(() => {
  setupContextMenus().catch((err) => console.error("Context menu init failed:", err));
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const windowId = tab?.windowId;
  if (typeof windowId !== "number") return;

  try {
    if (info.menuItemId === MENU_ID_MOBILE) {
      await setSelectedPresetId("mobile");
      await applyPreset(windowId, "mobile");
      return;
    }

    if (info.menuItemId === MENU_ID_TABLET) {
      await setSelectedPresetId("tablet");
      await applyPreset(windowId, "tablet");
      return;
    }

    if (info.menuItemId === MENU_ID_RESTORE) {
      const key = restoreKey(windowId);
      const existing = await storage.get(key);
      const restore = existing?.[key];
      if (!restore?.bounds) return;

      await restoreWindow(windowId, restore.bounds);
      await storage.remove(key);
      await setBadge(windowId, null);
    }
  } catch (err) {
    console.error("Context menu action failed:", err);
  }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  try {
    await storage.remove(restoreKey(windowId));
  } catch {
    // Ignore.
  }
});
