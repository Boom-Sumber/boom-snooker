#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
T0.3 验收：从数据源 xlsx 取真实值，随机抽 5 条彩球 + 5 条进阶，
逐字段与数据库里的数据比对。

依赖：pip install openpyxl
用法：
    set SNOOKER_PW=xxx && python scripts/verify_seed_data.py
"""
import json
import os
import random
import sys
import urllib.request
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_seed_data import read_xlsx, build, load_env   # noqa: E402


def get(base, key, path, token):
    r = urllib.request.Request(base + path)
    r.add_header("apikey", key)
    r.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(r) as resp:
        return json.loads(resp.read().decode())


def login(base, key, email, pw):
    r = urllib.request.Request(base + "/auth/v1/token?grant_type=password",
        data=json.dumps({"email": email, "password": pw}).encode(), method="POST")
    r.add_header("apikey", key); r.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(r) as resp:
        return json.loads(resp.read().decode())["access_token"]


def cmp(exp, got, skip=()):
    diffs = []
    for f, v in exp.items():
        if f in skip:
            continue
        g = got.get(f)
        if f == "updated_at":
            if datetime.fromisoformat(g) != datetime.fromisoformat(v):
                diffs.append((f, v, g))
        elif g != v:
            diffs.append((f, v, g))
    return diffs


def main():
    base, key = load_env()
    pw = os.environ.get("SNOOKER_PW")
    if not pw:
        sys.exit("需要环境变量 SNOOKER_PW")
    token = login(base, key, "admin@snooker.local", pw)

    cb_rows, adv_rows = read_xlsx()
    balls, adv, _ = build(cb_rows, adv_rows)

    random.seed(20261028)
    ok = True

    print(f"=== 彩球 抽样 5 / {len(balls)} ===")
    for exp in (next(b for b in balls if b["id"] == i)
                for i in random.sample(sorted(b["id"] for b in balls), 5)):
        got = get(base, key, f"/rest/v1/balls?select=*&id=eq.{exp['id']}", token)[0]
        diffs = cmp(exp, got)
        ok = ok and not diffs
        print(f"{'✅' if not diffs else '❌'} {exp['id'][:8]} {exp['color_code']:6} "
              f"{exp['pocket_code']:13} {exp['method']} ({exp['strength_code']})")
        for d in diffs:
            print("     差异", d)

    print(f"\n=== 进阶 抽样 5 / {len(adv)} ===")
    for exp in (next(a for a in adv if a["id"] == i)
                for i in random.sample(sorted(a["id"] for a in adv), 5)):
        got = get(base, key, f"/rest/v1/advanced?select=*&id=eq.{exp['id']}", token)[0]
        diffs = cmp(exp, got)
        ok = ok and not diffs
        print(f"{'✅' if not diffs else '❌'} {exp['id'][:8]} {exp['category_code']:8} {exp['title']}")
        for d in diffs:
            print("     差异", d)

    print("\n=== 行数 ===")
    n_b = get(base, key, "/rest/v1/balls?select=id", token)
    n_a = get(base, key, "/rest/v1/advanced?select=id", token)
    print(f"balls {len(n_b)}（期望 {len(balls)}）  advanced {len(n_a)}（期望 {len(adv)}）")
    ok = ok and len(n_b) == len(balls) and len(n_a) == len(adv)

    print("\n=== 快照 RPC ===")
    r = urllib.request.Request(base + "/rest/v1/rpc/get_dataset_snapshot", data=b"{}", method="POST")
    r.add_header("apikey", key); r.add_header("Content-Type", "application/json")
    r.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(r) as resp:
        snap = json.loads(resp.read().decode())
    print(f"version={snap['version']}  balls={len(snap['balls'])}  "
          f"advanced={len(snap['advanced'])}  dict={len(snap['dict'])}")
    ok = ok and snap["version"] == 1

    print("\n" + ("✅ T0.3 验收通过" if ok else "❌ 存在差异，见上"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
