#!/usr/bin/env node
import {CargoBridgeServer} from '../src/native/CargoBridgeServer.js';
const argv = process.argv.slice(2);
if (!argv.includes('--trust-projects')) {
  console.error('Native Cargo can execute build scripts, dependencies and programs with your permissions.');
  console.error('Start explicitly: node tools/cargo-bridge.mjs --trust-projects --origin https://wieslawsoltes.github.io --port 8787');
  process.exitCode = 2;
} else {
  const origins = argv.flatMap((value, i) => value === '--origin' ? [argv[i + 1]] : []);
  const allowedRoots = argv.flatMap((value, i) => value === '--allow-root' ? [argv[i + 1]] : []);
  if (allowedRoots.some(value => !value || value.startsWith('--'))) throw Error('--allow-root needs a local directory');
  const jobsIndex = argv.indexOf('--max-jobs');
  const jobs = jobsIndex < 0 ? undefined : Number(argv[jobsIndex + 1]);
  const server = new CargoBridgeServer({...(origins.length ? {origins} : {}), repositories: {allowedRoots, jobs}});
  const index = argv.indexOf('--port'), port = index < 0 ? 8787 : Number(argv[index + 1]);
  const connection = await server.listen(port);
  console.log(`Ferrite native Cargo bridge: ${connection.url}`);
  console.log(`Bearer token (keep private): ${connection.token}`);
  console.log(`Allowed origins: ${[...server.origins].join(', ')}`);
  console.log(`Authorized local roots: ${allowedRoots.join(', ') || '(none; remote cloning only)'}`);
  console.log(`Native parallel job budget: ${server.repositories.manager.budget.capacity}`);
  console.log('Use Native Cargo → Connect in Ferrite. The token stays in browser memory only.');
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (closing) return; closing = true; await server.close(); });
}
