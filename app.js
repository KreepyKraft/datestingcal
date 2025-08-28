
let items = {};
const API_URL = "https://api.awakening.wiki/items";

const itemSearch = document.getElementById("item-search");
const itemQty = document.getElementById("item-qty");
const suggestions = document.getElementById("suggestions");
const calcButton = document.getElementById("calculate-btn");
const materialsList = document.querySelector("#materials-list ul");
const materialsSection = document.getElementById("materials-list");

// Disable input while loading
itemSearch.disabled = true;
itemSearch.placeholder = "Loading items...";

// Fetch data from API
window.addEventListener("DOMContentLoaded", async () => {
  try {
    const response = await fetch(API_URL);
    const data = await response.json();

    // Convert array to lookup object
    data.forEach(item => {
      items[item.name] = item;
    });

    itemSearch.disabled = false;
    itemSearch.placeholder = "Search or select an item...";
  } catch (error) {
    itemSearch.placeholder = "Failed to load items";
    alert("Error loading item data from API");
    console.error("API fetch error:", error);
  }
});

// Show dropdown suggestions
itemSearch.addEventListener("input", () => {
  const query = itemSearch.value.toLowerCase();
  suggestions.innerHTML = "";
  if (!query) return;

  const matches = Object.keys(items).filter(name =>
    name.toLowerCase().includes(query)
  );
  matches.slice(0, 10).forEach(name => {
    const li = document.createElement("li");
    li.textContent = name;
    li.addEventListener("click", () => {
      itemSearch.value = name;
      suggestions.innerHTML = "";
    });
    suggestions.appendChild(li);
  });
});

// Calculate on button click
calcButton.addEventListener("click", () => {
  const itemName = itemSearch.value.trim();
  const quantity = parseInt(itemQty.value, 10);
  if (!itemName || isNaN(quantity) || quantity <= 0) return;

  const breakdown = calculateMaterials(itemName, quantity);
  displayMaterials(breakdown);
});

// Recursive calculator
function calculateMaterials(itemName, qty = 1, tree = {}) {
  const item = items[itemName];
  if (!item || !item.ingredients) return tree;

  for (const [ingredient, count] of Object.entries(item.ingredients)) {
    if (ingredient === "Water" || ingredient === "Time") continue;

    const total = count * qty;
    if (items[ingredient]) {
      calculateMaterials(ingredient, total, tree);
    } else {
      tree[ingredient] = (tree[ingredient] || 0) + total;
    }
  }
  return tree;
}

// Display results
function displayMaterials(tree) {
  materialsList.innerHTML = "";
  materialsSection.classList.remove("hidden");
  for (const [name, qty] of Object.entries(tree)) {
    const li = document.createElement("li");
    li.textContent = `${name}: ${qty}`;
    materialsList.appendChild(li);
  }
}
