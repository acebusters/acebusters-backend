const AWS = require('aws-sdk');
const Db = require('./lib/db.js');
const ScanManager = require('./lib/scanner.js');
const Contract = require('./lib/contract.js');

const Web3 = require('web3');
const web3 = new Web3();

const simpledb = new AWS.SimpleDB();

exports.handler = function(event, context, callback) {
  context.callbackWaitsForEmptyEventLoop = false;

  if (!event.providerUrl || !event.contractSet)
    callback('Bad Request: provider or set name not provided');

  web3.setProvider(new web3.providers.HttpProvider(event.providerUrl));

  var manager = new ScanManager(new Db(simpledb, process.env.SDB_DOMAIN), new Contract(web3), new AWS.SNS());

  manager.scan(event.contractSet).then(function(data){
    callback(null, data);
  }).catch(function(err){
    callback(err);
  });
}