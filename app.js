const CLASS_COLORS = {
  Warrior: "#c89a69", Paladin: "#ef9eb9", Hunter: "#9ecb7b", Rogue: "#d8c65b",
  Priest: "#e4e0d8", Shaman: "#5d9be2", Mage: "#68c5d6", Warlock: "#9993d7",
  Druid: "#e18450", "Death Knight": "#c84753", Monk: "#63bc93", Evoker: "#56a783",
};

const FACTS = [
  { id: 1518, label: "MASTER BAITER", mark: "≈", text: "Total fish caught by this character" },
  { id: 114, label: "GRAVITY RESEARCHER", mark: "↓", text: "Deaths from fall damage on this character" },
  { id: 918, label: "FLOOR INSPECTOR", mark: "⌖", text: "Deaths during five-player dungeon runs" },
  { id: 94, label: "COMMITMENT ISSUES", mark: "↗", text: "Quests this character abandoned" },
  { id: 1066, label: "MORALE OFFICER", mark: "☺", text: "Times this character used the /lol emote" },
  { id: 1043, label: "LOOT GOBLIN", mark: "◇", text: "Times this character rolled Greed on loot" },
  { id: 353, label: "HEARTHSTONE HABIT", mark: "⌂", text: "Times this character used a Hearthstone" },
  { id: 108, label: "CRITTER MENACE", mark: "✹", text: "Critters this character has killed" },
  { id: 344, label: "FIELD MEDIC", mark: "✚", text: "Bandages used by this character" },
  { id: 588, label: "BATTLEFIELD REGULAR", mark: "⚔", text: "Honorable PvP kills earned by this character" },
];

