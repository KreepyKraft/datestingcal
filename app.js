/***********************
 * Dune Awakening Explorer
 * app.js — FAST SEARCH (prefixsearch) + background full cache
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
const CACHE_TTL_MS  = 24 * 60 * 60 * 1000;   // 24h
const CACHE_VERSION = 'all-fast-v1';         // bump to invalidate old caches
const PREFIX_MIN    = 2;                     // start prefixsearch at 2 chars
const PREFIX_LIMIT  = 30;                    // how many remote suggestions
const LOCAL_LIMIT   = 1000;                  // how many local items to show

// --------------- DOM refs ---------------
const itemSearch     = document.getElementById('item-search');
const suggestionsBox = document.getElementById('item-suggestions');
const loadItemBtn    = document.getElementById('load-item-btn');
const itemDetails    = document.getElementById('item-details');
const statusEl       = document.getElementById('status');

// --------------- State ------------------
let currentItems = [];   // full local cache: [{title, pageid, cats:[...]}]
let cacheReady   = false;
let activeIndex  = -1;
let lastPrefixReq = 0;

// ---------- Small UI helpers ----------
function setStatus(t) { if (statusEl) statusEl.textContent = t || ''; }
function enableSearch(yes) {
  itemSearch.disabled = !yes;
  loadItemBtn.disabled = !yes;
}
function scoreMatch(q, title) {
  const t = title.toLowerCase(), i = t.indexOf(q);
  return i < 0 ? 9999 : (i === 0 ? 0 : 100 + i);
}
function itCmp(a, b){ return a._score - b._score || a.title.localeCompare(b.title); }

// Clear search + close dropdown (called after any search)
function clearSearchBar() {
  itemSearch.value = '';
  itemSearch.setAttribute('aria-expanded', 'false');
  hideSuggestions();
  // optional: itemSearch.blur();
}

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
  const seenCats = new Set([start]);
  const pages    = new Map(); // pageid -> {title, pageid, cats:Set}

  while (toVisit.length) {
    const { title, depth } = toVisit.shift();

    let cmcontinue = null;
    do {
      const url = new URL('https://awakening.wiki/api.php');
      url.searchParams.set('action', 'query');
      url.searchParams.set('list', 'categorymembers');
      url.searchParams.set('cmtitle', title);
      url.searchParams.set('cmlimit', '500');        // larger batch
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

  return Array.from(pages.values()).map(p => ({
    title: p.title,
    pageid: p.pageid,
    cats: Array.from(p.cats).sort()
  })).sort((a,b)=>a.title.localeCompare(b.title));
}

// Load ALL top categories (parallel with limited concurrency) → background
async function warmAllItems(signal) {
  const inCache = loadAllCache();
  if (inCache) {
    currentItems = inCache;
    cacheReady = true;
    setStatus(`Loaded ${currentItems.length} items (cached)`);
    enableSearch(true);
  } else {
    setStatus('Warming item list…');
  }

  // limit concurrency to be nice to the wiki
  const queue = [...TOP_CATEGORIES];
  const workers = 3;
  const merged = new Map(inCache ? inCache.map(r => [r.pageid, r]) : []);

  async function worker() {
    while (queue.length) {
      const cat = queue.shift();
      const items = await fetchCategoryTree(cat.replace(/\s+/g,'_'), signal, null, 4);
      for (const it of items) {
        if (!merged.has(it.pageid)) merged.set(it.pageid, { ...it });
        else {
          const rec = merged.get(it.pageid);
          const set = new Set([...(rec.cats||[]), ...(it.cats||[])]);
          rec.cats = Array.from(set).sort();
        }
      }
      setStatus(`Warming… ${merged.size} items`);
    }
  }

  await Promise.all(Array.from({length: workers}, worker));

  const all = Array.from(merged.values()).sort((a,b)=>a.title.localeCompare(b.title));
  saveAllCache(all);
  currentItems = all;
  cacheReady = true;
  enableSearch(true);
  setStatus(`Loaded ${currentItems.length} items`);
}

// ---------- Prefix search (ultra-fast suggestions from server) ----------
async function fetchPrefixSuggestions(q, limit = PREFIX_LIMIT) {
  const token = ++lastPrefixReq;

  const url = new URL('https://awakening.wiki/api.php');
  url.searchParams.set('action','query');
  url.searchParams.set('list','prefixsearch');
  url.searchParams.set('pssearch', q);
  url.searchParams.set('pslimit', String(limit));
  url.searchParams.set('psnamespace', '0'); // articles only
  url.searchParams.set('format','json');
  url.searchParams.set('origin','*');

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (token !== lastPrefixReq) return []; // newer request already in flight

  const arr = (data.query?.prefixsearch || []).map(ps => ({
    title: ps.title,
    pageid: ps.pageid || ps.pspageid || ps.pageid,
    cats: [] // unknown from prefixsearch
  }));
  return arr;
}

// ---------- Suggestions (union: remote prefix + local cache) ----------
function getLocalMatches(query) {
  const q = query.trim().toLowerCase();
  if (!q || !cacheReady) return [];
  return currentItems
    .map(it => ({ ...it, _score: scoreMatch(q, it.title) }))
    .filter(it => it._score < 9999)
    .sort(itCmp)
    .slice(0, LOCAL_LIMIT);
}
function deDupeById(list) {
  const seen = new Set();
  const out = [];
  for (const it of list) {
    const id = it.pageid || it.title;
    if (!seen.has(id)) { seen.add(id); out.push(it); }
  }
  return out;
}
async function getMixedSuggestions(query) {
  const q = query.trim();
  if (!q) return cacheReady ? currentItems.slice(0, 1000) : [];
  const wantsRemote = q.length >= PREFIX_MIN;
  const [remote, local] = await Promise.all([
    wantsRemote ? fetchPrefixSuggestions(q) : Promise.resolve([]),
    Promise.resolve(getLocalMatches(q))
  ]);
  return deDupeById([...remote, ...local]).slice(0, 1000);
}

// ---------- Render suggestions ----------
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
    const badge = it.cats?.length ? ` <span class="badge">(${it.cats[0]})</span>` : '';
    div.innerHTML = `${it.title}${badge}`;
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

// ✅ Clear first, then load (prevents the field from showing the chosen title)
function chooseSuggestion(item){
  clearSearchBar();                 // <— auto‑clear
  loadItemByIdOrTitle(item);
}

function findExactByTitle(t){ const q=t.trim().toLowerCase(); return currentItems.find(i=>i.title.toLowerCase()===q)||null; }

// ---------- Events ----------
const debounce = (fn, ms) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };
const onSearchInput = debounce(async () => {
  const q = itemSearch.value;
  try {
    const items = await getMixedSuggestions(q);
    renderSuggestions(items);
  } catch(e) {
    console.warn('suggestions failed:', e);
  }
}, 150);

itemSearch.addEventListener('input', onSearchInput);
itemSearch.addEventListener('focus', onSearchInput);
itemSearch.addEventListener('blur',   () => setTimeout(hideSuggestions,150));
itemSearch.addEventListener('keydown',(e)=>{
  const kids=[...suggestionsBox.children];
  if (e.key==='ArrowDown'){ e.preventDefault(); if(!kids.length)return; activeIndex=(activeIndex+1)%kids.length; highlight(activeIndex); }
  else if (e.key==='ArrowUp'){ e.preventDefault(); if(!kids.length)return; activeIndex=(activeIndex-1+kids.length)%kids.length; highlight(activeIndex); }
  else if (e.key==='Enter'){
    if (!suggestionsBox.classList.contains('hidden') && activeIndex>=0){
      e.preventDefault();
      kids[activeIndex].dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
      // chooseSuggestion() will clear
    } else {
      const found = findExactByTitle(itemSearch.value);
      if (found) {
        chooseSuggestion(found);   // chooseSuggestion clears
      } else if (itemSearch.value.trim()) {
        loadItemByIdOrTitle({ title: itemSearch.value.trim() });
        clearSearchBar();          // <— free‑text enter clears here
      }
    }
  } else if (e.key==='Escape'){ hideSuggestions(); }
});

loadItemBtn.addEventListener('click', ()=>{
  const found = findExactByTitle(itemSearch.value);
  if (found) {
    loadItemByIdOrTitle(found);
  } else if (itemSearch.value.trim()) {
    loadItemByIdOrTitle({ title:itemSearch.value.trim() });
  }
  clearSearchBar();                // <— always clear after clicking Load
});

// ---------- Load + render item page ----------
async function loadItemByIdOrTitle(rec) {
  itemDetails.innerHTML = '';
  try {
    let pageId = rec.pageid;
    let pageTitle = rec.title;

    // Resolve by title if needed
    if (!pageId) {
      const metaByTitle = new URL('https://awakening.wiki/api.php');
      metaByTitle.searchParams.set('action','query');
      metaByTitle.searchParams.set('prop','info');
      metaByTitle.searchParams.set('inprop','url');
      metaByTitle.searchParams.set('redirects','1');
      metaByTitle.searchParams.set('titles', pageTitle);
      metaByTitle.searchParams.set('format','json');
      metaByTitle.searchParams.set('origin','*');
      const res = await fetch(metaByTitle);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const page = Object.values(data.query.pages)[0];
      pageId = page.pageid;
      pageTitle = page.title;
      rec.pageid = pageId;
      rec.title  = pageTitle;
    }

    // Metadata (ensures fullurl for header)
    const metaRes = await fetch(`https://awakening.wiki/api.php?action=query&pageids=${pageId}&prop=info&inprop=url&format=json&origin=*`);
    if (!metaRes.ok) throw new Error(`HTTP ${metaRes.status}`);
    const meta = await (async r=>JSON.parse(await r.text()))(metaRes);
    const page = meta.query.pages[pageId];
    const title = page.title;
    const slug  = title.replace(/ /g,'_');

    // Page HTML (CORS proxy)
    const htmlRes = await fetch(`https://corsproxy.io/?https://awakening.wiki/${slug}`);
    if (!htmlRes.ok) throw new Error(`HTTP ${htmlRes.status}`);
    const htmlText = await htmlRes.text();
    const doc = new DOMParser().parseFromString(htmlText,'text/html');

    // Layout
    const layout = document.createElement('div'); layout.className='item-layout';

    const header = document.createElement('div'); header.className='item-header';
    header.innerHTML = `<h2>${title}</h2><div class="muted">Source: <a href="${page.fullurl}" target="_blank" rel="noopener">View on Wiki ↗</a></div>`;
    layout.appendChild(header);

    const sidebar = extractInfobox(doc, title);
    layout.appendChild(sidebar);

    const main = document.createElement('div');
    const obtainment = extractSection(doc,'Obtainment');
    const crafting   = extractSection(doc,'Crafting');
    const itemData   = extractSection(doc,'Item Data');

    [['Obtainment', obtainment], ['Crafting', crafting], ['Item Data', itemData]]
      .forEach(([t, node]) => {
        const p = makePanel(t, node);
        if (p) main.appendChild(p);
      });

    if (!main.childNodes.length) {
      const generic = doc.querySelector('#mw-content-text')?.cloneNode(true);
      main.appendChild(makePanel('Details', generic || document.createTextNode('No details available.')));
    }

    layout.insertBefore(main, sidebar);
    itemDetails.innerHTML = '';
    itemDetails.appendChild(layout);

    // optional belt-and-suspenders: ensure search is clear after render
    // clearSearchBar();

  } catch (e) {
    console.error('❌ Error loading item:', e);
    itemDetails.textContent = 'Failed to load full details.';
  }
}

// ---------- DOM helpers ----------
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

/* === STRONGER INFOBOX CLONE — no duplicate titles, no inner scrollbars === */
function extractInfobox(doc, pageTitle) {
  const found = doc.querySelector(
    '.infobox, .portable-infobox, .infobox-wrapper, aside.infobox, .pi-box, table.infobox'
  );

  const box = document.createElement('aside');
  box.className = 'infobox';

  // Normalizers
  const norm = (s) =>
    (s || '')
      .replace(/\s+/g, ' ')
      .replace(/[’'"]/g, "'")
      .trim()
      .toLowerCase();

  const clean = (s) => norm(s).replace(/[^a-z0-9]+/g, ' ').trim();

  const baseTitle = pageTitle.replace(/\/.*$/, '');
  const fullNorm  = clean(pageTitle);
  const baseNorm  = clean(baseTitle);

  const titleVariants = new Set([
    fullNorm,
    baseNorm,
    `${baseNorm} schematic`,
    `${baseNorm} learnable schematic`,
    `${baseNorm} unique schematic`,
    `${baseNorm} schematic unique`,
  ]);

  const looksLikeTitleVariant = (txt) => {
    const c = clean(txt);
    if (!c) return false;
    if (titleVariants.has(c)) return true;
    if (c.startsWith(baseNorm) && c.includes('schematic')) return true;
    return false;
  };

  if (found) {
    const cloned = found.cloneNode(true);

    // Remove edit gadgets/collapsers
    cloned
      .querySelectorAll(
        '.mw-editsection, .mw-editsection-visualeditor, .pi-edit-link, .mw-collapsible-toggle'
      )
      .forEach((n) => n.remove());

    // Remove duplicate titles/captions/headers
    cloned
      .querySelectorAll(
        [
          '.pi-title',
          '.infobox-title',
          '.infobox-header',
          'caption',
          '.mw-headline',
          'h1',
          'h2',
          'h3',
          'thead tr th',
        ].join(',')
      )
      .forEach((el) => { if (looksLikeTitleVariant(el.textContent || '')) el.remove(); });

    // Remove header rows that repeat the title variant
    cloned.querySelectorAll('tr').forEach((tr) => {
      const first = tr.querySelector('th, td');
      if (first && looksLikeTitleVariant(first.textContent || '')) tr.remove();
    });

    // Remove placeholder rows like "[[File:]]"
    cloned.querySelectorAll('td, th').forEach((cell) => {
      const t = (cell.textContent || '').trim();
      if (t === '[[File:]]' || t === '[[File: ]]') {
        const row = cell.closest('tr'); if (row) row.remove();
      }
    });

    // Kill inline max-height/overflow to prevent inner scrollbars
    cloned.style.overflow = 'visible';
    cloned.querySelectorAll('[style]').forEach((el) => {
      const s = el.getAttribute('style') || '';
      if (/overflow|max-height/i.test(s)) { el.style.overflow = 'visible'; el.style.maxHeight = 'none'; }
    });

    // Fix relative links/images
    absolutizeUrls(cloned);

    // Add our own title only if none remains
    const hasTitle = cloned.querySelector(
      '.pi-title, .infobox-title, .infobox-header, caption, .mw-headline, h1, h2, h3'
    );
    if (!hasTitle) {
      const t = document.createElement('div');
      t.className = 'infobox-title';
      t.textContent = pageTitle;
      box.appendChild(t);
    }

    box.appendChild(cloned);
    return box;
  }

  // Fallbacks
  const kv = doc.querySelector('#mw-content-text table');
  if (kv) {
    const simple = kv.cloneNode(true);
    absolutizeUrls(simple);
    const t = document.createElement('div');
    t.className = 'infobox-title';
    t.textContent = pageTitle;
    box.appendChild(t);
    box.appendChild(simple);
    return box;
  }

  const img = doc.querySelector('#mw-content-text img');
  if (img) {
    const t = document.createElement('div');
    t.className = 'infobox-title';
    t.textContent = pageTitle;
    box.appendChild(t);

    const im = document.createElement('img');
    im.className = 'infobox-img';
    im.src = img.src;
    im.alt = pageTitle;
    box.appendChild(im);
  }

  return box;
}

// --- INIT ---
(async function init(){
  try {
    enableSearch(true);          // search usable immediately (prefixsearch)
    setStatus('Loading…');
    await warmAllItems(new AbortController().signal); // background warmup
  } catch (e) {
    console.error('❌ init failed:', e);
    setStatus('Init failed');
  }
  // Make sure only BODY scrolls (HTML hidden)
  document.documentElement.style.height = '100%';
  document.documentElement.style.overflow = 'hidden';
  document.body.style.height = '100%';
  document.body.style.overflowY = 'auto';
  document.body.style.overflowX = 'hidden';
})();
