// せってい
const DEFAULT_TAX_RATE = 10; // %
const DEFAULT_ROUNDING = 'ceil'; // 'ceil' | 'round' | 'floor'

// じょうたい
let mediaStream = null;
let cart = [];
let tesseractLoaded = false;

// えらぶ
const els = {
  video: document.getElementById('video'),
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  readBtn: document.getElementById('readBtn'),
  manualBtn: document.getElementById('manualBtn'),
  status: document.getElementById('status'),
  cartList: document.getElementById('cartList'),
  subtotal: document.getElementById('subtotal'),
  tax: document.getElementById('tax'),
  total: document.getElementById('total'),
  taxRate: document.getElementById('taxRate'),
  rounding: document.getElementById('rounding'),
  clearCartBtn: document.getElementById('clearCartBtn'),
  priceDialog: document.getElementById('priceDialog'),
  priceForm: document.getElementById('priceForm'),
  priceInput: document.getElementById('priceInput'),
  qtyInput: document.getElementById('qtyInput'),
};

// 円ひょうじ
const fmtJPY = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });

// はじめる
init();

async function init(){
  els.taxRate.value = +(localStorage.getItem('taxRate') ?? DEFAULT_TAX_RATE);
  els.rounding.value = localStorage.getItem('rounding') ?? DEFAULT_ROUNDING;
  cart = JSON.parse(localStorage.getItem('cart') || '[]');
  renderCart();
  bindEvents();
  setupInstallPrompt();
}

function bindEvents(){
  els.startBtn?.addEventListener('click', startCamera);
  els.stopBtn?.addEventListener('click', stopCamera);
  els.readBtn?.addEventListener('click', readFromCamera);
  els.manualBtn?.addEventListener('click', manualAddFlow);
  els.taxRate.addEventListener('change', () => {
    localStorage.setItem('taxRate', els.taxRate.value);
    renderCart();
  });
  els.rounding.addEventListener('change', () => {
    localStorage.setItem('rounding', els.rounding.value);
    renderCart();
  });
  els.clearCartBtn.addEventListener('click', () => {
    if (confirm('かごを空にしますか？')){
      cart = [];
      persist();
      renderCart();
    }
  });
}

function persist(){
  localStorage.setItem('cart', JSON.stringify(cart));
}

function getTaxRate(){
  return Math.max(0, Number(els.taxRate.value) || 0) / 100;
}

function rounding(mode, value){
  if (mode === 'ceil') return Math.ceil(value);
  if (mode === 'floor') return Math.floor(value);
  return Math.round(value);
}

function computeTotals(){
  const mode = els.rounding.value;
  const taxRate = getTaxRate();
  let subtotal = 0;
  for (const item of cart){
    const unit = Number(item.unitPrice) || 0;
    const qty = Math.max(1, Number(item.qty) || 1);
    subtotal += unit * qty;
  }
  const tax = rounding(mode, subtotal * taxRate);
  const total = subtotal + tax;
  return { subtotal, tax, total };
}

function renderCart(){
  els.cartList.innerHTML = '';
  for (const [i, item] of cart.entries()){
    const li = document.createElement('li');
    li.className = 'cart-item';
    li.innerHTML = `
      <div class="yen">${fmtJPY.format(item.unitPrice)} × ${item.qty}</div>
      <div class="qty">
        <button class="btn qty-btn" data-action="dec">－</button>
        <button class="btn qty-btn" data-action="inc">＋</button>
      </div>
      <div><span>= ${fmtJPY.format(item.unitPrice * item.qty)}</span></div>
      <div><button class="btn warn" data-action="remove">消す</button></div>
    `;
    li.querySelector('[data-action=inc]').addEventListener('click', () => {
      cart[i].qty = Math.max(1, (cart[i].qty || 1) + 1);
      persist();
      renderCart();
    });
    li.querySelector('[data-action=dec]').addEventListener('click', () => {
      cart[i].qty = Math.max(1, (cart[i].qty || 1) - 1);
      persist();
      renderCart();
    });
    li.querySelector('[data-action=remove]').addEventListener('click', () => {
      cart.splice(i, 1);
      persist();
      renderCart();
    });
    els.cartList.appendChild(li);
  }
  const totals = computeTotals();
  els.subtotal.textContent = fmtJPY.format(totals.subtotal);
  els.tax.textContent = fmtJPY.format(totals.tax);
  els.total.textContent = fmtJPY.format(totals.total);
}

