const expect = require('chai').expect;
const sinon = require('sinon');
require('chai').use(require('sinon-chai'));

const ScanManager = require('./lib/scanner');
const Db = require('./lib/db.js');
const Contract = require('./lib/contract.js');

var sdb = {
  getAttributes: function(){},
  putAttributes: function(){}
};

const sns = {
  publish: function(){}
};

const filter = {
  get: function(){},
  stopWatching: function(){}
};

const contract = {
  allEvents: function(){}
}

const web3 = { eth: {
  contract: function(){},
  getBlockNumber: function(){},
  at: function(){}
}};

const set = {
  id: 'tables',
  addresses: ['0x4C4A59e59172A8369562a3901737d57c84fC9A3C', '0x37a9679c41e99dB270Bda88DE8FF50c0Cd23f326'],
  lastBlock: 2087575,
  contractAbi: '[{ "inputs": [{ "name": "addr", "type": "address" }, { "name": "amount", "type": "uint256" }], "name": "Join", "type": "event" }, { "inputs": [{ "name": "hand", "type": "uint256" }], "name": "NettingRequest", "type": "event" }, { "inputs": [{ "name": "hand", "type": "uint256" }], "name": "Netted", "type": "event" }, { "inputs": [{ "name": "errorCode", "type": "uint256" }], "name": "Error", "type": "event" }]',
  topicArn: 'arn:aws:sns:eu-west-1:123:ab-events'
}

const event1 = {
  address: '0x111111',
  args : {
    from: '0x6b569b17c684db05cdef8ab738b4be700138f70a',
    to: '0xc2a695393b52facb207918424733a5a1b1e80a50',
    value: 1000000
  },
  event: 'Transfer',
  transactionHash: '0x1234'
}
const event2 = {
  address: '0x111111',
  args : {
    value: 1000000
  },
  event: 'Issue',
  transactionHash: '0x2222'
}

const event3 = {
  address: '0x222222',
  args : {
    value: 1000000
  },
  event: 'Join',
  transactionHash: '0x3333'
}

sinon.stub(web3.eth, 'contract').returns(web3.eth);
sinon.stub(web3.eth, 'at').returns(contract);

