"""Regression checks for records that could otherwise invent progress or points."""
import copy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from chronicle import dungeon_records, enrich, legacy_record, observation, xp_progress

CONFIG = json.loads((ROOT / "chronicle-config.json").read_text())
SNAPSHOT = json.loads((ROOT / "data.json").read_text())


class ChronicleTests(unittest.TestCase):
    def member(self):
        return copy.deepcopy(next(m for m in SNAPSHOT["members"] if m["slug"] == "hunt-elito"))

    def test_xp_rollover_counts_both_levels(self):
        m = self.member()
        m.update(level=24, experience=31690)
        before = xp_progress(m, CONFIG)
        m.update(level=25, experience=20)
        after = xp_progress(m, CONFIG)
        self.assertEqual(after["total"] - before["total"], 30)
        self.assertEqual(sum(CONFIG["xpToNextLevel"]), 4084700)

    def test_invalid_and_capped_xp(self):
        m = self.member()
        m.update(level=25, experience=999999)
        self.assertIsNone(xp_progress(m, CONFIG))
        m.update(level=60, experience=0)
        self.assertEqual(xp_progress(m, CONFIG)["percent"], 100)
        m["dataAvailable"] = False
        self.assertIsNone(xp_progress(m, CONFIG))

    def test_partial_clear_and_missing_are_distinct(self):
        m = self.member()
        m["stats"] = {"1": {"name": "Lyn the Ignored Kills (City of Dalaran)", "value": 2, "category": ["Boss Kills"]}}
        self.assertEqual(dungeon_records(m, CONFIG["dungeons"])["city-of-dalaran"]["status"], "partial")
        m["stats"]["2"] = {"name": "Shade of the Archmage Kills (City of Dalaran)", "value": 1, "category": ["Boss Kills"]}
        self.assertEqual(dungeon_records(m, CONFIG["dungeons"])["city-of-dalaran"]["status"], "clear")
        m["dataAvailable"] = False
        self.assertEqual(dungeon_records(m, CONFIG["dungeons"])["city-of-dalaran"]["status"], "unavailable")

    def test_cathedral_requires_both_bosses_and_does_not_clear_other_wings(self):
        m = self.member()
        m["stats"] = {"1": {"name": "Scarlet Commander Mograine kills (Scarlet Monastery)", "value": 3, "category": ["Boss Kills"]}}
        rows = dungeon_records(m, CONFIG["dungeons"])
        self.assertEqual(rows["scarlet-monastery-cathedral"]["status"], "partial")
        self.assertEqual(rows["scarlet-monastery-library"]["status"], "none")

    def test_mirrored_faction_counter_is_suppressed(self):
        m = self.member()
        m["stats"] = {str(i): {"name": f"{boss} kills ({dungeon})", "value": 2, "updatedAt": 123, "category": ["Boss Kills"]}
                      for i, (boss, dungeon) in enumerate([("Bazzalan", "Ragefire Chasm"), ("Test boss", "Hall of Thanes")])}
        rows = dungeon_records(m, CONFIG["dungeons"])
        self.assertEqual(rows["ragefire-chasm"]["status"], "clear")
        self.assertEqual(rows["hall-of-thanes"]["status"], "unknown")

    def test_conflicting_timestamp_is_not_a_legacy_point(self):
        entries = [{"id": 1, "achievement": {"key": {"href": "a"}}, "criteria": {"is_completed": False}, "completed_timestamp": 123},
                   {"id": 2, "achievement": {"key": {"href": "b"}}, "criteria": {"is_completed": True}}]
        definitions = {"a": {"name": "A", "reward_description": "Earn 1 Legacy Point."}, "b": {"name": "Ordinary exploration"}}
        legacy = legacy_record(entries, definitions, "2026-11-13T22:00:00+00:00")
        self.assertEqual(len(legacy["challenges"]), 1)
        self.assertFalse(legacy["challenges"][0]["completed"])
        self.assertTrue(legacy["challenges"][0]["conflicting"])

    def test_wetlands_clear_is_exposed_as_account_evidence_not_character_kill(self):
        entries = [{"id": 62031, "achievement": {"key": {"href": "a"}},
                    "criteria": {"is_completed": False, "child_criteria": [
                        {"id": 77, "is_completed": True}]}}]
        definitions = {"a": {"name": "Novice Spelunker", "reward_description": "Earn 1 Legacy Point.",
                              "is_account_wide": True, "criteria": {"id": 1, "child_criteria": [
                                  {"id": 77, "description": "Excavation Site: Wetlands"}]}}}
        m = self.member()
        m["legacy"] = legacy_record(entries, definitions, "2026-11-13T22:00:00+00:00")
        records = dungeon_records(m, CONFIG["dungeons"])
        wetlands = records["excavation-site"]
        self.assertEqual(wetlands["status"], "clear")
        self.assertTrue(wetlands["legacyEvidence"])
        self.assertEqual(wetlands["bosses"], [])

    def test_history_migration_idempotence_and_stale_record(self):
        old = self.member()
        old.pop("history", None)
        current = copy.deepcopy(old)
        current["dataCollectedAt"] = "2026-11-14T05:00:00+00:00"
        snapshot = {"generatedAt": current["dataCollectedAt"], "members": [current]}
        enrich(snapshot, {str(old["id"]): old}, CONFIG)
        self.assertEqual(len(current["history"]), 2)
        enrich(snapshot, {str(current["id"]): copy.deepcopy(current)}, CONFIG)
        self.assertEqual(len(current["history"]), 2)
        old = copy.deepcopy(current)
        current.update(stale=True, level=current["level"] + 1)
        enrich(snapshot, {str(old["id"]): old}, CONFIG)
        self.assertEqual(current["history"], old["history"])
        self.assertIsNone(current["xp"])

    def test_profession_history_uses_matching_saved_profile_as_baseline(self):
        old = self.member()
        old["professions"] = [{"name": "Engineering", "skill": 148, "maxSkill": 300}]
        old["dataCollectedAt"] = "2026-11-14T05:00:00+00:00"
        old["history"] = [{"at": old["dataCollectedAt"], "level": old["level"], "xp": old["xp"],
                           "stats": {}, "clears": [], "legacy": []}]
        current = copy.deepcopy(old)
        current["professions"][0]["skill"] = 152
        current["dataCollectedAt"] = "2026-11-14T06:00:00+00:00"
        snapshot = {"generatedAt": current["dataCollectedAt"], "members": [current]}

        enrich(snapshot, {str(old["id"]): old}, CONFIG)

        self.assertEqual(current["history"][-2]["professions"][0]["skill"], 148)
        self.assertEqual(current["history"][-1]["professions"][0]["skill"], 152)

    def test_daily_compaction_retains_endpoints_and_prunes_old_observations(self):
        m = self.member()
        base = copy.deepcopy(m["history"][0])
        m["history"] = [{**base, "at": f"2026-11-13T{hour:02}:00:00+00:00"} for hour in range(12)]
        m["history"].insert(0, {**base, "at": "2026-01-01T00:00:00+00:00"})
        m["dataCollectedAt"] = "2026-11-13T12:00:00+00:00"
        old = copy.deepcopy(m)
        enrich({"generatedAt": m["dataCollectedAt"], "members": [m]}, {str(m["id"]): old}, CONFIG)
        self.assertEqual([p["at"] for p in m["history"]], ["2026-11-13T00:00:00+00:00", "2026-11-13T12:00:00+00:00"])

    def test_daily_compaction_keeps_event_timestamp_stable_across_later_refreshes(self):
        old = self.member()
        level = old["level"]
        base_at = "2026-11-14T08:00:00+00:00"
        event_at = "2026-11-14T09:17:00+00:00"
        old_at = "2026-11-14T10:00:00+00:00"
        old["dungeons"] = dungeon_records(old, CONFIG["dungeons"])
        old["xp"] = xp_progress(old, CONFIG)
        baseline = observation(old)
        base = {**baseline, "at": base_at, "level": level - 1}
        event = {**baseline, "at": event_at, "level": level}
        old["history"] = [base, event]
        old["level"] = level
        old["dataCollectedAt"] = event_at

        current = copy.deepcopy(old)
        current["dataCollectedAt"] = old_at
        enrich({"generatedAt": old_at, "members": [current]}, {str(old["id"]): old}, CONFIG)
        self.assertEqual([point["at"] for point in current["history"]], [base_at, event_at, old_at])

        next_at = "2026-11-14T11:00:00+00:00"
        following = copy.deepcopy(current)
        following["dataCollectedAt"] = next_at
        enrich({"generatedAt": next_at, "members": [following]}, {str(current["id"]): current}, CONFIG)
        self.assertEqual([point["at"] for point in following["history"]], [base_at, event_at, next_at])


if __name__ == "__main__":
    unittest.main()
