import doc from 'dynamodb-doc';
import Web3 from 'web3';
import Raven from 'raven';
import AWS from 'aws-sdk';
import request from 'request';
import Pusher from 'pusher';

import Db from './src/db';
import EventWorker from './src/index';
import Table from './src/tableContract';
import MailerLite from './src/mailerLite';
import Lambda from './src/lambda';

let web3Provider;
let pusher;
let dynamo;
let sdb;

exports.handler = function handler(event, context, callback) {
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

  if (event.Records && event.Records instanceof Array) {
    let web3;
    if (!web3Provider) {
      web3 = new Web3();
      web3Provider = new web3.providers.HttpProvider(process.env.PROVIDER_URL);
    }
    web3 = new Web3(web3Provider);
    const table = new Table(web3, process.env.SENDER_ADDR, new AWS.SQS(), process.env.QUEUE_URL);
    const mailer = new MailerLite(request, process.env.ML_KEY, process.env.ML_GROUP);
    const lambda = new Lambda(new AWS.Lambda(), process.env.ORACLE_FUNC_NAME);

    if (!dynamo) {
      dynamo = new doc.DynamoDB();
    }

    if (!sdb) {
      sdb = new AWS.SimpleDB();
    }

    let requests = [];
    const worker = new EventWorker(
      table,
      new Db(dynamo, process.env.DYNAMO_TABLE_NAME, sdb, process.env.SDB_TABLE_NAME),
      process.env.ORACLE_PRIV,
      Raven,
      process.env.RECOVERY_PRIV,
      mailer,
      lambda,
      pusher,
    );
    for (let i = 0; i < event.Records.length; i += 1) {
      requests = requests.concat(worker.process(event.Records[i].Sns));
    }
    Promise.all(requests).then((data) => {
      callback(null, data);
    }).catch((err) => {
      Raven.captureException(err, { server_name: 'event-worker' }, (sendErr) => {
        if (sendErr) {
          console.log(JSON.stringify(sendErr)); // eslint-disable-line no-console
          callback(sendErr);
          return;
        }
        callback(null, err);
      });
    });
  } else {
    console.log('Context received:\n', JSON.stringify(context)); // eslint-disable-line no-console
    callback(null, 'no action taken.');
  }
};
