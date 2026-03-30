#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import App from './ui/views/App.js';
import { initializeDatabase } from './db/index.js';
import 'dotenv/config';

// Initialize database tables
initializeDatabase();

// Parse CLI arguments
const args = process.argv.slice(2);
let initialDirectory = process.cwd();

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--dir' || arg === '-d') {
    initialDirectory = args[i + 1] || process.cwd();
    i++;
  } else if (arg === '--help' || arg === '-h') {
    console.log(`
  ◆ Friday Code — Terminal AI Agent

  Usage: friday [options]

  Options:
    -d, --dir <path>    Set working directory (default: current directory)
    -h, --help          Show this help message
    -v, --version       Show version

  Inside Friday Code:
    /help               Show available commands
    /model              Select AI model
    /provider           Manage providers & API keys
    /scope <path>       Change working directory
    /config             View/set configuration
    /clear              Clear conversation
    /new                Start a fresh conversation
    /history            Show history count
    /exit               Exit Friday Code
    @file               Mention a file for context
`);
    process.exit(0);
  } else if (arg === '--version' || arg === '-v') {
    console.log('friday-code v1.0.1');
    process.exit(0);
  }
}

// Render the app
const { waitUntilExit } = render(
  React.createElement(App, { initialDirectory }),
  {
    exitOnCtrlC: false, // We handle Ctrl+C ourselves
  }
);

waitUntilExit().then(() => {
  process.exit(0);
});
