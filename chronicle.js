// Chronicle interactions. The shared roster state and formatting helpers live in app.js.
const chronicle = { snapshot: null, dungeonSquad: "a", party: new Set(), awardPeriod: "all", allAwards: false, allLegacy: false, allActivity: false, expanded: null, ranges: {} };
const DAY = 86400000;
const ACTIVITY_PRIORITY = { dungeon: 5, profession: 4, legacy: 4, level: 3, mischief: 1 };
const PROFESSION_MILESTONES = [50, 100, 150, 200, 250, 300, 350, 400, 450, 500];
const FUNNY_STAT_MILESTONES = {
  1518: [100, 500, 1000], 114: [10, 25, 50], 918: [5, 10, 25], 94: [10, 25, 50],
  1066: [25, 50, 100], 1043: [25, 50, 100], 353: [25, 50, 100], 108: [100, 500, 1000],
  344: [25, 100, 250], 588: [100, 500, 1000],
};
const recordLabels = { clear: "Cleared", partial: "Partial boss record", none: "No recorded clear", unknown: "Clear rule unverified", unavailable: "Profile unavailable" };
const recordMarks = { clear: "✓", partial: "◐", none: "—", unknown: "?", unavailable: "?" };
const memberById = id => state.members.find(m => String(m.id) === String(id));
const shortDate = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
};
const shortDateTime = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date and time unavailable" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
};
const memberButton = (m, label = m.name) => `<button type="button" class="name-button" data-member="${m.id}">${escapeHTML(label)}</button>`;

function milestoneCrossed(before, after, milestones) {
  if (before == null || after == null || !Number.isFinite(Number(before)) || !Number.isFinite(Number(after)) || Number(after) <= Number(before)) return null;
  return milestones.filter(value => Number(before) < value && Number(after) >= value).at(-1) ?? null;
}

function detectProfessionMilestone(before, after) {
  if (!Array.isArray(before) || !Array.isArray(after)) return null;
  const previous = new Map(before.filter(p => p && typeof p.name === "string").map(p => [p.name.trim().toLocaleLowerCase(), p]));
  for (const profession of after) {
    if (!profession || typeof profession.name !== "string") continue;
    const prior = previous.get(profession.name.trim().toLocaleLowerCase());
    if (!prior) continue;
    const skill = milestoneCrossed(prior.skill, profession.skill, PROFESSION_MILESTONES);
    if (skill !== null) return { name: profession.name, skill };
  }
  return null;
}

function selectLatestActivity(candidates) {
  const valid = candidates.filter(candidate => Number.isFinite(Date.parse(candidate.at)));
  if (!valid.length) return null;
  const latest = Math.max(...valid.map(candidate => Date.parse(candidate.at)));
  return valid.filter(candidate => Date.parse(candidate.at) === latest)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || (a.sequence || 0) - (b.sequence || 0))[0];
}

function orderActivityRows(rows) {
  return [...rows].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.memberOrder - b.memberOrder);
}

function activityCandidate({ at, category, headline, sequence }) {
  return { at, category, headline, sequence, priority: ACTIVITY_PRIORITY[category] || 0 };
}

function funnyMilestoneHeadline(fact, milestone) {
  if (fact.id === 94) return `abandoned their ${number(milestone)}th quest`;
  if (fact.id === 1518) return `caught their ${number(milestone)}th fish`;
  if (fact.id === 108) return `killed their ${number(milestone)}th critter`;
  if (fact.id === 1066) return `used /lol for the ${number(milestone)}th time`;
  if (fact.id === 1043) return `rolled Greed ${number(milestone)} times`;
  if (fact.id === 353) return `used a Hearthstone ${number(milestone)} times`;
  if (fact.id === 114) return `reached ${number(milestone)} fall-damage deaths`;
  if (fact.id === 918) return `reached ${number(milestone)} dungeon deaths`;
  if (fact.id === 344) return `used ${number(milestone)} bandages`;
  if (fact.id === 588) return `earned ${number(milestone)} honorable kills`;
  return `reached ${number(milestone)} ${fact.label.toLocaleLowerCase()}`;
}

