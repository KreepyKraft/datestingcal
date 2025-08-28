import items from './items.json' assert { type: 'json' };

const itemSearch = document.getElementById("item-search");
const itemQty = document.getElementById("item-qty");
const suggestions = document.getElementById("suggestions");
const calcButton = document.getElementById("calculate-btn");
const materialsList = document.querySelector("#materials-list ul");
const materialsSection = document.getElementById("materials-list");

const allItems = Object.keys(items);

itemSearch.addEventListener("input", () => {
  const query = itemSearch.value.toLowerCase();
  suggestions.innerHTML = "";
  if (!query) return;

  const matches = allItems.filter(name => name.toLowerCase().includes(query));
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

calcButton.addEventListener("click", () => {
  const itemName = itemSearch.value.trim();
  const quantity = parseInt(itemQty.value, 10);
  if (!itemName || isNaN(quantity) || quantity <= 0) return;

  const breakdown = calculateMaterials(itemName, quantity);
  displayMaterials(breakdown);
});

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

function displayMaterials(tree) {
  materialsList.innerHTML = "";
  materialsSection.classList.remove("hidden");
  for (const [name, qty] of Object.entries(tree)) {
    const li = document.createElement("li");
    li.textContent = `${name}: ${qty}`;
    materialsList.appendChild(li);
  }
}
