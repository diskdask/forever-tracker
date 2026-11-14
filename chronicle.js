// Chronicle interactions. The shared roster state and formatting helpers live in app.js.
const chronicle = { snapshot: null, dungeonSquad: "a", party: new Set(), awardPeriod: "all", allAwards: false, allLegacy: false, expanded: null, ranges: {} };
const DAY = 86400000;
const recordLabels = { clear: "Cleared", partial: "Partial boss record", none: "No recorded clear", unknown: "Clear rule unverified", unavailable: "Profile unavailable" };
const recordMarks = { clear: "✓", partial: "◐", none: "—", unknown: "?", unavailable: "?" };
const memberById = id => state.members.find(m => String(m.id) === String(id));
const shortDate = value => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
const memberButton = (m, label = m.name) => `<button type="button" class="name-button" data-member="${m.id}">${escapeHTML(label)}</button>`;

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
  const cutoff = new Date(chronicle.snapshot.generatedAt).getTime() - 7 * DAY;
  const byMember = new Map();
  for (const m of state.members) {
    const history = m.history || [];
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1], now = history[i];
      if (new Date(now.at).getTime() < cutoff) continue;
      const parts = [], headlines = [];
      let mark = "✦";
      if (now.level > prev.level) {
        mark = "↑";
        headlines.push(`Level ${now.level}`);
        parts.push(`Level ${prev.level} → ${now.level} in the saved records.`);
      }
      for (const id of now.clears.filter(id => !prev.clears.includes(id))) {
        const d = chronicle.snapshot.config.dungeons.find(d => d.id === id);
        if (d) {
          if (parts.length === 0) mark = "⚑";
          headlines.push(`${d.name} clear`);
          parts.push(`A clear for ${d.name} now appears in the saved records.`);
        }
      }
      if (now.legacy && prev.legacy) {
        const added = now.legacy.filter(id => !prev.legacy.includes(id));
        if (added.length) {
          const names = (m.legacy?.challenges || []).filter(c => added.includes(c.id) && c.completed).map(c => c.name);
          if (parts.length === 0) mark = "✦";
          headlines.push(`${names.length || added.length} Legacy milestone${(names.length || added.length) === 1 ? "" : "s"}`);
          parts.push(names.length ? `Newly listed Legacy challenges: ${names.join(", ")}.` : `${added.length} Legacy completion${added.length === 1 ? " is" : "s are"} now in the saved records.`);
        }
      }
      for (const fact of FACTS) {
        const before = prev.stats?.[String(fact.id)], after = now.stats?.[String(fact.id)];
        if (before == null || after == null || after <= before) continue;
        if (parts.length === 0) mark = "☺";
        if (headlines.length < 3) headlines.push(`+${number(after - before)} ${fact.label.toLocaleLowerCase()}`);
        parts.push(`${fact.label.toLowerCase()}: +${number(after - before)} in the saved records.`);
      }
      if (parts.length) {
        const item = byMember.get(m.id) || { m, at: now.at, mark, parts: [], headlines: [], priority: 0 };
        item.at = now.at;
        if (item.parts.length === 0) item.mark = mark;
        item.parts.push(...parts);
        item.headlines.push(...headlines);
        item.priority = Math.max(item.priority, now.level > prev.level || now.clears.some(id => !prev.clears.includes(id)) ? 2 : now.legacy && prev.legacy && now.legacy.some(id => !prev.legacy.includes(id)) ? 1 : 0);
        byMember.set(m.id, item);
      }
    }
  }
  const events = [...byMember.values()].sort((a, b) => b.priority - a.priority || b.at.localeCompare(a.at) || a.m.name.localeCompare(b.m.name));
  byId("highlight-note").textContent = "Changes recorded in the last 7 days";
  byId("story-context").textContent = "These are changes between saved records. Dates show when a snapshot was saved, not necessarily when the adventure happened.";
  byId("highlight-grid").innerHTML = events.length ? events.slice(0, 6).map(e => `<article class="highlight-card"><span class="highlight-mark" aria-hidden="true">${e.mark}</span><time datetime="${e.at}">Record saved ${shortDate(e.at)}</time><h3>${escapeHTML(e.m.name)} · ${escapeHTML(e.headlines.slice(0, 2).join(" · ") || "A change in the saved records")}</h3><div class="highlight-person">${portrait(e.m)}${memberButton(e.m)}</div><ul class="story-points">${e.parts.slice(0, 5).map(part => `<li>${escapeHTML(part)}</li>`).join("")}</ul></article>`).join("") : `<article class="chapter-empty"><span class="highlight-mark" aria-hidden="true">✧</span><div><h3>A new chapter starts here.</h3><p>${chronicle.snapshot.historyStartedAt ? `Our saved records begin ${shortDate(chronicle.snapshot.historyStartedAt)}. The latest snapshots don’t show a change yet.` : "The first records are on their way."} Level progress, dungeon clears, funny stats, and Legacy milestones will appear here when the saved records change.</p><a class="text-button" href="#dungeons">Explore the dungeon journal →</a></div></article>`;
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
  const config = chronicle.snapshot.config;
  const assigned = new Set();
  const groups = (config.accounts || []).map(a => {
    const members = (a.characterIds || []).map(memberById).filter(Boolean).filter(m => !assigned.has(m.id));
    members.forEach(m => assigned.add(m.id));
    return { name: a.name, linked: true, members };
  }).filter(a => a.members.length);
  for (const m of state.members) if (!assigned.has(m.id)) groups.push({ name: m.name, linked: false, members: [m] });
  return groups.map(a => {
    const done = new Map();
    for (const m of a.members) for (const c of m.legacy?.challenges || []) if (c.completed) done.set(c.id, c);
    const known = a.members.some(m => m.legacy?.available);
    return { ...a, known, done: [...done.values()], points: done.size, stale: a.members.some(m => m.legacy?.stale || m.stale) };
  }).sort((a, b) => Number(b.known) - Number(a.known) || b.points - a.points || a.name.localeCompare(b.name));
}

