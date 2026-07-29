const KEY = 'settings';

export const DEFAULTS = {
  schoolName: 'University of Pittsburgh',
  schools: [],             // [{id, name}] -- every campus in the family
  schoolLabel: '',         // human-readable, for the options page
  // Whether Qwen2.5-0.5B writes the summary paragraph. Off still gives the
  // full statistics, aspect breakdown, and verbatim quotes -- those are always
  // computed locally and never depend on a model.
  aiSummaries: true,
  autoDownloadModel: false, // require an explicit click before a ~300 MB pull
  minRatingsForSummary: 3, // don't summarize 1 comment, it's just the comment
  customSelectors: [],     // CSS selectors added by the element picker
  debug: false,
  hideWhenNotFound: false, // if true, show nothing instead of a "no rating" chip
};

export async function getSettings() {
  const bag = await chrome.storage.local.get(KEY);
  return { ...DEFAULTS, ...(bag[KEY] || {}) };
}

export async function setSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}
