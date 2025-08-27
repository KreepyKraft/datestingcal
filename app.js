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

// MOCKED API data since the real API is down
const MOCK_ITEMS = [
  {
    id: "dartgun",
    name: "A Dart for Every Man",
    imageUrl: "https://static.wikia.nocookie.net/placeholder-image.jpg", // replace later
    waterPerUnit: 30,
    timePerUnitSeconds: 80,
    materials: [
      { name: "Steel", qty: 5 },
      { name: "Plastic", qty: 2 },
    ]
  },
  {
    id: "spiceharvester",
    name: "Spice Harvester",
    imageUrl: "https://static.wikia.nocookie.net/placeholder-image.jpg",
    waterPerUnit: 100,
    timePerUnitSeconds: 300,
    materials: [
      { name: "Alloy", qty: 10 },
      { name: "Fuel", qty: 5 },
    ]
  }
];

searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim().toLowerCase();
  suggestionsList.innerHTML = '';
  if (!query) return;

  const matches = MOCK_ITEMS.filter(item => item.name.toLowerCase().includes(query));
  matches.forEach(item => {
    const li = document.createElement('li');
    li.textContent = item.name;
    li.addEventListener('click', () => selectItem(item));
    suggestionsList.appendChild(li);
  });
});

function selectItem(item) {
  selectedItem = item;
  searchInput.value = item.name;
  suggestionsList.innerHTML = '';

  itemName.textContent = item.name;
  itemName.classList.remove('hidden');

  itemImage.src = item.imageUrl;
  itemImage.classList.remove('hidden');

  materialsUl.innerHTML = '';
  item.materials.forEach(mat => {
    const li = document.createElement('li');
    li.textContent = `${mat.name}: ${mat.qty}`;
    materialsUl.appendChild(li);
  });
  materialsList.classList.remove('hidden');

  resultsDiv.classList.add('hidden');
}

calculateBtn.addEventListener('click', () => {
  if (!selectedItem) {
    alert("Please select an item.");
    return;
  }

  const qty = parseInt(qtyInput.value);
  if (!qty || qty <= 0) {
    alert("Enter a valid quantity.");
    return;
  }

  const totalWater = selectedItem.waterPerUnit * qty;
  const totalTimeSec = selectedItem.timePerUnitSeconds * qty;

  const h = Math.floor(totalTimeSec / 3600);
  const m = Math.floor((totalTimeSec % 3600) / 60);
  const s = totalTimeSec % 60;

  resultWater.textContent = totalWater;
  resultTime.textContent = `${h}h ${m}m ${s}s`;

  materialsUl.innerHTML = '';
  selectedItem.materials.forEach(mat => {
    const li = document.createElement('li');
    li.textContent = `${mat.name}: ${mat.qty * qty}`;
    materialsUl.appendChild(li);
  });

  resultsDiv.classList.remove('hidden');
});
