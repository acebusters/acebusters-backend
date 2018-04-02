import chai, { expect } from 'chai';
import sinonChai from 'sinon-chai';
import sinon from 'sinon';

import ScanManager from './src/scanner';
import Db from './src/db';
import Table from './src/tableContract';
import Factory from './src/factoryContract';

chai.use(sinonChai);

const sdb = {
  getAttributes() {},
  putAttributes() {},
};

const sns = {
  publish() {},
};

const filter = {
  get() {},
  stopWatching() {},
};

const contract = {
  allEvents() {},
  getTables: { call() {} },
};

const web3 = { eth: {
  contract() {},
  getBlockNumber() {},
  at() {},
} };

const set = {
  id: 'tables',
  lastBlock: 2087575,
  addresses: ['0x4C4A59e59172A8369562a3901737d57c84fC9A3C', '0x37a9679c41e99dB270Bda88DE8FF50c0Cd23f326'],
  topicArn: 'arn:aws:sns:eu-west-1:123:ab-events',
};

const event1 = {
  address: '0x111111',
  args: {
    from: '0x6b569b17c684db05cdef8ab738b4be700138f70a',
    to: '0xc2a695393b52facb207918424733a5a1b1e80a50',
    value: 1000000,
  },
  event: 'Transfer',
  transactionHash: '0x1234',
};
const event2 = {
  address: '0x111111',
  args: {
    value: 1000000,
  },
  event: 'Issue',
  transactionHash: '0x2222',
};

const event3 = {
  address: '0x222222',
  args: {
    value: 1000000,
  },
  event: 'Join',
  transactionHash: '0x3333',
};

sinon.stub(web3.eth, 'contract').returns(web3.eth);
sinon.stub(web3.eth, 'at').returns(contract);

