// ---------------- Config ----------------
const categories = [
  "Items", "Ammo", "Consumables", "Contract Items",
  "Garments", "Resources", "Tools", "Vehicles", "Weapons"
];

// --------------- DOM refs ---------------
const categorySelect = document.getElementById('category-select');
const itemSearch = document.getElementById('item-search');
const itemDatalist = document.getElementById('item-datalist');
const loadItemBtn = document.getElementById('load-item-btn');
const itemDetails = document.getElementById('item-details');

// --------------- State ------------------
let currentItems = []; // [{ title, pageid }]

// ---------- Populate categories ----------
categories.forEach(cat => {
  const o = document.createElement('option');
  o.value = cat.replace(/\s+/g, '_');
  o.textContent = cat;
  categorySelect.appendChild(o);
});

// -------------- Helpers -----------------
function resetItemUI() {
  itemSearch.value = '';
  itemDatalist.innerHTML = '';
  itemSearch.disabled = true;
  loadItemBtn.disabled = true;
  itemDetails.innerHTML = '';
}

function populateDatalist(items) {
  itemDatalist.innerHTML = '';
  items.forEach(({ title }) => {
    const opt = document.createElement('option');
    opt.value = title;
    itemDatalist.appendChild(opt);
  });
  itemSearch.disabled = false;
  loadItemBtn.disabled = false;
}

function findPageIdByTitle(inputTitle) {
  if (!inputTitle) return null;
  const exact = currentItems.find(i => i.title === inputTitle);
  if (exact) return exact.pageid;
  const ci = inputTitle.toLowerCase();
  const loose = currentItems.find(i => i.title.toLowerCase() === ci);
  return loose ? loose.pageid : null;
}

// Get the content node between a heading (h2) with text and the next h2
function extractSection(doc, headingText) {
  const headings = [...doc.querySelectorAll('#mw-content-text h2')];
  const h = headings.find(h2 => h2.textContent.trim().toLowerCase().startsWith(headingText.toLowerCase()));
  if (!h) return null;

  const frag = document.createDocumentFragment();
  let n = h.nextElementSibling;
  while (n && n.tagName !== 'H2') {
    // Skip empty TOC or edit links
    if (!n.classList?.contains('mw-editsection')) {
      frag.appendChild(n.cloneNode(true));
    }
    n = n.nextElementSibling;
  }
  if (!frag.childNodes.length) return null;
  return frag;
}

// Create a generic boxed panel
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

// Build a friendly key/value table from an existing wiki table if present
function extractInfobox(doc, pageTitle) {
  // Try wiki infobox first
  const found = doc.querySelector('.infobox') || doc.querySelector('.portable-infobox');
  const box = document.createElement('aside');
  box.className = 'infobox';

  // Title
  const title = document.createElement('div');
  title.className = 'infobox-title';
  title.textContent = pageTitle;
  box.appendChild(title);

  // Image
  let imgSrc = null;
  if (found) {
    const img = found.querySelector('img');
    if (img?.src) imgSrc = img.src;
  } else {
    // Fallback: first image on page
    const firstImg = doc.querySelector('#mw-content-text img');
    if (firstImg?.src) imgSrc = firstImg.src;
  }
  if (imgSrc) {
    const im = document.createElement('img');
    im.className = 'infobox-img';
    im.src = imgSrc;
    im.alt = pageTitle;
    box.appendChild(im);
  }

  // Key/Value table attempt: pull rows from the wiki infobox if available
  const table = document.createElement('table');
  const tbody = document.createElement('tbody');

  // Try scrape rows from found infobox
  if (found) {
    const rows = found.querySelectorAll('tr');
    rows.forEach(tr => {
      const cells = tr.querySelectorAll('th, td');
      if (cells.length === 2) {
        const [k, v] = cells;
        const trNew = document.createElement('tr');
        const th = document.createElement('th');
        const td = document.createElement('td');
        th.innerHTML = k.innerHTML;
        td.innerHTML = v.innerHTML;
        trNew.appendChild(th);
        trNew.appendChild(td);
        tbody.appendChild(trNew);
      }
    });
  }

  // Only add table if we captured any rows
  if (tbody.childNodes.length) {
    table.appendChild(tbody);
    box.appendChild(table);
  }

  return box;
}

// ------------- Category change -------------
categorySelect.addEventListener('change', async () => {
  const selectedCategory = categorySelect.value;
  resetItemUI();
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
      url.searchParams.set('cmtype', 'page'); // only pages
      if (cmcontinue) url.searchParams.set('cmcontinue', cmcontinue);

      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      items = items.concat(data.query.categorymembers);
      cmcontinue = data.continue?.cmcontinue;
    } while (cmcontinue);

    currentItems = items.map(({ title, pageid }) => ({ title, pageid }));
    populateDatalist(currentItems);
  } catch (e) {
    console.error(e);
    itemSearch.placeholder = 'Failed to load items';
  }
});

// ------------- Load item (search or button) -------------
itemSearch.addEventListener('change', () => {
  const id = findPageIdByTitle(itemSearch.value.trim());
  if (id) loadItemByPageId(id);
});
loadItemBtn.addEventListener('click', () => {
  const id = findPageIdByTitle(itemSearch.value.trim());
  if (id) loadItemByPageId(id);
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

    // HTML
    const htmlRes = await fetch(`https://corsproxy.io/?https://awakening.wiki/${pageTitleSlug}`);
    if (!htmlRes.ok) throw new Error(`HTTP ${htmlRes.status}`);
    const htmlText = await htmlRes.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');

    // ---------- Build our structured layout ----------
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

    // Sidebar (Infobox with large image + key/values when available)
    const sidebar = extractInfobox(doc, pageTitle);
    layout.appendChild(sidebar);

    // Main content panels (left column)
    const main = document.createElement('div');

    // Try to extract sections by heading name from the wiki page
    const obtainment = extractSection(doc, 'Obtainment');
    const media = extractSection(doc, 'Media');
    // Some pages show "Crafting" plus nested "Crafted By"
    const crafting = extractSection(doc, 'Crafting');
    const itemData = extractSection(doc, 'Item Data');

    // Add panels if present
    const pOb = makePanel('Obtainment', obtainment);
    const pMe = makePanel('Media', media);
    const pCr = makePanel('Crafting', crafting);
    const pId = makePanel('Item Data', itemData);

    [pOb, pMe, pCr, pId].forEach(p => p && main.appendChild(p));

    // Fallback if we couldn't find any structured sections
    if (!main.childNodes.length) {
      const generic = extractSection(doc, 'Contents') || doc.querySelector('#mw-content-text')?.cloneNode(true);
      const p = makePanel('Details', generic || document.createTextNode('No details available.'));
      main.appendChild(p);
    }

    layout.insertBefore(main, sidebar); // ensure main is left, sidebar right
    itemDetails.innerHTML = '';
    itemDetails.appendChild(layout);

  } catch (e) {
    console.error(e);
    itemDetails.textContent = 'Failed to load full details.';
  }
}
