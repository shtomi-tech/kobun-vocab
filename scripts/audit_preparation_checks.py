"""古文予習資料の10秒確認を、構造と出典対応の観点から監査する。"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

from generate_preparation_checks import active_preparation_files, active_preparation_refs, load_data


ROOT = Path(__file__).resolve().parent.parent
PREPARATION_DIR = ROOT / "data" / "preparation"
REPORT_PATH = ROOT / "reports" / "preparation-check-map.json"
CHECK_RE = re.compile(r"(?ms)^:::check(?:\s+([A-Za-z0-9_-]+))?\s*$\n(.*?)^:::\s*$")


def parse_check_body(body: str) -> dict[str, object]:
    result: dict[str, object] = {"choices": []}
    for raw_line in body.splitlines():
        match = re.match(r"^(question|choice|answer|explanation):\s*(.*)$", raw_line.strip())
        if not match:
            continue
        field, value = match.groups()
        if field == "choice":
            divider = value.find("|")
            if divider < 0:
                key, text = "", value.strip()
            else:
                key, text = value[:divider].strip(), value[divider + 1 :].strip()
            result["choices"].append((key, text))
        else:
            result[field] = value.strip()
    return result


def main() -> int:
    errors: list[str] = []
    total_headings = 0
    total_checks = 0
    seen_check_ids: set[str] = set()
    curriculum_data = load_data()
    active_files = active_preparation_files(curriculum_data)
    curriculum_refs = active_preparation_refs(curriculum_data)
    status_counts: Counter[str] = Counter()

    for filename in sorted(active_files):
        path = PREPARATION_DIR / filename
        if not path.exists():
            errors.append(f"{filename}: 対象ファイルがない")
            continue
        text = path.read_text(encoding="utf-8")
        headings = re.findall(r"(?m)^##\s+(.+)$", text)
        matches = list(CHECK_RE.finditer(text))
        total_headings += len(headings)
        total_checks += len(matches)
        if len(headings) != len(matches):
            errors.append(f"{filename}: H2={len(headings)} / check={len(matches)}")

        for match in matches:
            check_id = match.group(1) or ""
            if not check_id:
                errors.append(f"{filename}: check IDがない")
            elif check_id in seen_check_ids:
                errors.append(f"{filename}: check IDが重複: {check_id}")
            seen_check_ids.add(check_id)
            parsed = parse_check_body(match.group(2))
            choices = parsed["choices"]
            if not isinstance(choices, list) or len(choices) != 2:
                errors.append(f"{filename} / {check_id}: choiceが2つでない")
                continue
            keys = [choice[0] for choice in choices]
            if any(not key or not text for key, text in choices):
                errors.append(f"{filename} / {check_id}: choiceのキーまたは本文が空")
            if parsed.get("answer") not in keys:
                errors.append(f"{filename} / {check_id}: answerがchoiceにない")
            if not parsed.get("question"):
                errors.append(f"{filename} / {check_id}: questionが空")
            if not parsed.get("explanation"):
                errors.append(f"{filename} / {check_id}: explanationが空")

    if not REPORT_PATH.exists():
        errors.append("reports/preparation-check-map.json: 対応表がない")
        report_checks: list[dict[str, object]] = []
    else:
        report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
        report_checks = report.get("checks", [])
        if report.get("version") != 1:
            errors.append("reports/preparation-check-map.json: versionが1でない")

    report_ids = [str(item.get("checkId", "")) for item in report_checks]
    if len(report_ids) != total_checks:
        errors.append(f"対応表={len(report_ids)} / check={total_checks}")
    if len(set(report_ids)) != len(report_ids):
        errors.append("対応表: checkIdが重複")
    if set(report_ids) != seen_check_ids:
        errors.append("対応表とMarkdownのcheckIdが一致しない")

    for item in report_checks:
        check_id = str(item.get("checkId", ""))
        filename = str(item.get("file", ""))
        if filename not in active_files:
            errors.append(f"対応表 {check_id}: active対象外のファイル")
        if not item.get("sourceId"):
            errors.append(f"対応表 {check_id}: sourceIdがない")
        refs = item.get("curriculumRefs")
        if not isinstance(refs, list) or not refs:
            errors.append(f"対応表 {check_id}: curriculumRefsがない")
        else:
            for ref in refs:
                if not isinstance(ref, dict):
                    errors.append(f"対応表 {check_id}: curriculumRefsの形式が不正")
                    continue
                for key in ("lessonId", "chapterNumber", "sectionIds", "activityIds"):
                    if key not in ref:
                        errors.append(f"対応表 {check_id}: curriculumRefs.{key}がない")
                if filename not in curriculum_refs:
                    errors.append(f"対応表 {check_id}: curriculum正本にないファイル")
        status_counts[str(item.get("reviewStatus", "unknown"))] += 1

    inactive_checks = []
    for path in sorted(PREPARATION_DIR.glob("*.md")):
        if path.name in active_files:
            continue
        if CHECK_RE.search(path.read_text(encoding="utf-8")):
            inactive_checks.append(path.name)
    if inactive_checks:
        errors.append("active対象外にcheckがある: " + ", ".join(inactive_checks))

    print(f"Active files: {len(active_files)}")
    print(f"Instruction headings: {total_headings}")
    print(f"Check blocks: {total_checks}")
    print("Review statuses: " + ", ".join(f"{key}={value}" for key, value in sorted(status_counts.items())))
    if errors:
        print(f"ERROR: {len(errors)}")
        for error in errors:
            print(f"- {error}")
        return 1
    print("Result: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
