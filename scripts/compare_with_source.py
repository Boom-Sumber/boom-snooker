#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据源 ↔ 数据库 对比（T11.1，只读）

数据源是唯一真相（只读，不修改）：
    D:\\app\\SnookerHelper\\data\\text\\data.xlsx   ColorBalls 122 行 + AdvanceTable 63 行

为什么不用 openpyxl：这台机器上没装，pip 装依赖会改环境。
xlsx 本质是一个 zip（sharedStrings.xml + worksheets/sheetN.xml），
用标准库 zipfile + xml 就能读，结果一样。

输出：源数据里每个颜色 / 每个系列各有几条，打印成 JSON ——
拿它跟 `docs/09-数据清洗清单.md` 里库里的数字对，能对上就说明
"保留的确实是原始数据，没有删错也没有多出来"。

用法：
    python scripts/compare_with_source.py
"""
import json
import os
import re
import zipfile
import xml.etree.ElementTree as ET

SRC_XLSX = r"D:\app\SnookerHelper\data\text\data.xlsx"

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

COLOR = {"黄球": "yellow", "绿球": "green", "咖啡球": "brown",
         "蓝球": "blue", "粉球": "pink", "黑球": "black"}
CATEGORY = {"直线系列": "straight", "翻袋系列": "kick", "弧线系列": "curve",
            "破局系列": "break", "其他系列": "other"}


def col_index(ref: str) -> int:
    """'AB12' -> 27（只看字母部分）"""
    letters = re.match(r"([A-Z]+)", ref).group(1)
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def shared_strings(z: zipfile.ZipFile):
    try:
        raw = z.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    root = ET.fromstring(raw)
    out = []
    for si in root.findall(f"{NS}si"):
        out.append("".join(t.text or "" for t in si.iter(f"{NS}t")))
    return out


def sheet_files(z: zipfile.ZipFile):
    """sheet 名 -> zip 内的 xml 路径"""
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rel_map = {r.get("Id"): r.get("Target") for r in rels}
    out = {}
    for sh in wb.find(f"{NS}sheets"):
        target = rel_map.get(sh.get(f"{REL_NS}id"), "")
        target = target.lstrip("/")
        out[sh.get("name")] = "xl/" + target if not target.startswith("xl/") else target
    return out


def read_sheet(z: zipfile.ZipFile, path: str, strings):
    root = ET.fromstring(z.read(path))
    rows = []
    for row in root.iter(f"{NS}row"):
        cells = {}
        for c in row.findall(f"{NS}c"):
            ref = c.get("r") or ""
            v = c.find(f"{NS}v")
            if v is None:
                continue
            val = v.text or ""
            if c.get("t") == "s":
                val = strings[int(val)] if val.isdigit() else val
            cells[col_index(ref)] = val.strip()
        rows.append(cells)

    if not rows:
        return []
    header = rows[0]
    out = []
    for r in rows[1:]:
        if not any(v for v in r.values()):
            continue
        out.append({header.get(i, str(i)): v for i, v in r.items()})
    return out


def pick_column(rows, known_values):
    """找出哪列的值大多落在 known_values 里（不知道表头叫啥时用）"""
    if not rows:
        return None
    best, best_hits = None, 0
    for key in rows[0].keys():
        hits = sum(1 for r in rows if str(r.get(key, "")) in known_values)
        if hits > best_hits:
            best, best_hits = key, hits
    return best if best_hits else None


def main():
    if not os.path.exists(SRC_XLSX):
        raise SystemExit("找不到数据源: " + SRC_XLSX)

    with zipfile.ZipFile(SRC_XLSX) as z:
        strings = shared_strings(z)
        files = sheet_files(z)
        balls = read_sheet(z, files["ColorBalls"], strings) if "ColorBalls" in files else []
        advanced = read_sheet(z, files["AdvanceTable"], strings) if "AdvanceTable" in files else []

    ball_col = pick_column(balls, set(COLOR))
    adv_col = pick_column(advanced, set(CATEGORY))

    def count(rows, col, mapping):
        tally = {}
        for r in rows:
            code = mapping.get(str(r.get(col, "")), "?")
            tally[code] = tally.get(code, 0) + 1
        return tally

    print(json.dumps({
        "source": SRC_XLSX,
        "balls": {
            "total": len(balls),
            "column": ball_col,
            "by_color": count(balls, ball_col, COLOR) if ball_col else {},
        },
        "advanced": {
            "total": len(advanced),
            "column": adv_col,
            "by_category": count(advanced, adv_col, CATEGORY) if adv_col else {},
        },
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
