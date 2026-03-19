<?php
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PATCH, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

require_once __DIR__ . '/helpers.php';

$data = db_read();
db_seed($data);

$method = $_SERVER['REQUEST_METHOD'];
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$uri = preg_replace('#^/api#', '', $uri);
$uri = rtrim($uri, '/') ?: '/';

// ─── Health ────────────────────────────────────────────

if ($uri === '/health' && $method === 'GET') {
    json_response(['status' => 'ok', 'app' => "Otit's POS API (PHP)", 'now' => date('c')]);
}

// ─── Auth ──────────────────────────────────────────────

if ($uri === '/auth/login' && $method === 'POST') {
    $body = get_json_body();
    $username = trim($body['username'] ?? '');
    $password = $body['password'] ?? '';
    if (!$username || !$password) json_response(['message' => 'Invalid login payload.'], 400);

    $user = null;
    foreach ($data['users'] as $u) {
        if ($u['username'] === $username && $u['isActive']) { $user = $u; break; }
    }
    if (!$user) json_response(['message' => 'Invalid credentials.'], 401);
    if (!password_verify($password, $user['passwordHash'])) json_response(['message' => 'Invalid credentials.'], 401);

    json_response([
        'token' => token_for_user($user),
        'user' => public_user($user),
    ]);
}

if ($uri === '/auth/me' && $method === 'GET') {
    $user = auth_user($data);
    json_response($user);
}

// ─── Branches & Catalog ────────────────────────────────

if ($uri === '/branches' && $method === 'GET') {
    auth_user($data);
    json_response($data['branches']);
}

if ($uri === '/catalog' && $method === 'GET') {
    auth_user($data);
    $active = array_values(array_filter($data['products'], fn($p) => $p['isActive']));
    json_response(['categories' => $data['categories'], 'products' => $active]);
}

// ─── Products ──────────────────────────────────────────

if ($uri === '/products' && $method === 'POST') {
    $user = auth_user($data);
    require_role($user, 'admin');
    $body = get_json_body();
    if (empty($body['name']) || empty($body['categoryId']) || !isset($body['price']) || $body['price'] <= 0) {
        json_response(['message' => 'Invalid product payload.'], 400);
    }
    $product = [
        'id' => 'prod-' . nanoid(8),
        'name' => $body['name'],
        'categoryId' => $body['categoryId'],
        'price' => (float)$body['price'],
        'isActive' => true,
        'recipe' => $body['recipe'] ?? [],
    ];
    $data['products'][] = $product;
    db_write($data);
    json_response($product, 201);
}

if (preg_match('#^/products/([^/]+)$#', $uri, $m) && $method === 'PATCH') {
    $user = auth_user($data);
    require_role($user, 'admin');
    $body = get_json_body();
    $found = false;
    foreach ($data['products'] as &$p) {
        if ($p['id'] === $m[1]) {
            foreach ($body as $k => $v) { if ($k !== 'id') $p[$k] = $v; }
            $found = true;
            db_write($data);
            json_response($p);
        }
    }
    if (!$found) json_response(['message' => 'Product not found.'], 404);
}

// ─── Inventory ─────────────────────────────────────────

if ($uri === '/inventory' && $method === 'GET') {
    $user = auth_user($data);
    $branchId = resolve_branch($user, $_GET['branchId'] ?? '');
    if (!$branchId) json_response(['message' => 'branchId is required.'], 400);
    $inv = find_branch_inventory($data, $branchId);
    if (!$inv) json_response(['message' => 'Inventory not found.'], 404);
    json_response($inv);
}

if ($uri === '/inventory/alerts' && $method === 'GET') {
    $user = auth_user($data);
    $branchId = resolve_branch($user, $_GET['branchId'] ?? '');
    $inv = find_branch_inventory($data, $branchId);
    if (!$inv) json_response(['message' => 'Inventory not found.'], 404);
    $low = array_values(array_filter($inv['items'], fn($i) => $i['qty'] <= $i['lowStockThreshold']));
    json_response(['branchId' => $branchId, 'lowStockItems' => $low]);
}