function portrait(m) {
  const url = typeof m.avatarUrl === "string" && m.avatarUrl.startsWith("https://render.worldofwarcraft.com/") ? m.avatarUrl : "";
  return `<span class="character-avatar" style="--class-color:${CLASS_COLORS[m.className] || '#aaa194'}"><span class="avatar-fallback">${escapeHTML(initials(m.name))}</span>${url ? `<img class="character-portrait" src="${escapeHTML(url)}" alt="" loading="lazy">` : ""}</span>`;
}

function xpBar(m, detailed = false) {
  if (!m.xp) return `<span class="xp-unavailable">XP unavailable</span>`;
  const xp = m.xp;
  const label = xp.capped ? "Level cap reached" : `${number(xp.current)} / ${number(xp.required)} XP`;
  return `<span class="xp-track" role="progressbar" aria-label="${escapeHTML(m.name)}: ${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${xp.percent}"><span style="width:${xp.percent}%"></span></span><span class="xp-caption">${xp.capped ? "Level cap" : detailed ? label + ` · ${Math.floor(xp.percent)}%` : `${Math.floor(xp.percent)}% to ${m.level + 1}`}${m.stale ? " · retained" : ""}</span>`;
}

function weekStart() {
  const date = new Date(chronicle.snapshot.generatedAt);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.getTime();
}

function weeklyValue(m, id) {
  if (m.stale || !m.dataAvailable) return null;
  const points = (m.history || []).filter(p => new Date(p.at).getTime() >= weekStart());
  if (points.length < 2) return null;
  const values = points.map(p => p.stats[String(id)]);
  if (values.some((v, i) => v == null || (i > 0 && v < values[i - 1]))) return null;
  return values.at(-1) - values[0];
}

function renderAwards() {
  const weekly = chronicle.awardPeriod === "week";
  const facts = chronicle.allAwards ? FACTS : FACTS.slice(0, 4);
  byId("trivia-grid").innerHTML = facts.map(fact => {
    const ranked = state.members.map(m => ({ m, value: weekly ? weeklyValue(m, fact.id) : stat(m, fact.id) }))
      .filter(row => row.value != null && row.value > 0).sort((a, b) => b.value - a.value || a.m.name.localeCompare(b.m.name));
    const leader = ranked[0];
    const ties = leader ? ranked.filter(row => row.value === leader.value) : [];
    const next = leader ? ranked.find(row => row.value < leader.value) : null;
    return `<article class="trivia-card"><span class="trivia-mark" aria-hidden="true">${fact.mark}</span><div class="trivia-label">${fact.label}</div><div class="trivia-description">${escapeHTML(fact.text)}</div><strong class="trivia-value">${leader ? number(leader.value) : "—"}</strong><div class="trivia-leader">${ties.length ? ties.map(row => memberButton(row.m)).join(", ") : weekly ? "Waiting for recorded activity" : "No records yet"}</div>${ties.length > 1 ? '<small>Shared lead</small>' : next ? `<small>${memberButton(next.m)} · ${number(leader.value - next.value)} behind</small>` : ""}</article>`;
  }).join("");
  byId("award-coverage").textContent = weekly ? "Observed gains since Monday (UTC), or each character’s first observation this week. Two records needed; resets and missing counters are excluded." : "Lifetime character records. Select a name to open their chronicle.";
  byId("more-awards").textContent = chronicle.allAwards ? "Show featured awards ↑" : "See all 10 awards ↓";
  byId("more-awards").setAttribute("aria-expanded", String(chronicle.allAwards));
}

