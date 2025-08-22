// ---------------- Config ----------------
const categories = [
  "Items", "Ammo", "Consumables", "Contract Items",
  "Garments", "Resources", "Tools", "Vehicles", "Weapons"
];

// UI thresholds: huge categories need more chars before opening suggestions
const OPEN_THRESHOLD = {
  default: 1,
  Items: 2  // Items is huge → type 2 chars before opening list
};

// Cache (24h)
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// --------------- DOM refs ---------------
const categorySelect = document.getElementById('category-select');
const itemSearch     = document.getElementById('item-search');
const suggestionsBox = document.getElementById('item-suggestions');
const loadItemBtn    = document.getElementById('load-item-btn');
const itemDetails    = document.getElementById('item-details');
const statusEl       = document.getElementById('status');

// --------------- State ------------------
let currentItems = [];       // [{ title, pageid }]
let activeIndex = -1;        // keyboard highlight index
let currentAbort = null;     // abort controller for in-flight category loads
let currentCategoryName = ''; // "Items", "Ammo", ...

// ---------- Populate categories ----------
(function initCategories() {
  categories.forEach(cat => {
    const o = document.createElement('option');
    o.value = cat.replace(/\s+/g, '_');
    o.textContent = cat;
    categorySelect.appendChild(o);
  });

  // If a category is preselected, enable search and load it
  if (categorySelect.value) {
    enableSearchFieldOnly();
    loadCategory(categorySelect.value);
  }
})();

// -------------- Helpers -----------------
function resetSearchUI() {
  itemSearch.value = '';
  itemSearch.placeholder = 'Search or select an item…';
  suggestionsBox.innerHTML = '';
  suggestionsBox.classList.add('hidden');
  itemSearch.setAttribute('aria-expanded', 'false');
  activeIndex = -1;
  setStatus('');
}

function setStatus(text) {
  statusEl.textContent = text || '';
}

function enableSearchFieldOnly() {
  itemSearch.disabled = false;
  loadItemBtn.disabled = true;
}

function enableSearchAndLoad() {
  itemSearch.disabled = false;
  loadItemBtn.disabled = false;
}

function scoreMatch(q, title) {
  const t = title.toLowerCase();
  if (t.startsWith(q)) return 0;
  const idx = t.indexOf(q);
  return idx === -1 ? 9999 : (100 + idx); // lower is better
}

function itCmp(a, b) {
  if (a._score !== b._score) return a._score - b._score;
  return a.title.localeCompare(b.title);
}

function getOpenThreshold() {
  return OPEN_THRESHOLD[currentCategoryName] ?? OPEN_THRESHOLD.default;
}

function getMatches(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return currentItems
    .map(it => ({...it, _score: scoreMatch(q, it.title)}))
    .filter(it => it._score < 9999)
    .sort(itCmp)
    .slice(0, 300); // show up to 300; scroll for more
}

function renderSuggestions(items) {
  suggestionsBox.innerHTML = '';
  if (!items.length) {
    suggestionsBox.classList.add('hidden');
    itemSearch.setAttribute('aria-expanded', 'false');
    return;
  }
  items.forEach((it, i) => {
    const div = document.createElement('div');
    div.className = 'suggestion';
    div.id = `sg-${i}`;
    div.role = 'option';
    div.textContent = it.title;
    div.addEventListener('mousedown', (e) => {
      e.preventDefault();
      chooseSuggestion(it);
    });
    suggestionsBox.appendChild(div);
  });
  activeIndex = -1;
  suggestionsBox.classList.remove('hidden');
  itemSearch.setAttribute('aria-expanded', 'true');
}

function hideSuggestions() {
  suggestionsBox.classList.add('hidden');
  itemSearch.setAttribute('aria-expanded', 'false');
  activeIndex = -1;
}

function highlight(index) {
  const children = [...suggestionsBox.children];
  children.forEach(c => c.classList.remove('active'));
  if (index >= 0 && index < children.length) {
    children[index].classList.add('active');
    itemSearch.setAttribute('aria-activedescendant', children[index].id);
  } else {
    itemSearch.setAttribute('aria-activedescendant', '');
  }
}

function chooseSuggestion(item) {
  itemSearch.value = item.title;
  hideSuggestions();
  loadItemByPageId(item.pageid);
}

function findExactByTitle(t) {
  const q = t.trim().toLowerCase();
  return currentItems.find(i => i.title.toLowerCase() === q) || null;
}

// -------- localStorage cache helpers --------
function cacheKeyFor(cat) {
  return `awakening-category:${cat}`;
}
function saveCache(cat, items) {
  try {
    const blob = { ts: Date.now(), items };
    localStorage.setItem(cacheKeyFor(cat), JSON.stringify(blob));
  } catch {}
}
function loadCache(cat) {
  try {
    const raw = localStorage.getItem(cacheKeyFor(cat));
    if (!raw) return null;
    const blob = JSON.parse(raw);
    if (!blob || !Array.isArray(blob.items) || typeof blob.ts !== 'number') return null;
    if (Date.now() - blob.ts > CACHE_TTL_MS) return null; // expired
    return blob.items;
  } catch { return null; }
}

