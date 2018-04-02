import AWS from 'aws-sdk';
import doc from 'dynamodb-doc';
import Web3 from 'web3';
import Logger from 'ab-backend-common/logger';

import Dynamo from './src/dynamo';
import Db from './src/db';
import ScanManager from './src/scanner';
import Table from './src/tableContract';
import Factory from './src/factoryContract';

let web3Provider;
const simpledb = new AWS.SimpleDB();
const cloudwatch = new AWS.CloudWatch();
let dynamo;

exports.handler = function handler(event, context, callback) {
  context.callbackWaitsForEmptyEventLoop = false; // eslint-disable-line no-param-reassign

  const logger = new Logger(process.env.SENTRY_URL, context.functionName, 'interval-scanner');

  let web3;
  if (!web3Provider) {
    web3 = new Web3();
    web3Provider = new web3.providers.HttpProvider(process.env.PROVIDER_URL);
  }
  web3 = new Web3(web3Provider);

  if (!dynamo) {
    dynamo = new doc.DynamoDB();
  }
  const factoryAddr = process.env.FACTORY_ADDR;
  const topicArn = process.env.TOPIC_ARN;
  const tableName = process.env.TABLE_NAME;
  const proxyTable = process.env.PROXIES_TABLE;
  let wallets = process.env.WALLET_ADDR_LIST;
  if (wallets) {
    wallets = wallets.split(',');
  }

  const manager = new ScanManager(
    new Factory(web3, factoryAddr),
    new Table(web3),
    new Dynamo(dynamo, tableName),
    new AWS.SNS(),
    logger,
    topicArn,
    web3,
    cloudwatch,
    new Db(simpledb, proxyTable),
  );

  manager.scan(wallets)
    .then(data => callback(null, data))
    .catch(err => logger.exception(err).then(callback));
};