function renderHighlights() {
  const snapshotTime = Date.parse(chronicle.snapshot.generatedAt);
  const cutoff = Number.isFinite(snapshotTime) ? snapshotTime - 7 * DAY : Infinity;
  const selected = [];
  for (const [memberOrder, m] of state.members.entries()) {
    const history = m.history || [];
    const candidates = [];
    let sequence = 0;
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1], now = history[i];
      const recordedAt = Date.parse(now.at);
      if (!Number.isFinite(recordedAt) || recordedAt < cutoff || recordedAt > snapshotTime) continue;
      const newClears = (now.clears || []).filter(id => !(prev.clears || []).includes(id));
      if (newClears.length) {
        const names = newClears.map(id => chronicle.snapshot.config.dungeons.find(d => d.id === id)?.name).filter(Boolean);
        if (names.length) candidates.push(activityCandidate({ at: now.at, category: "dungeon", headline: `cleared ${names.join(" and ")}`, sequence: sequence++ }));
      }
      const profession = detectProfessionMilestone(prev.professions, now.professions);
      if (profession) candidates.push(activityCandidate({ at: now.at, category: "profession", headline: `reached ${number(profession.skill)} ${profession.name}`, sequence: sequence++ }));
      if (Array.isArray(now.legacy) && Array.isArray(prev.legacy)) {
        const added = now.legacy.filter(id => !prev.legacy.includes(id));
        if (added.length) {
          const names = (m.legacy?.challenges || []).filter(c => added.includes(c.id) && c.completed && !c.conflicting).map(c => c.name);
          const headline = names.length ? `completed ${names.slice(0, 2).join(" and ")}${names.length > 2 ? ` and ${names.length - 2} more Legacy challenges` : ""}` : `recorded ${added.length} Legacy challenge${added.length === 1 ? "" : "s"}`;
          candidates.push(activityCandidate({ at: now.at, category: "legacy", headline, sequence: sequence++ }));
        }
      }
      if (prev.level != null && now.level != null && Number.isFinite(Number(prev.level)) && Number.isFinite(Number(now.level)) && now.level > prev.level) {
        candidates.push(activityCandidate({ at: now.at, category: "level", headline: `reached level ${now.level}, up from ${prev.level}`, sequence: sequence++ }));
      }
      for (const fact of FACTS) {
        const before = prev.stats?.[String(fact.id)], after = now.stats?.[String(fact.id)];
        const milestone = milestoneCrossed(before, after, FUNNY_STAT_MILESTONES[fact.id] || []);
        if (milestone !== null) candidates.push(activityCandidate({ at: now.at, category: "mischief", headline: funnyMilestoneHeadline(fact, milestone), sequence: sequence++ }));
      }
    }
    const chosen = selectLatestActivity(candidates);
    if (chosen) selected.push({ ...chosen, m, memberOrder });
  }
  const events = orderActivityRows(selected);
  const shown = chronicle.allActivity ? events : events.slice(0, 8);
  const categories = {
    dungeon: { mark: "⚑", label: "Dungeon clear" }, profession: { mark: "⚒", label: "Profession" },
    legacy: { mark: "✦", label: "Legacy milestone" }, level: { mark: "↑", label: "Level up" },
    mischief: { mark: "☺", label: "Guild mischief" },
  };
  byId("highlight-grid").innerHTML = shown.length ? shown.map(e => {
    const category = categories[e.category];
    return `<article class="activity-row" data-category="${e.category}"><span class="activity-symbol" aria-hidden="true">${category.mark}</span><div class="activity-copy"><span class="activity-category">${category.label}</span><p>${memberButton(e.m)} <span>${escapeHTML(e.headline)}</span></p></div><time datetime="${escapeHTML(new Date(e.at).toISOString())}" title="Snapshot recorded ${escapeHTML(formatDate(e.at))}">Recorded ${escapeHTML(shortDateTime(e.at))}</time></article>`;
  }).join("") : `<article class="chapter-empty"><span class="highlight-mark" aria-hidden="true">✧</span><div><h3>A new chapter starts here.</h3><p>${chronicle.snapshot.historyStartedAt ? `Our saved records begin ${shortDate(chronicle.snapshot.historyStartedAt)}. The latest snapshots don’t show a change yet.` : "The first records are on their way."} Level progress, dungeon clears, profession and Legacy milestones, and notable guild mischief will appear when supported by saved records.</p><a class="text-button" href="#dungeons">Explore the dungeon journal →</a></div></article>`;
  const more = byId("more-activity");
  more.hidden = events.length <= 8;
  more.textContent = chronicle.allActivity ? "Show less activity" : "Show more activity";
  more.setAttribute("aria-expanded", String(chronicle.allActivity));
}

function dungeonMembers() {
  return state.members.filter(m => chronicle.party.size ? chronicle.party.has(String(m.id)) : chronicle.dungeonSquad === "all" || squadOf(m) === chronicle.dungeonSquad);
}

