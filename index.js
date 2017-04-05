import AWS from 'aws-sdk';
import doc from 'dynamodb-doc';
import Web3 from 'web3';
import Raven from 'raven';

import Sdb from './src/sdb.js';
import Dynamo from './src/dynamo';
import ScanManager from './src/scanner.js';
import Contract from './src/tableContract.js';

let web3Provider;
let dynamo;
const simpledb = new AWS.SimpleDB();

exports.handler = function (event, context, callback) {
  context.callbackWaitsForEmptyEventLoop = false;

  Raven.config(process.env.SENTRY_URL, {
    captureUnhandledRejections: true,
  }).install(() => {
    callback(null, 'This is thy sheath; there rust, and let me die.');
  });

  if (!event.providerUrl || !event.contractSet)
    callback('Bad Request: provider or set name not provided');

  let web3;
  if (!web3Provider) {
    web3 = new Web3();
    web3Provider = new web3.providers.HttpProvider(process.env.PROVIDER_URL);
  }
  web3 = new Web3(web3Provider);

  if (!dynamo) {
    dynamo = new doc.DynamoDB();
  }

  const manager = new ScanManager(new Sdb(simpledb, process.env.SDB_DOMAIN), new Dynamo(dynamo), new Contract(web3), new AWS.SNS(), Raven);

  manager.scan(event.contractSet).then((data) => {
    callback(null, data);
  }).catch((err) => {
    Raven.captureException(err, (sendErr) => {
      if (sendErr) {
        console.log('Failed to send captured exception to Sentry');
        console.log(JSON.stringify(sendErr));
        callback(sendErr);
        return;
      }
      callback(null, err);
    });
  });
}