if ($uri === '/inventory/adjust' && $method === 'POST') {
    $user = auth_user($data);
    require_role($user, 'admin', 'manager');
    $body = get_json_body();
    $branchId = resolve_branch($user, $body['branchId'] ?? '');
    $inv = &find_branch_inventory($data, $branchId);
    if (!$inv) json_response(['message' => 'Inventory not found.'], 404);
    $found = false;
    foreach ($inv['items'] as &$item) {
        if ($item['id'] === ($body['inventoryItemId'] ?? '')) {
            $item['qty'] = max(0, $item['qty'] + (int)($body['qtyDelta'] ?? 0));
            $data['inventoryLogs'][] = [
                'id' => 'log-' . nanoid(10),
                'branchId' => $branchId,
                'inventoryItemId' => $item['id'],
                'qtyDelta' => (int)($body['qtyDelta'] ?? 0),
                'reason' => $body['reason'] ?? 'Manual adjustment',
                'actorUserId' => $user['id'],
                'at' => date('c'),
            ];
            $found = true;
            db_write($data);
            json_response(['item' => $item]);
        }
    }
    if (!$found) json_response(['message' => 'Inventory item not found.'], 404);
}

if ($uri === '/inventory/transfer' && $method === 'POST') {
    $user = auth_user($data);
    require_role($user, 'admin', 'manager');
    $body = get_json_body();
    $fromBranchId = $user['role'] === 'admin' ? ($body['fromBranchId'] ?? '') : $user['branchId'];
    $toBranchId = $body['toBranchId'] ?? '';
    $qty = (int)($body['qty'] ?? 0);
    $itemId = $body['inventoryItemId'] ?? '';

    $fromInv = &find_branch_inventory($data, $fromBranchId);
    $toInv = &find_branch_inventory($data, $toBranchId);
    if (!$fromInv || !$toInv) json_response(['message' => 'Branch inventory not found.'], 404);

    $fromItem = null; $toItem = null;
    foreach ($fromInv['items'] as &$fi) { if ($fi['id'] === $itemId) { $fromItem = &$fi; break; } }
    foreach ($toInv['items'] as &$ti) { if ($ti['id'] === $itemId) { $toItem = &$ti; break; } }
    if (!$fromItem || !$toItem) json_response(['message' => 'Inventory item not found.'], 404);
    if ($fromItem['qty'] < $qty) json_response(['message' => 'Insufficient source stock.'], 400);

    $fromItem['qty'] -= $qty;
    $toItem['qty'] += $qty;
    $transfer = [
        'id' => 'tr-' . nanoid(10),
        'fromBranchId' => $fromBranchId,
        'toBranchId' => $toBranchId,
        'inventoryItemId' => $itemId,
        'qty' => $qty,
        'byUserId' => $user['id'],
        'at' => date('c'),
    ];
    $data['stockTransfers'][] = $transfer;
    db_write($data);
    json_response($transfer, 201);
}

// ─── Orders (POS) ──────────────────────────────────────

function process_sale(&$data, $payload, $user) {
    $branchId = $user['role'] === 'admin' ? ($payload['branchId'] ?? $user['branchId']) : $user['branchId'];
    $inv = &find_branch_inventory($data, $branchId);
    if (!$inv) return ['error' => 'Inventory not found.'];

    $lineItems = [];
    $subtotal = 0;
    $addonsTotal = 0;

    foreach ($payload['items'] as $item) {
        $product = null;
        foreach ($data['products'] as $p) {
            if ($p['id'] === $item['productId'] && $p['isActive']) { $product = $p; break; }
        }
        if (!$product) return ['error' => "Invalid product: {$item['productId']}"];
        $qty = max(1, (int)($item['qty'] ?? 1));
        $lineBase = $product['price'] * $qty;
        $lineAddon = 0;
        $addOns = $item['addOns'] ?? [];
        foreach ($addOns as $a) $lineAddon += ($a['price'] ?? 0) * $qty;
        $subtotal += $lineBase;
        $addonsTotal += $lineAddon;

        $lineItems[] = [
            'productId' => $product['id'],
            'productName' => $product['name'],
            'qty' => $qty,
            'unitPrice' => $product['price'],
            'addOns' => $addOns,
            'lineTotal' => $lineBase + $lineAddon,
        ];

        foreach ($product['recipe'] ?? [] as $recipeItem) {
            foreach ($inv['items'] as &$invItem) {
                if ($invItem['id'] === $recipeItem['inventoryItemId']) {
                    $deduct = $recipeItem['qtyPerUnit'] * $qty;
                    $invItem['qty'] = max(0, $invItem['qty'] - $deduct);
                    $data['inventoryLogs'][] = [
                        'id' => 'log-' . nanoid(10),
                        'branchId' => $branchId,
                        'inventoryItemId' => $invItem['id'],
                        'qtyDelta' => -$deduct,
                        'reason' => 'Auto-deduct from sale',
                        'actorUserId' => $user['id'],
                        'at' => date('c'),
                    ];
                    break;
                }
            }
        }
    }

    $total = $subtotal + $addonsTotal;
    $paymentType = $payload['paymentType'] ?? 'cash';
    $receivedAmount = $paymentType === 'cash' ? (float)($payload['receivedAmount'] ?? $total) : $total;
    $changeAmount = max(0, $receivedAmount - $total);
    $receiptNo = 'OT-' . date('Ymd') . '-' . random_int(10000, 99999);

    $order = [
        'id' => 'ord-' . nanoid(12),
        'receiptNo' => $receiptNo,
        'branchId' => $branchId,
        'items' => $lineItems,
        'subtotal' => $subtotal,
        'addonsTotal' => $addonsTotal,
        'total' => $total,
        'paymentType' => $paymentType,
        'receivedAmount' => $receivedAmount,
        'changeAmount' => $changeAmount,
        'customerName' => $payload['customerName'] ?? 'Walk-in',
        'isSynced' => !empty($payload['isSynced']),
        'createdBy' => $user['id'],
        'createdAt' => date('c'),
    ];
    $data['orders'][] = $order;
    return ['order' => $order];
}

