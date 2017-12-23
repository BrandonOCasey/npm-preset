#!/usr/bin/env node
/* eslint-disable no-console */
/* eslint-disable max-len */
const pkg = require('../package.json');
const cluster = require('cluster');
const config = require('./config');
const runScript = require('./run-script');
const shorten = require('./shorten');
const intercept = require('intercept-stdout');
const Promise = require('bluebird');
const scriptMatches = require('./script-matches');
const options = {
  version: false,
  help: false,
  list: false,
  quiet: false,
  commandsOnly: false,
  printConfig: false,
  shorten: true,
  tasks: [],
  subArgs: []
};

const usage = function() {
  console.log();
  console.log(`  Usage: ${process.argv[1]}`);
  console.log();
  console.log('  > Note: by default script name args will be treated as series');
  console.log('  > Note2: script name args can use wild cards such as build:*');
  console.log();
  console.log('  -p,  --parallel [scripts...]     Run specified scripts in parallel');
  console.log('  -s,  --series   [scripts...]     Run specified scripts in series');
  console.log('  -V,  --version                   Print version and exit');
  console.log('  -h,  --help                      Print usage and exit');
  console.log('  -q,  --quiet                     Only print errors and warnings');
  console.log('  -l,  --list                      Print available scripts and exit');
  console.log('  -co, --commands-only             Only print errors, warnings, and script output');
  console.log('  -pc, --print-config              Print the npm-script config and exit');
  console.log('  -ns, --no-shorten                Do not shorten paths in stdout/stderr');
  console.log();
};

if (cluster.isMaster) {
  const index = process.argv.indexOf('--');

  if (index !== -1) {
    process.argv.splice(index, 1);
    options.subArgs = process.argv.splice(index);
  }

  const args = process.argv.slice(2);
  let currentType = 'series';

  while (args.length) {
    const arg = args.shift();

    if ((/^(-h|--help)$/).test(arg)) {
      options.help = true;
      currentType = 'series';
    } else if ((/^(-q|--quiet)$/).test(arg)) {
      options.quiet = true;
      currentType = 'series';
    } else if ((/^(-V|--version)$/).test(arg)) {
      options.version = true;
      currentType = 'series';
    } else if ((/^(-l|--list$)/).test(arg)) {
      options.list = true;
      currentType = 'series';
    } else if ((/^(--commands-only|-co)$/).test(arg)) {
      options.commandsOnly = true;
      currentType = 'series';
    } else if ((/^(--print-config|-pc)$/).test(arg)) {
      options.printConfig = true;
      currentType = 'series';
    } else if ((/^(--no-shorten|-ns)$/).test(arg)) {
      options.shorten = false;
      currentType = 'series';
    } else if ((/^(--parallel|-p)$/).test(arg)) {
      currentType = 'parallel';
    } else if ((/^(--series|-s)$/).test(arg)) {
      currentType = 'series';
    } else {
      const lastTask = options.tasks[options.tasks.length - 1];
      const scripts = scriptMatches(arg);

      if (lastTask && lastTask.type === currentType) {
        lastTask.scripts = lastTask.scripts.concat(scripts);
      } else {
        options.tasks.push({type: currentType, scripts});
      }
    }
  }

  let stderrFilter = (s) => s;
  let stdoutFilter = (s) => s;

  if (options.shorten) {
    // shorten stdout and stderr
    stderrFilter = shorten;
    stdoutFilter = shorten;
  }

  if (options.quiet) {
    // never print stdout
    stdoutFilter = (s) => '';
  }

  intercept(stdoutFilter, stderrFilter);

  if (options.version) {
    console.log(pkg.version);
    process.exit();
  }

  if (options.help) {
    usage();
    process.exit();
  }

  if (options.commandsOnly) {
    process.env.NPM_SCRIPT_COMMANDS_ONLY = true;
  }

  if (options.printConfig) {
    console.log(config);
    process.exit(0);
  }

  if (!config.pkg.scripts || !Object.keys(config.pkg.scripts).length) {
    console.error('There are no npm scripts to run, please add some!');
    process.exit(1);
  }

  if (options.list) {
    Object.keys(config.pkg.scripts).forEach(function(k) {
      console.log('"' + k + '": "' + config.pkg.scripts[k] + '"');
    });
    process.exit(0);
  }

  if (!options.tasks.length) {
    console.error('Must specify a script to run with -s, -p, or without an arg');
    process.exit(1);
  }

  // run through each task, before going to the next one
  Promise.each(options.tasks, function(task) {
    if (task.type === 'series') {
      return Promise.mapSeries(task.scripts, (s) => runScript(s, options.subArgs));
    }

    return Promise.map(task.scripts, (s) => {
      return new Promise((resolve, reject) => {
        const worker = cluster.fork({scriptName: s});

        worker.on('exit', function(code, signal) {
          if (code !== 0) {
            reject({exitCode: code});
          }
          resolve({exitCode: code});
        });
      });
    });
  }).then(function() {
    process.exit(0);
  }).error(function(error) {
    console.error(error);
    process.exit(1);
  });
} else {
  runScript(process.env.scriptName).then(function(result) {
    process.exit(result.exitCode);
  });
}

