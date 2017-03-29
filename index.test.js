const expect = require('chai').expect;
const sinon = require('sinon');
require('chai').use(require('sinon-chai'));
const BigNumber = require('bignumber.js');

const ScanManager = require('./lib/scanner');
const Sdb = require('./lib/sdb.js');
const Dynamo = require('./lib/dynamo.js');
const Contract = require('./lib/tableContract.js');

const P1_ADDR = '0xf3beac30c498d9e26865f34fcaa57dbb935b0d74';
const P2_ADDR = '0xe10f3d125e5f4c753a6456fc37123cf17c6900f2';
const EMPTY_ADDR = '0x0000000000000000000000000000000000000000';


var sdb = {
  getAttributes: function(){},
};

var dynamo = {
  query: function(){}
};

var dynamo = {
  query: function(){},
};

const sns = {
  publish: function(){}
};

const contract = {
  lastHandNetted: { call: function(){} },
  lastNettingRequestHandId: { call: function(){} },
  lastNettingRequestTime: { call: function(){} },
}

const web3 = { eth: {
  contract: function(){},
  at: function(){}
}};

const set = {
  id: 'tables',
  addresses: ['0x4C4A59e59172A8369562a3901737d57c84fC9A3C', '0x37a9679c41e99dB270Bda88DE8FF50c0Cd23f326'],
  topicArn: 'arn:aws:sns:eu-west-1:123:ab-events'
}

sinon.stub(web3.eth, 'contract').returns(web3.eth);
sinon.stub(web3.eth, 'at').returns(contract);

