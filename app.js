const categories = [
  "Items", "Ammo", "Consumables", "Contract Items",
  "Garments", "Resources", "Tools", "Vehicles", "Weapons"
];

const categorySelect = document.getElementById('category-select');
const itemSelect = document.getElementById('item-select');
const itemDetails = document.getElementById('item-details');

// Populate category dropdown
categories.forEach(cat => {
  const option = document.createElement('option');
  option.value = cat.replace(/\s+/g, '_'); // Use underscores
  option.textContent = cat;
  categorySelect.appendChild(option);
});

categorySelect.addEventListener('change', async () => {
  const selectedCategory = categorySelect.value;
  itemSelect.innerHTML = '<option>Loading...</option>';
  itemSelect.disabled = true;
  itemDetails.innerHTML = '';

  if (!selectedCategory) {
    itemSelect.innerHTML = '<option value="">-- Select Item --</option>';
    return;
  }

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
      if (cmcontinue) {
        url.searchParams.set('cmcontinue', cmcontinue);
      }

      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      items = items.concat(data.query.categorymembers);
      cmcontinue = data.continue?.cmcontinue;
    } while (cmcontinue);

    itemSelect.innerHTML = '<option value="">-- Select Item --</option>';
    items
  .filter(item => !item.title.startsWith('Category:')) // 🔥 filter out category links
  .forEach(item => {
    const opt = document.createElement('option');
    opt.value = item.pageid;
    opt.textContent = item.title;
    itemSelect.appendChild(opt);
  });

    itemSelect.disabled = false;
  } catch (err) {
    console.error('Error loading items:', err);
    itemSelect.innerHTML = '<option>Error loading items</option>';
  }
});

});

itemSelect.addEventListener('change', async () => {
  const pageId = itemSelect.value;
  itemDetails.innerHTML = '';

  if (!pageId) return;

  try {
    // Step 1: Get the page title using page ID
    const metaRes = await fetch(`https://awakening.wiki/api.php?action=query&pageids=${pageId}&format=json&origin=*`);
    const metaData = await metaRes.json();
    const page = metaData.query.pages[pageId];
    const pageTitle = page.title.replace(/ /g, '_');

    // Step 2: Fetch the full page HTML using a CORS proxy
    const htmlRes = await fetch(`https://corsproxy.io/?https://awakening.wiki/${pageTitle}`);
    const htmlText = await htmlRes.text();

    // Step 3: Parse the HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');
    const content = doc.querySelector('#mw-content-text');

    // Clear and inject
    itemDetails.innerHTML = '';
    itemDetails.appendChild(content);

    // Optional: Resize images
    itemDetails.querySelectorAll('img').forEach(img => {
      img.style.maxWidth = '250px';
      img.style.height = 'auto';
    });

  } catch (err) {
    console.error('Error loading full wiki page:', err);
    itemDetails.textContent = 'Failed to load full details.';
  }
});

