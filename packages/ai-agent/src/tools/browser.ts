import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { Logger } from '@orch/daemon';
import type { ToolDefinition } from '../tools.js';

export class BrowserTool {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private page: Page | null = null;
    private logger: Logger;

    public readonly definition: ToolDefinition = {
        name: 'browser_automation',
        description: 'Navigate websites, extract information, and interact with web elements programmatically.',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['navigate', 'extract_text', 'click', 'screenshot', 'execute_script'],
                    description: 'The browser action to perform.'
                },
                url: {
                    type: 'string',
                    description: 'The URL to navigate to (required for navigate action)'
                },
                selector: {
                    type: 'string',
                    description: 'CSS Selector to click or extract text from (required for click and extract_text)'
                },
                script: {
                    type: 'string',
                    description: 'Javascript to execute in the browser context (required for execute_script)'
                }
            },
            required: ['action']
        }
    };

    constructor(logger: Logger) {
        this.logger = logger.child({ tool: 'browser_automation' });
    }

    public async execute(params: any): Promise<any> {
        this.logger.debug({ action: params.action }, 'Executing browser tool action');

        try {
            await this.ensureSession();

            switch (params.action) {
                case 'navigate':
                    if (!params.url) throw new Error('url is required for navigate action');
                    await this.page!.goto(params.url, { waitUntil: 'load', timeout: 30000 });
                    return { success: true, title: await this.page!.title(), url: this.page!.url() };

                case 'extract_text':
                    if (!params.selector) throw new Error('selector is required for extract_text action');
                    const textContent = await this.page!.locator(params.selector).allInnerTexts();
                    return { success: true, text: textContent.join('\n') };

                case 'click':
                    if (!params.selector) throw new Error('selector is required for click action');
                    await this.page!.locator(params.selector).first().click();
                    return { success: true, message: `Clicked ${params.selector}` };

                case 'screenshot':
                    const buffer = await this.page!.screenshot({ fullPage: true });
                    return { success: true, buffer: buffer.toString('base64') };

                case 'execute_script':
                    if (!params.script) throw new Error('script is required for execute_script action');
                    const res = await this.page!.evaluate(params.script);
                    return { success: true, result: res };

                default:
                    throw new Error(`Unknown action: ${params.action}`);
            }
        } catch (err: any) {
            this.logger.error({ err }, 'Browser tool execution failed');
            return { success: false, error: err.message };
        }
    }

    private async ensureSession() {
        if (!this.browser) {
            this.browser = await chromium.launch({ headless: true });
        }
        if (!this.context) {
            this.context = await this.browser.newContext();
        }
        if (!this.page) {
            this.page = await this.context.newPage();
        }
    }

    public async cleanup() {
        if (this.context) {
            await this.context.close();
            this.context = null;
        }
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
        this.page = null;
        this.logger.debug('Cleaned up Playwright browser context');
    }
}
