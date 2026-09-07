// ============================================================================
//  PROJECT MOTO — by Chunmun — Airtable Scripting "Brain"
//  Client: Lalli · Developer: Chunmun
// ----------------------------------------------------------------------------
//  Paste this whole file into an Airtable "Scripting" extension and click Run.
//
//  What it does, in order:
//   1. Reads Global_Settings (which month, FY suffix, Mouser default, JNS word)
//   2. Reads Report_Roster (who's in the report + their exact-match aliases)
//   3. Sums targets.xlsx-imported rows (Targets_Raw) by Currency + person
//   4. Sums the Billing Report sheets (Line/Mouser/USD/Direct_Raw) by person,
//      using Basic Value (not Total Value) and carving JNS out of USD-SG
//   5. Writes the result into Report_Summary (that table IS the report)
//   6. Writes reconciliation + anomaly checks into Validation_Log
//
//  NOTE: No fuzzy/algorithmic name matching. Matching is EXACT TEXT against
//  the "Known Spellings" list on Report_Roster. Anything unrecognised gets
//  flagged in Validation_Log rather than guessed at.
// ============================================================================

const CR = 10000000;      // INR Crore
const LAKH = 100000;      // INR Lakh
const MILL = 1000000;     // USD Million

const H1_MONTHS = ['Apr', 'May', 'Jun', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

// ---------------------------------------------------------------------------
// 1. GLOBAL SETTINGS
// ---------------------------------------------------------------------------
const settingsTable = base.getTable('Global_Settings');
const settingsResult = await settingsTable.selectRecordsAsync();
if (settingsResult.records.length === 0) {
    throw new Error('Global_Settings has no rows. Add one row with Reporting Month, FY Suffix, etc.');
}
const settings = settingsResult.records[0];

const monthPrefix = settings.getCellValueAsString('Reporting Month');       // e.g. "Aug"
const fySuffix = settings.getCellValueAsString('FY Suffix');                // e.g. "FY2627"
const mouserDefault = settings.getCellValue('Mouser Default Target (Lakhs)') || 13;
const jnsKeyword = (settings.getCellValueAsString('JNS Keyword') || 'JNS').toUpperCase();

if (!monthPrefix || !fySuffix) {
    throw new Error('Global_Settings needs both "Reporting Month" and "FY Suffix" filled in.');
}

// Calendar year shown in the report label: Apr-Dec use the FY's first year,
// Jan-Feb-Mar use its second year (FY2627 = Apr'26 .. Mar'27).
const yearDigits = H1_MONTHS.includes(monthPrefix) ? fySuffix.slice(2, 4) : fySuffix.slice(4, 6);
const monthLabel = `${monthPrefix}'${yearDigits}`;
const valFieldName = `${monthPrefix}_${fySuffix}_Val`;   // e.g. "Aug_FY2627_Val"

output.text(`Reporting month: ${monthLabel}   (reading target column "${valFieldName}")`);

// ---------------------------------------------------------------------------
// 2. REPORT ROSTER  (report membership + exact-match name aliases)
// ---------------------------------------------------------------------------
const rosterTable = base.getTable('Report_Roster');
const rosterResult = await rosterTable.selectRecordsAsync();

const nameMap = {};      // "RAW NAME UPPERCASE" -> "Canonical Display Name"
const rosterInfo = {};   // "Canonical Display Name" -> {include, order, mouserOverride}

for (const rec of rosterResult.records) {
    const canonical = (rec.name || '').trim();
    if (!canonical) continue;

    nameMap[canonical.toUpperCase()] = canonical;

    const spellingsRaw = rec.getCellValueAsString('Known Spellings') || '';
    for (const s of spellingsRaw.split(',')) {
        const clean = s.trim().toUpperCase();
        if (clean) nameMap[clean] = canonical;
    }

    rosterInfo[canonical] = {
        include: !!rec.getCellValue('Include in Report'),
        order: rec.getCellValue('Report Order') ?? 999,
        mouserOverride: rec.getCellValue('Mouser Target Override (Lakhs)'),
    };
}

const unrecognised = new Set();

function resolveName(raw) {
    if (!raw) return null;
    const trimmed = raw.trim();
    const key = trimmed.toUpperCase();
    if (nameMap[key]) return nameMap[key];
    unrecognised.add(trimmed);
    return trimmed;   // still totalled, just flagged as unrecognised later
}

// ---------------------------------------------------------------------------
// 3. HELPER: group-and-sum
// ---------------------------------------------------------------------------
function sumBy(records, nameField, valueField, divisor, filterFn) {
    const totals = {};
    for (const rec of records) {
        if (filterFn && !filterFn(rec)) continue;
        const person = resolveName(rec.getCellValueAsString(nameField));
        if (!person) continue;
        const raw = rec.getCellValue(valueField);
        const val = typeof raw === 'number' ? raw : 0;
        totals[person] = (totals[person] || 0) + val / divisor;
    }
    return totals;
}

function rawSum(records, valueField) {
    return records.reduce((s, r) => {
        const v = r.getCellValue(valueField);
        return s + (typeof v === 'number' ? v : 0);
    }, 0);
}

// ---------------------------------------------------------------------------
// 4. TARGETS  (from Targets_Raw)
// ---------------------------------------------------------------------------
const targetsTable = base.getTable('Targets_Raw');
const targetsResult = await targetsTable.selectRecordsAsync();
const allTargetRows = targetsResult.records;

const isInr = r => r.getCellValueAsString('Currency') === 'INR';
const isUsd = r => r.getCellValueAsString('Currency') === 'USD';
const isDirect = r => r.getCellValueAsString('Currency') === 'DIRECT';
const isJns = r => (r.getCellValueAsString('Customer Name') || '').toUpperCase().includes(jnsKeyword);

const targetInr = sumBy(allTargetRows, 'Sales Incharge', valFieldName, CR, isInr);
const usdTargetRows = allTargetRows.filter(isUsd);
const targetUsdSg = sumBy(usdTargetRows, 'Sales Incharge', valFieldName, MILL);
const targetJns = sumBy(usdTargetRows.filter(isJns), 'Sales Incharge', valFieldName, MILL);
const targetDirect = sumBy(allTargetRows, 'Sales Incharge', valFieldName, MILL, isDirect);

output.text(`Targets  — INR: ${Object.values(targetInr).reduce((a,b)=>a+b,0).toFixed(2)} Cr   `
          + `USD-SG: ${Object.values(targetUsdSg).reduce((a,b)=>a+b,0).toFixed(2)} M$   `
          + `Direct: ${Object.values(targetDirect).reduce((a,b)=>a+b,0).toFixed(3)} M$`);

// ---------------------------------------------------------------------------
// 5. ACHIEVEMENT  (from Line / Mouser / USD / Direct _Raw)
// ---------------------------------------------------------------------------
const lineResult = await base.getTable('Line_Raw').selectRecordsAsync();
const achInr = sumBy(lineResult.records, 'Sales Employee Name', 'Basic Value', CR);

const mouserResult = await base.getTable('Mouser_Raw').selectRecordsAsync();
const achMou = sumBy(mouserResult.records, 'Sales Employee Name', 'Basic Value', LAKH);

const usdResult = await base.getTable('USD_Raw').selectRecordsAsync();
const isJnsAch = r => (r.getCellValueAsString('Customer Name') || '').toUpperCase().includes(jnsKeyword);
const achUsdSg = sumBy(usdResult.records, 'Sales Employee', 'Row Total in USD', MILL, r => !isJnsAch(r));
const achJns = sumBy(usdResult.records, 'Sales Employee', 'Row Total in USD', MILL, isJnsAch);

const directResult = await base.getTable('Direct_Raw').selectRecordsAsync();
const achDirect = sumBy(directResult.records, 'Sales Person', 'Row Total in USD', MILL);

output.text(`Achievement — INR: ${Object.values(achInr).reduce((a,b)=>a+b,0).toFixed(2)} Cr   `
          + `USD-SG: ${Object.values(achUsdSg).reduce((a,b)=>a+b,0).toFixed(2)} M$   `
          + `JNS-TFT: ${Object.values(achJns).reduce((a,b)=>a+b,0).toFixed(3)} M$`);

// ---------------------------------------------------------------------------
// 6. MOUSER TARGETS — only for people included in the report
// ---------------------------------------------------------------------------
const targetMou = {};
for (const [canonical, info] of Object.entries(rosterInfo)) {
    if (!info.include) continue;
    targetMou[canonical] = (info.mouserOverride !== null && info.mouserOverride !== undefined)
        ? info.mouserOverride
        : mouserDefault;
}

// ---------------------------------------------------------------------------
// 7. ASSEMBLE THE REPORT ROWS  (display roster only, in Report Order)
// ---------------------------------------------------------------------------
const CATEGORIES = [
    { label: 'INR (Cr)',        target: targetInr,    ach: achInr },
    { label: 'USD-SG (M$)',     target: targetUsdSg,  ach: achUsdSg },
    { label: 'USD-Direct (M$)', target: targetDirect, ach: achDirect },
    { label: 'Mouser (Lakhs)',  target: targetMou,    ach: achMou },
];
// JNS-TFT is summary-only in the reference report; include it as its own
// pseudo "person-less" row set only if there's anything to show.
const hasJns = Object.keys(targetJns).length > 0 || Object.keys(achJns).length > 0;

const displayRoster = Object.entries(rosterInfo)
    .filter(([, info]) => info.include)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([name]) => name);

