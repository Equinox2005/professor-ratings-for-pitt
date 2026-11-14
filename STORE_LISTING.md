# Chrome Web Store Submission Guide

Everything to paste into the Developer Dashboard.

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
> entirely on your own machine (a one-time ~790 MB model download you trigger
> yourself), or you can turn it off and keep the statistics, which are always
> computed locally and always exact.
>
> Unofficial. Not affiliated with, endorsed by, or connected to the
> University of Pittsburgh or RateMyProfessors.

**Category:** Education. **Language:** English.

## Privacy tab

- Single purpose description: "Displays professor ratings and review summaries
  inside the University of Pittsburgh class search."
- Data usage: check NOTHING under data collection. The extension collects no
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
