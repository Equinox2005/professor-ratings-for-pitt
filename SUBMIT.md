# Submitting to the Chrome Web Store — step by step

Follow top to bottom. Steps marked **[you]** need something only you can do.
Budget about 90 minutes for everything before the wait.

---

## Step 0 — Before you touch the dashboard

**0a. Run the build for a few days. [you]**
Load `source-vX.Y.Z.zip` unpacked and actually register with it. Updates get
reviewed too, so a bug found now is far cheaper than one found after launch.

**0b. Put the source on GitHub. [you]**
Create a public repo, push the source zip contents. You need it for two
reasons: the privacy policy needs a stable URL, and when people ask "is this
safe" (they will — see the r/Pitt thread), a link to readable source is the
only answer that satisfies anyone.

**0c. Fill in the placeholders. [you]**
- `PRIVACY_POLICY.md` → replace `[your email or GitHub issues URL]`
- `manifest.json` → replace `"homepage_url": "https://github.com/"` with your repo
- Re-run `./pack.sh` after editing so the zips contain your changes

**0d. Get the privacy policy URL. [you]**
Once pushed, the URL is:
`https://github.com/YOURNAME/YOURREPO/blob/main/PRIVACY_POLICY.md`
Open it in a private window to confirm it loads without logging in.

**0e. Screenshots. [you]**
Required: at least one, exactly **1280×800** or 640×400. Take 3–5:
1. The class-search grid with rating badges visible (the money shot)
2. An open panel showing the summary, aspects, and per-course breakdown
3. The ranking tab expanded
4. The settings page

On macOS: `Cmd+Shift+4`, then Space, click the window, and crop to 1280×800 in
Preview. On Windows: Snipping Tool, then resize in Paint. **Crop out your name,
student ID, and anything else personal** — reviewers see these, and so does
everyone else.

---

## Step 1 — Register the developer account ($5)

1. Go to **https://chrome.google.com/webstore/devconsole**
2. Sign in with the Google account you want to own this permanently. Use a
   personal account, not your Pitt one — you lose access to school accounts
   after graduation and the listing goes with it.
3. You'll see a registration prompt. Accept the **Chrome Web Store Developer
   Agreement**.
4. Pay the **$5 one-time fee** (card or Google Pay). It's per-account, not per
   extension, and it is not refundable.
5. Verify your email if prompted.

Registration usually activates immediately. If it hangs, wait a few minutes and
reload — don't pay twice.

---

## Step 2 — Create the listing

1. In the dashboard, click **Items** → **+ New Item**.
2. Upload `dist/professor-ratings-for-pitt-vX.Y.Z.zip` — the **store** zip, not
   the source zip. The store zip excludes tests and docs on purpose.
3. Wait for the upload to process. Manifest errors surface here; if the upload
   is rejected, the message names the field.

---

## Step 3 — Store listing tab

- **Description** — paste the long description from `STORE_LISTING.md`.
- **Category** — Education
- **Language** — English
- **Screenshots** — upload the ones from step 0e
- **Icon** — pulled from the manifest automatically (128×128)
- **Small promo tile (440×280)** — optional, skip it for now

---

## Step 4 — Privacy tab (this is where submissions get held up)

**4a. Single purpose:**
> Displays professor ratings and review summaries inside the University of
> Pittsburgh class search.

**4b. Permission justifications** — paste from `STORE_LISTING.md`. There's one
per permission; leaving any blank blocks submission.

**4c. Data usage** — check **nothing**. This extension collects no user data.
Then tick all three certification boxes:
- Not selling or transferring data to third parties beyond approved uses
- Not using or transferring data for purposes unrelated to the single purpose
- Not using or transferring data to determine creditworthiness or for lending

**4d. Privacy policy URL** — the GitHub URL from step 0d.

---

## Step 5 — Distribution tab

- **Visibility: Public**
- **Distribution: All regions** (or just United States — makes no practical
  difference for a Pitt tool)
- Leave "mature content" unchecked

---

## Step 6 — Submit

1. Click **Submit for review** (top right).
2. If it's greyed out, a required field is missing — the dashboard lists which.
3. Choose **immediate publish on approval** unless you want to time the launch.

---

## Step 7 — The wait

- Typically a few days; host permissions can push it to two weeks.
- **Do not resubmit while pending.** It resets your place in the queue.
- Rejections come by email with a policy code. Most are fixable by rewording a
  justification, not by changing code. Fix, bump the version, re-upload.

---

## Step 8 — After approval

**Announce it.** The r/Pitt thread you found proves the audience is there and
that the top question is branch campuses — which yours handles and that one
didn't. Lead with that.

Expect the same security questions that thread got. The **Security posture**
section in `STORE_LISTING.md` is written to be pasted as a reply.

**Shipping updates:**
1. Make the change, run all five test suites
2. Bump `version` in `manifest.json`
3. `./pack.sh`
4. Dashboard → your item → **Package** → upload new zip → submit

Update reviews are usually faster than the first one.

---

## If badges stop working mid-semester

Pitt changes their page, users see nothing. Recovery path:
1. Popup → **Point at the instructor field** lets users self-repair immediately
2. For a real fix: add the new markup as a fixture in `tests/detect.test.mjs`,
   watch it fail, adjust a strategy in `src/content.js`, ship an update
