#!/usr/bin/env node

import { spawn } from 'node:child_process';
import readline from 'node:readline';

const command = process.env.DEV_COMMAND ?? 'pnpm';
const args = process.env.DEV_ARGS
    ? process.env.DEV_ARGS.split(' ').filter(Boolean)
    : ['--filter', '@orch/orchestrator', 'dev'];

let child = null;
let isStopping = false;
let shouldRestart = false;

function printHelp() {
    if (!process.stdin.isTTY) return;
    console.log('\n[dev] Press "r" to restart, "q" to quit.\n');
}

function startChild() {
    child = spawn(command, args, {
        stdio: 'inherit',
        env: process.env,
    });

    child.on('exit', (code, signal) => {
        const exitedFromSignal = Boolean(signal);

        if (isStopping) {
            process.exit(code ?? 0);
        }

        if (shouldRestart) {
            shouldRestart = false;
            startChild();
            return;
        }

        if (exitedFromSignal) {
            process.exit(1);
            return;
        }

        process.exit(code ?? 0);
    });
}

function stopChild(force = false) {
    if (!child || child.killed) return;
    child.kill(force ? 'SIGKILL' : 'SIGTERM');
}

function restartChild() {
    if (!child) return;
    shouldRestart = true;
    stopChild(false);

    setTimeout(() => {
        if (child && !child.killed && shouldRestart) {
            stopChild(true);
        }
    }, 4000);
}

function setupKeyboard() {
    if (!process.stdin.isTTY) return;

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    process.stdin.on('keypress', (_str, key) => {
        if (!key) return;

        if (key.ctrl && key.name === 'c') {
            isStopping = true;
            stopChild(false);
            return;
        }

        if (key.name === 'r' && !key.ctrl && !key.meta) {
            console.log('\n[dev] Restart requested...');
            restartChild();
            return;
        }

        if (key.name === 'q' && !key.ctrl && !key.meta) {
            console.log('\n[dev] Stopping...');
            isStopping = true;
            stopChild(false);
        }
    });
}

process.on('SIGINT', () => {
    isStopping = true;
    stopChild(false);
});

process.on('SIGTERM', () => {
    isStopping = true;
    stopChild(false);
});

setupKeyboard();
printHelp();
startChild();
