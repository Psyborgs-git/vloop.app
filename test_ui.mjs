import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const errors = [];

    page.on('console', msg => {
        if (msg.type() === 'error') {
            errors.push(msg.text());
        }
    });

    page.on('pageerror', error => {
        errors.push(error.message);
    });

    try {
        console.log("Navigating to Dashboard...");
        await page.goto('http://localhost:5180/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);

        console.log("Navigating to Console...");
        await page.goto('http://localhost:5180/console', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1000);

        console.log("Navigating to Chat...");
        await page.goto('http://localhost:5180/chat', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1000);

        console.log("Navigating to Canvas...");
        await page.goto('http://localhost:5180/canvas', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1000);

        if (errors.length > 0) {
            console.error("PAGE ERRORS DETECTED:");
            errors.forEach(e => console.error("-", e));
            process.exit(1);
        } else {
            console.log("SUCCESS: No page errors detected across tabs.");
        }
    } catch (e) {
        console.error("Test script failed:", e);
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
