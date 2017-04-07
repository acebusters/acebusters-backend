const expect = require('chai').expect;
const sinon = require('sinon');
require('chai').use(require('sinon-chai'));
const BigNumber = require('bignumber.js');

const ScanManager = require('./src/scanner');
const Sdb = require('./src/sdb.js');
const Dynamo = require('./src/dynamo.js');
const Contract = require('./src/tableContract.js');

const P1_ADDR = '0xf3beac30c498d9e26865f34fcaa57dbb935b0d74';
const P2_ADDR = '0xe10f3d125e5f4c753a6456fc37123cf17c6900f2';
const EMPTY_ADDR = '0x0000000000000000000000000000000000000000';


const sdb = {
  getAttributes() {},
};

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
};

const web3 = { eth: {
  contract() {},
  at() {},
} };

const sentry = {
  captureMessage(msg) {
    console.log(msg);
  },
  captureException(err) {
    console.log(err);
  },
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
    sinon.stub(sdb, 'getAttributes').yields(null, { Attributes: [
      { Name: 'addresses', Value: set.addresses[0] },
      { Name: 'topicArn', Value: set.topicArn },
    ] });
    sinon.stub(sns, 'publish').yields(null, {});
    sinon.stub(contract.lastHandNetted, 'call').yields(null, new BigNumber(5));
    sinon.stub(contract.lastNettingRequestHandId, 'call').yields(null, new BigNumber(10));
    sinon.stub(contract.lastNettingRequestTime, 'call').yields(null, new BigNumber(now));
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const manager = new ScanManager(new Sdb(sdb), null, new Contract(web3), sns, sentry);

    manager.scan(set.id).then(() => {
      expect(sentry.captureMessage).callCount(0);
      expect(sns.publish).callCount(0);
      done();
    }).catch(done);
  });

  it('should handle multiple contracts', (done) => {
    const now = Math.floor(Date.now() / 1000);
    sinon.stub(sdb, 'getAttributes').yields(null, { Attributes: [
      { Name: 'addresses', Value: set.addresses[0] },
      { Name: 'addresses', Value: set.addresses[1] },
      { Name: 'topicArn', Value: set.topicArn },
    ] });
    sinon.stub(sns, 'publish').yields(null, {});
    sinon.stub(contract.lastHandNetted, 'call').yields(null, new BigNumber(5));
    sinon.stub(contract.lastNettingRequestHandId, 'call').yields(null, new BigNumber(10));
    sinon.stub(contract.lastNettingRequestTime, 'call').yields(null, new BigNumber(now));
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const manager = new ScanManager(new Sdb(sdb), null, new Contract(web3), sns, sentry);

    manager.scan(set.id).then((rsp) => {
      expect(rsp.length).to.eql(2);
      expect(sentry.captureMessage).callCount(0);
      expect(sns.publish).callCount(0);
      done();
    }).catch(done);
  });

  it('should react to mature netting requests', (done) => {
    const now = Math.floor(Date.now() / 1000) - 181;
    sinon.stub(sdb, 'getAttributes').yields(null, { Attributes: [
      { Name: 'addresses', Value: set.addresses[0] },
      { Name: 'topicArn', Value: set.topicArn },
    ] });
    sinon.stub(sns, 'publish').yields(null, {});
    sinon.stub(contract.lastHandNetted, 'call').yields(null, new BigNumber(5));
    sinon.stub(contract.lastNettingRequestHandId, 'call').yields(null, new BigNumber(10));
    sinon.stub(contract.lastNettingRequestTime, 'call').yields(null, new BigNumber(now));
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const manager = new ScanManager(new Sdb(sdb), null, new Contract(web3), sns, sentry);

    manager.scan(set.id).then((rsp) => {
      expect(sentry.captureMessage).callCount(1);
      expect(sentry.captureMessage).calledWith(`HandleDispute::${set.addresses[0]}`, {
        level: 'info',
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
    sinon.stub(sdb, 'getAttributes').yields(null, { Attributes: [
      { Name: 'addresses', Value: set.addresses[0] },
      { Name: 'topicArn', Value: set.topicArn },
    ] });
    sinon.stub(sns, 'publish').yields(null, {});
    sinon.stub(contract.lastHandNetted, 'call').yields(null, new BigNumber(5));
    sinon.stub(contract.lastNettingRequestHandId, 'call').yields(null, new BigNumber(10));
    sinon.stub(contract.lastNettingRequestTime, 'call').yields(null, new BigNumber(now));
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const manager = new ScanManager(new Sdb(sdb), null, new Contract(web3), sns, sentry);

    manager.scan(set.id).then((rsp) => {
      expect(sentry.captureMessage).callCount(1);
      expect(sentry.captureMessage).calledWith(`ProgressNetting::${set.addresses[0]}`, {
        level: 'info',
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
    sinon.stub(sdb, 'getAttributes').yields(null, { Attributes: [
      { Name: 'addresses', Value: set.addresses[0] },
      { Name: 'topicArn', Value: set.topicArn },
    ] });
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 8,
    }] });
    sinon.stub(sns, 'publish').yields(null, {});
    sinon.stub(contract.lastHandNetted, 'call').yields(null, new BigNumber(5));
    sinon.stub(contract.lastNettingRequestHandId, 'call').yields(null, new BigNumber(5));
    sinon.stub(contract.lastNettingRequestTime, 'call').yields(null, new BigNumber(0));
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const manager = new ScanManager(new Sdb(sdb), new Dynamo(dynamo), new Contract(web3), sns, sentry);

    manager.scan(set.id).then((rsp) => {
      expect(sentry.captureMessage).callCount(1);
      expect(sentry.captureMessage).calledWith(`TableNettingRequest::${set.addresses[0]}`, {
        level: 'info',
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
    const now = Date.now() - (1000 * 60 * 10); // 10 minutes ago
    sinon.stub(sdb, 'getAttributes').yields(null, { Attributes: [
      { Name: 'addresses', Value: set.addresses[0] },
      { Name: 'topicArn', Value: set.topicArn },
    ] });
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 8,
      lineup: [{
        address: P1_ADDR,
      }, {
        address: P2_ADDR,
        sitout: now,
      }],
    }] });
    sinon.stub(sns, 'publish').yields(null, {});
    sinon.stub(contract.lastHandNetted, 'call').yields(null, new BigNumber(5));
    sinon.stub(contract.lastNettingRequestHandId, 'call').yields(null, new BigNumber(5));
    sinon.stub(contract.lastNettingRequestTime, 'call').yields(null, new BigNumber(0));
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const manager = new ScanManager(new Sdb(sdb), new Dynamo(dynamo), new Contract(web3), sns, sentry);

    manager.scan(set.id).then((rsp) => {
      expect(sentry.captureMessage).callCount(2);
      expect(sentry.captureMessage).calledWith(`TableNettingRequest::${set.addresses[0]}`, {
        level: 'info',
        tags: { tableAddr: set.addresses[0] },
        extra: { handId: 8, lhn: 5 },
      });
      expect(sentry.captureMessage).calledWith(`Kick::${set.addresses[0]}`, {
        level: 'info',
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
    if (sdb.getAttributes.restore) sdb.getAttributes.restore();
    if (sns.publish.restore) sns.publish.restore();
    if (contract.lastHandNetted.call.restore) contract.lastHandNetted.call.restore();
    if (contract.lastNettingRequestHandId.call.restore) contract.lastNettingRequestHandId.call.restore();
    if (contract.lastNettingRequestTime.call.restore) contract.lastNettingRequestTime.call.restore();
    if (dynamo.query.restore) dynamo.query.restore();
    if (sentry.captureMessage.restore) sentry.captureMessage.restore();
  });
});
