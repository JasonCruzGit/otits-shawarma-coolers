import express from "express";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dayjs from "dayjs";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { nanoid } from "nanoid";
import { mkdir, access, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { stringify } from "csv-stringify/sync";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, "..", "data", "db.json");
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret";
const PORT = process.env.PORT || 4000;

const Role = {
  ADMIN: "admin",
  MANAGER: "manager",
  CASHIER: "cashier",
};

const PaymentType = {
  CASH: "cash",
  QR: "qr",
};

const defaultData = {
  branches: [
    { id: "branch-rizal", name: "Otit's Rizal Ave Branch", isActive: true },
    { id: "branch-ppia", name: "Otit's PPIA Branch", isActive: true },
  ],
  categories: [
    { id: "cat-shawarma", name: "Shawarma" },
    { id: "cat-coolers", name: "Coolers" },
    { id: "cat-addons", name: "Add-ons" },
  ],
  products: [
    {
      id: "prod-chicken-wrap",
      name: "Chicken Shawarma Wrap",
      categoryId: "cat-shawarma",
      price: 89,
      isActive: true,
      recipe: [
        { inventoryItemId: "inv-pita", qtyPerUnit: 1 },
        { inventoryItemId: "inv-chicken", qtyPerUnit: 120 },
      ],
    },
    {
      id: "prod-beef-wrap",
      name: "Beef Shawarma Wrap",
      categoryId: "cat-shawarma",
      price: 99,
      isActive: true,
      recipe: [
        { inventoryItemId: "inv-pita", qtyPerUnit: 1 },
        { inventoryItemId: "inv-beef", qtyPerUnit: 130 },
      ],
    },
    {
      id: "prod-cucumber-cooler",
      name: "Cucumber Cooler",
      categoryId: "cat-coolers",
      price: 55,
      isActive: true,
      recipe: [{ inventoryItemId: "inv-cucumber-syrup", qtyPerUnit: 30 }],
    },
    {
      id: "prod-extra-cheese",
      name: "Extra Cheese",
      categoryId: "cat-addons",
      price: 15,
      isActive: true,
      recipe: [{ inventoryItemId: "inv-cheese", qtyPerUnit: 20 }],
    },
  ],
  inventoryByBranch: [],
  orders: [],
  users: [],
  inventoryLogs: [],
  stockTransfers: [],
};

const seedInventoryTemplate = [
  { id: "inv-pita", name: "Pita Bread", uom: "pcs", qty: 200, lowStockThreshold: 40 },
  { id: "inv-chicken", name: "Chicken Meat", uom: "grams", qty: 12000, lowStockThreshold: 2500 },
  { id: "inv-beef", name: "Beef Meat", uom: "grams", qty: 9000, lowStockThreshold: 2000 },
  { id: "inv-cucumber-syrup", name: "Cucumber Syrup", uom: "ml", qty: 7000, lowStockThreshold: 1200 },
  { id: "inv-cheese", name: "Cheese", uom: "grams", qty: 3000, lowStockThreshold: 600 },
];

async function ensureDbFile() {
  await mkdir(path.join(__dirname, "..", "data"), { recursive: true });
  try {
    await access(DB_PATH, constants.F_OK);
  } catch {
    await writeFile(DB_PATH, JSON.stringify(defaultData, null, 2));
  }
}

await ensureDbFile();
const adapter = new JSONFile(DB_PATH);
const db = new Low(adapter, defaultData);
await db.read();
db.data ||= structuredClone(defaultData);

function withDefaults() {
  db.data.branches ||= defaultData.branches;
  db.data.categories ||= defaultData.categories;
  db.data.products ||= defaultData.products;
  db.data.inventoryByBranch ||= [];
  db.data.orders ||= [];
  db.data.users ||= [];
  db.data.inventoryLogs ||= [];
  db.data.stockTransfers ||= [];
}

