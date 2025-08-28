let items = {};
const API_URL = "https://api.awakening.wiki/items";

const itemSearch = document.getElementById("item-search");
const itemQty = document.getElementById("item-qty");
const suggestions = document.getElementById("suggestions");
const calcButton = document.getElementById("calculate-btn");
const materialsList = document.querySelector("#materials-list ul");
const materialsSection = document.getElementById("materials-list");

// Fetch item data from API on page load
window.addEventListener("DOMContentLoaded", async () => {
  try {
    const response = await fetch(API_URL);
    const data = await response.json();

    // Convert array to object for faster access
    items = {};
    data.forEach(item => {
      items[item.name] = item;
    });
  } catch (error) {
    alert("Failed to load item data from API");
    console.error(error);
  }
});

itemSearch.addEventListener("input", () => {
  const query = itemSearch.value.toLowerCase();
  suggestions.innerHTML = "";
  if (!query) return;

  const matches = Obj
