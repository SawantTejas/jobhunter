// This bootstrap is plain JavaScript so older Node versions can explain/recover
// before attempting to load TypeScript or node:sqlite.
const { spawnSync } = require('node:child_process');
const { join, resolve } = require('node:path');
const { homedir } = require('node:os');

const root = resolve(__dirname, '..');
const candidates = [...new Set([
  process.env.JOB_AGENT_NODE,
  process.execPath,
  join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'),
].filter(Boolean))];
const runtime = candidates.find(candidate => {
  const probe = spawnSync(candidate, ['-e', "require('node:sqlite'); process.exit(Number(process.versions.node.split('.')[0]) >= 24 && process.features.typescript ? 0 : 1)"], { stdio: 'ignore', windowsHide: true });
  return probe.status === 0;
});
if (!runtime) {
  console.error(`Job Agent requires Node.js 24+ with TypeScript support. Current runtime: ${process.version}\nInstall Node.js 24+, reopen your terminal, then run: node scripts/run.cjs list\nOr set JOB_AGENT_NODE to the full path of a compatible node executable.`);
  process.exit(1);
}
if (runtime !== process.execPath) console.error(`Using compatible Node runtime: ${runtime}`);
const args = process.argv.slice(2);
const invocation = args[0] === '--test'
  ? ['--test', ...require('node:fs').readdirSync(join(root, 'test')).filter(name => name.endsWith('.test.ts')).map(name => join(root, 'test', name))]
  : args[0] === '--test-assistant' ? ['--test', join(root, 'test', 'v06.test.ts')]
  : args[0] === '--assistant-setup' ? [join(root, 'src', 'application', 'setup.ts'), ...args.slice(1)]
  : args[0] === '--dev' ? [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--config', 'vite.local.config.ts']
  : args[0] === '--build' ? [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', 'vite.config.ts']
  : args[0] === '--preview' ? [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--host', '127.0.0.1', '--config', 'vite.config.ts']
  : [join(root, 'src', 'cli.ts'), ...args];
const result = spawnSync(runtime, invocation, { cwd: root, stdio: 'inherit', windowsHide: true });
if (result.error) console.error(`Could not start Job Agent: ${result.error.message}`);
process.exit(result.status ?? 1);
