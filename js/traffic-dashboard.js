/* 流量看板 —— 纯前端，读 /data/traffic.json 后手绘 SVG，不引任何图表库。
   数据由 .github/workflows/traffic.yml 每日拉 Cloudflare Web Analytics(RUM) 累积。
   指标口径：count = 页面浏览量(PV)；sum.visits = 访问次数/会话数（不是严格意义的独立访客）。 */
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
    + '.td-2col{display:grid;grid-template-columns:1fr 1fr;gap:26px}'
    + '@media(max-width:720px){.td-2col{grid-template-columns:1fr}}'
    + '.td-note{margin-top:26px;font-size:12px;opacity:.6;border-left:2px solid rgba(255,255,255,.15);padding-left:12px}'
    + '.td-empty{padding:22px 0;text-align:center;opacity:.55}';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(n) { return (n || 0).toLocaleString('en-US'); }

  function lineChart(days, series, w, h) {
    var padL = 44, padR = 12, padT = 14, padB = 26;
    var iw = w - padL - padR, ih = h - padT - padB;
    var max = 1;
    series.forEach(function (s) { s.data.forEach(function (v) { if (v > max) max = v; }); });
    var step = Math.pow(10, Math.floor(Math.log(max) / Math.LN10));
    if (max / step < 4) step = step / 2;
    var top = Math.max(1, Math.ceil(max / step) * step);
    var x = function (i) { return padL + (days.length <= 1 ? iw / 2 : i * iw / (days.length - 1)); };
    var y = function (v) { return padT + ih - (v / top) * ih; };

    var out = ['<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '" preserveAspectRatio="none" role="img">'];
    for (var g = 0; g <= 4; g++) {
      var val = top * g / 4, yy = y(val);
      out.push('<line x1="' + padL + '" y1="' + yy.toFixed(1) + '" x2="' + (w - padR) + '" y2="' + yy.toFixed(1) + '" stroke="rgba(255,255,255,.08)"/>');
      out.push('<text x="' + (padL - 8) + '" y="' + (yy + 4).toFixed(1) + '" text-anchor="end" font-size="10" fill="rgba(255,255,255,.45)">' + num(Math.round(val)) + '</text>');
    }
    var every = Math.max(1, Math.ceil(days.length / 6));
    days.forEach(function (d, i) {
      if (i % every) return;
      out.push('<text x="' + x(i).toFixed(1) + '" y="' + (h - 8) + '" text-anchor="middle" font-size="10" fill="rgba(255,255,255,.45)">' + d.slice(5) + '</text>');
    });
    series.forEach(function (s) {
      var pts = s.data.map(function (v, i) { return x(i).toFixed(1) + ',' + y(v).toFixed(1); }).join(' ');
      out.push('<polyline points="' + pts + '" fill="none" stroke="' + s.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"' + (s.dash ? ' stroke-dasharray="4 3"' : '') + '/>');
      if (days.length <= 45) {
        s.data.forEach(function (v, i) {
          out.push('<circle cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="2.4" fill="' + s.color + '"/>');
        });
      }
    });
    out.push('</svg>');
    return out.join('');
  }

  function table(title, sub, rows, cols, keyOf, labelOf) {
    var h = ['<div class="td-h">' + esc(title) + '<small>' + esc(sub) + '</small></div>'];
    if (!rows || !rows.length) {
      h.push('<div class="td-empty">暂无数据</div>');
      return h.join('');
    }
    h.push('<table class="td-t"><thead><tr><th>' + esc(cols[0]) + '</th><th class="n">浏览</th><th class="n">会话</th></tr></thead><tbody>');
    rows.forEach(function (r) {
      h.push('<tr><td>' + labelOf(r) + '</td><td class="n">' + num(r.count) + '</td><td class="n">' + num(r.uniques) + '</td></tr>');
    });
    h.push('</tbody></table>');
    return h.join('');
  }

  function render(d) {
    var days = Object.keys(d.views || {}).sort();
    var hasData = days.some(function (k) { return (d.views[k] || {}).count > 0; });
    var pv = days.map(function (k) { return (d.views[k] || {}).count || 0; });
    var uv = days.map(function (k) { return (d.views[k] || {}).uniques || 0; });

    var html = ['<style>' + STYLE + '</style>'];
    html.push('<p style="opacity:.7;margin:0 0 4px">本站访问统计由 <strong>Cloudflare Web Analytics</strong> 采集：'
      + '不使用 cookie、不采集个人身份信息、不做跨站追踪。</p>');

    html.push('<div class="td-cards">'
      + card('累计浏览量', num(d.total_views), 'PV')
      + card('累计访问次数', num(d.total_uniques_sum_daily), '按日累计的会话数')
      + card('统计天数', num(d.days_tracked), '天')
      + card('数据更新', (d.updated || '').slice(0, 10), (d.updated || '').slice(11, 16) + ' UTC')
      + '</div>');

    if (days.length) {
      var series = [
        { name: '浏览量 PV', color: '#38bdf8', data: pv },
        { name: '访问次数', color: '#34d399', data: uv, dash: true }
      ];
      html.push('<div class="td-h">每日趋势 <small>' + d.first_day + ' 起 · 共 ' + days.length + ' 天</small></div>');
      html.push('<div class="td-chart"><div class="td-legend">'
        + '<span><i style="background:#38bdf8"></i>页面浏览量 PV</span>'
        + '<span><i style="background:#34d399"></i>访问次数（会话）</span>'
        + '</div><div id="td-svg"></div></div>');
    }

    html.push(table('热门页面', '最近 30 天', d.paths || [], ['页面'], null, function (r) {
      return '<a href="' + esc(r.path) + '">' + esc(r.path) + '</a>';
    }));

    html.push('<div class="td-2col">');
    html.push(table('流量来源', '最近 30 天', d.referrers || [], ['来源'], null, function (r) {
      return esc(r.referrer);
    }));
    html.push(table('访客地区', '最近 30 天', d.countries || [], ['国家 / 地区'], null, function (r) {
      return esc(r.country);
    }));
    html.push('</div>');

    html.push(table('设备类型', '最近 30 天', d.devices || [], ['设备'], null, function (r) {
      return esc(r.device);
    }));

    html.push('<div class="td-note">'
      + '历史数据由每日快照累积在仓库里（<code>data/traffic.json</code>），只增不减。'
      + '"会话"指访问次数，同一访客当天多次访问会计多次，因此不等同于严格意义的独立访客数。'
      + (hasData ? '' : '<br><b>目前还没有采集到访问</b> —— 统计代码刚接入，数据从接入当天开始累积。')
      + '</div>');

    root.innerHTML = html.join('');
    var box = document.getElementById('td-svg');
    if (box && days.length) box.innerHTML = lineChart(days, series, 780, 240);
  }

  function card(k, v, u) {
    return '<div class="td-card"><div class="k">' + esc(k) + '</div><div class="v">' + v
      + '<span class="u">' + esc(u) + '</span></div></div>';
  }

  fetch('/data/traffic.json', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(render)
    .catch(function (e) {
      root.innerHTML = '<div class="td-empty">数据还没生成（' + esc(e.message) + '）。<br>'
        + '看板依赖 <code>data/traffic.json</code>，由 GitHub Actions 每天自动更新。</div>';
    });
})();