async function seed() {
  withDefaults();
  if (!db.data.users.length) {
    const adminPasswordHash = await bcrypt.hash("admin1234", 10);
    const managerPasswordHash = await bcrypt.hash("manager1234", 10);
    const cashierPasswordHash = await bcrypt.hash("cashier1234", 10);
    db.data.users.push(
      {
        id: "user-admin",
        fullName: "System Admin",
        username: "admin",
        passwordHash: adminPasswordHash,
        role: Role.ADMIN,
        branchId: null,
        isActive: true,
      },
      {
        id: "user-manager-rizal",
        fullName: "Rizal Manager",
        username: "rizal.manager",
        passwordHash: managerPasswordHash,
        role: Role.MANAGER,
        branchId: "branch-rizal",
        isActive: true,
      },
      {
        id: "user-cashier-ppia",
        fullName: "PPIA Cashier",
        username: "ppia.cashier",
        passwordHash: cashierPasswordHash,
        role: Role.CASHIER,
        branchId: "branch-ppia",
        isActive: true,
      }
    );
  }

  if (!db.data.inventoryByBranch.length) {
    db.data.inventoryByBranch = db.data.branches.map((branch) => ({
      branchId: branch.id,
      items: seedInventoryTemplate.map((item) => ({ ...item })),
    }));
  }

  await db.write();
}

await seed();

function publicUser(user) {
  return {
    id: user.id,
    fullName: user.fullName,
    username: user.username,
    role: user.role,
    branchId: user.branchId,
    isActive: user.isActive,
  };
}

function tokenForUser(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      branchId: user.branchId,
    },
    JWT_SECRET,
    { expiresIn: "16h" }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Missing Bearer token." });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.data.users.find((u) => u.id === payload.sub && u.isActive);
    if (!user) return res.status(401).json({ message: "User not found or inactive." });
    req.user = publicUser(user);
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
}

function allow(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden: insufficient permissions." });
    }
    return next();
  };
}

function resolveBranchScope(req, branchIdFromQueryOrBody) {
  if (req.user.role === Role.ADMIN) return branchIdFromQueryOrBody;
  return req.user.branchId;
}

function getBranchInventory(branchId) {
  return db.data.inventoryByBranch.find((entry) => entry.branchId === branchId);
}

function startDateByPeriod(period) {
  const now = dayjs();
  if (period === "daily") return now.startOf("day");
  if (period === "weekly") return now.startOf("week");
  return now.startOf("month");
}

function summarizeOrders(orders) {
  const totalSales = orders.reduce((sum, o) => sum + o.total, 0);
  const transactionCount = orders.length;
  const itemCountMap = {};
  for (const order of orders) {
    for (const item of order.items) {
      itemCountMap[item.productName] = (itemCountMap[item.productName] || 0) + item.qty;
    }
  }
  const bestSellingItems = Object.entries(itemCountMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, sold]) => ({ name, sold }));

  return { totalSales, transactionCount, bestSellingItems };
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(morgan("dev"));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", app: "Otit's POS API", now: new Date().toISOString() });
});

app.post("/api/auth/login", async (req, res) => {
  const schema = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid login payload." });

  const { username, password } = parsed.data;
  const user = db.data.users.find((u) => u.username === username && u.isActive);
  if (!user) return res.status(401).json({ message: "Invalid credentials." });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ message: "Invalid credentials." });

  res.json({
    token: tokenForUser(user),
    user: publicUser(user),
    demoCredentials: {
      admin: "admin / admin1234",
      manager: "rizal.manager / manager1234",
      cashier: "ppia.cashier / cashier1234",
    },
  });
});

app.get("/api/auth/me", auth, (req, res) => {
  res.json(req.user);
});

app.get("/api/branches", auth, (_req, res) => {
  res.json(db.data.branches);
});

app.get("/api/catalog", auth, (_req, res) => {
  res.json({
    categories: db.data.categories,
    products: db.data.products.filter((p) => p.isActive),
  });
});

