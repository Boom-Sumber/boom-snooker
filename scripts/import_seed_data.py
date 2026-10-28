#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据源导入（T0.3）：D:\\app\\SnookerHelper\\data  ->  Supabase

数据源（唯一真相）：
    D:\\app\\SnookerHelper\\data\\text\\data.xlsx   ColorBalls 122 行 + AdvanceTable 63 行 = 185 行
    D:\\app\\SnookerHelper\\data\\img\\*.png        326 张图（77 MB）
    D:\\app\\SnookerHelper\\data\\text\\home.txt    首页三段文案（T3.6 用，本脚本不处理）

依赖：pip install openpyxl

两种输出，同一个映射逻辑，结果等价：
  1. 生成 supabase/migrations/008_seed_data.sql —— 可提交、可回放、人类可读
  2. --apply 时直接通过 PostgREST 批量灌入（走管理员 JWT，顺便验证 RLS 写权限）

用法：
    python scripts/import_seed_data.py                       # 只生成 SQL
    python scripts/import_seed_data.py --apply --password xx # 生成 + 灌入

映射规则见 docs/03-数据模型与接口.md 第 6 节。数据源只读，不修改任何源文件。
"""
import argparse
import collections
import json
import os
import sys
import urllib.error
import urllib.request
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = r"D:\app\SnookerHelper\data"
XLSX = os.path.join(SRC, "text", "data.xlsx")
IMG_DIR = os.path.join(SRC, "img")
OUT_SQL = os.path.join(ROOT, "supabase", "migrations", "008_seed_data.sql")
ENV_LOCAL = os.path.join(ROOT, ".env.local")

# ── 枚举映射（与 001_tables.sql 的 display_dict 对齐） ──────────────────
COLOR = {"黄球": "yellow", "绿球": "green", "咖啡球": "brown",
         "蓝球": "blue", "粉球": "pink", "黑球": "black"}
POCKET = {"左上袋": "top_left", "左下袋": "bottom_left",
          "上中袋": "top_middle", "下中袋": "bottom_middle",
          "右上袋": "top_right", "右下袋": "bottom_right"}
STRENGTH = {"满力": "full", "半力（小力）": "half"}
CATEGORY = {"直线系列": "straight", "翻袋系列": "kick",
            "弧线系列": "curve", "破局系列": "break", "其他系列": "other"}


# ── 读 xlsx ───────────────────────────────────────────────────────────
def read_xlsx():
    try:
        import openpyxl
    except ImportError:
        sys.exit("缺少依赖：pip install openpyxl")
    if not os.path.exists(XLSX):
        sys.exit("找不到数据源: " + XLSX)

    wb = openpyxl.load_workbook(XLSX, data_only=True)

    def sheet(name):
        ws = wb[name]
        it = ws.iter_rows(values_only=True)
        hdr = next(it)
        return [dict(zip(hdr, r)) for r in it if any(c is not None for c in r)]

    return sheet("ColorBalls"), sheet("AdvanceTable")


def _s(v):
    """xlsx 单元格 -> str；None 与字符串 'NULL' 统一成空串"""
    if v is None:
        return ""
    s = str(v).strip()
    return "" if s.upper() == "NULL" else s


def _ts(v):
    """xlsx 里的 datetime 是东八区本地时间（无时区），显式补 +08"""
    s = _s(v)
    if not s:
        return None
    s = s.replace("T", " ")
    return s + "+08:00" if len(s) == 19 else s


def build(cb_rows, adv_rows):
    files = set(os.listdir(IMG_DIR)) if os.path.isdir(IMG_DIR) else set()
    problems = []

    def path(prefix, name, row_id, field):
        if not name:
            problems.append(f"{row_id[:8]} {field} 为空（客户端需显示占位）")
            return ""
        if name not in files:
            problems.append(f"{row_id[:8]} {field} 文件缺失 {name}")
            return ""
        return f"{prefix}/{name}"

    balls = []
    for r in cb_rows:
        bid = _s(r["Id"])
        if not _is_uuid(bid):
            problems.append(f"{bid[:8]} 不是合法 uuid")
        color, pocket, strength = _s(r["ColorBall"]), _s(r["BagMouth"]), _s(r["Strength"])
        for val, table, field in ((color, COLOR, "ColorBall"),
                                  (pocket, POCKET, "BagMouth"),
                                  (strength, STRENGTH, "Strength")):
            if val not in table:
                problems.append(f"{bid[:8]} 未知 {field} 取值 {val!r}")
        balls.append({
            "id": bid,
            "color_code": COLOR.get(color, color),
            "pocket_code": POCKET.get(pocket, pocket),
            "method": _s(r["Method"]),                       # 自由文本，原样保留
            "strength_code": STRENGTH.get(strength, strength),
            "sight": _s(r["Sight"]),
            "low_comp": _s(r["LowCompensate"]),
            "high_comp": _s(r["HighCompensate"]),
            "remark": _s(r["Remark"]),
            "impact_image": path("balls", _s(r["ImpactPointImageName"]), bid, "ImpactPointImageName"),
            "blue_image": path("balls", _s(r["BluePointImageName"]), bid, "BluePointImageName"),
            "route_image": path("balls", _s(r["RouteImageName"]), bid, "RouteImageName"),
            "state": int(r["State"]),
            "updated_at": _ts(r["UpdateTime"]),
            "updated_by": _s(r["UpdateUser"]),
        })

    adv = []
    for r in adv_rows:
        aid = _s(r["Id"])
        if not _is_uuid(aid):
            problems.append(f"{aid[:8]} 不是合法 uuid")
        cate = _s(r["Type"])
        if cate not in CATEGORY:
            problems.append(f"{aid[:8]} 未知 Type 取值 {cate!r}")
        adv.append({
            "id": aid,
            "category_code": CATEGORY.get(cate, cate),
            "title": _s(r["Title"]),
            "description": _s(r["Description"]) or None,
            "content": _s(r["Content"]) or None,
            "image": path("advanced", _s(r["AdvanceImageName"]), aid, "AdvanceImageName"),
            "state": int(r["State"]),
            "updated_at": _ts(r["UpdateTime"]),
            "updated_by": _s(r["UpdateUser"]),
        })
    return balls, adv, problems


def _is_uuid(s):
    try:
        uuid.UUID(s); return True
    except (ValueError, AttributeError):
        return False


# ── 输出 SQL ──────────────────────────────────────────────────────────
def lit(v):
    if v is None:
        return "null"
    return "'" + str(v).replace("'", "''") + "'"


def write_sql(balls, adv):
    BALL_COLS = ["id", "color_code", "pocket_code", "method", "strength_code", "sight",
                 "low_comp", "high_comp", "remark", "impact_image", "blue_image",
                 "route_image", "state", "updated_at", "updated_by"]
    ADV_COLS = ["id", "category_code", "title", "description", "content", "image",
                "state", "updated_at", "updated_by"]

    def stmt(table, cols, row):
        vals = []
        for c in cols:
            v = row[c]
            vals.append(f"{lit(v)}::timestamptz" if c == "updated_at" else lit(v))
        return (f"insert into {table} ({', '.join(cols)}) values ({', '.join(vals)}) "
                f"on conflict (id) do nothing;")

    lines = [
        "-- 008 · 数据源导入（由 scripts/import_seed_data.py 生成，不要手改）",
        "-- 源：D:\\app\\SnookerHelper\\data\\text\\data.xlsx",
        "--     ColorBalls 122 行 + AdvanceTable 63 行 = 185 行",
        "-- 中文值按 display_dict 转 code；state 原样保留；图片字段存 Storage object path（.png，T0.4 转 .webp）",
        "-- 时间按东八区解析（xlsx 里是无时区的本地时间）",
        "",
        "-- 重灌前先清空目标表（--apply 会先 DELETE 再 POST，不是增量合并）",
        "",
        "-- ── 彩球打法 ──",
    ]
    lines += [stmt("balls", BALL_COLS, r) for r in balls]
    lines += ["", "-- ── 进阶系列 ──"]
    lines += [stmt("advanced", ADV_COLS, r) for r in adv]
    lines += [
        "",
        "-- 灌数据期间 bump_dataset_version 每行 +1，这里复位成初始版本",
        "update dataset_meta set version = 1, updated_at = now() where id = 1;",
        "",
    ]
    os.makedirs(os.path.dirname(OUT_SQL), exist_ok=True)
    with open(OUT_SQL, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))


# ── PostgREST ─────────────────────────────────────────────────────────
def load_env():
    cfg = {}
    if os.path.exists(ENV_LOCAL):
        for line in open(ENV_LOCAL, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                cfg[k.strip()] = v.strip()
    return cfg["VITE_SUPABASE_URL"], cfg["VITE_SUPABASE_KEY"]


def req(base, key, method, path, body=None, token=None, extra=None):
    r = urllib.request.Request(base + path,
        data=json.dumps(body).encode() if body is not None else None, method=method)
    r.add_header("apikey", key)
    r.add_header("Content-Type", "application/json")
    r.add_header("Authorization", "Bearer " + (token or key))
    for k, v in (extra or {}).items():
        r.add_header(k, v)
    try:
        with urllib.request.urlopen(r) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw[:500]


def apply_api(balls, adv, email, password):
    base, key = load_env()
    st, body = req(base, key, "POST", "/auth/v1/token?grant_type=password",
                   {"email": email, "password": password})
    if st != 200:
        sys.exit(f"登录失败（{st}）：{body}")
    token = body["access_token"]
    st, me = req(base, key, "GET", "/rest/v1/profiles?select=id,nickname,role", token=token)
    if not (isinstance(me, list) and me and me[0]["role"] == "admin"):
        sys.exit(f"当前账号不是管理员，无法写入：{me}")
    print(f"登录为 {email}（role=admin）")

    # 先清空，保证与数据源完全一致（不是增量合并）
    st, _ = req(base, key, "DELETE", "/rest/v1/balls?id=not.is.null", token=token)
    print(f"DELETE /balls     -> HTTP {st}")
    st, _ = req(base, key, "DELETE", "/rest/v1/advanced?id=not.is.null", token=token)
    print(f"DELETE /advanced  -> HTTP {st}")

    st, res = req(base, key, "POST", "/rest/v1/balls?select=id", balls, token=token,
                  extra={"Prefer": "return=representation"})
    print(f"POST /balls       -> HTTP {st}, 写入 {len(res) if isinstance(res, list) else res} 行")
    if st not in (200, 201):
        sys.exit("彩球灌入失败")

    st, res = req(base, key, "POST", "/rest/v1/advanced?select=id", adv, token=token,
                  extra={"Prefer": "return=representation"})
    print(f"POST /advanced    -> HTTP {st}, 写入 {len(res) if isinstance(res, list) else res} 行")
    if st not in (200, 201):
        sys.exit("进阶灌入失败")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="灌入数据库（需要管理员账号）")
    ap.add_argument("--email", default="admin@snooker.local")
    ap.add_argument("--password")
    args = ap.parse_args()

    cb_rows, adv_rows = read_xlsx()
    balls, adv, problems = build(cb_rows, adv_rows)

    print(f"数据源 {SRC}")
    print(f"  ColorBalls   {len(cb_rows)} 行")
    print(f"  AdvanceTable {len(adv_rows)} 行")
    print(f"  合计         {len(cb_rows) + len(adv_rows)} 行")
    print(f"  转换后 balls {len(balls)}（state=1 {sum(1 for b in balls if b['state'] == 1)}） / "
          f"advanced {len(adv)}（state=1 {sum(1 for a in adv if a['state'] == 1)}）")

    write_sql(balls, adv)
    print(f"已生成 {OUT_SQL}")

    if problems:
        print(f"\n⚠️  {len(problems)} 条提示：")
        for p, n in collections.Counter(problems).most_common(20):
            print(f"    {n} × {p}")
    else:
        print("✅ 映射无问题")

    if args.apply:
        if not args.password:
            sys.exit("--apply 需要 --password")
        print()
        apply_api(balls, adv, args.email, args.password)


if __name__ == "__main__":
    main()