// ------------- Category fetch (incremental + cached) -------------
async function loadCategory(categoryValue) {
  resetSearchUI();
  itemDetails.innerHTML = '';
  currentCategoryName = categoryValue.replace(/_/g, ' '); // for threshold map

  // Abort any in-flight previous load
  if (currentAbort) currentAbort.abort();
  currentAbort = new AbortController();

  // 1) Use cache if present (instant)
  const cached = loadCache(categoryValue);
  if (cached) {
    currentItems = cached;
    enableSearchAndLoad();
    setStatus(`Loaded ${cached.length} items (cached)`);
    // Also refresh in background silently to keep cache warm
    try { refreshCategoryInBackground(categoryValue, currentAbort.signal); } catch {}
    return;
  }

  // 2) Fresh load incrementally
  enableSearchFieldOnly(); // type immediately while we fetch
  currentItems = [];
  setStatus('Loading…');

  try {
    let cmcontinue = null;
    let loadedCount = 0;
    let firstBatchShown = false;

    do {
      const url = new URL('https://awakening.wiki/api.php');
      url.searchParams.set('action', 'query');
      url.searchParams.set('list', 'categorymembers');
      url.searchParams.set('cmtitle', `Category:${categoryValue}`);
      url.searchParams.set('cmlimit', '100');
      url.searchParams.set('format', 'json');
      url.searchParams.set('origin', '*');
      url.searchParams.set('cmtype', 'page'); // only pages
      if (cmcontinue) url.searchParams.set('cmcontinue', cmcontinue);

      const res = await fetch(url, { signal: currentAbort.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const batch = data.query.categorymembers.map(({ title, pageid }) => ({ title, pageid }));
      currentItems = currentItems.concat(batch);
      loadedCount += batch.length;
      setStatus(`Loading… ${loadedCount} items`);

      // Show the first 100 immediately; keep fetching in background
      if (!firstBatchShown && currentItems.length >= 100) {
        enableSearchAndLoad();
        firstBatchShown = true;
      }

      cmcontinue = data.continue?.cmcontinue;
    } while (cmcontinue);

    // Finalize
    if (!firstBatchShown) enableSearchAndLoad();
    saveCache(categoryValue, currentItems);
    setStatus(`Loaded ${currentItems.length} items`);
  } catch (e) {
    if (e.name === 'AbortError') return; // switched categories
    console.error('Error loading items:', e);
    itemSearch.disabled = false;
    itemSearch.placeholder = 'Failed to load items';
    loadItemBtn.disabled = true;
    setStatus('Load failed');
  }
}

// Background refresh that does not touch UI/state until done
async function refreshCategoryInBackground(categoryValue, signal) {
  let items = [];
  let cmcontinue = null;
  do {
    const url = new URL('https://awakening.wiki/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('list', 'categorymembers');
    url.searchParams.set('cmtitle', `Category:${categoryValue}`);
    url.searchParams.set('cmlimit', '100');
    url.searchParams.set('format', 'json');
    url.searchParams.set('origin', '*');
    url.searchParams.set('cmtype', 'page');
    if (cmcontinue) url.searchParams.set('cmcontinue', cmcontinue);

    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    items = items.concat(data.query.categorymembers.map(({ title, pageid }) => ({ title, pageid })));
    cmcontinue = data.continue?.cmcontinue;
  } while (cmcontinue);

  // Only update cache if still on same category
  saveCache(categoryValue, items);
  // If user is still on this category, update memory in place
  if (categorySelect.value === categoryValue) {
    currentItems = items;
    setStatus(`Loaded ${currentItems.length} items (refreshed)`);
    enableSearchAndLoad();
  }
}

// ------------- Events -------------
categorySelect.addEventListener('change', () => {
  const val = categorySelect.value;
  if (!val) {
    resetSearchUI();
    itemSearch.disabled = true;
    loadItemBtn.disabled = true;
    return;
  }
  enableSearchFieldOnly();
  loadCategory(val);
});

itemSearch.addEventListener('input', () => {
  if (itemSearch.value.trim().length < getOpenThreshold()) {
    hideSuggestions();
    return;
  }
  renderSuggestions(getMatches(itemSearch.value));
});

itemSearch.addEventListener('focus', () => {
  if (itemSearch.value.trim().length >= getOpenThreshold()) {
    renderSuggestions(getMatches(itemSearch.value));
  }
});

itemSearch.addEventListener('blur', () => setTimeout(() => hideSuggestions(), 150));

itemSearch.addEventListener('keydown', (e) => {
  const children = [...suggestionsBox.children];
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (!children.length) return;
    activeIndex = (activeIndex + 1) % children.length;
    highlight(activeIndex);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (!children.length) return;
    activeIndex = (activeIndex - 1 + children.length) % children.length;
    highlight(activeIndex);
  } else if (e.key === 'Enter') {
    if (!suggestionsBox.classList.contains('hidden') && activeIndex >= 0) {
      e.preventDefault();
      const title = children[activeIndex].textContent;
      const found = findExactByTitle(title);
      if (found) chooseSuggestion(found);
    } else {
      const found = findExactByTitle(itemSearch.value);
      if (found) chooseSuggestion(found);
    }
  } else if (e.key === 'Escape') {
    hideSuggestions();
  }
});

loadItemBtn.addEventListener('click', () => {
  const found = findExactByTitle(itemSearch.value);
  if (found) loadItemByPageId(found.pageid);
});

// ------------- Load + render item page -------------
async function loadItemByPageId(pageId) {
  itemDetails.innerHTML = '';

  try {
    // Metadata
    const metaRes = await fetch(
      `https://awakening.wiki/api.php?action=query&pageids=${pageId}&prop=info&inprop=url&format=json&origin=*`
    );
    if (!metaRes.ok) throw new Error(`HTTP ${metaRes.status}`);
    const meta = await metaRes.json();
    const page = meta.query.pages[pageId];
    const pageTitle = page.title;
    const pageTitleSlug = pageTitle.replace(/ /g, '_');

    // Page HTML (CORS proxy)
    const htmlRes = await fetch(`https://corsproxy.io/?https://awakening.wiki/${pageTitleSlug}`);
    if (!htmlRes.ok) throw new Error(`HTTP ${htmlRes.status}`);
    const htmlText = await htmlRes.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');

    // Layout
    const layout = document.createElement('div');
    layout.className = 'item-layout';

    const header = document.createElement('div');
    header.className = 'item-header';
    header.innerHTML = `
      <h2>${pageTitle}</h2>
      <div class="muted">Source: <a href="${page.fullurl}" target="_blank" rel="noopener">View on Wiki ↗</a></div>
    `;
    layout.appendChild(header);

    const sidebar = extractInfobox(doc, pageTitle);
    layout.appendChild(sidebar);

    const main = document.createElement('div');
    const obtainment = extractSection(doc, 'Obtainment');
    const media      = extractSection(doc, 'Media');
    const crafting   = extractSection(doc, 'Crafting');
    const itemData   = extractSection(doc, 'Item Data');

    [['Obtainment', obtainment], ['Media', media], ['Crafting', crafting], ['Item Data', itemData]]
      .forEach(([title, node]) => {
        const p = makePanel(title, node);
        if (p) main.appendChild(p);
      });

    if (!main.childNodes.length) {
      const generic = doc.querySelector('#mw-content-text')?.cloneNode(true);
      main.appendChild(makePanel('Details', generic || document.createTextNode('No details available.')));
    }

    layout.insertBefore(main, sidebar);
    itemDetails.innerHTML = '';
    itemDetails.appendChild(layout);

  } catch (e) {
    console.error('Error loading item:', e);
    itemDetails.textContent = 'Failed to load full details.';
  }
}

// ---------- Helpers ----------
function extractSection(doc, headingText) {
  const headings = [...doc.querySelectorAll('#mw-content-text h2')];
  const h = headings.find(h2 =>
    h2.textContent.trim().toLowerCase().startsWith(headingText.toLowerCase())
  );
  if (!h) return null;

  const frag = document.createDocumentFragment();
  let n = h.nextElementSibling;
  while (n && n.tagName !== 'H2') {
    if (!n.classList?.contains('mw-editsection')) {
      frag.appendChild(n.cloneNode(true));
    }
    n = n.nextElementSibling;
  }
  return frag.childNodes.length ? frag : null;
}

function makePanel(title, contentNode) {
  if (!contentNode) return null;
  const wrap = document.createElement('section');
  wrap.className = 'panel';
  const h = document.createElement('h3');
  h.textContent = title;
  wrap.appendChild(h);
  wrap.appendChild(contentNode);
  return wrap;
}

function extractInfobox(doc, pageTitle) {
  const found = doc.querySelector('.infobox') || doc.querySelector('.portable-infobox');
  const box = document.createElement('aside');
  box.className = 'infobox';

  const title = document.createElement('div');
  title.className = 'infobox-title';
  title.textContent = pageTitle;
  box.appendChild(title);

  let imgSrc = found?.querySelector('img')?.src
            || doc.querySelector('#mw-content-text img')?.src
            || null;
  if (imgSrc) {
    const im = document.createElement('img');
    im.className = 'infobox-img';
    im.src = imgSrc;
    im.alt = pageTitle;
    box.appendChild(im);
  }

  if (found) {
    const rows = found.querySelectorAll('tr');
    const usable = [...rows].filter(tr => tr.querySelectorAll('th,td').length >= 2);
    if (usable.length) {
      const table = document.createElement('table');
      const tbody = document.createElement('tbody');
      usable.forEach(tr => {
        const cells = tr.querySelectorAll('th, td');
        const trNew = document.createElement('tr');
        const th = document.createElement('th');
        const td = document.createElement('td');
        th.innerHTML = cells[0].innerHTML;
        td.innerHTML = cells[1].innerHTML;
        trNew.appendChild(th);
        trNew.appendChild(td);
        tbody.appendChild(trNew);
      });
      if (tbody.childNodes.length) {
        table.appendChild(tbody);
        box.appendChild(table);
      }
    }
  }

  return box;
}
