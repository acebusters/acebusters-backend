const AWS = require('aws-sdk');
const doc = require('dynamodb-doc');
const Sdb = require('./lib/sdb.js');
const Dynamo = require('./lib/dynamo');
const ScanManager = require('./lib/scanner.js');
const Contract = require('./lib/tableContract.js');
const Web3 = require('web3');

var web3Provider, dynamo;
const simpledb = new AWS.SimpleDB();

exports.handler = function(event, context, callback) {
  context.callbackWaitsForEmptyEventLoop = false;

  if (!event.providerUrl || !event.contractSet)
    callback('Bad Request: provider or set name not provided');

  var web3;
  if (!web3Provider) {
    web3 = new Web3();
    web3Provider = new web3.providers.HttpProvider(process.env.PROVIDER_URL);
  }
  web3 = new Web3(web3Provider);

  if (!dynamo) {
    dynamo = new doc.DynamoDB();
  }

  var manager = new ScanManager(new Sdb(simpledb, process.env.SDB_DOMAIN), new Dynamo(dynamo), new Contract(web3), new AWS.SNS());

  manager.scan(event.contractSet).then(function(data){
    callback(null, data);
  }).catch(function(err){
    callback(err);
  });
}