function dungeonRecord(m, d) {
  return m.dungeons?.[d.id] || { status: "unavailable", bosses: [], ruleKnown: false };
}

function renderDungeons() {
  const members = dungeonMembers();
  const maxLevel = Math.max(0, ...members.map(m => m.level || 0));
  const catalogue = chronicle.snapshot.config.dungeons;
  const shown = catalogue.filter(d => byId("all-dungeons").checked || d.min <= maxLevel || members.some(m => ["clear", "partial"].includes(dungeonRecord(m, d).status)));
  const cleared = shown.filter(d => members.some(m => dungeonRecord(m, d).status === "clear")).length;
  byId("dungeon-summary").textContent = `${cleared} dungeons cleared · ${members.length} characters`;
  byId("party-count").textContent = chronicle.party.size ? `${chronicle.party.size} selected · overrides squad filter` : "No characters selected";
  document.querySelectorAll("[data-dungeon-squad]").forEach(b => b.setAttribute("aria-pressed", String(!chronicle.party.size && b.dataset.dungeonSquad === chronicle.dungeonSquad)));
  byId("dungeon-grid").innerHTML = `<caption class="sr-only">Dungeon completion records. Rows are dungeons; columns are characters.</caption><colgroup><col class="dungeon-name-column">${members.map(() => '<col class="dungeon-member-column">').join("")}</colgroup><thead><tr><th scope="col" class="dungeon-name-heading">DUNGEON <span>Recommended levels</span></th>${members.map(m => `<th scope="col"><button type="button" class="grid-character" data-member="${m.id}" title="Open ${escapeHTML(m.name)}"><span>${portrait(m)}</span><span>${escapeHTML(m.name.split(" ")[0])}</span><small>Lv. ${m.level ?? "?"}</small></button></th>`).join("")}</tr></thead><tbody>${shown.map(d => `<tr><th scope="row"><button type="button" class="dungeon-name" data-dungeon="${d.id}">${escapeHTML(d.name)}</button><span class="dungeon-range">${d.min}–${d.max}${d.territory === "ALLIANCE" ? ' · Alliance territory' : ''}</span></th>${members.map(m => {
    const r = dungeonRecord(m, d);
    return `<td><button type="button" class="record-cell ${r.status}" data-record="${d.id}" data-record-member="${m.id}" aria-label="${escapeHTML(m.name + ' · ' + d.name + ': ' + recordLabels[r.status])}${r.stale ? ', retained record' : ''}">${recordMarks[r.status]}${r.stale ? '<sup>*</sup>' : ''}</button></td>`;
  }).join("")}</tr>`).join("")}</tbody>`;
  if (!members.length) byId("dungeon-grid").innerHTML = '<caption>No characters in this group.</caption>';
  const recommendations = catalogue.map(d => {
    const eligible = members.filter(m => m.level >= d.min && m.level <= d.max && dungeonRecord(m, d).status !== "unavailable");
    const needs = eligible.filter(m => ["none", "partial"].includes(dungeonRecord(m, d).status));
    return { d, eligible, needs };
    }).filter(row => row.needs.length && row.d.finalBosses.length && row.d.territory !== "ALLIANCE")
    .sort((a, b) => b.needs.length - a.needs.length || b.eligible.length - a.eligible.length || a.d.min - b.d.min).slice(0, 3);
  byId("dungeon-suggestions").innerHTML = recommendations.length ? recommendations.map(({ d, eligible, needs }) => `<button type="button" class="suggestion-card" data-suggested-dungeon="${d.id}"><span class="dungeon-range">LEVELS ${d.min}–${d.max}</span><strong>${escapeHTML(d.name)}</strong><span>${needs.length} without a clear · ${eligible.length} in level range</span><span class="suggestion-arrow" aria-hidden="true">↗</span></button>`).join("") : '<p class="section-note">No unfinished records in this group’s recommended level ranges. Try selecting a different mix of characters.</p>';
}

