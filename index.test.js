import chai, { expect } from 'chai';
import sinonChai from 'sinon-chai';
import sinon from 'sinon';
import { it, describe, afterEach } from 'mocha';
import BigNumber from 'bignumber.js';

import ScanManager from './src/scanner';
import Dynamo from './src/dynamo';
import Table from './src/tableContract';
import Factory from './src/factoryContract';

chai.use(sinonChai);

const P1_ADDR = '0xf3beac30c498d9e26865f34fcaa57dbb935b0d74';
const P2_ADDR = '0xe10f3d125e5f4c753a6456fc37123cf17c6900f2';
const factoryAddr = '0xe10f3d125e5f4c753a6456fc37123cf17c6900f2';

const topicArn = 'arn:aws:sns:eu-west-1:123:ab-events';

const dynamo = {
  query() {},
};

const sns = {
  publish() {},
};

const contract = {
  lastHandNetted: { call() {} },
  lastNettingRequestHandId: { call() {} },
  lastNettingRequestTime: { call() {} },
  getTables: { call() {} },
};

const web3 = { eth: {
  contract() {},
  at() {},
} };

const sentry = {
  captureMessage() {},
  captureException() {},
};

const request = {
  post() {},
};

const set = {
  id: 'tables',
  addresses: ['0x4C4A59e59172A8369562a3901737d57c84fC9A3C', '0x37a9679c41e99dB270Bda88DE8FF50c0Cd23f326'],
  topicArn: 'arn:aws:sns:eu-west-1:123:ab-events',
};

sinon.stub(web3.eth, 'contract').returns(web3.eth);
sinon.stub(web3.eth, 'at').returns(contract);