describe('Contract Event Scanner', () => {
  beforeEach(() => {
    sinon.stub(contract, 'allEvents').returns(filter);
  });

  it('should handle no new blocks', (done) => {
    sinon.stub(sdb, 'getAttributes').yields(null, { Attributes: [
      { Name: 'lastBlock', Value: set.lastBlock.toString() },
      { Name: 'topicArn', Value: set.topicArn },
    ] });
    sinon.stub(contract.getTables, 'call').yields(null, [set.addresses[0]]);
    sinon.stub(sns, 'publish').yields(null, {});
    sinon.stub(web3.eth, 'getBlockNumber').yields(null, set.lastBlock);

    const manager = new ScanManager(new Db(sdb), new Table(web3), sns, new Factory(web3, '0x999999'));

    manager.scan(set.id).then((data) => {
      expect(sns.publish).callCount(0);
      expect(data.status).to.contain('no new blocks');
      done();
    }).catch(done);
  });

  it('should handle empty contract set', (done) => {
    sinon.stub(sdb, 'getAttributes').yields(null, { Attributes: [] });
    sinon.stub(contract.getTables, 'call').yields(null, []);
    sinon.stub(web3.eth, 'getBlockNumber').yields(null, set.lastBlock);

    const manager = new ScanManager(new Db(sdb), new Table(web3), sns, new Factory(web3, '0x999999'));

    manager.scan(set.id).then((data) => {
      expect(web3.eth.getBlockNumber).callCount(0);
      expect(data.status).to.contain('no contracts to scan');
      done();
    }).catch(done);
  });

  it('should handle no event', (done) => {
    const newBlock = set.lastBlock + 10;

    sinon.stub(sdb, 'getAttributes').yields(null, { Attributes: [
      { Name: 'lastBlock', Value: set.lastBlock.toString() },
    ] });
    sinon.stub(contract.getTables, 'call').yields(null, [set.addresses[0]]);
    sinon.stub(sdb, 'putAttributes').yields(null, {});
    sinon.stub(sns, 'publish').yields(null, {});
    sinon.stub(web3.eth, 'getBlockNumber').yields(null, newBlock);
    sinon.stub(filter, 'get').yields(null, []);

    const manager = new ScanManager(new Db(sdb), new Table(web3), sns, new Factory(web3, '0x999999'));

    manager.scan(set.id).then(() => {
      expect(contract.allEvents).calledWith({
        fromBlock: set.lastBlock,
        toBlock: newBlock,
      });
      expect(sns.publish).callCount(0);
      expect(sdb.putAttributes).calledWith({
        Attributes: [{ Name: 'lastBlock', Replace: true, Value: newBlock.toString() }],
        DomainName: sinon.match.any,
        ItemName: set.id,
      });
      done();
    }).catch(done);
  });

  it('should handle single event', (done) => {
    const newBlock = set.lastBlock + 10;

    sinon.stub(sdb, 'getAttributes').yields(null, { Attributes: [
      { Name: 'lastBlock', Value: set.lastBlock.toString() },
      { Name: 'topicArn', Value: set.topicArn },
    ] });
    sinon.stub(contract.getTables, 'call').yields(null, [set.addresses[0]]);
    sinon.stub(sdb, 'putAttributes').yields(null, {});
    sinon.stub(sns, 'publish').yields(null, {});
    sinon.stub(web3.eth, 'getBlockNumber').yields(null, newBlock);
    sinon.stub(filter, 'get').yields(null, []).onFirstCall().yields(null, [event1]);

    const manager = new ScanManager(new Db(sdb), new Table(web3),
      sns, new Factory(web3, '0x999999'), set.topicArn);

    manager.scan(set.id).then(() => {
      expect(contract.allEvents).calledWith({
        fromBlock: set.lastBlock,
        toBlock: newBlock,
      });
      expect(sns.publish).calledWith({
        Message: JSON.stringify(event1),
        Subject: `ContractEvent::${event1.address}`,
        TopicArn: set.topicArn,
      });
      expect(sdb.putAttributes).calledWith({
        Attributes: [{ Name: 'lastBlock', Replace: true, Value: newBlock.toString() }],
        DomainName: sinon.match.any,
        ItemName: set.id,
      });
      done();
    }).catch(done);
  });

  it('should handle multiple events', (done) => {
    const newBlock = set.lastBlock + 10;

    sinon.stub(sdb, 'getAttributes').yields(null, { Attributes: [
      { Name: 'lastBlock', Value: set.lastBlock.toString() },
      { Name: 'topicArn', Value: set.topicArn },
    ] });
    sinon.stub(contract.getTables, 'call').yields(null, [set.addresses[0]]);
    sinon.stub(sdb, 'putAttributes').yields(null, {});
    sinon.stub(sns, 'publish').yields(null, {});
    sinon.stub(web3.eth, 'getBlockNumber').yields(null, newBlock);
    sinon.stub(filter, 'get').yields(null, []).onFirstCall().yields(null, [event1, event2]);

    const manager = new ScanManager(new Db(sdb), new Table(web3),
      sns, new Factory(web3, '0x999999'), set.topicArn);

    manager.scan(set.id).then(() => {
      expect(contract.allEvents).calledWith({
        fromBlock: set.lastBlock,
        toBlock: newBlock,
      });
      expect(sns.publish).calledWith({
        Message: JSON.stringify(event1),
        Subject: `ContractEvent::${event1.address}`,
        TopicArn: set.topicArn,
      });
      expect(sns.publish).calledWith({
        Message: JSON.stringify(event2),
        Subject: `ContractEvent::${event2.address}`,
        TopicArn: set.topicArn,
      });
      expect(sdb.putAttributes).calledWith({
        Attributes: [{ Name: 'lastBlock', Replace: true, Value: newBlock.toString() }],
        DomainName: sinon.match.any,
        ItemName: set.id,
      });
      done();
    }).catch(done);
  });

  it('should handle events in multiple contracts', (done) => {
    const newBlock = set.lastBlock + 10;

    sinon.stub(sdb, 'getAttributes').yields(null, { Attributes: [
      { Name: 'lastBlock', Value: set.lastBlock.toString() },
      { Name: 'topicArn', Value: set.topicArn },
    ] });
    sinon.stub(contract.getTables, 'call').yields(null, [set.addresses[0], set.addresses[1]]);
    sinon.stub(sdb, 'putAttributes').yields(null, {});
    sinon.stub(sns, 'publish').yields(null, {});
    sinon.stub(web3.eth, 'getBlockNumber').yields(null, newBlock);
    sinon.stub(filter, 'get').yields(null, [event3]).onFirstCall().yields(null, [event1, event2]);

    const manager = new ScanManager(new Db(sdb), new Table(web3),
      sns, new Factory(web3, '0x999999'), set.topicArn);

    manager.scan(set.id).then(() => {
      expect(contract.allEvents).calledWith({
        fromBlock: set.lastBlock,
        toBlock: newBlock,
      });
      expect(contract.allEvents).calledWith({
        fromBlock: set.lastBlock,
        toBlock: newBlock,
      });
      expect(sns.publish).calledWith({
        Message: JSON.stringify(event1),
        Subject: `ContractEvent::${event1.address}`,
        TopicArn: set.topicArn,
      });
      expect(sns.publish).calledWith({
        Message: JSON.stringify(event2),
        Subject: `ContractEvent::${event2.address}`,
        TopicArn: set.topicArn,
      });
      expect(sns.publish).calledWith({
        Message: JSON.stringify(event3),
        Subject: `ContractEvent::${event3.address}`,
        TopicArn: set.topicArn,
      });
      expect(sdb.putAttributes).calledWith({
        Attributes: [{ Name: 'lastBlock', Replace: true, Value: newBlock.toString() }],
        DomainName: sinon.match.any,
        ItemName: set.id,
      });
      done();
    }).catch(done);
  });

  afterEach(() => {
    if (sdb.getAttributes.restore) sdb.getAttributes.restore();
    if (sdb.putAttributes.restore) sdb.putAttributes.restore();
    if (sns.publish.restore) sns.publish.restore();
    if (contract.allEvents.restore) contract.allEvents.restore();
    if (filter.get.restore) filter.get.restore();
    if (contract.getTables.call.restore) contract.getTables.call.restore();
    if (web3.eth.getBlockNumber.restore) web3.eth.getBlockNumber.restore();
  });
});