function showDungeon(id, memberId, suggested = false) {
  const d = chronicle.snapshot.config.dungeons.find(d => d.id === id);
  if (!d) return;
  const members = memberId ? [memberById(memberId)].filter(Boolean) : dungeonMembers();
  byId("record-title").textContent = d.name;
  const candidate = m => m.level >= d.min && m.level <= d.max && !["clear", "unavailable"].includes(dungeonRecord(m, d).status);
  const renderEvidence = m => {
    const r = dungeonRecord(m, d);
    const inRange = m.level >= d.min && m.level <= d.max;
    return `<article class="boss-record"><div class="boss-record-heading">${memberButton(m)}<span class="${r.status}">${recordMarks[r.status]} ${recordLabels[r.status]}</span></div><p class="section-note">Level ${m.level} · ${inRange ? "Within recommended range" : "Outside recommended range"}${r.stale ? " · Retained from an earlier refresh" : ""}</p>${r.bosses.length ? `<ul>${r.bosses.map(b => `<li><span>${escapeHTML(b.name)}</span><strong>${number(b.kills)} kills</strong>${b.updatedAt ? `<small>Counter updated ${shortDate(b.updatedAt)}</small>` : ""}</li>`).join("")}</ul>` : `<p class="section-note">${r.status === "unavailable" ? "Blizzard did not return this character’s detailed profile." : r.status === "clear" ? "Clear recorded; no matching boss counter is available." : "No matching boss kills were returned. This does not prove the character has never visited."}</p>`}</article>`;
  };
  const intro = `<p class="eyebrow small-eyebrow">RECOMMENDED LEVELS ${d.min}–${d.max}</p><p class="section-note">${d.finalBosses.length ? `A recorded clear requires: ${escapeHTML(d.finalBosses.join(" and "))}.` : "Final-boss mapping is not yet confirmed. Any boss activity is shown as partial progress."} Counters show character records, not a log of individual runs.</p>`;
  if (suggested) {
    const first = members.filter(candidate);
    const rest = members.filter(m => !candidate(m));
    const focus = first.length ? `<section class="suggested-focus"><h3>In range · no recorded clear <span>${first.length}</span></h3><ul class="suggested-candidates">${first.map(m => {
      const r = dungeonRecord(m, d);
      return `<li>${portrait(m)}${memberButton(m)}<span>Lv. ${m.level}</span><span class="${r.status}">${recordMarks[r.status]} ${recordLabels[r.status]}</span></li>`;
    }).join("")}</ul></section>` : `<p class="dialog-empty">No in-range character currently lacks a recorded clear in the available profiles.</p>`;
    const details = `<details class="suggested-evidence"><summary>Other characters and boss evidence (${members.length})</summary>${members.map(renderEvidence).join("")}</details>`;
    byId("record-content").innerHTML = `${intro}${focus}${details}`;
  } else {
    byId("record-content").innerHTML = `${intro}${members.map(renderEvidence).join("")}`;
  }
  if (!byId("record-dialog").open) byId("record-dialog").showModal();
}

function legacyAccounts() {
  return state.members.map(m => {
    const done = new Map();
    for (const c of m.legacy?.challenges || []) if (c.completed && !c.conflicting) done.set(c.id, c);
    const known = Boolean(m.legacy?.available);
    return { name: m.name, linked: false, members: [m], known, done: [...done.values()], points: done.size, stale: Boolean(m.legacy?.stale || m.stale) };
  }).sort((a, b) => Number(b.known) - Number(a.known) || b.points - a.points || a.name.localeCompare(b.name));
}

function renderLegacy() {
  const accounts = legacyAccounts();
  const shown = chronicle.allLegacy ? accounts : accounts.slice(0, 6);
  const totalPoints = chronicle.snapshot.config.legacyTotalPoints || 65;
  byId("legacy-list").innerHTML = shown.map(a => {
    const percent = Math.min(100, a.points / totalPoints * 100);
    const member = a.members[0];
    const status = `Character records only${a.stale ? " · retained" : a.known ? "" : " · unavailable"}`;
    const points = a.known ? `${a.points} / ${totalPoints}` : `— / ${totalPoints}`;
    const progress = a.known
      ? `<span class="legacy-progress" role="progressbar" aria-label="${escapeHTML(a.name)} Legacy points" aria-valuemin="0" aria-valuemax="${totalPoints}" aria-valuenow="${a.points}" title="${a.points} of ${totalPoints} points confirmed"><span style="width:${percent}%"></span></span>`
      : `<span class="legacy-progress" title="Achievement data unavailable"><span></span></span>`;
    return `<div class="legacy-row">${portrait(member)}<div class="legacy-person">${memberButton(member, a.name)}<small>${status}</small></div><div class="legacy-progress-column"><strong class="legacy-points">${points}</strong>${progress}</div></div>`;
  }).join("");
  byId("more-legacy").textContent = chronicle.allLegacy ? "Show leading entries ↑" : "See the full ledger ↓";
  byId("more-legacy").setAttribute("aria-expanded", String(chronicle.allLegacy));
  byId("more-legacy").hidden = accounts.length <= 6;
}