async function startCamera(){
  if (!('mediaDevices' in navigator)){
    alert('この端末はカメラに対応していません');
    return;
  }
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    els.video.srcObject = mediaStream;
    els.startBtn.disabled = true;
    els.readBtn.disabled = false;
    els.stopBtn.disabled = false;
    els.status.textContent = 'カメラをひらきました';
  } catch (e){
    console.error(e);
    alert('カメラを起動できませんでした。権限を確認してください。');
  }
}

function stopCamera(){
  els.startBtn.disabled = false;
  els.readBtn.disabled = true;
  els.stopBtn.disabled = true;
  if (mediaStream){
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }
  els.status.textContent = '停止しました';
}

async function readFromCamera(){
  if (!mediaStream){
    await startCamera();
    if (!mediaStream) return;
  }
  try {
    els.status.textContent = 'よみとり中…';
    const price = await recognizePriceFromVideo();
    if (price == null){
      alert('ねだんが見つかりませんでした。少し近づけてもう一度おためしください。');
    } else {
      const res = await openPriceDialog(price, 1);
      if (res){
        cart.push({ unitPrice: res.price, qty: res.qty });
        persist();
        renderCart();
        els.status.textContent = 'かごに入れました';
      }
    }
  } catch (e){
    console.error(e);
    alert('よみとりに失敗しました');
  }
}

async function recognizePriceFromVideo(){
  await ensureTesseract();
  const video = els.video;
  const canvas = document.createElement('canvas');
  const w = video.videoWidth || 640;
  const h = video.videoHeight || 480;
  const sx = Math.floor(w * 0.1), sy = Math.floor(h * 0.2);
  const sw = Math.floor(w * 0.8), sh = Math.floor(h * 0.6);
  canvas.width = sw; canvas.height = sh;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
  const result = await window.Tesseract.recognize(canvas, 'eng', {
    tessedit_char_whitelist: '0123456789¥￥.,円',
  });
  const text = result?.data?.text || '';
  return pickBestPrice(text);
}

function pickBestPrice(text){
  const norm = toHalfWidth(text).replace(/\s+/g, ' ');
  const candidates = [];
  const re = /(?:[¥¥]\s*([0-9][0-9,\.]*)|([0-9][0-9,\.]*)\s*円)/g;
  let m;
  while ((m = re.exec(norm))){
    let s = m[1] || m[2];
    if (!s) continue;
    s = s.replace(/[,\.]/g, '');
    const n = Number(s);
    if (!Number.isFinite(n)) continue;
    if (n <= 0 || n > 1000000) continue;
    candidates.push(n);
  }
  if (!candidates.length) return null;
  return Math.max(...candidates);
}

function toHalfWidth(s){
  return s
    .replace(/[\uFF10-\uFF19]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xFF10 + 0x30))
    .replace(/[\uFF0C]/g, ',')
    .replace(/[\uFF0E]/g, '.')
    .replace(/[\uFFE5]/g, '¥');
}

function openPriceDialog(price, qty){
  return new Promise(resolve => {
    els.priceInput.value = price != null ? String(price) : '';
    els.qtyInput.value = String(qty ?? 1);
    els.priceDialog.showModal();
    const onClose = () => {
      els.priceDialog.removeEventListener('close', onClose);
      if (els.priceDialog.returnValue === 'ok'){
        const p = Math.max(0, Number(els.priceInput.value) || 0);
        const q = Math.max(1, Number(els.qtyInput.value) || 1);
        resolve({ price: p, qty: q });
      } else {
        resolve(null);
      }
    };
    els.priceDialog.addEventListener('close', onClose);
  });
}

function manualAddFlow(){
  openPriceDialog('', 1).then(res => {
    if (!res) return;
    cart.push({ unitPrice: res.price, qty: res.qty });
    persist();
    renderCart();
    els.status.textContent = 'かごに入れました';
  });
}

function ensureTesseract(){
  if (tesseractLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@4.0.2/dist/tesseract.min.js';
    script.async = true;
    script.onload = () => { tesseractLoaded = true; resolve(); };
    script.onerror = () => reject(new Error('文字よみとりの読み込みに失敗しました'));
    document.head.appendChild(script);
  });
}

// PWA インストール
function setupInstallPrompt(){
  let deferred;
  const btn = document.getElementById('installBtn');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    btn.hidden = false;
  });
  btn.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome !== 'accepted') return;
    btn.hidden = true;
    deferred = null;
  });
}