function renderLegacy() {
  const accounts = legacyAccounts();
  const shown = chronicle.allLegacy ? accounts : accounts.slice(0, 6);
  const totalPoints = chronicle.snapshot.config.legacyTotalPoints || 65;
  const lastReward = chronicle.snapshot.config.legacyRewards.at(-1);
  byId("legacy-list").innerHTML = shown.map((a, i) => {
    const reward = chronicle.snapshot.config.legacyRewards.find(r => r.points > a.points);
    const percent = Math.min(100, a.points / totalPoints * 100);
    const progressLabel = reward
      ? `${a.points} / ${totalPoints} ${a.linked ? 'confirmed account points' : 'confirmed points on this character'} · next reward at ${reward.points}: ${escapeHTML(reward.name)} (${reward.points - a.points} more observed)`
      : `${a.points} / ${totalPoints} ${a.linked ? 'confirmed account points' : 'confirmed points on this character'} · all listed rewards reached at ${lastReward?.points || 0}`;
    const accountLabel = a.linked
      ? `${a.members.length} linked character${a.members.length === 1 ? '' : 's'}`
      : 'Character profile only · account unlinked';
    return `<div class="legacy-row"><span class="legacy-place">${a.known ? accounts.findIndex(b => b.known && b.points === a.points) + 1 : '—'}</span>${portrait(a.members[0])}<div class="legacy-person">${memberButton(a.members[0], a.name)}<small>${accountLabel}${a.stale ? ' · retained' : ''}</small>${a.known ? `<span class="legacy-progress" title="${a.points} of ${totalPoints} points observed"><span style="width:${percent}%"></span></span><small class="legacy-next-reward">${progressLabel}</small>` : '<small>Achievement data unavailable</small>'}</div><strong class="legacy-points">${a.known ? a.points : '—'}<small>PTS</small></strong></div>`;
  }).join("");
  byId("legacy-coverage").textContent = `${accounts.filter(a => a.known).length}/${accounts.length} entries with achievement data. Legacy points are account-wide; unlinked character profiles may omit points earned on other alts. Conflicting completion records are excluded.`;
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
    const coords = points.map(p => [58 + (new Date(p.at).getTime() - t0) / Math.max(1, t1 - t0) * 574, 126 - (p.xp.total - low) / Math.max(1, high - low) * 92]);
    chart = `<svg class="xp-chart" viewBox="0 0 660 160" role="img" aria-label="Observed cumulative XP over ${range} days; detailed observations follow"><line x1="58" y1="34" x2="632" y2="34" class="chart-grid"/><line x1="58" y1="126" x2="632" y2="126" class="chart-grid"/><text x="50" y="38" text-anchor="end">${number(high / 1000)}k</text><text x="50" y="130" text-anchor="end">${number(low / 1000)}k</text><path d="${coords.map((p, i) => `${i ? 'L' : 'M'}${p.join(',')}`).join(' ')}" class="chart-line"/>${coords.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="4"><title>${escapeHTML(formatDate(points[i].at))}: level ${points[i].level}, ${number(points[i].xp.current)} XP into level</title></circle>`).join('')}<text x="58" y="151">${shortDate(points[0].at)}</text><text x="632" y="151" text-anchor="end">${shortDate(points.at(-1).at)}</text></svg><p class="section-note">${number(Math.max(0, points.at(-1).xp.total - points[0].xp.total))} XP gained · ${Math.max(0, points.at(-1).level - points[0].level)} levels gained between these observations. Armory updates may be delayed.</p>`;
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
