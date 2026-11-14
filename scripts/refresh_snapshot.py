#!/usr/bin/env python3
"""Fetch public Diskdask roster, profession, and activity data into data.json."""

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import base64
import json
import os
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from chronicle import enrich, legacy_record


ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data.json"
API_HOST = "https://eu.api.blizzard.com"
PROFILE_NAMESPACE = "profile-forever-eu"
CLASS_NAMES = {
    1: "Warrior", 2: "Paladin", 3: "Hunter", 4: "Rogue", 5: "Priest",
    7: "Shaman", 8: "Mage", 9: "Warlock", 11: "Druid",
}


class BlizzardError(Exception):
    """A safe, concise request failure without credentials or token data."""


def read_env():
    values = {}
    path = ROOT / ".env"
    if path.exists():
        for raw in path.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            values[key.strip()] = value
    return {
        key: os.environ.get(key) or values.get(key, "")
        for key in ("BLIZZARD_CLIENT_ID", "BLIZZARD_CLIENT_SECRET")
    }


def request_json(request):
    last_status = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=35) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            last_status = error.code
            if error.code not in (429, 500, 502, 503, 504) or attempt == 2:
                raise BlizzardError(f"Blizzard returned HTTP {error.code}.") from None
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            if attempt == 2:
                raise BlizzardError("A request to Blizzard failed; check the network and try again.") from None
        time.sleep(2 ** attempt)
    raise BlizzardError(f"Blizzard returned HTTP {last_status}.")


def get_token(client_id, client_secret):
    userpass = base64.b64encode(f"{client_id}:{client_secret}".encode("utf-8")).decode("ascii")
    request = urllib.request.Request(
        "https://oauth.battle.net/token",
        data=urllib.parse.urlencode({"grant_type": "client_credentials"}).encode("ascii"),
        headers={
            "Authorization": f"Basic {userpass}",
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
        method="POST",
    )
    result = request_json(request)
    token = result.get("access_token") if isinstance(result, dict) else None
    if not token:
        raise BlizzardError("Blizzard did not return an access token. Check the local credentials.")
    return token


def api_get(path_or_url, token):
    if path_or_url.startswith("https://"):
        parsed = urllib.parse.urlsplit(path_or_url)
        if parsed.scheme != "https" or parsed.hostname != "eu.api.blizzard.com":
            raise BlizzardError("Blizzard returned an unexpected resource link; the request was skipped.")
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)
        namespace = query.get("namespace", [PROFILE_NAMESPACE])[0]
        locale = query.get("locale", ["en_US"])[0]
    else:
        path = path_or_url
        namespace, locale = PROFILE_NAMESPACE, "en_US"
    url = f"{API_HOST}{path}?{urllib.parse.urlencode({'namespace': namespace, 'locale': locale})}"
    request = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    })
    return request_json(request)


def linked_href(document, key):
    link = document.get(key) if isinstance(document, dict) else None
    return link.get("href") if isinstance(link, dict) else None


def fetch_avatar(roster_row, token, profile=None):
    media_url = linked_href(profile, "media")
    if not media_url:
        slug = urllib.parse.quote(roster_row.get("slug", ""), safe="")
        if not slug:
            return None
        media_url = f"/profile/wow/character/{slug}/character-media"
    try:
        media = api_get(media_url, token)
    except BlizzardError:
        return None
    assets = {asset.get("key"): asset.get("value") for asset in media.get("assets", []) if isinstance(asset, dict)}
    for key in ("avatar", "avatar-sd"):
        value = assets.get(key)
        if not value:
            continue
        parsed = urllib.parse.urlsplit(value)
        if parsed.scheme == "https" and parsed.hostname == "render.worldofwarcraft.com":
            return value
    return None


def fallback_avatar_url(roster_row):
    try:
        character_id = int(roster_row.get("id"))
    except (TypeError, ValueError):
        return None
    if character_id <= 0:
        return None
    # Blizzard's Forever avatar links use the character ID's low byte as the render shard.
    return f"https://render.worldofwarcraft.com/forever-eu/character/{character_id % 256}/{character_id}-avatar.jpg"


def flatten_statistics(categories, parents=()):
    for category in categories or []:
        path = parents + (category.get("name", ""),)
        for item in category.get("statistics", []) or []:
            statistic_id = item.get("id")
            if statistic_id is None:
                continue
            yield str(statistic_id), {
                "name": item.get("name", ""),
                "value": item.get("quantity"),
                "description": item.get("description"),
                "category": list(path),
                "updatedAt": item.get("last_updated_timestamp"),
            }
        yield from flatten_statistics(category.get("sub_categories"), path)