app.post("/api/products", auth, allow(Role.ADMIN), (req, res) => {
  const schema = z.object({
    name: z.string().min(1),
    categoryId: z.string().min(1),
    price: z.number().positive(),
    recipe: z
      .array(
        z.object({
          inventoryItemId: z.string().min(1),
          qtyPerUnit: z.number().positive(),
        })
      )
      .default([]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid product payload." });

  const product = {
    id: `prod-${nanoid(8)}`,
    ...parsed.data,
    isActive: true,
  };
  db.data.products.push(product);
  db.write();
  res.status(201).json(product);
});

app.patch("/api/products/:id", auth, allow(Role.ADMIN), (req, res) => {
  const product = db.data.products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ message: "Product not found." });
  Object.assign(product, req.body);
  db.write();
  res.json(product);
});

app.get("/api/inventory", auth, (req, res) => {
  const branchId = resolveBranchScope(req, req.query.branchId);
  if (!branchId) return res.status(400).json({ message: "branchId is required." });

  const inventory = getBranchInventory(branchId);
  if (!inventory) return res.status(404).json({ message: "Inventory not found." });
  res.json(inventory);
});

app.get("/api/inventory/alerts", auth, (req, res) => {
  const branchId = resolveBranchScope(req, req.query.branchId);
  const inventory = getBranchInventory(branchId);
  if (!inventory) return res.status(404).json({ message: "Inventory not found." });
  const lowStockItems = inventory.items.filter((item) => item.qty <= item.lowStockThreshold);
  res.json({ branchId, lowStockItems });
});

app.post("/api/inventory/adjust", auth, allow(Role.ADMIN, Role.MANAGER), (req, res) => {
  const schema = z.object({
    branchId: z.string().min(1),
    inventoryItemId: z.string().min(1),
    qtyDelta: z.number(),
    reason: z.string().min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid adjustment payload." });

  const { branchId: incomingBranch, inventoryItemId, qtyDelta, reason } = parsed.data;
  const branchId = resolveBranchScope(req, incomingBranch);
  const inventory = getBranchInventory(branchId);
  if (!inventory) return res.status(404).json({ message: "Inventory not found." });
  const item = inventory.items.find((i) => i.id === inventoryItemId);
  if (!item) return res.status(404).json({ message: "Inventory item not found." });

  item.qty = Math.max(0, item.qty + qtyDelta);
  db.data.inventoryLogs.push({
    id: `log-${nanoid(10)}`,
    branchId,
    inventoryItemId,
    qtyDelta,
    reason,
    actorUserId: req.user.id,
    at: new Date().toISOString(),
  });
  db.write();
  res.json({ item });
});

app.post("/api/inventory/transfer", auth, allow(Role.ADMIN, Role.MANAGER), (req, res) => {
  const schema = z.object({
    fromBranchId: z.string().min(1),
    toBranchId: z.string().min(1),
    inventoryItemId: z.string().min(1),
    qty: z.number().positive(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid transfer payload." });

  let { fromBranchId, toBranchId, inventoryItemId, qty } = parsed.data;
  if (req.user.role !== Role.ADMIN) {
    fromBranchId = req.user.branchId;
  }

  const fromInv = getBranchInventory(fromBranchId);
  const toInv = getBranchInventory(toBranchId);
  if (!fromInv || !toInv) return res.status(404).json({ message: "Branch inventory not found." });

  const fromItem = fromInv.items.find((i) => i.id === inventoryItemId);
  const toItem = toInv.items.find((i) => i.id === inventoryItemId);
  if (!fromItem || !toItem) return res.status(404).json({ message: "Inventory item not found." });
  if (fromItem.qty < qty) return res.status(400).json({ message: "Insufficient source stock." });

  fromItem.qty -= qty;
  toItem.qty += qty;

  const transfer = {
    id: `tr-${nanoid(10)}`,
    fromBranchId,
    toBranchId,
    inventoryItemId,
    qty,
    byUserId: req.user.id,
    at: new Date().toISOString(),
  };
  db.data.stockTransfers.push(transfer);
  db.write();
  res.status(201).json(transfer);
});

function processSale(orderPayload, actorUser) {
  const branchId = actorUser.role === Role.ADMIN ? orderPayload.branchId : actorUser.branchId;
  const inventory = getBranchInventory(branchId);
  if (!inventory) throw new Error("Inventory not found.");

  const lineItems = [];
  let subtotal = 0;
  let addonsTotal = 0;

  for (const item of orderPayload.items) {
    const product = db.data.products.find((p) => p.id === item.productId && p.isActive);
    if (!product) throw new Error(`Invalid product: ${item.productId}`);
    const qty = item.qty || 1;
    const lineBase = product.price * qty;
    const lineAddon = (item.addOns || []).reduce((sum, a) => sum + a.price * qty, 0);
    subtotal += lineBase;
    addonsTotal += lineAddon;

    lineItems.push({
      productId: product.id,
      productName: product.name,
      qty,
      unitPrice: product.price,
      addOns: item.addOns || [],
      lineTotal: lineBase + lineAddon,
    });

    for (const recipeItem of product.recipe || []) {
      const inv = inventory.items.find((invItem) => invItem.id === recipeItem.inventoryItemId);
      if (!inv) continue;
      const deduct = recipeItem.qtyPerUnit * qty;
      inv.qty = Math.max(0, inv.qty - deduct);
      db.data.inventoryLogs.push({
        id: `log-${nanoid(10)}`,
        branchId,
        inventoryItemId: inv.id,
        qtyDelta: -deduct,
        reason: "Auto-deduct from sale",
        actorUserId: actorUser.id,
        at: new Date().toISOString(),
      });
    }
  }

  const total = subtotal + addonsTotal;
  const receivedAmount =
    orderPayload.paymentType === PaymentType.CASH ? Number(orderPayload.receivedAmount || total) : total;
  const changeAmount = Math.max(0, receivedAmount - total);
  const now = new Date().toISOString();
  const receiptNo = `OT-${dayjs().format("YYYYMMDD")}-${Math.floor(Math.random() * 90000 + 10000)}`;

  const order = {
    id: `ord-${nanoid(12)}`,
    receiptNo,
    branchId,
    items: lineItems,
    subtotal,
    addonsTotal,
    total,
    paymentType: orderPayload.paymentType,
    receivedAmount,
    changeAmount,
    customerName: orderPayload.customerName || "Walk-in",
    isSynced: !!orderPayload.isSynced,
    createdBy: actorUser.id,
    createdAt: now,
  };
  db.data.orders.push(order);
  return order;
}

app.post("/api/orders", auth, allow(Role.ADMIN, Role.MANAGER, Role.CASHIER), (req, res) => {
  const schema = z.object({
    branchId: z.string().optional(),
    items: z
      .array(
        z.object({
          productId: z.string().min(1),
          qty: z.number().int().positive(),
          addOns: z.array(z.object({ name: z.string(), price: z.number().nonnegative() })).optional(),
        })
      )
      .min(1),
    paymentType: z.enum([PaymentType.CASH, PaymentType.QR]),
    receivedAmount: z.number().optional(),
    customerName: z.string().optional(),
    isSynced: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid order payload." });

  try {
    const order = processSale(parsed.data, req.user);
    db.write();
    return res.status(201).json({
      order,
      receipt: {
        businessName: "Otit's Shawarma & Coolers",
        branch: db.data.branches.find((b) => b.id === order.branchId)?.name,
        receiptNo: order.receiptNo,
        createdAt: order.createdAt,
        lines: order.items,
        total: order.total,
        paymentType: order.paymentType,
        receivedAmount: order.receivedAmount,
        changeAmount: order.changeAmount,
      },
    });
  } catch (error) {
    return res.status(400).json({ message: error.message || "Failed to create order." });
  }
});

app.post("/api/sync/offline-orders", auth, allow(Role.ADMIN, Role.MANAGER, Role.CASHIER), (req, res) => {
  const schema = z.object({
    orders: z.array(
      z.object({
        branchId: z.string().optional(),
        items: z.array(
          z.object({
            productId: z.string(),
            qty: z.number().int().positive(),
            addOns: z.array(z.object({ name: z.string(), price: z.number() })).optional(),
          })
        ),
        paymentType: z.enum([PaymentType.CASH, PaymentType.QR]),
        receivedAmount: z.number().optional(),
        customerName: z.string().optional(),
      })
    ),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid sync payload." });

  const synced = [];
  for (const orderPayload of parsed.data.orders) {
    const order = processSale({ ...orderPayload, isSynced: true }, req.user);
    synced.push(order);
  }
  db.write();
  res.json({ syncedCount: synced.length, synced });
});

app.get("/api/orders", auth, (req, res) => {
  const branchId = resolveBranchScope(req, req.query.branchId);
  const from = req.query.from ? dayjs(req.query.from) : null;
  const to = req.query.to ? dayjs(req.query.to) : null;

  let orders = [...db.data.orders];
  if (branchId) orders = orders.filter((o) => o.branchId === branchId);
  if (from && from.isValid()) orders = orders.filter((o) => dayjs(o.createdAt).isAfter(from) || dayjs(o.createdAt).isSame(from));
  if (to && to.isValid()) orders = orders.filter((o) => dayjs(o.createdAt).isBefore(to) || dayjs(o.createdAt).isSame(to));
  orders.sort((a, b) => dayjs(b.createdAt).valueOf() - dayjs(a.createdAt).valueOf());
  res.json(orders);
});

app.get("/api/dashboard/summary", auth, (req, res) => {
  const branchId = resolveBranchScope(req, req.query.branchId);
  const period = req.query.period || "daily";
  const startDate = startDateByPeriod(period);

  const filterOrders = db.data.orders.filter((order) => {
    if (branchId && order.branchId !== branchId) return false;
    return dayjs(order.createdAt).isAfter(startDate) || dayjs(order.createdAt).isSame(startDate);
  });

  const summary = summarizeOrders(filterOrders);
  res.json({
    period,
    startDate: startDate.toISOString(),
    branchId: branchId || "all",
    ...summary,
  });
});

app.get("/api/admin/overview", auth, allow(Role.ADMIN), (_req, res) => {
  const byBranch = db.data.branches.map((branch) => {
    const branchOrders = db.data.orders.filter((o) => o.branchId === branch.id);
    const summary = summarizeOrders(branchOrders);
    return { branchId: branch.id, branchName: branch.name, ...summary };
  });
  const consolidated = summarizeOrders(db.data.orders);
  res.json({ consolidated, byBranch });
});

app.get("/api/admin/users", auth, allow(Role.ADMIN), (_req, res) => {
  res.json(db.data.users.map(publicUser));
});

app.post("/api/admin/users", auth, allow(Role.ADMIN), async (req, res) => {
  const schema = z.object({
    fullName: z.string().min(2),
    username: z.string().min(2),
    password: z.string().min(6),
    role: z.enum([Role.ADMIN, Role.MANAGER, Role.CASHIER]),
    branchId: z.string().nullable().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid user payload." });
  if (db.data.users.some((u) => u.username === parsed.data.username)) {
    return res.status(400).json({ message: "Username is already taken." });
  }
  const user = {
    id: `user-${nanoid(10)}`,
    fullName: parsed.data.fullName,
    username: parsed.data.username,
    passwordHash: await bcrypt.hash(parsed.data.password, 10),
    role: parsed.data.role,
    branchId: parsed.data.role === Role.ADMIN ? null : parsed.data.branchId,
    isActive: true,
  };
  db.data.users.push(user);
  db.write();
  res.status(201).json(publicUser(user));
});

app.get("/api/reports/sales.csv", auth, allow(Role.ADMIN, Role.MANAGER), (req, res) => {
  const branchId = resolveBranchScope(req, req.query.branchId);
  const rows = db.data.orders
    .filter((o) => (branchId ? o.branchId === branchId : true))
    .map((o) => ({
      receiptNo: o.receiptNo,
      createdAt: o.createdAt,
      branchId: o.branchId,
      total: o.total,
      paymentType: o.paymentType,
      items: o.items.map((i) => `${i.productName} x${i.qty}`).join(" | "),
    }));
  const csv = stringify(rows, { header: true });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=sales-report.csv");
  res.send(csv);
});

app.get("/api/reports/inventory-usage.csv", auth, allow(Role.ADMIN, Role.MANAGER), (req, res) => {
  const branchId = resolveBranchScope(req, req.query.branchId);
  const rows = db.data.inventoryLogs
    .filter((log) => (branchId ? log.branchId === branchId : true))
    .map((log) => ({
      at: log.at,
      branchId: log.branchId,
      inventoryItemId: log.inventoryItemId,
      qtyDelta: log.qtyDelta,
      reason: log.reason,
      actorUserId: log.actorUserId,
    }));
  const csv = stringify(rows, { header: true });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=inventory-usage.csv");
  res.send(csv);
});

app.get("/api/system/backup", auth, allow(Role.ADMIN), (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename=otits-pos-backup-${dayjs().format("YYYYMMDD-HHmm")}.json`);
  res.send(JSON.stringify(db.data, null, 2));
});

app.post("/api/system/restore", auth, allow(Role.ADMIN), async (req, res) => {
  const schema = z.object({ data: z.any() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid restore payload." });
  db.data = parsed.data.data;
  withDefaults();
  await db.write();
  res.json({ message: "Backup restored successfully." });
});

app.use((err, _req, res, _next) => {
  res.status(500).json({ message: "Server error", detail: err.message });
});

app.listen(PORT, () => {
  console.log(`Otit's POS API running on http://localhost:${PORT}`);
});
