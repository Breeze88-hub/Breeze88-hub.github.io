/* 流量看板 —— 纯前端，读 /data/traffic.json 后手绘 SVG，不引任何图表库。
   数据由 tools/fetch-traffic.py 每日快照累积（GitHub Traffic 只有 14 天窗口）。 */
(function () {
  var root = document.getElementById('traffic-dash');
  if (!root) return;

  var STYLE = ''
    + '#traffic-dash{font-size:14px;line-height:1.6}'
    + '.td-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:18px 0 26px}'
    + '.td-card{background:rgba(255,255,255,.05);border-radius:12px;padding:16px 18px}'
    + '.td-card .k{font-size:12px;opacity:.62;letter-spacing:.02em}'
    + '.td-card .v{font-size:26px;font-weight:700;margin-top:6px}'
    + '.td-card .u{font-size:12px;opacity:.55;margin-left:4px;font-weight:400}'
    + '.td-h{font-size:16px;font-weight:600;margin:26px 0 10px;display:flex;align-items:baseline;gap:10px}'
    + '.td-h small{font-size:12px;font-weight:400;opacity:.55}'
    + '.td-chart{background:rgba(255,255,255,.04);border-radius:12px;padding:14px 10px 6px}'
    + '.td-legend{display:flex;gap:18px;font-size:12px;opacity:.8;padding:0 8px 6px}'
    + '.td-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}'
    + 'table.td-t{width:100%;border-collapse:collapse;font-size:13px}'
    + 'table.td-t th,table.td-t td{text-align:left;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.07)}'
    + 'table.td-t th{font-weight:500;opacity:.6;font-size:12px}'
    + 'table.td-t td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}'
    + 'table.td-t a{text-decoration:none}'
    + '.td-note{margin-top:26px;font-size:12px;opacity:.6;border-left:2px solid rgba(255,255,255,.15);padding-left:12px}'
    + '.td-empty{padding:34px 0;text-align:center;opacity:.6}';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function num(n) {
    return (n || 0).toLocaleString('en-US');
  }

  // 手绘折线：两条序列共用一套 x 轴与 y 轴上限
  function lineChart(days, series, w, h) {
    var padL = 44, padR = 12, padT = 14, padB = 26;
    var iw = w - padL - padR, ih = h - padT - padB;
    var max = 1;
    series.forEach(function (s) { s.data.forEach(function (v) { if (v > max) max = v; }); });
    // y 轴取整到好读的刻度
    var step = Math.pow(10, Math.floor(Math.log(max) / Math.LN10));
    if (max / step < 4) step = step / 2;
    var top = Math.ceil(max / step) * step;

    var x = function (i) { return padL + (days.length <= 1 ? iw / 2 : i * iw / (days.length - 1)); };
    var y = function (v) { return padT + ih - (v / top) * ih; };

    var out = ['<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '" preserveAspectRatio="none" role="img">'];

    // 横向网格 + y 轴刻度
    for (var g = 0; g <= 4; g++) {
      var val = top * g / 4, yy = y(val);
      out.push('<line x1="' + padL + '" y1="' + yy.toFixed(1) + '" x2="' + (w - padR) + '" y2="' + yy.toFixed(1) + '" stroke="rgba(255,255,255,.08)" stroke-width="1"/>');
      out.push('<text x="' + (padL - 8) + '" y="' + (yy + 4).toFixed(1) + '" text-anchor="end" font-size="10" fill="rgba(255,255,255,.45)">' + num(Math.round(val)) + '</text>');
    }

    // x 轴日期（最多标 6 个）
    var every = Math.max(1, Math.ceil(days.length / 6));
    days.forEach(function (d, i) {
      if (i % every) return;
      out.push('<text x="' + x(i).toFixed(1) + '" y="' + (h - 8) + '" text-anchor="middle" font-size="10" fill="rgba(255,255,255,.45)">' + d.slice(5) + '</text>');
    });

    series.forEach(function (s) {
      var pts = s.data.map(function (v, i) { return x(i).toFixed(1) + ',' + y(v).toFixed(1); }).join(' ');
      out.push('<polyline points="' + pts + '" fill="none" stroke="' + s.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"' + (s.dash ? ' stroke-dasharray="4 3"' : '') + '/>');
      // 只在数据少时打点，避免密集看不清
      if (days.length <= 45) {
        s.data.forEach(function (v, i) {
          out.push('<circle cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="2.4" fill="' + s.color + '"/>');
        });
      }
    });

    out.push('</svg>');
    return out.join('');
  }

  function render(d) {
    var days = Object.keys(d.views || {}).sort();
    var hasData = days.some(function (k) { return (d.views[k] || {}).count > 0; });

    var pv = days.map(function (k) { return (d.views[k] || {}).count || 0; });
    var uv = days.map(function (k) { return (d.views[k] || {}).uniques || 0; });

    var html = ['<style>' + STYLE + '</style>'];

    html.push('<p style="opacity:.7;margin:0 0 4px">本站访问数据。统计服务正在接入，接入完成后这里会显示每日浏览量、独立访客与热门文章。</p>');

    html.push('<div class="td-cards">'
      + card('累计浏览量', num(d.total_views), 'PV')
      + card('日均 UV', num(days.length ? Math.round((d.total_uniques_sum_daily || 0) / days.length) : 0), '按日去重后的均值')
      + card('记录天数', num(d.days_tracked), '天')
      + card('数据更新', (d.updated || '').slice(0, 10), (d.updated || '').slice(11, 16) + ' UTC')
      + '</div>');

    if (days.length) {
      var series = [
        { name: '浏览量 PV', color: '#38bdf8', data: pv },
        { name: '独立访客 UV', color: '#34d399', data: uv, dash: true }
      ];
      html.push('<div class="td-h">每日趋势 <small>' + d.first_day + ' 起 · 共 ' + days.length + ' 天</small></div>');
      html.push('<div class="td-chart"><div class="td-legend">'
        + '<span><i style="background:#38bdf8"></i>浏览量 PV</span>'
        + '<span><i style="background:#34d399"></i>独立访客 UV</span>'
        + '</div><div id="td-svg"></div></div>');
    }

    // 热门页面
    html.push('<div class="td-h">热门页面 <small>GitHub 只给最近 14 天排行</small></div>');
    if ((d.paths || []).length) {
      html.push('<table class="td-t"><thead><tr><th>页面</th><th class="n">浏览</th><th class="n">独立</th></tr></thead><tbody>');
      d.paths.forEach(function (p) {
        var label = p.title ? esc(p.title) : esc(p.path);
        html.push('<tr><td><a href="' + esc(p.path) + '">' + label + '</a><div style="opacity:.45;font-size:11px">' + esc(p.path) + '</div></td>'
          + '<td class="n">' + num(p.count) + '</td><td class="n">' + num(p.uniques) + '</td></tr>');
      });
      html.push('</tbody></table>');
    } else {
      html.push('<div class="td-empty">还没有足够数据</div>');
    }

    // 来源
    html.push('<div class="td-h">流量来源 <small>最近 14 天</small></div>');
    if ((d.referrers || []).length) {
      html.push('<table class="td-t"><thead><tr><th>来源</th><th class="n">浏览</th><th class="n">独立</th></tr></thead><tbody>');
      d.referrers.forEach(function (r) {
        html.push('<tr><td>' + esc(r.referrer) + '</td><td class="n">' + num(r.count) + '</td><td class="n">' + num(r.uniques) + '</td></tr>');
      });
      html.push('</tbody></table>');
    } else {
      html.push('<div class="td-empty">还没有外部来源记录（直接访问、RSS 阅读器不计入 referrer）</div>');
    }

    html.push('<div class="td-note">'
      + '看板框架已就位（数据文件 + 每日快照 + 前端图表），只等统计数据源接入。'
      + (hasData ? '' : '<br>当前文件里还没有有效访问记录。')
      + '</div>');

    root.innerHTML = html.join('');

    var box = document.getElementById('td-svg');
    if (box && days.length) {
      box.innerHTML = lineChart(days, series, 780, 240);
    }
  }

  function card(k, v, u) {
    return '<div class="td-card"><div class="k">' + esc(k) + '</div><div class="v">' + v + '<span class="u">' + esc(u) + '</span></div></div>';
  }

  fetch('/data/traffic.json', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(render)
    .catch(function (e) {
      root.innerHTML = '<div class="td-empty">数据还没生成（' + esc(e.message) + '）。<br>'
        + '看板依赖 <code>tools/fetch-traffic.py</code> 的快照文件 <code>source/_data/traffic.json</code>，'
        + '由 GitHub Actions 每天自动更新。</div>';
    });
})();