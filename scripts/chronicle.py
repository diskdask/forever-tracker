"""Pure snapshot enrichment: completion rules, XP and bounded observation history."""

from datetime import datetime, timedelta, timezone
import re

AWARD_IDS = (1518, 114, 918, 94, 1066, 1043, 353, 108, 344, 588)
PROFESSION_MILESTONES = tuple(range(50, 501, 50))
FUNNY_STAT_MILESTONES = {
    1518: (100, 500, 1000), 114: (10, 25, 50), 918: (5, 10, 25), 94: (10, 25, 50),
    1066: (25, 50, 100), 1043: (25, 50, 100), 353: (25, 50, 100), 108: (100, 500, 1000),
    344: (25, 100, 250), 588: (100, 500, 1000),
}


def norm(value):
    return re.sub(r"[^a-z0-9]", "", value.casefold())


def dungeon_records(member, catalogue):
    available = bool(member.get("dataAvailable"))
    counters = []
    for key, stat in member.get("stats", {}).items():
        if "Boss Kills" not in stat.get("category", []):
            continue
        match = re.match(r"(.*?)\s+kills\s+\((.*?)\)$", stat.get("name", ""), re.I)
        if match:
            counters.append({"id": key, "name": match[1], "dungeon": match[2],
                             "kills": int(stat.get("value") or 0), "updatedAt": stat.get("updatedAt")})
    result = {}
    for dungeon in catalogue:
        finals = {norm(name) for name in dungeon["finalBosses"]}
        aliases = {norm(name) for name in [dungeon["name"], *dungeon.get("aliases", [])]}
        bosses = [row for row in counters if (norm(row["name"]) in finals if dungeon.get("wing")
                  else norm(row["dungeon"]) in aliases)]
        # Identical faction-mirror counters do not establish an enemy-side clear.
        if dungeon.get("twin") and dungeon.get("territory") != member.get("faction", "HORDE"):
            twins = [row for row in counters if norm(row["dungeon"]) == norm(dungeon["twin"])]
            bosses = [row for row in bosses if not any(row["kills"] == twin["kills"] and
                      row["updatedAt"] == twin["updatedAt"] for twin in twins)]
        killed = {norm(row["name"]) for row in bosses if row["kills"] > 0}
        account_clears = {norm(criterion.get("name", "")) for challenge in member.get("legacy", {}).get("challenges", [])
                          if challenge.get("accountWide") for criterion in challenge.get("criteria", [])
                          if criterion.get("completed") is True}
        legacy_clear = bool(account_clears & {norm(name) for name in dungeon.get("legacyCriteria", [])})
        status = ("unavailable" if not available else "clear" if (finals and finals <= killed) or legacy_clear
                  else "partial" if killed else "none" if finals else "unknown")
        result[dungeon["id"]] = {"status": status, "bosses": bosses,
                                "ruleKnown": bool(finals), "legacyEvidence": legacy_clear,
                                "stale": bool(member.get("stale"))}
    return result


def xp_progress(member, config):
    level, xp = member.get("level"), member.get("experience")
    if not member.get("dataAvailable") or not isinstance(level, int) or not 1 <= level <= config["levelCap"]:
        return None
    table = config["xpToNextLevel"]
    if level == config["levelCap"]:
        return {"current": 0, "required": 0, "total": sum(table[:level]), "percent": 100, "capped": True}
    if not isinstance(xp, (int, float)) or not 0 <= xp < table[level]:
        return None
    return {"current": xp, "required": table[level], "total": sum(table[:level]) + xp,
            "percent": round(xp / table[level] * 100, 2), "capped": False}


def legacy_record(entries, definitions, collected_at):
    challenges, unresolved = [], 0

    def criteria_rows(progress, definition):
        definitions_by_id = {}
        def index(node):
            if not isinstance(node, dict):
                return
            if node.get("id") is not None:
                definitions_by_id[str(node["id"])] = node
            for child in node.get("child_criteria", []) or []:
                index(child)
        index(definition.get("criteria", {}))

        def flatten(node):
            if not isinstance(node, dict):
                return []
            detail = definitions_by_id.get(str(node.get("id")), {})
            rows = [{"id": node.get("id"), "name": detail.get("description", ""),
                     "completed": node.get("is_completed") if isinstance(node.get("is_completed"), bool) else None}]
            for child in node.get("child_criteria", []) or []:
                rows.extend(flatten(child))
            return rows
        return flatten(progress)

    for entry in entries:
        href = entry.get("achievement", {}).get("key", {}).get("href")
        definition = definitions.get(href)
        if definition is None:
            unresolved += 1
            continue
        reward = re.search(r"Earn\s+(\d+)\s+Legacy Point", definition.get("reward_description", ""), re.I)
        if not reward:
            continue
        criteria = entry.get("criteria", {})
        completed = criteria.get("is_completed") is True
        timestamp = entry.get("completed_timestamp")
        challenges.append({"id": entry["id"], "name": definition["name"],
                           "description": definition.get("description", ""), "points": int(reward[1]),
                           "completed": completed, "completedAt": timestamp,
                           "conflicting": bool(timestamp and not completed)})
        challenges[-1]["criteria"] = criteria_rows(criteria, definition)
        challenges[-1]["accountWide"] = bool(definition.get("is_account_wide"))
    return {"available": True, "collectedAt": collected_at, "challenges": challenges,
            "unresolvedCount": unresolved, "stale": False}


