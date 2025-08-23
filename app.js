/***********************
 * Dune Awakening Explorer
 * app.js — ALL-IN-ONE SEARCH (no category select)
 ***********************/

// --- SAFETY NET ---
console.log('🔧 app.js loading…');
window.addEventListener('error', (e) => {
  const s = document.getElementById('status');
  if (s) s.textContent = `JS error: ${e.message}`;
  console.error('❌ Global error:', e.error || e.message);
});

// ---------------- Config ----------------
const TOP_CATEGORIES = [
  "Items", "Ammo", "Consumables", "Contract Items",
  "Garments", "Resources", "Tools", "Vehicles", "Weapons"
];
const CACHE_TTL_MS  = 24 * 60 * 60 * 1000;  // 24h
const CACHE_VERSION = 'all-v1';              // bump to invalidate old caches

// --------------- DOM refs ---------------
const itemSearch     = document.getElementById('item-search');
const suggestionsBox = document.getElementById('item-suggestions');
const loadItemBtn    = document.getElementById('load-item-btn');
const itemDetails    = document.getElementById('item-details');
const statusEl       = document.getElementById('status');

// --------------- State ------------------
let currentItems = [];   // [{title, pageid, cats: ['Weapons', ...]}]
let activeIndex  = -1;
let currentAbort = null;

// ---------- Small UI helpers ----------
function setStatus(t) { if (statusEl) statusEl.textContent = t || ''; }
function resetSearchUI() {
  itemSearch.value = '';
  suggestionsBox.innerHTML = '';
  suggestionsBox.classList.add('hidden');
  itemSearch.setAttribute('aria-expanded', 'false');
  activeIndex = -1;
  setStatus('');
}
function enableSearch(yes) {
  itemSearch.disabled = !yes;
  loadItemBtn.disabled = !yes;
}
function scoreMatch(q, title) {
  const t = title.toLowerCase(), i = t.indexOf(q);
  return i < 0 ? 9999 : (i === 0 ? 0 : 100 + i);
}
function itCmp(a, b){ return a._score - b._score || a.title.localeCompare(b.title); }

// -------- localStorage cache helpers --------
const ALL_CACHE_KEY = `awakening-category:${CACHE_VERSION}:ALL`;
function saveAllCache(items) {
  try { localStorage.setItem(ALL_CACHE_KEY, JSON.stringify({ts: Date.now(), items})); } catch {}
}
function loadAllCache() {
  try {
    const raw = localStorage.getItem(ALL_CACHE_KEY);
    if (!raw) return null;
    const blob = JSON.parse(raw);
    if (!blob || !Array.isArray(blob.items) || typeof blob.ts !== 'number') return null;
    if (Date.now() - blob.ts > CACHE_TTL_MS) return null;
    return blob.items;
  } catch { return null; }
}

/* ============================================================
   Category tree fetcher (pages + all subcategories, BFS)
   Returns: array of { title, pageid, cats: [CategoryName,...] }
   ============================================================ */
async function fetchCategoryTree(categoryValue, signal, onProgress, maxDepth = 4) {
  const start = `Category:${categoryValue}`;

  const toVisit  = [{ title: start, depth: 0 }];
  const seenCats = new Set([start]);       // category titles queued
  const pages    = new Map();              // pageid -> {title, pageid, cats:Set}

  while (toVisit.length) {
    const { title, depth } = toVisit.shift();

    let cmcontinue = null;
    do {
      const url = new URL('https://awakening.wiki/api.php');
      url.searchParams.set('action', 'query');
      url.searchParams.set('list', 'categorymembers');
      url.searchParams.set('cmtitle', title);
      url.searchParams.set('cmlimit', '500');        // bigger batch
      url.searchParams.set('cmtype', 'page|subcat'); // pages + subcats
      url.searchParams.set('format', 'json');
      url.searchParams.set('origin', '*');
      if (cmcontinue) url.searchParams.set('cmcontinue', cmcontinue);

      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const members = data.query?.categorymembers ?? [];
      const catLabel = title.replace(/^Category:/,'').replace(/_/g,' ');

      for (const m of members) {
        if (m.title.startsWith('Category:')) {
          if (depth < maxDepth && !seenCats.has(m.title)) {
            seenCats.add(m.title);
            toVisit.push({ title: m.title, depth: depth + 1 });
          }
        } else {
          let rec = pages.get(m.pageid);
          if (!rec) {
            rec = { title: m.title, pageid: m.pageid, cats: new Set() };
            pages.set(m.pageid, rec);
          }
          rec.cats.add(catLabel);
        }
      }

      cmcontinue = data.continue?.cmcontinue || null;
      if (typeof onProgress === 'function') onProgress(pages.size, seenCats.size);
    } while (cmcontinue);
  }

  // normalize sets to arrays; sort by title
  return Array.from(pages.values()).map(p => ({
    title: p.title,
    pageid: p.pageid,
    cats: Array.from(p.cats).sort()
  })).sort((a,b)=>a.title.localeCompare(b.title));
}

