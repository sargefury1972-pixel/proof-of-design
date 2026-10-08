/* Proof of Design — printable, self-contained HTML certificate. */
(function () {
  'use strict'
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

  function qrSvg (text) {
    try {
      const q = qrcode(0, 'M'); q.addData(text); q.make()
      return q.createSvgTag({ cellSize: 3, margin: 0, scalable: true })
    } catch (e) { return '' }
  }
  function fmtBytes (n) {
    if (n == null) return ''
    const u = ['bytes', 'KB', 'MB', 'GB']; let i = 0; let v = n
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
    return (i ? v.toFixed(v < 10 ? 2 : 1) : v) + ' ' + u[i] + (i ? ` (${n.toLocaleString('en-GB')} bytes)` : '')
  }
  function fmtTime (iso) {
    if (!iso) return ''
    const d = new Date(iso)
    if (isNaN(d)) return esc(iso)
    return d.toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'long', timeZone: 'Europe/London' }) + ' (UK) · ' + d.toISOString()
  }

  /**
   * d: { fileName, fileSize, hashHex, title, txid, network, explorerUrl,
   *      stampTime (ISO in record), blockTime (ISO|null), blockHeight, verifyUrl }
   */
  function html (d) {
    const net = d.network === 'test' ? 'BSV Testnet (no monetary value)' : 'BSV Mainnet'
    const block = d.blockTime
      ? `${fmtTime(d.blockTime)}${d.blockHeight ? ' · block #' + Number(d.blockHeight).toLocaleString('en-GB') : ''}`
      : 'Awaiting first block confirmation (usually ~10 minutes). Check the explorer link for the final block time.'
    return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>Certificate — ${esc(d.title || d.fileName)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
@page{size:A4;margin:14mm}
*{box-sizing:border-box}body{margin:0;background:#EDEAE3;font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#141414}
.sheet{max-width:820px;margin:28px auto;background:#fff;padding:56px 60px;border-radius:6px;box-shadow:0 20px 60px -30px rgba(0,0,0,.35);position:relative;overflow:hidden}
.sheet:before{content:"";position:absolute;inset:14px;border:1.5px solid #141414;border-radius:3px;pointer-events:none}
.sheet:after{content:"";position:absolute;inset:19px;border:.5px solid #141414;border-radius:2px;pointer-events:none}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}
.eyebrow{font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#E5482D}
h1{font-size:34px;line-height:1.1;letter-spacing:-.025em;margin:8px 0 6px}
.sub{color:#55534E;max-width:460px}
.seal{width:112px;height:112px;color:#E5482D;flex:none}
.title{font-size:20px;font-weight:700;margin:30px 0 4px;letter-spacing:-.01em}
table{width:100%;border-collapse:collapse;margin-top:18px}
td{padding:11px 0;border-top:1px solid #E4E0D6;vertical-align:top}
td:first-child{width:150px;color:#8A877F;font-size:12px;font-weight:650;text-transform:uppercase;letter-spacing:.06em;padding-top:13px}
.mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:12.5px;word-break:break-all}
a{color:#141414}
.bottom{display:flex;gap:24px;align-items:flex-end;margin-top:26px}
.qr{width:116px;height:116px;flex:none}.qr svg{width:100%;height:100%}
.how{font-size:12px;color:#55534E;flex:1}
.how b{color:#141414}
.btn{position:fixed;right:20px;top:20px;background:#141414;color:#fff;border:0;border-radius:10px;padding:10px 16px;font:600 14px system-ui;cursor:pointer}
@media print{body{background:#fff}.sheet{box-shadow:none;margin:0;max-width:none;padding:40px 44px}.btn{display:none}}
</style></head><body>
<button class="btn" onclick="window.print()">Print / Save as PDF</button>
<div class="sheet">
  <div class="top">
    <div>
      <div class="eyebrow">Proof of Design · Certificate of Existence</div>
      <h1>This file existed.</h1>
      <div class="sub">The SHA-256 fingerprint below was permanently recorded on the BSV blockchain. Any copy of the file that produces the same fingerprint is byte-for-byte identical to the one stamped.</div>
    </div>
    <svg class="seal" viewBox="0 0 120 120"><circle cx="60" cy="60" r="55" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="5 4"/><circle cx="60" cy="60" r="44" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M42 61l12 12 25-27" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </div>
  ${d.title ? `<div class="title">${esc(d.title)}</div>` : '<div class="title">&nbsp;</div>'}
  <table>
    <tr><td>File name</td><td>${esc(d.fileName || '—')}</td></tr>
    ${d.fileSize != null ? `<tr><td>File size</td><td>${esc(fmtBytes(d.fileSize))}</td></tr>` : ''}
    <tr><td>SHA-256</td><td class="mono">${esc(d.hashHex)}</td></tr>
    <tr><td>Transaction ID</td><td class="mono">${esc(d.txid)}</td></tr>
    <tr><td>Explorer</td><td class="mono"><a href="${esc(d.explorerUrl)}">${esc(d.explorerUrl)}</a></td></tr>
    <tr><td>Network</td><td>${esc(net)}</td></tr>
    <tr><td>Stamped at</td><td>${d.stampTime ? fmtTime(d.stampTime) + '<br><span style="color:#8A877F;font-size:12px">time claimed by the stamper\'s device</span>' : '—'}</td></tr>
    <tr><td>Block time</td><td>${block}<br><span style="color:#8A877F;font-size:12px">authoritative time set by the BSV network</span></td></tr>
  </table>
  <div class="bottom">
    <div class="qr">${qrSvg(d.explorerUrl)}</div>
    <div class="how"><b>How to verify independently.</b> 1) Compute the SHA-256 of the original file (e.g. <span class="mono">shasum -a 256 file</span> on macOS/Linux or <span class="mono">certutil -hashfile file SHA256</span> on Windows). 2) Open the transaction on any BSV explorer and find the OP_RETURN output beginning with “PROOFOFDESIGN”. 3) The 32-byte value after the version field must equal the fingerprint above. The block time is when the record was sealed.<br><br>
    A timestamp proves the file existed at that time. On its own it does not prove authorship; keep your working files, drafts and correspondence too. Generated ${esc(new Date().toISOString())}.</div>
  </div>
</div></body></html>`
  }

  function slug (s) { return String(s || 'design').replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'design' }

  function download (d) {
    const blob = new Blob([html(d)], { type: 'text/html' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `proof-of-design-${slug(d.fileName)}-${String(d.txid).slice(0, 8)}.html`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  }
  function open (d) {
    const w = window.open('', '_blank')
    if (!w) { download(d); return }
    w.document.open(); w.document.write(html(d)); w.document.close()
    setTimeout(() => { try { w.focus(); w.print() } catch (e) {} }, 400)
  }
  window.PoDCertificate = { html, download, open }
})()
