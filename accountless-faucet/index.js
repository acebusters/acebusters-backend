import AWS from 'aws-sdk';
import Web3 from 'web3';
import Logger from 'ab-backend-common/logger';
import NutzContract from './src/nutzContract';
import Faucet from './src/index';

const handleError = function handleError(err, logger, callback) {
  logger.exception(err).then(callback);
};

exports.handler = function handler(event, context, callback) {
  const logger = new Logger(process.env.SENTRY_URL, context.functionName, 'accountless-faucet');
  const web3 = new Web3();
  web3.setProvider(new web3.providers.HttpProvider(process.env.PROVIDER_URL));

  const nutz = new NutzContract(
    web3,
    process.env.SENDER_ADDR,
    new AWS.SQS(),
    process.env.QUEUE_URL,
    process.env.NTZ_ADDR,
  );

  const faucet = new Faucet(
    nutz,
    logger,
    process.env.NTZ_THRESHOLD,
    process.env.ETH_THRESHOLD,
  );

  const getRequestHandler = () => {
    const path = event.context['resource-path'];
    if (path.indexOf('fund') > -1) {
      return faucet.requestFunds(event.address);
    }

    return Promise.reject(`Not Found: unexpected path: ${path}`);
  };

  try {
    getRequestHandler()
      .then(data => callback(null, data))
      .catch(err => handleError(err, logger, callback));
  } catch (err) {
    handleError(err, logger, callback);
  }
};
