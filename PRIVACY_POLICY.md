# Privacy Policy — Professor Ratings for Pitt

_Last updated: July 28, 2026_

## Summary

This extension does not collect, transmit, sell, or share any personal data.
There are no analytics, no telemetry, no accounts, and no servers operated by
the developer.

## What the extension does with data

**Page content.** The extension reads instructor names from the University of
Pittsburgh class search page in order to display ratings next to them. This
happens entirely inside your browser. No page content is sent to the developer
or any third party.

**RateMyProfessors lookups.** To display a rating, the extension sends the
instructor's name (and nothing else) to RateMyProfessors' public search
endpoint, the same one their website uses. Your identity is not attached to
these requests beyond what any ordinary web request includes. RateMyProfessors'
own privacy policy governs their handling of requests to their servers.

**AI model download.** If you enable local AI summaries, model weights are
downloaded once from Hugging Face's public content servers. This is a static
file download; no personal data is sent. After download, all AI processing
runs entirely on your device and works offline.

**Local storage.** Ratings and generated summaries are cached in your
browser's local extension storage so repeated searches are fast. This data
never leaves your machine, and you can clear it at any time from the
extension's popup ("Clear cached ratings") or by uninstalling the extension.

## What the extension does NOT do

- No collection of browsing history, personal information, or credentials
- No analytics or usage tracking of any kind
- No remote servers operated by the developer
- No data sales or sharing with third parties
- No processing of page content other than instructor names on class search pages

## Permissions explained

- **storage / unlimitedStorage** — cache ratings locally so repeated searches
  don't re-query RateMyProfessors
- **activeTab / scripting** — power the "point at the instructor field" repair
  tool, only when you click it in the popup
- **offscreen** — host the on-device AI model in a background document
- **Class-search page access** — the extension runs only on the University of
  Pittsburgh class search and course catalog pages (path-scoped), where it
  reads instructor names and displays badges. It cannot run on enrollment,
  grades, or other portal pages
- **Host access to ratemyprofessors.com** — fetch ratings
- **Host access to huggingface.co** — one-time AI model download

## Contact

Questions about this policy: [your email or GitHub issues URL]

## Changes

Material changes to this policy will be reflected in the extension's listing
and this document's date.
