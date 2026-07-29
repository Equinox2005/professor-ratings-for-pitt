# Chrome Web Store Submission Guide

Everything to paste into the Developer Dashboard, plus what to expect from
review. Fields marked **[you]** need your input.

## Before you start

1. Developer account: https://chrome.google.com/webstore/devconsole — one-time
   $5 registration fee.
2. Host `PRIVACY_POLICY.md` somewhere with a stable URL (a GitHub repo is
   fine). The listing requires a privacy policy URL. **[you]**
3. Fill in the contact email in the privacy policy. **[you]**
4. Replace `homepage_url` in `manifest.json` with your real repo URL. **[you]**
5. Take 1–5 screenshots at 1280×800: badges in the results grid, and the open
   panel with a summary. Crop out anything personal. **[you]**

## Listing copy

**Name:** Professor Ratings for Pitt

**Summary (132 chars max):** already in the manifest.

**Description (suggested):**

> Stop alt-tabbing to RateMyProfessors while you register. This extension
> shows each professor's rating as a small badge right in Pitt's class
> search. Click a badge for the full picture: difficulty, would-take-again
> percentage, what students praise and complain about (with verbatim quotes),
> how the professor differs between courses, whether reviews are trending
> better or worse, and a short AI-written summary.
>
> Privacy first: there are no servers, no accounts, and no tracking. Ratings
> come directly from RateMyProfessors' public search. The AI summary runs
> entirely on your own machine (a one-time ~300 MB model download you trigger
> yourself) — or you can turn it off and keep the statistics, which are always
> computed locally and always exact.
>
> Unofficial. Not affiliated with, endorsed by, or connected to the
> University of Pittsburgh or RateMyProfessors.

**Category:** Education. **Language:** English.

## Privacy tab

- Single purpose description: "Displays professor ratings and review summaries
  inside the University of Pittsburgh class search."
- Data usage: check NOTHING under data collection — the extension collects no
  user data. Certify accordingly.
- Permission justifications (paste per field):
  - `storage`, `unlimitedStorage`: "Caches professor ratings locally so
    repeated searches do not re-query RateMyProfessors. No data leaves the
    device."
  - `activeTab`, `scripting`: "Powers an optional user-invoked repair tool:
    the user clicks a button in the popup, then clicks the instructor field so
    the extension can locate it if the university changes its page layout."
  - `offscreen`: "Hosts the on-device AI model in a background document so it
    survives service worker shutdown. All inference is local."
  - Content script match (`pitcsprd.csps.pitt.edu/ps*/…/WEBLIB_HCX_CM*`):
    "Runs only on the class search and course catalog pages to read instructor
    names and inject rating badges. The match pattern is path-scoped so the
    extension cannot execute on enrollment, grades, or any other student
    portal page."
  - Host `ratemyprofessors.com`: "Fetches the professor's public rating and
    reviews."
  - Host `huggingface.co` / `hf.co`: "One-time download of the open-source AI
    model weights the user explicitly requests. Static file download only."

## Security posture (worth stating in the listing and any Reddit post)

A student posting a similar extension to r/Pitt drew exactly the scrutiny to
expect, and this extension is built to pass it:

- **Cannot touch enrollment or grades.** The content script's match pattern is
  path-scoped to the class-search/catalog weblib (`WEBLIB_HCX_CM`). Enrollment
  lives under a different weblib, so the extension does not run there — this
  is enforced by the browser, not by promises in the code.
- **Read-only on the page.** The code reads instructor names and appends
  badges. It never fills, clicks, or submits anything, and there is no code
  path that dispatches events into the host page.
- **No Pitt host permissions at all.** The only hosts the extension can fetch
  from are RateMyProfessors (ratings) and Hugging Face (one-time model
  download the user triggers).
- **Auditable.** Ship the source zip alongside the store listing (GitHub) so
  anyone can verify the above, the way commenters in that thread did.
- **On "extensions can invisibly update":** true of every extension; the
  mitigations are a published changelog per version and the source repo. Say
  so plainly rather than dodging it.

## Honest review-risk assessment

- **RateMyProfessors data.** The extension uses RMP's internal GraphQL
  endpoint; there is no public API. Many extensions doing exactly this are
  live on the store, so approval is the norm — but RMP could object at any
  time, which would surface as a takedown, not a rejection. Usage here is
  deliberately light: rate-limited, cached two weeks, one lookup per
  professor.
- **Trademarks.** "for Pitt" naming plus the explicit non-affiliation
  disclaimer follows the accepted pattern. Leading with "Pitt ..." would risk
  an impersonation flag; don't rename it back.
- **`unlimitedStorage`** is a benign permission (no install warning), but a
  reviewer may ask; the justification above answers it.
- **Review time:** usually a few days; host permissions can stretch it to a
  couple of weeks. Don't resubmit while pending — it resets the queue.

## Packaging

Upload `dist/professor-ratings-for-pitt-v1.0.0.zip` (built by `pack.sh`).
It excludes tests, docs, and dev files; the store wants only what runs.

## After approval

- Updates: bump `version` in the manifest, rebuild, upload. Review of updates
  is usually faster than initial review.
- If Pitt changes their page and badges stop appearing, users can self-repair
  with the picker; a proper fix means adding a fixture to
  `tests/detect.test.mjs` and adjusting a strategy.
