const changedFolders = require('github-changed-folders');
const { spawn } = require('child_process');

// set by Shippable
const commit = process.env.COMMIT;

const sandboxLambdas = {
  'account-service': 'sb-account-service',
  'contract-scanner': 'ab-contract-scanner',
  'event-worker': 'sb-event-worker',
  'interval-scanner': 'ab-interval-scanner',
  'oracle-cashgame': 'poker',
  'reserve-service': 'ab-seats-reservation',
  'stream-scanner': 'sb-stream-scanner',
};

changedFolders('parsec-labs/acebusters-backend', commit).then((repos) => {
  repos.forEach((repo) => {
    console.log(`Packaging ${repo}..`);  // eslint-disable-line no-console
    const child = spawn('npm', ['run', 'deploy'], {
      env: Object.assign(process.env, {
        PACKAGE: repo,
        LAMBDA_NAME: sandboxLambdas[repo],
      }),
    });
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
    process.on('exit', () => { console.log('Done.'); });  // eslint-disable-line no-console
  });
});
