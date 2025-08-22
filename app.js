// ---------------- Config ----------------
const categories = [
  "Items", "Ammo", "Consumables", "Contract Items",
  "Garments", "Resources", "Tools", "Vehicles", "Weapons"
];

// --------------- DOM refs ---------------
const categorySelect = document.getElementById('category-select');
const itemSearch     = document.getElementById('item-search');
const suggestionsBox = document.getElementById('item-suggestions');
const loadItemBtn    = document.getElementById('load-item-btn');
const itemDetails    = document.getElementById('item-details');

// --------------- State ------------------
let currentItems = []; // [{ title, pageid }]
let activeIndex = -1;  // keyboard highlight index

// ---------- Populate categories ----------
categories.forEach(cat => {
  const o = document.createElement('option');
  o.value = cat.replace(/\s+/g, '_');
  o.textContent = cat;
  categorySelect.appendChild(o);
});

// -------------- Helpers -----------------
function resetSearchUI() {
  itemSearch.value = '';
  itemSearch.placeholder = 'Search or select an item…';
  suggestionsBox.innerHTML = '';
  suggestionsBox.classList.add('hidden');
  itemSearch.setAttribute('aria-expanded', 'false');
  itemSearch.disabled = true;
  loadItemBtn.disabled = true;
  activeIndex = -1;
}

function enableSearchUI() {
  itemSearch.disabled = false;
  loadItemBtn.disabled = false;
}

function scoreMatch(q, title) {
  // simple scoring: starts-with wins, then substring position
  const t = title.toLowerCase();
  if (t.startsWith(q)) return 0;
  const idx = t.indexOf(q);
  return idx === -1 ? 9999 : (100 + idx); // lower is better
}

function getMatches(query) {
  const q = query.trim().toLowerCase();
  if (!q) {
    // show first N alphabetically
    return [...currentItems]
      .sort((a,b) => a.title.localeCompare(b.title))
      .slice(0, 50);
  }
  return currentItems
    .map(it => ({...it, _score: scoreMatch(q, it.title)}))
    .filter(it => it._score < 9999)
    .sort((a,b) => itCmp(a,b))
    .slice(0, 50);
}

function itCmp(a, b) {
  if (a._score !== b._score) return a._score - b._score;
  return a.title.localeCompare(b.title);
}

