import doc from 'dynamodb-doc';
import Web3 from 'web3';
import Raven from 'raven';

import Db from './src/db';
import EventWorker from './src/index';
import Table from './src/tableContract';
import Controller from './src/controllerContract';
import Factory from './src/factoryContract';

let web3Provider;
let dynamo;

exports.handler = function handler(event, context, callback) {
  Raven.config(process.env.SENTRY_URL, {
    captureUnhandledRejections: true,
  }).install(() => {
    callback(null, 'This is thy sheath; there rust, and let me die.');
  });

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

    if (!dynamo) {
      dynamo = new doc.DynamoDB();
    }

    let requests = [];
    const worker = new EventWorker(table, factory, new Db(dynamo),
      process.env.ORACLE_PRIV, Raven, controller, process.env.RECOVERY_PRIV);
    for (let i = 0; i < event.Records.length; i += 1) {
      requests = requests.concat(worker.process(event.Records[i].Sns));
    }
    Promise.all(requests).then((data) => {
      callback(null, data);
    }).catch((err) => {
      Raven.captureException(err, (sendErr) => {
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