// Load ALL top categories into one list (sequential for clearer progress)
async function loadAllItems() {
  resetSearchUI();
  enableSearch(false);
  itemDetails.innerHTML = '';
  setStatus('Loading all items…');

  if (currentAbort) currentAbort.abort();
  currentAbort = new AbortController();

  // Try cache first
  const cached = loadAllCache();
  if (cached) {
    currentItems = cached;
    enableSearch(true);
    setStatus(`Loaded ${cached.length} items (cached)`);
    // refresh in background
    refreshAllInBackground(currentAbort.signal).catch(()=>{});
    return;
  }

  try {
    let merged = new Map(); // pageid -> record
    let total  = 0;

    for (const cat of TOP_CATEGORIES) {
      setStatus(`Loading ${cat}… (${total} items so far)`);
      const items = await fetchCategoryTree(cat.replace(/\s+/g,'_'), currentAbort.signal,
        (count) => setStatus(`Loading ${cat}… (${total + count} items)`),
        4
      );
      // merge
      for (const it of items) {
        if (!merged.has(it.pageid)) merged.set(it.pageid, { ...it });
        else {
          const rec = merged.get(it.pageid);
          const newCats = new Set([...(rec.cats||[]), ...(it.cats||[])]);
          rec.cats = Array.from(newCats).sort();
        }
      }
      total = merged.size;
      // progressively enable search after first category to improve UX
      if (total && itemSearch.disabled) enableSearch(true);
    }

    currentItems = Array.from(merged.values()).sort((a,b)=>a.title.localeCompare(b.title));
    saveAllCache(currentItems);
    setStatus(`Loaded ${currentItems.length} items`);
    enableSearch(true);
  } catch (e) {
    if (e.name === 'AbortError') { console.log('🛑 loadAllItems aborted'); return; }
    console.error('❌ Error loading all items:', e);
    setStatus('Load failed');
  }
}

async function refreshAllInBackground(signal) {
  try {
    let merged = new Map();
    for (const cat of TOP_CATEGORIES) {
      const items = await fetchCategoryTree(cat.replace(/\s+/g,'_'), signal, null, 4);
      for (const it of items) {
        if (!merged.has(it.pageid)) merged.set(it.pageid, { ...it });
        else {
          const rec = merged.get(it.pageid);
          const newCats = new Set([...(rec.cats||[]), ...(it.cats||[])]);
          rec.cats = Array.from(newCats).sort();
        }
      }
    }
    const all = Array.from(merged.values()).sort((a,b)=>a.title.localeCompare(b.title));
    saveAllCache(all);
    currentItems = all;
    setStatus(`Loaded ${currentItems.length} items (refreshed)`);
  } catch (e) {
    if (e.name !== 'AbortError') console.warn('bg refresh failed:', e);
  }
}

// ---------- Suggestions ----------
function getMatches(query) {
  const q = query.trim().toLowerCase();
  if (!q) return currentItems.slice(0, 1000);
  return currentItems
    .map(it => ({ ...it, _score: scoreMatch(q, it.title) }))
    .filter(it => it._score < 9999)
    .sort(itCmp)
    .slice(0, 1000);
}

