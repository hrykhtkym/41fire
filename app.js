// 設定
const DEFAULT_TAX_RATE = 10; // %
const DEFAULT_ROUNDING = 'ceil'; // 'ceil' | 'round' | 'floor'

// 状態
let mediaStream = null;
let detector = null;
let scanning = false;
let scanningMode = 'none'; // 'detector' | 'zxing' | 'none'
let zxingReader = null;
let zxingLoaded = false;
let lastCodeAt = 0;
let catalog = {};
let cart = [];

// 要素参照
const els = {
  video: document.getElementById('video'),
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  manualBtn: document.getElementById('manualBtn'),
  status: document.getElementById('status'),
  cartList: document.getElementById('cartList'),
  subtotal: document.getElementById('subtotal'),
  tax: document.getElementById('tax'),
  total: document.getElementById('total'),
  taxRate: document.getElementById('taxRate'),
  rounding: document.getElementById('rounding'),
  clearCartBtn: document.getElementById('clearCartBtn'),
  discountDialog: document.getElementById('discountDialog'),
  discountForm: document.getElementById('discountForm'),
  discountType: document.getElementById('discountType'),
  discountValue: document.getElementById('discountValue'),
  discountProduct: document.getElementById('discountProduct'),
  itemInputDialog: document.getElementById('itemInputDialog'),
  itemInputForm: document.getElementById('itemInputForm'),
  itemBarcode: document.getElementById('itemBarcode'),
  itemName: document.getElementById('itemName'),
  itemPrice: document.getElementById('itemPrice'),
  exportCatalogBtn: document.getElementById('exportCatalogBtn'),
  importCatalogInput: document.getElementById('importCatalogInput'),
};

// 通貨フォーマッタ（円）
const fmtJPY = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });

// 初期化
init();

async function init(){
  // ローカル設定復元
  els.taxRate.value = +(localStorage.getItem('taxRate') ?? DEFAULT_TAX_RATE);
  els.rounding.value = localStorage.getItem('rounding') ?? DEFAULT_ROUNDING;
  cart = JSON.parse(localStorage.getItem('cart') || '[]');

  await loadCatalog();
  renderCart();
  bindEvents();
  setupInstallPrompt();

  // BarcodeDetector 準備
  if ('BarcodeDetector' in window) {
    try {
      // iOS では 'ean_13' が重要
      detector = new window.BarcodeDetector({ formats: ['ean_13', 'upc_a', 'code_128'] });
      els.status.textContent = 'BarcodeDetector 準備完了';
    } catch (e) {
      console.warn('BarcodeDetector 初期化失敗', e);
      detector = null;
      els.status.textContent = 'バーコード検出はZXing/手入力フォールバック';
    }
  } else {
    els.status.textContent = '端末未対応: ZXing フォールバックを使用します';
  }
}

function bindEvents(){
  els.startBtn.addEventListener('click', startScan);
  els.stopBtn.addEventListener('click', stopScan);
  els.manualBtn.addEventListener('click', manualAddFlow);
  els.taxRate.addEventListener('change', () => {
    localStorage.setItem('taxRate', els.taxRate.value);
    renderCart();
  });
  els.rounding.addEventListener('change', () => {
    localStorage.setItem('rounding', els.rounding.value);
    renderCart();
  });
  els.clearCartBtn.addEventListener('click', () => {
    if (confirm('カートを空にしますか？')){
      cart = [];
      persist();
      renderCart();
    }
  });
  els.exportCatalogBtn?.addEventListener('click', exportCatalog);
  els.importCatalogInput?.addEventListener('change', importCatalog);
}