describe('Interval Scanner', () => {
  it('should do nothing with fresh netting request', (done) => {
    const now = Math.floor(Date.now() / 1000);
    sinon.stub(contract.getTables, 'call').yields(null, [set.addresses[0]]);
    sinon.stub(sns, 'publish').yields(null, {});
    sinon.stub(contract.lastHandNetted, 'call').yields(null, new BigNumber(5));
    sinon.stub(contract.lastNettingRequestHandId, 'call').yields(null, new BigNumber(10));
    sinon.stub(contract.lastNettingRequestTime, 'call').yields(null, new BigNumber(now));
    sinon.stub(sentry, 'captureMessage').yields(null, {});
    sinon.stub(request, 'post').yields(null, {});

    const manager = new ScanManager(new Factory(web3, factoryAddr),
      new Table(web3), null, sns, sentry, request, topicArn);

    manager.scan().then(() => {
      expect(sentry.captureMessage).callCount(0);
      expect(sns.publish).callCount(0);
      done();
    }).catch(done);
  });

  it('should do nothing with netting request older than 1 hour', (done) => {
    const now = Math.floor(Date.now() / 1000);
    sinon.stub(contract.getTables, 'call').yields(null, [set.addresses[0]]);
    sinon.stub(sns, 'publish').yields(null, {});
    sinon.stub(contract.lastHandNetted, 'call').yields(null, new BigNumber(5));
    sinon.stub(contract.lastNettingRequestHandId, 'call').yields(null, new BigNumber(10));
    sinon.stub(contract.lastNettingRequestTime, 'call').yields(null, new BigNumber(now));
    sinon.stub(sentry, 'captureMessage').yields(null, {});
    sinon.stub(request, 'post').yields(null, {});

    const manager = new ScanManager(new Factory(web3, factoryAddr),
      new Table(web3), null, sns, sentry, request, topicArn);

    manager.scan().then(() => {
      expect(sentry.captureMessage).callCount(0);
      expect(sns.publish).callCount(0);
      done();
    }).catch(done);
  });

  it('should handle multiple contracts', (done) => {
    const now = Math.floor(Date.now() / 1000) - 3601;
    sinon.stub(contract.getTables, 'call').yields(null, [set.addresses[0], set.addresses[1]]);
    sinon.stub(sns, 'publish').yields(null, {});
    sinon.stub(contract.lastHandNetted, 'call').yields(null, new BigNumber(5));
    sinon.stub(contract.lastNettingRequestHandId, 'call').yields(null, new BigNumber(10));
    sinon.stub(contract.lastNettingRequestTime, 'call').yields(null, new BigNumber(now));
    sinon.stub(sentry, 'captureMessage').yields(null, {});
    sinon.stub(request, 'post').yields(null, {});

    const manager = new ScanManager(new Factory(web3, factoryAddr),
      new Table(web3), null, sns, sentry, request, topicArn);

    manager.scan().then((rsp) => {
      expect(rsp.length).to.eql(2);
      expect(sentry.captureMessage).callCount(0);
      expect(sns.publish).callCount(0);
      done();
    }).catch(done);
  });

  it('should react to mature netting requests', (done) => {
    const now = Math.floor(Date.now() / 1000) - 181;
    sinon.stub(contract.getTables, 'call').yields(null, [set.addresses[0]]);
    sinon.stub(sns, 'publish').yields(null, {});
    sinon.stub(contract.lastHandNetted, 'call').yields(null, new BigNumber(5));
    sinon.stub(contract.lastNettingRequestHandId, 'call').yields(null, new BigNumber(10));
    sinon.stub(contract.lastNettingRequestTime, 'call').yields(null, new BigNumber(now));
    sinon.stub(sentry, 'captureMessage').yields(null, {});
    sinon.stub(request, 'post').yields(null, {});

    const manager = new ScanManager(new Factory(web3, factoryAddr),
      new Table(web3), null, sns, sentry, request, topicArn);

    manager.scan().then(() => {
      expect(sentry.captureMessage).callCount(1);
      expect(sentry.captureMessage).calledWith(sinon.match(`HandleDispute::${set.addresses[0]}`), {
        level: 'info',
        server_name: 'interval-scanner',
        tags: { tableAddr: set.addresses[0] },
        extra: { lhn: 5, lnr: 10, lnt: sinon.match.any, now: sinon.match.any },
      });
      expect(sns.publish).callCount(1);
      expect(sns.publish).calledWith({
        Subject: `HandleDispute::${set.addresses[0]}`,
        Message: `{"tableAddr":"${set.addresses[0]}","lastHandNetted":5,"lastNettingRequest":10}`,
        TopicArn: set.topicArn,
      });
      done();
    }).catch(done);
  });

  it('should call net on contract if submission period over', (done) => {
    const now = Math.floor(Date.now() / 1000) - 601;
    sinon.stub(contract.getTables, 'call').yields(null, [set.addresses[0]]);
    sinon.stub(sns, 'publish').yields(null, {});
    sinon.stub(contract.lastHandNetted, 'call').yields(null, new BigNumber(5));
    sinon.stub(contract.lastNettingRequestHandId, 'call').yields(null, new BigNumber(10));
    sinon.stub(contract.lastNettingRequestTime, 'call').yields(null, new BigNumber(now));
    sinon.stub(sentry, 'captureMessage').yields(null, {});
    sinon.stub(request, 'post').yields(null, {});

    const manager = new ScanManager(new Factory(web3, factoryAddr),
      new Table(web3), null, sns, sentry, request, topicArn);

    manager.scan().then(() => {
      expect(sentry.captureMessage).callCount(1);
      expect(sentry.captureMessage).calledWith(sinon.match(`ProgressNetting::${set.addresses[0]}`), {
        level: 'info',
        server_name: 'interval-scanner',
        tags: { tableAddr: set.addresses[0] },
        extra: { lhn: 5, lnr: 10, lnt: sinon.match.any, now: sinon.match.any },
      });
      expect(sns.publish).callCount(1);
      expect(sns.publish).calledWith({
        Subject: `ProgressNetting::${set.addresses[0]}`,
        Message: '{}',
        TopicArn: set.topicArn,
      });
      done();
    }).catch(done);
  });

  it('should initiate new netting requests', (done) => {
    const now = Math.floor(Date.now() / 1000);
    sinon.stub(contract.getTables, 'call').yields(null, [set.addresses[0]]);
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 8,
      changed: now,
    }] });
    sinon.stub(sns, 'publish').yields(null, {});
    sinon.stub(contract.lastHandNetted, 'call').yields(null, new BigNumber(5));
    sinon.stub(contract.lastNettingRequestHandId, 'call').yields(null, new BigNumber(5));
    sinon.stub(contract.lastNettingRequestTime, 'call').yields(null, new BigNumber(0));
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const manager = new ScanManager(new Factory(web3, factoryAddr),
      new Table(web3), new Dynamo(dynamo), sns, sentry, request, topicArn);

    manager.scan().then(() => {
      expect(sentry.captureMessage).callCount(1);
      expect(sentry.captureMessage).calledWith(sinon.match(`TableNettingRequest::${set.addresses[0]}`), {
        level: 'info',
        server_name: 'interval-scanner',
        tags: { tableAddr: set.addresses[0] },
        extra: { handId: 8, lhn: 5 },
      });
      expect(sns.publish).callCount(1);
      expect(sns.publish).calledWith({
        Subject: `TableNettingRequest::${set.addresses[0]}`,
        Message: `{"handId":7,"tableAddr":"${set.addresses[0]}"}`,
        TopicArn: set.topicArn,
      });
      done();
    }).catch(done);
  });

  it('should kick a player', (done) => {
    const tenMinAgo = Math.floor((Date.now() / 1000) - (60 * 10)); // 10 minutes ago
    sinon.stub(contract.getTables, 'call').yields(null, [set.addresses[0]]);
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 8,
      changed: tenMinAgo,
      lineup: [{
        address: P1_ADDR,
      }, {
        address: P2_ADDR,
        sitout: tenMinAgo,
      }],
    }] });
    sinon.stub(sns, 'publish').yields(null, {});
    sinon.stub(contract.lastHandNetted, 'call').yields(null, new BigNumber(5));
    sinon.stub(contract.lastNettingRequestHandId, 'call').yields(null, new BigNumber(5));
    sinon.stub(contract.lastNettingRequestTime, 'call').yields(null, new BigNumber(0));
    sinon.stub(sentry, 'captureMessage').yields(null, {});
    sinon.stub(request, 'post').yields(null, {});

    const manager = new ScanManager(new Factory(web3, factoryAddr),
      new Table(web3), new Dynamo(dynamo), sns, sentry, request, topicArn);

    manager.scan().then(() => {
      expect(request.post).calledWith(sinon.match.has('url', sinon.match(set.addresses[0])));
      expect(sentry.captureMessage).callCount(2);
      expect(sentry.captureMessage).calledWith(sinon.match(`TableNettingRequest::${set.addresses[0]}`), {
        level: 'info',
        server_name: 'interval-scanner',
        tags: { tableAddr: set.addresses[0] },
        extra: { handId: 8, lhn: 5 },
      });
      expect(sentry.captureMessage).calledWith(sinon.match(`Kick::${set.addresses[0]}`), {
        level: 'info',
        server_name: 'interval-scanner',
        user: { id: P2_ADDR },
        tags: { tableAddr: set.addresses[0] },
        extra: sinon.match.any,
      });
      expect(sns.publish).callCount(2);
      expect(sns.publish).calledWith({
        Subject: `TableNettingRequest::${set.addresses[0]}`,
        Message: `{"handId":7,"tableAddr":"${set.addresses[0]}"}`,
        TopicArn: set.topicArn,
      });
      expect(sns.publish).calledWith({
        Subject: `Kick::${set.addresses[0]}`,
        Message: `{"pos":1,"tableAddr":"${set.addresses[0]}"}`,
        TopicArn: set.topicArn,
      });
      done();
    }).catch(done);
  });

  afterEach(() => {
    if (sns.publish.restore) sns.publish.restore();
    if (request.post.restore) request.post.restore();
    if (contract.getTables.call.restore) contract.getTables.call.restore();
    if (contract.lastHandNetted.call.restore) { contract.lastHandNetted.call.restore(); }
    if (contract.lastNettingRequestHandId.call.restore) {
      contract.lastNettingRequestHandId.call.restore();
    }
    if (contract.lastNettingRequestTime.call.restore) {
      contract.lastNettingRequestTime.call.restore();
    }
    if (dynamo.query.restore) dynamo.query.restore();
    if (sentry.captureMessage.restore) sentry.captureMessage.restore();
  });
});
