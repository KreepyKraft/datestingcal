const searchInput = document.getElementById('item-search');
const qtyInput = document.getElementById('item-qty');
const calculateBtn = document.getElementById('calculate-btn');
const suggestionsList = document.getElementById('suggestions');

const itemImage = document.getElementById('item-image');
const itemName = document.getElementById('item-name');
const materialsList = document.getElementById('materials-list');
const materialsUl = materialsList.querySelector('ul');

const resultWater = document.getElementById('result-water');
const resultTime = document.getElementById('result-time');
const resultsDiv = document.querySelector('.results');

let selectedItem = null;

// Debounce helper
function debounce(func, delay = 300) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), delay);
  };
}

// Fetch matching item titles from the API
async function fetchSearchResults(query) {
  const url = `https://api.awakening.wiki/?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url);
  const json = await res.json();
  return json?.query?.search || [];
}

// Fetch item details
async function fetchItemDetails(title) {
  const url = `https://api.awakening.wiki/?action=query&prop=pageprops|images|revisions&titles=${encodeURIComponent(title)}&format=json`;
  const res = await fetch(url);
  const json = await res.json();
  const pages = json?.query?.pages;
  if (!pages) return null;
  const page = pages[Object.keys(pages)[0]];
  
  // Extract image from page props or images list
  let imageUrl = "";
  if (page.images && page.images.length > 0) {
    const imageTitle = page.images[0].title; 
    imageUrl = `https://static.wikia.nocookie.net/awakening.wiki/images/${encodeURIComponent(imageTitle.replace("File:", ""))}`;
  }
  
  // Parse crafting data from page content? (needs wiki-specific parsing)
  // For now, mock them or parse from page.revisions[0].slots.main['*'] if available.
  return {
    title,
    imageUrl,
    waterPerUnit: 30, // placeholder
    timePerUnitSeconds: 60, // placeholder
    materials: [
      { name: "SampleMat1", qty: 5 },
      { name: "SampleMat2", qty: 3 }
    ]
  };
}

searchInput.addEventListener('input', debounce(async () => {
  const query = searchInput.value.trim();
  suggestionsList.innerHTML = '';
  if (!query) return;
  
  const results = await fetchSearchResults(query);
  results.forEach(item => {
    const li = document.createElement('li');
    li.textContent = item.title;
    li.addEventListener('click', () => selectItem(item.title));
    suggestionsList.appendChild(li);
  });
}, 300));

async function selectItem(title) {
  suggestionsList.innerHTML = '';
  searchInput.value = title;

  const data = await fetchItemDetails(title);
  if (!data) return alert("Item details not found!");

  selectedItem = data;

  itemName.textContent = data.title;
  itemName.classList.remove('hidden');

  if (data.imageUrl) {
    itemImage.src = data.imageUrl;
    itemImage.classList.remove('hidden');
  }

  materialsUl.innerHTML = "";
  data.materials.forEach(mat => {
    const li = document.createElement('li');
    li.textContent = `${mat.name}: ${mat.qty}`;
    materialsUl.appendChild(li);
  });
  materialsList.classList.remove('hidden');
  resultsDiv.classList.add('hidden');
}

calculateBtn.addEventListener('click', () => {
  if (!selectedItem) return alert("Select an item first!");
  const qty = Number(qtyInput.value);
  if (!qty || qty <= 0) return alert("Enter a valid quantity.");

  const totalWater = selectedItem.waterPerUnit * qty;
  const totalTimeSec = selectedItem.timePerUnitSeconds * qty;
  const h = Math.floor(totalTimeSec / 3600);
  const m = Math.floor((totalTimeSec % 3600) / 60);
  const s = totalTimeSec % 60;

  resultWater.textContent = totalWater;
  resultTime.textContent = `${h}h ${m}m ${s}s`;

  materialsUl.innerHTML = "";
  selectedItem.materials.forEach(mat => {
    const li = document.createElement('li');
    li.textContent = `${mat.name}: ${mat.qty * qty}`;
    materialsUl.appendChild(li);
  });
  resultsDiv.classList.remove('hidden');
});
