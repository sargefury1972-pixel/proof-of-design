/* Proof of Design — UI + network glue. */
(function () {
  'use strict'
  const cfg = window.POD_CONFIG
  const Core = window.PoDCore
  const Cert = window.PoDCertificate
  const $ = id => document.getElementById(id)
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

  const state = {
    network: localStorage.getItem('pod.network') || cfg.defaultNetwork || 'main',
    stampFile: null, // { name, size, hashHex }
    verifyFile: null,
    price: null, // { gbp, usd }
    satsPerKb: cfg.fallbackSatsPerKb,
    wallet: null, // BRC-100 WalletClient when connected
    lastStamp: null,
    balance: null
  }

  // ---------- formatting ----------
  function fmtBytes (n) {
    const u = ['bytes', 'KB', 'MB', 'GB']; let i = 0; let v = n
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
    return (i ? v.toFixed(v < 10 ? 2 : 1) : v) + ' ' + u[i]
  }
  const fmtSats = n => Number(n).toLocaleString('en-GB') + ' sats'
  function fiat (sats) {
    if (!state.price || !state.price.gbp) return ''
    const gbp = sats / 1e8 * state.price.gbp
    if (gbp < 0.01) return `≈ ${(gbp * 100).toPrecision(2)}p`
    return `≈ £${gbp.toFixed(2)}`
  }
  const ext = name => ((name.match(/\.([a-z0-9]{1,5})$/i) || [])[1] || 'file').toUpperCase()
  const explorerUrl = (txid, net = state.network) => cfg.explorer[net] + txid
  const wocBase = (net = state.network) => cfg.woc[net]
  const addrPrefix = net => net === 'test' ? [0x6f] : [0x00]

  // ---------- small UI helpers ----------
  function notice (el, msg, kind = '') {
    el.className = 'notice' + (kind ? ' ' + kind : '')
    el.innerHTML = msg
    el.classList.remove('hidden')
  }
  function hide (el) { el.classList.add('hidden') }
  function modal ({ title, body, ok = 'OK', cancel = 'Cancel', input = null }) {
    return new Promise(resolve => {
      $('modalTitle').textContent = title
      $('modalBody').innerHTML = body + (input ? `<input id="modalInput" placeholder="${esc(input)}" spellcheck="false" autocomplete="off">` : '')
      $('modalOk').textContent = ok
      $('modalCancel').textContent = cancel
      $('modalCancel').classList.toggle('hidden', cancel === null)
      $('modal').classList.remove('hidden')
      const inp = $('modalInput'); if (inp) setTimeout(() => inp.focus(), 30)
      const done = v => { $('modal').classList.add('hidden'); $('modalOk').onclick = $('modalCancel').onclick = null; resolve(v) }
      $('modalOk').onclick = () => done(input ? (inp.value || '').trim() : true)
      $('modalCancel').onclick = () => done(input ? null : false)
    })
  }
  function busy (btn, on, label) {
    if (on) { btn.dataset.label = btn.innerHTML; btn.innerHTML = `<span class="spinner"></span><span>${label}</span>`; btn.disabled = true } else { btn.innerHTML = btn.dataset.label || btn.innerHTML; btn.disabled = false }
  }
  async function fetchJSON (url, opts = {}, timeoutMs = 15000) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const r = await fetch(url, { ...opts, signal: ctl.signal })
      if (!r.ok) { const e = new Error(`HTTP ${r.status} from ${new URL(url).host}`); e.status = r.status; throw e }
      const ct = r.headers.get('content-type') || ''
      return ct.includes('json') ? r.json() : r.text()
    } finally { clearTimeout(t) }
  }

  // ---------- hashing (local only) ----------
  async function sha256File (file) {
    const buf = await file.arrayBuffer()
    if (window.crypto && crypto.subtle) {
      const d = await crypto.subtle.digest('SHA-256', buf)
      return Core.bytesToHex(new Uint8Array(d))
    }
    // Fallback for non-secure contexts (pure JS, slower for big files)
    return Core.bytesToHex(bsv.Hash.sha256(Array.from(new Uint8Array(buf))))
  }

  function setupDrop (dropId, inputId, onFile) {
    const drop = $(dropId); const input = $(inputId)
    ;['dragenter', 'dragover'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add('over') }))
    ;['dragleave', 'drop'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove('over') }))
    drop.addEventListener('drop', ev => { const f = ev.dataTransfer.files && ev.dataTransfer.files[0]; if (f) onFile(f) })
    drop.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); input.click() } })
    input.addEventListener('change', () => { if (input.files[0]) onFile(input.files[0]); input.value = '' })
  }

  async function loadFile (file, which) {
    const S = which === 'stamp' ? 'Stamp' : 'Verify'
    $('fileCard' + S).classList.remove('hidden')
    $('drop' + S).classList.add('compact')
    $('drop' + S).querySelector('.drop-title').textContent = 'Drop a different file'
    $('fileName' + S).textContent = file.name
    $('fileSize' + S).textContent = fmtBytes(file.size)
    $('fileExt' + S).textContent = ext(file.name)
    const h = $('hash' + S); h.textContent = 'Calculating fingerprint…'; h.classList.add('pending')
    try {
      const t0 = performance.now()
      const hashHex = await sha256File(file)
      h.textContent = hashHex; h.classList.remove('pending')
      $('fileSize' + S).textContent = `${fmtBytes(file.size)} · fingerprinted in ${Math.max(1, Math.round(performance.now() - t0))} ms`
      const rec = { name: file.name, size: file.size, hashHex, type: file.type }
      if (which === 'stamp') { state.stampFile = rec; hide($('stampResult')); hide($('stampStatus')) } else { state.verifyFile = rec; hide($('verdict')) }
      updateButtons()
    } catch (e) {
      h.textContent = 'Could not read this file: ' + e.message
    }
  }
  function clearFile (which) {
    const S = which === 'stamp' ? 'Stamp' : 'Verify'
    $('fileCard' + S).classList.add('hidden'); $('drop' + S).classList.remove('compact')
    $('drop' + S).querySelector('.drop-title').textContent = which === 'stamp' ? 'Drop your design file here' : 'Drop the original file'
    if (which === 'stamp') state.stampFile = null; else state.verifyFile = null
    updateButtons(); $('file' + S).click()
  }

  function updateButtons () {
    $('stampBtn').disabled = !state.stampFile
    $('verifyBtn').disabled = !(state.verifyFile && /^[0-9a-f]{64}$/i.test($('txid').value.trim()))
  }

  // ---------- tabs ----------
  function showTab (name) {
    document.querySelectorAll('.tab').forEach(t => { const on = t.dataset.tab === name; t.classList.toggle('active', on); t.setAttribute('aria-selected', on) })
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name))
    if (name === 'key') refreshBalance()
  }

  // ---------- price & fees ----------
  async function loadPrice () {
    try {
      const d = await fetchJSON(cfg.priceUrl)
      const p = d['bitcoin-cash-sv']; if (p && p.gbp) state.price = { gbp: p.gbp, usd: p.usd }
    } catch (e) {
      try { const r = await fetchJSON(wocBase('main') + '/exchangerate'); state.price = { usd: r.rate, gbp: null } } catch (e2) {}
    }
    renderCosts()
  }
  async function loadFeeRate () {
    try {
      const d = await fetchJSON(cfg.arc[state.network] + '/v1/policy')
      const f = d.policy && d.policy.miningFee
      if (f && f.bytes > 0 && f.satoshis >= 0) state.satsPerKb = Math.max(1, Math.ceil(f.satoshis / f.bytes * 1000))
    } catch (e) { state.satsPerKb = cfg.fallbackSatsPerKb }
    renderCosts()
  }
  function typicalFee () {
    const scriptLen = Core.buildStampScript({ hashHex: '00'.repeat(32), title: 'A typical title of about forty chars', isoTime: new Date().toISOString() }).toBinary().length
    return Core.estimateFee({ inputs: 1, scriptLen, extraOutputs: svcFee() ? 1 : 0, satsPerKb: state.satsPerKb })
  }
  // Service fee (from config.js) — charged on mainnet stamps only; testnet practice stamps are free.
  function svcFee () { return state.network !== 'test' && cfg.serviceFee && cfg.serviceFee.address && cfg.serviceFee.satoshis > 0 ? cfg.serviceFee : null }
  const perStamp = () => typicalFee() + (svcFee() ? svcFee().satoshis : 0)
  function feeBreakdown () {
    const fee = typicalFee(); const svc = svcFee()
    return svc ? `${fmtSats(svc.satoshis)} service fee + about ${fmtSats(fee)} network fee` : `about ${fmtSats(fee)} network fee`
  }
  function renderCosts () {
    const fee = typicalFee(); const svc = svcFee()
    const total = fee + (svc ? svc.satoshis : 0)
    const f = fiat(total)
    const net = state.network === 'test' ? 'TESTNET' : 'mainnet'
    $('costLine').innerHTML = svc
      ? `Service fee <b>${fmtSats(svc.satoshis)}</b> + network ≈ ${fmtSats(fee)} = <b>≈ ${fmtSats(total)}</b> per stamp${f ? ' (' + f + ')' : ''} · ${net}`
      : `Network fee ≈ ${fmtSats(fee)}${f ? ' (' + f + ')' : ''} · ${net}${state.network === 'test' ? ' · no service fee on testnet' : ''}`
    $('feeLine').innerHTML = svc
      ? `Each stamp costs <b>${fmtSats(svc.satoshis)}</b> service fee + about <b>${fmtSats(fee)}</b> network fee = <b>≈ ${fmtSats(total)}</b>${f ? ' (' + f + ')' : ''}.`
      : `Each stamp costs about <b>${fmtSats(fee)}</b> in network fees${f ? ' (' + f + ')' : ''}${state.network === 'test' ? ' (no service fee on testnet)' : ''}.`
    const n100k = Math.floor(100000 / total).toLocaleString('en-GB')
    const f100k = fiat(100000) ? ', worth about <b>' + fiat(100000).replace('≈ ', '') + '</b>' : ''
    $('fundLine').innerHTML = `<b>100,000 sats</b> (0.001 BSV${f100k}) covers about <b>${n100k} stamps</b>.`
    renderBalance(); renderPayMode()
  }

  // ---------- network ----------
  function setNetwork (net) {
    state.network = net; localStorage.setItem('pod.network', net)
    document.querySelectorAll('.segbtn').forEach(b => b.classList.toggle('active', b.dataset.net === net))
    $('netBadge').textContent = net === 'test' ? 'TEST' : 'MAIN'
    $('netBadge').classList.toggle('test', net === 'test')
    $('verifyTestnet').checked = net === 'test'
    state.balance = null
    renderKey(); renderPayMode(); loadFeeRate(); renderHistory()
  }

  // ---------- stamping key ----------
  const keySlot = () => 'pod.key.' + state.network
  function getKey () {
    const wif = localStorage.getItem(keySlot())
    if (!wif) return null
    try { return bsv.PrivateKey.fromWif(wif) } catch (e) { return null }
  }
  const keyAddress = key => key.toPublicKey().toAddress(addrPrefix(state.network))

  function renderKey () {
    const key = getKey()
    $('noKey').classList.toggle('hidden', !!key)
    $('hasKey').classList.toggle('hidden', !key)
    if (!key) return
    const addr = keyAddress(key)
    $('address').textContent = addr
    try {
      const q = qrcode(0, 'M'); q.addData(addr); q.make()
      $('qr').innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true })
    } catch (e) { $('qr').innerHTML = '' }
    renderBalance()
  }
  function renderBalance () {
    if (!$('balSats')) return
    if (state.balance == null) { $('balSats').textContent = '—'; $('balFiat').textContent = ''; $('balStamps').textContent = ''; return }
    $('balSats').textContent = fmtSats(state.balance)
    $('balFiat').textContent = fiat(state.balance)
    const per = perStamp()
    $('balStamps').textContent = state.balance >= per
      ? `Enough for roughly ${Math.floor(state.balance / per).toLocaleString('en-GB')} stamps (each ≈ ${fmtSats(per)}: ${feeBreakdown()}).`
      : state.balance > 0
        ? `Not enough for a stamp yet. Each stamp needs ≈ ${fmtSats(per)} (${feeBreakdown()}). Send a little more BSV to the address above.`
        : `Empty. Send a small amount of BSV to the address above. Each stamp needs ≈ ${fmtSats(per)} (${feeBreakdown()}).`
    if (state.balance > cfg.maxRecommendedBalanceSats) $('balStamps').textContent += ' This is more than you need — consider withdrawing some.'
  }

  async function createKey () {
    const key = bsv.PrivateKey.fromRandom()
    localStorage.setItem(keySlot(), key.toWif(state.network === 'test' ? [0xef] : [0x80]))
    renderKey(); renderPayMode(); state.balance = 0; renderBalance()
    notice($('keyStatus'), '<b>Key created.</b> Please download a backup now, then send a few pence of BSV to the address.', 'ok')
  }
  async function importKey () {
    const wif = await modal({ title: 'Import stamping key', body: 'Paste the WIF private key from your Proof of Design backup file. <b>Do not paste your main wallet\'s seed phrase or keys here.</b>', input: 'WIF, e.g. L1aW4aubDFB7yfras2S1mN3bqg9nwySY8nkoLmJebSLD5BWv3ENZ', ok: 'Import' })
    if (!wif) return
    if (wif.trim().split(/\s+/).length >= 12) { notice($('keyStatus'), 'That looks like a seed phrase. Never paste a seed phrase into a web page. Import cancelled.', 'error'); return }
    try {
      const k = bsv.PrivateKey.fromWif(wif.trim())
      if (getKey() && !(await modal({ title: 'Replace existing key?', body: 'This browser already has a stamping key on this network. Make sure it is backed up / empty before replacing it.', ok: 'Replace' }))) return
      localStorage.setItem(keySlot(), k.toWif(state.network === 'test' ? [0xef] : [0x80]))
      renderKey(); renderPayMode(); refreshBalance()
      notice($('keyStatus'), 'Key imported.', 'ok')
    } catch (e) { notice($('keyStatus'), 'That is not a valid WIF private key.', 'error') }
  }
  function backupKey () {
    const key = getKey(); if (!key) return
    const addr = keyAddress(key)
    const txt = [
      'PROOF OF DESIGN — STAMPING KEY BACKUP',
      '=====================================',
      '',
      `Network:  ${state.network === 'test' ? 'BSV TESTNET' : 'BSV MAINNET'}`,
      `Address:  ${addr}`,
      `Private key (WIF):  ${localStorage.getItem(keySlot())}`,
      '',
      'KEEP THIS FILE PRIVATE. Anyone who has it can spend the BSV on this address.',
      'To restore: open Proof of Design → Key & funds → Import a backup (WIF).',
      'The WIF can also be swept/imported into most BSV wallets.',
      '',
      `Created: ${new Date().toISOString()}`
    ].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }))
    a.download = `proof-of-design-key-${state.network}-${addr.slice(0, 8)}.txt`
    document.body.appendChild(a); a.click(); a.remove()
    localStorage.setItem(keySlot() + '.backedUp', '1')
    renderPayMode()
  }
  async function deleteKey () {
    const bal = state.balance || 0
    const ok = await modal({ title: 'Remove stamping key?', body: (bal > 0 ? `<b>This key still holds ${fmtSats(bal)}.</b> Withdraw it first or make sure you have the backup file. ` : '') + 'Removing the key deletes it from this browser. Without a backup, any BSV on it is lost for good.', ok: 'Remove key' })
    if (!ok) return
    localStorage.removeItem(keySlot()); localStorage.removeItem(keySlot() + '.backedUp'); localStorage.removeItem('pod.pending.' + state.network)
    state.balance = null; renderKey(); renderPayMode(); hide($('keyStatus'))
  }

  // ---------- UTXOs (WhatsOnChain + local pending view) ----------
  const pendingSlot = () => 'pod.pending.' + state.network
  function getPending () {
    try {
      const p = JSON.parse(localStorage.getItem(pendingSlot()) || '{"spent":[],"created":[]}')
      const cutoff = Date.now() - 6 * 3600e3 // forget after 6h; by then WOC has indexed everything
      p.spent = p.spent.filter(x => x.ts > cutoff); p.created = p.created.filter(x => x.ts > cutoff)
      return p
    } catch (e) { return { spent: [], created: [] } }
  }
  function savePending (p) { localStorage.setItem(pendingSlot(), JSON.stringify(p)) }
  function cacheTx (txid, hex) {
    try {
      const c = JSON.parse(sessionStorage.getItem('pod.txcache') || '{}'); c[txid] = hex
      const keys = Object.keys(c); if (keys.length > 40) delete c[keys[0]]
      sessionStorage.setItem('pod.txcache', JSON.stringify(c))
    } catch (e) {}
  }
  function cachedTx (txid) { try { return JSON.parse(sessionStorage.getItem('pod.txcache') || '{}')[txid] } catch (e) { return null } }

  async function getUtxos (address) {
    const d = await fetchJSON(`${wocBase()}/address/${address}/unspent/all`)
    let list = (d.result || []).filter(u => !u.isSpentInMempoolTx).map(u => ({ txid: u.tx_hash, vout: u.tx_pos, satoshis: u.value }))
    const p = getPending()
    const spent = new Set(p.spent.map(x => x.op))
    list = list.filter(u => !spent.has(u.txid + ':' + u.vout))
    for (const c of p.created) {
      if (c.address === address && !spent.has(c.txid + ':' + c.vout) && !list.some(u => u.txid === c.txid && u.vout === c.vout)) list.push({ txid: c.txid, vout: c.vout, satoshis: c.satoshis })
    }
    return list
  }
  async function withSources (utxos) {
    const out = []
    for (const u of utxos) {
      let hex = cachedTx(u.txid)
      if (!hex) { hex = String(await fetchJSON(`${wocBase()}/tx/${u.txid}/hex`)).trim(); cacheTx(u.txid, hex) }
      out.push({ ...u, sourceHex: hex })
    }
    return out
  }
  async function refreshBalance () {
    const key = getKey(); if (!key) return
    $('balSats').textContent = 'Checking…'
    try {
      const u = await getUtxos(keyAddress(key))
      state.balance = u.reduce((s, x) => s + x.satoshis, 0)
      renderBalance(); renderPayMode()
    } catch (e) { $('balSats').textContent = 'Could not load balance'; $('balStamps').textContent = e.message }
  }

  // ---------- broadcast ----------
  async function broadcast (tx) {
    const errors = []
    try {
      const r = await tx.broadcast(new bsv.ARC(cfg.arc[state.network]))
      if (r.status === 'success') return { txid: r.txid || tx.id('hex'), via: 'GorillaPool ARC' }
      if (/already|known|mined/i.test((r.description || '') + (r.code || ''))) return { txid: tx.id('hex'), via: 'GorillaPool ARC (already known)' }
      errors.push('ARC: ' + (r.description || r.code))
    } catch (e) { errors.push('ARC: ' + e.message) }
    try {
      const r = await tx.broadcast(new bsv.WhatsOnChainBroadcaster(state.network))
      if (r.status === 'success') return { txid: r.txid || tx.id('hex'), via: 'WhatsOnChain' }
      errors.push('WhatsOnChain: ' + (r.description || r.code))
    } catch (e) { errors.push('WhatsOnChain: ' + e.message) }
    const err = new Error('The network did not accept the transaction. ' + errors.join(' · ')); throw err
  }
  function recordPending (built, address) {
    const p = getPending(); const ts = Date.now()
    for (const u of built.inputsUsed || []) p.spent.push({ op: u.txid + ':' + u.vout, ts })
    built.tx.outputs.forEach((o, i) => {
      if (o.satoshis > 0 && o.lockingScript.toHex() === new bsv.P2PKH().lock(address).toHex()) p.created.push({ txid: built.txid, vout: i, satoshis: o.satoshis, address, ts })
    })
    savePending(p); cacheTx(built.txid, built.hex)
  }

  // ---------- pay mode panel ----------
  function renderPayMode () {
    const el = $('payMode')
    if (state.wallet) { el.innerHTML = `<b>Your BRC-100 wallet</b> pays and signs each stamp. You'll be asked to approve in the wallet.<br>Per stamp: ${feeBreakdown()}.`; return }
    const key = getKey()
    if (!key) { el.innerHTML = 'No stamping key yet. <button class="linkish" data-goto="key">Set one up</button> — it takes a few seconds and a few pence of BSV.'; return }
    const backed = localStorage.getItem(keySlot() + '.backedUp')
    el.innerHTML = `Stamping key <code class="addr">${esc(keyAddress(key))}</code>` +
      (state.balance != null ? `Balance: <b>${fmtSats(state.balance)}</b> ${fiat(state.balance)}<br>` : '') +
      `Per stamp: ${feeBreakdown()}.<br>` +
      (backed ? '' : '<span style="color:#C3332B">Not backed up yet.</span> ') + '<button class="linkish" data-goto="key">Manage</button>'
  }

  // ---------- STAMP ----------
  async function stamp () {
    const f = state.stampFile; if (!f) return
    const btn = $('stampBtn'); const status = $('stampStatus')
    const title = $('title').value.trim()
    const isoTime = new Date().toISOString()
    hide($('stampResult'))
    try {
      let txid; let via; let fee = null; let size = null; let svcPaid = 0
      if (state.wallet) {
        busy(btn, true, 'Waiting for wallet approval…')
        const script = Core.buildStampScript({ hashHex: f.hashHex, title, isoTime })
        const outputs = [{ lockingScript: script.toHex(), satoshis: 0, outputDescription: 'Proof of Design timestamp' }]
        const svc = svcFee(); if (svc) outputs.push({ lockingScript: new bsv.P2PKH().lock(svc.address).toHex(), satoshis: svc.satoshis, outputDescription: 'Proof of Design service fee' })
        const r = await state.wallet.createAction({ description: 'Proof of Design: timestamp a design file', outputs, labels: ['proofofdesign'], options: { acceptDelayedBroadcast: false, randomizeOutputs: false } })
        if (!r || !r.txid) throw new Error('The wallet did not return a transaction ID.')
        txid = r.txid; via = 'your BRC-100 wallet'; svcPaid = svc ? svc.satoshis : 0
      } else {
        const key = getKey()
        if (!key) { notice(status, 'You need a funded stamping key first. <button class="linkish" data-goto="key">Set one up →</button>', 'error'); return }
        busy(btn, true, 'Finding funds…')
        const address = keyAddress(key)
        const utxos = await getUtxos(address)
        if (!utxos.length) { const e = new Error(`Your stamping key is empty. Send some BSV to it first — each stamp needs about ${fmtSats(perStamp())} (${feeBreakdown()}).`); e.code = 'INSUFFICIENT_FUNDS'; throw e }
        // only fetch sources for as many coins as needed (largest first)
        utxos.sort((a, b) => b.satoshis - a.satoshis)
        const picked = []; let tot = 0
        const enough = Math.max(5000, perStamp() * 2)
        for (const u of utxos) { picked.push(u); tot += u.satoshis; if (tot > enough) break }
        busy(btn, false); busy(btn, true, 'Signing…')
        const built = await Core.buildStampTx({ privateKey: key, utxos: await withSources(picked), hashHex: f.hashHex, title, isoTime, satsPerKb: state.satsPerKb, serviceFee: svcFee(), network: state.network })
        busy(btn, false); busy(btn, true, 'Broadcasting…')
        const b = await broadcast(built.tx)
        txid = b.txid; via = b.via; fee = built.fee; size = built.size; svcPaid = built.serviceFee
        recordPending(built, address)
        state.balance = Math.max(0, (state.balance == null ? tot : state.balance) - built.fee - (svcFee() ? svcFee().satoshis : 0))
        renderPayMode()
      }
      hide(status)
      const entry = { txid, network: state.network, fileName: f.name, fileSize: f.size, hashHex: f.hashHex, title, stampTime: isoTime, via, fee, size, serviceFee: svcPaid }
      state.lastStamp = entry
      addHistory(entry)
      showStampResult(entry)
    } catch (e) {
      console.error(e)
      const msg = e.code === 'INSUFFICIENT_FUNDS' ? `${esc(e.message)} <button class="linkish" data-goto="key">Fund your key →</button>` : esc(e.message || String(e))
      notice(status, '<b>Not stamped.</b>&nbsp;' + msg, 'error')
    } finally { busy(btn, false); updateButtons() }
  }

  function certData (e, extra = {}) {
    return { fileName: e.fileName, fileSize: e.fileSize, hashHex: e.hashHex, title: e.title, txid: e.txid, network: e.network, explorerUrl: explorerUrl(e.txid, e.network), stampTime: e.stampTime, blockTime: extra.blockTime || null, blockHeight: extra.blockHeight || null }
  }
  function showStampResult (e) {
    const rows = [
      ['File', esc(e.fileName) + ` <span class="muted">(${fmtBytes(e.fileSize)})</span>`],
      ['SHA-256', `<span class="mono">${e.hashHex}</span>`, true],
      ['Transaction ID', `<span class="mono">${e.txid}</span>`, true],
      ['Stamped at', new Date(e.stampTime).toLocaleString('en-GB', { timeZone: 'Europe/London' }) + ' UK'],
      ['Paid via', esc(e.via) + (e.fee != null ? ` · network fee ${fmtSats(e.fee)} ${fiat(e.fee)} · ${e.size} bytes` : '') + (e.serviceFee ? ` · service fee ${fmtSats(e.serviceFee)}` : '')],
      ['Network', e.network === 'test' ? 'BSV testnet' : 'BSV mainnet']
    ]
    if (e.title) rows.splice(1, 0, ['Title', esc(e.title)])
    $('stampKv').innerHTML = rows.map(r => `<dt>${r[0]}</dt><dd${r[2] ? ' class="mono"' : ''}>${r[1]}</dd>`).join('')
    $('explorerLink').href = explorerUrl(e.txid, e.network)
    $('certDownload').onclick = () => Cert.download(certData(e))
    $('certPrint').onclick = () => Cert.open(certData(e))
    $('stampResult').classList.remove('hidden')
    $('stampResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  // ---------- history ----------
  function getHistory () { try { return JSON.parse(localStorage.getItem('pod.history') || '[]') } catch (e) { return [] } }
  function addHistory (e) { const h = getHistory(); h.unshift(e); localStorage.setItem('pod.history', JSON.stringify(h.slice(0, 100))); renderHistory() }
  function renderHistory () {
    const h = getHistory(); const ul = $('history')
    if (!h.length) { ul.innerHTML = '<li class="muted">No stamps yet.</li>'; return }
    ul.innerHTML = h.slice(0, 8).map((e, i) => `<li>
      <div class="h-title">${esc(e.title || e.fileName)}</div>
      <div class="h-meta">${new Date(e.stampTime).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' })}${e.network === 'test' ? ' · testnet' : ''} · ${e.txid.slice(0, 10)}…</div>
      <div class="h-links"><button class="linkish" data-cert="${i}">Certificate</button><a href="${explorerUrl(e.txid, e.network)}" target="_blank" rel="noopener">Explorer ↗</a><button class="linkish" data-verify="${i}">Verify</button></div>
    </li>`).join('')
  }

  // ---------- VERIFY ----------
  async function verify () {
    const f = state.verifyFile; const txid = $('txid').value.trim().toLowerCase()
    if (!f || !/^[0-9a-f]{64}$/.test(txid)) return
    const net = $('verifyTestnet').checked ? 'test' : 'main'
    const btn = $('verifyBtn'); const out = $('verdict')
    busy(btn, true, 'Checking the blockchain…')
    try {
      let tx
      try { tx = await fetchJSON(`${wocBase(net)}/tx/${txid}`) } catch (e) {
        if (e.status === 404) throw new Error(`Transaction not found on ${net === 'test' ? 'testnet' : 'mainnet'}. Check the ID${net === 'main' ? ', or tick "testnet transaction"' : ''}. Very new transactions can take a few seconds to appear.`)
        throw e
      }
      const r = Core.findHashInTx(tx, f.hashHex)
      const confirmed = !!tx.blocktime && (tx.confirmations || 0) > 0
      const when = confirmed ? new Date(tx.blocktime * 1000) : null
      const whenStr = when ? `${when.toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'long', timeZone: 'Europe/London' })} (UK) · ${when.toISOString()}` : 'Not yet in a block (in the mempool). Check again in ~10 minutes for the final block time.'
      const icon = r.match
        ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="M7 12.5l3.2 3.2L17 9" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="M8 8l8 8M16 8l-8 8" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>'
      let html = `<div class="verdict-big">${icon}${r.match ? 'Match — this file was stamped.' : 'No match.'}</div>`
      if (r.match) html += `<p>This exact file (SHA-256 <span class="mono">${f.hashHex.slice(0, 16)}…</span>) is recorded in this transaction${r.kind === 'proofofdesign' ? ' as a Proof of Design stamp' : ' (generic OP_RETURN hash record)'}.</p>`
      else if (r.stamp) html += `<p>This transaction holds a Proof of Design stamp for a <b>different</b> file (<span class="mono">${r.stamp.hashHex.slice(0, 16)}…</span>). Even a one-byte change, re-export or re-save produces a different fingerprint.</p>`
      else if (r.opReturns.length) html += '<p>This transaction has OP_RETURN data, but none of it matches this file\'s fingerprint.</p>'
      else html += '<p>This transaction contains no OP_RETURN data at all.</p>'
      const rows = [['Block time', esc(whenStr)], ['Block', confirmed ? `#${Number(tx.blockheight).toLocaleString('en-GB')} · ${Number(tx.confirmations).toLocaleString('en-GB')} confirmations` : '—']]
      if (r.stamp) { if (r.stamp.title) rows.push(['Title on record', esc(r.stamp.title)]); rows.push(['Stamper\'s time', esc(r.stamp.isoTime)]) }
      rows.push(['Your file', `${esc(f.name)} <span class="muted">(${fmtBytes(f.size)})</span>`])
      rows.push(['Transaction', `<a href="${explorerUrl(txid, net)}" target="_blank" rel="noopener" class="mono">${txid}</a>`])
      html += `<dl class="kv">${rows.map(r => `<dt>${r[0]}</dt><dd>${r[1]}</dd>`).join('')}</dl>`
      if (r.opReturns.length) {
        html += '<details style="margin-top:14px"><summary class="muted" style="cursor:pointer">OP_RETURN data found in this transaction</summary>' +
          r.opReturns.map(o => `<div class="pushes">output #${o.n}: ${o.pushes.map(p => p.text != null && p.text.length ? esc(JSON.stringify(p.text)) : '0x' + p.hex).join(' | ')}</div>`).join('') + '</details>'
      }
      if (r.match) html += '<div class="row-btns"><button class="primary" id="verifyCert">Download certificate</button></div>'
      out.className = 'verdict ' + (r.match ? 'match' : 'nomatch'); out.innerHTML = html
      if (r.match) {
        const e = { txid, network: net, fileName: f.name, fileSize: f.size, hashHex: f.hashHex, title: r.stamp ? r.stamp.title : '', stampTime: r.stamp ? r.stamp.isoTime : null }
        $('verifyCert').onclick = () => Cert.download(certData(e, { blockTime: when ? when.toISOString() : null, blockHeight: confirmed ? tx.blockheight : null }))
      }
    } catch (e) {
      out.className = 'verdict nomatch'; out.innerHTML = `<div class="verdict-big" style="font-size:19px">Couldn't verify</div><p>${esc(e.message)}</p>`
    } finally { busy(btn, false); updateButtons() }
  }

  // ---------- withdraw ----------
  async function withdraw () {
    const key = getKey(); if (!key) return
    const to = await modal({ title: 'Withdraw all funds', body: `Send everything on the stamping key (minus a tiny network fee) to one of your own ${state.network === 'test' ? 'testnet ' : ''}BSV addresses.`, input: 'Your BSV address (starts with 1…)', ok: 'Withdraw' })
    if (!to) return
    try { new bsv.P2PKH().lock(to) } catch (e) { notice($('keyStatus'), 'That address doesn\'t look valid.', 'error'); return }
    const btn = $('withdrawBtn'); busy(btn, true, 'Withdrawing…')
    try {
      const utxos = await withSources(await getUtxos(keyAddress(key)))
      const s = await Core.buildSweepTx({ privateKey: key, utxos, toAddress: to, satsPerKb: state.satsPerKb })
      if (!(await modal({ title: 'Confirm withdrawal', body: `Send <b>${fmtSats(s.amount)}</b> ${fiat(s.amount)} to<br><code class="addr">${esc(to)}</code>`, ok: 'Send' }))) return
      const b = await broadcast(s.tx)
      const p = getPending(); utxos.forEach(u => p.spent.push({ op: u.txid + ':' + u.vout, ts: Date.now() })); savePending(p)
      state.balance = 0; renderBalance(); renderPayMode()
      notice($('keyStatus'), `Sent. <a href="${explorerUrl(b.txid)}" target="_blank" rel="noopener">View transaction ↗</a>`, 'ok')
    } catch (e) { notice($('keyStatus'), esc(e.message), 'error') } finally { busy(btn, false) }
  }

  // ---------- BRC-100 wallet ----------
  async function connectWallet () {
    const btn = $('connectWallet'); busy(btn, true, 'Looking for a wallet…')
    try {
      const host = location.hostname && location.hostname !== '' ? location.hostname + (location.port ? ':' + location.port : '') : undefined
      const w = new bsv.WalletClient('auto', host)
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('No BRC-100 wallet answered within 10 seconds.')), 10000))
      await Promise.race([w.waitForAuthentication({}), timeout])
      const { network } = await Promise.race([w.getNetwork({}), timeout])
      const want = state.network === 'test' ? 'testnet' : 'mainnet'
      if (network !== want) throw new Error(`Your wallet is on ${network} but this page is set to ${want}. Switch one of them.`)
      state.wallet = w
      $('disconnectWallet').classList.remove('hidden'); btn.classList.add('hidden')
      notice($('walletStatus'), 'Wallet connected. Stamps will now be paid and signed by your wallet.', 'ok')
      renderPayMode()
    } catch (e) {
      notice($('walletStatus'), `Couldn't connect: ${esc(e.message || e)}<br>Make sure a BRC-100 wallet (e.g. BSV Desktop / Metanet Desktop) is installed and running, then try again. You can always use the stamping key instead.`, 'error')
    } finally { busy(btn, false) }
  }
  function disconnectWallet () {
    state.wallet = null; $('disconnectWallet').classList.add('hidden'); $('connectWallet').classList.remove('hidden')
    hide($('walletStatus')); renderPayMode()
  }

  // ---------- wire up ----------
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)))
  document.querySelectorAll('.segbtn').forEach(b => b.addEventListener('click', () => setNetwork(b.dataset.net)))
  document.addEventListener('click', ev => {
    const g = ev.target.closest('[data-goto]'); if (g) { ev.preventDefault(); showTab(g.dataset.goto) }
    const c = ev.target.closest('[data-cert]'); if (c) { const e = getHistory()[+c.dataset.cert]; if (e) Cert.download(certData(e)) }
    const v = ev.target.closest('[data-verify]'); if (v) { const e = getHistory()[+v.dataset.verify]; if (e) { $('txid').value = e.txid; $('verifyTestnet').checked = e.network === 'test'; showTab('verify'); updateButtons() } }
  })
  setupDrop('dropStamp', 'fileStamp', f => loadFile(f, 'stamp'))
  setupDrop('dropVerify', 'fileVerify', f => loadFile(f, 'verify'))
  $('clearStamp').addEventListener('click', ev => { ev.preventDefault(); clearFile('stamp') })
  $('clearVerify').addEventListener('click', ev => { ev.preventDefault(); clearFile('verify') })
  $('txid').addEventListener('input', updateButtons)
  $('stampBtn').addEventListener('click', stamp)
  $('verifyBtn').addEventListener('click', verify)
  $('createKey').addEventListener('click', createKey)
  $('importKey').addEventListener('click', importKey)
  $('backupKey').addEventListener('click', backupKey)
  $('deleteKey').addEventListener('click', deleteKey)
  $('withdrawBtn').addEventListener('click', withdraw)
  $('refreshBal').addEventListener('click', refreshBalance)
  $('copyAddr').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('address').textContent); $('copyAddr').textContent = 'Copied ✓'; setTimeout(() => { $('copyAddr').textContent = 'Copy address' }, 1500) } catch (e) {} })
  $('connectWallet').addEventListener('click', connectWallet)
  $('disconnectWallet').addEventListener('click', disconnectWallet)
  // keep the page from navigating away if a file is dropped outside the zone
  ;['dragover', 'drop'].forEach(e => window.addEventListener(e, ev => ev.preventDefault()))

  setNetwork(state.network)
  renderHistory(); renderCosts(); loadPrice()
  if (getKey()) refreshBalance()
  // test hook (used by the automated browser test only)
  window.__pod = { state, Core }
})()
