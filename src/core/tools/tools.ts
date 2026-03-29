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
  };
}
