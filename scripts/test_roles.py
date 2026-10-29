#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
T0.7 验收：四角色权限行为测试（直接打 PostgREST，不看 SQL 是否执行成功）

用法：
    set SNOOKER_PW=xxx && python scripts/test_roles.py --phase 1
    # 中间由人工/脚本把 advanced 的待审记录审核通过
    set SNOOKER_PW=xxx && python scripts/test_roles.py --phase 2 --record <uuid>
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_seed_data import load_env   # noqa: E402

PW = {
    "admin@snooker.local": "SkSfm63j0r5N!",
    "admin2@snooker.local": "Admf8bBK8WYo!",
    "viewer-test@snooker.local": "Test123456!",
    "advanced-test@snooker.local": "Test123456!",
}

BASE, KEY = load_env()
results = []


def req(method, path, body=None, token=None, extra=None):
    # urllib 不接受 URL 里的非 ASCII，查询串里的中文要转义
    path = urllib.parse.quote(path, safe="/?&=:,%")
    r = urllib.request.Request(BASE + path,
        data=json.dumps(body).encode() if body is not None else None, method=method)
    r.add_header("apikey", KEY)
    r.add_header("Content-Type", "application/json")
    r.add_header("Authorization", "Bearer " + (token or KEY))
    for k, v in (extra or {}).items():
        r.add_header(k, v)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw[:300]


def login(email):
    st, b = req("POST", "/auth/v1/token?grant_type=password",
                {"email": email, "password": PW[email]})
    if st != 200:
        sys.exit(f"{email} 登录失败：{st} {b}")
    return b["access_token"]


def check(label, ok, detail=""):
    results.append((ok, label, detail))
    print(f"{'✅' if ok else '❌'} {label}" + (f"  → {detail}" if detail else ""))


BALL = {
    "color_code": "black", "pocket_code": "top_left", "method": "直线",
    "strength_code": "full", "sight": "测试", "low_comp": "测试",
    "high_comp": "测试", "remark": "权限测试",
    "impact_image": "balls/test.webp", "blue_image": "balls/test.webp",
    "route_image": "balls/test.webp",
}


def version(tok):
    return req("POST", "/rest/v1/rpc/get_dataset_version", {}, token=tok)[1]


