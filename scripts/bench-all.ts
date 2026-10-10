import { runThroughputBenchmark } from './bench-throughput.js';
import { runQueryPlansBenchmark } from './bench-query-plans.js';
import { runStorageBenchmark } from './bench-storage.js';
import { runRouterBenchmark } from './bench-router.js';
import { runLateDataBenchmark } from './bench-late.js';
import { generateBenchmarksMarkdown } from './generate-benchmarks-md.js';
import { closeDb } from '../src/db/mongo.js';

export async function runAllBenchmarks() {
  console.log('====================================================');
  console.log('   PULSEMETRIC: COMPREHENSIVE BENCHMARK SUITE       ');
  console.log('====================================================');

  try {
    console.log('\n[1/5] Running Write Throughput Load Benchmark...');
    await runThroughputBenchmark();

    console.log('\n[2/5] Running Query Execution Plans Benchmark...');
    await runQueryPlansBenchmark();

    console.log('\n[3/5] Running Storage Footprint & Compression Benchmark...');
    await runStorageBenchmark();

    console.log('\n[4/5] Running Smart Router Downsampling Benchmark...');
    await runRouterBenchmark();

    console.log('\n[5/5] Running Late-Data Lab Experiment...');
    await runLateDataBenchmark();

    console.log('\n[*] Generating BENCHMARKS.md from executed test results...');
    await generateBenchmarksMarkdown();

    console.log('\n====================================================');
    console.log('   ALL BENCHMARKS COMPLETED AND REPORT GENERATED    ');
    console.log('====================================================');
  } catch (err: any) {
    console.error('Benchmark suite error:', err);
    throw err;
  } finally {
    await closeDb();
  }
}

import { fileURLToPath } from 'url';
import path from 'path';

const isDirectCli = () => {
  try {
    return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
  } catch {
    return false;
  }
};

if (isDirectCli()) {
  runAllBenchmarks()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
