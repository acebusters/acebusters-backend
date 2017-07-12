import doc from 'dynamodb-doc';
import Web3 from 'web3';
import Raven from 'raven';
import Aws from 'aws-sdk';
import request from 'request';
import Pusher from 'pusher';

import Db from './src/db';
import EventWorker from './src/index';
import Table from './src/tableContract';
import Nutz from './src/nutzContract';
import Controller from './src/controllerContract';
import Factory from './src/factoryContract';
import MailerLite from './src/mailerLite';
import Lambda from './src/lambda';

let web3Provider;
let pusher;
let dynamo;

exports.handler = function handler(event, context, callback) {
  const tableName = process.env.TABLE_NAME;

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
    const table = new Table(web3, process.env.SENDER_ADDR);
    const controller = new Controller(web3, process.env.SENDER_ADDR);
    const factory = new Factory(web3, process.env.SENDER_ADDR, process.env.FACTORY_ADDR);
    const nutz = new Nutz(web3, process.env.SENDER_ADDR, process.env.NUTZ_ADDR);
    const mailer = new MailerLite(request, process.env.ML_KEY, process.env.ML_GROUP);
    const lambda = new Lambda(new Aws.Lambda(), process.env.ORACLE_FUNC_NAME);

    if (!dynamo) {
      dynamo = new doc.DynamoDB();
    }

    let requests = [];
    const worker = new EventWorker(table, factory, new Db(dynamo, tableName), process.env.ORACLE_PRIV,
      Raven, controller, nutz, process.env.RECOVERY_PRIV, mailer, lambda, pusher);
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