describe('Contract Event Scanner', function() {

  beforeEach(function () {
    sinon.stub(contract, 'allEvents').returns(filter);
  });

  it('should handle no new blocks', function(done) {
    sinon.stub(sdb, 'getAttributes').yields(null, {Attributes: [
      { Name: 'addresses', Value: set.addresses[0]},
      { Name: 'lastBlock', Value: set.lastBlock.toString()},
      { Name: 'contractAbi', Value: set.contractAbi},
      { Name: 'topicArn', Value: set.topicArn}
    ]});
    sinon.stub(sns, 'publish').yields(null, {});
    sinon.stub(web3.eth, 'getBlockNumber').yields(null, set.lastBlock);

    var manager = new ScanManager(new Db(sdb), new Contract(web3), sns);

    manager.scan(set.id).then(function(data) {
      expect(sns.publish).callCount(0);
      expect(data.status).to.contain('no new blocks');
      done();
    }).catch(done);
  });

  it('should handle empty contract set', function(done) {
    sinon.stub(sdb, 'getAttributes').yields(null, {Attributes: []});
    sinon.stub(web3.eth, 'getBlockNumber').yields(null, set.lastBlock);

    var manager = new ScanManager(new Db(sdb), new Contract(web3), sns);

    manager.scan(set.id).then(function(data) {
      expect(web3.eth.getBlockNumber).callCount(0);
      expect(data.status).to.contain('no contracts to scan');
      done();
    }).catch(done);
  });

  it('should handle no event', function(done) {
    var newBlock = set.lastBlock + 10;

    sinon.stub(sdb, 'getAttributes').yields(null, {Attributes: [
      { Name: 'addresses', Value: set.addresses[0]},
      { Name: 'contractAbi', Value: set.contractAbi},
      { Name: 'lastBlock', Value: set.lastBlock.toString()}
    ]});
    sinon.stub(sdb, 'putAttributes').yields(null,{});
    sinon.stub(sns, 'publish').yields(null, {});
    sinon.stub(web3.eth, 'getBlockNumber').yields(null, newBlock);
    sinon.stub(filter, 'get').yields(null, []);

    var manager = new ScanManager(new Db(sdb), new Contract(web3), sns);

    manager.scan(set.id).then(function(data){
      expect(contract.allEvents).calledWith({
        fromBlock: set.lastBlock,
        toBlock: newBlock
      });
      expect(sns.publish).callCount(0);
      expect(sdb.putAttributes).calledWith({
        Attributes: [{ Name: 'lastBlock', Replace: true, Value: newBlock.toString() }],
        DomainName: sinon.match.any,
        ItemName: set.id
      });
      done();
    }).catch(done);
  });

  it('should handle single event', function(done) {
    var newBlock = set.lastBlock + 10;

    sinon.stub(sdb, 'getAttributes').yields(null, {Attributes: [
      { Name: 'addresses', Value: set.addresses[0]},
      { Name: 'addresses', Value: set.addresses[1]},
      { Name: 'contractAbi', Value: set.contractAbi},
      { Name: 'lastBlock', Value: set.lastBlock.toString()},
      { Name: 'topicArn', Value: set.topicArn}
    ]});
    sinon.stub(sdb, 'putAttributes').yields(null,{});
    sinon.stub(sns, 'publish').yields(null, {});
    sinon.stub(web3.eth, 'getBlockNumber').yields(null, newBlock);
    sinon.stub(filter, 'get').yields(null, []).onFirstCall().yields(null, [event1]);

    var manager = new ScanManager(new Db(sdb), new Contract(web3), sns);

    manager.scan(set.id).then(function(data){
      expect(contract.allEvents).calledWith({
        fromBlock: set.lastBlock,
        toBlock: newBlock
      });
      expect(sns.publish).calledWith({
        Message: JSON.stringify(event1),
        Subject: 'ContractEvent::' + event1.address,
        TopicArn: set.topicArn
      });
      expect(sdb.putAttributes).calledWith({
        Attributes: [{ Name: 'lastBlock', Replace: true, Value: newBlock.toString() }],
        DomainName: sinon.match.any,
        ItemName: set.id
      });
      done();
    }).catch(done);
  });

  it('should handle multiple events', function(done) {
    var newBlock = set.lastBlock + 10;

    sinon.stub(sdb, 'getAttributes').yields(null, {Attributes: [
      { Name: 'addresses', Value: set.addresses[0]},
      { Name: 'addresses', Value: set.addresses[1]},
      { Name: 'contractAbi', Value: set.contractAbi},
      { Name: 'lastBlock', Value: set.lastBlock.toString()},
      { Name: 'topicArn', Value: set.topicArn}
    ]});
    sinon.stub(sdb, 'putAttributes').yields(null,{});
    sinon.stub(sns, 'publish').yields(null, {});
    sinon.stub(web3.eth, 'getBlockNumber').yields(null, newBlock);
    sinon.stub(filter, 'get').yields(null, []).onFirstCall().yields(null, [event1, event2]);

    var manager = new ScanManager(new Db(sdb), new Contract(web3), sns);

    manager.scan(set.id).then(function(data){
      expect(contract.allEvents).calledWith({
        fromBlock: set.lastBlock,
        toBlock: newBlock
      });
      expect(sns.publish).calledWith({
        Message: JSON.stringify(event1),
        Subject: 'ContractEvent::' + event1.address,
        TopicArn: set.topicArn
      });
      expect(sns.publish).calledWith({
        Message: JSON.stringify(event2),
        Subject: 'ContractEvent::' + event2.address,
        TopicArn: set.topicArn
      });
      expect(sdb.putAttributes).calledWith({
        Attributes: [{ Name: 'lastBlock', Replace: true, Value: newBlock.toString() }],
        DomainName: sinon.match.any,
        ItemName: set.id
      });
      done();
    }).catch(done);
  });

  it('should handle events in multiple contracts', function(done) {
    var newBlock = set.lastBlock + 10;

    sinon.stub(sdb, 'getAttributes').yields(null, {Attributes: [
      { Name: 'addresses', Value: set.addresses[0]},
      { Name: 'addresses', Value: set.addresses[1]},
      { Name: 'contractAbi', Value: set.contractAbi},
      { Name: 'lastBlock', Value: set.lastBlock.toString()},
      { Name: 'topicArn', Value: set.topicArn}
    ]});
    sinon.stub(sdb, 'putAttributes').yields(null,{});
    sinon.stub(sns, 'publish').yields(null, {});
    sinon.stub(web3.eth, 'getBlockNumber').yields(null, newBlock);
    sinon.stub(filter, 'get').yields(null, [event3]).onFirstCall().yields(null, [event1, event2]);

    var manager = new ScanManager(new Db(sdb), new Contract(web3), sns);

    manager.scan(set.id).then(function(data){
      expect(contract.allEvents).calledWith({
        fromBlock: set.lastBlock,
        toBlock: newBlock
      });
      expect(contract.allEvents).calledWith({
        fromBlock: set.lastBlock,
        toBlock: newBlock
      });
      expect(sns.publish).calledWith({
        Message: JSON.stringify(event1),
        Subject: 'ContractEvent::' + event1.address,
        TopicArn: set.topicArn
      });
      expect(sns.publish).calledWith({
        Message: JSON.stringify(event2),
        Subject: 'ContractEvent::' + event2.address,
        TopicArn: set.topicArn
      });
      expect(sns.publish).calledWith({
        Message: JSON.stringify(event3),
        Subject: 'ContractEvent::' + event3.address,
        TopicArn: set.topicArn
      });
      expect(sdb.putAttributes).calledWith({
        Attributes: [{ Name: 'lastBlock', Replace: true, Value: newBlock.toString() }],
        DomainName: sinon.match.any,
        ItemName: set.id
      });
      done();
    }).catch(done);
  });

  afterEach(function () {
    if (sdb.getAttributes.restore) sdb.getAttributes.restore();
    if (sdb.putAttributes.restore) sdb.putAttributes.restore();
    if (sns.publish.restore) sns.publish.restore();
    if (contract.allEvents.restore) contract.allEvents.restore();
    if (filter.get.restore) filter.get.restore();
    if (web3.eth.getBlockNumber.restore) web3.eth.getBlockNumber.restore();
  });

});