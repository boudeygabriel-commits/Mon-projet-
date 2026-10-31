/* Vinted Lots Pro — outil local d'aide à l'achat-revente de lots sur Vinted.
 * Aucune connexion à Vinted : toutes les données sont saisies par l'utilisateur
 * et stockées dans le navigateur (localStorage). */
'use strict';

// ---------- Données ----------
const STORE_KEY = 'vintedLotsPro_v1';

const DEFAULT_SETTINGS = {
  urssaf: 12.3,       // micro-entreprise, vente de marchandises (% CA)
  vl: 0,              // versement libératoire optionnel (1 % pour la vente)
  protFix: 0.70,      // protection acheteur Vinted, partie fixe
  protPct: 5,         // protection acheteur Vinted, %
  pack: 0.40,         // emballage par vente
  sellFee: 0,         // frais vendeur éventuels (%)
  pess: 60, real: 85, opt: 100,
  roi: 60,            // ROI net minimal visé
  minItem: 5,         // bénéfice net min / article
  goal: 500,
  budget: 150,
  dormant: 30,
};

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      return { settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) }, lots: d.lots || [], stock: d.stock || [] };
    }
  } catch (e) { /* stockage indisponible */ }
  return { settings: { ...DEFAULT_SETTINGS }, lots: [], stock: [] };
}
let db = load();
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
  catch (e) { toast('Sauvegarde impossible dans ce navigateur — exporte en JSON.'); }
}

// ---------- Utilitaires ----------
const $ = (id) => document.getElementById(id);
const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };
const eur = (n) => (isFinite(n) ? n : 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const pct = (n) => (isFinite(n) ? Math.round(n) : 0) + ' %';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => new Date().toISOString().slice(0, 10);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const signCls = (n) => (n >= 0 ? 'pos' : 'neg');
const daysBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copié !'); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); ta.remove(); toast('Copié !');
  }
}

// ---------- Calculs de rentabilité ----------
/** Coût total d'achat pour un prix de lot donné (prix + protection acheteur + livraison). */
function buyCost(price, ship, s = db.settings) {
  if (price <= 0) return ship;
  return price + s.protFix + price * s.protPct / 100 + ship;
}

/** Calcule les 3 scénarios et le prix maximal d'un lot. */
function calcLot(lot, priceOverride) {
  const s = db.settings;
  const items = lot.items || [];
  const n = items.length;
  const price = priceOverride ?? num(lot.askPrice);
  const ship = num(lot.shipping);
  const cost = buyCost(price, ship);
  const sum = (k) => items.reduce((a, it) => a + num(it[k]), 0);
  const charges = (s.urssaf + s.vl + s.sellFee) / 100;

  const scen = (rate, key) => {
    const r = rate / 100;
    const sold = n * r;
    const revenue = sum(key) * r;
    const gross = revenue - cost - sold * s.pack;   // avant charges
    const tax = revenue * charges;
    const net = gross - tax;                         // après charges
    return { sold, revenue, gross, tax, net, roi: cost > 0 ? net / cost * 100 : 0 };
  };
  const pess = scen(s.pess, 'low');
  const real = scen(s.real, 'mid');
  const opt = scen(s.opt, 'high');

  // Prix max : coût total C tel que net réaliste >= ROI cible × C ET >= minItem × n
  const realRev = sum('mid') * s.real / 100;
  const realAvail = realRev * (1 - charges) - n * s.real / 100 * s.pack;
  const cMax = Math.min(realAvail / (1 + s.roi / 100), realAvail - s.minItem * n);
  const maxPrice = Math.max(0, (cMax - s.protFix - ship) / (1 + s.protPct / 100));

  const risky = n ? items.filter((it) => it.risky).length / n : 0;
  const days = num(lot.days) || 30;

  // Score /100
  const sMarge = clamp(real.roi / 150, 0, 1) * 30;
  const sDemande = clamp(num(lot.demand) || 3, 1, 5) / 5 * 25;
  const sRapid = clamp((90 - days) / (90 - 14), 0, 1) * 20;
  const sQual = clamp(num(lot.quality) || 3, 1, 5) / 5 * 15;
  const riskBase = pess.net >= 0 ? 1 : clamp(1 + pess.net / Math.max(cost, 1), 0, 1);
  const sRisque = riskBase * (1 - risky * 0.5) * 10;
  const score = Math.round(sMarge + sDemande + sRapid + sQual + sRisque);

  return {
    n, price, ship, cost, perItem: n ? cost / n : 0, pess, real, opt, maxPrice, risky, days,
    score, parts: { sMarge, sDemande, sRapid, sQual, sRisque },
  };
}

function verdict(c) {
  if (!c.n) return { cls: 'warn', txt: 'Ajoute les articles du lot' };
  if (c.price <= c.maxPrice && c.score >= 65) return { cls: 'good', txt: 'Bonne affaire au prix demandé' };
  if (c.maxPrice > 0 && c.price > c.maxPrice) return { cls: 'warn', txt: 'À négocier : prix demandé au-dessus du maximum' };
  if (c.maxPrice <= 0) return { cls: 'bad', txt: 'Pas rentable selon tes critères' };
  return { cls: 'warn', txt: 'Rentable mais score moyen : vérifie demande et qualité' };
}

// ---------- Navigation ----------
function showTab(name) {
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('section.tab').forEach((s) => s.classList.toggle('active', s.id === 'tab-' + name));
  const renderers = { dashboard: renderDashboard, opps: renderOpps, nego: renderNegoSelect, stock: renderStock, recherche: renderBrandChecks, reglages: renderSettings };
  renderers[name]?.();
  window.scrollTo(0, 0);
}
$('nav').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });

// Thème
(function initTheme() {
  let t = null;
  try { t = localStorage.getItem('vlp_theme'); } catch (e) { /* */ }
  if (t) document.documentElement.dataset.theme = t;
  $('themeBtn').onclick = () => {
    const cur = document.documentElement.dataset.theme
      || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('vlp_theme', next); } catch (e) { /* */ }
    renderDashboard();
  };
})();

// ---------- Analyse d'un lot ----------
let editingId = null;
let items = [];

