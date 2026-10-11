#!/usr/bin/env node
/** Differential check of declaration acceptance AND each reported variance.
 *
 * The base sources use only Ferrite-supported types. Separate native-only cast
 * probes use quantified lifetimes to observe rustc's nominal variance: a cast
 * in each direction distinguishes co/contravariance, invariance and bivariance.
 * This does not claim lifetime/subtyping support in the browser compiler.
 * No rustc-internal attributes, unstable features or RUSTC_BOOTSTRAP are needed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {compile} from '../src/engine.js';

const options = {cases: 60, seed: 0x51e4c2, output: 'artifacts/variance-conformance.json'};
for (const argument of process.argv.slice(2)) {
  const match = /^--(cases|seed|output)=(.+)$/.exec(argument);
  if (!match) throw new Error(`Unknown argument ${argument}; use --cases=N, --seed=N or --output=FILE`);
  options[match[1]] = match[1] === 'output' ? match[2] : Number(match[2]);
}
if (!Number.isSafeInteger(options.cases) || options.cases < 1 || options.cases > 1000 ||
    !Number.isInteger(options.seed) || options.seed < 0 || options.seed > 0xffffffff)
  throw new RangeError('Expected 1–1000 cases and a uint32 seed');
const rustc = process.env.RUSTC || 'rustc';
const version = spawnSync(rustc, ['--version', '--verbose'], {encoding: 'utf8', timeout: 10000});
if (version.error || version.status !== 0) throw new Error(`Native variance oracle unavailable: ${version.error?.message ?? version.stderr}`);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ferrite-variance-'));
const records = [], started = Date.now();
let state = options.seed, failure = null, subtypeChecks = 0;
const next = n => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % n; };
function native(source) {
  const file = path.join(directory, 'fixture.rs');
  fs.writeFileSync(file, source);
  const result = spawnSync(rustc, [file, '--edition=2024', '-A', 'warnings', '--emit=metadata',
    '-o', path.join(directory, 'fixture.rmeta')], {encoding: 'utf8', timeout: 10000, maxBuffer: 2 * 1024 * 1024});
  if (result.error || result.signal || result.status === null)
    throw new Error(`Native variance probe did not finish: ${result.error?.message ?? result.signal}`);
  return {accepted: result.status === 0, diagnostics: result.stderr};
}
try {
  for (let i = 0; i < options.cases; i++) {
    const count = 1 + next(4), names = Array.from({length: count}, (_, j) => `S${j}`), declarations = [];
    for (const name of names) {
      const fields = [];
      for (let j = 0, length = 1 + next(3); j < length; j++) {
        const inner = next(4) === 0 ? 'T' : `${names[next(count)]}<T>`;
        const choices = [`fn(${inner})`, `fn()->${inner}`, `fn(&${inner})`, `fn(&mut ${inner})`,
          `std::marker::PhantomData<${inner}>`, `fn(fn(${inner}))`, `fn([${inner};0])`, `fn(Vec<${inner}>)`];
        fields.push(choices[next(choices.length)]);
      }
      declarations.push(`struct ${name}<T>(${fields.join(',')});`);
    }
    const source = declarations.join('\n') + '\nfn main(){}', oracle = native(source);
    const record = {id: i, source, nativeAccepted: oracle.accepted, browserAccepted: true, variances: [], casts: []};
    records.push(record);
    try { record.variances = compile(source).sem.nominalVariance.declarations.filter(d => names.includes(d.name)); }
    catch (error) { record.browserAccepted = false; record.browserDiagnostic = {code: error.code, message: error.message}; }
    if (record.browserAccepted !== oracle.accepted) {
      record.nativeDiagnostics = oracle.diagnostics;
      throw new Error(`Declaration acceptance mismatch in generated graph ${i}`);
    }
    if (!record.browserAccepted) {
      if (record.browserDiagnostic.code !== 'E0392')
        throw new Error(`Unexpected rejection ${record.browserDiagnostic.code} in generated graph ${i}`);
      continue;
    }
    for (const declaration of record.variances) {
      const variance = declaration.parameters[0].variance;
      for (const direction of ['co', 'contra']) {
        const from = direction === 'co' ? "'b" : "'a", to = direction === 'co' ? "'a" : "'b";
        const cast = `fn cast<'a,'b:'a>(x:${declaration.name}<&${from} i32>)->${declaration.name}<&${to} i32>{x}`;
        const expected = variance === 'bivariant' || variance === (direction === 'co' ? 'covariant' : 'contravariant');
        const result = native(source + '\n' + cast);
        record.casts.push({name: declaration.name, direction, source: cast, expected, accepted: result.accepted});
        subtypeChecks++;
        if (result.accepted !== expected) {
          record.nativeDiagnostics = result.diagnostics;
          throw new Error(`Variance mismatch in graph ${i}, ${declaration.name}, ${direction}: reported ${variance}`);
        }
      }
    }
  }
} catch (error) { failure = error.message; }
finally {
  fs.rmSync(directory, {recursive: true, force: true});
  const output = {schema: 1, passed: failure === null, nativeValidated: true, rustc: version.stdout.trim(),
    seed: options.seed, requestedCases: options.cases, checkedCases: records.length, subtypeChecks,
    durationMs: Date.now() - started, failure, cases: records};
  fs.mkdirSync(path.dirname(path.resolve(options.output)), {recursive: true});
  fs.writeFileSync(options.output, JSON.stringify(output, null, 2) + '\n');
}
if (failure) { console.error(failure); process.exitCode = 1; }
else console.log(`Variance oracle passed: ${records.length} declaration graphs, ${subtypeChecks} native subtype probes.`);
