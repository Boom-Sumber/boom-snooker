#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
旧 WPF 版 MySQL dump → Supabase 数据迁移（T0.3）

两种输出，同一个映射逻辑，结果等价：
  1. 生成 supabase/migrations/008_seed_data.sql —— 可提交、可回放、人类可读
  2. --apply 时直接通过 PostgREST 批量灌入（走管理员 JWT，顺便验证 RLS 写权限）

用法：
    python scripts/migrate_legacy_data.py                # 只生成 SQL
    python scripts/migrate_legacy_data.py --apply        # 生成 + 灌入
    python scripts/migrate_legacy_data.py --apply --email admin@snooker.local --password xxx

映射规则见 docs/03-数据模型与接口.md 第 6 节。
输入只读，不修改旧库任何文件。
"""
import argparse
import collections
import json
import os
import re
import sys
import urllib.error
import urllib.request
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DUMP = r"E:\wpf\wpf\SnookerApp\备份数据\snooker-data.sql"
IMG_DIR = r"E:\wpf\wpf\SnookerApp\备份数据\data\img"
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


# ── 解析 MySQL dump ───────────────────────────────────────────────────
def parse_values(s):
    out, cur, i, in_str = [], [], 1, False
    while i < len(s):
        c = s[i]
        if in_str:
            if c == "\\":
                cur.append(s[i + 1]); i += 2; continue
            if c == "'":
                if i + 1 < len(s) and s[i + 1] == "'":
                    cur.append("'"); i += 2; continue
                in_str = False; i += 1; continue
            cur.append(c); i += 1; continue
        if c == "'":
            in_str = True; i += 1; continue
        if c == ",":
            out.append("".join(cur).strip()); cur = []; i += 1; continue
        if c == ")":
            out.append("".join(cur).strip()); break
        cur.append(c); i += 1
    return out


def read_dump():
    if not os.path.exists(DUMP):
        sys.exit("找不到旧库 dump: " + DUMP)
    img_name, balls, adv = {}, [], []
    row_pat = re.compile(r"^INSERT INTO `([^`]+)` VALUES \((.*)\);$")
    with open(DUMP, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.rstrip("\n")
            if line.startswith("INSERT INTO `image_binarys`"):
                # blob 86MB，只截前两列拿 id 与文件名
                m = re.match(r"INSERT INTO `image_binarys` VALUES \('([^']*)', '([^']*)', ", line)
                if m:
                    img_name[m.group(1)] = m.group(2)
                continue
            m = row_pat.match(line)
            if not m:
                continue
            if m.group(1) == "color_balls":
                balls.append(parse_values("(" + m.group(2) + ")"))
            elif m.group(1) == "advance_table":
                adv.append(parse_values("(" + m.group(2) + ")"))
    return img_name, balls, adv


def build(img_name, balls, adv):
    """旧行 -> 新行 dict；同时收集映射问题"""
    files = set(os.listdir(IMG_DIR)) if os.path.isdir(IMG_DIR) else set()
    problems = []

    def path(prefix, image_id, row_id):
        if not image_id:
            return ""
        name = img_name.get(image_id)
        if name is None:
            problems.append(f"{row_id[:8]} 引用的图片在 image_binarys 里不存在")
            return ""
        if name not in files:
            problems.append(f"{row_id[:8]} 的图片文件缺失 {name}")
            return ""
        return f"{prefix}/{name}"

    new_balls, new_adv = [], []
    for r in balls:
        (bid, color, pocket, method, strength, sight, low, high, remark,
         impact, blue, route, state, utime, uuser) = r
        for val, table, field in ((color, COLOR, "color"), (pocket, POCKET, "pocket"),
                                  (strength, STRENGTH, "strength")):
            if val not in table:
                problems.append(f"{bid[:8]} 未知 {field} 取值 {val!r}")
        if not _is_uuid(bid):
            problems.append(f"{bid[:8]} 不是合法 uuid")
        new_balls.append({
            "id": bid,
            "color_code": COLOR.get(color, color),
            "pocket_code": POCKET.get(pocket, pocket),
            "method": method,                                  # 自由文本，原样保留
            "strength_code": STRENGTH.get(strength, strength),
            "sight": sight,
            "low_comp": low,
            "high_comp": high,
            "remark": remark,
            "impact_image": path("balls", impact, bid),
            "blue_image": path("balls", blue, bid),
            "route_image": path("balls", route, bid),
            "state": int(state),
            "updated_at": utime + "+08:00",                    # 旧库是东八区本地时间
            "updated_by": uuser,
        })

    for r in adv:
        (aid, atype, title, desc, content, image_id, state, utime, uuser) = r
        if atype not in CATEGORY:
            problems.append(f"{aid[:8]} 未知系列 {atype!r}")
        if not _is_uuid(aid):
            problems.append(f"{aid[:8]} 不是合法 uuid")
        new_adv.append({
            "id": aid,
            "category_code": CATEGORY.get(atype, atype),
            "title": title,
            "description": desc or None,
            "content": content or None,
            "image": path("advanced", image_id, aid),
            "state": int(state),
            "updated_at": utime + "+08:00",
            "updated_by": uuser,
        })
    return new_balls, new_adv, problems


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
        "-- 008 · 旧库数据迁移（由 scripts/migrate_legacy_data.py 生成，不要手改）",
        "-- 源：E:\\wpf\\wpf\\SnookerApp\\备份数据\\snooker-data.sql（2024-10-29 导出）",
        "-- 中文值按 display_dict 转 code；state 原样保留（软删行也迁，快照只取 state=1）",
        "-- 图片字段暂存 Storage object path（.png），T0.4 转 WebP 后统一改后缀",
        "-- 时间按东八区解析（旧库 datetime 无时区，实为本地时间）",
        "",
    ]
    lines.append("-- ── 彩球打法 ──")
    lines += [stmt("balls", BALL_COLS, r) for r in balls]
    lines.append("")
    lines.append("-- ── 进阶系列 ──")
    lines += [stmt("advanced", ADV_COLS, r) for r in adv]
    lines.append("")
    lines.append("-- 灌数据期间 bump_dataset_version 每行 +1，这里复位成初始版本")
    lines.append("update dataset_meta set version = 1, updated_at = now() where id = 1;")
    lines.append("")
    os.makedirs(os.path.dirname(OUT_SQL), exist_ok=True)
    with open(OUT_SQL, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))


# ── PostgREST 灌入 ────────────────────────────────────────────────────
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
    print(f"登录为 {email} -> {me}")

    # 批量插入（单请求 124 行）；on conflict 用 ignore-duplicates 等价于 do nothing
    st, res = req(base, key, "POST", "/rest/v1/balls?select=id", balls, token=token,
                  extra={"Prefer": "return=representation,resolution=ignore-duplicates"})
    print(f"POST /balls  -> HTTP {st}, 返回 {len(res) if isinstance(res, list) else res} 行")
    if st not in (200, 201):
        sys.exit("彩球灌入失败")

    st, res = req(base, key, "POST", "/rest/v1/advanced?select=id", adv, token=token,
                  extra={"Prefer": "return=representation,resolution=ignore-duplicates"})
    print(f"POST /advanced -> HTTP {st}, 返回 {len(res) if isinstance(res, list) else res} 行")
    if st not in (200, 201):
        sys.exit("进阶灌入失败")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="灌入数据库（需要管理员账号）")
    ap.add_argument("--email", default="admin@snooker.local")
    ap.add_argument("--password")
    args = ap.parse_args()

    img_name, raw_balls, raw_adv = read_dump()
    balls, adv, problems = build(img_name, raw_balls, raw_adv)

    print(f"旧库：color_balls {len(raw_balls)} 行 / advance_table {len(raw_adv)} 行 / "
          f"image_binarys {len(img_name)} 条")
    print(f"转换：balls {len(balls)} 行（state=1 {sum(1 for b in balls if b['state'] == 1)}） / "
          f"advanced {len(adv)} 行（state=1 {sum(1 for a in adv if a['state'] == 1)}）")

    write_sql(balls, adv)
    print(f"已生成 {OUT_SQL}")

    if problems:
        print(f"\n⚠️  {len(problems)} 条映射问题：")
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
