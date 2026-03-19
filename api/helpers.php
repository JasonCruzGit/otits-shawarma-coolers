<?php

define('JWT_SECRET', getenv('JWT_SECRET') ?: 'otits-pos-secret-change-me');
define('DB_PATH', __DIR__ . '/data/db.json');

// ─── JWT ───────────────────────────────────────────────

function base64url_encode($data) {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function base64url_decode($data) {
    return base64_decode(strtr($data, '-_', '+/'));
}

function jwt_encode($payload, $secret = null) {
    $secret = $secret ?: JWT_SECRET;
    $header = base64url_encode(json_encode(['typ' => 'JWT', 'alg' => 'HS256']));
    $payload_encoded = base64url_encode(json_encode($payload));
    $sig = base64url_encode(hash_hmac('sha256', "$header.$payload_encoded", $secret, true));
    return "$header.$payload_encoded.$sig";
}

function jwt_decode($token, $secret = null) {
    $secret = $secret ?: JWT_SECRET;
    $parts = explode('.', $token);
    if (count($parts) !== 3) return null;
    [$header, $payload, $sig] = $parts;
    $expected = base64url_encode(hash_hmac('sha256', "$header.$payload", $secret, true));
    if (!hash_equals($expected, $sig)) return null;
    $data = json_decode(base64url_decode($payload), true);
    if (!$data) return null;
    if (isset($data['exp']) && $data['exp'] < time()) return null;
    return $data;
}

function token_for_user($user) {
    return jwt_encode([
        'sub' => $user['id'],
        'role' => $user['role'],
        'branchId' => $user['branchId'],
        'iat' => time(),
        'exp' => time() + 57600, // 16 hours
    ]);
}

// ─── JSON Database ─────────────────────────────────────

function db_read() {
    if (!file_exists(DB_PATH)) {
        $default = default_data();
        db_write($default);
        return $default;
    }
    $raw = file_get_contents(DB_PATH);
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        $data = default_data();
        db_write($data);
    }
    return $data;
}

