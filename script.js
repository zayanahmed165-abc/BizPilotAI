"use strict";

// ========================================
// BIZPILOT AI - FRONTEND JAVASCRIPT (FIXED)
// ========================================

const $ = (id) => document.getElementById(id);
const API_BASE = "/api";

const state = {
  currentPage: "dashboard",
  dashboard: null,
  sales: [],
  expenses: [],
  products: [],
  loading: false
};

// ========================================
// API HELPER
// ========================================

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };

  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  let response;
  try {
    response = await fetch(API_BASE + url, {
      ...options,
      headers,
      credentials: "same-origin"
    });
  } catch (networkError) {
    throw new Error("Server se connect nahi ho paya. Backend chal raha hai?");
  }

  const contentType = response.headers.get("content-type") || "";
  let data;

  if (contentType.includes("application/json")) {
    data = await response.json();
  } else {
    const text = await response.text();
    data = {
      success: false,
      message: `Server ne JSON nahi diya (HTTP ${response.status}). Route /api${url} check karo.`
    };
    console.warn("Non-JSON response from", API_BASE + url, text.slice(0, 200));
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error("Session expired or access denied. Please log in again.");
  }

  if (!response.ok || data.success === false) {
    throw new Error(data.message || data.error || `Request failed (${response.status})`);
  }

  return data;
}

// ========================================
// DATA HELPERS
// ========================================

function getValue(object, names) {
  if (!object || typeof object !== "object") return null;

  for (const name of names) {
    for (const key of new Set([name, name.toUpperCase(), name.toLowerCase()])) {
      if (object[key] !== undefined && object[key] !== null) {
        return object[key];
      }
    }
  }

  return null;
}

function getRows(data, keys = []) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];

  for (const source of [data, data.data, data.result]) {
    if (Array.isArray(source)) return source;
    if (!source || typeof source !== "object") continue;

    if (Array.isArray(source.rows)) return source.rows;

    for (const key of keys) {
      if (Array.isArray(source[key])) return source[key];
    }
  }

  return [];
}

// Har tarah ke response shape ko handle karta hai
function getMetrics(data) {
  const m =
    data?.metrics ??
    data?.data?.metrics ??
    data?.data ??
    data ??
    {};

  if (Array.isArray(m)) return m[0] || {};
  if (Array.isArray(m.rows)) return m.rows[0] || {};
  return m;
}

function getProductsFromDashboard(data) {
  return getRows(data, ["products", "recentProducts", "recent_products"]);
}