describe('Interval Scanner', function() {

  it('should do nothing with fresh netting request', function(done) {
    const now = Math.floor(Date.now() / 1000);
    sinon.stub(sdb, 'getAttributes').yields(null, {Attributes: [
      { Name: 'addresses', Value: set.addresses[0]},
      { Name: 'topicArn', Value: set.topicArn}
    ]});
    sinon.stub(sns, 'publish').yields(null, {});
    sinon.stub(contract.lastHandNetted, 'call').yields(null, new BigNumber(5));
    sinon.stub(contract.lastNettingRequestHandId, 'call').yields(null, new BigNumber(10));
    sinon.stub(contract.lastNettingRequestTime, 'call').yields(null, new BigNumber(now));

    var manager = new ScanManager(new Sdb(sdb), null, new Contract(web3), sns);

    manager.scan(set.id).then(function(rsp) {
      expect(rsp.length).to.eql(1);
      expect(rsp[0]).to.contain('nothing');
      done();
    }).catch(done);
  });

  it('should handle multiple contracts', function(done) {
    const now = Math.floor(Date.now() / 1000);
    sinon.stub(sdb, 'getAttributes').yields(null, {Attributes: [
      { Name: 'addresses', Value: set.addresses[0]},
      { Name: 'addresses', Value: set.addresses[1]},
      { Name: 'topicArn', Value: set.topicArn}
    ]});
    sinon.stub(sns, 'publish').yields(null, {});
    sinon.stub(contract.lastHandNetted, 'call').yields(null, new BigNumber(5));
    sinon.stub(contract.lastNettingRequestHandId, 'call').yields(null, new BigNumber(10));
    sinon.stub(contract.lastNettingRequestTime, 'call').yields(null, new BigNumber(now));

    var manager = new ScanManager(new Sdb(sdb), null, new Contract(web3), sns);

    manager.scan(set.id).then(function(rsp) {
      expect(rsp.length).to.eql(2);
      expect(rsp[0]).to.contain('nothing');
      expect(rsp[1]).to.contain('nothing');
      done();
    }).catch(done);
  });

  it('should react to mature netting requests', function(done) {
    const now = Math.floor(Date.now() / 1000) - 181;
    sinon.stub(sdb, 'getAttributes').yields(null, {Attributes: [
      { Name: 'addresses', Value: set.addresses[0]},
      { Name: 'topicArn', Value: set.topicArn}
    ]});
    sinon.stub(sns, 'publish').yields(null, {});
    sinon.stub(contract.lastHandNetted, 'call').yields(null, new BigNumber(5));
    sinon.stub(contract.lastNettingRequestHandId, 'call').yields(null, new BigNumber(10));
    sinon.stub(contract.lastNettingRequestTime, 'call').yields(null, new BigNumber(now));

    var manager = new ScanManager(new Sdb(sdb), null, new Contract(web3), sns);

    manager.scan(set.id).then(function(rsp) {
      expect(rsp.length).to.eql(1);
      expect(rsp[0]).to.contain('HandleDispute');
      done();
    }).catch(done);
  });

  it('should call net on contract if submission period over', function(done) {
    const now = Math.floor(Date.now() / 1000) - 601;
    sinon.stub(sdb, 'getAttributes').yields(null, {Attributes: [
      { Name: 'addresses', Value: set.addresses[0]},
      { Name: 'topicArn', Value: set.topicArn}
    ]});
    sinon.stub(sns, 'publish').yields(null, {});
    sinon.stub(contract.lastHandNetted, 'call').yields(null, new BigNumber(5));
    sinon.stub(contract.lastNettingRequestHandId, 'call').yields(null, new BigNumber(10));
    sinon.stub(contract.lastNettingRequestTime, 'call').yields(null, new BigNumber(now));

    var manager = new ScanManager(new Sdb(sdb), null, new Contract(web3), sns);

    manager.scan(set.id).then(function(rsp) {
      expect(rsp.length).to.eql(1);
      expect(rsp[0]).to.contain('ProgressNetting::');
      done();
    }).catch(done);
  });

  it('should initiate new netting requests', function(done) {
    sinon.stub(sdb, 'getAttributes').yields(null, {Attributes: [
      { Name: 'addresses', Value: set.addresses[0]},
      { Name: 'topicArn', Value: set.topicArn}
    ]});
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 8,
    }]});
    sinon.stub(sns, 'publish').yields(null, {});
    sinon.stub(contract.lastHandNetted, 'call').yields(null, new BigNumber(5));
    sinon.stub(contract.lastNettingRequestHandId, 'call').yields(null, new BigNumber(5));
    sinon.stub(contract.lastNettingRequestTime, 'call').yields(null, new BigNumber(0));

    var manager = new ScanManager(new Sdb(sdb), new Dynamo(dynamo), new Contract(web3), sns);

    manager.scan(set.id).then(function(rsp) {
      expect(rsp[0].length).to.eql(1);
      expect(rsp[0][0]).to.contain('ProgressNettingRequest');
      done();
    }).catch(done);
  });

  it('should kick a player', function(done) {
    const now = Date.now() - (1000 * 60 * 10) // 10 minutes ago
    sinon.stub(sdb, 'getAttributes').yields(null, {Attributes: [
      { Name: 'addresses', Value: set.addresses[0]},
      { Name: 'topicArn', Value: set.topicArn}
    ]});
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 8,
      lineup: [{
        address: P1_ADDR
      }, {
        address: P2_ADDR,
        sitout: now
      }],
    }]});
    sinon.stub(sns, 'publish').yields(null, {});
    sinon.stub(contract.lastHandNetted, 'call').yields(null, new BigNumber(5));
    sinon.stub(contract.lastNettingRequestHandId, 'call').yields(null, new BigNumber(5));
    sinon.stub(contract.lastNettingRequestTime, 'call').yields(null, new BigNumber(0));

    var manager = new ScanManager(new Sdb(sdb), new Dynamo(dynamo), new Contract(web3), sns);

    manager.scan(set.id).then(function(rsp) {
      expect(rsp[0].length).to.eql(2);
      expect(rsp[0][1]).to.contain('ProgressNettingRequest');
      expect(rsp[0][0]).to.contain('Kick');
      done();
    }).catch(done);
  });

  afterEach(function () {
    if (sdb.getAttributes.restore) sdb.getAttributes.restore();
    if (sns.publish.restore) sns.publish.restore();
    if (contract.lastHandNetted.call.restore) contract.lastHandNetted.call.restore();
    if (contract.lastNettingRequestHandId.call.restore) contract.lastNettingRequestHandId.call.restore();
    if (contract.lastNettingRequestTime.call.restore) contract.lastNettingRequestTime.call.restore();
    if (dynamo.query.restore) dynamo.query.restore();
  });

});