require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const oracledb = require("oracledb");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const FRONTEND = path.join(__dirname, "frontend");
const COOKIE_NAME = "bizpilot_session";
const SESSION_DURATION = 8 * 60 * 60 * 1000;

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

// =====================================================
// ORACLE CLIENT
// =====================================================
if (process.env.ORACLE_CLIENT_LIB_DIR) {
  try {
    oracledb.initOracleClient({
      libDir: process.env.ORACLE_CLIENT_LIB_DIR.trim()
    });
    console.log("Oracle Client initialized.");
  } catch (err) {
    if (!String(err.message).toLowerCase().includes("already")) {
      console.error("Oracle Client error:", err.message);
    }
  }
}

// =====================================================
// STATIC FILES
// =====================================================
app.use("/static", express.static(path.join(FRONTEND, "static")));
app.use(express.static(FRONTEND));

// =====================================================
// AUTHENTICATION
// =====================================================
const adminUsername = process.env.ADMIN_USERNAME;
const adminPassword = process.env.ADMIN_PASSWORD;
const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret || sessionSecret.length < 32) {
  console.error("SESSION_SECRET must contain at least 32 characters.");
  process.exit(1);
}

const sessions = new Map();

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;

  const first = Buffer.from(a);
  const second = Buffer.from(b);

  return first.length === second.length &&
    crypto.timingSafeEqual(first, second);
}

function signSession(id) {
  return crypto
    .createHmac("sha256", sessionSecret)
    .update(id)
    .digest("hex");
}

function getCookie(req, name) {
  const cookies = (req.headers.cookie || "").split(";");

  for (const item of cookies) {
    const index = item.indexOf("=");
    if (index < 0) continue;

    if (item.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(item.slice(index + 1).trim());
      } catch {
        return null;
      }
    }
  }

  return null;
}

function createSession(username) {
  const id = crypto.randomBytes(32).toString("hex");

  sessions.set(id, {
    username,
    expiresAt: Date.now() + SESSION_DURATION
  });

  return id + "." + signSession(id);
}

function getSession(req) {
  const token = getCookie(req, COOKIE_NAME);
  if (!token) return null;

  const separator = token.lastIndexOf(".");
  if (separator < 1) return null;

  const id = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  if (!safeEqual(signature, signSession(id))) return null;

  const session = sessions.get(id);
  if (!session) return null;

  if (session.expiresAt <= Date.now()) {
    sessions.delete(id);
    return null;
  }

  return { id, ...session };
}

function requireAuth(req, res, next) {
  const session = getSession(req);

  if (!session) {
    return res.status(401).json({
      success: false,
      message: "Session expired. Please log in again."
    });
  }

  req.user = session.username;
  next();
}

// =====================================================
// ORACLE DATABASE
// =====================================================
function oracleConfig() {
  const user = process.env.ORACLE_USER;
  const password = process.env.ORACLE_PASSWORD;

  const connectString =
    process.env.ORACLE_DSN ||
    (process.env.ORACLE_HOST
      ? `${process.env.ORACLE_HOST}:${process.env.ORACLE_PORT || "1521"}/${process.env.ORACLE_SERVICE || "xe"}`
      : null);

  if (!user || !password || !connectString) {
    throw new Error(
      "Oracle configuration missing. Check ORACLE_USER, ORACLE_PASSWORD and ORACLE_DSN/ORACLE_HOST in .env."
    );
  }

  return { user, password, connectString };
}

async function withConnection(callback) {
  let connection;

  try {
    connection = await oracledb.getConnection(oracleConfig());
    return await callback(connection);
  } finally {
    if (connection) await connection.close();
  }
}

async function query(sql, binds = {}, options = {}) {
  return withConnection(connection =>
    connection.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      ...options
    })
  );
}

// FIX: Oracle error ab production ke ilawa hamesha message mein dikhega
// (taake frontend par asli ORA- error nazar aaye).
function sendError(res, err, message) {
  console.error(`[${message}]`, err);

  const showDetail = process.env.NODE_ENV !== "production";

  return res.status(500).json({
    success: false,
    message: showDetail ? `${message} ${err.message}` : message,
    detail: showDetail ? err.message : undefined
  });
}

function numberValue(value) {
  return Number(value || 0);
}

// =====================================================
// WEB PAGES
// =====================================================
app.get("/", (req, res) => {
  res.redirect(getSession(req) ? "/dashboard" : "/login");
});

