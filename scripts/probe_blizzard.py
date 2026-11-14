#!/usr/bin/env python3
"""Read-only Blizzard API research. Credentials and tokens are never written to output."""

import base64
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.parse
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "research" / "blizzard"
HOST = "https://eu.api.blizzard.com"
NAMESPACE = "profile-forever-eu"


def credentials():
    values = {}
    if (ROOT / ".env").exists():
        for line in (ROOT / ".env").read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            values[key.strip()] = value
    keys = ("BLIZZARD_CLIENT_ID", "BLIZZARD_CLIENT_SECRET")
    result = [os.environ.get(key) or values.get(key, "") for key in keys]
    if not all(result):
        sys.exit("Missing Blizzard credentials. Fill in both values in the local .env file.")
    return result


def request_json(request):
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        try:
            body = json.loads(error.read())
        except (ValueError, UnicodeError):
            body = {}
        return error.code, body
    except (urllib.error.URLError, TimeoutError):
        # Do not print request objects, headers, credentials, or token responses.
        sys.exit("Network request failed. Check network access and retry.")


def main():
    client_id, client_secret = credentials()
    basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    status, auth = request_json(urllib.request.Request(
        "https://oauth.battle.net/token",
        data=urllib.parse.urlencode({"grant_type": "client_credentials"}).encode(),
        headers={"Authorization": f"Basic {basic}", "Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    ))
    if status != 200 or not auth.get("access_token"):
        sys.exit(f"Blizzard authentication failed (HTTP {status}). Credentials were not printed.")
    token = auth["access_token"]
    print(json.dumps({"authentication": "success", "expires_in_seconds": auth.get("expires_in")}))

    OUTPUT.mkdir(parents=True, exist_ok=True)
    results = []

    def probe(label, path, namespace=NAMESPACE):
        url = HOST + path + "?" + urllib.parse.urlencode({"namespace": namespace, "locale": "en_US"})
        status, body = request_json(urllib.request.Request(
            url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        ))
        summary = {"label": label, "url": url, "status": status}
        if status == 200:
            summary["keys"] = list(body) if isinstance(body, dict) else []
            (OUTPUT / f"{label}.json").write_text(json.dumps(body, ensure_ascii=False, indent=2) + "\n")
        elif isinstance(body, dict):
            # Only public API error fields; redact credentials defensively.
            for key in ("code", "type", "detail", "title"):
                if key in body:
                    value = str(body[key])
                    for private in (client_id, client_secret, token, basic):
                        value = value.replace(private, "[redacted]")
                    summary[key] = value[:400]
        results.append(summary)
        print(json.dumps(summary, ensure_ascii=False))
        (OUTPUT / "summary.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
        return status, body

    def follow(label, value):
        if not isinstance(value, dict) or not value.get("href"):
            return None, {}
        parsed = urllib.parse.urlsplit(value["href"])
        if parsed.scheme != "https" or parsed.hostname != "eu.api.blizzard.com":
            return None, {}
        if not parsed.path.startswith(("/profile/wow/character/", "/data/wow/")):
            return None, {}
        namespace = urllib.parse.parse_qs(parsed.query).get("namespace", [NAMESPACE])[0]
        return probe(label, parsed.path, namespace)

    # Verified Forever routes have no realm or game-mode segment.
    character_status, character = probe("character", "/profile/wow/character/hunt-elito")
    probe("guild-roster", "/data/wow/guild/diskdask/roster")

    # Discover related resources from the successful profile's own resource links.
    if character_status == 200:
        resources = {}
        for field in ("equipment", "media", "professions", "specializations", "statistics", "achievements", "achievements_statistics", "encounters"):
            label = field.replace("_", "-")
            status, body = follow(label, character.get(field))
            if status == 200:
                resources[field] = body
        follow("dungeon-encounters", resources.get("encounters", {}).get("dungeons"))
        # Static metadata distinguishes Legacy class/crafting challenges from exploration.
        achievements = resources.get("achievements", {}).get("achievements", [])
        for target in (61992, 62025, 62031):
            for achievement in achievements:
                if achievement.get("id") == target:
                    follow(f"achievement-definition-{target}", achievement.get("achievement", {}).get("key"))
                    break


if __name__ == "__main__":
    main()
