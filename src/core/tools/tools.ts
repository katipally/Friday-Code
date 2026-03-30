import { tool } from 'ai';
import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'fs';
import { join, relative, resolve } from 'path';
import { execSync } from 'child_process';
import { globbySync } from 'globby';

export function createTools(workingDirectory: string) {
  return {
    readFile: tool({
      description: 'Read the contents of a file at the given path relative to the working directory',
      parameters: z.object({
        path: z.string().describe('File path relative to working directory'),
      }),
      execute: async ({ path }) => {
        try {
          const fullPath = resolve(workingDirectory, path);
          if (!fullPath.startsWith(workingDirectory)) {
            return { error: 'Access denied: path outside working directory' };
          }
          const content = readFileSync(fullPath, 'utf-8');
          return { content, path: relative(workingDirectory, fullPath) };
        } catch (e: any) {
          return { error: e.message };
        }
      },
    }),

    writeFile: tool({
      description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does.',
      parameters: z.object({
        path: z.string().describe('File path relative to working directory'),
        content: z.string().describe('Content to write to the file'),
      }),
      execute: async ({ path, content }) => {
        try {
          const fullPath = resolve(workingDirectory, path);
          if (!fullPath.startsWith(workingDirectory)) {
            return { error: 'Access denied: path outside working directory' };
          }
          const dir = join(fullPath, '..');
          mkdirSync(dir, { recursive: true });
          writeFileSync(fullPath, content, 'utf-8');
          return { success: true, path: relative(workingDirectory, fullPath) };
        } catch (e: any) {
          return { error: e.message };
        }
      },
    }),

    editFile: tool({
      description: 'Edit a file by replacing an exact string match with new content',
      parameters: z.object({
        path: z.string().describe('File path relative to working directory'),
        oldText: z.string().describe('Exact text to find and replace'),
        newText: z.string().describe('Text to replace with'),
      }),
      execute: async ({ path, oldText, newText }) => {
        try {
          const fullPath = resolve(workingDirectory, path);
          if (!fullPath.startsWith(workingDirectory)) {
            return { error: 'Access denied: path outside working directory' };
          }
          const content = readFileSync(fullPath, 'utf-8');
          if (!content.includes(oldText)) {
            return { error: 'Old text not found in file' };
          }
          const newContent = content.replace(oldText, newText);
          writeFileSync(fullPath, newContent, 'utf-8');
          return { success: true, path: relative(workingDirectory, fullPath) };
        } catch (e: any) {
          return { error: e.message };
        }
      },
    }),

    listDirectory: tool({
      description: 'List files and directories at a given path',
      parameters: z.object({
        path: z.string().describe('Directory path relative to working directory').default('.'),
      }),
      execute: async ({ path }) => {
        try {
          const fullPath = resolve(workingDirectory, path);
          if (!fullPath.startsWith(workingDirectory)) {
            return { error: 'Access denied: path outside working directory' };
          }
          const entries = readdirSync(fullPath).map(name => {
            const stat = statSync(join(fullPath, name));
            return { name, type: stat.isDirectory() ? 'directory' : 'file', size: stat.size };
          });
          return { entries, path: relative(workingDirectory, fullPath) || '.' };
        } catch (e: any) {
          return { error: e.message };
        }
      },
    }),

    searchFiles: tool({
      description: 'Search for files matching a glob pattern in the working directory',
      parameters: z.object({
        pattern: z.string().describe('Glob pattern like "**/*.ts" or "src/**/*.js"'),
      }),
      execute: async ({ pattern }) => {
        try {
          const files = globbySync(pattern, { cwd: workingDirectory, gitignore: true });
          return { files: files.slice(0, 100), total: files.length };
        } catch (e: any) {
          return { error: e.message };
        }
      },
    }),

    searchContent: tool({
      description: 'Search for text content within files using grep',
      parameters: z.object({
        query: z.string().describe('Text or regex to search for'),
        glob: z.string().describe('Optional glob to narrow file search').optional(),
      }),
      execute: async ({ query, glob }) => {
        try {
          const globArg = glob ? `--include="${glob}"` : '';
          const cmd = `grep -rn ${globArg} --max-count=50 "${query.replace(/"/g, '\\"')}" .`;
          const result = execSync(cmd, {
            cwd: workingDirectory,
            encoding: 'utf-8',
            timeout: 10000,
            maxBuffer: 1024 * 1024,
          });
          const lines = result.trim().split('\n').slice(0, 30);
          return { matches: lines };
        } catch {
          return { matches: [] };
        }
      },
    }),

    executeCommand: tool({
      description: 'Execute a shell command in the working directory. Use for running tests, builds, git commands, etc.',
      parameters: z.object({
        command: z.string().describe('Shell command to execute'),
      }),
      execute: async ({ command }) => {
        try {
          // Security: block dangerous commands
          const blocked = ['rm -rf /', 'mkfs', 'dd if=', ':(){', 'fork bomb'];
          if (blocked.some(b => command.includes(b))) {
            return { error: 'Command blocked for safety' };
          }
          const result = execSync(command, {
            cwd: workingDirectory,
            encoding: 'utf-8',
            timeout: 30000,
            maxBuffer: 1024 * 1024 * 5,
          });
          return { output: result.slice(0, 10000), exitCode: 0 };
        } catch (e: any) {
          return {
            output: (e.stdout || '') + '\n' + (e.stderr || ''),
            exitCode: e.status || 1,
            error: e.message,
          };
        }
      },
    }),

    gitStatus: tool({
      description: 'Show the current git status (staged, unstaged, untracked files)',
      parameters: z.object({}),
      execute: async () => {
        try {
          const result = execSync('git status --porcelain', {
            cwd: workingDirectory, encoding: 'utf-8', timeout: 10000,
          });
          const lines = result.trim().split('\n').filter(Boolean);
          const staged = lines.filter(l => /^[MADRC]/.test(l)).map(l => l.trim());
          const unstaged = lines.filter(l => /^.[MADRC]/.test(l)).map(l => l.trim());
          const untracked = lines.filter(l => l.startsWith('??')).map(l => l.slice(3));
          return { staged, unstaged, untracked, clean: lines.length === 0 };
        } catch (e: any) {
          return { error: e.message };
        }
      },
    }),

    gitDiff: tool({
      description: 'Show git diff for working changes or staged changes',
      parameters: z.object({
        staged: z.boolean().describe('Show staged changes instead of working changes').default(false),
        path: z.string().describe('Optional file path to limit diff').optional(),
      }),
      execute: async ({ staged, path }) => {
        try {
          const args = staged ? '--cached' : '';
          const pathArg = path ? `-- "${path}"` : '';
          const result = execSync(`git diff ${args} ${pathArg}`.trim(), {
            cwd: workingDirectory, encoding: 'utf-8', timeout: 10000, maxBuffer: 1024 * 1024 * 2,
          });
          return { diff: result.slice(0, 15000), truncated: result.length > 15000 };
        } catch (e: any) {
          return { error: e.message };
        }
      },
    }),

    gitLog: tool({
      description: 'Show recent git commit history',
      parameters: z.object({
        count: z.number().describe('Number of commits to show').default(10),
        oneline: z.boolean().describe('Show one line per commit').default(true),
      }),
      execute: async ({ count, oneline }) => {
        try {
          const fmt = oneline ? '--oneline' : '--format=%H|%an|%ar|%s';
          const result = execSync(`git log ${fmt} -n ${Math.min(count, 50)}`, {
            cwd: workingDirectory, encoding: 'utf-8', timeout: 10000,
          });
          if (oneline) {
            return { commits: result.trim().split('\n').filter(Boolean) };
          }
          const commits = result.trim().split('\n').filter(Boolean).map(line => {
            const [hash, author, date, ...msgParts] = line.split('|');
            return { hash, author, date, message: msgParts.join('|') };
          });
          return { commits };
        } catch (e: any) {
          return { error: e.message };
        }
      },
    }),

    gitCommit: tool({
      description: 'Stage files and create a git commit',
      parameters: z.object({
        message: z.string().describe('Commit message'),
        files: z.array(z.string()).describe('Files to stage (use ["."] for all)').default(['.'])
      }),
      execute: async ({ message, files }) => {
        try {
          const fileArgs = files.map(f => `"${f}"`).join(' ');
          execSync(`git add ${fileArgs}`, { cwd: workingDirectory, encoding: 'utf-8', timeout: 10000 });
          const result = execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
            cwd: workingDirectory, encoding: 'utf-8', timeout: 10000,
          });
          return { success: true, output: result.trim() };
        } catch (e: any) {
          return { error: e.message };
        }
      },
    }),

    webFetch: tool({
      description: 'Fetch content from a URL. Returns text content for analysis.',
      parameters: z.object({
        url: z.string().describe('URL to fetch'),
        maxLength: z.number().describe('Max response length in characters').default(10000),
      }),
      execute: async ({ url, maxLength }) => {
        try {
          const response = await fetch(url, {
            headers: { 'User-Agent': 'Friday-Code/1.0' },
            signal: AbortSignal.timeout(15000),
          });
          if (!response.ok) {
            return { error: `HTTP ${response.status}: ${response.statusText}` };
          }
          const text = await response.text();
          return {
            content: text.slice(0, maxLength),
            contentType: response.headers.get('content-type') || 'unknown',
            truncated: text.length > maxLength,
            statusCode: response.status,
          };
        } catch (e: any) {
          return { error: e.message };
        }
      },
    }),

    runTests: tool({
      description: 'Run the test suite. Auto-detects the test runner from package.json or common patterns.',
      parameters: z.object({
        command: z.string().describe('Test command to run. If empty, auto-detects from package.json scripts.').optional(),
      }),
      execute: async ({ command }) => {
        try {
          let testCmd = command;
          if (!testCmd) {
            const pkgPath = join(workingDirectory, 'package.json');
            if (existsSync(pkgPath)) {
              const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
              if (pkg.scripts?.test) testCmd = 'npm test';
              else if (pkg.scripts?.['test:unit']) testCmd = 'npm run test:unit';
            }
            if (!testCmd && existsSync(join(workingDirectory, 'Makefile'))) {
              testCmd = 'make test';
            }
            if (!testCmd) testCmd = 'npm test';
          }
          const result = execSync(testCmd, {
            cwd: workingDirectory,
            encoding: 'utf-8',
            timeout: 120000,
            maxBuffer: 1024 * 1024 * 5,
          });
          return { output: result.slice(0, 15000), exitCode: 0, command: testCmd };
        } catch (e: any) {
          return {
            output: ((e.stdout || '') + '\n' + (e.stderr || '')).slice(0, 15000),
            exitCode: e.status || 1,
            command: command || 'npm test',
            error: e.message,
          };
        }
      },
    }),
  };
}

/** Tool safety classification for human-in-the-loop approval */
export const TOOL_SAFETY: Record<string, 'safe' | 'destructive'> = {
  readFile: 'safe',
  listDirectory: 'safe',
  searchFiles: 'safe',
  searchContent: 'safe',
  gitStatus: 'safe',
  gitDiff: 'safe',
  gitLog: 'safe',
  webFetch: 'safe',
  writeFile: 'destructive',
  editFile: 'destructive',
  executeCommand: 'destructive',
  gitCommit: 'destructive',
  runTests: 'destructive',
};