function sumRows(rows, names) {
  return rows.reduce((total, row) => {
    const value = Number(getValue(row, names));
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);
}

// Agar /dashboard se metrics na milein to lists se khud calculate karo
async function buildMetricsFromLists() {
  const [salesRes, expensesRes, productsRes] = await Promise.all([
    api("/sales").catch(() => null),
    api("/expenses").catch(() => null),
    api("/products").catch(() => null)
  ]);

  if (!salesRes && !expensesRes && !productsRes) {
    throw new Error("Dashboard, sales, expenses aur products, koi API data nahi de rahi.");
  }

  const sales = getRows(salesRes, ["sales"]);
  const expenses = getRows(expensesRes, ["expenses"]);
  const products = getRows(productsRes, ["products"]);

  const totalSales = sumRows(sales, ["totalAmount", "total_amount", "amount"]);
  const totalExpenses = sumRows(expenses, ["amount"]);

  return {
    metrics: {
      totalSales,
      totalExpenses,
      totalProducts: products.length,
      netProfit: totalSales - totalExpenses
    },
    products
  };
}

// ========================================
// FORMATTING
// ========================================

function money(value) {
  if (value === null || value === undefined || value === "") return "PKR —";

  const amount = Number(value);
  if (!Number.isFinite(amount)) return "PKR —";

  return "PKR " + amount.toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function number(value) {
  if (value === null || value === undefined || value === "") return "—";

  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString("en-PK") : "—";
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showMessage(id, message, isError = false) {
  const element = $(id);
  if (!element) return;

  element.textContent = message;
  element.style.color = isError ? "#ef4444" : "#16a34a";
}

function showDashboardError(message) {
  ["performance", "insights", "quick-products"].forEach((id) => {
    if ($(id)) $(id).textContent = "Error: " + message;
  });
  if ($("api-message")) $("api-message").textContent = message;
}

// ========================================
// NAVIGATION
// ========================================

const validPages = ["dashboard", "sales", "expenses", "inventory", "reports"];

const pageTitles = {
  dashboard: "Dashboard Overview",
  sales: "Sales Overview",
  expenses: "Expense Overview",
  inventory: "Inventory Management",
  reports: "Business Reports"
};

async function page(pageName) {
  if (!validPages.includes(pageName)) pageName = "dashboard";

  state.currentPage = pageName;

  document.querySelectorAll(".page").forEach((section) => {
    section.classList.toggle("active-page", section.id === pageName);
  });

  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle("active", link.dataset.page === pageName);
  });

  if ($("page-title")) {
    $("page-title").textContent = pageTitles[pageName];
  }

  if (window.location.hash !== `#${pageName}`) {
    history.replaceState(null, "", `#${pageName}`);
  }

  try {
    if (pageName === "dashboard") await loadDashboard();
    if (pageName === "sales") await loadSales();
    if (pageName === "expenses") await loadExpenses();
    if (pageName === "inventory") await loadProducts();
    if (pageName === "reports") {
      if (!state.dashboard) await loadDashboard();
      renderReport();
    }
  } catch (error) {
    console.error(`Page ${pageName} error:`, error);
    if (pageName === "dashboard") showDashboardError(error.message);
  }
}

// ========================================
// DASHBOARD
// ========================================

async function loadDashboard() {
  const message = $("api-message");
  if (message) message.textContent = "Loading dashboard...";

  let data;
  let metrics = {};
  let products = [];

  try {
    data = await api("/dashboard");
    console.log("Dashboard API response:", data);

    metrics = getMetrics(data);
    products = getProductsFromDashboard(data);
  } catch (error) {
    console.error("Dashboard API failed:", error);

    // Login ka masla ho to fallback mat chalao
    if (/log in again/i.test(error.message)) throw error;

    // Warna lists se data nikalne ki koshish karo
    const fallback = await buildMetricsFromLists();
    metrics = fallback.metrics;
    products = fallback.products;
    data = { metrics, products, message: "Dashboard API fail hui, data lists se calculate kiya gaya." };
  }

  // Agar API chali lekin metrics khali aaye, to bhi fallback
  if (getValue(metrics, ["totalSales", "total_sales", "sales"]) === null) {
    try {
      const fallback = await buildMetricsFromLists();
      metrics = fallback.metrics;
      if (!products.length) products = fallback.products;
    } catch (fallbackError) {
      console.error("Fallback failed:", fallbackError);
    }
  }

  state.dashboard = { ...(data || {}), metrics };

  const totalSales = getValue(metrics, ["totalSales", "total_sales", "sales"]);
  const totalExpenses = getValue(metrics, ["totalExpenses", "total_expenses", "expenses"]);
  const totalProducts = getValue(metrics, [
    "totalProducts", "total_products", "productCount",
    "product_count", "total_products_count"
  ]);
  const profit = getValue(metrics, [
    "netProfit", "net_profit", "operatingProfit", "operating_profit"
  ]);
  const inventoryValue = getValue(metrics, ["inventoryValue", "inventory_value"]);
  const lowStockCount = getValue(metrics, ["lowStockCount", "low_stock_count"]);

  if ($("total-sales")) $("total-sales").textContent = money(totalSales);
  if ($("total-expenses")) $("total-expenses").textContent = money(totalExpenses);
  if ($("total-products")) {
    $("total-products").textContent = number(totalProducts ?? (products.length || null));
  }

  if ($("net-profit")) {
    $("net-profit").textContent = money(
      profit !== null
        ? profit
        : totalSales !== null && totalExpenses !== null
          ? Number(totalSales) - Number(totalExpenses)
          : null
    );
  }

  if ($("inventory-value")) $("inventory-value").textContent = money(inventoryValue);
  if ($("low-stock-count")) $("low-stock-count").textContent = number(lowStockCount);

  renderPerformance(metrics);
  renderInsights(metrics);

  if (products.length) state.products = products;
  renderQuickProducts(products);

  if (message) {
    message.textContent = (data && data.message) || "Dashboard data loaded.";
  }

  return data;
}

// ========================================
// PERFORMANCE
// ========================================

function renderPerformance(metrics = {}) {
  const container = $("performance");
  if (!container) return;

  const sales = getValue(metrics, ["totalSales", "total_sales", "sales"]);
  const expenses = getValue(metrics, ["totalExpenses", "total_expenses", "expenses"]);

  if (sales === null || expenses === null) {
    container.textContent = "Sales and expense metrics are unavailable.";
    return;
  }

  const salesValue = Number(sales);
  const expensesValue = Number(expenses);

  if (!Number.isFinite(salesValue) || !Number.isFinite(expensesValue)) {
    container.textContent = "Invalid metric values returned by the API.";
    return;
  }

  const maximum = Math.max(salesValue, expensesValue, 1);
  const salesWidth = Math.max(0, Math.min(100, (salesValue / maximum) * 100));
  const expensesWidth = Math.max(0, Math.min(100, (expensesValue / maximum) * 100));

  container.innerHTML = `
    <div class="performance-item">
      <div class="performance-label">
        <span>Total Sales</span>
        <strong>${escapeHTML(money(salesValue))}</strong>
      </div>
      <div class="performance-track">
        <div class="performance-bar sales-bar" style="width:${salesWidth}%"></div>
      </div>
    </div>
    <div class="performance-item">
      <div class="performance-label">
        <span>Total Expenses</span>
        <strong>${escapeHTML(money(expensesValue))}</strong>
      </div>
      <div class="performance-track">
        <div class="performance-bar expenses-bar" style="width:${expensesWidth}%"></div>
      </div>
    </div>
  `;
}

// ========================================
// INSIGHTS
// ========================================

function renderInsights(metrics = {}) {
  const container = $("insights");
  if (!container) return;

  const sales = getValue(metrics, ["totalSales", "total_sales", "sales"]);
  const expenses = getValue(metrics, ["totalExpenses", "total_expenses", "expenses"]);
  const profit = getValue(metrics, [
    "netProfit", "net_profit", "operatingProfit", "operating_profit"
  ]);

  if (sales === null || expenses === null) {
    container.textContent = "Business metrics are unavailable. Check the API.";
    return;
  }

  const salesValue = Number(sales);
  const expensesValue = Number(expenses);
  const calculatedProfit = profit === null ? salesValue - expensesValue : Number(profit);

  let summary = "Sales and expenses are currently equal.";
  if (calculatedProfit > 0) {
    summary = "Recorded sales are higher than recorded expenses.";
  } else if (calculatedProfit < 0) {
    summary = "Recorded expenses are higher than sales. Review spending.";
  }

  container.innerHTML = `
    <div class="insight-item">
      <strong>Business Summary</strong>
      <p>${escapeHTML(summary)}</p>
    </div>
    <div class="insight-item">
      <strong>Operating Profit</strong>
      <p>${escapeHTML(money(calculatedProfit))}</p>
    </div>
  `;
}

// ========================================
// QUICK PRODUCTS
// ========================================

function renderQuickProducts(products = []) {
  const container = $("quick-products");
  if (!container) return;

  if (!Array.isArray(products) || products.length === 0) {
    container.textContent = "No products available.";
    return;
  }

  container.innerHTML = `
    <table>
      <thead>
        <tr><th>Product</th><th>Category</th><th>Stock</th><th>Price</th></tr>
      </thead>
      <tbody>
        ${products.slice(0, 5).map((product) => {
          const name = getValue(product, ["productName", "product_name", "name"]);
          const category = getValue(product, ["category"]);
          const quantity = getValue(product, ["stockQuantity", "stock_quantity", "quantity"]);
          const price = getValue(product, ["unitPrice", "unit_price", "price"]);

          return `
            <tr>
              <td>${escapeHTML(name || "—")}</td>
              <td>${escapeHTML(category || "—")}</td>
              <td>${escapeHTML(number(quantity))}</td>
              <td>${escapeHTML(money(price))}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

// ========================================
// SALES
// ========================================

async function loadSales() {
  const container = $("sales-content");
  if (!container) return;

  container.textContent = "Loading sales...";

  try {
    const data = await api("/sales");
    const sales = getRows(data, ["sales"]);
    state.sales = sales;

    if (!sales.length) {
      container.textContent = "No sales records found.";
      return;
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr><th>Sale ID</th><th>Product</th><th>Quantity</th><th>Total</th><th>Date</th></tr>
        </thead>
        <tbody>
          ${sales.map((sale) => `
            <tr>
              <td>${escapeHTML(getValue(sale, ["saleId", "sale_id", "id"]) ?? "—")}</td>
              <td>${escapeHTML(getValue(sale, ["productName", "product_name"]) || "—")}</td>
              <td>${escapeHTML(number(getValue(sale, ["quantity"])))}</td>
              <td>${escapeHTML(money(getValue(sale, ["totalAmount", "total_amount", "amount"])))}</td>
              <td>${escapeHTML(getValue(sale, ["saleDate", "sale_date", "date"]) || "—")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  } catch (error) {
    console.error("Sales error:", error);
    container.textContent = "Unable to load sales: " + error.message;
  }
}

// ========================================
// EXPENSES
// ========================================

async function loadExpenses() {
  const container = $("expenses-content");
  if (!container) return;

  container.textContent = "Loading expenses...";

  try {
    const data = await api("/expenses");
    const expenses = getRows(data, ["expenses"]);
    state.expenses = expenses;

    if (!expenses.length) {
      container.textContent = "No expense records found.";
      return;
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr><th>Expense ID</th><th>Category</th><th>Description</th><th>Amount</th><th>Date</th></tr>
        </thead>
        <tbody>
          ${expenses.map((expense) => `
            <tr>
              <td>${escapeHTML(getValue(expense, ["expenseId", "expense_id", "id"]) ?? "—")}</td>
              <td>${escapeHTML(getValue(expense, ["category"]) || "—")}</td>
              <td>${escapeHTML(getValue(expense, ["description"]) || "—")}</td>
              <td>${escapeHTML(money(getValue(expense, ["amount"])))}</td>
              <td>${escapeHTML(getValue(expense, ["expenseDate", "expense_date", "date"]) || "—")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  } catch (error) {
    console.error("Expenses error:", error);
    container.textContent = "Unable to load expenses: " + error.message;
  }
}

// ========================================
// INVENTORY
// ========================================

async function loadProducts() {
  const container = $("products-content");
  if (!container) return;

  container.textContent = "Loading inventory...";

  try {
    const data = await api("/products");
    const products = getRows(data, ["products"]);
    state.products = products;
    renderQuickProducts(products);

    if (!products.length) {
      container.textContent = "No products found.";
      return;
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr><th>ID</th><th>Product</th><th>Category</th><th>Quantity</th><th>Price</th></tr>
        </thead>
        <tbody>
          ${products.map((product) => `
            <tr>
              <td>${escapeHTML(getValue(product, ["productId", "product_id", "id"]) ?? "—")}</td>
              <td>${escapeHTML(getValue(product, ["productName", "product_name", "name"]) || "—")}</td>
              <td>${escapeHTML(getValue(product, ["category"]) || "—")}</td>
              <td>${escapeHTML(number(getValue(product, ["stockQuantity", "stock_quantity", "quantity"])))}</td>
              <td>${escapeHTML(money(getValue(product, ["unitPrice", "unit_price", "price"])))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  } catch (error) {
    console.error("Inventory error:", error);
    container.textContent = "Unable to load inventory: " + error.message;
  }
}

// ========================================
// ADD PRODUCT
// ========================================

async function addProduct(event) {
  event.preventDefault();

  const form = $("product-form");
  if (!form) return;

  const name = $("product-name")?.value.trim();
  const category = $("product-category")?.value.trim() || "General";
  const quantityInput = $("product-quantity")?.value;
  const priceInput = $("product-price")?.value;

  const quantity = Number(quantityInput);
  const price = Number(priceInput);

  if (!name) {
    showMessage("form-message", "Enter product name.", true);
    return;
  }

  if (
    quantityInput === "" ||
    !Number.isFinite(quantity) ||
    quantity < 0 ||
    !Number.isInteger(quantity)
  ) {
    showMessage("form-message", "Quantity must be a whole number of 0 or more.", true);
    return;
  }

  if (priceInput === "" || !Number.isFinite(price) || price < 0) {
    showMessage("form-message", "Enter a valid price of 0 or more.", true);
    return;
  }

  const submitButton = event.submitter || form.querySelector('[type="submit"]');

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Adding...";
  }

  try {
    await api("/products", {
      method: "POST",
      body: JSON.stringify({
        product_name: name,
        category,
        unit_price: price,
        stock_quantity: quantity
      })
    });

    form.reset();
    showMessage("form-message", "Product added successfully.");

    await loadProducts();
    await loadDashboard();
  } catch (error) {
    console.error("Add product error:", error);
    showMessage("form-message", "Unable to add product: " + error.message, true);
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "+ Add Product";
    }
  }
}

// ========================================
// REPORTS
// ========================================

function renderReport() {
  const container = $("report-content");
  if (!container) return;

  const metrics = getMetrics(state.dashboard || {});

  const sales = getValue(metrics, ["totalSales", "total_sales", "sales"]);
  const expenses = getValue(metrics, ["totalExpenses", "total_expenses", "expenses"]);
  const profit = getValue(metrics, [
    "netProfit", "net_profit", "operatingProfit", "operating_profit"
  ]);

  if (sales === null || expenses === null) {
    container.textContent = "Report data is unavailable. Refresh the dashboard first.";
    return;
  }

  const calculatedProfit = profit === null ? Number(sales) - Number(expenses) : Number(profit);

  const productCount = getValue(metrics, [
    "totalProducts", "total_products", "productCount", "product_count"
  ]);

  container.innerHTML = `
    <div class="report-summary">
      <h3>Business Summary</h3>
      <p><strong>Total Sales:</strong> ${escapeHTML(money(sales))}</p>
      <p><strong>Total Expenses:</strong> ${escapeHTML(money(expenses))}</p>
      <p><strong>Operating Profit:</strong> ${escapeHTML(money(calculatedProfit))}</p>
      <p><strong>Total Products:</strong> ${escapeHTML(number(productCount ?? state.products.length))}</p>
    </div>
  `;
}

async function report() {
  const button = $("report-btn");

  if (button) {
    button.disabled = true;
    button.textContent = "Generating...";
  }

  try {
    await loadDashboard();
    renderReport();
  } catch (error) {
    console.error("Report error:", error);
    if ($("report-content")) {
      $("report-content").textContent = "Unable to generate report: " + error.message;
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Generate Summary";
    }
  }
}

// ========================================
// REFRESH
// ========================================

async function refresh() {
  if (state.loading) return;

  state.loading = true;
  const button = $("refresh-btn");

  if (button) {
    button.disabled = true;
    button.textContent = "Refreshing...";
  }

  try {
    await loadDashboard();

    if (state.currentPage === "sales") await loadSales();
    if (state.currentPage === "expenses") await loadExpenses();
    if (state.currentPage === "inventory") await loadProducts();
    if (state.currentPage === "reports") renderReport();
  } catch (error) {
    console.error("Refresh error:", error);
    showDashboardError("Refresh failed: " + error.message);
  } finally {
    state.loading = false;

    if (button) {
      button.disabled = false;
      button.textContent = "↻ Refresh";
    }
  }
}

// ========================================
// INITIALIZE
// ========================================

async function initialize() {
  try {
    const session = await api("/session");

    if (!session.authenticated) {
      window.location.href = "/login";
      return;
    }
  } catch (error) {
    console.error("Session check failed:", error);

    if ($("api-message")) {
      $("api-message").textContent = error.message;
    }

    window.location.href = "/login";
    return;
  }

  document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      page(link.dataset.page);
    });
  });

  document.querySelectorAll("[data-open]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      page(button.dataset.open);
    });
  });

  $("refresh-btn")?.addEventListener("click", refresh);
  $("product-form")?.addEventListener("submit", addProduct);
  $("report-btn")?.addEventListener("click", report);

  $("logout-btn")?.addEventListener("click", async () => {
    try {
      await api("/logout", { method: "POST" });
    } catch (error) {
      console.error("Logout error:", error);
    }

    window.location.href = "/login";
  });

  window.addEventListener("hashchange", () => {
    const requestedPage = window.location.hash.slice(1);
    if (validPages.includes(requestedPage) && requestedPage !== state.currentPage) {
      page(requestedPage);
    }
  });

  const requestedPage = window.location.hash.slice(1);
  await page(validPages.includes(requestedPage) ? requestedPage : "dashboard");
}

document.addEventListener("DOMContentLoaded", initialize);