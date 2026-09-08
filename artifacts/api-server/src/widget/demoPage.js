'use strict';

function renderWidgetDemoPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>OmniCore Widget Demo</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f1f5f9;min-height:100vh;display:flex;align-items:center;justify-content:center;}
  .card{background:#fff;border-radius:16px;padding:48px 40px;max-width:480px;width:100%;box-shadow:0 4px 32px rgba(0,0,0,.1);text-align:center;}
  h1{font-size:24px;font-weight:700;color:#0f172a;margin-bottom:8px;}
  p{color:#64748b;font-size:14px;line-height:1.6;margin-bottom:24px;}
  .badge{display:inline-flex;align-items:center;gap:6px;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;border-radius:999px;padding:4px 12px;font-size:12px;font-weight:600;margin-bottom:24px;}
  .dot{width:7px;height:7px;border-radius:50%;background:#22c55e;}
  .embed{background:#1e293b;border-radius:10px;padding:16px;margin-top:20px;text-align:left;}
  .embed pre{color:#7dd3fc;font-size:12px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;}
</style>
</head>
<body>
<div class="card">
  <h1>OmniCore Widget</h1>
  <p>The chat widget is active on this page. Click the <strong>blue bubble</strong> in the bottom-right corner to open it.</p>
  <div class="badge"><span class="dot"></span>Widget loaded &amp; connected</div>
  <p>Embed on any site with one line:</p>
  <div class="embed">
    <pre>&lt;script src="https://YOUR_DOMAIN/api/widget/widget.js"
  data-brand-id="22222222-2222-2222-2222-222222222222"
  data-label="OmniCore Support" defer&gt;&lt;/script&gt;</pre>
  </div>
</div>
<script src="/api/widget/widget.js" data-brand-id="22222222-2222-2222-2222-222222222222" data-label="OmniCore Support" data-color="#0284c7"></script>
</body>
</html>`;
}

module.exports = { renderWidgetDemoPage };
