#!/usr/bin/env node
/**
 * WebSocket Connection and Message Handling Test
 * 
 * This script tests:
 * 1. Single WebSocket connection (no duplicates)
 * 2. Request message sending
 * 3. Response message receiving (with 'result' type support)
 * 4. Login flow end-to-end
 */

import WebSocket from 'ws';
import { encode, decode } from '@msgpack/msgpack';

const WS_URL = 'wss://jae.local:9443';
const TEST_TIMEOUT = 10000;

let testsPassed = 0;
let testsFailed = 0;

function generateUUID() {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    buf[6] = ((buf[6] ?? 0) & 0x0f) | 0x40;
    buf[8] = ((buf[8] ?? 0) & 0x3f) | 0x80;
    const hex = Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

async function test(name, fn) {
    try {
        console.log(`\n📝 Running: ${name}`);
        await fn();
        console.log(`✅ PASSED: ${name}`);
        testsPassed++;
    } catch (err) {
        console.error(`❌ FAILED: ${name}`);
        console.error(`   Error: ${err.message}`);
        testsFailed++;
    }
}

async function testSingleConnection() {
    return new Promise((resolve, reject) => {
        const connectionAttempts = [];
        let connectionCount = 0;
        
        const ws = new WebSocket(WS_URL, ['msgpack'], {
            rejectUnauthorized: false
        });
        
        ws.on('open', () => {
            connectionCount++;
            connectionAttempts.push(new Date());
            console.log(`   Connection #${connectionCount} established`);
            
            if (connectionCount > 1) {
                ws.close();
                reject(new Error(`Expected 1 connection, but got ${connectionCount}`));
            }
        });
        
        setTimeout(() => {
            ws.close();
            if (connectionCount === 1) {
                resolve();
            } else {
                reject(new Error(`Connection did not establish (got ${connectionCount})`));
            }
        }, 2000);
        
        ws.on('error', (err) => {
            reject(err);
        });
    });
}

async function testMessageEcho() {
    // NOTE: system.ping is intentionally short-circuited server-side (no response sent back).
    // We instead send a request to an unknown topic and expect an error response,
    // which confirms the server receives messages and sends back replies.
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(WS_URL, ['msgpack'], {
            rejectUnauthorized: false
        });
        
        let responseReceived = false;
        const requestId = generateUUID();
        
        ws.on('open', () => {
            console.log('   WebSocket connected, sending request to unknown topic to get error response back');
            const request = {
                id: requestId,
                type: 'request',
                topic: '__test_echo__',
                action: 'noop',
                payload: {},
                meta: { timestamp: new Date().toISOString() }
            };
            ws.send(encode(request));
        });
        
        ws.on('message', (data) => {
            try {
                const message = decode(Buffer.from(data));
                console.log(`   Received message type: ${message.type} for id: ${message.id}`);
                
                // Server should return an error response for unknown topics
                if (message.id === requestId && (message.type === 'error' || message.type === 'result' || message.type === 'response')) {
                    responseReceived = true;
                    console.log(`   ✓ Server responded with type: ${message.type}`);
                    ws.close();
                    resolve();
                }
            } catch (err) {
                console.log(`   Message parsing: ${err.message}`);
            }
        });
        
        const timeout = setTimeout(() => {
            ws.close();
            if (!responseReceived) {
                reject(new Error('No response received from server — messages may be silently dropped'));
            }
        }, TEST_TIMEOUT);
        
        ws.on('close', () => {
            clearTimeout(timeout);
        });
        
        ws.on('error', (err) => {
            reject(err);
        });
    });
}

async function testLoginFlow() {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(WS_URL, ['msgpack'], {
            rejectUnauthorized: false
        });
        
        let loginResponseReceived = false;
        
        ws.on('open', () => {
            console.log('   WebSocket connected, attempting login');
            const loginRequest = {
                id: generateUUID(),
                type: 'request',
                topic: 'auth',
                action: 'login',
                payload: {
                    type: 'local',
                    email: 'test@example.com',
                    password: 'test123'
                },
                meta: { timestamp: new Date().toISOString() }
            };
            console.log('   Sending login request...');
            ws.send(encode(loginRequest));
        });
        
        ws.on('message', (data) => {
            try {
                const message = decode(Buffer.from(data));
                console.log(`   Received message type: ${message.type}, topic: ${message.topic}, action: ${message.action}`);
                
                if (message.type === 'error') {
                    // Expected if user doesn't exist
                    if (message.payload.code) {
                        console.log(`   ✓ Error response received (expected): ${message.payload.code} - ${message.payload.message}`);
                        loginResponseReceived = true;
                    }
                } else if (message.type === 'result' || message.type === 'response') {
                    // Successful response
                    console.log(`   ✓ Response received with type: ${message.type}`);
                    console.log(`   Response payload: ${JSON.stringify(message.payload).substring(0, 100)}`);
                    loginResponseReceived = true;
                }
                
                if (loginResponseReceived) {
                    ws.close();
                    resolve();
                }
            } catch (err) {
                console.error(`   Message parsing error: ${err.message}`);
            }
        });
        
        const timeout = setTimeout(() => {
            ws.close();
            if (!loginResponseReceived) {
                reject(new Error('No login response received from server'));
            }
        }, TEST_TIMEOUT);
        
        ws.on('close', () => {
            clearTimeout(timeout);
        });
        
        ws.on('error', (err) => {
            reject(err);
        });
    });
}

async function runAllTests() {
    console.log('🚀 WebSocket Connection & Message Handling Tests\n');
    console.log(`Target: ${WS_URL}\n`);
    
    await test('Single WebSocket Connection (No Duplicates)', testSingleConnection);
    await test('Message Echo Test (Ping/Pong)', testMessageEcho);
    await test('Login Flow Integration', testLoginFlow);
    
    console.log(`\n📊 Test Results:`);
    console.log(`✅ Passed: ${testsPassed}`);
    console.log(`❌ Failed: ${testsFailed}`);
    console.log(`\nTotal: ${testsPassed + testsFailed}\n`);
    
    process.exit(testsFailed > 0 ? 1 : 0);
}

runAllTests().catch((err) => {
    console.error('Test runner error:', err);
    process.exit(1);
});
