#!/usr/bin/env python3
"""data/curriculum.json の構造検証。

--structure : 構造だけを検証する（chapter/lesson番号、ID一意性、参照先の実在、
              予習pathとsectionの実在、重複必修IDのsharedReason、任意領域の不在）。
--release   : --structure に加えて、全46講が status:"ready" であることを要求する。

このスクリプトは「実装可能な形で正しいか」を検証するものであり、問題文・解説の
教育的な妥当性（目次タイトルとの一致など）までは検証しない。それは監査担当者の
役割であり、docs/textbook-curriculum-map.md に記録する。
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CURRICULUM_PATH = ROOT / "data" / "curriculum.json"

CHAPTER_BOUNDARIES = {
    1: (1, 5),
    2: (6, 12),
    3: (13, 26),
    4: (27, 29),
    5: (30, 42),
    6: (43, 46),
}
TOTAL_LESSONS = 46


class CheckResult:
    def __init__(self):
        self.errors = []
        self.warnings = []

    def error(self, msg):
        self.errors.append(msg)

    def warn(self, msg):
        self.warnings.append(msg)

    @property
    def ok(self):
        return not self.errors


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def collect_ids(items, key="id"):
    return {item[key] for item in items if key in item}


def build_data_index(result):
    """各データファイルを読み込み、setId別に「実在する具体的ID一覧」と
    「procedure/group一覧」を返す。ファイルが読めない場合はerrorに積んで空集合を返す。
    """
    index = {}

    def safe_load(relpath):
        p = ROOT / relpath
        if not p.exists():
            result.error(f"データファイルが存在しない: {relpath}")
            return None
        try:
            return load_json(p)
        except Exception as e:
            result.error(f"データファイルの読み込みに失敗: {relpath} ({e})")
            return None

    kiso = safe_load("data/kiso.json")
    if kiso is not None:
        index["kiso"] = {
            "question_ids": collect_ids(kiso.get("kisoQuestions", [])),
            "group_ids": {g["id"]: g.get("ids", []) for g in kiso.get("kisoGroups", [])},
            "procedures": set(),
        }

    katsuyo = safe_load("data/katsuyo.json")
    if katsuyo is not None:
        yougo_items = (
            katsuyo.get("verbs", [])
            + katsuyo.get("adjectives", [])
            + katsuyo.get("adjectivalVerbs", [])
        )
        index["yougo"] = {
            "question_ids": {it.get("id") for it in yougo_items if it.get("id")},
            "group_ids": {},
            "procedures": set(),
        }
        jodoshi_ids = {it.get("no") for it in katsuyo.get("jodoshi", []) if it.get("no") is not None}
        jodoshi_types = {it.get("no"): it.get("type") for it in katsuyo.get("jodoshi", [])}
        index["jodoshi"] = {
            "question_ids": jodoshi_ids,
            "group_ids": {g["id"]: g.get("ids", []) for g in katsuyo.get("groups", [])},
            "procedures": set(),
            "types": jodoshi_types,
        }

    mc = safe_load("data/multiple_choice.json")
    if mc is not None:
        index["choice"] = {
            "question_ids": collect_ids(mc.get("choiceQuestions", [])),
            "group_ids": {g["id"]: g.get("ids", []) for g in mc.get("choiceGroups", [])},
            "procedures": set(),
        }

    shikibetsu = safe_load("data/shikibetsu.json")
    if shikibetsu is not None:
        retired_ids = set()
        deprecated = shikibetsu.get("deprecated")
        if isinstance(deprecated, dict):
            retired_ids |= _collect_all_ids(deprecated)
        index["shikibetsu"] = {
            "question_ids": collect_ids(shikibetsu.get("shikibetsuQuestions", [])),
            "group_ids": {g["id"]: g.get("ids", []) for g in shikibetsu.get("shikibetsuGroups", [])},
            "procedures": collect_ids(shikibetsu.get("procedures", [])),
            "retired_ids": retired_ids,
        }

    joshi = safe_load("data/shikibetsu-joshi.json")
    if joshi is not None:
        index["joshi"] = {
            "question_ids": collect_ids(joshi.get("joshiQuestions", [])),
            "group_ids": {g["id"]: g.get("ids", []) for g in joshi.get("joshiGroups", [])},
            "procedures": collect_ids(joshi.get("joshiProcedures", [])),
        }

    homograph = safe_load("data/shikibetsu-homograph.json")
    if homograph is not None:
        index["homograph"] = {
            "question_ids": collect_ids(homograph.get("homographQuestions", [])),
            "group_ids": {g["id"]: g.get("ids", []) for g in homograph.get("homographGroups", [])},
            "procedures": collect_ids(homograph.get("homographProcedures", [])),
        }

    keigo = safe_load("data/shikibetsu-keigo.json")
    if keigo is not None:
        index["keigo-shikibetsu"] = {
            "question_ids": collect_ids(keigo.get("keigoQuestions", [])),
            "group_ids": {g["id"]: g.get("ids", []) for g in keigo.get("keigoGroups", [])},
            "procedures": collect_ids(keigo.get("keigoProcedures", [])),
        }

    return index


def _collect_all_ids(obj):
    """ネストしたdict/listから "id" キーの値をすべて収集する（deprecatedブロック用）。"""
    found = set()
    if isinstance(obj, dict):
        if "id" in obj and isinstance(obj["id"], str):
            found.add(obj["id"])
        for v in obj.values():
            found |= _collect_all_ids(v)
    elif isinstance(obj, list):
        for v in obj:
            found |= _collect_all_ids(v)
    return found


def all_lessons(curriculum):
    for chapter in curriculum.get("chapters", []):
        for lesson in chapter.get("lessons", []):
            yield chapter, lesson


def check_structure(curriculum, data_index, result):
    chapters = curriculum.get("chapters", [])

    # chapter番号 1..6 連続
    chapter_numbers = [c.get("number") for c in chapters]
    if chapter_numbers != sorted(chapter_numbers) or chapter_numbers != list(range(1, len(chapters) + 1)):
        result.error(f"chapter番号が1から連続していない: {chapter_numbers}")
    if len(chapters) != 6:
        result.error(f"chapter数が6ではない: {len(chapters)}")

    # lesson番号 1..46 一意・連続、chapter境界一致
    seen_lesson_numbers = []
    lesson_id_seen = set()
    activity_id_seen = set()

    for chapter in chapters:
        cnum = chapter.get("number")
        expected_range = CHAPTER_BOUNDARIES.get(cnum)
        lesson_numbers_in_chapter = [l.get("number") for l in chapter.get("lessons", [])]
        if expected_range:
            lo, hi = expected_range
            expected = list(range(lo, hi + 1))
            if lesson_numbers_in_chapter != expected:
                result.error(
                    f"chapter {cnum}「{chapter.get('title')}」の講番号が境界と不一致: "
                    f"期待={expected} 実際={lesson_numbers_in_chapter}"
                )
        else:
            result.error(f"未知のchapter番号: {cnum}")

        for lesson in chapter.get("lessons", []):
            seen_lesson_numbers.append(lesson.get("number"))
            lid = lesson.get("id")
            if lid in lesson_id_seen:
                result.error(f"lesson idが重複: {lid}")
            lesson_id_seen.add(lid)

            expected_id = f"lesson-{lesson.get('number'):02d}"
            if lid != expected_id:
                result.error(f"lesson idと講番号が不一致: id={lid} number={lesson.get('number')} (期待={expected_id})")

            for activity in lesson.get("requiredActivities", []) + lesson.get("supplementalActivities", []):
                aid = activity.get("id")
                if aid in activity_id_seen:
                    result.error(f"activity idが重複: {aid}")
                activity_id_seen.add(aid)

    if seen_lesson_numbers != list(range(1, TOTAL_LESSONS + 1)):
        result.error(f"lesson番号が1〜{TOTAL_LESSONS}で連続・網羅していない: {seen_lesson_numbers}")

    # ready講の必須項目
    for chapter, lesson in all_lessons(curriculum):
        if lesson.get("status") == "ready":
            if not lesson.get("preparation"):
                result.error(f"{lesson['id']}: status=readyだがpreparationが空")
            if not lesson.get("requiredActivities"):
                result.error(f"{lesson['id']}: status=readyだがrequiredActivitiesが空")
        if lesson.get("status") not in ("ready", "partial", "blocked"):
            result.error(f"{lesson['id']}: 不正なstatus値: {lesson.get('status')}")

    # 参照先の実在チェック + 重複必修IDのsharedReason検査 + retired検査
    required_id_owners = {}  # (setId, concrete_id_or_PROC_marker) -> [(lesson_id, has_shared_reason)]

    for chapter, lesson in all_lessons(curriculum):
        for activity in lesson.get("requiredActivities", []) + lesson.get("supplementalActivities", []):
            is_required = activity in lesson.get("requiredActivities", [])
            check_activity_refs(activity, lesson, data_index, result)
            if is_required:
                register_required_ids(activity, lesson, data_index, required_id_owners)

    for key, owners in required_id_owners.items():
        lesson_ids = {o[0] for o in owners}
        if len(lesson_ids) > 1:
            has_shared_reason = any(o[1] for o in owners)
            if not has_shared_reason:
                setid, concrete = key
                result.error(
                    f"必修IDの重複（sharedReasonなし）: setId={setid} id={concrete} "
                    f"を必修に持つ講={sorted(lesson_ids)}"
                )

    # preparation path / section の実在チェック
    for chapter, lesson in all_lessons(curriculum):
        for prep in lesson.get("preparation", []):
            path = prep.get("path")
            if not path:
                result.error(f"{lesson['id']}: preparation.pathが空")
                continue
            full_path = ROOT / path
            if not full_path.exists():
                result.error(f"{lesson['id']}: preparation pathが存在しない: {path}")
                continue
            sections = prep.get("sections") or []
            if sections:
                text = full_path.read_text(encoding="utf-8")
                anchors = set(re.findall(r":::check\s+(\S+)", text))
                for sec in sections:
                    if sec not in anchors:
                        result.error(
                            f"{lesson['id']}: preparation section '{sec}' が {path} 内に見つからない"
                        )

    # 46講後の任意領域はアプリから削除済み。再追加を正本検査で止める。
    if "checkpoint" in curriculum:
        result.error("文法混合確認は削除済みだが、curriculum.jsonに'checkpoint'キーが残っている")
    if "extensions" in curriculum:
        result.error("発展学習は削除済みだが、curriculum.jsonに'extensions'キーが残っている")


def check_activity_refs(activity, lesson, data_index, result):
    kind = activity.get("kind")
    set_id = activity.get("setId")

    if "stepRange" in activity:
        step_range = activity.get("stepRange")
        if (
            not isinstance(step_range, list)
            or len(step_range) != 2
            or any(not isinstance(value, int) or value < 0 for value in step_range)
            or step_range[0] > step_range[1]
        ):
            result.error(f"{lesson['id']}/{activity.get('id')}: stepRangeが不正: {step_range}")

    if kind not in ("group", "procedure"):
        result.error(f"{lesson['id']}: 不正なactivity.kind: {kind}")
        return

    if set_id not in data_index:
        result.error(f"{lesson['id']}: 未知のsetId: {set_id}")
        return
    entry = data_index[set_id]

    if kind == "group":
        group_id = activity.get("groupId")
        ids = activity.get("ids")
        if not group_id and not ids:
            result.error(f"{lesson['id']}/{activity.get('id')}: groupIdもidsも無い")
            return
        if group_id:
            if group_id not in entry["group_ids"]:
                result.error(f"{lesson['id']}/{activity.get('id')}: groupId '{group_id}' が setId={set_id} に存在しない")
        if ids:
            for cid in ids:
                if cid not in entry["question_ids"]:
                    result.error(
                        f"{lesson['id']}/{activity.get('id')}: id '{cid}' が setId={set_id} の実データに存在しない"
                    )
                retired = entry.get("retired_ids") or set()
                if cid in retired:
                    result.error(f"{lesson['id']}/{activity.get('id')}: id '{cid}' はretired/deprecated済み")

    elif kind == "procedure":
        proc_id = activity.get("procId")
        if not proc_id:
            result.error(f"{lesson['id']}/{activity.get('id')}: procedure活動にprocIdが無い")
            return
        if proc_id not in entry["procedures"]:
            result.error(f"{lesson['id']}/{activity.get('id')}: procId '{proc_id}' が setId={set_id} に存在しない")
        ids = activity.get("ids")
        if ids:
            for cid in ids:
                if cid not in entry["question_ids"]:
                    result.error(
                        f"{lesson['id']}/{activity.get('id')}: id '{cid}' が setId={set_id} の実データに存在しない"
                    )


def register_required_ids(activity, lesson, data_index, required_id_owners):
    kind = activity.get("kind")
    set_id = activity.get("setId")
    if kind not in ("group", "procedure") or set_id not in data_index:
        return
    entry = data_index[set_id]
    has_shared_reason = bool(activity.get("sharedReason"))
    ids = activity.get("ids")

    if kind == "group":
        if ids:
            concrete_ids = ids
        elif activity.get("groupId"):
            concrete_ids = entry["group_ids"].get(activity["groupId"], [])
        else:
            concrete_ids = []
        for cid in concrete_ids:
            key = (set_id, cid)
            required_id_owners.setdefault(key, []).append((lesson["id"], has_shared_reason))

    elif kind == "procedure":
        proc_id = activity.get("procId")
        if ids:
            for cid in ids:
                key = (set_id, cid)
                required_id_owners.setdefault(key, []).append((lesson["id"], has_shared_reason))
        else:
            key = (set_id, f"PROC:{proc_id}")
            required_id_owners.setdefault(key, []).append((lesson["id"], has_shared_reason))


def check_release(curriculum, result):
    not_ready = []
    for chapter, lesson in all_lessons(curriculum):
        if lesson.get("status") != "ready":
            not_ready.append(f"{lesson['number']:02d} {lesson.get('title')} ({lesson.get('status')})")
    if not_ready:
        result.error(
            "release不可: 以下の講がstatus=readyではない:\n  " + "\n  ".join(not_ready)
        )


def main():
    mode = "--structure"
    if len(sys.argv) > 1:
        mode = sys.argv[1]
    if mode not in ("--structure", "--release"):
        print("使い方: check_curriculum.py [--structure|--release]", file=sys.stderr)
        return 2

    if not CURRICULUM_PATH.exists():
        print(f"ERROR: {CURRICULUM_PATH} が存在しない", file=sys.stderr)
        return 1
    curriculum = load_json(CURRICULUM_PATH)

    result = CheckResult()
    data_index = build_data_index(result)
    check_structure(curriculum, data_index, result)

    if mode == "--release":
        check_release(curriculum, result)

    for w in result.warnings:
        print(f"WARN: {w}")
    for e in result.errors:
        print(f"FAIL: {e}")

    if result.ok:
        print(f"{mode}: OK")
        return 0
    else:
        print(f"{mode}: FAIL ({len(result.errors)} 件)")
        return 1


if __name__ == "__main__":
    sys.exit(main())
