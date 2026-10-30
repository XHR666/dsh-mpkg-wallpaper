#!/usr/bin/env python3
"""analyze.py —— X11 截图的最小像素取证（PIL；本机 12.3.0 实测可用）

为什么不用 Node 自己解 PNG：仓库里没有 PNG 解码依赖，而 PIL 在本机现成。这个脚本**只读**，
把结论打成 JSON 到 stdout，供 `tests/x11-e2e/*.mjs` 断言（测试里不写第二套像素口径）。

子命令（坐标一律**图片像素**，左上 origin）：
  info    <png>                                   → 尺寸
  count   <png> --rect x,y,w,h [--min 128]        → 该矩形内亮度 ≥ min 的像素数与占比
  centroid <png> --rect x,y,w,h [--min 128]       → 该矩形内亮像素的质心（加权）
  diff    <a.png> <b.png> --rect x,y,w,h [--min 8]→ 两张图在矩形内的差异像素数 / 变化质心 / 包围盒
  mask    <png> --rect x,y,w,h [--rule warm|pinkish|redish|bright|notblue]
                                                  → 该颜色规则的匹配数/占比/质心/包围盒（找"花瓣跟不跟手"用）
  profile <png> --rect x,y,w,h [--axis x|y] [--min 128]
                                                  → 沿轴的亮像素直方图（找竖条纹/缝隙用；输出每列计数）
"""
import argparse
import json
import sys

try:
    from PIL import Image
except Exception as e:  # pragma: no cover
    print(json.dumps({"ok": False, "err": "PIL 不可用: %s" % e}, ensure_ascii=False))
    sys.exit(3)


def load(p):
    im = Image.open(p)
    return im.convert("RGB")


def luma(px):
    r, g, b = px
    # 与渲染器无关的简单亮度口径：Rec.601。测试只做**相对**比较，不需要色彩管理。
    return 0.299 * r + 0.587 * g + 0.114 * b


def rect_of(im, rect):
    if rect is None:
        return (0, 0, im.width, im.height)
    x, y, w, h = rect
    x = max(0, min(im.width, int(x)))
    y = max(0, min(im.height, int(y)))
    w = max(1, min(im.width - x, int(w)))
    h = max(1, min(im.height - y, int(h)))
    return (x, y, w, h)


def cmd_info(a):
    im = load(a.png)
    return {"ok": True, "w": im.width, "h": im.height}


def cmd_count(a):
    im = load(a.png)
    x, y, w, h = rect_of(im, a.rect)
    crop = im.crop((x, y, x + w, y + h))
    px = crop.load()
    n = 0
    for j in range(h):
        for i in range(w):
            if luma(px[i, j]) >= a.min:
                n += 1
    return {"ok": True, "rect": [x, y, w, h], "pixels": w * h, "bright": n,
            "ratio": round(n / float(w * h), 6), "min": a.min}


def cmd_centroid(a):
    im = load(a.png)
    x, y, w, h = rect_of(im, a.rect)
    crop = im.crop((x, y, x + w, y + h))
    px = crop.load()
    sx = sy = sw = 0.0
    for j in range(h):
        for i in range(w):
            v = luma(px[i, j])
            if v >= a.min:
                sx += i * v
                sy += j * v
                sw += v
    if sw <= 0:
        return {"ok": True, "found": False, "rect": [x, y, w, h]}
    return {"ok": True, "found": True, "rect": [x, y, w, h],
            "x": round(x + sx / sw, 2), "y": round(y + sy / sw, 2), "weight": round(sw, 1)}


def cmd_diff(a):
    ia, ib = load(a.png), load(a.png2)
    if (ia.width, ia.height) != (ib.width, ib.height):
        return {"ok": False, "err": "尺寸不同 %sx%s vs %sx%s" % (ia.width, ia.height, ib.width, ib.height)}
    x, y, w, h = rect_of(ia, a.rect)
    pa, pb = ia.load(), ib.load()
    n = 0
    sx = sy = 0.0
    minx, miny, maxx, maxy = w, h, -1, -1
    for j in range(y, y + h):
        for i in range(x, x + w):
            va, vb = luma(pa[i, j]), luma(pb[i, j])
            if abs(vb - va) >= a.min:
                n += 1
                sx += i
                sy += j
                minx, miny = min(minx, i - x), min(miny, j - y)
                maxx, maxy = max(maxx, i - x), max(maxy, j - y)
    if n == 0:
        return {"ok": True, "changed": 0, "rect": [x, y, w, h], "min": a.min}
    return {"ok": True, "changed": n, "ratio": round(n / float(w * h), 6), "rect": [x, y, w, h],
            "cx": round(sx / n, 2), "cy": round(sy / n, 2),
            "bbox": [minx, miny, maxx - minx + 1, maxy - miny + 1], "min": a.min}


