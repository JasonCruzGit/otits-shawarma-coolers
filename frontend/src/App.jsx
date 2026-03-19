import { useCallback, useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import api, { setAuthToken } from "./api";
import "./App.css";

const tabs = ["POS", "Dashboard", "Inventory", "Admin", "Reports"];

function peso(value) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(value || 0);
}

function saveFileBlob(blob, fileName) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

function getPeriodStart(period) {
  if (period === "daily") return dayjs().startOf("day");
  if (period === "weekly") return dayjs().startOf("week");
  return dayjs().startOf("month");
}

function buildSalesTrend(orders, period) {
  const bucketMap = {};

  for (const order of orders) {
    const ts = dayjs(order.createdAt);
    const bucketStart = period === "daily" ? ts.startOf("hour") : ts.startOf("day");
    const key = bucketStart.format(period === "daily" ? "HH:00" : "MMM D");
    if (!bucketMap[key]) {
      bucketMap[key] = {
        label: key,
        sales: 0,
        transactions: 0,
        sortKey: bucketStart.valueOf(),
      };
    }
    bucketMap[key].sales += order.total;
    bucketMap[key].transactions += 1;
  }

  return Object.values(bucketMap)
    .sort((a, b) => a.sortKey - b.sortKey)
    .map((item) => ({
      label: item.label,
      sales: item.sales,
      transactions: item.transactions,
    }));
}

function buildItemMix(orders) {
  const itemCounts = {};
  for (const order of orders) {
    for (const item of order.items || []) {
      itemCounts[item.productName] = (itemCounts[item.productName] || 0) + item.qty;
    }
  }

  return Object.entries(itemCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, value]) => ({ name, value }));
}

const chartPalette = ["#d4af37", "#c9982f", "#b28329", "#9a6f24", "#815a1e", "#6f4a18"];

