import AWS from 'aws-sdk';
import Web3 from 'web3';
import Logger from 'ab-backend-common/logger';
import Db from './src/db';
import Email from './src/email';
import Recaptcha from './src/recaptcha';
import ProxyContr from './src/proxyContract';
import NutzContr from './src/nutzContract';
import AccountManager from './src/index';
import SlackAlert from './src/slackAlert';

const simpledb = new AWS.SimpleDB();
const ses = new AWS.SES();

const handleError = function handleError(err, logger, callback) {
  logger.exception(err).then(callback);
};

let web3Provider;

exports.handler = function handler(event, context, callback) {
  const logger = new Logger(process.env.SENTRY_URL, context.functionName, 'account-service');

  let web3;
  if (!web3Provider) {
    web3 = new Web3();
    web3Provider = new web3.providers.HttpProvider(process.env.PROVIDER_URL);
  }
  web3 = new Web3(web3Provider);

  const recapSecret = process.env.RECAPTCHA_SECRET;
  const path = event.context['resource-path'];
  const method = event.context['http-method'];
  const topicArn = process.env.TOPIC_ARN;
  const sessionPriv = process.env.SESSION_PRIV;
  const unlockPriv = process.env.RECOVERY_PRIV;
  const proxy = new ProxyContr(web3, process.env.SENDER_ADDR, new AWS.SQS(), process.env.QUEUE_URL);
  const nutz = new NutzContr(
    web3,
    process.env.SENDER_ADDR,
    new AWS.SQS(),
    process.env.QUEUE_URL,
    process.env.NTZ_ADDR,
  );
  const fromEmail = process.env.FROM_EMAIL;
  const accountTable = process.env.ACCOUNT_TABLE;
  const refTable = process.env.REF_TABLE;
  const proxyTable = process.env.PROXIES_TABLE;
  const minProxiesAlertThreshold = Number(process.env.SLACK_ALERT_MIN_PROXIES_THRESHOLD || 3);
  const slackAlertUrl = process.env.SLACK_ALERT_URL;
  const slackAlertChannel = process.env.SLACK_ALERT_CHANNEL;

  let slackAlert;
  if (slackAlertUrl && slackAlertChannel) {
    const env = process.env.ENV ? process.env.ENV : proxyTable;
    slackAlert = new SlackAlert(slackAlertUrl, slackAlertChannel, env);
  }

  const manager = new AccountManager(
    new Db(simpledb, accountTable, refTable, proxyTable),
    new Email(ses, fromEmail),
    new Recaptcha(recapSecret),
    new AWS.SNS(),
    topicArn,
    sessionPriv,
    proxy,
    nutz,
    logger,
    unlockPriv,
    slackAlert,
    minProxiesAlertThreshold,
  );
  const getRequestHandler = () => {
    if (path.indexOf('confirm') > -1) {
      return manager.confirmEmail(event.sessionReceipt);
    } else if (path.indexOf('reset') > -1) {
      return manager.resetRequest(
        event.email,
        event.recapResponse,
        event.origin,
        event.context['source-ip'],
      );
    } else if (path.indexOf('query') > -1) {
      return manager.queryAccount(event.email);
    } else if (path.indexOf('wallet') > -1) {
      if (method === 'POST') {
        return manager.setWallet(
          event.sessionReceipt,
          event.wallet,
          event.proxyAddr,
        );
      }
      if (method === 'PUT') {
        return manager.resetWallet(event.sessionReceipt, event.wallet);
      }
    } else if (path.indexOf('referral') > -1) {
      return manager.getRef(event.params.path.refCode);
    } else if (path.indexOf('refs') > -1) {
      return manager.queryRefCodes(event.params.path.accountId);
    } else if (path.indexOf('account') > -1) {
      if (method === 'GET') {
        return manager.getAccount(event.params.path.accountId);
      }
      if (method === 'POST') {
        return manager.addAccount(
          event.params.path.accountId,
          event.email,
          event.recapResponse,
          event.origin,
          event.context['source-ip'],
          event.refCode,
        );
      }
    } else if (path.indexOf('unlock') > -1) {
      return manager.queryUnlockReceipt(
        decodeURIComponent(event.params.path.unlockRequest),
      );
    } else if (path.indexOf('forward') > -1) {
      return manager.forward(event.forwardReceipt, event.resetConfReceipt);
    } else if (path.indexOf('recentRefs') > -1) {
      return manager.recentRefs(event.refCode);
    } else if (path.indexOf('resend') > -1) {
      return manager.resendEmail(event.email, event.origin);
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