def cmd_profile(a):
    im = load(a.png)
    x, y, w, h = rect_of(im, a.rect)
    crop = im.crop((x, y, x + w, y + h))
    px = crop.load()
    if a.axis == "x":
        counts = [sum(1 for j in range(h) if luma(px[i, j]) >= a.min) for i in range(w)]
    else:
        counts = [sum(1 for i in range(w) if luma(px[i, j]) >= a.min) for j in range(h)]
    return {"ok": True, "rect": [x, y, w, h], "axis": a.axis, "len": len(counts),
            "counts": counts, "max": max(counts) if counts else 0,
            "zero": sum(1 for c in counts if c == 0)}


RULES = {
    # 名称 → (谓词, 说明)。谓词收 (r,g,b,luma)。**只做相对比较**，不做色彩管理。
    "warm":   (lambda r, g, b, L: r > b + 25 and r > 100, "暖色（R 明显高于 B 且不太暗）：樱花/花瓣/暖光"),
    "pinkish": (lambda r, g, b, L: r > g + 18 and r > b and r > 90, "偏粉（R>G、R>=B）：花瓣的常见色"),
    "redish": (lambda r, g, b, L: r > g + 30 and r > b + 30, "强红：只留最像花瓣的"),
    "bright": (lambda r, g, b, L: L >= 200, "高亮：亮点/白花"),
    "notblue": (lambda r, g, b, L: r >= b - 10 and L >= 60, "非蓝（夜空/蓝背景之外的一切）"),
}


def cmd_mask(a):
    im = load(a.png)
    x, y, w, h = rect_of(im, a.rect)
    pred, why = RULES[a.rule]
    crop = im.crop((x, y, x + w, y + h))
    px = crop.load()
    n = 0
    sx = sy = 0.0
    minx, miny, maxx, maxy = w, h, -1, -1
    for j in range(h):
        for i in range(w):
            r, g, b = px[i, j]
            if pred(r, g, b, luma((r, g, b))):
                n += 1
                sx += i; sy += j
                minx, miny = min(minx, i), min(miny, j)
                maxx, maxy = max(maxx, i), max(maxy, j)
    if n == 0:
        return {"ok": True, "rule": a.rule, "why": why, "matched": 0, "rect": [x, y, w, h]}
    return {"ok": True, "rule": a.rule, "why": why, "matched": n,
            "ratio": round(n / float(w * h), 6), "rect": [x, y, w, h],
            "cx": round(x + sx / n, 2), "cy": round(y + sy / n, 2),
            "bbox": [x + minx, y + miny, maxx - minx + 1, maxy - miny + 1]}


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("info"); p.add_argument("png"); p.set_defaults(f=cmd_info)
    for name, fn in (("count", cmd_count), ("centroid", cmd_centroid), ("profile", cmd_profile)):
        p = sub.add_parser(name); p.add_argument("png")
        p.add_argument("--rect", type=lambda s: [int(v) for v in s.split(",")])
        p.add_argument("--min", type=float, default=128)
        if name == "profile":
            p.add_argument("--axis", choices=["x", "y"], default="x")
        p.set_defaults(f=fn)
    p = sub.add_parser("mask"); p.add_argument("png")
    p.add_argument("--rect", type=lambda s: [int(v) for v in s.split(",")])
    p.add_argument("--rule", choices=sorted(RULES), default="warm")
    p.set_defaults(f=cmd_mask)
    p = sub.add_parser("diff"); p.add_argument("png"); p.add_argument("png2")
    p.add_argument("--rect", type=lambda s: [int(v) for v in s.split(",")])
    p.add_argument("--min", type=float, default=8)
    p.set_defaults(f=cmd_diff)
    a = ap.parse_args()
    try:
        print(json.dumps(a.f(a), ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"ok": False, "err": str(e)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
