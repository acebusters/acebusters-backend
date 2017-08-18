import AWS from 'aws-sdk';
import Pusher from 'pusher';
import { ReceiptCache } from 'poker-helper';
import Raven from 'raven';
import StreamWorker from './src/index';

let pusher;
const rc = new ReceiptCache();

const handleError = function handleError(err, callback) {
  Raven.captureException(err, { server_name: 'stream-scanner' }, (sendErr) => {
    if (sendErr) {
      console.log(JSON.stringify(sendErr)); // eslint-disable-line no-console
      callback(sendErr);
      return;
    }
    callback(null, err);
  });
};

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
    const requests = [];
    const worker = new StreamWorker(new AWS.SNS(), process.env.TOPIC_ARN, pusher, rc, Raven);
    try {
      for (let i = 0; i < event.Records.length; i += 1) {
        requests.push(worker.process(event.Records[i]));
      }
    } catch (err) {
      handleError(err, callback);
    }
    Promise.all(requests).then((data) => {
      callback(null, data);
    }).catch((err) => {
      handleError(err, callback);
    });
  } else {
    console.log('Request received:\n', JSON.stringify(event));  // eslint-disable-line no-console
    callback(null, 'no action taken.');
  }
};
