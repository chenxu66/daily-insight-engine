#!/usr/bin/env node
'use strict';

// Register tsx CJS hook so TypeScript source files can be required directly
require('tsx/cjs');

// Run the pipeline entry point
require('./src/index.ts');