function blankItem(from) {
  return from ? { ...from } : { brand: '', type: '', size: '', low: '', mid: '', high: '', risky: false };
}
function renderItems() {
  $('itemsBody').innerHTML = items.map((it, i) => `
    <tr data-i="${i}">
      <td><input data-k="brand" value="${esc(it.brand)}" list="brandList" style="min-width:90px"></td>
      <td><input data-k="type" value="${esc(it.type)}" style="min-width:90px"></td>
      <td><input data-k="size" value="${esc(it.size)}" style="width:70px"></td>
      <td><input data-k="low" type="number" step="0.5" value="${esc(it.low)}" style="width:70px"></td>
      <td><input data-k="mid" type="number" step="0.5" value="${esc(it.mid)}" style="width:70px"></td>
      <td><input data-k="high" type="number" step="0.5" value="${esc(it.high)}" style="width:70px"></td>
      <td><input data-k="risky" type="checkbox" ${it.risky ? 'checked' : ''}></td>
      <td><button class="btn small danger" data-del="${i}" title="Supprimer">✕</button></td>
    </tr>`).join('');
  renderAnalysis();
}
$('itemsBody').addEventListener('input', (e) => {
  const tr = e.target.closest('tr'); const k = e.target.dataset.k;
  if (!tr || !k) return;
  items[+tr.dataset.i][k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  renderAnalysis();
});
$('itemsBody').addEventListener('click', (e) => {
  const d = e.target.dataset.del; if (d === undefined) return;
  items.splice(+d, 1); renderItems();
});
$('addItem').onclick = () => { items.push(blankItem()); renderItems(); };
$('bulkAdd').onclick = () => {
  const n = clamp(Math.round(num($('bulkN').value)), 1, 30);
  const last = items[items.length - 1] || blankItem();
  for (let i = 0; i < n; i++) items.push(blankItem(last));
  renderItems();
};
['lTitle', 'lUrl', 'lSeller', 'lAsk', 'lShip', 'lDays', 'lDemand', 'lQuality', 'lNotes'].forEach((id) => $(id).addEventListener('input', renderAnalysis));

function formLot() {
  return {
    title: $('lTitle').value.trim(), url: $('lUrl').value.trim(), seller: $('lSeller').value.trim(),
    askPrice: num($('lAsk').value), shipping: num($('lShip').value), days: num($('lDays').value),
    demand: num($('lDemand').value), quality: num($('lQuality').value), notes: $('lNotes').value,
    items: items.map((it) => ({ ...it, low: num(it.low), mid: num(it.mid), high: num(it.high) })),
  };
}

function scenarioTable(c) {
  const row = (label, k) => `<tr><td>${label}</td>${['pess', 'real', 'opt'].map((s) => {
    const v = c[s][k];
    return `<td class="num ${k === 'net' || k === 'gross' ? signCls(v) : ''}">${k === 'roi' ? pct(v) : k === 'sold' ? v.toFixed(1) : eur(v)}</td>`;
  }).join('')}</tr>`;
  const s = db.settings;
  return `<div class="table-wrap"><table>
    <thead><tr><th></th><th class="num">Pessimiste<br><small>${s.pess} % vendus, prix bas</small></th><th class="num">Réaliste<br><small>${s.real} % vendus, prix moyen</small></th><th class="num">Optimiste<br><small>${s.opt} % vendus, prix haut</small></th></tr></thead>
    <tbody>
      ${row('Articles vendus', 'sold')}
      ${row("Chiffre d'affaires", 'revenue')}
      ${row('Bénéfice avant charges', 'gross')}
      ${row('Charges (URSSAF, impôt, frais)', 'tax')}
      ${row('Bénéfice net après charges', 'net')}
      ${row('Retour sur investissement', 'roi')}
    </tbody></table></div>`;
}

function renderAnalysis() {
  const lot = formLot();
  const c = calcLot(lot);
  const v = verdict(c);
  const p = c.parts;
  $('analysisOut').innerHTML = `
    <div class="tiles">
      <div class="tile"><div class="label">Score</div><div class="value score">${c.score}/100</div><div class="sub"><span class="badge ${v.cls}">${esc(v.txt)}</span></div></div>
      <div class="tile"><div class="label">Coût total d'achat</div><div class="value">${eur(c.cost)}</div><div class="sub">prix + protection + livraison</div></div>
      <div class="tile"><div class="label">Coût par article</div><div class="value">${eur(c.perItem)}</div><div class="sub">${c.n} article(s)</div></div>
      <div class="tile"><div class="label">Prix max à payer</div><div class="value">${eur(c.maxPrice)}</div><div class="sub">ROI ≥ ${db.settings.roi} % et ≥ ${eur(db.settings.minItem)}/article</div></div>
      <div class="tile"><div class="label">Net réaliste</div><div class="value ${signCls(c.real.net)}">${eur(c.real.net)}</div><div class="sub">ROI ${pct(c.real.roi)} · ~${c.days} j</div></div>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Scénarios</h3>
      ${scenarioTable(c)}
      <h3>Détail du score</h3>
      <div class="table-wrap"><table><tbody>
        <tr><td>Marge potentielle</td><td class="num">${p.sMarge.toFixed(1)} / 30</td></tr>
        <tr><td>Demande marques et tailles</td><td class="num">${p.sDemande.toFixed(1)} / 25</td></tr>
        <tr><td>Rapidité de revente</td><td class="num">${p.sRapid.toFixed(1)} / 20</td></tr>
        <tr><td>Qualité et authenticité</td><td class="num">${p.sQual.toFixed(1)} / 15</td></tr>
        <tr><td>Risque financier</td><td class="num">${p.sRisque.toFixed(1)} / 10</td></tr>
      </tbody></table></div>
      ${c.risky > 0 ? `<p class="hint" style="margin-top:10px">⚠️ ${Math.round(c.risky * 100)} % des articles sont marqués risqués : prévois de les revendre en lot ou à prix bas.</p>` : ''}
    </div>`;
}

$('saveLot').onclick = () => {
  const lot = formLot();
  if (!lot.title) { toast('Donne un titre au lot.'); return; }
  if (!lot.items.length) { toast('Ajoute au moins un article.'); return; }
  if (editingId) {
    const i = db.lots.findIndex((l) => l.id === editingId);
    if (i >= 0) db.lots[i] = { ...db.lots[i], ...lot, updatedAt: today() };
  } else {
    db.lots.push({ ...lot, id: uid(), status: 'etude', createdAt: today(), history: [] });
  }
  save(); toast('Lot enregistré.'); resetLotForm(); showTab('opps');
};
$('resetLot').onclick = resetLotForm;

function resetLotForm() {
  editingId = null;
  ['lTitle', 'lUrl', 'lSeller', 'lAsk', 'lNotes'].forEach((id) => { $(id).value = ''; });
  $('lShip').value = 5; $('lDays').value = 30; $('lDemand').value = 3; $('lQuality').value = 3;
  items = [blankItem()];
  $('saveLot').textContent = 'Enregistrer dans les opportunités';
  renderItems();
}
function editLot(id) {
  const l = db.lots.find((x) => x.id === id); if (!l) return;
  editingId = id;
  $('lTitle').value = l.title; $('lUrl').value = l.url || ''; $('lSeller').value = l.seller || '';
  $('lAsk').value = l.askPrice; $('lShip').value = l.shipping; $('lDays').value = l.days;
  $('lDemand').value = l.demand; $('lQuality').value = l.quality; $('lNotes').value = l.notes || '';
  items = l.items.map((it) => ({ ...it }));
  $('saveLot').textContent = 'Mettre à jour le lot';
  showTab('analyse'); renderItems();
}

// ---------- Opportunités ----------
const STATUS = {
  etude: { label: 'À étudier', cls: '' },
  nego: { label: 'En négociation', cls: 'warn' },
  offre: { label: 'Offre envoyée', cls: 'warn' },
  achete: { label: 'Acheté', cls: 'good' },
  abandonne: { label: 'Abandonné', cls: 'bad' },
};
const OPEN = ['etude', 'nego', 'offre'];

function renderOpps() {
  const f = $('oppFilter').value;
  const list = db.lots
    .filter((l) => f === 'all' || (f === 'open' ? OPEN.includes(l.status) : l.status === f))
    .map((l) => ({ l, c: calcLot(l) }))
    .sort((a, b) => b.c.score - a.c.score);
  if (!list.length) {
    $('oppTable').innerHTML = '<p class="hint">Aucun lot ici. Analyse un lot puis enregistre-le.</p>';
    return;
  }
  $('oppTable').innerHTML = `<table>
    <thead><tr><th>#</th><th>Lot</th><th class="num">Score</th><th class="num">Demandé</th><th class="num">Prix max</th><th class="num">Net réaliste</th><th class="num">ROI</th><th>Favori Vinted</th><th>Statut</th><th>Actions</th></tr></thead>
    <tbody>${list.map(({ l, c }, i) => {
      const url = safeUrl(l.url);
      return `<tr>
        <td>${i + 1}${i < 10 && OPEN.includes(l.status) ? ' ⭐' : ''}</td>
        <td>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(l.title)}</a>` : esc(l.title)}<br><small style="color:var(--muted)">${c.n} art. · ${esc(brandsOf(l))}${l.seller ? ' · ' + esc(l.seller) : ''}</small></td>
        <td class="num score">${c.score}</td>
        <td class="num">${eur(c.price)}</td>
        <td class="num ${c.price <= c.maxPrice ? 'pos' : 'neg'}">${eur(c.maxPrice)}</td>
        <td class="num ${signCls(c.real.net)}">${eur(c.real.net)}</td>
        <td class="num">${pct(c.real.roi)}</td>
        <td>${favCell(l, c)}</td>
        <td><select data-status="${l.id}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${l.status === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></td>
        <td style="white-space:nowrap">
          <button class="btn small" data-edit="${l.id}">Modifier</button>
          <button class="btn small" data-nego="${l.id}">Négocier</button>
          ${l.status !== 'achete' ? `<button class="btn small" data-buy="${l.id}">Acheté</button>` : ''}
          <button class="btn small danger" data-rm="${l.id}">✕</button>
        </td></tr>`;
    }).join('')}</tbody></table>`;
}
function brandsOf(l) {
  const b = [...new Set((l.items || []).map((it) => (it.brand || '').trim()).filter(Boolean))];
  return b.slice(0, 3).join(', ') + (b.length > 3 ? '…' : '');
}
$('oppFilter').onchange = renderOpps;
$('oppTable').addEventListener('change', (e) => {
  if (e.target.dataset.fav) {
    const lf = db.lots.find((x) => x.id === e.target.dataset.fav);
    if (lf) { lf.vintedFav = e.target.checked; save(); }
    return;
  }
  const id = e.target.dataset.status; if (!id) return;
  const l = db.lots.find((x) => x.id === id);
  if (e.target.value === 'achete' && l.status !== 'achete') { e.target.value = l.status; markBought(id); return; }
  l.status = e.target.value; save(); renderOpps();
});
$('oppTable').addEventListener('click', (e) => {
  const d = e.target.dataset;
  if (d.edit) editLot(d.edit);
  if (d.nego) { showTab('nego'); $('negoLot').value = d.nego; renderNego(); }
  if (d.buy) markBought(d.buy);
  if (d.rm && confirm('Supprimer ce lot des opportunités ?')) { db.lots = db.lots.filter((l) => l.id !== d.rm); save(); renderOpps(); }
});
$('dedupe').onclick = () => {
  const seen = new Map(); const dups = [];
  db.lots.forEach((l) => {
    const key = (l.url || '').split('?')[0].toLowerCase() || (l.title + '|' + l.seller).toLowerCase();
    if (seen.has(key)) dups.push(l); else seen.set(key, l);
  });
  if (!dups.length) { toast('Aucun doublon trouvé.'); return; }
  if (confirm(`${dups.length} doublon(s) trouvé(s) :\n${dups.map((d) => '• ' + d.title).join('\n')}\n\nLes supprimer ?`)) {
    const ids = new Set(dups.map((d) => d.id));
    db.lots = db.lots.filter((l) => !ids.has(l.id)); save(); renderOpps();
  }
};

/** Passe un lot en « acheté » et ventile son coût réel sur chaque article du stock. */
function markBought(id) {
  const l = db.lots.find((x) => x.id === id); if (!l) return;
  const input = prompt(`Prix réellement payé pour le lot (hors protection et livraison) ?\nDemandé : ${eur(l.askPrice)}`, l.askPrice);
  if (input === null) return;
  const paid = num(input);
  const date = today();
  const total = buyCost(paid, num(l.shipping));
  const mids = l.items.map((it) => num(it.mid));
  const sumMid = mids.reduce((a, b) => a + b, 0);
  l.items.forEach((it, i) => {
    const share = sumMid > 0 ? mids[i] / sumMid : 1 / l.items.length;
    db.stock.push({
      id: uid(), lotId: l.id, brand: it.brand, type: it.type, size: it.size,
      cost: +(total * share).toFixed(2), buyDate: date, listPrice: num(it.mid) || '', soldPrice: null, soldDate: null,
    });
  });
  l.status = 'achete'; l.paid = paid; l.boughtAt = date;
  save(); toast(`${l.items.length} article(s) ajouté(s) au stock.`); renderOpps();
}

// ---------- Import des lots trouvés par Claude ----------
const FAV_MIN_SCORE = 65;
/** Recommandation « mettre en favori sur Vinted » : rentable au prix demandé ou atteignable en négociant. */
function favAdvice(c) {
  if (!c.n || c.maxPrice <= 0) return { ok: false, cls: 'bad', txt: 'Non : pas rentable' };
  if (c.score < 50) return { ok: false, cls: 'bad', txt: 'Non : score trop faible' };
  if (c.price <= c.maxPrice && c.score >= FAV_MIN_SCORE) return { ok: true, cls: 'good', txt: 'Oui : rentable au prix' };
  if (c.maxPrice >= c.price * 0.7) return { ok: true, cls: 'warn', txt: 'Oui si négocié ≤ ' + eur(c.maxPrice) };
  return { ok: false, cls: 'bad', txt: 'Non : écart de prix trop grand' };
}
function favCell(l, c) {
  const a = favAdvice(c);
  return `<span class="badge ${a.cls}">${esc(a.txt)}</span><br><label style="flex-direction:row;align-items:center;gap:4px;margin-top:4px"><input type="checkbox" data-fav="${l.id}" ${l.vintedFav ? 'checked' : ''}> ajouté</label>`;
}

const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
/** Nettoie un lot venant de l'extérieur (JSON collé ou lien d'import). Accepte aussi les clés en français. */
function normalizeLot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const its = Array.isArray(raw.items ?? raw.articles) ? (raw.items ?? raw.articles).slice(0, 60) : [];
  const items = its.map((it) => {
    const mid = num(it.mid ?? it.moyen ?? it.prix ?? it.price);
    return {
      brand: str(it.brand ?? it.marque, 60), type: str(it.type ?? it.model ?? it.modele, 80), size: str(it.size ?? it.taille, 30),
      low: num(it.low ?? it.bas) || +(mid * 0.75).toFixed(2), mid, high: num(it.high ?? it.haut) || +(mid * 1.25).toFixed(2),
      risky: !!(it.risky ?? it.risque),
    };
  }).filter((it) => it.mid > 0);
  const ship = raw.shipping ?? raw.livraison;
  const lot = {
    title: str(raw.title ?? raw.titre, 150), url: safeUrl(str(raw.url ?? raw.lien, 500)), seller: str(raw.seller ?? raw.vendeur, 60),
    askPrice: num(raw.askPrice ?? raw.prix), shipping: ship === undefined || ship === null || ship === '' ? 5 : num(ship),
    days: num(raw.days ?? raw.delai) || 30, demand: clamp(num(raw.demand ?? raw.demande) || 3, 1, 5),
    quality: clamp(num(raw.quality ?? raw.qualite) || 3, 1, 5), notes: str(raw.notes, 2000), items,
  };
  if (!lot.title && items.length) lot.title = `Lot ${items.length} articles ${brandsOf(lot)}`;
  if (!lot.title || !items.length || lot.askPrice <= 0) return null;
  return lot;
}
function parseImport(text) {
  const d = JSON.parse(text);
  const arr = Array.isArray(d) ? d : Array.isArray(d.lots) ? d.lots : [d];
  return arr.slice(0, 100);
}
const urlKey = (u) => (u || '').split('?')[0].replace(/\/$/, '').toLowerCase();

let pending = [];
function previewImport(rawList) {
  pending = []; let bad = 0;
  rawList.forEach((r) => { const l = normalizeLot(r); if (l) pending.push(l); else bad++; });
  if (!pending.length) { $('importPreview').innerHTML = '<p class="hint neg" style="margin-top:10px">Aucun lot valide (il faut un prix demandé et au moins un article avec un prix de revente).</p>'; return; }
  const rows = pending.map((l, i) => ({ l, i, c: calcLot(l) })).sort((a, b) => b.c.score - a.c.score);
  $('importPreview').innerHTML = `
    <h3>${pending.length} lot(s) vérifié(s)${bad ? ` · ${bad} ignoré(s) car incomplet(s)` : ''}</h3>
    <div class="table-wrap"><table>
      <thead><tr><th></th><th>Lot</th><th class="num">Score</th><th class="num">Demandé</th><th class="num">Prix max</th><th class="num">Net réaliste</th><th>Favori Vinted ?</th></tr></thead>
      <tbody>${rows.map(({ l, i, c }) => {
        const a = favAdvice(c);
        const exists = l.url && db.lots.some((x) => urlKey(x.url) === urlKey(l.url));
        return `<tr><td><input type="checkbox" data-pi="${i}" ${a.ok ? 'checked' : ''}></td>
          <td>${l.url ? `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}</a>` : esc(l.title)}<br><small style="color:var(--muted)">${c.n} art. · ${esc(brandsOf(l))}${exists ? ' · déjà enregistré (sera mis à jour)' : ''}</small></td>
          <td class="num score">${c.score}</td><td class="num">${eur(c.price)}</td>
          <td class="num ${c.price <= c.maxPrice ? 'pos' : 'neg'}">${eur(c.maxPrice)}</td>
          <td class="num ${signCls(c.real.net)}">${eur(c.real.net)}</td>
          <td><span class="badge ${a.cls}">${esc(a.txt)}</span></td></tr>`;
      }).join('')}</tbody></table></div>
    <div class="row"><button class="btn primary" id="importSave">Ajouter les lots cochés aux opportunités</button><button class="btn" id="importCancel">Annuler</button></div>
    <h3>Verdict (à recopier pour Claude)</h3>
    <div class="out" id="importSummary">${esc(importSummary(rows))}</div>
    <div class="row"><button class="btn small" data-copy="importSummary">Copier le verdict</button></div>`;
}
/** Résumé texte que Claude (dans Chrome) peut lire pour savoir quels lots mettre en favori. */
function importSummary(rows) {
  return 'VERDICT VINTED LOTS PRO\n' + rows.map(({ l, c }) => {
    const a = favAdvice(c);
    return `- ${a.ok ? 'FAVORI OUI' : 'FAVORI NON'} | score ${c.score}/100 | demandé ${eur(c.price)} | max ${eur(c.maxPrice)} | net réaliste ${eur(c.real.net)} | ${l.title}${l.url ? ' | ' + l.url : ''}`;
  }).join('\n');
}
$('importCheck').onclick = () => {
  try { previewImport(parseImport($('importText').value)); }
  catch (e) { toast('JSON invalide : vérifie le texte collé.'); }
};
$('importPreview').addEventListener('click', (e) => {
  if (e.target.dataset.copy) { copy($(e.target.dataset.copy).textContent); return; }
  if (e.target.id === 'importCancel') { pending = []; $('importPreview').innerHTML = ''; return; }
  if (e.target.id !== 'importSave') return;
  let added = 0, updated = 0;
  document.querySelectorAll('#importPreview [data-pi]').forEach((cb) => {
    if (!cb.checked) return;
    const l = pending[+cb.dataset.pi];
    const ex = l.url ? db.lots.find((x) => urlKey(x.url) === urlKey(l.url)) : null;
    if (ex) { Object.assign(ex, l, { updatedAt: today() }); updated++; }
    else { db.lots.push({ ...l, id: uid(), status: 'etude', source: 'claude', createdAt: today(), history: [] }); added++; }
  });
  save(); pending = []; $('importText').value = ''; $('importPreview').innerHTML = '';
  toast(`${added} lot(s) ajouté(s), ${updated} mis à jour.`); renderOpps();
});
/** Lien d'import : …/#import=<JSON encodé avec encodeURIComponent, ou en base64url> */
function importFromHash() {
  const m = location.hash.match(/^#import=([\s\S]+)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  let list;
  try { list = parseImport(decodeURIComponent(m[1])); }
  catch (e) {
    try {
      const b = m[1].replace(/-/g, '+').replace(/_/g, '/');
      list = parseImport(new TextDecoder().decode(Uint8Array.from(atob(b), (ch) => ch.charCodeAt(0))));
    } catch (e2) { toast("Lien d'import invalide."); return; }
  }
  showTab('opps'); previewImport(list);
  $('importCard').scrollIntoView();
}
window.addEventListener('hashchange', importFromHash);

// ---------- Négociation ----------
function renderNegoSelect() {
  const open = db.lots.filter((l) => OPEN.includes(l.status));
  const cur = $('negoLot').value;
  $('negoLot').innerHTML = open.length
    ? open.map((l) => `<option value="${l.id}">${esc(l.title)} — ${eur(l.askPrice)}</option>`).join('')
    : '<option value="">Aucun lot ouvert</option>';
  if (open.some((l) => l.id === cur)) $('negoLot').value = cur;
  renderNego();
}
function roundOffer(v) { return Math.max(1, Math.floor(v)); }

function renderNego() {
  const l = db.lots.find((x) => x.id === $('negoLot').value);
  if (!l) { $('negoOut').innerHTML = '<p class="hint" style="margin-top:12px">Enregistre d\'abord un lot dans les opportunités.</p>'; return; }
  const c = calcLot(l);
  const ask = num(l.askPrice);
  const max = Math.min(c.maxPrice, ask);
  const open = roundOffer(Math.min(max * 0.75, ask * 0.7));
  const target = roundOffer(Math.min(max * 0.9, ask));
  const name = $('negoName').value.trim();
  const sig = name ? `\n${name}` : '';
  const hi = l.seller ? `Bonjour ${l.seller},` : 'Bonjour,';
  const n = c.n;
  const atOpen = calcLot(l, open), atTarget = calcLot(l, target), atMax = calcLot(l, max);

  const msgs = [
    { t: "Offre d'ouverture (lot complet)", m: `${hi}\n\nVotre lot de ${n} pièces m'intéresse beaucoup. Je peux vous proposer ${open} € pour l'ensemble, avec un paiement immédiat. Cela vous éviterait de vendre les pièces une par une.\n\nBonne journée !${sig}` },
    { t: 'Contre-offre (cible)', m: `${hi}\n\nMerci pour votre retour. Je peux monter à ${target} € pour le lot complet, c'est mon meilleur prix compte tenu de l'état et des frais de port. Je valide tout de suite si c'est bon pour vous.${sig}` },
    { t: 'Dernière offre (prix max)', m: `${hi}\n\nJe peux aller jusqu'à ${roundOffer(max)} € pour tout le lot, mais je ne pourrai pas aller plus haut. Si ça vous convient, je finalise dès maintenant.${sig}` },
    { t: 'Questions avant achat', m: `${hi}\n\nAvant de faire une offre, pourriez-vous m'indiquer :\n- les tailles exactes (étiquettes) et les mesures à plat ;\n- s'il y a des défauts (taches, trous, usure à l'entrejambe) ;\n- une photo des étiquettes de marque ?\n\nMerci beaucoup !${sig}` },
    { t: 'Regroupement (dressing du vendeur)', m: `${hi}\n\nPlusieurs articles de votre dressing m'intéressent. Si je prends un lot de plusieurs pièces, accepteriez-vous un prix groupé ? Je peux vous faire une proposition globale.${sig}` },
  ];

  $('negoOut').innerHTML = `
    <div class="tiles" style="margin-top:12px">
      <div class="tile"><div class="label">Prix demandé</div><div class="value">${eur(ask)}</div></div>
      <div class="tile"><div class="label">Offre d'ouverture</div><div class="value">${eur(open)}</div><div class="sub">net réaliste ${eur(atOpen.real.net)}</div></div>
      <div class="tile"><div class="label">Prix cible</div><div class="value">${eur(target)}</div><div class="sub">net réaliste ${eur(atTarget.real.net)}</div></div>
      <div class="tile"><div class="label">Ne pas dépasser</div><div class="value">${eur(max)}</div><div class="sub">net réaliste ${eur(atMax.real.net)}</div></div>
    </div>
    ${c.maxPrice <= 0 ? '<p class="hint neg">Ce lot n\'est pas rentable selon tes critères, même à un prix très bas. Mieux vaut passer.</p>' : ''}
    ${c.maxPrice >= ask ? '<p class="hint pos">Le prix demandé est déjà sous ton maximum : négocie quand même, mais ne laisse pas passer l\'affaire.</p>' : ''}
    ${msgs.map((x, i) => `<h3>${esc(x.t)}</h3><div class="out" id="msg${i}">${esc(x.m)}</div><div class="row"><button class="btn small" data-copy="msg${i}">Copier</button></div>`).join('')}
    <div class="row"><button class="btn" id="markOffer">Marquer « offre envoyée »</button></div>`;
}
$('negoLot').onchange = renderNego;
$('negoName').addEventListener('input', () => { try { localStorage.setItem('vlp_name', $('negoName').value); } catch (e) { /* */ } renderNego(); });
$('negoOut').addEventListener('click', (e) => {
  if (e.target.dataset.copy) copy($(e.target.dataset.copy).textContent);
  if (e.target.id === 'markOffer') {
    const l = db.lots.find((x) => x.id === $('negoLot').value);
    if (l) { l.status = 'offre'; save(); toast('Statut mis à jour.'); }
  }
});