def collect_boss_kills(stats):
    kills = []
    for statistic in stats.values():
        category = statistic.get("category", [])
        if "Boss Kills" not in category:
            continue
        match = re.search(r"\(([^()]*)\)\s*$", statistic.get("name", ""))
        dungeon = match.group(1).strip().casefold() if match else ""
        kills.append({
            "dungeon": dungeon,
            "value": int(statistic.get("value") or 0),
            "updatedAt": statistic.get("updatedAt"),
        })

    # Blizzard mirrors some faction dungeons by publishing the same boss count and
    # timestamp under both dungeons. For this Horde guild, count the Horde entry.
    pairs = (("ragefire chasm", "hall of thanes"),)
    excluded = set()
    for left, right in pairs:
        left_rows = [row for row in kills if row["dungeon"] == left]
        right_rows = [row for row in kills if row["dungeon"] == right]
        for left_row in left_rows:
            for right_row in right_rows:
                if left_row["value"] == right_row["value"] and left_row["updatedAt"] == right_row["updatedAt"]:
                    excluded.add(id(right_row))
    return sum(row["value"] for row in kills if id(row) not in excluded)


def profession_rows(document):
    rows = []
    for profession in document.get("primaries", []) or []:
        detail = profession.get("profession", {})
        tiers = profession.get("tiers", []) or []
        tier = tiers[-1] if tiers else {}
        if detail.get("name"):
            rows.append({
                "name": detail["name"],
                "skill": tier.get("skill_points", 0),
                "maxSkill": tier.get("max_skill_points", 0),
            })
    return rows


def roster_member(raw):
    character = raw.get("character", {})
    first_name = character.get("name", "Unknown")
    surname = character.get("surname", "")
    class_id = (character.get("playable_class") or {}).get("id")
    slug = character.get("slug") or ""
    return {
        "id": character.get("id"),
        "slug": slug,
        "name": f"{first_name} {surname}".strip(),
        "level": character.get("level"),
        "className": CLASS_NAMES.get(class_id, "Unknown"),
        "rank": raw.get("rank"),
    }


def fetch_member(roster_row, token):
    slug = roster_row.get("slug")
    if not slug:
        raise BlizzardError("The roster entry did not include a character slug.")
    encoded_slug = urllib.parse.quote(slug, safe="")
    profile = api_get(f"/profile/wow/character/{encoded_slug}", token)
    stats_url = linked_href(profile, "achievements_statistics")
    profession_url = linked_href(profile, "professions")
    if not stats_url or not profession_url:
        raise BlizzardError("The character profile did not include activity and profession links.")
    stats_doc = api_get(stats_url, token)
    professions_doc = api_get(profession_url, token)
    avatar_url = fetch_avatar(roster_row, token, profile) or fallback_avatar_url(roster_row)
    stats = dict(flatten_statistics(stats_doc.get("categories", [])))
    identity = f"{profile.get('name', roster_row['name'].split()[0])} {profile.get('surname', '')}".strip()
    class_obj = profile.get("character_class", {}) or {}
    achievement_entries = None
    try:
        achievement_url = linked_href(profile, "achievements")
        if achievement_url:
            achievement_entries = api_get(achievement_url, token).get("achievements", [])
    except BlizzardError:
        pass  # Achievement outages must not discard otherwise usable profiles.
    return {
        **roster_row,
        "slug": profile.get("slug") or slug,
        "name": identity,
        "level": profile.get("level", roster_row.get("level")),
        "className": class_obj.get("name") or roster_row["className"],
        "experience": profile.get("experience"),
        "faction": (profile.get("faction") or {}).get("type"),
        "avatarUrl": avatar_url,
        "professions": profession_rows(professions_doc),
        "stats": stats,
        "dungeonBossKills": collect_boss_kills(stats),
        "dataCollectedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "dataAvailable": True,
        "stale": False,
        "_achievementEntries": achievement_entries,
    }


def load_previous():
    try:
        value = json.loads(DATA_FILE.read_text())
        return {str(member.get("id")): member for member in value.get("members", []) if member.get("id")}
    except (OSError, ValueError, TypeError):
        return {}