app.get("/login", (req, res) => {
  if (getSession(req)) return res.redirect("/dashboard");
  res.sendFile(path.join(FRONTEND, "login.html"));
});

app.get("/dashboard", (req, res) => {
  if (!getSession(req)) return res.redirect("/login");
  res.sendFile(path.join(FRONTEND, "index.html"));
});

// =====================================================
// LOGIN
// =====================================================
app.post("/api/login", (req, res) => {
  if (!adminUsername || !adminPassword) {
    return res.status(500).json({
      success: false,
      message: "Set ADMIN_USERNAME and ADMIN_PASSWORD in .env."
    });
  }

  const username = req.body?.username;
  const password = req.body?.password;

  if (
    !safeEqual(username, adminUsername) ||
    !safeEqual(password, adminPassword)
  ) {
    return res.status(401).json({
      success: false,
      message: "Invalid username or password."
    });
  }

  const token = createSession(username);

  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`
  );

  res.json({ success: true, message: "Login successful." });
});

app.get("/api/session", (req, res) => {
  const session = getSession(req);

  res.json({
    success: true,
    authenticated: Boolean(session),
    username: session?.username || null
  });
});

app.post("/api/logout", (req, res) => {
  const session = getSession(req);
  if (session) sessions.delete(session.id);

  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
  );

  res.json({ success: true, message: "Logged out." });
});

// =====================================================
// HEALTH CHECK
// =====================================================
app.get("/api/health", async (req, res) => {
  try {
    const result = await query("SELECT 1 AS STATUS FROM DUAL");

    res.json({
      success: true,
      database: "connected",
      result: result.rows
    });
  } catch (err) {
    sendError(res, err, "Oracle database connection failed.");
  }
});

// =====================================================
// DATABASE SCHEMA
// =====================================================
app.get("/api/schema", requireAuth, async (req, res) => {
  try {
    const result = await query(`
      SELECT table_name, column_name, data_type
      FROM user_tab_columns
      ORDER BY table_name, column_id
    `);

    res.json({ success: true, columns: result.rows || [] });
  } catch (err) {
    sendError(res, err, "Could not inspect Oracle schema.");
  }
});

// =====================================================
// DASHBOARD
// Compatible with Oracle 11g
// FIX: products table mein column PRICE hai (UNIT_PRICE nahi)
// =====================================================
app.get("/api/dashboard", requireAuth, async (req, res) => {
  try {
    const metricsResult = await query(`
      SELECT
        (SELECT NVL(SUM(total_amount), 0) FROM sales) AS TOTAL_SALES,
        (SELECT NVL(SUM(amount), 0) FROM expenses) AS TOTAL_EXPENSES,
        (SELECT COUNT(*) FROM products) AS TOTAL_PRODUCTS,
        (SELECT NVL(SUM(stock_quantity * price), 0)
         FROM products) AS INVENTORY_VALUE,
        (SELECT COUNT(*) FROM products
         WHERE stock_quantity <= 5) AS LOW_STOCK_COUNT
      FROM dual
    `);

    const metrics = metricsResult.rows[0] || {};
    const totalSales = numberValue(metrics.TOTAL_SALES);
    const totalExpenses = numberValue(metrics.TOTAL_EXPENSES);

    const productsResult = await query(`
      SELECT *
      FROM (
        SELECT product_id, product_name, category,
               price AS unit_price, stock_quantity, created_at
        FROM products
        ORDER BY created_at DESC NULLS LAST
      )
      WHERE ROWNUM <= 5
    `);

    const salesResult = await query(`
      SELECT *
      FROM (
        SELECT s.sale_id, p.product_name, s.quantity,
               s.unit_price, s.total_amount, s.sale_date
        FROM sales s
        LEFT JOIN products p ON p.product_id = s.product_id
        ORDER BY s.sale_date DESC NULLS LAST
      )
      WHERE ROWNUM <= 5
    `);

    res.json({
      success: true,
      database: "connected",
      metrics: {
        totalSales,
        totalExpenses,
        totalProducts: numberValue(metrics.TOTAL_PRODUCTS),
        operatingProfit: totalSales - totalExpenses,
        inventoryValue: numberValue(metrics.INVENTORY_VALUE),
        lowStockCount: numberValue(metrics.LOW_STOCK_COUNT)
      },
      products: productsResult.rows || [],
      recentSales: salesResult.rows || []
    });
  } catch (err) {
    sendError(res, err, "Could not load dashboard.");
  }
});

// =====================================================
// PRODUCTS - GET
// =====================================================
app.get("/api/products", requireAuth, async (req, res) => {
  try {
    const result = await query(`
      SELECT product_id, product_name, category,
             price AS unit_price, stock_quantity, created_at
      FROM products
      ORDER BY product_id DESC
    `);

    res.json({
      success: true,
      products: result.rows || []
    });
  } catch (err) {
    sendError(res, err, "Could not load products.");
  }
});

// =====================================================
// PRODUCTS - ADD
// =====================================================
app.post("/api/products", requireAuth, async (req, res) => {
  const productName = String(req.body?.product_name || "").trim();
  const category = String(req.body?.category || "").trim();
  const unitPrice = Number(req.body?.unit_price);
  const stockQuantity = Number(req.body?.stock_quantity);

  if (!productName || !category) {
    return res.status(400).json({
      success: false,
      message: "Product name and category are required."
    });
  }

  if (
    !Number.isFinite(unitPrice) ||
    unitPrice < 0 ||
    !Number.isInteger(stockQuantity) ||
    stockQuantity < 0
  ) {
    return res.status(400).json({
      success: false,
      message: "Enter a valid price and whole-number stock quantity."
    });
  }

  try {
    await withConnection(async connection => {
      await connection.execute(
        `INSERT INTO products
          (product_id, product_name, category,
           price, stock_quantity, created_at)
         VALUES
          (products_seq.NEXTVAL, :productName, :category,
           :unitPrice, :stockQuantity, SYSDATE)`,
        { productName, category, unitPrice, stockQuantity },
        { autoCommit: true }
      );
    });

    res.status(201).json({
      success: true,
      message: "Product added successfully."
    });
  } catch (err) {
    sendError(res, err, "Could not add product.");
  }
});

// =====================================================
// EXPENSES - GET
// =====================================================
app.get("/api/expenses", requireAuth, async (req, res) => {
  try {
    const result = await query(`
      SELECT expense_id, description, category, amount, expense_date
      FROM expenses
      ORDER BY expense_date DESC NULLS LAST
    `);

    res.json({
      success: true,
      expenses: result.rows || []
    });
  } catch (err) {
    sendError(res, err, "Could not load expenses.");
  }
});

// =====================================================
// SALES - GET
// =====================================================
app.get("/api/sales", requireAuth, async (req, res) => {
  try {
    const result = await query(`
      SELECT s.sale_id, s.product_id, p.product_name,
             s.quantity, s.unit_price, s.total_amount, s.sale_date
      FROM sales s
      LEFT JOIN products p ON p.product_id = s.product_id
      ORDER BY s.sale_date DESC NULLS LAST
    `);

    res.json({
      success: true,
      sales: result.rows || []
    });
  } catch (err) {
    sendError(res, err, "Could not load sales.");
  }
});

// =====================================================
// GENERIC READ-ONLY TABLE API
// =====================================================
app.get("/api/table/:table", requireAuth, async (req, res) => {
  const table = String(req.params.table || "").toUpperCase();

  if (!/^[A-Z][A-Z0-9_$#]*$/.test(table)) {
    return res.status(400).json({
      success: false,
      message: "Invalid table name."
    });
  }

  try {
    const check = await query(
      "SELECT table_name FROM user_tables WHERE table_name = :name",
      { name: table }
    );

    if (!check.rows?.length) {
      return res.status(404).json({
        success: false,
        message: "Table not found in the connected Oracle schema."
      });
    }

    const result = await query(
      `SELECT * FROM "${table}" WHERE ROWNUM <= 100`
    );

    res.json({
      success: true,
      table,
      rows: result.rows || []
    });
  } catch (err) {
    sendError(res, err, "Could not read table.");
  }
});

// =====================================================
// API NOT FOUND
// =====================================================
app.use("/api", (req, res) => {
  res.status(404).json({
    success: false,
    message: `API route not found: ${req.method} ${req.originalUrl}`
  });
});

// =====================================================
// ERROR HANDLER
// =====================================================
app.use((err, req, res, next) => {
  console.error("Server error:", err);

  if (req.path.startsWith("/api/")) {
    return res.status(500).json({
      success: false,
      message: "Internal server error."
    });
  }

  res.status(500).send("Internal server error.");
});

// =====================================================
// START SERVER
// =====================================================
app.listen(PORT, () => {
  console.log(`BizPilot AI server running at http://localhost:${PORT}`);
});