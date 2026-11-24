#!/usr/bin/env python3
"""拉取 GitHub Traffic 数据并累积成本地历史（JSON）。

GitHub 的 /traffic 接口只给**最近 14 天**，窗口一滚旧数据就永久丢失。
所以这里做的是「滚动快照 + 按日期合并」：每次跑都把 14 天数据并进本地历史，
只增不减，越跑历史越长。

用法：
    python3 tools/fetch-traffic.py                    # token 从 .secrets 或环境变量读
    python3 tools/fetch-traffic.py --dry-run          # 只打印，不写文件
    python3 tools/fetch-traffic.py --repo owner/name

token 需要 repo 权限（classic PAT 的 repo scope）。不会被打印、不落盘。
"""
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

OWNER_REPO = os.environ.get("TRAFFIC_REPO", "Breeze88-hub/Breeze88-hub.github.io")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "source", "data", "traffic.json")
API = "https://api.github.com"


def find_token():
    for cand in ("/vol1/@appshare/Harness/.secrets/github-token",):
        try:
            with open(cand) as fh:
                t = fh.read().strip()
            if t:
                return t
        except OSError:
            pass
    return os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or ""


def call(path, token):
    req = urllib.request.Request(API + path, method="GET")
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    req.add_header("User-Agent", "breeze88-traffic")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:200]
        print("  ! %s -> HTTP %s %s" % (path, e.code, body), file=sys.stderr)
        return {"__error__": e.code}
    except Exception as e:
        print("  ! %s -> %s" % (path, e), file=sys.stderr)
        return {"__error__": 0}


def load_history(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def merge_daily(hist, items, ts_key="timestamp"):
    """按日期合并，count/uniques 用「取较大值」而不是累加。

    14 天窗口每天会被重新统计一次，同一天可能被拉多次；累加会翻倍，
    取较大值可以吸收 GitHub 事后回填的修正。
    """
    added = 0
    for it in items or []:
        day = (it.get(ts_key) or "")[:10]
        if not day:
            continue
        cur = hist.get(day)
        if cur is None:
            hist[day] = {"count": it.get("count", 0), "uniques": it.get("uniques", 0)}
            added += 1
        else:
            cur["count"] = max(cur.get("count", 0), it.get("count", 0))
            cur["uniques"] = max(cur.get("uniques", 0), it.get("uniques", 0))
    return added


def main():
    dry = "--dry-run" in sys.argv
    repo = OWNER_REPO
    if "--repo" in sys.argv:
        repo = sys.argv[sys.argv.index("--repo") + 1]
    token = find_token()
    if not token:
        print("需要 token：存 /vol1/@appshare/Harness/.secrets/github-token 或设 GITHUB_TOKEN", file=sys.stderr)
        return 2

    print("== 仓库 %s" % repo)
    views = call("/repos/%s/traffic/views" % repo, token)
    clones = call("/repos/%s/traffic/clones" % repo, token)
    refs = call("/repos/%s/traffic/popular/referrers" % repo, token)
    paths = call("/repos/%s/traffic/popular/paths" % repo, token)
    for name, d in (("views", views), ("clones", clones), ("referrers", refs), ("paths", paths)):
        if isinstance(d, dict) and "__error__" in d:
            print("  %s 拉取失败 → HTTP %s" % (name, d["__error__"]))

    old = load_history(DATA)
    hist_views = old.get("views") or {}
    hist_clones = old.get("clones") or {}
    n1 = merge_daily(hist_views, views.get("views"))
    n2 = merge_daily(hist_clones, clones.get("clones"))
    print("  views 窗口 count=%s uniques=%s，本次新增 %d 天" %
          (views.get("count"), views.get("uniques"), n1))
    print("  clones 窗口 count=%s uniques=%s，本次新增 %d 天" %
          (clones.get("count"), clones.get("uniques"), n2))

    days = sorted(hist_views)
    total_views = sum(v["count"] for v in hist_views.values())
    total_uniques_daily = sum(v["uniques"] for v in hist_views.values())

    out = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "repo": repo,
        "window_days": len(views.get("views") or []),
        "days_tracked": len(days),
        "first_day": days[0] if days else None,
        "last_day": days[-1] if days else None,
        "total_views": total_views,
        "total_uniques_sum_daily": total_uniques_daily,
        "views": hist_views,
        "clones": hist_clones,
        # referrers / paths 是「窗口内排行」，没有历史可累积，存最近一次快照
        "referrers": [{"referrer": r.get("referrer") or "(直接访问)",
                       "count": r.get("count", 0), "uniques": r.get("uniques", 0)}
                      for r in (refs if isinstance(refs, list) else [])][:15],
        "paths": [{"path": p.get("path", ""), "title": p.get("title", ""),
                   "count": p.get("count", 0), "uniques": p.get("uniques", 0)}
                  for p in (paths if isinstance(paths, list) else [])][:15],
    }

    print("  历史：%d 天（%s ~ %s），累计 PV %d" %
          (len(days), out["first_day"], out["last_day"], total_views))
    if dry:
        print("  (dry-run) 不写文件；预览：")
        print("  " + json.dumps({"days_tracked": len(days), "total_views": total_views,
                                  "referrers": out["referrers"][:3], "paths": out["paths"][:3]},
                                 ensure_ascii=False)[:400])
        return 0

    os.makedirs(os.path.dirname(DATA), exist_ok=True)
    with open(DATA, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1, sort_keys=True)
    print("  已写入 %s（%d KB）" % (os.path.relpath(DATA, ROOT),
                                   os.path.getsize(DATA) // 1024 or 1))
    return 0


if __name__ == "__main__":
    sys.exit(main())