if (displayRoster.length === 0) {
    throw new Error('No one is marked "Include in Report" in Report_Roster.');
}

// ---------------------------------------------------------------------------
// 8. WRITE Report_Summary — wipe this month's old rows first
// ---------------------------------------------------------------------------
const summaryTable = base.getTable('Report_Summary');
const summaryResult = await summaryTable.selectRecordsAsync();
const staleRows = summaryResult.records.filter(r => r.getCellValueAsString('Reporting Month') === monthLabel);

for (let i = 0; i < staleRows.length; i += 50) {
    await summaryTable.deleteRecordsAsync(staleRows.slice(i, i + 50));
}

const round = v => (v == null ? null : Math.round(v * 1e6) / 1e6);

const newRows = [];
for (const person of displayRoster) {
    for (const cat of CATEGORIES) {
        newRows.push({ fields: {
            'Person': person,
            'Category': { name: cat.label },
            'Target': round(cat.target[person] ?? null),
            'Achievement': round(cat.ach[person] || 0),
            'Reporting Month': monthLabel,
        }});
    }
}
if (hasJns) {
    // JNS-TFT is company-wide, not broken down per person — one summary row.
    const t = Object.values(targetJns).reduce((a, b) => a + b, 0);
    const a = Object.values(achJns).reduce((a2, b) => a2 + b, 0);
    newRows.push({ fields: {
        'Person': '— Company total —',
        'Category': { name: 'JNS-TFT (M$)' },
        'Target': round(t),
        'Achievement': round(a),
        'Reporting Month': monthLabel,
    }});
}