async function loadCatalog(){
  try {
    const res = await fetch('./catalog.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('catalog.json 読込失敗');
    const data = await res.json();
    // localStorage にユーザ追加分がある場合はマージ
    const userCat = JSON.parse(localStorage.getItem('catalog') || '{}');
    catalog = { ...data, ...userCat };
  } catch (e) {
    console.warn('catalog.json を読み込めませんでした。空で開始します。', e);
    catalog = JSON.parse(localStorage.getItem('catalog') || '{}');
  }
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
    let line = unit * qty;
    if (item.discountType === 'percent'){
      const p = Math.max(0, Number(item.discountValue) || 0) / 100;
      line = line - rounding('round', line * p); // 端数は四捨五入で割引
    } else if (item.discountType === 'amount'){
      const a = Math.max(0, Number(item.discountValue) || 0);
      line = Math.max(0, line - a);
    }
    subtotal += line;
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
      <div class="name">${escapeHtml(item.name)}<br><small>${item.barcode}</small></div>
      <div class="yen">${fmtJPY.format(item.unitPrice)}</div>
      <div>
        <input type="number" min="1" step="1" value="${item.qty}" aria-label="数量" />
      </div>
      <div>
        <button class="btn" data-action="discount">割引</button>
      </div>
      <div>
        <button class="btn warn" data-action="remove">削除</button>
      </div>
    `;
    const qtyInput = li.querySelector('input');
    qtyInput.addEventListener('change', () => {
      const v = Math.max(1, Number(qtyInput.value) || 1);
      cart[i].qty = v;
      persist();
      renderCart();
    });
    li.querySelector('[data-action=remove]').addEventListener('click', () => {
      cart.splice(i, 1);
      persist();
      renderCart();
    });
    li.querySelector('[data-action=discount]').addEventListener('click', async () => {
      const updated = await openDiscountDialog(cart[i]);
      if (updated){
        Object.assign(cart[i], updated);
        persist();
        renderCart();
      }
    });
    els.cartList.appendChild(li);
  }
  const totals = computeTotals();
  els.subtotal.textContent = fmtJPY.format(totals.subtotal);
  els.tax.textContent = fmtJPY.format(totals.tax);
  els.total.textContent = fmtJPY.format(totals.total);
}

function escapeHtml(s){
  return String(s).replace(/[&<>"]+/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

async function startScan(){
  if (!('mediaDevices' in navigator)){
    alert('この端末はカメラに対応していません');
    return;
  }
  if (detector){
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      els.video.srcObject = mediaStream;
      scanning = true;
      scanningMode = 'detector';
      els.startBtn.disabled = true;
      els.stopBtn.disabled = false;
      els.status.textContent = 'スキャン中（Detector）… 枠に合わせてください';
      scanLoop();
      return;
    } catch (e){
      console.warn('Detector用カメラ起動失敗、ZXingに切替', e);
      // fallthrough to ZXing
    }
  }
  // ZXing フォールバック
  try {
    await startZXing();
  } catch (e){
    console.error(e);
    const useManual = confirm('スキャナを起動できませんでした。手入力に切り替えますか？');
    if (useManual) manualAddFlow();
  }
}

function stopScan(){
  scanning = false;
  els.startBtn.disabled = false;
  els.stopBtn.disabled = true;
  if (mediaStream){
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }
  if (zxingReader){
    try { zxingReader.reset(); } catch {}
  }
  scanningMode = 'none';
  els.status.textContent = '停止しました';
}

async function scanLoop(){
  if (!scanning || scanningMode !== 'detector') return;
  try {
    const barcodes = await detector.detect(els.video);
    if (barcodes && barcodes.length){
      const code = String(barcodes[0].rawValue || '').trim();
      const now = Date.now();
      if (code && now - lastCodeAt > 1200){
        lastCodeAt = now;
        onBarcode(code);
      }
    }
  } catch (e){
    // 継続
  }
  requestAnimationFrame(scanLoop);
}

async function startZXing(){
  await ensureZXingLoaded();
  if (!zxingReader) zxingReader = new window.ZXing.BrowserMultiFormatReader();
  scanning = true;
  scanningMode = 'zxing';
  els.startBtn.disabled = true;
  els.stopBtn.disabled = false;
  els.status.textContent = 'スキャン中（ZXing）… 枠に合わせてください';
  const constraints = { video: { facingMode: { ideal: 'environment' } }, audio: false };
  // decodeFromConstraints will control the video element and stream
  await zxingReader.decodeFromConstraints(constraints, els.video, (result, err) => {
    if (!scanning || scanningMode !== 'zxing') return;
    if (result) {
      const code = String(result.getText() || '').trim();
      const now = Date.now();
      if (code && now - lastCodeAt > 1200){
        lastCodeAt = now;
        onBarcode(code);
      }
    }
    // errors are frequent during scanning; ignore
  });
}

function ensureZXingLoaded(){
  if (zxingLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.20.0/umd/index.min.js';
    script.async = true;
    script.onload = () => { zxingLoaded = true; resolve(); };
    script.onerror = () => reject(new Error('ZXing の読み込みに失敗しました'));
    document.head.appendChild(script);
  });
}

async function onBarcode(code){
  els.status.textContent = `検出: ${code}`;
  const product = await ensureProduct(code);
  if (!product) return; // キャンセル
  const cartItem = {
    barcode: code,
    name: product.name,
    unitPrice: product.price,
    qty: 1,
    discountType: 'none',
    discountValue: 0,
  };
  const updated = await openDiscountDialog({ ...cartItem });
  const finalItem = updated ? { ...cartItem, ...updated } : cartItem;
  cart.push(finalItem);
  persist();
  renderCart();
}

async function ensureProduct(code){
  if (catalog[code]) return catalog[code];
  // 未登録 → 入力を促す
  const info = await openItemInputDialog(code);
  if (!info) return null;
  catalog[code] = { name: info.name, price: info.price };
  const userCat = JSON.parse(localStorage.getItem('catalog') || '{}');
  userCat[code] = catalog[code];
  localStorage.setItem('catalog', JSON.stringify(userCat));
  return catalog[code];
}

function manualAddFlow(){
  const code = prompt('バーコード（数字）を入力');
  if (!code) return;
  onBarcode(code.trim());
}

function openDiscountDialog(item){
  return new Promise(resolve => {
    els.discountProduct.textContent = `${item.name}（${fmtJPY.format(item.unitPrice)}）`;
    els.discountType.value = item.discountType || 'none';
    els.discountValue.value = item.discountValue || 0;
    els.discountDialog.showModal();
    const onClose = (ev) => {
      els.discountDialog.removeEventListener('close', onClose);
      if (els.discountDialog.returnValue === 'ok'){
        resolve({
          discountType: els.discountType.value,
          discountValue: Number(els.discountValue.value) || 0,
        });
      } else {
        resolve(null);
      }
    };
    els.discountDialog.addEventListener('close', onClose);
  });
}

function openItemInputDialog(code){
  return new Promise(resolve => {
    els.itemBarcode.textContent = `バーコード: ${code}`;
    els.itemName.value = '';
    els.itemPrice.value = '';
    els.itemInputDialog.showModal();
    const onClose = () => {
      els.itemInputDialog.removeEventListener('close', onClose);
      if (els.itemInputDialog.returnValue === 'ok'){
        const name = els.itemName.value.trim();
        const price = Math.max(0, Number(els.itemPrice.value) || 0);
        if (!name) return resolve(null);
        resolve({ name, price });
      } else {
        resolve(null);
      }
    };
    els.itemInputDialog.addEventListener('close', onClose);
  });
}

function exportCatalog(){
  const blob = new Blob([JSON.stringify(catalog, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'catalog.export.json';
  a.click();
  URL.revokeObjectURL(url);
}

async function importCatalog(ev){
  const file = ev.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (typeof data !== 'object' || Array.isArray(data)) throw new Error('形式が不正です');
    const userCat = JSON.parse(localStorage.getItem('catalog') || '{}');
    const merged = { ...userCat, ...data };
    localStorage.setItem('catalog', JSON.stringify(merged));
    catalog = { ...catalog, ...data };
    alert('カタログを取り込みました');
  } catch (e){
    alert('取り込みに失敗しました: ' + e.message);
  } finally {
    ev.target.value = '';
  }
}

// PWA インストールプロンプト
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