function historyHTML(m) {
  const range = chronicle.ranges[m.id] || 7;
  const cutoff = new Date(chronicle.snapshot.generatedAt).getTime() - range * DAY;
  const points = (m.history || []).filter(p => p.xp && new Date(p.at).getTime() >= cutoff);
  let chart = '<div class="chart-empty">No XP observations in this period.</div>';
  if (points.length === 1) chart = `<div class="chart-empty"><span class="baseline-dot"></span><strong>First entry saved</strong><span>Level ${points[0].level} · ${number(points[0].xp.current)} XP into the level</span><small>${formatDate(points[0].at)} · The next refresh will begin the chart.</small></div>`;
  if (points.length > 1) {
    const low = Math.min(...points.map(p => p.xp.total)), high = Math.max(...points.map(p => p.xp.total));
    const t0 = new Date(points[0].at).getTime(), t1 = new Date(points.at(-1).at).getTime();
    const mobile = window.matchMedia("(max-width: 610px)").matches;
    const chartWidth = mobile ? Math.max(292, (window.innerWidth || 320) - 28) : Math.max(320, Math.min(900, (window.innerWidth || 1000) - 100));
    const xLeft = 102, xRight = chartWidth - 18, yTop = 40, yBottom = 148;
    const flat = high === low;
    const coords = points.map(p => [xLeft + (new Date(p.at).getTime() - t0) / Math.max(1, t1 - t0) * (xRight - xLeft), flat ? (yTop + yBottom) / 2 : yBottom - (p.xp.total - low) / (high - low) * (yBottom - yTop)]);
    const axis = flat
      ? `<line x1="${xLeft}" y1="94" x2="${xRight}" y2="94" class="chart-grid"/><text x="94" y="98" text-anchor="end">${number(high)}</text>`
      : `<line x1="${xLeft}" y1="${yTop}" x2="${xRight}" y2="${yTop}" class="chart-grid"/><line x1="${xLeft}" y1="${yBottom}" x2="${xRight}" y2="${yBottom}" class="chart-grid"/><text x="94" y="${yTop + 5}" text-anchor="end">${number(high)}</text><text x="94" y="${yBottom + 5}" text-anchor="end">${number(low)}</text>`;
    const gained = Math.max(0, points.at(-1).xp.total - points[0].xp.total);
    const summary = flat ? "No XP gain recorded between these observations." : `${number(gained)} XP gained · ${Math.max(0, points.at(-1).level - points[0].level)} levels gained between these observations. Armory updates may be delayed.`;
    chart = `<svg class="xp-chart" viewBox="0 0 ${chartWidth} 196" role="img" aria-label="Observed cumulative XP${flat ? `: ${number(high)} XP at each observation` : ` from ${number(low)} to ${number(high)} XP`} over ${range} days; detailed observations follow">${axis}<path d="${coords.map((p, i) => `${i ? 'L' : 'M'}${p.join(',')}`).join(' ')}" class="chart-line"/>${coords.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="4"><title>${escapeHTML(formatDate(points[i].at))}: level ${points[i].level}, ${number(points[i].xp.current)} XP into level</title></circle>`).join('')}<text class="chart-date" x="${xLeft}" y="184">${shortDate(points[0].at)}</text><text class="chart-date" x="${xRight}" y="184" text-anchor="end">${shortDate(points.at(-1).at)}</text></svg><p class="section-note">${summary}</p>`;
  }
  return `<div class="detail-heading"><h3>XP progression</h3><div class="segmented" role="group" aria-label="XP history period">${[7, 30].map(days => `<button type="button" data-history-days="${days}" data-history-member="${m.id}" aria-pressed="${range === days}">${days} days</button>`).join('')}</div></div><div class="detail-xp">${xpBar(m, true)}</div>${chart}${points.length ? `<details class="observation-log"><summary>Recorded observations (${points.length})</summary><table><thead><tr><th>Date</th><th>Level</th><th>XP into level</th></tr></thead><tbody>${[...points].reverse().map(p => `<tr><td>${formatDate(p.at)}</td><td>${p.level}</td><td>${number(p.xp.current)}</td></tr>`).join('')}</tbody></table></details>` : ''}`;
}

function characterDetails(m) {
  const records = chronicle.snapshot.config.dungeons.filter(d => ["clear", "partial"].includes(dungeonRecord(m, d).status));
  const account = legacyAccounts().find(a => a.members.some(n => n.id === m.id));
  const conflicts = (m.legacy?.challenges || []).filter(c => c.conflicting).length;
  return `<div class="character-detail" id="detail-${m.id}"><div class="detail-intro"><div><p class="eyebrow small-eyebrow">THE CHARACTER CHRONICLE</p><h3>${escapeHTML(m.name)}</h3><p class="section-note">${escapeHTML(m.className)} · ${squadName(squadOf(m))} · ${m.dataCollectedAt ? 'Profile recorded ' + formatDate(m.dataCollectedAt) : 'Detailed profile unavailable'}${m.stale ? ' · Retained record' : ''}</p></div><a class="text-button" href="https://worldofwarcraft.blizzard.com/en-us/forever/eu/armory/character/${encodeURIComponent(m.slug)}" target="_blank" rel="noreferrer">Official armory ↗</a></div><div id="history-${m.id}">${historyHTML(m)}</div><div class="detail-columns"><section><h3>Dungeon records</h3><div class="record-chips">${records.map(d => `<button type="button" class="record-chip ${dungeonRecord(m, d).status}" data-record="${d.id}" data-record-member="${m.id}">${recordMarks[dungeonRecord(m, d).status]} ${escapeHTML(d.name)}</button>`).join('') || '<p class="section-note">No boss records available yet.</p>'}</div></section><section><h3>Legacy · ${account?.known ? account.points + ' observed points' : 'unavailable'}</h3><p class="section-note">${account?.linked ? 'Shared with ' + account.members.map(n => escapeHTML(n.name)).join(', ') : 'Account not linked. These are challenges visible on this character.'}</p><div class="record-chips">${(account?.done || []).map(c => `<span class="record-chip clear" title="${escapeHTML(c.description)}">✓ ${escapeHTML(c.name)}</span>`).join('') || '<p class="section-note">No confirmed challenges to display.</p>'}</div>${conflicts ? `<p class="section-note">${conflicts} conflicting completion record(s) excluded until confirmed.</p>` : ''}</section><section><h3>Professions</h3><div class="profession-list">${(m.professions || []).map(p => `<span class="profession-chip">${escapeHTML(p.name)} <em>${number(p.skill)} / ${number(p.maxSkill)}</em></span>`).join('') || '<p class="section-note">No profession records available.</p>'}</div></section></div></div>`;
}

function openCharacter(id, toggle = false) {
  const m = memberById(id);
  if (!m) return;
  if (byId("record-dialog").open) byId("record-dialog").close();
  if (!visibleMembers().some(n => n.id === m.id)) {
    state.squadFilter = "all"; state.query = ""; state.classFilter = "";
    byId("roster-search").value = ""; byId("class-filter").value = "";
    renderSquadSwitch();
  }
  chronicle.expanded = toggle && chronicle.expanded === m.id ? null : m.id;
  renderRoster();
  const button = byId(`character-toggle-${m.id}`);
  button?.focus({ preventScroll: true });
  button?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
}

function initChronicle(snapshot) {
  chronicle.snapshot = snapshot;
  const detailed = state.members.filter(m => m.dataAvailable).length;
  const unavailable = state.members.filter(m => !m.dataAvailable && !m.stale);
  const retained = state.members.filter(m => m.stale);
  byId("coverage-summary").textContent = `${detailed}/${state.members.length} detailed profiles · ${unavailable.length} unavailable${retained.length ? ` · ${retained.length} retained` : ""}`;
  const coverageParts = [];
  if (unavailable.length) coverageParts.push(`<section><h3>Profiles unavailable (${unavailable.length})</h3><p>These characters remain on the roster, but Blizzard did not return a detailed profile in the latest refresh.</p><ul>${unavailable.map(m => `<li>${memberButton(m)}</li>`).join("")}</ul></section>`);
  if (retained.length) coverageParts.push(`<section><h3>Retained records (${retained.length})</h3><p>These profiles show the last saved details because a newer refresh was unavailable.</p><ul>${retained.map(m => `<li>${memberButton(m)}</li>`).join("")}</ul></section>`);
  if (!coverageParts.length) coverageParts.push("<p>All listed character profiles were available in the latest refresh.</p>");
  byId("coverage-list").innerHTML = coverageParts.join("");
  byId("profile-coverage").hidden = !unavailable.length && !retained.length;
  byId("party-options").innerHTML = state.members.map(m => `<label class="party-choice"><input type="checkbox" value="${m.id}" data-party-member><span>${escapeHTML(m.name)}<small>Lv. ${m.level} ${escapeHTML(m.className)} · ${squadName(squadOf(m))}</small></span></label>`).join('');
  byId("class-filter").innerHTML += [...new Set(state.members.map(m => m.className))].sort().map(name => `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join('');
  document.addEventListener("error", event => {
    if (event.target.matches?.(".character-portrait")) event.target.hidden = true;
  }, true);
  document.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.member) openCharacter(button.dataset.member);
    if (button.dataset.toggleMember) openCharacter(button.dataset.toggleMember, true);
    if (button.dataset.suggestedDungeon) showDungeon(button.dataset.suggestedDungeon, null, true);
    if (button.dataset.dungeon) showDungeon(button.dataset.dungeon);
    if (button.dataset.record) showDungeon(button.dataset.record, button.dataset.recordMember);
    if (button.dataset.historyDays) {
      const m = memberById(button.dataset.historyMember);
      chronicle.ranges[m.id] = Number(button.dataset.historyDays);
      byId(`history-${m.id}`).innerHTML = historyHTML(m);
      byId(`history-${m.id}`).querySelector(`[data-history-days="${chronicle.ranges[m.id]}"]`).focus();
    }
    if (button.dataset.dungeonSquad) {
      chronicle.dungeonSquad = button.dataset.dungeonSquad; chronicle.party.clear();
      document.querySelectorAll('[data-party-member]').forEach(input => input.checked = false);
      renderDungeons();
    }
    if (button.dataset.awardPeriod) {
      chronicle.awardPeriod = button.dataset.awardPeriod;
      document.querySelectorAll('[data-award-period]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
      renderAwards();
    }
    if (button.id === "more-activity") {
      chronicle.allActivity = !chronicle.allActivity;
      renderHighlights();
      byId("more-activity").focus();
    }
  });
  byId("all-dungeons").addEventListener("change", renderDungeons);
  byId("party-options").addEventListener("change", event => {
    if (!event.target.matches('[data-party-member]')) return;
    event.target.checked ? chronicle.party.add(event.target.value) : chronicle.party.delete(event.target.value);
    renderDungeons();
  });
  byId("clear-party").addEventListener("click", () => {
    chronicle.party.clear(); document.querySelectorAll('[data-party-member]').forEach(i => i.checked = false); renderDungeons();
  });
  byId("more-awards").addEventListener("click", () => { chronicle.allAwards = !chronicle.allAwards; renderAwards(); });
  byId("more-legacy").addEventListener("click", () => { chronicle.allLegacy = !chronicle.allLegacy; renderLegacy(); });
  byId("close-record").addEventListener("click", () => byId("record-dialog").close());
  byId("record-dialog").addEventListener("click", event => { if (event.target === byId("record-dialog")) byId("record-dialog").close(); });
  renderHighlights(); renderDungeons(); renderLegacy();
}