if ($uri === '/orders' && $method === 'POST') {
    $user = auth_user($data);
    require_role($user, 'admin', 'manager', 'cashier');
    $body = get_json_body();
    if (empty($body['items'])) json_response(['message' => 'Invalid order payload.'], 400);

    $result = process_sale($data, $body, $user);
    if (isset($result['error'])) json_response(['message' => $result['error']], 400);

    db_write($data);
    $order = $result['order'];
    $branchName = '';
    foreach ($data['branches'] as $b) { if ($b['id'] === $order['branchId']) { $branchName = $b['name']; break; } }

    json_response([
        'order' => $order,
        'receipt' => [
            'businessName' => "Otit's Shawarma & Coolers",
            'branch' => $branchName,
            'receiptNo' => $order['receiptNo'],
            'createdAt' => $order['createdAt'],
            'lines' => $order['items'],
            'total' => $order['total'],
            'paymentType' => $order['paymentType'],
            'receivedAmount' => $order['receivedAmount'],
            'changeAmount' => $order['changeAmount'],
        ],
    ], 201);
}

if ($uri === '/orders' && $method === 'GET') {
    $user = auth_user($data);
    $branchId = resolve_branch($user, $_GET['branchId'] ?? '');
    $from = $_GET['from'] ?? null;
    $to = $_GET['to'] ?? null;

    $orders = $data['orders'];
    if ($branchId) $orders = array_filter($orders, fn($o) => $o['branchId'] === $branchId);
    if ($from) $orders = array_filter($orders, fn($o) => $o['createdAt'] >= $from);
    if ($to) $orders = array_filter($orders, fn($o) => $o['createdAt'] <= $to);
    usort($orders, fn($a, $b) => strcmp($b['createdAt'], $a['createdAt']));
    json_response(array_values($orders));
}

if ($uri === '/sync/offline-orders' && $method === 'POST') {
    $user = auth_user($data);
    require_role($user, 'admin', 'manager', 'cashier');
    $body = get_json_body();
    $synced = [];
    foreach ($body['orders'] ?? [] as $op) {
        $op['isSynced'] = true;
        $result = process_sale($data, $op, $user);
        if (isset($result['order'])) $synced[] = $result['order'];
    }
    db_write($data);
    json_response(['syncedCount' => count($synced), 'synced' => $synced]);
}

// ─── Dashboard ─────────────────────────────────────────

if ($uri === '/dashboard/summary' && $method === 'GET') {
    $user = auth_user($data);
    $branchId = resolve_branch($user, $_GET['branchId'] ?? '');
    $period = $_GET['period'] ?? 'daily';
    $now = new DateTime();
    if ($period === 'daily') $start = (clone $now)->setTime(0, 0);
    elseif ($period === 'weekly') $start = (clone $now)->modify('monday this week')->setTime(0, 0);
    else $start = (clone $now)->modify('first day of this month')->setTime(0, 0);

    $filtered = array_filter($data['orders'], function ($o) use ($branchId, $start) {
        if ($branchId && $o['branchId'] !== $branchId) return false;
        return $o['createdAt'] >= $start->format('c');
    });
    $summary = summarize_orders(array_values($filtered));
    $summary['period'] = $period;
    $summary['startDate'] = $start->format('c');
    $summary['branchId'] = $branchId ?: 'all';
    json_response($summary);
}

