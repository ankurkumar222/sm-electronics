# Project Moto — by Chunmun
## Airtable Edition — Setup Guide
Client: Lalli · Developer: Chunmun

No fuzzy matching in this version — name matching is exact-text, using a
small manually-maintained "Known Spellings" list instead of an algorithm.
This is intentional: simpler to trust, simpler to fix by hand.

---

## 0. What you're building

```
  ┌───────────────┐     ┌───────────────────┐     ┌───────────────────┐
  │  Import the    │     │  Click "Run       │     │  Open the          │
  │  same 2 Excel  │ ──▶ │   Report" script  │ ──▶ │  Report_Summary    │
  │  files (as-is) │     │  (1 button)        │     │  grid — that IS    │
  │                │     │                    │     │  the report        │
  └───────────────┘     └───────────────────┘     └───────────────────┘
```

No dashboard, no Interface, no Slack, no other tool. One Airtable base,
one script, one grid view. That grid view's shareable link IS what you
send to the CTO/CXO (or export it as CSV/PDF straight from Airtable).

---

## 1. Create these 8 tables

Create a new Airtable base called **"Moto — Billing Summary"** and add
these tables with these EXACT field names (spelling and capitalisation
matter — the script reads fields by name).

### Table: `Global_Settings`
*(Only ever has ONE row — the current month's settings)*

| Field                          | Type          | Notes                                              |
|---------------------------------|---------------|-----------------------------------------------------|
| Reporting Month                 | Single select | Options: Jan, Feb, Mar, Apr, May, Jun, **July**, Aug, **Sept**, Oct, Nov, Dec — spelled exactly as targets.xlsx spells them |
| FY Suffix                       | Single line   | e.g. `FY2627` — copy from the column header in targets.xlsx |
| Mouser Default Target (Lakhs)   | Number        | e.g. `13`                                          |
| JNS Keyword                     | Single line   | Default: `JNS`                                     |

### Table: `Report_Roster`
*(This is your entire "who's in the report" control panel)*

| Field                              | Type          | Notes                                                        |
|--------------------------------------|---------------|-----------------------------------------------------------------|
| Canonical Name *(primary field)*    | Single line   | e.g. `Kuldeep Kumar` — exactly how it should print in the report |
| Include in Report                   | Checkbox      | Tick = shows up in Report_Summary                             |
| Report Order                        | Number        | 1, 2, 3… controls row order                                    |
| Mouser Target Override (Lakhs)      | Number        | Leave blank to use the default guess                           |
| Known Spellings                     | Long text     | Comma-separated raw spellings seen in the files, e.g. `KULDEEP KUMAR` |

> **Handling a spelling variant (e.g. "DHIRENDRA" vs "DHIRENDER"):**
> Just add both spellings, comma-separated, into one person's **Known
> Spellings** field. No algorithm — you're telling Airtable directly.

### Table: `Targets_Raw`
*(Re-imported fresh from targets.xlsx every month — full overwrite)*

| Field            | Type   |
|-------------------|--------|
| Currency           | Single select (INR / USD / DIRECT) |
| Sales Incharge     | Single line |
| Customer Name      | Single line |
| Apr_FY..._Val … Mar_FY..._Val | Number *(one field per month, 12 total — import all of them, names must match the Excel headers exactly)* |

### Tables: `Line_Raw` and `Mouser_Raw`
*(Re-imported fresh from the Billing Report's Line/MOUSER sheets)*

| Field                  | Type   |
|--------------------------|--------|
| Sales Employee Name       | Single line |
| Basic Value                | Number |

### Table: `USD_Raw`

| Field              | Type   |
|----------------------|--------|
| Sales Employee        | Single line |
| Customer Name          | Single line |
| Row Total in USD        | Number |

### Table: `Direct_Raw`

| Field           | Type   |
|-------------------|--------|
| Sales Person        | Single line |
| Row Total in USD      | Number |

### Table: `Report_Summary` ← **THIS is the report**

| Field              | Type          |
|----------------------|---------------|
| Person                | Single line   |
| Category               | Single select (INR (Cr) / USD-SG (M$) / USD-Direct (M$) / Mouser (Lakhs) / JNS-TFT (M$)) |
| Target                  | Number        |
| Achievement              | Number        |
| Achievement %             | Formula: `IF({Target}, {Achievement}/{Target})` — format as Percent |
| Reporting Month            | Single line   |

**Set up the view once, reuse forever:**
Group by `Reporting Month` → then `Person`. Add row-coloring on
`Achievement %` (Airtable Grid → Color records → by Achievement %:
green ≥100%, yellow 70–99%, red <70%). This IS your green/yellow/red
report, permanently, with zero manual formatting each month.

### Table: `Validation_Log`

| Field              | Type          |
|----------------------|---------------|
| Reporting Month        | Single line   |
| Severity                 | Single select (OK / Warning) |
| Message                   | Long text     |

Filter this view to `Severity = Warning` and pin it next to
Report_Summary — that's your "read before sending" checklist, always
up to date.

---

## 2. Install the script

1. Open the base → **Extensions** → **+ Add an extension** → **Scripting**.
2. Delete the placeholder code, paste in the full contents of
   `Moto_Airtable_Script.js` (provided alongside this guide).
3. Click **Run** once to test — you should see a green summary line
   at the bottom like: `✅ Done. 20 report rows written for Aug'26. 1 warning(s)...`
4. Pin the script (Extensions → the "..." menu → **Move to dashboard**
   or just leave it in Extensions) so it's one click every month.

---

## 3. The monthly routine (for a non-technical user)

```
  STEP 1                    STEP 2                     STEP 3
  ┌────────────────┐        ┌───────────────────┐      ┌──────────────────┐
  │ Open each _Raw  │        │ Update             │      │ Click ▶ Run on    │
  │ table → grid    │  ──▶   │ Global_Settings:   │  ──▶ │ the script         │
  │ view → "Import  │        │ set Reporting Month│      │ extension           │
  │ data" → pick    │        │ (and FY Suffix if  │      │                     │
  │ this month's    │        │ it changed)        │      │                     │
  │ Excel file      │        │                    │      │                     │
  └────────────────┘        └───────────────────┘      └──────────────────┘
```

Then:

- Open **Validation_Log**, filter to `Warning` — read every line.
- Open **Report_Summary**, filter to this month — that's the finished
  report. Share the view link, or **Grid view → ⋯ → Download CSV**
  if someone needs a file.

Nobody touches code. Nobody opens a notebook. Nobody types a formula.

---

## 4. What's hardcoded vs automatic (Airtable edition)

| 🔒 Hardcoded — edit by hand, in a table row       | 🤖 Automatic — script figures it out |
|------------------------------------------------------|------------------------------------------|
| `Report_Roster` — who's shown, in what order          | Which target row belongs to which currency bucket |
| `Global_Settings` → Mouser default + overrides         | Basic Value vs Total Value (always Basic Value) |
| `Global_Settings` → JNS keyword                          | JNS-TFT carve-out                          |
| `Known Spellings` — exact-match name variants            | All Target vs Achievement math              |
| Reporting Month (picked each month, not detected)         | Reconciliation checks + anomaly flags       |

The one deliberate trade vs the Python version: **month is picked by a
human from a dropdown**, not auto-detected from invoice dates. A wrong
click is easier to catch than a wrong auto-guess — and it costs one
extra click a month.

---

## 5. Known limitations (be upfront about these)

- **No fuzzy matching** — a brand-new spelling variant that isn't in
  `Known Spellings` yet will show up as its own separate, unrecognised
  name. The script flags this in `Validation_Log` every time — it
  won't silently lose anyone's billing, but it does need a human to
  add the spelling once.
- **Airtable's free/plus plans cap records per base** — targets.xlsx
  alone is ~1,500 rows; check your plan's row limit before scaling to
  many more months of history in one base. Archive old `*_Raw` data
  periodically if needed (Report_Summary and Validation_Log are small
  and can be kept indefinitely).
- **The "Sales Changes" reassignment flag** in targets.xlsx is still
  not decoded — same known ~1-2% target drift as the Python version,
  for the same handful of people, until someone explains that column.