function App() {
  const [theme, setTheme] = useState(localStorage.getItem("otitsTheme") || "dark");
  const [token, setToken] = useState(localStorage.getItem("otitsToken") || "");
  const [user, setUser] = useState(
    localStorage.getItem("otitsUser") ? JSON.parse(localStorage.getItem("otitsUser")) : null
  );
  const [loginForm, setLoginForm] = useState({ username: "admin", password: "admin1234" });
  const [authError, setAuthError] = useState("");

  const [activeTab, setActiveTab] = useState("POS");
  const [branches, setBranches] = useState([]);
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [selectedPeriod, setSelectedPeriod] = useState("daily");

  const [cart, setCart] = useState([]);
  const [paymentType, setPaymentType] = useState("cash");
  const [receivedAmount, setReceivedAmount] = useState(0);
  const [lastReceipt, setLastReceipt] = useState(null);
  const [message, setMessage] = useState("");

  const [summary, setSummary] = useState({ totalSales: 0, transactionCount: 0, bestSellingItems: [] });
  const [salesTrend, setSalesTrend] = useState([]);
  const [itemMix, setItemMix] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [adminOverview, setAdminOverview] = useState({ consolidated: null, byBranch: [] });
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creatingProduct, setCreatingProduct] = useState(false);

  const [adjustForm, setAdjustForm] = useState({
    branchId: "",
    inventoryItemId: "",
    qtyDelta: 0,
    reason: "Manual stock adjustment",
  });
  const [transferForm, setTransferForm] = useState({
    fromBranchId: "",
    toBranchId: "",
    inventoryItemId: "",
    qty: 0,
  });
  const [productForm, setProductForm] = useState({
    name: "",
    categoryId: "",
    price: "",
    recipeText: "",
  });

  const cartTotal = useMemo(() => cart.reduce((sum, line) => sum + line.price * line.qty, 0), [cart]);
  const cartItemCount = useMemo(() => cart.reduce((sum, line) => sum + line.qty, 0), [cart]);
  const canAdminView = user?.role === "admin";
  const isDark = theme === "dark";
  const axisColor = isDark ? "#d7c79b" : "#6b5730";
  const gridColor = isDark ? "rgba(212,175,76,0.25)" : "rgba(128,98,34,0.25)";
  const computedReceived = Number(receivedAmount || 0);
  const computedChange = paymentType === "cash" ? Math.max(0, computedReceived - cartTotal) : 0;
  const computedDue = paymentType === "cash" ? Math.max(0, cartTotal - computedReceived) : 0;

  useEffect(() => {
    setAuthToken(token);
    if (token) localStorage.setItem("otitsToken", token);
    else localStorage.removeItem("otitsToken");
  }, [token]);

  useEffect(() => {
    localStorage.setItem("otitsTheme", theme);
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (user) localStorage.setItem("otitsUser", JSON.stringify(user));
    else localStorage.removeItem("otitsUser");
  }, [user]);

  const loadAllData = useCallback(async () => {
    try {
      setLoading(true);
      const [branchRes, catalogRes, meRes] = await Promise.all([
        api.get("/branches"),
        api.get("/catalog"),
        api.get("/auth/me"),
      ]);
      setBranches(branchRes.data);
      setCategories(catalogRes.data.categories || []);
      setProducts(catalogRes.data.products || []);
      setUser(meRes.data);

      const initialBranch = meRes.data.role === "admin" ? branchRes.data[0]?.id : meRes.data.branchId;
      setSelectedBranch(initialBranch || "");
      setAdjustForm((prev) => ({ ...prev, branchId: initialBranch || "" }));
      setTransferForm((prev) => ({ ...prev, fromBranchId: initialBranch || "" }));
      setProductForm((prev) => ({
        ...prev,
        categoryId: catalogRes.data.categories?.[0]?.id || "",
      }));

      if (meRes.data.role === "admin") {
        const [overviewRes, usersRes] = await Promise.all([api.get("/admin/overview"), api.get("/admin/users")]);
        setAdminOverview(overviewRes.data);
        setUsers(usersRes.data || []);
      }
    } catch (error) {
      setMessage(error?.response?.data?.message || "Failed to load system data.");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshBranchData = useCallback(async () => {
    try {
      const query = selectedBranch ? `?branchId=${selectedBranch}` : "";
      const fromDate = getPeriodStart(selectedPeriod).toISOString();
      const [summaryRes, inventoryRes, alertRes, ordersRes] = await Promise.all([
        api.get(`/dashboard/summary?period=${selectedPeriod}${query ? `&branchId=${selectedBranch}` : ""}`),
        api.get(`/inventory${query}`),
        api.get(`/inventory/alerts${query}`),
        api.get(`/orders?from=${encodeURIComponent(fromDate)}${query ? `&branchId=${selectedBranch}` : ""}`),
      ]);
      setSummary(summaryRes.data);
      setInventory(inventoryRes.data.items || []);
      setAlerts(alertRes.data.lowStockItems || []);
      setSalesTrend(buildSalesTrend(ordersRes.data || [], selectedPeriod));
      setItemMix(buildItemMix(ordersRes.data || []));
    } catch (error) {
      setMessage(error?.response?.data?.message || "Failed to refresh branch metrics.");
    }
  }, [selectedBranch, selectedPeriod]);

  useEffect(() => {
    if (!token) return;
    loadAllData();
  }, [token, loadAllData]);

  useEffect(() => {
    if (!token || !selectedBranch) return;
    refreshBranchData();
  }, [token, selectedBranch, refreshBranchData]);

  async function handleLogin(e) {
    e.preventDefault();
    setAuthError("");
    try {
      const res = await api.post("/auth/login", loginForm);
      setToken(res.data.token);
      setUser(res.data.user);
    } catch (error) {
      setAuthError(error?.response?.data?.message || "Invalid credentials.");
    }
  }

  function logout() {
    setToken("");
    setUser(null);
    setBranches([]);
    setProducts([]);
    setCart([]);
  }

  function addToCart(product) {
    setCart((prev) => {
      const hit = prev.find((line) => line.productId === product.id);
      if (hit) return prev.map((line) => (line.productId === product.id ? { ...line, qty: line.qty + 1 } : line));
      return [...prev, { productId: product.id, name: product.name, price: product.price, qty: 1 }];
    });
  }

  function updateCartQty(productId, qty) {
    if (qty < 1) {
      setCart((prev) => prev.filter((line) => line.productId !== productId));
      return;
    }
    setCart((prev) => prev.map((line) => (line.productId === productId ? { ...line, qty } : line)));
  }

  async function checkout() {
    if (!cart.length) return;
    try {
      const payload = {
        branchId: selectedBranch,
        items: cart.map((line) => ({ productId: line.productId, qty: line.qty })),
        paymentType,
        receivedAmount: paymentType === "cash" ? Number(receivedAmount || cartTotal) : cartTotal,
      };
      const res = await api.post("/orders", payload);
      setLastReceipt(res.data.receipt);
      setMessage(`Sale recorded. Receipt #: ${res.data.receipt.receiptNo}`);
      setCart([]);
      setReceivedAmount(0);
      await refreshBranchData();
      if (user.role === "admin") {
        const overviewRes = await api.get("/admin/overview");
        setAdminOverview(overviewRes.data);
      }
    } catch (error) {
      setMessage(error?.response?.data?.message || "Checkout failed.");
    }
  }

  async function adjustStock(e) {
    e.preventDefault();
    try {
      await api.post("/inventory/adjust", { ...adjustForm, qtyDelta: Number(adjustForm.qtyDelta) });
      setMessage("Stock adjusted successfully.");
      refreshBranchData();
    } catch (error) {
      setMessage(error?.response?.data?.message || "Stock adjustment failed.");
    }
  }

  async function transferStock(e) {
    e.preventDefault();
    try {
      await api.post("/inventory/transfer", { ...transferForm, qty: Number(transferForm.qty) });
      setMessage("Stock transfer completed.");
      refreshBranchData();
    } catch (error) {
      setMessage(error?.response?.data?.message || "Stock transfer failed.");
    }
  }

  async function exportCsv(path, fileName) {
    try {
      const res = await api.get(path, { responseType: "blob" });
      saveFileBlob(res.data, fileName);
      setMessage(`${fileName} exported.`);
    } catch (error) {
      setMessage(error?.response?.data?.message || "Export failed.");
    }
  }

  async function backupJson() {
    try {
      const res = await api.get("/system/backup", { responseType: "blob" });
      saveFileBlob(res.data, `otits-pos-backup-${dayjs().format("YYYYMMDD-HHmm")}.json`);
      setMessage("Backup downloaded.");
    } catch (error) {
      setMessage(error?.response?.data?.message || "Backup failed.");
    }
  }

  async function createProduct(e) {
    e.preventDefault();
    try {
      setCreatingProduct(true);
      const recipe = productForm.recipeText
        .split(",")
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .map((item) => {
          const [inventoryItemId, qtyRaw] = item.split(":").map((v) => v.trim());
          return { inventoryItemId, qtyPerUnit: Number(qtyRaw) };
        })
        .filter((entry) => entry.inventoryItemId && Number(entry.qtyPerUnit) > 0);

      await api.post("/products", {
        name: productForm.name.trim(),
        categoryId: productForm.categoryId,
        price: Number(productForm.price),
        recipe,
      });

      const catalogRes = await api.get("/catalog");
      setCategories(catalogRes.data.categories || []);
      setProducts(catalogRes.data.products || []);
      setProductForm((prev) => ({
        ...prev,
        name: "",
        price: "",
        recipeText: "",
      }));
      setMessage("New product added to POS menu.");
    } catch (error) {
      setMessage(error?.response?.data?.message || "Failed to create product.");
    } finally {
      setCreatingProduct(false);
    }
  }

  async function restoreJson(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      await api.post("/system/restore", { data: parsed });
      setMessage("Backup restored.");
      loadAllData();
    } catch {
      setMessage("Invalid restore file.");
    }
  }

  if (!token) {
    return (
      <main className="auth-layout">
        <section className="auth-card">
          <div className="auth-topbar">
            <span>Theme</span>
            <label className="theme-switch" title="Toggle light or dark mode">
              <input
                type="checkbox"
                checked={theme === "dark"}
                onChange={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
              />
              <span className="theme-slider" />
              <span className="theme-label">{theme === "dark" ? "Dark" : "Light"}</span>
            </label>
          </div>
          <h1>Otit&apos;s Shawarma & Coolers</h1>
          <p>Elegant Multi-Branch POS + Inventory Monitoring</p>
          <form onSubmit={handleLogin}>
            <label>
              Username
              <input
                value={loginForm.username}
                onChange={(e) => setLoginForm((p) => ({ ...p, username: e.target.value }))}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={loginForm.password}
                onChange={(e) => setLoginForm((p) => ({ ...p, password: e.target.value }))}
                required
              />
            </label>
            {authError && <p className="error">{authError}</p>}
            <button type="submit">Login</button>
          </form>
          <small>
            Demo users: `admin/admin1234`, `rizal.manager/manager1234`, `ppia.cashier/cashier1234`
          </small>
        </section>
      </main>
    );
  }

  const productsByCategory = categories.map((category) => ({
    ...category,
    items: products.filter((p) => p.categoryId === category.id),
  }));

  return (
    <main className="app-shell">
      <header className="topbar">
      <div>
          <h1>Otit&apos;s POS</h1>
          <p>
            {user?.fullName} ({user?.role}) |{" "}
            {branches.find((b) => b.id === selectedBranch)?.name || "No branch selected"}
        </p>
      </div>
        <div className="topbar-controls">
          <label className="theme-switch" title="Toggle light or dark mode">
            <input
              type="checkbox"
              checked={theme === "dark"}
              onChange={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
            />
            <span className="theme-slider" />
            <span className="theme-label">{theme === "dark" ? "Dark" : "Light"}</span>
          </label>
          <select value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value)}>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
          <button onClick={logout}>Logout</button>
        </div>
      </header>

      <nav className="tabs">
        {tabs
          .filter((tab) => (tab === "Admin" ? canAdminView : true))
          .map((tab) => (
            <button key={tab} className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>
              {tab}
            </button>
          ))}
      </nav>

      {message && <p className="notice">{message}</p>}
      {loading && <p className="notice">Loading data...</p>}

      {activeTab === "POS" && (
        <section className="grid-two pos-workspace">
          <article className="panel order-entry-panel">
            <div className="panel-head">
              <h2>Fast Order Entry</h2>
              <span className="pill-muted">{products.length} products</span>
            </div>
            {productsByCategory.map((category) => (
              <div key={category.id} className="category-section">
                <div className="category-head">
                  <h3>{category.name}</h3>
                  <span>{category.items.length} items</span>
                </div>
                <div className="product-grid">
                  {category.items.map((product) => (
                    <button key={product.id} className="product-btn" onClick={() => addToCart(product)}>
                      <strong>{product.name}</strong>
                      <small>Tap to add</small>
                      <span>{peso(product.price)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </article>

          <article className="panel checkout-panel">
            <div className="panel-head">
              <h2>Checkout</h2>
              <span className="pill-muted">{cartItemCount} item(s)</span>
            </div>
            <div className="cart-list">
              {!!cart.length && <div className="cart-header"><span>Item</span><span>Qty</span><span>Amount</span></div>}
              {cart.map((line) => (
                <div key={line.productId} className="cart-row">
                  <span>{line.name}</span>
                  <div>
                    <button onClick={() => updateCartQty(line.productId, line.qty - 1)}>-</button>
                    <b>{line.qty}</b>
                    <button onClick={() => updateCartQty(line.productId, line.qty + 1)}>+</button>
                    <button className="icon-remove" onClick={() => updateCartQty(line.productId, 0)}>
                      x
                    </button>
                  </div>
                  <span>{peso(line.price * line.qty)}</span>
                </div>
              ))}
              {!cart.length && <div className="cart-empty">No items yet. Select products from Fast Order Entry.</div>}
            </div>
            <div className="totals-box">
              <div>
                <span>Subtotal</span>
                <strong>{peso(cartTotal)}</strong>
              </div>
              <div>
                <span>{paymentType === "cash" ? "Received" : "Payment"}</span>
                <strong>{paymentType === "cash" ? peso(computedReceived) : "QR"}</strong>
              </div>
              <div>
                <span>{paymentType === "cash" ? (computedDue > 0 ? "Due" : "Change") : "Status"}</span>
                <strong>{paymentType === "cash" ? peso(computedDue > 0 ? computedDue : computedChange) : "Paid on scan"}</strong>
              </div>
              <div className="total-emphasis">
                <span>Total</span>
                <strong>{peso(cartTotal)}</strong>
              </div>
            </div>

            <div className="inline-fields checkout-controls">
              <label>
                Payment
                <select value={paymentType} onChange={(e) => setPaymentType(e.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="qr">QR Payment</option>
                </select>
              </label>
              {paymentType === "cash" && (
                <label>
                  Received
                  <input
                    type="number"
                    value={receivedAmount}
                    onChange={(e) => setReceivedAmount(Number(e.target.value))}
                    placeholder="0.00"
                  />
                </label>
              )}
            </div>
            <div className="checkout-actions">
              <button className="subtle-btn" onClick={() => setCart([])} disabled={!cart.length}>
                Clear Cart
              </button>
              <button className="checkout-btn" onClick={checkout} disabled={!cart.length}>
                Complete Sale
              </button>
            </div>

            {lastReceipt && (
              <div className="receipt">
                <h3>Digital Receipt</h3>
                <p>#{lastReceipt.receiptNo}</p>
                <p>{dayjs(lastReceipt.createdAt).format("MMM D, YYYY h:mm A")}</p>
                <ul>
                  {lastReceipt.lines.map((line) => (
                    <li key={line.productId}>
                      {line.productName} x {line.qty} - {peso(line.lineTotal)}
                    </li>
                  ))}
                </ul>
                <b>Total: {peso(lastReceipt.total)}</b>
              </div>
            )}
          </article>
        </section>
      )}

      {activeTab === "Dashboard" && (
        <section className="panel">
          <h2>Sales Monitoring Dashboard</h2>
          <div className="inline-fields">
            <label>
              Report Period
              <select value={selectedPeriod} onChange={(e) => setSelectedPeriod(e.target.value)}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
          </div>
          <div className="metric-grid">
            <div className="metric-card">
              <span>Total Sales</span>
              <strong>{peso(summary.totalSales)}</strong>
            </div>
            <div className="metric-card">
              <span>Transactions</span>
              <strong>{summary.transactionCount}</strong>
            </div>
            <div className="metric-card">
              <span>Top Item</span>
              <strong>{summary.bestSellingItems[0]?.name || "N/A"}</strong>
            </div>
          </div>

          <div className="dashboard-charts">
            <div className="chart-card">
              <h3>Sales Trend</h3>
              <div className="chart-host">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={salesTrend}>
                    <defs>
                      <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#d4af37" stopOpacity={0.55} />
                        <stop offset="95%" stopColor="#d4af37" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="4 4" stroke={gridColor} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: axisColor, fontSize: 12 }}
                      axisLine={{ stroke: gridColor }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: axisColor, fontSize: 12 }}
                      axisLine={{ stroke: gridColor }}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(value, name) => (name === "sales" ? [peso(value), "Sales"] : [value, "Txns"])}
                      contentStyle={{
                        background: isDark ? "#1a140c" : "#efe1c3",
                        border: `1px solid ${gridColor}`,
                        borderRadius: "10px",
                        color: axisColor,
                      }}
                    />
                    <Legend />
                    <Area type="monotone" dataKey="sales" stroke="#d4af37" fill="url(#salesFill)" strokeWidth={2.5} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="chart-card">
              <h3>Best-Seller Share</h3>
              <div className="chart-host">
                {itemMix.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={itemMix}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={48}
                        outerRadius={90}
                        paddingAngle={3}
                      >
                        {itemMix.map((entry, idx) => (
                          <Cell key={entry.name} fill={chartPalette[idx % chartPalette.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value) => [`${value} sold`, "Units"]}
                        contentStyle={{
                          background: isDark ? "#1a140c" : "#efe1c3",
                          border: `1px solid ${gridColor}`,
                          borderRadius: "10px",
                        }}
                      />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p>No item mix data yet.</p>
                )}
              </div>
            </div>
          </div>

          {canAdminView && (
            <div className="table-like">
              <h3>Branch Performance Comparison</h3>
              {adminOverview.byBranch.map((branch) => (
                <div key={branch.branchId} className="row">
                  <span>{branch.branchName}</span>
                  <span>{peso(branch.totalSales)}</span>
                  <span>{branch.transactionCount} txns</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === "Inventory" && (
        <section className="grid-two">
          <article className="panel">
            <h2>Inventory by Branch</h2>
            <div className="table-like">
              {inventory.map((item) => (
                <div key={item.id} className="row">
                  <span>{item.name}</span>
                  <span>
                    {item.qty} {item.uom}
                  </span>
                  <span>Low @ {item.lowStockThreshold}</span>
                </div>
              ))}
            </div>
            <h3>Low Stock Alerts</h3>
            <ul>
              {alerts.map((item) => (
                <li key={item.id}>
                  {item.name}: {item.qty} {item.uom}
                </li>
              ))}
              {!alerts.length && <li>All inventory is healthy.</li>}
            </ul>
          </article>

          <article className="panel">
            <h2>Stock Actions</h2>
            <form onSubmit={adjustStock}>
              <h3>Manual Adjustment</h3>
              <input
                placeholder="Inventory Item ID (e.g. inv-pita)"
                value={adjustForm.inventoryItemId}
                onChange={(e) => setAdjustForm((p) => ({ ...p, inventoryItemId: e.target.value }))}
                required
              />
              <input
                type="number"
                placeholder="Qty Delta (+/-)"
                value={adjustForm.qtyDelta}
                onChange={(e) => setAdjustForm((p) => ({ ...p, qtyDelta: e.target.value }))}
                required
              />
              <input
                placeholder="Reason"
                value={adjustForm.reason}
                onChange={(e) => setAdjustForm((p) => ({ ...p, reason: e.target.value }))}
                required
              />
              <button type="submit">Apply Adjustment</button>
            </form>

            <form onSubmit={transferStock}>
              <h3>Branch Stock Transfer</h3>
              <select
                value={transferForm.fromBranchId}
                onChange={(e) => setTransferForm((p) => ({ ...p, fromBranchId: e.target.value }))}
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    From: {b.name}
                  </option>
                ))}
              </select>
              <select value={transferForm.toBranchId} onChange={(e) => setTransferForm((p) => ({ ...p, toBranchId: e.target.value }))}>
                <option value="">Select destination branch</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    To: {b.name}
                  </option>
                ))}
              </select>
              <input
                placeholder="Inventory Item ID"
                value={transferForm.inventoryItemId}
                onChange={(e) => setTransferForm((p) => ({ ...p, inventoryItemId: e.target.value }))}
                required
              />
              <input
                type="number"
                placeholder="Quantity to transfer"
                value={transferForm.qty}
                onChange={(e) => setTransferForm((p) => ({ ...p, qty: e.target.value }))}
                required
              />
              <button type="submit">Transfer Stock</button>
            </form>
          </article>
        </section>
      )}

      {activeTab === "Admin" && canAdminView && (
        <section className="panel">
          <h2>Centralized Admin Panel</h2>
          <p>
            Consolidated Sales: <strong>{peso(adminOverview.consolidated?.totalSales || 0)}</strong> | Transactions:{" "}
            <strong>{adminOverview.consolidated?.transactionCount || 0}</strong>
          </p>
          <div className="table-like">
            {users.map((u) => (
              <div key={u.id} className="row">
                <span>{u.fullName}</span>
                <span>@{u.username}</span>
                <span>
                  {u.role} {u.branchId ? `(${u.branchId})` : ""}
                </span>
              </div>
            ))}
          </div>
          <div className="inline-fields">
            <button onClick={backupJson}>Backup Data</button>
            <label className="file-upload">
              Restore Backup
              <input type="file" accept="application/json" onChange={(e) => restoreJson(e.target.files?.[0])} />
            </label>
          </div>

          <div className="admin-product-menu">
            <h3>Add New Product to POS</h3>
            <p>Use this menu to create new items shown in Fast Order Entry.</p>
            <form onSubmit={createProduct}>
              <div className="admin-product-grid">
                <label>
                  Product Name
                  <input
                    placeholder="e.g. Chicken Rice Bowl"
                    value={productForm.name}
                    onChange={(e) => setProductForm((prev) => ({ ...prev, name: e.target.value }))}
                    required
                  />
                </label>

                <label>
                  Category
                  <select
                    value={productForm.categoryId}
                    onChange={(e) => setProductForm((prev) => ({ ...prev, categoryId: e.target.value }))}
                    required
                  >
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Price (PHP)
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    placeholder="0.00"
                    value={productForm.price}
                    onChange={(e) => setProductForm((prev) => ({ ...prev, price: e.target.value }))}
                    required
                  />
                </label>

                <label>
                  Recipe (Optional)
                  <input
                    placeholder="inv-pita:1, inv-chicken:120"
                    value={productForm.recipeText}
                    onChange={(e) => setProductForm((prev) => ({ ...prev, recipeText: e.target.value }))}
                  />
                </label>
              </div>
              <div className="inline-fields">
                <button type="submit" disabled={creatingProduct}>
                  {creatingProduct ? "Adding Product..." : "Add Product"}
                </button>
              </div>
            </form>
          </div>
        </section>
      )}

      {activeTab === "Reports" && (
        <section className="panel">
          <h2>Reports & Export</h2>
          <div className="inline-fields">
            <button onClick={() => exportCsv(`/reports/sales.csv?branchId=${selectedBranch}`, "sales-report.csv")}>
              Export Sales CSV
            </button>
            <button
              onClick={() =>
                exportCsv(`/reports/inventory-usage.csv?branchId=${selectedBranch}`, "inventory-usage.csv")
              }
            >
              Export Inventory Usage CSV
            </button>
          </div>
          <p>Excel export: open CSV directly in Excel or Google Sheets.</p>
        </section>
      )}
    </main>
  );
}

export default App;