// ---------- Stock & ventes ----------
function itemProfit(it) {
  const s = db.settings;
  const p = num(it.soldPrice);
  const gross = p - num(it.cost) - s.pack;
  const tax = p * (s.urssaf + s.vl + s.sellFee) / 100;
  return { revenue: p, gross, tax, net: gross - tax };
}
function renderStock() {
  const f = $('stockFilter').value;
  const list = db.stock.filter((it) => f === 'all' || (f === 'sold' ? it.soldDate : !it.soldDate))
    .sort((a, b) => (a.soldDate || a.buyDate || '').localeCompare(b.soldDate || b.buyDate || ''));
  if (!list.length) { $('stockTable').innerHTML = '<p class="hint">Rien à afficher.</p>'; return; }
  const now = today();
  $('stockTable').innerHTML = `<table>
    <thead><tr><th>Article</th><th>Taille</th><th class="num">Coût</th><th>Acheté le</th><th class="num">Prix affiché</th><th class="num">Vendu</th><th class="num">Jours</th><th class="num">Net</th><th></th></tr></thead>
    <tbody>${list.map((it) => {
      const days = daysBetween(it.buyDate || now, it.soldDate || now);
      const dormant = !it.soldDate && days >= db.settings.dormant;
      const pr = it.soldDate ? itemProfit(it) : null;
      return `<tr>
        <td>${esc(it.brand)} ${esc(it.type)}</td>
        <td>${esc(it.size)}</td>
        <td class="num">${eur(num(it.cost))}</td>
        <td>${esc(it.buyDate || '')}</td>
        <td class="num"><input type="number" step="0.5" value="${esc(it.listPrice ?? '')}" data-list="${it.id}" style="width:80px"></td>
        <td class="num">${it.soldDate ? `${eur(num(it.soldPrice))}<br><small>${esc(it.soldDate)}</small>` : '—'}</td>
        <td class="num">${days}${dormant ? ' <span class="badge warn" title="Baisse le prix de 10-15 % ou intègre-le à un lot">dormant</span>' : ''}</td>
        <td class="num ${pr ? signCls(pr.net) : ''}">${pr ? eur(pr.net) : '—'}</td>
        <td style="white-space:nowrap">${it.soldDate
          ? `<button class="btn small" data-unsell="${it.id}">Annuler vente</button>`
          : `<button class="btn small primary" data-sell="${it.id}">Vendu</button>`}
          <button class="btn small danger" data-srm="${it.id}">✕</button></td>
      </tr>`;
    }).join('')}</tbody></table>`;
}
$('stockFilter').onchange = renderStock;
$('addStock').onclick = () => {
  const brand = $('sBrand').value.trim();
  if (!brand) { toast('Indique au moins la marque.'); return; }
  db.stock.push({
    id: uid(), brand, type: $('sType').value.trim(), size: $('sSize').value.trim(),
    cost: num($('sCost').value), buyDate: $('sDate').value || today(), listPrice: num($('sList').value) || '',
    soldPrice: null, soldDate: null,
  });
  save(); ['sBrand', 'sType', 'sSize', 'sCost', 'sList'].forEach((id) => { $(id).value = ''; });
  toast('Article ajouté.'); renderStock();
};
$('stockTable').addEventListener('change', (e) => {
  const id = e.target.dataset.list; if (!id) return;
  const it = db.stock.find((x) => x.id === id); it.listPrice = num(e.target.value); save();
});
$('stockTable').addEventListener('click', (e) => {
  const d = e.target.dataset;
  const it = db.stock.find((x) => x.id === (d.sell || d.unsell || d.srm));
  if (!it) return;
  if (d.sell) {
    const p = prompt('Prix de vente final (€) ?', it.listPrice || '');
    if (p === null) return;
    const dt = prompt('Date de vente (AAAA-MM-JJ) ?', today());
    if (dt === null) return;
    it.soldPrice = num(p); it.soldDate = /^\d{4}-\d{2}-\d{2}$/.test(dt) ? dt : today();
  }
  if (d.unsell) { it.soldPrice = null; it.soldDate = null; }
  if (d.srm) { if (!confirm('Supprimer cet article ?')) return; db.stock = db.stock.filter((x) => x.id !== it.id); }
  save(); renderStock();
});

