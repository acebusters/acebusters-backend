import AWS from 'aws-sdk';
import Web3 from 'web3';
import Raven from 'raven';
import Db from './src/db';
import ScanManager from './src/scanner';
import Table from './src/tableContract';
import Factory from './src/factoryContract';

const web3 = new Web3();
const simpledb = new AWS.SimpleDB();

exports.handler = function handler(event, context, callback) {
  Raven.config(process.env.SENTRY_URL).install();
  context.callbackWaitsForEmptyEventLoop = false;
  const providerUrl = process.env.PROVIDER_URL;
  const factoryAddr = process.env.FACTORY_ADDR;
  const topicArn = process.env.TOPIC_ARN;

  web3.setProvider(new web3.providers.HttpProvider(providerUrl));

  const manager = new ScanManager(new Db(simpledb, 'ab-event-contracts'),
    new Table(web3), new AWS.SNS(), new Factory(web3, factoryAddr), topicArn);

  manager.scan(event.contractSet).then((data) => {
    callback(null, data);
  }).catch((err) => {
    Raven.captureException(err, { server_name: 'contract-scanner' }, (sendErr) => {
      if (sendErr) {
        console.log('Failed to send captured exception to Sentry');
        console.log(JSON.stringify(sendErr));
        callback(sendErr);
        return;
      }
      callback(null, err);
    });
  });
};