const state = {
  members: [],
  sort: "level",
  direction: -1,
  query: "",
  classFilter: "",
  squadFilter: "a",
};
const byId = (id) => document.getElementById(id);
const number = (value) => new Intl.NumberFormat().format(Math.round(Number(value) || 0));
const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[ch]));

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Update time unavailable";
  const compact = window.matchMedia("(max-width: 610px)").matches;
  return new Intl.DateTimeFormat(undefined, compact
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function relativeAge(value, now = Date.now()) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || !Number.isFinite(now)) return "Update age unavailable";
  const age = Math.max(0, now - timestamp);
  if (age < 60_000) return "Just now";
  if (age < 60 * 60_000) return `${Math.floor(age / 60_000)} min ago`;
  if (age < 24 * 60 * 60_000) return `${Math.floor(age / (60 * 60_000))} ${Math.floor(age / (60 * 60_000)) === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(age / 86_400_000);
  return days <= 1 ? "Yesterday" : `${days} days ago`;
}

function updateRelativeAge(value) {
  byId("update-relative").textContent = `Updated ${relativeAge(value)}`;
}

function stat(member, id) {
  return member.stats?.[String(id)]?.value ?? null;
}

function rankOf(member) {
  if (member.rank === null || member.rank === undefined || member.rank === "") return null;
  const rank = Number(member.rank);
  return Number.isInteger(rank) ? rank : null;
}

function squadOf(member) {
  return rankOf(member) !== null && rankOf(member) <= 5 ? "a" : "b";
}

function squadName(squad) {
  return squad === "a" ? "A-laget" : "B-laget";
}

function metricTotal(id) {
  const present = state.members.filter((member) => stat(member, id) !== null);
  return {
    total: present.reduce((sum, member) => sum + Number(stat(member, id)), 0),
    coverage: present.length,
  };
}

function bossTotal() {
  const current = state.members.filter((member) => member.dataAvailable || member.stale);
  return current.reduce((sum, member) => sum + (member.dungeonBossKills ?? 0), 0);
}

function renderGuildStats(snapshot) {
  const members = snapshot.members.filter((member) => member.level !== null);
  const average = members.length ? members.reduce((sum, member) => sum + member.level, 0) / members.length : 0;
  const highest = members.reduce((best, member) => Math.max(best, member.level), 0);
  const quests = metricTotal(98);
  const bosses = bossTotal();
  const entries = [
    {
      label: "CHARACTERS",
      value: number(snapshot.guild.memberCount),
      foot: "in the guild roster",
      tooltip: "Total characters in the guild roster, including members whose detailed profile is unavailable.",
    },
    {
      label: "AVERAGE LEVEL",
      value: average.toFixed(1),
      foot: members.length + " character records",
      tooltip: "Average current level across all " + members.length + " characters in the roster.",
    },
    {
      label: "HIGHEST LEVEL",
      value: number(highest),
      foot: "current level",
      tooltip: "Highest current level in the guild roster.",
    },
    {
      label: "QUESTS COMPLETED",
      value: number(quests.total),
      foot: "recorded for " + quests.coverage + "/" + members.length + " characters",
      tooltip: number(quests.total) + " quests completed across " + quests.coverage + " of " + members.length + " character profiles.",
    },
    {
      label: "DUNGEON BOSS KILLS",
      value: number(bosses),
      foot: "recorded for " + state.members.filter((member) => member.dataAvailable || member.stale).length + "/" + state.members.length + " characters",
      tooltip: number(bosses) + " dungeon boss kills recorded across character profiles with available data.",
    },
  ];
  byId("guild-stats").innerHTML = entries.map((entry) => `
    <article class="stat-card" tabindex="0" title="${escapeHTML(entry.tooltip)}"><div class="stat-label">${entry.label}</div>
      <div class="stat-value">${entry.value}</div><div class="stat-foot">${entry.foot}</div>
    </article>`).join("");
}

function renderSquadSwitch() {
  const squadCounts = {
    all: state.members.length,
    a: state.members.filter((member) => squadOf(member) === "a").length,
    b: state.members.filter((member) => squadOf(member) === "b").length,
  };
  byId("squad-count-all").textContent = squadCounts.all;
  byId("squad-count-a").textContent = squadCounts.a + " · rank 0–5";
  byId("squad-count-b").textContent = squadCounts.b + " · rank 6+";
  document.querySelectorAll("[data-squad-filter]").forEach((button) => {
    const active = button.dataset.squadFilter === state.squadFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function renderClassBreakdown() {
  const counts = new Map();
  for (const member of state.members) {
    const name = member.className || "Unknown";
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = state.members.length;
  const maximum = Math.max(1, ...ordered.map(([, count]) => count));
  const midpoint = maximum / 2;
  const midpointLabel = Number.isInteger(midpoint) ? number(midpoint) : midpoint.toFixed(1);
  byId("class-axis").innerHTML = `<span>${number(maximum)}</span><span>${midpointLabel}</span><span>0</span>`;
  byId("class-breakdown").innerHTML = ordered.map(([name, count]) => {
    const color = CLASS_COLORS[name] || "#aaa194";
    const share = total ? Math.round((count / total) * 100) : 0;
    const tooltip = name + ": " + count + " characters (" + share + "% of the " + total + "-member guild roster).";
    return `
      <div class="class-chart-column" role="listitem" tabindex="0" title="${escapeHTML(tooltip)}" aria-label="${escapeHTML(tooltip)}" style="--class-color:${color}">
        <span class="class-bar-area" aria-hidden="true"><span class="class-chart-fill" style="height:${Math.max(3, (count / maximum) * 100)}%"></span></span>
        <span class="class-chart-label">${escapeHTML(name)}</span>
      </div>`;
  }).join("");
}

function renderTrivia() { renderAwards(); }

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
}

function visibleMembers() {
  const query = state.query.trim().toLocaleLowerCase();
  return state.members.filter((member) => {
    if (state.squadFilter !== "all" && squadOf(member) !== state.squadFilter) return false;
    if (state.classFilter && member.className !== state.classFilter) return false;
    if (!query) return true;
    return [member.name, member.className, ...(member.professions || []).map((profession) => profession.name)]
      .filter(Boolean).some((value) => value.toLocaleLowerCase().includes(query));
  }).sort((a, b) => {
    const av = a[state.sort] ?? "";
    const bv = b[state.sort] ?? "";
    const compare = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    return compare * state.direction || a.name.localeCompare(b.name);
  });
}

function renderRoster() {
  const members = visibleMembers();
  const detailColspan = window.matchMedia("(max-width: 610px)").matches ? 2 : 5;
  const squadMembers = state.members.filter(m => state.squadFilter === "all" || squadOf(m) === state.squadFilter);
  byId("roster-count").textContent = squadMembers.length + (state.squadFilter === "all" ? " characters" : " in " + squadName(state.squadFilter));
  byId("result-count").textContent = members.length === squadMembers.length ? "" : `Showing ${members.length} of ${squadMembers.length}`;
  byId("empty-state").hidden = members.length > 0;
  byId("roster-body").innerHTML = members.map(m => {
    const expanded = chronicle.expanded === m.id;
    const color = CLASS_COLORS[m.className] || "#aaa194";
    return `<tr class="${expanded ? 'expanded-row' : ''}">
      <td class="character-cell"><button type="button" id="character-toggle-${m.id}" class="character-link" data-toggle-member="${m.id}" aria-expanded="${expanded}" aria-controls="detail-${m.id}">${portrait(m)}<span class="character-copy"><span class="character-name">${escapeHTML(m.name)}</span><span class="character-meta">${escapeHTML(m.className)} · ${squadName(squadOf(m))}</span>${m.stale || !m.dataAvailable ? `<span class="profile-state">${m.stale ? 'Retained record' : 'Profile unavailable'}</span>` : ''}</span><span class="detail-chevron" aria-hidden="true">${expanded ? '−' : '+'}</span></button></td>
      <td class="class-column class-cell" style="--class-color:${color}">${escapeHTML(m.className)}</td>
      <td class="level-cell"><strong>${m.level ?? '—'}</strong>${xpBar(m)}</td>
      <td class="profession-column"><div class="profession-list">${(m.professions || []).map(p => `<span class="profession-chip">${escapeHTML(p.name)}<em>${number(p.skill)}</em></span>`).join('') || (m.dataAvailable ? '—' : '<span class="profile-unavailable">Profile unavailable</span>')}</div></td>
      <td class="armory-column"><a class="row-armory" href="https://worldofwarcraft.blizzard.com/en-us/forever/eu/armory/character/${encodeURIComponent(m.slug)}" target="_blank" rel="noreferrer" aria-label="${escapeHTML(m.name)} in the official armory">↗</a></td>
    </tr><tr class="detail-row" ${expanded ? '' : 'hidden'}><td colspan="${detailColspan}">${expanded ? characterDetails(m) : `<div id="detail-${m.id}"></div>`}</td></tr>`;
  }).join("");
}

function bindControls() {
  const rosterLayout = window.matchMedia("(max-width: 610px)");
  if (rosterLayout.addEventListener) rosterLayout.addEventListener("change", renderRoster);
  else window.addEventListener("resize", renderRoster);
  byId("roster-search").addEventListener("input", (event) => {
    state.query = event.target.value;
    renderRoster();
  });
  byId("class-filter").addEventListener("change", (event) => {
    state.classFilter = event.target.value;
    renderRoster();
  });
  document.querySelectorAll("[data-squad-filter]").forEach((button) => button.addEventListener("click", () => {
    state.squadFilter = button.dataset.squadFilter;
    renderSquadSwitch();
    renderRoster();
  }));
  document.querySelectorAll(".sort-button").forEach((button) => button.addEventListener("click", () => {
    const sort = button.dataset.sort;
    state.direction = state.sort === sort ? state.direction * -1 : (sort === "level" ? -1 : 1);
    state.sort = sort;
    document.querySelectorAll(".sort-button").forEach((item) => {
      item.classList.toggle("active", item === button);
      item.querySelector("span").textContent = item === button ? (state.direction === -1 ? "↓" : "↑") : "↕";
      if (item === button) item.setAttribute("aria-label", "Sort by " + sort + ", " + (state.direction === -1 ? "descending" : "ascending"));
    });
    renderRoster();
  }));
}

async function start() {
  bindControls();
  try {
    const response = await fetch("data.json?t=" + Date.now(), { cache: "no-store" });
    if (!response.ok) throw new Error("The guild snapshot returned " + response.status + ".");
    const snapshot = await response.json();
    if (!snapshot.guild || !Array.isArray(snapshot.members)) throw new Error("The guild snapshot format is incomplete.");
    state.members = snapshot.members;
    if (!snapshot.config || snapshot.schema !== 2) throw new Error("Refresh the guild snapshot to enable the chronicle.");
    initChronicle(snapshot);
    byId("update-date").textContent = formatDate(snapshot.generatedAt);
    byId("update-date").title = "Guild snapshot generated " + formatDate(snapshot.generatedAt) + ".";
    if (Number.isFinite(Date.parse(snapshot.generatedAt))) {
      byId("update-date").dateTime = new Date(snapshot.generatedAt).toISOString();
    } else {
      byId("update-relative").textContent = "Update age unavailable";
    }
    if (Number.isFinite(Date.parse(snapshot.generatedAt))) {
      updateRelativeAge(snapshot.generatedAt);
      window.setInterval(() => updateRelativeAge(snapshot.generatedAt), 60_000);
    }
    const stale = snapshot.staleCount || 0;
    const missing = snapshot.missingCount || 0;
    const notes = [];
    if (stale) notes.push(stale + " record" + (stale === 1 ? "" : "s") + " kept from the previous fetch");
    if (missing) notes.push(missing + " character profile" + (missing === 1 ? "" : "s") + " unavailable");
    byId("update-note").textContent = notes.join(" · ") || "Latest successful armory refresh";
    byId("update-note").title = missing
      ? missing + " roster members are included, but detailed character profiles were unavailable from Blizzard."
      : "All current character profiles were available for this guild snapshot.";
    byId("coverage-note").textContent = "All-time character records · not a live online count";
    renderGuildStats(snapshot);
    renderSquadSwitch();
    renderClassBreakdown();
    renderTrivia();
    renderRoster();
  } catch (error) {
    byId("update-relative").textContent = "Update age unavailable";
    byId("update-date").textContent = "Records unavailable";
    byId("update-note").textContent = "Refresh the page to try again.";
    byId("guild-stats").innerHTML = "";
    byId("roster-body").innerHTML = '<tr><td class="loading-cell" colspan="5">Guild records are not available.</td></tr>';
    byId("load-error").textContent = error.message + " Run the local guild data refresh to create data.json.";
    byId("load-error").hidden = false;
  }
}

start();

