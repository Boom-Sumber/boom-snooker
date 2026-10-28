#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
T0.3 验收：随机抽 5 条彩球 + 1 条进阶，逐字段与旧库 dump 比对。
用法：python scripts/verify_seed_data.py
"""
import json
import os
import random
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from migrate_legacy_data import read_dump, build, load_env   # noqa: E402


def get(base, key, path, token):
    r = urllib.request.Request(base + path)
    r.add_header("apikey", key)
    r.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(r) as resp:
        return json.loads(resp.read().decode())


def main():
    base, key = load_env()
    email = "admin@snooker.local"
    pw = os.environ.get("SNOOKER_PW")
    if not pw:
        sys.exit("需要环境变量 SNOOKER_PW")

    r = urllib.request.Request(base + "/auth/v1/token?grant_type=password",
        data=json.dumps({"email": email, "password": pw}).encode(), method="POST")
    r.add_header("apikey", key); r.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(r) as resp:
        token = json.loads(resp.read().decode())["access_token"]

    img_name, raw_balls, raw_adv = read_dump()
    balls, adv, _ = build(img_name, raw_balls, raw_adv)
    expect = {b["id"]: b for b in balls}

    random.seed(20261028)
    sample = random.sample(sorted(expect), 5)

    print("=== 抽样逐字段比对 ===")
    ok = True
    for bid in sample:
        got = get(base, key, f"/rest/v1/balls?select=*&id=eq.{bid}", token)[0]
        exp = expect[bid]
        diffs = []
        for f, v in exp.items():
            g = got.get(f)
            if f == "updated_at":
                # PostgREST 返回 UTC（+00:00），旧库是东八区，比时间戳而不是字符串
                from datetime import datetime
                if datetime.fromisoformat(g) != datetime.fromisoformat(v):
                    diffs.append((f, v, g))
            elif g != v:
                diffs.append((f, v, g))
        flag = "✅" if not diffs else "❌"
        if diffs:
            ok = False
        print(f"{flag} {bid[:8]} {exp['color_code']:6} {exp['pocket_code']:13} "
              f"{exp['method']} ({exp['strength_code']}) state={exp['state']}")
        for f, v, g in diffs:
            print(f"     差异 {f}: 期望 {v!r} 实际 {g!r}")

    print("\n=== 进阶 ===")
    for aid in sorted(a["id"] for a in adv):
        got = get(base, key, f"/rest/v1/advanced?select=*&id=eq.{aid}", token)[0]
        exp = next(a for a in adv if a["id"] == aid)
        diffs = [(f, v, got.get(f)) for f, v in exp.items()
                 if f != "updated_at" and got.get(f) != v]
        print(f"{'✅' if not diffs else '❌'} {aid[:8]} {exp['category_code']:8} "
              f"{exp['title']} state={exp['state']}")
        for d in diffs:
            print("     差异", d)
        ok = ok and not diffs

    print("\n=== 快照 RPC ===")
    snap = None
    r = urllib.request.Request(base + "/rest/v1/rpc/get_dataset_snapshot",
        data=b"{}", method="POST")
    r.add_header("apikey", key); r.add_header("Content-Type", "application/json")
    r.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(r) as resp:
        snap = json.loads(resp.read().decode())
    print(f"version={snap['version']}  balls={len(snap['balls'])}  "
          f"advanced={len(snap['advanced'])}  dict={len(snap['dict'])}")
    print("balls 全部 state=1:", all(b["state"] == 1 for b in snap["balls"]))
    print("快照字段:", sorted(snap["balls"][0]))

    print("\n" + ("✅ T0.3 验收通过" if ok else "❌ 存在字段差异，见上"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
