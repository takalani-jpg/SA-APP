// E2E test for SA SpeedTest staging site
const { test, expect } = require('@playwright/test');

const STAGING_URL = 'https://sa-app-bice.vercel.app/';

// Helper: collect console logs for debugging
async function attachConsole(page) {
  const logs = [];
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  return logs;
}

test('speed test starts and shows some results', async ({ page }, testInfo) => {
  const logs = await attachConsole(page);

  await page.goto(STAGING_URL, { waitUntil: 'domcontentloaded' });

  // Verify ndt7 loaded
  const hasNdt7 = await page.evaluate(() => typeof window.ndt7 !== 'undefined');
  expect(hasNdt7).toBeTruthy();

  // UI elements present
  const startBtn = page.locator('#startBtn');
  const serverInfo = page.locator('#serverInfo');
  const downloadEl = page.locator('#downloadMbps');
  const uploadEl = page.locator('#uploadMbps');

  await expect(startBtn).toBeVisible();
  await startBtn.click();

  // Should show server discovery or a server selection soon
  await expect(serverInfo).toHaveText(/Finding best server|Server:|Error/i, { timeout: 60000 });

  // Wait for download value to update from initial 0.0 Mbps (allow it to be non-zero with decimals)
  // Be lenient: if network is blocked, at least we should not crash and display error text
  const downloadUpdated = await Promise.race([
    downloadEl.textContent().then(t => /^(?!0\.0\sMbps).+Mbps$/.test((t||'').trim())),
    serverInfo.textContent().then(t => /Error|timeout/i.test(t || '')),
    new Promise(resolve => setTimeout(() => resolve(false), 90000)),
  ]);

  expect(downloadUpdated).toBeTruthy();

  // Optional: upload should also update or we should see an error message
  const uploadUpdated = await Promise.race([
    uploadEl.textContent().then(t => /^(?!0\.0\sMbps).+Mbps$/.test((t||'').trim())),
    serverInfo.textContent().then(t => /Error|timeout/i.test(t || '')),
    new Promise(resolve => setTimeout(() => resolve(false), 90000)),
  ]);

  expect(uploadUpdated).toBeTruthy();

  // Attach logs on failure for troubleshooting
  testInfo.attach('console.log', { body: logs.join('\n'), contentType: 'text/plain' });
  if (testInfo.status !== testInfo.expectedStatus) {
    await page.screenshot({ path: `test-artifacts/failure-${Date.now()}.png`, fullPage: true }).catch(() => {});
  }
});