if ($uri === '/admin/overview' && $method === 'GET') {
    $user = auth_user($data);
    require_role($user, 'admin');
    $byBranch = array_map(function ($branch) use ($data) {
        $branchOrders = array_values(array_filter($data['orders'], fn($o) => $o['branchId'] === $branch['id']));
        $s = summarize_orders($branchOrders);
        return array_merge(['branchId' => $branch['id'], 'branchName' => $branch['name']], $s);
    }, $data['branches']);
    json_response(['consolidated' => summarize_orders($data['orders']), 'byBranch' => $byBranch]);
}

// ─── Admin Users ───────────────────────────────────────

if ($uri === '/admin/users' && $method === 'GET') {
    $user = auth_user($data);
    require_role($user, 'admin');
    json_response(array_map('public_user', $data['users']));
}

if ($uri === '/admin/users' && $method === 'POST') {
    $user = auth_user($data);
    require_role($user, 'admin');
    $body = get_json_body();
    if (empty($body['fullName']) || empty($body['username']) || empty($body['password']) || empty($body['role'])) {
        json_response(['message' => 'Invalid user payload.'], 400);
    }
    foreach ($data['users'] as $u) {
        if ($u['username'] === $body['username']) json_response(['message' => 'Username is already taken.'], 400);
    }
    $newUser = [
        'id' => 'user-' . nanoid(10),
        'fullName' => $body['fullName'],
        'username' => $body['username'],
        'passwordHash' => password_hash($body['password'], PASSWORD_BCRYPT),
        'role' => $body['role'],
        'branchId' => $body['role'] === 'admin' ? null : ($body['branchId'] ?? null),
        'isActive' => true,
    ];
    $data['users'][] = $newUser;
    db_write($data);
    json_response(public_user($newUser), 201);
}

// ─── Reports ───────────────────────────────────────────

if ($uri === '/reports/sales.csv' && $method === 'GET') {
    $user = auth_user($data);
    require_role($user, 'admin', 'manager');
    $branchId = resolve_branch($user, $_GET['branchId'] ?? '');
    $orders = $branchId ? array_filter($data['orders'], fn($o) => $o['branchId'] === $branchId) : $data['orders'];

    header('Content-Type: text/csv');
    header('Content-Disposition: attachment; filename=sales-report.csv');
    $fp = fopen('php://output', 'w');
    fputcsv($fp, ['receiptNo', 'createdAt', 'branchId', 'total', 'paymentType', 'items']);
    foreach ($orders as $o) {
        $items = implode(' | ', array_map(fn($i) => "{$i['productName']} x{$i['qty']}", $o['items']));
        fputcsv($fp, [$o['receiptNo'], $o['createdAt'], $o['branchId'], $o['total'], $o['paymentType'], $items]);
    }
    fclose($fp);
    exit;
}

if ($uri === '/reports/inventory-usage.csv' && $method === 'GET') {
    $user = auth_user($data);
    require_role($user, 'admin', 'manager');
    $branchId = resolve_branch($user, $_GET['branchId'] ?? '');
    $logs = $branchId ? array_filter($data['inventoryLogs'], fn($l) => $l['branchId'] === $branchId) : $data['inventoryLogs'];

    header('Content-Type: text/csv');
    header('Content-Disposition: attachment; filename=inventory-usage.csv');
    $fp = fopen('php://output', 'w');
    fputcsv($fp, ['at', 'branchId', 'inventoryItemId', 'qtyDelta', 'reason', 'actorUserId']);
    foreach ($logs as $l) {
        fputcsv($fp, [$l['at'], $l['branchId'], $l['inventoryItemId'], $l['qtyDelta'], $l['reason'], $l['actorUserId']]);
    }
    fclose($fp);
    exit;
}

// ─── System ────────────────────────────────────────────

if ($uri === '/system/backup' && $method === 'GET') {
    $user = auth_user($data);
    require_role($user, 'admin');
    header('Content-Type: application/json');
    header('Content-Disposition: attachment; filename=otits-pos-backup-' . date('Ymd-Hi') . '.json');
    echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

if ($uri === '/system/restore' && $method === 'POST') {
    $user = auth_user($data);
    require_role($user, 'admin');
    $body = get_json_body();
    if (empty($body['data'])) json_response(['message' => 'Invalid restore payload.'], 400);
    $data = $body['data'];
    db_write($data);
    json_response(['message' => 'Backup restored successfully.']);
}

// ─── 404 fallback ──────────────────────────────────────

json_response(['message' => 'Not found: ' . $method . ' /api' . $uri], 404);