def observation(member):
    return {"at": member["dataCollectedAt"], "level": member["level"],
            "xp": member.get("xp"),
            "professions": [{"name": row.get("name"), "skill": row.get("skill"),
                             "maxSkill": row.get("maxSkill")} for row in member.get("professions", [])
                            if isinstance(row, dict)] if isinstance(member.get("professions"), list) else None,
            "stats": {str(key): member.get("stats", {}).get(str(key), {}).get("value") for key in AWARD_IDS},
            "clears": [key for key, value in member["dungeons"].items()
                       if value["status"] == "clear" and not value.get("legacyEvidence")],
            "legacy": [row["id"] for row in member.get("legacy", {}).get("challenges", [])
                       if row["completed"] and not row.get("conflicting")]
            if member.get("legacy", {}).get("available") and not member.get("legacy", {}).get("stale") else None}


def _crossed_milestone(before, after, milestones):
    if not isinstance(before, (int, float)) or isinstance(before, bool):
        return False
    if not isinstance(after, (int, float)) or isinstance(after, bool) or after <= before:
        return False
    return any(before < milestone <= after for milestone in milestones)


def _records_activity(before, after):
    """Whether this observation is evidence for an activity-feed milestone."""
    old_level, new_level = before.get("level"), after.get("level")
    if isinstance(old_level, int) and isinstance(new_level, int) and new_level > old_level:
        return True

    for key in ("clears", "legacy"):
        old_values, new_values = before.get(key), after.get(key)
        if isinstance(old_values, list) and isinstance(new_values, list) and set(new_values) - set(old_values):
            return True

    old_professions = before.get("professions")
    new_professions = after.get("professions")
    if isinstance(old_professions, list) and isinstance(new_professions, list):
        previous = {str(row.get("name", "")).strip().casefold(): row.get("skill")
                    for row in old_professions if isinstance(row, dict)}
        for row in new_professions:
            if not isinstance(row, dict):
                continue
            prior = previous.get(str(row.get("name", "")).strip().casefold())
            if _crossed_milestone(prior, row.get("skill"), PROFESSION_MILESTONES):
                return True

    old_stats, new_stats = before.get("stats") or {}, after.get("stats") or {}
    for key, milestones in FUNNY_STAT_MILESTONES.items():
        if _crossed_milestone(old_stats.get(str(key)), new_stats.get(str(key)), milestones):
            return True
    return False


def enrich(snapshot, previous, config):
    """Retain daily endpoints and recorded activity observations for 90 days."""
    cutoff = datetime.fromisoformat(snapshot["generatedAt"]) - timedelta(days=90)
    for member in snapshot["members"]:
        old = previous.get(str(member["id"]), {})
        history = list(old.get("history", []))
        # Migrate the existing snapshot as a real baseline, never fabricated activity.
        if not history and old.get("dataAvailable") and not old.get("stale"):
            baseline = {**old, "dungeons": dungeon_records(old, config["dungeons"]), "xp": xp_progress(old, config)}
            history.append(observation(baseline))
        elif (history and old.get("dataCollectedAt") == history[-1].get("at") and
              "professions" not in history[-1] and isinstance(old.get("professions"), list)):
            # Backfill only the matching saved profile observation; this is a real baseline.
            history[-1] = {**history[-1], "professions": observation(old).get("professions")}
        member["dungeons"] = dungeon_records(member, config["dungeons"])
        member["xp"] = xp_progress(member, config) if not member.get("stale") else (
            old.get("xp") if member.get("level") == old.get("level") else None)
        if member.get("dataAvailable") and not member.get("stale"):
            history.append(observation(member))
        points = sorted({point["at"]: point for point in history}.values(), key=lambda p: p["at"])
        activity_times = {point["at"] for before, point in zip(points, points[1:])
                          if _records_activity(before, point)}
        days = {}
        for point in points:
            if datetime.fromisoformat(point["at"]) >= cutoff:
                days.setdefault(point["at"][:10], []).append(point)
        member["history"] = []
        for rows in days.values():
            if len(rows) <= 2:
                member["history"].extend(rows)
            else:
                retained = [rows[0], *(point for point in rows[1:-1] if point["at"] in activity_times), rows[-1]]
                member["history"].extend(retained)
    snapshot["schema"] = 2
    snapshot["config"] = config
    snapshot["historyStartedAt"] = min((p["at"] for m in snapshot["members"] for p in m["history"]), default=None)
    return snapshot
