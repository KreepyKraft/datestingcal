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
    itemSelect.innerHTML = '<option>-- Select Item --</option>';
    return;
  }

  try {
    const apiUrl = `https://awakening.wiki/api.php?action=query&list=categorymembers&cmtitle=Category:${encodeURIComponent(selectedCategory)}&cmlimit=100&format=json&origin=*`;
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    const items = json.query?.categorymembers || [];

    itemSelect.innerHTML = '<option value="">-- Select Item --</option>';
    items.forEach(item => {
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

itemSelect.addEventListener('change', async () => {
  const pageId = itemSelect.value;
  itemDetails.innerHTML = '';

  if (!pageId) return;

  try {
    // Fetch item info and image thumbnail
    const apiUrl = `https://awakening.wiki/api.php?action=query&pageids=${pageId}&prop=extracts|pageimages|info&inprop=url&exintro=1&format=json&origin=*`;
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    const page = json.query.pages[pageId];

    // Render item details
    const html = `
      <h2>${page.title}</h2>
      ${page.thumbnail ? `<img src="${page.thumbnail.source}" alt="${page.title}" style="max-width:200px;">` : ''}
      <p>${page.extract || 'No description available.'}</p>
      <p><a href="${page.fullurl}" target="_blank">View on Wiki ↗</a></p>
    `;
    itemDetails.innerHTML = html;
  } catch (err) {
    console.error('Error loading item details:', err);
    itemDetails.innerHTML = 'Failed to load item details.';
  }
});
