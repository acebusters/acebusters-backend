import doc from 'dynamodb-doc';
import Web3 from 'web3';

import Db from './src/db';
import EventWorker from './src/index';
import Table from './src/tableContract';
import Factory from './src/factoryContract';

let web3Provider;
let dynamo;

exports.handler = function(event, context, callback) {
  console.log('Request received:\n', JSON.stringify(event));
  if (event.Records && event.Records instanceof Array) {
    let web3;
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

    let requests = [];
    const worker = new EventWorker(table, factory, new Db(dynamo), process.env.ORACLE_PRIV);
    for (let i = 0; i < event.Records.length; i+=1) {
      requests = requests.concat(worker.process(event.Records[i].Sns));
    }
    Promise.all(requests).then((data) => {
      console.log(JSON.stringify(data));
      callback(null, data);
    }).catch((err) => {
      console.log(JSON.stringify(err));
      console.log(err.stack);
      callback(err);
    });
  } else {
    console.log('Context received:\n', JSON.stringify(context));
    console.log('taking no action.');
  }
};
