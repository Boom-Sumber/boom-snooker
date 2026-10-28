#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
T0.4 验收：检查表里每个图片 path 都能通过 public URL 取到，并测缩略图变换。

用法：
    set SNOOKER_PW=xxx && python scripts/verify_images.py
"""
import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_seed_data import load_env          # noqa: E402
from upload_images import login, rest_get      # noqa: E402


def head(url, timeout=30):
    """用 HEAD 只取状态和长度，不下载内容（316 张全量检查从 9 分钟降到几十秒）"""
    r = urllib.request.Request(url, method="HEAD")
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.status, int(resp.headers.get("Content-Length") or 0), \
                   resp.headers.get("Content-Type"), resp.headers.get("Cache-Control")
    except urllib.error.HTTPError as e:
        return e.code, 0, e.headers.get("Content-Type"), None
    except Exception as e:
        return 0, 0, f"{type(e).__name__}: {e}", None


def main():
    pw = os.environ.get("SNOOKER_PW")
    if not pw:
        sys.exit("需要环境变量 SNOOKER_PW")
    base, key = load_env()
    token = login(base, key, "admin@snooker.local", pw)

    paths = []
    for col in ("impact_image", "blue_image", "route_image"):
        for row in rest_get(base, key, token, f"/rest/v1/balls?select={col}&{col}=neq."):
            v = (row.get(col) or "").strip()
            if v:
                paths.append((col, v))
    for row in rest_get(base, key, token, "/rest/v1/advanced?select=image&image=neq."):
        v = (row.get("image") or "").strip()
        if v:
            paths.append(("image", v))

    uniq = sorted({p for _, p in paths})
    print(f"表里引用 {len(paths)} 次 / 去重 {len(uniq)} 个对象")
    bad_ext = [p for p in uniq if not p.endswith(".webp")]
    print(f"后缀不是 .webp 的: {len(bad_ext)} {bad_ext[:3]}")

    total = 0
    bad = []
    for i, p in enumerate(uniq, 1):
        url = f"{base}/storage/v1/object/public/images/{p}"
        st, size, ctype, cc = head(url)
        if st != 200:
            bad.append((p, st, ctype))
        else:
            total += size
        if i % 50 == 0:
            print(f"  已检查 {i}/{len(uniq)}，累计 {total/1024/1024:.1f} MB")

    print(f"\n全部可访问: {len(uniq) - len(bad)}/{len(uniq)}，下载总量 {total/1024/1024:.1f} MB")
    for b in bad[:10]:
        print("  ✗", b)

    print("\n=== 缩略图变换测试（?width=200&quality=70）===")
    sample = uniq[0]
    raw = f"{base}/storage/v1/object/public/images/{sample}"
    st1, s1, c1, cc1 = head(raw)
    st2, s2, c2, cc2 = head(raw + "?width=200&quality=70")
    st3, s3, _, _ = head(raw + "?width=50")
    print(f"  原图          HTTP {st1}  {s1/1024:.0f} KB  {c1}  cache={cc1}")
    print(f"  ?width=200    HTTP {st2}  {s2/1024:.0f} KB  {c2}")
    print(f"  ?width=50     HTTP {st3}  {s3/1024:.0f} KB")
    if st2 == 200 and s3 and s3 < s1 * 0.9:
        print("  ✅ 图片变换可用")
        transform_ok = True
    else:
        print("  ⚠️ 图片变换**未生效**（参数被忽略，返回原图）——免费额度不含 Image Transformation")
        print("     → 列表页不要依赖 ?width=200，改用本地 hash 缓存 + 懒加载（T5.1/T5.2 已调整）")
        transform_ok = False

    ok = not bad and not bad_ext
    print("\n" + ("✅ T0.4 验收通过" if ok else "❌ 有问题，见上"))
    if not transform_ok:
        print("（图片变换不可用属已知限制，不算失败）")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
