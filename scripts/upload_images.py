#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
T0.4 图片上传：PNG -> WebP(q80) -> Supabase Storage

数据源：D:\\app\\SnookerHelper\\data\\img\\*.png（只读）
目标：  images bucket，路径与表里的 object path 一致（balls/<uuid>.webp、advanced/<uuid>.webp）

只上传「表里真正引用到的」图片（326 张里有 10 张孤儿文件，不传）。
默认跳过已存在的对象（x-upsert: false），加 --force 才覆盖。

依赖：pip install pillow
用法：
    set SNOOKER_PW=xxx && python scripts/upload_images.py --dry-run   # 只统计不传
    set SNOOKER_PW=xxx && python scripts/upload_images.py
"""
import argparse
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_seed_data import SRC, IMG_DIR, load_env   # noqa: E402

QUALITY = 80
BUCKET = "images"


def login(base, key, email, pw):
    r = urllib.request.Request(base + "/auth/v1/token?grant_type=password",
        data=json.dumps({"email": email, "password": pw}).encode(), method="POST")
    r.add_header("apikey", key); r.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(r) as resp:
        return json.loads(resp.read().decode())["access_token"]


def rest_get(base, key, token, path):
    r = urllib.request.Request(base + path)
    r.add_header("apikey", key)
    r.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(r) as resp:
        return json.loads(resp.read().decode())


def collect_paths(base, key, token):
    """从表里收集所有非空的图片 object path"""
    paths = set()
    for col in ("impact_image", "blue_image", "route_image"):
        for row in rest_get(base, key, token, f"/rest/v1/balls?select={col}&{col}=neq."):
            v = (row.get(col) or "").strip()
            if v:
                paths.add(v)
    for row in rest_get(base, key, token, "/rest/v1/advanced?select=image&image=neq."):
        v = (row.get("image") or "").strip()
        if v:
            paths.add(v)
    return sorted(paths)


def to_webp(src_path):
    from PIL import Image
    img = Image.open(src_path)
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA")
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=QUALITY, method=6)
    return buf.getvalue()


def upload(base, key, token, object_path, data, force, retries=4):
    """带重试的上传。Storage 偶发 RemoteDisconnected，不重试会中断整批。"""
    last = (0, "")
    for attempt in range(retries):
        r = urllib.request.Request(f"{base}/storage/v1/object/{BUCKET}/{object_path}",
                                   data=data, method="POST")
        r.add_header("apikey", key)
        r.add_header("Authorization", "Bearer " + token)
        r.add_header("Content-Type", "image/webp")
        r.add_header("Connection", "close")
        r.add_header("x-upsert", "true" if force else "false")
        try:
            with urllib.request.urlopen(r, timeout=60) as resp:
                return resp.status, resp.read().decode()[:200]
        except urllib.error.HTTPError as e:
            body = e.read().decode()[:300]
            # 4xx 是确定性错误，重试没意义（除 429）
            if e.code != 429 and 400 <= e.code < 500:
                return e.code, body
            last = (e.code, body)
        except Exception as e:            # RemoteDisconnected / timeout / reset
            last = (0, f"{type(e).__name__}: {e}")
        time.sleep(1.5 * (attempt + 1))
    return last


def list_existing(base, key, token):
    """列出 bucket 里已有的对象（避免对已上传的重复发请求）"""
    out = set()
    for prefix in ("balls", "advanced"):
        offset = 0
        while True:
            r = urllib.request.Request(
                f"{base}/storage/v1/object/list/{BUCKET}",
                data=json.dumps({"prefix": prefix, "limit": 1000, "offset": offset}).encode(),
                method="POST")
            r.add_header("apikey", key)
            r.add_header("Authorization", "Bearer " + token)
            r.add_header("Content-Type", "application/json")
            try:
                with urllib.request.urlopen(r, timeout=30) as resp:
                    batch = json.loads(resp.read().decode())
            except Exception as e:
                print(f"  列目录失败（忽略，按全量重传）：{e}")
                return out
            if not batch:
                break
            for o in batch:
                if o.get("id"):                      # 目录占位项没有 id
                    out.add(f"{prefix}/{o['name']}")
            if len(batch) < 1000:
                break
            offset += 1000
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--email", default="admin@snooker.local")
    ap.add_argument("--password")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="覆盖已存在的对象")
    args = ap.parse_args()

    pw = args.password or os.environ.get("SNOOKER_PW")
    if not pw and not args.dry_run:
        sys.exit("需要 --password 或环境变量 SNOOKER_PW")

    base, key = load_env()
    token = login(base, key, args.email, pw) if not args.dry_run else None

    if args.dry_run:
        # 不连库，直接从数据源推算（用于预估体积）
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from import_seed_data import read_xlsx, build
        balls, adv, _ = build(*read_xlsx())
        paths = sorted({p for r in balls for p in
                        (r["impact_image"], r["blue_image"], r["route_image"]) if p}
                       | {r["image"] for r in adv if r["image"]})
    else:
        paths = collect_paths(base, key, token)

    print(f"待处理 {len(paths)} 个对象（bucket={BUCKET}, quality={QUALITY}）")

    existing = set() if args.dry_run else list_existing(base, key, token)
    if existing:
        print(f"  已存在 {len(existing)} 个，跳过")

    total_png = total_webp = 0
    ok = skip = fail = 0
    t0 = time.time()

    for i, obj in enumerate(paths, 1):
        # balls/<uuid>.png -> 源文件 <uuid>.png，目标 balls/<uuid>.webp
        prefix, fname = obj.split("/", 1)
        target = f"{prefix}/{os.path.splitext(fname)[0]}.webp"
        if target in existing and not args.force:
            skip += 1
            continue
        src = os.path.join(IMG_DIR, fname)
        if not os.path.exists(src):
            print(f"  ✗ 源文件缺失 {src}")
            fail += 1
            continue
        data = to_webp(src)
        png_size = os.path.getsize(src)
        total_png += png_size
        total_webp += len(data)

        if args.dry_run:
            ok += 1
            if i <= 3 or i % 80 == 0:
                print(f"  {i:>3}/{len(paths)} {target}  {png_size/1024:.0f} KB -> {len(data)/1024:.0f} KB")
            continue

        st, body = upload(base, key, token, target, data, args.force)
        if st in (200, 201):
            ok += 1
            if ok % 10 == 0 or i == len(paths):
                print(f"  {i:>3}/{len(paths)} 已上传 {ok}，累计 {total_webp/1024/1024:.1f} MB")
        elif st in (400, 409) and "already exist" in body.lower():
            skip += 1
        else:
            fail += 1
            print(f"  ✗ {target} HTTP {st} {body}")

    dt = time.time() - t0
    print(f"\n完成：成功 {ok} / 跳过 {skip} / 失败 {fail}，耗时 {dt:.1f}s")
    if total_png:
        print(f"体积：PNG {total_png/1024/1024:.1f} MB -> WebP {total_webp/1024/1024:.1f} MB "
              f"（{total_webp/total_png*100:.1f}%，平均 {total_webp/max(ok,1)/1024:.0f} KB/张）")
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
