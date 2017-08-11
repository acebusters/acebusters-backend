import Web3 from 'web3';
import Raven from 'raven';
import Pusher from 'pusher';
import AWS from 'aws-sdk';

import Db from './src/db';
import TableContract from './src/tableContract';
import ReserveService from './src/index';

const simpledb = new AWS.SimpleDB();
let web3Provider;
let pusher;

exports.handler = function handler(event, context, callback) {
  context.callbackWaitsForEmptyEventLoop = false; // eslint-disable-line no-param-reassign
  Raven.config(process.env.SENTRY_URL).install();

  if (typeof pusher === 'undefined') {
    pusher = new Pusher({
      appId: process.env.PUSHER_APP_ID,
      key: process.env.PUSHER_KEY,
      secret: process.env.PUSHER_SECRET,
      cluster: 'eu',
      encrypted: true,
    });
  }

  // get configuration
  const cleanupTimeout = process.env.CLEANUP_TIMEOUT || 60;
  const tableName = process.env.TABLE_NAME;
  const providerUrl = process.env.PROVIDER_URL;
  const path = event.context['resource-path'];
  let web3;

  // set up web3 and worker
  if (!web3Provider) {
    web3 = new Web3();
    web3Provider = new web3.providers.HttpProvider(providerUrl);
  }
  web3 = new Web3(web3Provider);
  const table = new TableContract(web3);
  const service = new ReserveService(
    table,
    pusher,
    new Db(simpledb, tableName),
  );

  // handle request
  let handleRequest;
  if (path.indexOf('reserve') > -1) {
    handleRequest = service.reserve(
      event.tableAddr,
      event.pos,
      event.singerAddr,
      event.txHash,
      event.amount,
    );
  } else if (!path) {
    handleRequest = service.cleanup(cleanupTimeout);
  } else {
    handleRequest = Promise.reject(`Error: unexpected path: ${path}`);
  }
  handleRequest.then((data) => {
    callback(null, data);
  }).catch((err) => {
    Raven.captureException(err, { server_name: 'reserve-service' }, (sendErr) => {
      if (sendErr) {
        console.log(JSON.stringify(sendErr)); // eslint-disable-line no-console
        callback(sendErr);
        return;
      }
      callback(err);
    });
  });
};
