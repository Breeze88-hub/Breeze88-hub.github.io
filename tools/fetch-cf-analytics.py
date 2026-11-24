#!/usr/bin/env python3
"""拉取 Cloudflare Web Analytics(RUM) 数据，累积成看板用的 JSON。

替换掉原来的 GitHub Traffic 方案 —— 那个接口统计的是仓库页面访问，
跟 GitHub Pages 站点的访客无关，对本项目恒为 0。

数据源：Cloudflare GraphQL `rumPageloadEventsAdaptiveGroups`
  - count          = 页面浏览量（pageviews）
  - sum.visits     = 访问次数（会话数，近似 UV）
  - 维度：date / requestPath / refererHost / countryName / deviceType

用法：
    python3 tools/fetch-cf-analytics.py --token <CF_API_TOKEN>
    python3 tools/fetch-cf-analytics.py --token <T> --account <ACCOUNT_TAG> --site <BEACON_TOKEN>
    python3 tools/fetch-cf-analytics.py --token <T> --dry-run

凭据查找顺序：--token → CF_API_TOKEN 环境变量 → /vol1/@appshare/Harness/.secrets/cloudflare-api-token
account/site 未给时：account 用 GET /accounts 自动取第一个；site 留空表示不过滤（账户下只有本站时等价）。
token 不会被打印、不落盘。
"""
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "source", "data", "traffic.json")
GQL = "https://api.cloudflare.com/client/v4/graphql"
REST = "https://api.cloudflare.com/client/v4"


def arg(name, default=""):
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return default


def find_token():
    import glob
    for cand in ("/vol1/@appshare/Harness/.secrets/cloudflare-api-token",
                 "/vol1/@appshare/Harness/.secrets/cf-api-token"):
        try:
            with open(cand) as fh:
                t = fh.read().strip()
            if t:
                return t
        except OSError:
            pass
    return os.environ.get("CF_API_TOKEN", "")


def gql(token, query, variables=None):
    payload = {"query": query}
    if variables:
        payload["variables"] = variables
    req = urllib.request.Request(GQL, data=json.dumps(payload).encode(), method="POST")
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "breeze88-cf-analytics")
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:400]
        print("  ! GraphQL HTTP %s: %s" % (e.code, body), file=sys.stderr)
        return {}
    except Exception as e:
        print("  ! GraphQL: %s" % e, file=sys.stderr)
        return {}


def rest(token, path):
    req = urllib.request.Request(REST + path, method="GET")
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("User-Agent", "breeze88-cf-analytics")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read() or b"{}")
    except Exception as e:
        print("  ! REST %s: %s" % (path, e), file=sys.stderr)
        return {}


QUERY = """
query($account: String!, $since: Date!, $until: Date!) {
  viewer {
    accounts(filter: {accountTag: $account}) {
      daily: rumPageloadEventsAdaptiveGroups(
        limit: 1000
        filter: {date_geq: $since, date_leq: $until}
        orderBy: [date_ASC]
      ) {
        count
        sum { visits }
        dimensions { date }
      }
      paths: rumPageloadEventsAdaptiveGroups(
        limit: 30
        filter: {date_geq: $since, date_leq: $until}
        orderBy: [count_DESC]
      ) {
        count
        sum { visits }
        dimensions { requestPath }
      }
      referers: rumPageloadEventsAdaptiveGroups(
        limit: 30
        filter: {date_geq: $since, date_leq: $until}
        orderBy: [count_DESC]
      ) {
        count
        sum { visits }
        dimensions { refererHost }
      }
      countries: rumPageloadEventsAdaptiveGroups(
        limit: 30
        filter: {date_geq: $since, date_leq: $until}
        orderBy: [count_DESC]
      ) {
        count
        sum { visits }
        dimensions { countryName }
      }
      devices: rumPageloadEventsAdaptiveGroups(
        limit: 30
        filter: {date_geq: $since, date_leq: $until}
        orderBy: [count_DESC]
      ) {
        count
        sum { visits }
        dimensions { deviceType }
      }
    }
  }
}
"""


