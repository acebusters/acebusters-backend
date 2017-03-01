const AWS = require('aws-sdk');
const doc = require('dynamodb-doc');
const Web3 = require('web3');

const Db = require('./lib/db');
const EventWorker = require('./lib/index');
const Table = require('./lib/tableContract');
const Factory = require('./lib/factoryContract');

var web3Provider, dynamo;

exports.handler = function(event, context, callback) {
  console.log('Request received:\n', JSON.stringify(event));
  if (event.Records && event.Records instanceof Array) {
    var web3;
    if (!web3Provider) {
      web3 = new Web3();
      web3Provider = new web3.providers.HttpProvider(process.env.PROVIDER_URL);
    }
    web3 = new Web3(web3Provider);
    const table = new Table(web3, process.env.SENDER_ADDR);
    const factory = new Factory(web3, process.env.SENDER_ADDR, process.env.FACTORY_ADDR);

    if (!dynamo) {
      dynamo = new doc.DynamoDB();
    }

    var requests = [];
    var worker = new EventWorker(table, factory, new Db(dynamo), process.env.ORACLE_PRIV);
    for (var i = 0; i < event.Records.length; i++) {
      requests.push(worker.process(event.Records[i].Sns));
    }
    Promise.all(requests).then(function(data) {
      console.log(JSON.stringify(data));
      callback(null, data);
    }).catch(function(err) {
      console.log(JSON.stringify(err));
      console.log(err.stack);
      callback(err);
    });
  } else {
    console.log('Context received:\n', JSON.stringify(context));
    console.log('taking no action.');
  }
}