function renderSuggestions(items) {
  suggestionsBox.innerHTML = '';
  if (!items.length) {
    suggestionsBox.classList.add('hidden');
    itemSearch.setAttribute('aria-expanded','false');
    return;
  }
  for (let i=0;i<items.length;i++) {
    const it = items[i];
    const div = document.createElement('div');
    div.className = 'suggestion';
    div.id = `sg-${i}`;
    div.role = 'option';
    div.innerHTML = `${it.title}${it.cats?.length ? ` <span class="badge">(${it.cats[0]})</span>` : ''}`;
    div.addEventListener('mousedown', (e) => { e.preventDefault(); chooseSuggestion(it); });
    suggestionsBox.appendChild(div);
  }
  activeIndex = -1;
  suggestionsBox.classList.remove('hidden');
  itemSearch.setAttribute('aria-expanded','true');
}
function hideSuggestions(){ suggestionsBox.classList.add('hidden'); itemSearch.setAttribute('aria-expanded','false'); activeIndex = -1; }
function highlight(index) {
  const kids=[...suggestionsBox.children];
  kids.forEach(c=>c.classList.remove('active'));
  if (index>=0 && index<kids.length) {
    kids[index].classList.add('active');
    itemSearch.setAttribute('aria-activedescendant', kids[index].id);
  } else itemSearch.setAttribute('aria-activedescendant','');
}
function chooseSuggestion(item){ itemSearch.value=item.title; hideSuggestions(); loadItemByPageId(item.pageid); }
function findExactByTitle(t){ const q=t.trim().toLowerCase(); return currentItems.find(i=>i.title.toLowerCase()===q)||null; }

// ---------- Events ----------
itemSearch.addEventListener('input',  () => renderSuggestions(getMatches(itemSearch.value)));
itemSearch.addEventListener('focus',  () => renderSuggestions(getMatches(itemSearch.value)));
itemSearch.addEventListener('blur',   () => setTimeout(hideSuggestions,150));
itemSearch.addEventListener('keydown',(e)=>{
  const kids=[...suggestionsBox.children];
  if (e.key==='ArrowDown'){ e.preventDefault(); if(!kids.length)return; activeIndex=(activeIndex+1)%kids.length; highlight(activeIndex); }
  else if (e.key==='ArrowUp'){ e.preventDefault(); if(!kids.length)return; activeIndex=(activeIndex-1+kids.length)%kids.length; highlight(activeIndex); }
  else if (e.key==='Enter'){
    if (!suggestionsBox.classList.contains('hidden') && activeIndex>=0){
      e.preventDefault(); const title=kids[activeIndex].textContent; const found=findExactByTitle(title); if(found) chooseSuggestion(found);
    } else { const found=findExactByTitle(itemSearch.value); if(found) chooseSuggestion(found); }
  } else if (e.key==='Escape'){ hideSuggestions(); }
});
loadItemBtn.addEventListener('click', ()=>{
  const found=findExactByTitle(itemSearch.value);
  if(found) loadItemByPageId(found.pageid);
});

// ---------- Item page render ----------
async function loadItemByPageId(pageId) {
  itemDetails.innerHTML = '';
  try {
    const metaRes = await fetch(`https://awakening.wiki/api.php?action=query&pageids=${pageId}&prop=info&inprop=url&format=json&origin=*`);
    if (!metaRes.ok) throw new Error(`HTTP ${metaRes.status}`);
    const meta = await (async r=>JSON.parse(await r.text()))(metaRes);
    const page = meta.query.pages[pageId];
    const pageTitle = page.title;
    const pageSlug  = pageTitle.replace(/ /g,'_');

    const htmlRes = await fetch(`https://corsproxy.io/?https://awakening.wiki/${pageSlug}`);
    if (!htmlRes.ok) throw new Error(`HTTP ${htmlRes.status}`);
    const htmlText = await htmlRes.text();
    const doc = new DOMParser().parseFromString(htmlText,'text/html');

    const layout = document.createElement('div'); layout.className='item-layout';

    const header = document.createElement('div'); header.className='item-header';
    header.innerHTML = `<h2>${pageTitle}</h2><div class="muted">Source: <a href="${page.fullurl}" target="_blank" rel="noopener">View on Wiki ↗</a></div>`;
    layout.appendChild(header);

    const sidebar = extractInfobox(doc, pageTitle);
    layout.appendChild(sidebar);

    const main = document.createElement('div');
    const obtainment = extractSection(doc,'Obtainment');
    const media      = extractSection(doc,'Media');
    const crafting   = extractSection(doc,'Crafting');
    const itemData   = extractSection(doc,'Item Data');

    [['Obtainment',obtainment],['Media',media],['Crafting',crafting],['Item Data',itemData]].forEach(([t,n])=>{
      const p = makePanel(t,n); if(p) main.appendChild(p);
    });

    if (!main.childNodes.length) {
      const generic = doc.querySelector('#mw-content-text')?.cloneNode(true);
      main.appendChild(makePanel('Details', generic || document.createTextNode('No details available.')));
    }

    layout.insertBefore(main, sidebar);
    itemDetails.innerHTML = '';
    itemDetails.appendChild(layout);
  } catch (e) {
    console.error('❌ Error loading item:', e);
    itemDetails.textContent = 'Failed to load full details.';
  }
}

