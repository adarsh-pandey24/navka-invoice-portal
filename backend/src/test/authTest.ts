import { assert } from './assert';
import http from 'http';
import app from '../app';
import { connectDB, disconnectDB } from '../config/db';
import { seedUsers } from '../seed/seedUsers';

const request = (server: http.Server, options: { method: string; path: string; headers?: Record<string, string>; body?: any }): Promise<{ status: number; body: any }> => {
  return new Promise((resolve, reject) => {
    const port = (server.address() as any).port;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: options.path,
        method: options.method,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => (rawData += chunk));
        res.on('end', () => {
          try {
            const parsed = rawData ? JSON.parse(rawData) : {};
            resolve({ status: res.statusCode || 500, body: parsed });
          } catch (e) {
            resolve({ status: res.statusCode || 500, body: rawData });
          }
        });
      }
    );

    req.on('error', reject);
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
};

async function runAuthTests() {
  console.log('\n--- Starting Phase 2: Auth & RBAC Verification Tests ---\n');
  await connectDB();
  await seedUsers();

  const server = app.listen(0);

  try {
    // Test 1: Invalid Credentials
    console.log('[Test 1] Testing invalid credentials login...');
    const badLogin = await request(server, {
      method: 'POST',
      path: '/api/auth/login',
      body: { email: 'wrong@navka.com', password: 'badpassword' },
    });
    assert(badLogin.status === 401, `Expected 401, got ${badLogin.status}`);
    console.log('✓ Test 1 Passed: Invalid login returned 401 Unauthorized');

    // Test 2: Admin Login
    console.log('[Test 2] Testing Admin login (admin@navka.com)...');
    const adminLogin = await request(server, {
      method: 'POST',
      path: '/api/auth/login',
      body: { email: 'admin@navka.com', password: 'admin123' },
    });
    assert(adminLogin.status === 200, `Expected 200, got ${adminLogin.status}`);
    assert(adminLogin.body.user.role === 'ADMIN', `Expected role ADMIN, got ${adminLogin.body.user.role}`);
    const adminToken = adminLogin.body.token;
    console.log('✓ Test 2 Passed: Admin login successful, role verified as ADMIN');

    // Test 3: CA Login
    console.log('[Test 3] Testing CA login (ca@navka.com)...');
    const caLogin = await request(server, {
      method: 'POST',
      path: '/api/auth/login',
      body: { email: 'ca@navka.com', password: 'ca123' },
    });
    assert(caLogin.status === 200, `Expected 200, got ${caLogin.status}`);
    assert(caLogin.body.user.role === 'CA', `Expected role CA, got ${caLogin.body.user.role}`);
    const caToken = caLogin.body.token;
    console.log('✓ Test 3 Passed: CA login successful, role verified as CA');

    // Test 4: Current User Session (/api/auth/me)
    console.log('[Test 4] Testing GET /api/auth/me with Admin token...');
    const meRes = await request(server, {
      method: 'GET',
      path: '/api/auth/me',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(meRes.status === 200, `Expected 200, got ${meRes.status}`);
    assert(meRes.body.user.email === 'admin@navka.com', 'Admin email match failed');
    console.log('✓ Test 4 Passed: Current session verified');

    // Test 5: Admin accessing admin-only endpoint
    console.log('[Test 5] Testing Admin accessing /api/auth/admin-only...');
    const adminAccess = await request(server, {
      method: 'GET',
      path: '/api/auth/admin-only',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(adminAccess.status === 200, `Expected 200, got ${adminAccess.status}`);
    console.log('✓ Test 5 Passed: Admin permitted on admin-only route');

    // Test 6: CA accessing admin-only endpoint (RBAC Guard Check)
    console.log('[Test 6] Testing CA accessing /api/auth/admin-only (Expect 403 Forbidden)...');
    const caBlocked = await request(server, {
      method: 'GET',
      path: '/api/auth/admin-only',
      headers: { Authorization: `Bearer ${caToken}` },
    });
    assert(caBlocked.status === 403, `Expected 403, got ${caBlocked.status}`);
    console.log(`✓ Test 6 Passed: CA correctly blocked with HTTP 403 Forbidden (${caBlocked.body.message})`);

    // Test 7: Unauthenticated request to protected route
    console.log('[Test 7] Testing unauthenticated request to /api/auth/admin-only...');
    const unauth = await request(server, {
      method: 'GET',
      path: '/api/auth/admin-only',
    });
    assert(unauth.status === 401, `Expected 401, got ${unauth.status}`);
    console.log('✓ Test 7 Passed: Unauthenticated request returned 401 Unauthorized');

    console.log('\n======================================================');
    console.log(' ALL PHASE 2 AUTH & RBAC TESTS PASSED SUCCESSFULLY! ');
    console.log('======================================================\n');
  } finally {
    server.close();
    await disconnectDB();
  }
}

runAuthTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