function db_write($data) {
    $dir = dirname(DB_PATH);
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    file_put_contents(DB_PATH, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
}

function default_data() {
    return [
        'branches' => [
            ['id' => 'branch-rizal', 'name' => "Otit's Rizal Ave Branch", 'isActive' => true],
            ['id' => 'branch-ppia', 'name' => "Otit's PPIA Branch", 'isActive' => true],
        ],
        'categories' => [
            ['id' => 'cat-shawarma', 'name' => 'Shawarma'],
            ['id' => 'cat-coolers', 'name' => 'Coolers'],
            ['id' => 'cat-addons', 'name' => 'Add-ons'],
        ],
        'products' => [
            ['id' => 'prod-chicken-wrap', 'name' => 'Chicken Shawarma Wrap', 'categoryId' => 'cat-shawarma', 'price' => 89, 'isActive' => true, 'recipe' => [['inventoryItemId' => 'inv-pita', 'qtyPerUnit' => 1], ['inventoryItemId' => 'inv-chicken', 'qtyPerUnit' => 120]]],
            ['id' => 'prod-beef-wrap', 'name' => 'Beef Shawarma Wrap', 'categoryId' => 'cat-shawarma', 'price' => 99, 'isActive' => true, 'recipe' => [['inventoryItemId' => 'inv-pita', 'qtyPerUnit' => 1], ['inventoryItemId' => 'inv-beef', 'qtyPerUnit' => 130]]],
            ['id' => 'prod-cucumber-cooler', 'name' => 'Cucumber Cooler', 'categoryId' => 'cat-coolers', 'price' => 55, 'isActive' => true, 'recipe' => [['inventoryItemId' => 'inv-cucumber-syrup', 'qtyPerUnit' => 30]]],
            ['id' => 'prod-extra-cheese', 'name' => 'Extra Cheese', 'categoryId' => 'cat-addons', 'price' => 15, 'isActive' => true, 'recipe' => [['inventoryItemId' => 'inv-cheese', 'qtyPerUnit' => 20]]],
        ],
        'inventoryByBranch' => [],
        'orders' => [],
        'users' => [],
        'inventoryLogs' => [],
        'stockTransfers' => [],
    ];
}

function inventory_template() {
    return [
        ['id' => 'inv-pita', 'name' => 'Pita Bread', 'uom' => 'pcs', 'qty' => 200, 'lowStockThreshold' => 40],
        ['id' => 'inv-chicken', 'name' => 'Chicken Meat', 'uom' => 'grams', 'qty' => 12000, 'lowStockThreshold' => 2500],
        ['id' => 'inv-beef', 'name' => 'Beef Meat', 'uom' => 'grams', 'qty' => 9000, 'lowStockThreshold' => 2000],
        ['id' => 'inv-cucumber-syrup', 'name' => 'Cucumber Syrup', 'uom' => 'ml', 'qty' => 7000, 'lowStockThreshold' => 1200],
        ['id' => 'inv-cheese', 'name' => 'Cheese', 'uom' => 'grams', 'qty' => 3000, 'lowStockThreshold' => 600],
    ];
}

function db_seed(&$data) {
    if (empty($data['users'])) {
        $data['users'] = [
            ['id' => 'user-admin', 'fullName' => 'System Admin', 'username' => 'admin', 'passwordHash' => password_hash('admin1234', PASSWORD_BCRYPT), 'role' => 'admin', 'branchId' => null, 'isActive' => true],
            ['id' => 'user-manager-rizal', 'fullName' => 'Rizal Manager', 'username' => 'rizal.manager', 'passwordHash' => password_hash('manager1234', PASSWORD_BCRYPT), 'role' => 'manager', 'branchId' => 'branch-rizal', 'isActive' => true],
            ['id' => 'user-cashier-ppia', 'fullName' => 'PPIA Cashier', 'username' => 'ppia.cashier', 'passwordHash' => password_hash('cashier1234', PASSWORD_BCRYPT), 'role' => 'cashier', 'branchId' => 'branch-ppia', 'isActive' => true],
        ];
    }
    if (empty($data['inventoryByBranch'])) {
        $data['inventoryByBranch'] = array_map(function ($branch) {
            return ['branchId' => $branch['id'], 'items' => inventory_template()];
        }, $data['branches']);
    }
    $data['orders'] = $data['orders'] ?? [];
    $data['inventoryLogs'] = $data['inventoryLogs'] ?? [];
    $data['stockTransfers'] = $data['stockTransfers'] ?? [];
    db_write($data);
}

// ─── HTTP helpers ──────────────────────────────────────

function json_response($data, $status = 200) {
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function get_json_body() {
    return json_decode(file_get_contents('php://input'), true) ?: [];
}

function get_bearer_token() {
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
    if (str_starts_with($header, 'Bearer ')) return substr($header, 7);
    return null;
}

function auth_user(&$data) {
    $token = get_bearer_token();
    if (!$token) json_response(['message' => 'Missing Bearer token.'], 401);
    $payload = jwt_decode($token);
    if (!$payload) json_response(['message' => 'Invalid or expired token.'], 401);
    $user = null;
    foreach ($data['users'] as &$u) {
        if ($u['id'] === $payload['sub'] && $u['isActive']) { $user = $u; break; }
    }
    if (!$user) json_response(['message' => 'User not found or inactive.'], 401);
    return public_user($user);
}

function require_role($user, ...$roles) {
    if (!in_array($user['role'], $roles)) {
        json_response(['message' => 'Forbidden: insufficient permissions.'], 403);
    }
}

function public_user($user) {
    return [
        'id' => $user['id'],
        'fullName' => $user['fullName'],
        'username' => $user['username'],
        'role' => $user['role'],
        'branchId' => $user['branchId'],
        'isActive' => $user['isActive'],
    ];
}

function resolve_branch($user, $requested) {
    if ($user['role'] === 'admin') return $requested;
    return $user['branchId'];
}

function nanoid($len = 10) {
    $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    $id = '';
    for ($i = 0; $i < $len; $i++) $id .= $chars[random_int(0, strlen($chars) - 1)];
    return $id;
}

function &find_branch_inventory(&$data, $branchId) {
    foreach ($data['inventoryByBranch'] as &$entry) {
        if ($entry['branchId'] === $branchId) return $entry;
    }
    $null = null;
    return $null;
}

function summarize_orders($orders) {
    $totalSales = 0;
    $itemCounts = [];
    foreach ($orders as $o) {
        $totalSales += $o['total'];
        foreach ($o['items'] as $item) {
            $name = $item['productName'];
            $itemCounts[$name] = ($itemCounts[$name] ?? 0) + $item['qty'];
        }
    }
    arsort($itemCounts);
    $best = [];
    $i = 0;
    foreach ($itemCounts as $name => $sold) {
        $best[] = ['name' => $name, 'sold' => $sold];
        if (++$i >= 5) break;
    }
    return [
        'totalSales' => $totalSales,
        'transactionCount' => count($orders),
        'bestSellingItems' => $best,
    ];
}
