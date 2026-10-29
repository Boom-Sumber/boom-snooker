#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
T0.8 验收：RPC 四角色闭环（真实 JWT 打 PostgREST）

用法：python scripts/test_rpc_roles.py
"""
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
    results.append((ok, label))
    print(f"{'✅' if ok else '❌'} {label}" + (f"  → {detail}" if detail else ""))


def msg(b):
    return b.get("message") if isinstance(b, dict) else str(b)[:60]


def snapshot(tok):
    st, s = req("POST", "/rest/v1/rpc/get_dataset_snapshot", {}, token=tok)
    return st, s


BALL = {
    "color_code": "black", "pocket_code": "top_left", "method": "直线",
    "strength_code": "full", "sight": "RPC 测试", "low_comp": "测试",
    "high_comp": "测试", "remark": "RPC 权限测试",
    "impact_image": "balls/test.webp", "blue_image": "balls/test.webp",
    "route_image": "balls/test.webp",
}


def main():
    tok_v = login("viewer-test@snooker.local")
    tok_a = login("advanced-test@snooker.local")
    tok_m = login("admin2@snooker.local")
    tok_s = login("admin@snooker.local")

    st, snap0 = snapshot(tok_m)
    print(f"起始快照：version={snap0['version']} balls={len(snap0['balls'])}\n")

    # ── 普通用户 / 超管不能写 ──
    st, b = req("POST", "/rest/v1/rpc/upsert_ball", {"p": BALL, "expected_version": None}, token=tok_v)
    check("viewer 调 upsert_ball 被拒", st == 400 and msg(b) == "FORBIDDEN", msg(b))

    st, b = req("POST", "/rest/v1/rpc/upsert_ball", {"p": BALL, "expected_version": None}, token=tok_s)
    check("superadmin 调 upsert_ball 被拒", st == 400 and msg(b) == "FORBIDDEN", msg(b))

    # ── 高级用户提交 ──
    st, r = req("POST", "/rest/v1/rpc/upsert_ball",
                {"p": BALL, "expected_version": snap0["version"]}, token=tok_a)
    check("advanced 通过 RPC 提交成功", st == 200 and r.get("id"), f"HTTP {st} {r}")
    rec = r["id"] if st == 200 else None

    st, snap1 = snapshot(tok_m)
    check("待审记录**不进**快照", len(snap1["balls"]) == len(snap0["balls"]),
          f"{len(snap0['balls'])} → {len(snap1['balls'])}")
    check("待审提交**不** bump 版本", snap1["version"] == snap0["version"],
          f"{snap0['version']} → {snap1['version']}")

    st, row = req("GET", f"/rest/v1/balls?select=review_status,owner_id&id=eq.{rec}", token=tok_m)
    check("RPC 写入后状态为 pending", row and row[0]["review_status"] == "pending",
          row[0]["review_status"] if row else row)

    # ── 管理员不能改别人的记录 ──
    st, b = req("POST", "/rest/v1/rpc/upsert_ball",
                {"p": dict(BALL, id=rec, remark="管理员改他人"), "expected_version": None}, token=tok_m)
    check("admin 不能通过 RPC 改他人记录", st == 400 and msg(b) == "FORBIDDEN", msg(b))

    st, b = req("POST", "/rest/v1/rpc/delete_ball", {"p_id": rec, "expected_version": None}, token=tok_m)
    check("admin 不能删他人记录", st == 400 and msg(b) == "FORBIDDEN", msg(b))

    # ── 审核 ──
    st, b = req("POST", "/rest/v1/rpc/review_record",
                {"p_type": "ball", "p_id": rec, "p_decision": "visible", "p_note": "T0.8 通过"}, token=tok_a)
    check("advanced 不能审核", st == 400 and msg(b) == "FORBIDDEN", msg(b))

    st, b = req("POST", "/rest/v1/rpc/review_record",
                {"p_type": "ball", "p_id": rec, "p_decision": "visible", "p_note": "超管审核"}, token=tok_s)
    check("superadmin 不能审核记录", st == 400 and msg(b) == "FORBIDDEN", msg(b))

    st, b = req("POST", "/rest/v1/rpc/review_record",
                {"p_type": "ball", "p_id": rec, "p_decision": "visible", "p_note": "T0.8 通过"}, token=tok_m)
    check("admin 审核通过", st in (200, 204), f"HTTP {st} {msg(b)}")

    st, snap2 = snapshot(tok_m)
    check("审核通过后进入快照", len(snap2["balls"]) == len(snap1["balls"]) + 1,
          f"{len(snap1['balls'])} → {len(snap2['balls'])}")
    check("审核通过会 bump 版本", snap2["version"] == snap1["version"] + 1,
          f"{snap1['version']} → {snap2['version']}")

    st, b = req("POST", "/rest/v1/rpc/review_record",
                {"p_type": "ball", "p_id": rec, "p_decision": "visible"}, token=tok_m)
    check("重复审核报 NOT_PENDING", st == 400 and msg(b) == "NOT_PENDING", msg(b))

    # ── 高级用户改自己的已过审记录 → 回待审 ──
    st, r2 = req("POST", "/rest/v1/rpc/upsert_ball",
                 {"p": dict(BALL, id=rec, sight="改过了"), "expected_version": None}, token=tok_a)
    st, row = req("GET", f"/rest/v1/balls?select=review_status&id=eq.{rec}", token=tok_m)
    check("advanced 改自己的已过审记录 → 回 pending",
          row and row[0]["review_status"] == "pending", row[0]["review_status"] if row else row)

    # ── 用户管理 ──
    st, users = req("POST", "/rest/v1/rpc/list_users", {}, token=tok_m)
    check("admin 能列出用户（含邮箱）", st == 200 and isinstance(users, list) and len(users) == 4,
          f"HTTP {st} {len(users) if isinstance(users, list) else users} 人")
    if isinstance(users, list) and users:
        check("list_users 返回 email 字段", "email" in users[0] and "@" in (users[0]["email"] or ""),
              users[0].get("email"))

    st, b = req("POST", "/rest/v1/rpc/list_users", {}, token=tok_v)
    check("viewer 不能列用户", st == 400 and msg(b) == "FORBIDDEN", msg(b))

    st, b = req("POST", "/rest/v1/rpc/list_users", {}, token=tok_s)
    check("superadmin 能列用户", st == 200, f"HTTP {st}")

    st, b = req("POST", "/rest/v1/rpc/set_user_role",
                {"p_user_id": "f03dd534-79c3-4191-8409-75d2a50c1622", "p_role": "advanced"}, token=tok_m)
    check("admin 能把 viewer 提为 advanced", st in (200, 204), f"HTTP {st} {msg(b)}")

    st, b = req("POST", "/rest/v1/rpc/set_user_role",
                {"p_user_id": "f03dd534-79c3-4191-8409-75d2a50c1622", "p_role": "admin"}, token=tok_m)
    check("admin 不能把别人提为 admin", st == 400 and msg(b) == "FORBIDDEN", msg(b))

    st, b = req("POST", "/rest/v1/rpc/set_user_role",
                {"p_user_id": "f03dd534-79c3-4191-8409-75d2a50c1622", "p_role": "admin"}, token=tok_s)
    check("superadmin 能把别人提为 admin", st in (200, 204), f"HTTP {st} {msg(b)}")

    st, b = req("POST", "/rest/v1/rpc/set_user_role",
                {"p_user_id": "f03dd534-79c3-4191-8409-75d2a50c1622", "p_role": "superadmin"}, token=tok_s)
    check("任何人都不能设第二个 superadmin", st == 400 and msg(b) == "BAD_ROLE", msg(b))

    st, b = req("POST", "/rest/v1/rpc/set_user_role",
                {"p_user_id": "c2df4712-36e8-4a80-a408-17b80d4a95cd", "p_role": "viewer"}, token=tok_m)
    check("admin 不能改超管的角色", st == 400 and msg(b) == "FORBIDDEN", msg(b))

    st, b = req("POST", "/rest/v1/rpc/set_user_role",
                {"p_user_id": "0e9d84e6-d737-42ff-bb04-6894c1ad24e9", "p_role": "viewer"}, token=tok_m)
    check("admin 不能改自己的角色", st == 400 and msg(b) == "FORBIDDEN", msg(b))

    print(f"\nPHASE_RECORD_ID={rec}")
    bad = [r for r in results if not r[0]]
    print("\n" + ("✅ 全部通过" if not bad else f"❌ {len(bad)} 项失败"))
    sys.exit(0 if not bad else 1)


if __name__ == "__main__":
    main()