def main():
    config = json.loads((ROOT / "chronicle-config.json").read_text())
    credentials = read_env()
    if not credentials["BLIZZARD_CLIENT_ID"] or not credentials["BLIZZARD_CLIENT_SECRET"]:
        sys.exit("Add BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET to the local .env file first.")

    token = get_token(credentials["BLIZZARD_CLIENT_ID"], credentials["BLIZZARD_CLIENT_SECRET"])
    roster = api_get("/data/wow/guild/diskdask/roster", token)
    guild = roster.get("guild", {})
    if str(guild.get("slug", "")).casefold() != "diskdask":
        sys.exit("Blizzard returned an unexpected guild. No snapshot was written.")
    roster_rows = [roster_member(raw) for raw in roster.get("members", [])]
    if not roster_rows:
        sys.exit("Blizzard returned an empty guild roster. No snapshot was written.")

    previous = load_previous()
    members_by_id = {}
    failures = []
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(fetch_member, row, token): row for row in roster_rows}
        for future in as_completed(futures):
            row = futures[future]
            key = str(row.get("id") or "")
            try:
                member = future.result()
                if not member.get("avatarUrl"):
                    member["avatarUrl"] = (previous.get(key) or {}).get("avatarUrl")
            except Exception as error:
                old = previous.get(key)
                avatar_url = (old or {}).get("avatarUrl") or fetch_avatar(row, token) or fallback_avatar_url(row)
                if old and old.get("dataAvailable"):
                    member = {**old, **row, "avatarUrl": avatar_url, "stale": True, "fetchWarning": str(error)}
                else:
                    member = {
                        **row, "experience": None, "faction": guild.get("faction", {}).get("type"),
                        "avatarUrl": avatar_url,
                        "professions": [], "stats": {}, "dungeonBossKills": 0,
                        "dataCollectedAt": None, "dataAvailable": False, "stale": False,
                        "fetchWarning": str(error),
                    }
                failures.append({"name": row["name"], "reason": str(error)})
            members_by_id[key] = member

    members = sorted(members_by_id.values(), key=lambda row: (-int(row.get("level") or 0), row["name"].casefold()))
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    cache_path = ROOT / ".cache" / "achievement-definitions.json"
    try:
        definitions = json.loads(cache_path.read_text())
    except (OSError, ValueError):
        definitions = {}
    hrefs = {entry.get("achievement", {}).get("key", {}).get("href")
             for member in members for entry in (member.get("_achievementEntries") or [])}
    with ThreadPoolExecutor(max_workers=5) as pool:
        jobs = {pool.submit(api_get, href, token): href for href in hrefs if href and href not in definitions}
        for job in as_completed(jobs):
            try:
                definitions[jobs[job]] = job.result()
            except BlizzardError:
                pass
    cache_path.parent.mkdir(exist_ok=True)
    cache_path.write_text(json.dumps(definitions, ensure_ascii=False))
    for member in members:
        entries = member.pop("_achievementEntries", None)
        if entries is not None:
            member["legacy"] = legacy_record(entries, definitions, member["dataCollectedAt"])
        else:
            old_legacy = previous.get(str(member["id"]), {}).get("legacy")
            member["legacy"] = {**old_legacy, "stale": True} if old_legacy else {"available": False, "challenges": []}
    snapshot = {
        "schema": 1,
        "generatedAt": now,
        "guild": {
            "name": guild.get("name", "Diskdask"),
            "slug": guild.get("slug", "diskdask"),
            "region": "eu",
            "gameMode": "pvp",
            "faction": (guild.get("faction") or {}).get("type", "HORDE"),
            "memberCount": len(roster_rows),
        },
        "members": members,
        "staleCount": sum(bool(member.get("stale")) for member in members),
        "missingCount": sum(not member.get("dataAvailable") for member in members),
        "fetchWarnings": failures,
    }
    enrich(snapshot, previous, config)
    temporary = DATA_FILE.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n")
    temporary.replace(DATA_FILE)
    print(f"Saved guild snapshot: {len(members)} characters; {snapshot['staleCount']} retained old records; {snapshot['missingCount']} without profile data.")
    if failures:
        print(f"Profile requests failed for {len(failures)} character(s); last good records were kept when available.")
        for failure in failures:
            print(f"  {failure['name']}: {failure['reason']}")


if __name__ == "__main__":
    try:
        main()
    except BlizzardError as error:
        sys.exit(str(error))