// ---------- Tableau de bord ----------
function monthKey(d) { return (d || '').slice(0, 7); }
function monthLabel(k) {
  const [y, m] = k.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
}
function phaseOf(net) {
  if (net >= 500) return 'Phase 3 — 500 à 1 000 €/mois : développe les catégories les plus rentables et la rotation.';
  if (net >= 250) return 'Phase 2 — 250 à 500 €/mois : augmente le volume et optimise les négociations.';
  return 'Phase 1 — 100 à 250 €/mois : teste les lots, identifie marques et tailles performantes, réinvestis.';
}

function renderDashboard() {
  const s = db.settings;
  const cur = monthKey(today());
  const sold = db.stock.filter((it) => it.soldDate);
  const inStock = db.stock.filter((it) => !it.soldDate);
  const month = sold.filter((it) => monthKey(it.soldDate) === cur).map(itemProfit);
  const sumK = (arr, k) => arr.reduce((a, x) => a + x[k], 0);
  const mRev = sumK(month, 'revenue'), mGross = sumK(month, 'gross'), mTax = sumK(month, 'tax'), mNet = sumK(month, 'net');
  const spent = db.stock.filter((it) => monthKey(it.buyDate) === cur).reduce((a, it) => a + num(it.cost), 0);
  const stockVal = inStock.reduce((a, it) => a + num(it.cost), 0);
  const stockPot = inStock.reduce((a, it) => a + num(it.listPrice), 0);
  const dormant = inStock.filter((it) => daysBetween(it.buyDate || today(), today()) >= s.dormant);
  const avgDays = sold.length ? sold.reduce((a, it) => a + daysBetween(it.buyDate || it.soldDate, it.soldDate), 0) / sold.length : 0;
  const openLots = db.lots.filter((l) => OPEN.includes(l.status)).map((l) => ({ l, c: calcLot(l) }));
  const potential = openLots.reduce((a, x) => a + Math.max(0, x.c.real.net), 0);

  $('dashTiles').innerHTML = `
    <div class="tile"><div class="label">CA du mois</div><div class="value">${eur(mRev)}</div><div class="sub">${month.length} vente(s)</div></div>
    <div class="tile"><div class="label">Bénéfice avant charges</div><div class="value ${signCls(mGross)}">${eur(mGross)}</div><div class="sub">ce mois</div></div>
    <div class="tile"><div class="label">Bénéfice net</div><div class="value ${signCls(mNet)}">${eur(mNet)}</div><div class="sub">après ${eur(mTax)} de charges</div></div>
    <div class="tile"><div class="label">Achats du mois</div><div class="value">${eur(spent)}</div><div class="sub">budget ${eur(s.budget)}</div></div>
    <div class="tile"><div class="label">Stock immobilisé</div><div class="value">${eur(stockVal)}</div><div class="sub">${inStock.length} art. · affiché ${eur(stockPot)}</div></div>
    <div class="tile"><div class="label">Délai moyen de vente</div><div class="value">${Math.round(avgDays)} j</div><div class="sub">${sold.length} vente(s) au total</div></div>
    <div class="tile"><div class="label">Bénéfice potentiel</div><div class="value">${eur(potential)}</div><div class="sub">${openLots.length} lot(s) ouverts (réaliste)</div></div>`;

  const ratio = s.goal > 0 ? clamp(mNet / s.goal, 0, 1) : 0;
  $('goalBox').innerHTML = `
    <div class="row" style="margin-top:0;justify-content:space-between"><span>${eur(mNet)} / ${eur(s.goal)}</span><span>${Math.round(ratio * 100)} %</span></div>
    <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="${s.goal}" aria-valuenow="${mNet.toFixed(0)}"><div style="width:${ratio * 100}%"></div></div>
    <p class="hint" style="margin-top:8px">${esc(phaseOf(mNet))}</p>`;

  // Graphique mensuel
  const months = [];
  const d0 = new Date(); d0.setDate(1);
  for (let i = 5; i >= 0; i--) {
    const d = new Date(d0.getFullYear(), d0.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const series = months.map((k) => {
    const ps = sold.filter((it) => monthKey(it.soldDate) === k).map(itemProfit);
    return { k, net: sumK(ps, 'net'), rev: sumK(ps, 'revenue'), n: ps.length };
  });
  renderChart(series);
  $('monthTable').innerHTML = `<table><thead><tr><th>Mois</th><th class="num">Ventes</th><th class="num">CA</th><th class="num">Net</th></tr></thead><tbody>
    ${series.map((x) => `<tr><td>${monthLabel(x.k)}</td><td class="num">${x.n}</td><td class="num">${eur(x.rev)}</td><td class="num ${signCls(x.net)}">${eur(x.net)}</td></tr>`).join('')}</tbody></table>`;

  // Performance par marque / taille
  $('perfBrand').innerHTML = perfTable(sold, inStock, (it) => (it.brand || '?').trim(), 'Marque');
  $('perfSize').innerHTML = perfTable(sold, inStock, (it) => (it.size || '?').trim().toUpperCase(), 'Taille');

  // Actions
  const acts = [];
  const best = openLots.filter((x) => x.l.status === 'etude').sort((a, b) => b.c.score - a.c.score).slice(0, 3);
  best.forEach(({ l, c }) => acts.push(`Négocier « ${esc(l.title)} » (score ${c.score}, max ${eur(c.maxPrice)}).`));
  const offers = openLots.filter((x) => x.l.status === 'offre');
  if (offers.length) acts.push(`${offers.length} offre(s) envoyée(s) en attente de réponse : relance après 24-48 h.`);
  if (dormant.length) acts.push(`${dormant.length} article(s) dormant(s) depuis ${s.dormant} j+ : baisse le prix de 10-15 %, republie ou regroupe-les en lot.`);
  const noPrice = inStock.filter((it) => !num(it.listPrice));
  if (noPrice.length) acts.push(`${noPrice.length} article(s) en stock sans prix affiché : mets-les en ligne (onglet Annonces).`);
  if (spent > s.budget) acts.push(`Budget d'achat dépassé ce mois (${eur(spent)} / ${eur(s.budget)}) : priorise la vente du stock.`);
  if (!db.lots.length) acts.push('Commence par l\'onglet Recherche pour trouver des lots, puis analyse-les.');
  const topBrand = bestGroup(sold, (it) => (it.brand || '').trim());
  if (topBrand) acts.push(`Ta marque la plus rentable : ${esc(topBrand)}. Cherche davantage de lots de cette marque.`);
  $('nextActions').innerHTML = acts.length ? acts.map((a) => `<li>${a}</li>`).join('') : '<li>Rien d\'urgent. Continue la recherche de lots.</li>';
}

function groupStats(sold, inStock, keyFn) {
  const g = new Map();
  const get = (k) => { if (!g.has(k)) g.set(k, { k, n: 0, net: 0, days: 0, rev: 0, stock: 0 }); return g.get(k); };
  sold.forEach((it) => {
    const x = get(keyFn(it)); const p = itemProfit(it);
    x.n++; x.net += p.net; x.rev += p.revenue; x.days += daysBetween(it.buyDate || it.soldDate, it.soldDate);
  });
  inStock.forEach((it) => { get(keyFn(it)).stock++; });
  return [...g.values()].sort((a, b) => b.net - a.net);
}
function bestGroup(sold, keyFn) {
  const s = groupStats(sold, [], keyFn).filter((x) => x.k && x.n >= 2);
  return s.length ? s[0].k : null;
}
function perfTable(sold, inStock, keyFn, label) {
  const rows = groupStats(sold, inStock, keyFn);
  if (!rows.length) return '<p class="hint">Pas encore de données : ajoute du stock et enregistre tes ventes.</p>';
  return `<table><thead><tr><th>${label}</th><th class="num">Vendus</th><th class="num">En stock</th><th class="num">Net total</th><th class="num">Net / article</th><th class="num">Jours moy.</th></tr></thead><tbody>
    ${rows.slice(0, 15).map((x) => `<tr><td>${esc(x.k)}</td><td class="num">${x.n}</td><td class="num">${x.stock}</td><td class="num ${signCls(x.net)}">${eur(x.net)}</td><td class="num">${x.n ? eur(x.net / x.n) : '—'}</td><td class="num">${x.n ? Math.round(x.days / x.n) : '—'}</td></tr>`).join('')}
  </tbody></table>`;
}

function renderChart(series) {
  const W = 600, H = 200, padL = 48, padR = 8, padT = 10, padB = 24;
  const vals = series.map((x) => x.net);
  let max = Math.max(0, ...vals), min = Math.min(0, ...vals);
  if (max === min) max = min + 100;
  const step = niceStep((max - min) / 4);
  max = Math.ceil(max / step) * step; min = Math.floor(min / step) * step;
  const y = (v) => padT + (max - v) / (max - min) * (H - padT - padB);
  const bw = (W - padL - padR) / series.length;
  const ticks = [];
  for (let v = min; v <= max + 1e-9; v += step) ticks.push(v);
  const barW = Math.min(36, bw * 0.55);
  const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Bénéfice net par mois">
    ${ticks.map((v) => `<line class="grid-line" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)} €</text>`).join('')}
    ${series.map((x, i) => {
      const cx = padL + bw * i + bw / 2;
      const top = Math.min(y(x.net), y(0)), h = Math.max(Math.abs(y(x.net) - y(0)), x.net ? 1 : 0);
      const r = Math.min(4, barW / 2, h);
      const path = x.net >= 0
        ? `M${cx - barW / 2},${top + h} V${top + r} Q${cx - barW / 2},${top} ${cx - barW / 2 + r},${top} H${cx + barW / 2 - r} Q${cx + barW / 2},${top} ${cx + barW / 2},${top + r} V${top + h} Z`
        : `M${cx - barW / 2},${top} V${top + h - r} Q${cx - barW / 2},${top + h} ${cx - barW / 2 + r},${top + h} H${cx + barW / 2 - r} Q${cx + barW / 2},${top + h} ${cx + barW / 2},${top + h - r} V${top} Z`;
      return `<rect x="${padL + bw * i}" y="${padT}" width="${bw}" height="${H - padT - padB}" fill="transparent" data-i="${i}"/>
        ${h ? `<path class="bar" d="${path}" data-i="${i}"/>` : ''}
        <text class="axis" x="${cx}" y="${H - 6}" text-anchor="middle">${monthLabel(x.k)}</text>`;
    }).join('')}
  </svg><div class="tooltip" id="chartTip"></div>`;
  const el = $('monthChart'); el.innerHTML = svg;
  const tip = $('chartTip');
  el.querySelector('svg').addEventListener('mousemove', (e) => {
    const i = e.target.dataset?.i;
    if (i === undefined) { tip.style.display = 'none'; return; }
    const x = series[+i];
    tip.innerHTML = `<b>${monthLabel(x.k)}</b><br>Net : ${eur(x.net)}<br>CA : ${eur(x.rev)} · ${x.n} vente(s)`;
    const r = el.getBoundingClientRect();
    tip.style.display = 'block';
    tip.style.left = Math.min(e.clientX - r.left + 12, r.width - 170) + 'px';
    tip.style.top = (e.clientY - r.top - 10) + 'px';
  });
  el.querySelector('svg').addEventListener('mouseleave', () => { tip.style.display = 'none'; });
}
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

// ---------- Générateur d'annonces ----------
const BRAND_TAGS = {
  "levi's": 'levis 501 vintage jean denim straight', dickies: 'dickies workwear 874 double knee skate',
  carhartt: 'carhartt wip workwear vintage', wrangler: 'wrangler vintage denim western', lee: 'lee vintage denim',
  edwin: 'edwin japan denim selvedge', 'stan ray': 'stan ray workwear fatigue painter', 'the north face': 'tnf north face outdoor gorpcore',
  patagonia: 'patagonia outdoor fleece gorpcore', columbia: 'columbia outdoor fleece vintage', 'stüssy': 'stussy streetwear skate',
  obey: 'obey streetwear', gramicci: 'gramicci climbing outdoor', napapijri: 'napapijri outdoor', 'nike acg': 'nike acg outdoor gorpcore',
  'ralph lauren': 'ralph lauren polo vintage preppy', lacoste: 'lacoste vintage preppy', 'tommy hilfiger': 'tommy hilfiger vintage 90s',
  champion: 'champion reverse weave vintage 90s', 'russell athletic': 'russell athletic vintage usa', adidas: 'adidas vintage originals 90s',
};
$('genAnnonce').onclick = () => {
  const v = (id) => $(id).value.trim();
  const brand = v('aBrand'), model = v('aModel'), fit = v('aFit'), size = v('aSize'), color = v('aColor');
  const title = [brand, model, fit, color, size].filter(Boolean).join(' ').replace(/\s+/g, ' ');
  const tags = new Set();
  const bt = BRAND_TAGS[brand.toLowerCase()] || brand.toLowerCase();
  bt.split(/\s+/).filter(Boolean).forEach((t) => tags.add('#' + t.replace(/[^a-z0-9éèàù]/gi, '')));
  [fit, v('aEra')].join(' ').toLowerCase().split(/[\s,]+/).filter((t) => t.length > 2).forEach((t) => tags.add('#' + t.replace(/[^a-z0-9éèàù]/gi, '')));
  const lines = [
    `${title}`,
    '\n',
    `✔️ Marque : ${brand || '—'}`,
    model && `✔️ Modèle : ${model}`,
    fit && `✔️ Coupe : ${fit}`,
    size && `✔️ Taille : ${size} (voir mesures)`,
    color && `✔️ Couleur : ${color}`,
    v('aMat') && `✔️ Matière : ${v('aMat')}`,
    v('aEra') && `✔️ Époque / origine : ${v('aEra')}`,
    `✔️ État : ${v('aCond')}${v('aDefects') ? ' — ' + v('aDefects') : ''}`,
    '\n',
    v('aMeas') && `📏 Mesures à plat : ${v('aMeas')}`,
    '📦 Envoi rapide et soigné sous 24-48 h.',
    '💬 Remise sur les lots : n\'hésitez pas à regarder mon dressing.',
    '\n',
    [...tags].filter((t) => t.length > 2).slice(0, 10).join(' '),
  ].filter((x) => typeof x === 'string' && x !== '');
  // retire les doubles lignes vides
  const desc = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  $('annonceOut').innerHTML = `
    <h3>Titre</h3><div class="out" id="annTitle">${esc(title)}</div>
    <div class="row"><button class="btn small" data-copy="annTitle">Copier le titre</button></div>
    <h3>Description</h3><div class="out" id="annDesc">${esc(desc)}</div>
    <div class="row"><button class="btn small" data-copy="annDesc">Copier la description</button></div>
    <p class="hint" style="margin-top:10px">Conseils : photo de face, de dos, étiquette, défauts et mesures ; lumière naturelle ; fond neutre. Le titre commence par la marque et le modèle, comme le tapent les acheteurs.</p>`;
};
$('annonceOut').addEventListener('click', (e) => { if (e.target.dataset.copy) copy($(e.target.dataset.copy).textContent); });

// ---------- Recherche ----------
const BRANDS = [
  { name: "Levi's", q: ['levis 501', 'levis 505', 'levis 550', 'levis 560', 'levis 569'], typos: ['levi strauss', 'levi 501', 'leviss', 'levis vintage'] },
  { name: 'Dickies', q: ['dickies 874', 'dickies 873', 'dickies double knee'], typos: ['dickie', 'dikies', 'dickies workwear'] },
  { name: 'Carhartt', q: ['carhartt', 'carhartt wip', 'carhartt double knee'], typos: ['carhart', 'carharrt', 'carhatt', 'carthartt'] },
  { name: 'Wrangler', q: ['wrangler vintage'], typos: ['wrangle', 'wranger'] },
  { name: 'Lee', q: ['lee vintage jean'], typos: ['lee cooper vintage', 'lee riders'] },
  { name: 'Edwin', q: ['edwin jean'], typos: ['edwin japan'] },
  { name: 'Stan Ray', q: ['stan ray'], typos: ['stanray', 'stan rey'] },
  { name: 'The North Face', q: ['the north face', 'north face polaire'], typos: ['northface', 'nort face', 'tnf'] },
  { name: 'Patagonia', q: ['patagonia', 'patagonia polaire'], typos: ['patagonie', 'patagona', 'patagonia synchilla'] },
  { name: 'Columbia', q: ['columbia polaire', 'columbia vintage'], typos: ['colombia polaire', 'columbia sportswear'] },
  { name: 'Stüssy', q: ['stussy'], typos: ['stusy', 'stüssy', 'stussi'] },
  { name: 'Obey', q: ['obey'], typos: ['obey propaganda'] },
  { name: 'Gramicci', q: ['gramicci'], typos: ['gramici', 'gramicci pants'] },
  { name: 'Napapijri', q: ['napapijri'], typos: ['napapjiri', 'napapiri', 'napajiri'] },
  { name: 'Nike ACG', q: ['nike acg'], typos: ['acg nike', 'nike all conditions'] },
  { name: 'Ralph Lauren', q: ['ralph lauren pull', 'ralph lauren sweat'], typos: ['ralf lauren', 'polo ralph', 'ralph loren'] },
  { name: 'Lacoste', q: ['lacoste pull', 'lacoste sweat'], typos: ['lacost', 'lacoste vintage'] },
  { name: 'Tommy Hilfiger', q: ['tommy hilfiger vintage'], typos: ['tommy hilfinger', 'tomy hilfiger', 'hilfiger'] },
  { name: 'Champion', q: ['champion vintage', 'champion reverse weave'], typos: ['champion usa', 'champions sweat'] },
  { name: 'Russell Athletic', q: ['russell athletic'], typos: ['russel athletic', 'russell sweat'] },
  { name: 'Adidas', q: ['adidas vintage'], typos: ['addidas', 'adiddas', 'adidas 90s'] },
];
let checked = null;
function renderBrandChecks() {
  if (!checked) {
    try { checked = new Set(JSON.parse(localStorage.getItem('vlp_brands') || 'null') || ["Levi's", 'Carhartt', 'Dickies']); }
    catch (e) { checked = new Set(["Levi's", 'Carhartt', 'Dickies']); }
  }
  $('brandChecks').innerHTML = BRANDS.map((b) => `<label style="flex-direction:row;align-items:center;gap:6px;color:var(--text)"><input type="checkbox" value="${esc(b.name)}" ${checked.has(b.name) ? 'checked' : ''}> ${esc(b.name)}</label>`).join('');
}
$('brandChecks').addEventListener('change', (e) => {
  if (e.target.checked) checked.add(e.target.value); else checked.delete(e.target.value);
  try { localStorage.setItem('vlp_brands', JSON.stringify([...checked])); } catch (err) { /* */ }
});
function vintedUrl(text, maxPrice) {
  const p = new URLSearchParams({ search_text: text, order: 'newest_first' });
  if (maxPrice > 0) { p.set('price_to', String(maxPrice)); p.set('currency', 'EUR'); }
  return 'https://www.vinted.fr/catalog?' + p.toString();
}
$('genSearch').onclick = () => {
  const kws = $('rLotKw').value.split('|');
  const size = $('rSize').value.trim();
  const max = num($('rMax').value);
  const typos = $('rTypos').checked;
  const sel = BRANDS.filter((b) => checked.has(b.name));
  if (!sel.length) { toast('Coche au moins une marque.'); return; }
  const blocks = sel.map((b) => {
    const queries = [...b.q, ...(typos ? b.typos : [])];
    const urls = [];
    queries.forEach((q) => kws.forEach((k) => {
      const text = [k, q, size].filter(Boolean).join(' ');
      urls.push({ text, url: vintedUrl(text, max), typo: b.typos.includes(q) });
    }));
    return `<h3>${esc(b.name)}</h3><ul class="actions">${urls.map((u) => `<li><a href="${esc(u.url)}" target="_blank" rel="noopener">${esc(u.text)}</a>${u.typo ? ' <span class="badge">orthographe alternative</span>' : ''}</li>`).join('')}</ul>`;
  });
  $('searchOut').innerHTML = `<p class="hint" style="margin-top:12px">Astuce : ouvre les liens plusieurs fois par jour — les lots sous-évalués partent vite. Vérifie toujours les prix des articles <b>vendus</b> avant d'acheter.</p>${blocks.join('')}`;
};

// ---------- Réglages & sauvegarde ----------
const CFG = { cfgUrssaf: 'urssaf', cfgVl: 'vl', cfgProtFix: 'protFix', cfgProtPct: 'protPct', cfgPack: 'pack', cfgSellFee: 'sellFee', cfgPess: 'pess', cfgReal: 'real', cfgOpt: 'opt', cfgRoi: 'roi', cfgMinItem: 'minItem', cfgGoal: 'goal', cfgBudget: 'budget', cfgDormant: 'dormant' };
function renderSettings() { Object.entries(CFG).forEach(([id, k]) => { $(id).value = db.settings[k]; }); }
$('saveCfg').onclick = () => {
  Object.entries(CFG).forEach(([id, k]) => { db.settings[k] = num($(id).value); });
  save(); toast('Réglages enregistrés.');
};
function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('exportJson').onclick = () => download(`vinted-lots-pro-${today()}.json`, JSON.stringify(db, null, 2), 'application/json');
$('importJson').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!Array.isArray(d.lots) || !Array.isArray(d.stock)) throw new Error('format');
    if (!confirm('Remplacer toutes les données actuelles par ce fichier ?')) return;
    db = { settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) }, lots: d.lots, stock: d.stock };
    save(); toast('Import réussi.'); renderSettings();
  } catch (err) { toast('Fichier invalide.'); }
  e.target.value = '';
};
$('exportCsv').onclick = () => {
  const head = ['marque', 'type', 'taille', 'cout', 'date_achat', 'prix_affiche', 'prix_vente', 'date_vente', 'jours', 'benefice_avant_charges', 'charges', 'benefice_net'];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = db.stock.map((it) => {
    const p = it.soldDate ? itemProfit(it) : null;
    return [it.brand, it.type, it.size, num(it.cost).toFixed(2), it.buyDate, it.listPrice, it.soldDate ? num(it.soldPrice).toFixed(2) : '', it.soldDate || '',
      it.soldDate ? daysBetween(it.buyDate || it.soldDate, it.soldDate) : '', p ? p.gross.toFixed(2) : '', p ? p.tax.toFixed(2) : '', p ? p.net.toFixed(2) : ''].map(q).join(';');
  });
  download(`stock-ventes-${today()}.csv`, '﻿' + [head.join(';'), ...rows].join('\n'), 'text/csv');
};
$('resetAll').onclick = () => {
  if (!confirm('Effacer TOUTES les données (lots, stock, ventes) ? Pense à exporter avant.')) return;
  db = { settings: { ...DEFAULT_SETTINGS }, lots: [], stock: [] }; save(); toast('Données effacées.'); renderDashboard();
};

// ---------- Démarrage ----------
(function init() {
  const dl = document.createElement('datalist'); dl.id = 'brandList';
  dl.innerHTML = BRANDS.map((b) => `<option value="${esc(b.name)}">`).join('');
  document.body.appendChild(dl);
  try { $('negoName').value = localStorage.getItem('vlp_name') || ''; } catch (e) { /* */ }
  $('sDate').value = today();
  resetLotForm();
  renderDashboard();
  importFromHash();
})();

// Exposé pour les tests
window.VLP = { calcLot, normalizeLot, favAdvice, buyCost, itemProfit, get db() { return db; } };