def load_history(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def rows(gql_resp, alias):
    try:
        accts = gql_resp["data"]["viewer"]["accounts"]
        return accts[0][alias] if accts else []
    except (KeyError, IndexError, TypeError):
        return []


def main():
    token = arg("--token") or find_token()
    if not token:
        print("需要 Cloudflare API Token（Account Analytics: Read）："
              "用 --token 传入，或存 /vol1/@appshare/Harness/.secrets/cloudflare-api-token",
              file=sys.stderr)
        return 2

    account = arg("--account")
    site = arg("--site") or os.environ.get("CF_SITE_TAG", "")
    days = int(arg("--days", "30"))
    dry = "--dry-run" in sys.argv

    if not account:
        accts = rest(token, "/accounts").get("result") or []
        if accts:
            account = accts[0].get("id", "")
            print("== 自动识别账户: %s (%s)" % (account, accts[0].get("name", "")))
    if not account:
        print("拿不到 account tag：用 --account 指定，或让 token 带 Account: Read", file=sys.stderr)
        return 2
    print("== account=%s  site=%s  days=%d" % (account, site or "(不过滤)", days))

    until = datetime.now(timezone.utc).date()
    since = until - timedelta(days=days)
    resp = gql(token, QUERY, {"account": account,
                              "since": since.isoformat(), "until": until.isoformat()})
    if not resp or resp.get("errors"):
        errs = (resp or {}).get("errors") or []
        print("  ! 查询失败：" + json.dumps(errs[:2], ensure_ascii=False)[:300], file=sys.stderr)
        if not resp.get("data"):
            return 1

    daily = rows(resp, "daily")
    print("  每日 %d 条 / 路径 %d / 来源 %d / 国家 %d / 设备 %d"
          % (len(daily), len(rows(resp, "paths")), len(rows(resp, "referers")),
             len(rows(resp, "countries")), len(rows(resp, "devices"))))

    old = load_history(DATA)
    views = old.get("views") or {}

    added = 0
    for r in daily:
        day = (r.get("dimensions") or {}).get("date")
        if not day:
            continue
        cnt = r.get("count") or 0
        vis = (r.get("sum") or {}).get("visits") or 0
        cur = views.get(day)
        if cur is None:
            views[day] = {"count": cnt, "uniques": vis}
            added += 1
        else:
            # CF 会回填/修正当天数据，取较大值避免把已统计的量改小
            cur["count"] = max(cur.get("count", 0), cnt)
            cur["uniques"] = max(cur.get("uniques", 0), vis)

    days_sorted = sorted(views)
    out = {
        "source": "cloudflare-rum",
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "days_tracked": len(days_sorted),
        "first_day": days_sorted[0] if days_sorted else None,
        "last_day": days_sorted[-1] if days_sorted else None,
        "total_views": sum(v.get("count", 0) for v in views.values()),
        "total_uniques_sum_daily": sum(v.get("uniques", 0) for v in views.values()),
        "views": views,
        "paths": [{"path": (r.get("dimensions") or {}).get("requestPath") or "",
                   "count": r.get("count") or 0,
                   "uniques": (r.get("sum") or {}).get("visits") or 0}
                  for r in rows(resp, "paths")],
        "referrers": [{"referrer": (r.get("dimensions") or {}).get("refererHost") or "(直接访问)",
                       "count": r.get("count") or 0,
                       "uniques": (r.get("sum") or {}).get("visits") or 0}
                      for r in rows(resp, "referers")],
        "countries": [{"country": (r.get("dimensions") or {}).get("countryName") or "(未知)",
                       "count": r.get("count") or 0,
                       "uniques": (r.get("sum") or {}).get("visits") or 0}
                      for r in rows(resp, "countries")],
        "devices": [{"device": (r.get("dimensions") or {}).get("deviceType") or "(未知)",
                     "count": r.get("count") or 0,
                     "uniques": (r.get("sum") or {}).get("visits") or 0}
                    for r in rows(resp, "devices")],
    }

    print("  本次新增 %d 天；历史共 %d 天，累计 PV %d" % (added, len(days_sorted), out["total_views"]))
    if dry:
        print("  (dry-run) 不写文件")
        return 0
    os.makedirs(os.path.dirname(DATA), exist_ok=True)
    with open(DATA, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1, sort_keys=True)
    print("  已写入 %s" % os.path.relpath(DATA, ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())