function renderSuggestions(items) {
  suggestionsBox.innerHTML = '';
  if (!items.length) {
    const div = document.createElement('div');
    div.className = 'suggestion';
    div.textContent = 'No matches';
    suggestionsBox.appendChild(div);
    suggestionsBox.classList.remove('hidden');
    itemSearch.setAttribute('aria-expanded', 'true');
    return;
  }

  items.forEach((it, i) => {
    const div = document.createElement('div');
    div.className = 'suggestion';
    div.id = `sg-${i}`;
    div.role = 'option';
    div.innerHTML = `${it.title}`;
    // mousedown fires before input blur -> ensures click works
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

function chooseSuggestion(item) {
  itemSearch.value = item.title;
  hideSuggestions();
  loadItemByPageId(item.pageid);
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

// Extract content between an H2 that starts with `headingText` and the next H2
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

  // Image
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

  // Build a KV table if the wiki infobox has tr rows (th/td)
  if (found) {
    const rows = found.querySelectorAll('tr');
    const usable = [...rows].filter(tr => tr.querySelectorAll('th,td').length >= 2);
    if (usable.length) {
      const table = document.createElement('table');
      const tbody = document.createElement('tbody');
      usable.forEach(tr => {
        const cells = tr.querySelectorAll('th, td');
        // Use the first two cells for a simple KV mapping
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

// ------------- Category change -------------
categorySelect.addEventListener('change', async () => {
  const selectedCategory = categorySelect.value;
  resetSearchUI();
  itemDetails.innerHTML = '';
  if (!selectedCategory) return;

  try {
    let items = [];
    let cmcontinue = null;

    do {
      const url = new URL('https://awakening.wiki/api.php');
      url.searchParams.set('action', 'query');
      url.searchParams.set('list', 'categorymembers');
      url.searchParams.set('cmtitle', `Category:${selectedCategory}`);
      url.searchParams.set('cmlimit', '100');
      url.searchParams.set('format', 'json');
      url.searchParams.set('origin', '*');
      url.searchParams.set('cmtype', 'page'); // only pages (no Category:/File:)
      if (cmcontinue) url.searchParams.set('cmcontinue', cmcontinue);

      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      items = items.concat(data.query.categorymembers);
      cmcontinue = data.continue?.cmcontinue;
    } while (cmcontinue);

    currentItems = items.map(({ title, pageid }) => ({ title, pageid }));
    enableSearchUI();
  } catch (e) {
    console.error('Error loading items:', e);
    itemSearch.placeholder = 'Failed to load items';
  }
});

// ------------- Search interactions -------------
itemSearch.addEventListener('input', () => {
  const list = getMatches(itemSearch.value);
  renderSuggestions(list);
});

itemSearch.addEventListener('focus', () => {
  const list = getMatches(itemSearch.value);
  renderSuggestions(list);
});

itemSearch.addEventListener('blur', () => {
  // delay to allow click selection to register
  setTimeout(() => hideSuggestions(), 150);
});

itemSearch.addEventListener('keydown', (e) => {
  const children = [...suggestionsBox.children];
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (children.length === 0) return;
    activeIndex = (activeIndex + 1) % children.length;
    highlight(activeIndex);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (children.length === 0) return;
    activeIndex = (activeIndex - 1 + children.length) % children.length;
    highlight(activeIndex);
  } else if (e.key === 'Enter') {
    if (!suggestionsBox.classList.contains('hidden') && activeIndex >= 0) {
      e.preventDefault();
      const title = children[activeIndex].textContent;
      const found = currentItems.find(i => i.title === title);
      if (found) chooseSuggestion(found);
    } else {
      // Enter without an active suggestion -> attempt exact match
      const q = itemSearch.value.trim();
      const found = currentItems.find(i => i.title.toLowerCase() === q.toLowerCase());
      if (found) chooseSuggestion(found);
    }
  } else if (e.key === 'Escape') {
    hideSuggestions();
  }
});

loadItemBtn.addEventListener('click', () => {
  const q = itemSearch.value.trim().toLowerCase();
  const found = currentItems.find(i => i.title.toLowerCase() === q);
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
    const metaText = await metaRes.text();
    const meta = JSON.parse(metaText);
    const page = meta.query.pages[pageId];
    const pageTitle = page.title;
    const pageTitleSlug = pageTitle.replace(/ /g, '_');

    // HTML (via proxy for CORS)
    const htmlRes = await fetch(`https://corsproxy.io/?https://awakening.wiki/${pageTitleSlug}`);
    if (!htmlRes.ok) throw new Error(`HTTP ${htmlRes.status}`);
    const htmlText = await htmlRes.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');

    // ---------- Build structured layout ----------
    const layout = document.createElement('div');
    layout.className = 'item-layout';

    // Header
    const header = document.createElement('div');
    header.className = 'item-header';
    header.innerHTML = `
      <h2>${pageTitle}</h2>
      <div class="muted">Source: <a href="${page.fullurl}" target="_blank" rel="noopener">View on Wiki ↗</a></div>
    `;
    layout.appendChild(header);

    // Sidebar (Infobox)
    const sidebar = extractInfobox(doc, pageTitle);
    layout.appendChild(sidebar);

    // Main panels
    const main = document.createElement('div');

    const obtainment = extractSection(doc, 'Obtainment');
    const media      = extractSection(doc, 'Media');
    const crafting   = extractSection(doc, 'Crafting'); // includes Crafted By table on many pages
    const itemData   = extractSection(doc, 'Item Data');

    const pOb = makePanel('Obtainment', obtainment);
    const pMe = makePanel('Media',      media);
    const pCr = makePanel('Crafting',   crafting);
    const pId = makePanel('Item Data',  itemData);

    [pOb, pMe, pCr, pId].forEach(p => p && main.appendChild(p));

    if (!main.childNodes.length) {
      const generic = doc.querySelector('#mw-content-text')?.cloneNode(true);
      main.appendChild(makePanel('Details', generic || document.createTextNode('No details available.')));
    }

    // Ensure main column is left, sidebar on right
    layout.insertBefore(main, sidebar);

    itemDetails.innerHTML = '';
    itemDetails.appendChild(layout);

  } catch (e) {
    console.error('Error loading item:', e);
    itemDetails.textContent = 'Failed to load full details.';
  }
}