// ---------- DOM helpers for sections/infobox ----------
function extractSection(doc, headingText) {
  const h2s = [...doc.querySelectorAll('#mw-content-text h2')];
  const h = h2s.find(n => n.textContent.trim().toLowerCase().startsWith(headingText.toLowerCase()));
  if (!h) return null;
  const frag = document.createDocumentFragment();
  let n = h.nextElementSibling;
  while (n && n.tagName !== 'H2') {
    if (!n.classList?.contains('mw-editsection')) frag.appendChild(n.cloneNode(true));
    n = n.nextElementSibling;
  }
  return frag.childNodes.length ? frag : null;
}
function makePanel(title, node) {
  if (!node) return null;
  const wrap = document.createElement('section'); wrap.className='panel';
  const h = document.createElement('h3'); h.textContent = title;
  wrap.appendChild(h); wrap.appendChild(node); return wrap;
}
function absolutizeUrls(root, base='https://awakening.wiki') {
  const fix = (u)=>!u?u: (u.startsWith('http')||u.startsWith('data:'))?u : (u.startsWith('//')?('https:'+u):(u.startsWith('/')?base+u:u));
  root.querySelectorAll('img[src]').forEach(img=>img.src = fix(img.getAttribute('src')));
  root.querySelectorAll('a[href]').forEach(a=>a.href = fix(a.getAttribute('href')));
}
function extractInfobox(doc, pageTitle) {
  const found = doc.querySelector('.infobox, .portable-infobox, .infobox-wrapper, aside.infobox');
  const box = document.createElement('aside'); box.className='infobox';
  const title = document.createElement('div'); title.className='infobox-title'; title.textContent=pageTitle; box.appendChild(title);
  if (found) {
    const cloned = found.cloneNode(true);
    const titleSel = ['.pi-title','.infobox-title','.infobox-header','h1','h2','h3','.mw-headline'];
    cloned.querySelectorAll(titleSel.join(',')).forEach(n=>{
      const t=(n.textContent||'').trim().toLowerCase(), w=(pageTitle||'').trim().toLowerCase(); if(!t||t===w) n.remove();
    });
    cloned.querySelectorAll('caption').forEach(n=>{
      const t=(n.textContent||'').trim().toLowerCase(), w=(pageTitle||'').trim().toLowerCase(); if(t===w) n.remove();
    });
    cloned.querySelectorAll('.mw-editsection, .mw-editsection-visualeditor').forEach(n=>n.remove());
    absolutizeUrls(cloned);
    box.appendChild(cloned);
    return box;
  }
  const kv = doc.querySelector('#mw-content-text table');
  if (kv) { const simple = kv.cloneNode(true); absolutizeUrls(simple); box.appendChild(simple); return box; }
  const anyImg = doc.querySelector('#mw-content-text img');
  if (anyImg){ const im=document.createElement('img'); im.className='infobox-img'; im.src=anyImg.src; im.alt=pageTitle; box.appendChild(im); }
  return box;
}

// --- INIT ---
(async function init(){
  try {
    await loadAllItems(); // enableSearch() happens progressively
  } catch (e) {
    console.error('❌ init failed:', e);
    setStatus('Init failed');
  }
})();
