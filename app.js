const categories = [
  "Items", "Ammo", "Consumables", "Contract Items",
  "Garments", "Resources", "Tools", "Vehicles", "Weapons"
];

// Populate the categories dropdown
const categorySelect = document.getElementById('category-select');
categories.forEach(cat => {
  const o = document.createElement('option');
  o.value = cat.toLowerCase().replace(/\s+/g, '_');
  o.textContent = cat;
  categorySelect.appendChild(o);
});

const itemSelect = document.getElementById('item-select');
const itemDetails = document.getElementById('item-details');

categorySelect.addEventListener('change', async () => {
  const category = categorySelect.value;
  itemSelect.innerHTML = '<option>Loading...</option>';
  itemSelect.disabled = true;
  itemDetails.innerHTML = '';

  if (!category) {
    itemSelect.innerHTML = '<option>-- Select Item --</option>';
    return;
  }

  try {
    // Fetch items by category (adjust endpoint as API supports)
    const res = await fetch(`https://api.awakening.wiki/${category}`);
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json();

    itemSelect.innerHTML = '<option value="">-- Select Item --</option>';
    data.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = item.name;
      itemSelect.appendChild(opt);
    });
    itemSelect.disabled = false;
  } catch (err) {
    itemSelect.innerHTML = '<option>Error loading items</option>';
    console.error(err);
  }
});

itemSelect.addEventListener('change', async () => {
  const id = itemSelect.value;
  itemDetails.innerHTML = '';

  if (!id) return;

  try {
    const res = await fetch(`https://api.awakening.wiki/${categorySelect.value}/${id}`);
    if (!res.ok) throw new Error(res.statusText);
    const info = await res.json();

    // Display fields dynamically
    Object.entries(info).forEach(([key, value]) => {
      const p = document.createElement('p');
      p.innerHTML = `<strong>${key}</strong>: ${JSON.stringify(value)}`;
      itemDetails.appendChild(p);
    });
  } catch (err) {
    itemDetails.textContent = 'Error fetching item details.';
    console.error(err);
  }
});