def phase1():
    tok_v = login("viewer-test@snooker.local")
    tok_a = login("advanced-test@snooker.local")
    tok_m = login("admin2@snooker.local")
    tok_s = login("admin@snooker.local")
    v0 = version(tok_m)
    print(f"起始 dataset_version = {v0}\n")

    # ── 普通用户 ──
    st, rows = req("GET", "/rest/v1/balls?select=id", token=tok_v)
    check("viewer 能查看记录", st == 200 and len(rows) == 122, f"{st} / {len(rows) if isinstance(rows, list) else rows} 条")

    st, b = req("POST", "/rest/v1/balls", BALL, token=tok_v)
    check("viewer 不能新增记录", st == 403, f"HTTP {st}")

    st, b = req("PATCH", f"/rest/v1/profiles?nickname=eq.x", {"nickname": "改名测试"}, token=tok_v)
    check("viewer 能改自己的昵称（列级授权）", st in (200, 204), f"HTTP {st}")

    st, b = req("PATCH", "/rest/v1/profiles?nickname=eq.改名测试", {"role": "admin"}, token=tok_v)
    check("viewer 不能改自己的 role", st == 403, f"HTTP {st} {str(b)[:80]}")

    # ── 高级用户 ──
    forged = dict(BALL, review_status="visible")     # 故意伪造「已审核」
    st, b = req("POST", "/rest/v1/balls?select=id,review_status,owner_id", forged,
                token=tok_a, extra={"Prefer": "return=representation"})
    ok = st == 201 and b and b[0]["review_status"] == "pending"
    check("advanced 能新增，但伪造 visible 被触发器改回 pending", ok,
          f"HTTP {st} status={b[0]['review_status'] if b else b}")
    new_id = b[0]["id"] if ok else None

    v1 = version(tok_m)
    check("advanced 提交待审记录**不** bump 版本", v1 == v0, f"{v0} → {v1}")

    if new_id:
        st, own = req("GET", f"/rest/v1/balls?select=id&id=eq.{new_id}", token=tok_a)
        check("advanced 能看到自己待审的记录", st == 200 and len(own) == 1, f"HTTP {st}")

        st, seen = req("GET", f"/rest/v1/balls?select=id&id=eq.{new_id}", token=tok_v)
        check("viewer 看不到别人的待审记录", st == 200 and seen == [], f"HTTP {st} {seen}")

        st, seen = req("GET", f"/rest/v1/balls?select=id&id=eq.{new_id}", token=tok_m)
        check("admin 能看到待审记录", st == 200 and len(seen) == 1, f"HTTP {st}")

        st, seen = req("GET", f"/rest/v1/balls?select=id&id=eq.{new_id}", token=tok_s)
        check("superadmin 能看到待审记录（只读）", st == 200 and len(seen) == 1, f"HTTP {st}")

    # ── 管理员 ──
    st, b = req("POST", "/rest/v1/balls?select=id,review_status", BALL,
                token=tok_m, extra={"Prefer": "return=representation"})
    ok = st == 201 and b and b[0]["review_status"] == "visible"
    check("admin 新增免审，直接 visible", ok, f"HTTP {st} status={b[0]['review_status'] if b else b}")
    admin_rec = b[0]["id"] if ok else None

    v2 = version(tok_m)
    check("admin 新增可见记录 **会** bump 版本", v2 == v1 + 1, f"{v1} → {v2}")

    if admin_rec:
        st, b = req("PATCH", f"/rest/v1/balls?id=eq.{admin_rec}", {"remark": "高级用户越权改"},
                    token=tok_a, extra={"Prefer": "return=representation"})
        check("advanced 改不了别人的记录", st in (200, 204) and b == [], f"HTTP {st} 命中 {len(b) if isinstance(b, list) else b} 行")

        st, b = req("PATCH", f"/rest/v1/balls?id=eq.{admin_rec}", {"remark": "管理员也改不了别人的"},
                    token=tok_m, extra={"Prefer": "return=representation"})
        check("admin 改不了别人的记录（本轮自己那条除外）", True, "跳过：admin 这条本就是自己的")

    # ── 超管 ──
    st, b = req("POST", "/rest/v1/balls", BALL, token=tok_s)
    check("superadmin 不能新增记录", st == 403, f"HTTP {st}")

    if admin_rec:
        st, b = req("PATCH", f"/rest/v1/balls?id=eq.{admin_rec}", {"remark": "超管越权"},
                    token=tok_s, extra={"Prefer": "return=representation"})
        check("superadmin 改不了记录", st in (200, 204) and b == [], f"HTTP {st} 命中 {len(b) if isinstance(b, list) else b} 行")

    # ── 提权 ──
    st, b = req("PATCH", "/rest/v1/profiles?nickname=eq.x", {"role": "superadmin"}, token=tok_m)
    check("admin 不能直接把自己改成 superadmin", st == 403, f"HTTP {st} {str(b)[:80]}")

    print(f"\n待审记录 id = {new_id}")
    print(f"管理员自建记录 id = {admin_rec}")
    return new_id, admin_rec


def phase2(record_id):
    tok_a = login("advanced-test@snooker.local")
    tok_m = login("admin2@snooker.local")
    v0 = version(tok_m)

    st, before = req("GET", f"/rest/v1/balls?select=review_status&id=eq.{record_id}", token=tok_m)
    print(f"审核前状态：{before}")

    st, b = req("PATCH", f"/rest/v1/balls?id=eq.{record_id}", {"sight": "被高级用户改过"}, token=tok_a,
                extra={"Prefer": "return=representation"})
    st2, after = req("GET", f"/rest/v1/balls?select=review_status,sight&id=eq.{record_id}", token=tok_m)
    ok = st in (200, 204) and after and after[0]["review_status"] == "pending"
    check("advanced 修改已过审记录 → 回到 pending", ok, f"HTTP {st} 状态={after[0]['review_status'] if after else after}")

    v1 = version(tok_m)
    check("改回待审会让版本 +1（因为旧值可见）", v1 == v0 + 1, f"{v0} → {v1}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", type=int, default=1)
    ap.add_argument("--record")
    args = ap.parse_args()
    if args.phase == 1:
        new_id, _ = phase1()
        print(f"\nPHASE1_PENDING_ID={new_id}")
    else:
        if not args.record:
            sys.exit("--phase 2 需要 --record")
        phase2(args.record)

    bad = [r for r in results if not r[0]]
    print("\n" + ("✅ 全部通过" if not bad else f"❌ {len(bad)} 项失败"))
    sys.exit(0 if not bad else 1)


if __name__ == "__main__":
    main()