for (let i = 0; i < newRows.length; i += 50) {
    await summaryTable.createRecordsAsync(newRows.slice(i, i + 50));
}

// ---------------------------------------------------------------------------
// 9. VALIDATION / RECONCILIATION  →  Validation_Log
// ---------------------------------------------------------------------------
const logs = [];
function reconcile(label, achMap, rawTotal) {
    const computed = Object.values(achMap).reduce((a, b) => a + b, 0);
    const diff = computed - rawTotal;
    const ok = Math.abs(diff) < 0.01;
    logs.push({
        severity: ok ? 'OK' : 'Warning',
        message: `${label}: per-person sum ${computed.toFixed(4)} vs raw sheet total `
                + `${rawTotal.toFixed(4)} (diff ${diff.toFixed(4)})`,
    });
}

reconcile('INR achievement', achInr, rawSum(lineResult.records, 'Basic Value') / CR);
reconcile('Mouser achievement', achMou, rawSum(mouserResult.records, 'Basic Value') / LAKH);
reconcile(
    'USD-SG + JNS-TFT achievement',
    { ...achUsdSg, __jns__: Object.values(achJns).reduce((a, b) => a + b, 0) },
    rawSum(usdResult.records, 'Row Total in USD') / MILL
);
reconcile('USD-Direct achievement', achDirect, rawSum(directResult.records, 'Row Total in USD') / MILL);

// Unrecognised names — anyone billing/targeted under a spelling not in Report_Roster
for (const raw of unrecognised) {
    logs.push({
        severity: 'Warning',
        message: `Unrecognised name "${raw}" — not found in any Report_Roster "Known Spellings" `
                + `list. Their numbers are still counted in reconciliation totals above, but won't `
                + `appear as a named person anywhere. Add this spelling to the right person's row.`,
    });
}

// Billing with no target, or wildly over target
for (const person of displayRoster) {
    for (const cat of CATEGORIES) {
        const t = cat.target[person];
        const a = cat.ach[person] || 0;
        if ((t === null || t === undefined || t === 0) && a > 0) {
            logs.push({ severity: 'Warning', message: `${person}: has ${cat.label} billing but no target set.` });
        }
        if (t && a / t > 3) {
            logs.push({ severity: 'Warning', message: `${person}: ${cat.label} achievement is ${(a / t * 100).toFixed(0)}% of target — please verify this billing.` });
        }
    }
}

const logRows = logs.map(l => ({ fields: {
    'Reporting Month': monthLabel,
    'Severity': { name: l.severity },
    'Message': l.message,
}}));
for (let i = 0; i < logRows.length; i += 50) {
    await base.getTable('Validation_Log').createRecordsAsync(logRows.slice(i, i + 50));
}

// ---------------------------------------------------------------------------
// 10. DONE
// ---------------------------------------------------------------------------
const warningCount = logs.filter(l => l.severity === 'Warning').length;
output.text(`✅ Done. ${newRows.length} Report_Summary rows written for ${monthLabel}. `
          + `${warningCount} warning(s) — check Validation_Log before sharing the report.`);
