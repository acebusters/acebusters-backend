import chai, { expect } from 'chai';
import sinonChai from 'sinon-chai';
import sinon from 'sinon';
import EWT from 'ethereum-web-token';
import { Receipt } from 'poker-helper';
import { it, describe, afterEach } from 'mocha';
import BigNumber from 'bignumber.js';

import EventWorker from './src/index';
import Table from './src/tableContract';
import Controller from './src/controllerContract';
import Factory from './src/factoryContract';
import Db from './src/db';

chai.use(sinonChai);

const ABI_BET = [{ name: 'bet', type: 'function', inputs: [{ type: 'uint' }, { type: 'uint' }] }];
const ABI_FOLD = [{ name: 'fold', type: 'function', inputs: [{ type: 'uint' }, { type: 'uint' }] }];
const ABI_SHOW = [{ name: 'show', type: 'function', inputs: [{ type: 'uint' }, { type: 'uint' }] }];
const ABI_DIST = [{ name: 'distribution', type: 'function', inputs: [{ type: 'uint' }, { type: 'uint' }, { type: 'bytes32[]' }] }];
const ABI_SIT_OUT = [{ name: 'sitOut', type: 'function', inputs: [{ type: 'uint' }, { type: 'uint' }] }];

const P1_ADDR = '0xf3beac30c498d9e26865f34fcaa57dbb935b0d74';
const P1_PRIV = '0x278a5de700e29faae8e40e366ec5012b5ec63d36ec77e8a2417154cc1d25383f';

// secretSeed: 'brother mad churn often amount wing pretty critic rhythm man insane ridge' }
const P2_ADDR = '0xe10f3d125e5f4c753a6456fc37123cf17c6900f2';
const P2_PRIV = '0x7bc8feb5e1ce2927480de19d8bc1dc6874678c016ae53a2eec6a6e9df717bfac';

// secretSeed: 'erosion warm student north injury good evoke river despair critic wrestle unveil' }
const P3_ADDR = '0xc3ccb3902a164b83663947aff0284c6624f3fbf2';
const P3_PRIV = '0x71d2b12dad610fc929e0596b6e887dfb711eec286b7b8b0bdd742c0421a9c425';

const P4_ADDR = '0x82e8c6cf42c8d1ff9594b17a3f50e94a12cc860f';
const P4_PRIV = '0x94890218f2b0d04296f30aeafd13655eba4c5bbf1770273276fee52cbe3f2cb4';

// secretSeed: 'erode melody nature bounce sample deny spend give craft alcohol supply roof' }
const ORACLE_ADDR = '0x82e8c6cf42c8d1ff9594b17a3f50e94a12cc860f';
const ORACLE_PRIV = '0x94890218f2b0d04296f30aeafd13655eba4c5bbf1770273276fee52cbe3f2cb4';

const EMPTY_ADDR = '0x0000000000000000000000000000000000000000';

const deck = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
  10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25];

const contract = {
  leave: {
    sendTransaction() {},
  },
  settle: {
    sendTransaction() {},
  },
  payoutFrom: {
    sendTransaction() {},
  },
  net: {
    sendTransaction() {},
  },
  submitBets: {
    sendTransaction() {},
  },
  submitDists: {
    sendTransaction() {},
  },
  create: {
    sendTransaction() {},
  },
  changeSigner: {
    sendTransaction() {},
  },
  getLineup: {
    call() {},
  },
  getAccount: {
    call() {},
  },
  smallBlind: {
    call() {},
  },
};

const sentry = {
  captureMessage() {
  },
  captureException() {
  },
};

const web3 = { eth: {
  contract() {},
  at() {},
} };

const dynamo = {
  getItem() {},
  putItem() {},
  query() {},
  updateItem() {},
  deleteItem() {},
};

sinon.stub(web3.eth, 'contract').returns(web3.eth);
sinon.stub(web3.eth, 'at').returns(contract);

describe('Stream worker HandComplete event', () => {
  it('should handle HandComplete event.', (done) => {
    const tableAddr = '0xa2decf075b96c8e5858279b31f644501a140e8a7';
    const event = {
      Subject: `HandComplete::${tableAddr}`,
    };
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(1),
      /* addresses:  */[EMPTY_ADDR, P1_ADDR, P2_ADDR],
      /* balances:   */[new BigNumber(0), new BigNumber(50000), new BigNumber(50000)],
      /* exitHands:  */[new BigNumber(0), new BigNumber(0), new BigNumber(0)],
    ]);
    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 2,
      dealer: 0,
      state: 'preflop',
      lineup: [{
        address: EMPTY_ADDR,
      }, {
        address: P1_ADDR,
        last: new EWT(ABI_FOLD).fold(2, 500).sign(P1_PRIV),
      }, {
        address: P2_ADDR,
        last: new EWT(ABI_BET).bet(2, 1000).sign(P2_PRIV),
      }],
      deck,
    }] });
    sinon.stub(dynamo, 'updateItem').yields(null, {});
    sinon.stub(dynamo, 'putItem').yields(null, {});
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const worker = new EventWorker(new Table(web3, '0x1255'), null, new Db(dynamo), ORACLE_PRIV, sentry);
    Promise.all(worker.process(event)).then(() => {
      expect(dynamo.putItem).calledWith({ Item: {
        tableAddr,
        handId: 3,
        deck: sinon.match.any,
        state: 'waiting',
        dealer: 1,
        sb: 50,
        lineup: [{ address: EMPTY_ADDR }, { address: P1_ADDR }, { address: P2_ADDR }],
        changed: sinon.match.any,
      },
        TableName: 'poker' });
      const distHand2 = new EWT(ABI_DIST).distribution(2, 0, [
        EWT.concat(P2_ADDR, 1485).toString('hex'),
        EWT.concat(ORACLE_ADDR, 15).toString('hex'),
      ]).sign(ORACLE_PRIV);
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':d', distHand2)));
      expect(sentry.captureMessage).calledWith(`HandComplete: ${tableAddr}`, sinon.match.any);
      expect(sentry.captureMessage).calledWith(`NewHand: ${tableAddr}`, {
        extra: sinon.match.any,
        level: 'info',
        tags: { handId: 3, tableAddr },
      });
      done();
    }).catch(done);
  });

  it('should handle HandComplete event with empty seats.', (done) => {
    const event = {
      Subject: 'HandComplete::0xa2decf075b96c8e5858279b31f644501a140e8a7',
    };
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(1),
      [P1_ADDR, P2_ADDR, P3_ADDR, P4_ADDR, EMPTY_ADDR],
      [new BigNumber(3000), new BigNumber(3000),
        new BigNumber(3000), new BigNumber(3000), new BigNumber(0)],
      [new BigNumber(0), new BigNumber(0), new BigNumber(0), new BigNumber(0), new BigNumber(0)],
    ]);
    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 2,
      dealer: 3,
      state: 'showdown',
      lineup: [{
        address: P1_ADDR,
        last: new EWT(ABI_FOLD).fold(2, 350).sign(P1_PRIV),
      }, {
        address: P2_ADDR,
        last: new EWT(ABI_BET).bet(2, 850).sign(P2_PRIV),
      }, {
        address: P3_ADDR,
        last: new EWT(ABI_SHOW).show(2, 850).sign(P3_PRIV),
        cards: [9, 23],
      }, {
        address: P4_ADDR,
        last: new EWT(ABI_FOLD).fold(2, 350).sign(P4_PRIV),
      }, {
        address: EMPTY_ADDR,
      }],
      deck: [35, 21, 13, 1, 9, 23, 25, 15,
        44, 43, 39, 22, 34, 24, 10, 4, 38, 18, 11, 2, 31, 51, 49, 50, 41, 28],
    }] });
    sinon.stub(dynamo, 'updateItem').yields(null, {});
    sinon.stub(dynamo, 'putItem').yields(null, {});
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const worker = new EventWorker(new Table(web3, '0x1255'), null, new Db(dynamo), ORACLE_PRIV, sentry);
    Promise.all(worker.process(event)).then(() => {
      expect(dynamo.putItem).calledWith({ Item: {
        tableAddr: '0xa2decf075b96c8e5858279b31f644501a140e8a7',
        handId: 3,
        deck: sinon.match.any,
        state: 'waiting',
        dealer: 0,
        sb: 50,
        lineup: [{
          address: P1_ADDR,
        }, {
          address: P2_ADDR,
        }, {
          address: P3_ADDR,
        }, {
          address: P4_ADDR,
        }, {
          address: EMPTY_ADDR,
        }],
        changed: sinon.match.any,
      },
        TableName: 'poker' });
      const distHand2 = new EWT(ABI_DIST).distribution(2, 0, [
        EWT.concat(P3_ADDR, 2376).toString('hex'),
        EWT.concat(ORACLE_ADDR, 24).toString('hex'),
      ]).sign(ORACLE_PRIV);
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':d', distHand2)));
      done();
    }).catch(done);
  });

  it('should create pre-showdown distribution.', (done) => {
    const tableAddr = '0xa2decf075b96c8e5858279b31f644501a140e8a7';
    const event = {
      Subject: `HandComplete::${tableAddr}`,
      Message: JSON.stringify({ tableAddr, handId: 2 }),
    };
    sinon.stub(contract.getLineup, 'call').yields(null, [
      new BigNumber(1),
      [P1_ADDR, P2_ADDR],
      [new BigNumber(500), new BigNumber(500)],
      [new BigNumber(0), new BigNumber(0)],
    ]);
    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 2,
      lineup: [{
        address: P1_ADDR,
        last: new EWT(ABI_FOLD).fold(2, 200).sign(P1_PRIV),
      }, {
        address: P2_ADDR,
        last: new EWT(ABI_BET).bet(2, 500).sign(P2_PRIV),
        sitout: 'allin',
      }],
      state: 'turn',
      deck,
      dealer: 0,
    }] });
    sinon.stub(dynamo, 'updateItem').yields(null, {});
    sinon.stub(dynamo, 'putItem').yields(null, {});
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const worker = new EventWorker(new Table(web3, '0x1255'),
      null, new Db(dynamo), ORACLE_PRIV, sentry);
    Promise.all(worker.process(event)).then(() => {
      const distHand2 = new EWT(ABI_DIST).distribution(2, 0, [
        EWT.concat(P2_ADDR, 693).toString('hex'),
        EWT.concat(ORACLE_ADDR, 7).toString('hex'),
      ]).sign(ORACLE_PRIV);
      expect(dynamo.updateItem).calledWith(
        sinon.match.has('ExpressionAttributeValues', sinon.match.has(':d', distHand2)));
      expect(dynamo.putItem).calledWith({ Item: {
        tableAddr,
        handId: 3,
        deck: sinon.match.any,
        state: 'waiting',
        dealer: 1,
        sb: 50,
        lineup: [{
          address: P1_ADDR,
        }, {
          address: P2_ADDR,
        }],
        changed: sinon.match.any,
      },
        TableName: 'poker' });
      done();
    }).catch(done);
  });

  it('should put broke players into sitout and active players back from sitout.', (done) => {
    const event = {
      Subject: 'HandComplete::0xa2decf075b96c8e5858279b31f644501a140e8a7',
    };
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(2),
      [P1_ADDR, P3_ADDR, P2_ADDR],
      [new BigNumber(50000), new BigNumber(10000), new BigNumber(1000)],
      [new BigNumber(0), new BigNumber(0), new BigNumber(0)],
    ]);
    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 3,
      state: 'showdown',
      lineup: [{
        address: P1_ADDR,
        last: new EWT(ABI_SHOW).show(3, 1000).sign(P1_PRIV),
        cards: [24, 25],
      }, {
        address: P3_ADDR,
        last: new EWT(ABI_SIT_OUT).sitOut(3, 100).sign(P3_PRIV),
      }, {
        address: P2_ADDR,
        last: new EWT(ABI_SHOW).show(3, 1000).sign(P2_PRIV),
        cards: [4, 5],
      }],
      changed: 234,
      deck: [24, 25, 0, 1, 4, 5, 6, 7, 8, 9,
        10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 2, 3],
    }] });
    sinon.stub(dynamo, 'updateItem').yields(null, {});
    sinon.stub(dynamo, 'putItem').yields(null, {});
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const worker = new EventWorker(new Table(web3, '0x1255'), null, new Db(dynamo), ORACLE_PRIV, sentry);
    Promise.all(worker.process(event)).then(() => {
      const distHand3 = new EWT(ABI_DIST).distribution(3, 0, [
        EWT.concat(P1_ADDR, 2079).toString('hex'),
        EWT.concat(ORACLE_ADDR, 21).toString('hex'),
      ]).sign(ORACLE_PRIV);
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':d', distHand3)));
      expect(dynamo.putItem).calledWith({ Item: {
        tableAddr: '0xa2decf075b96c8e5858279b31f644501a140e8a7',
        handId: 4,
        deck: sinon.match.any,
        state: 'waiting',
        dealer: 0,
        sb: 50,
        lineup: [{
          address: P1_ADDR,
        }, {
          address: P3_ADDR,
        }, {
          address: P2_ADDR,
          sitout: 234,
        }],
        changed: sinon.match.any,
      },
        TableName: 'poker' });
      done();
    }).catch(done);
  });

  it('should put leaving player into sitout.', (done) => {
    const event = {
      Subject: 'HandComplete::0xa2decf075b96c8e5858279b31f644501a140e8a7',
    };
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(2),
      [P1_ADDR, P2_ADDR],
      [new BigNumber(50000), new BigNumber(50000)],
      // P1 has exit hand at 3
      [new BigNumber(3), new BigNumber(0)],
    ]);
    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 3,
      state: 'showdown',
      lineup: [{
        address: P1_ADDR,
        last: new EWT(ABI_SHOW).show(3, 1000).sign(P1_PRIV),
        cards: [24, 25],
      }, {
        address: P2_ADDR,
        last: new EWT(ABI_SHOW).show(3, 1000).sign(P2_PRIV),
        cards: [0, 1],
      }],
      changed: 234,
      deck: [24, 25, 0, 1, 4, 5, 6, 7, 8,
        9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 2, 3],
    }] });
    sinon.stub(dynamo, 'updateItem').yields(null, {});
    sinon.stub(dynamo, 'putItem').yields(null, {});
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const worker = new EventWorker(new Table(web3, '0x1255'), null, new Db(dynamo), ORACLE_PRIV, sentry);
    Promise.all(worker.process(event)).then(() => {
      const distHand3 = new EWT(ABI_DIST).distribution(3, 0, [
        EWT.concat(P1_ADDR, 1980).toString('hex'),
        EWT.concat(ORACLE_ADDR, 20).toString('hex'),
      ]).sign(ORACLE_PRIV);
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':d', distHand3)));
      expect(dynamo.putItem).calledWith({ Item: {
        tableAddr: '0xa2decf075b96c8e5858279b31f644501a140e8a7',
        handId: 4,
        deck: sinon.match.any,
        state: 'waiting',
        dealer: 1,
        sb: 50,
        lineup: [{
          address: P1_ADDR,
          sitout: 1,
          exitHand: 3,
        }, {
          address: P2_ADDR,
        }],
        changed: sinon.match.any,
      },
        TableName: 'poker' });
      done();
    }).catch(done);
  });

  it('should handle exitHand flag.', (done) => {
    const event = {
      Subject: 'HandComplete::0xa2decf075b96c8e5858279b31f644501a140e8a7',
    };
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(2),
      [P1_ADDR, P2_ADDR],
      [new BigNumber(50000), new BigNumber(50000)],
      // P1 will exit at hand 3, but the tx is not mined yet
      [new BigNumber(0), new BigNumber(0)],
    ]);
    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 3,
      state: 'showdown',
      lineup: [{
        address: P1_ADDR,
        last: new EWT(ABI_SHOW).show(3, 1000).sign(P1_PRIV),
        cards: [24, 25],
        exitHand: 3,
      }, {
        address: P2_ADDR,
        last: new EWT(ABI_SHOW).show(3, 1000).sign(P2_PRIV),
        cards: [0, 1],
      }],
      changed: 234,
      deck: [24, 25, 0, 1, 4, 5, 6, 7, 8,
        9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 2, 3],
    }] });
    sinon.stub(dynamo, 'updateItem').yields(null, {});
    sinon.stub(dynamo, 'putItem').yields(null, {});
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const worker = new EventWorker(new Table(web3, '0x1255'), null, new Db(dynamo), ORACLE_PRIV, sentry);
    Promise.all(worker.process(event)).then(() => {
      const distHand3 = new EWT(ABI_DIST).distribution(3, 0, [
        EWT.concat(P1_ADDR, 1980).toString('hex'),
        EWT.concat(ORACLE_ADDR, 20).toString('hex'),
      ]).sign(ORACLE_PRIV);
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':d', distHand3)));
      expect(dynamo.putItem).calledWith({ Item: {
        tableAddr: '0xa2decf075b96c8e5858279b31f644501a140e8a7',
        handId: 4,
        deck: sinon.match.any,
        state: 'waiting',
        dealer: 1,
        sb: 50,
        lineup: [{
          address: P1_ADDR,
          sitout: 1,
          exitHand: 3,
        }, {
          address: P2_ADDR,
        }],
        changed: sinon.match.any,
      },
        TableName: 'poker' });
      done();
    }).catch(done);
  });

  it('should calc dist for showdown with 2 winners and odd amounts.', (done) => {
    const event = {
      Subject: 'HandComplete::0xa2decf075b96c8e5858279b31f644501a140e8a7',
    };
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(3),
      [P1_ADDR, P2_ADDR],
      [new BigNumber(50000), new BigNumber(1000)],
      [new BigNumber(0), new BigNumber(0)],
    ]);
    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 4,
      state: 'showdown',
      lineup: [{
        address: P1_ADDR,
        last: new EWT(ABI_SHOW).show(4, 1050).sign(P1_PRIV),
        cards: [0, 1],
      }, {
        address: P2_ADDR,
        last: new EWT(ABI_SHOW).show(4, 1050).sign(P2_PRIV),
        cards: [2, 3],
      }],
      deck,
    }] });
    sinon.stub(dynamo, 'updateItem').yields(null, {});
    sinon.stub(dynamo, 'putItem').yields(null, {});
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const worker = new EventWorker(new Table(web3, '0x1255'), null, new Db(dynamo), ORACLE_PRIV, sentry);
    Promise.all(worker.process(event)).then(() => {
      const distHand4 = new EWT(ABI_DIST).distribution(4, 0, [
        EWT.concat(P1_ADDR, 1039).toString('hex'),
        EWT.concat(P2_ADDR, 1039).toString('hex'),
        EWT.concat(ORACLE_ADDR, 22).toString('hex'),
      ]).sign(ORACLE_PRIV);
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':d', distHand4)));
      expect(dynamo.putItem).calledWith(sinon.match.has('Item', sinon.match.has('handId', 5)));
      done();
    }).catch(done);
  });

  it('should put broke players into sitout tracking back multiple hands.', (done) => {
    const event = {
      Subject: 'HandComplete::0xa2decf075b96c8e5858279b31f644501a140e8a7',
      Message: JSON.stringify({
        tableAddr: '0xa2decf075b96c8e5858279b31f644501a140e8a7',
        handId: 3,
      }),
    };
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(2),
      [P1_ADDR, P2_ADDR],
      [new BigNumber(50000), new BigNumber(2075)],
      [new BigNumber(0), new BigNumber(0)],
    ]);
    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(dynamo, 'getItem').yields(null, { Item: {
      handId: 3,
      lineup: [{
        address: P1_ADDR,
        last: new EWT(ABI_BET).bet(3, 500).sign(P1_PRIV),
      }, {
        address: P2_ADDR,
        last: new EWT(ABI_BET).bet(3, 1000).sign(P2_PRIV),
      }],
      distribution: new EWT(ABI_DIST).distribution(3, 0, [EWT.concat(P1_ADDR, 1500).toString('hex')]).sign(ORACLE_PRIV),
    } });
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 4,
      lineup: [{
        address: P1_ADDR,
        last: new EWT(ABI_BET).bet(4, 500).sign(P1_PRIV),
      }, {
        address: P2_ADDR,
        last: new EWT(ABI_BET).bet(4, 1000).sign(P2_PRIV),
      }],
      changed: 123,
      distribution: new EWT(ABI_DIST).distribution(4, 0, [EWT.concat(P1_ADDR, 1500).toString('hex')]).sign(ORACLE_PRIV),
    }] });
    sinon.stub(dynamo, 'putItem').yields(null, {});
    sinon.stub(sentry, 'captureMessage').yields(null, {});
    sinon.stub(sentry, 'captureException').yields(null, {});

    const worker = new EventWorker(new Table(web3, '0x1255'), null, new Db(dynamo), null, sentry);
    Promise.all(worker.process(event)).then(() => {
      expect(dynamo.putItem).calledWith({ Item: {
        tableAddr: '0xa2decf075b96c8e5858279b31f644501a140e8a7',
        handId: 5,
        deck: sinon.match.any,
        state: 'waiting',
        dealer: 0,
        sb: 50,
        lineup: [{
          address: P1_ADDR,
        }, {
          address: P2_ADDR,
          sitout: 123,
        }],
        changed: sinon.match.any,
      },
        TableName: 'poker' });
      done();
    }).catch(done);
  });


  afterEach(() => {
    if (contract.leave.sendTransaction.restore) contract.leave.sendTransaction.restore();
    if (contract.settle.sendTransaction.restore) contract.settle.sendTransaction.restore();
    if (contract.payoutFrom.sendTransaction.restore) contract.payoutFrom.sendTransaction.restore();
    if (contract.net.sendTransaction.restore) contract.net.sendTransaction.restore();
    if (contract.create.sendTransaction.restore) contract.create.sendTransaction.restore();
    if (contract.getLineup.call.restore) contract.getLineup.call.restore();
    if (contract.smallBlind.call.restore) contract.smallBlind.call.restore();
    if (dynamo.getItem.restore) dynamo.getItem.restore();
    if (dynamo.putItem.restore) dynamo.putItem.restore();
    if (dynamo.query.restore) dynamo.query.restore();
    if (dynamo.updateItem.restore) dynamo.updateItem.restore();
    if (sentry.captureMessage.restore) sentry.captureMessage.restore();
    if (sentry.captureException.restore) sentry.captureException.restore();
  });
});

describe('Stream worker other events', () => {
  it('should handle TableLeave event.', (done) => {
    const handId = 2;
    const tableAddr = EMPTY_ADDR;
    const leaveReceipt = new Receipt(tableAddr).leave(handId, P1_ADDR).sign(ORACLE_PRIV);
    const leaveHex = Receipt.parseToParams(leaveReceipt);

    const event = {
      Subject: `TableLeave::${tableAddr}`,
      Message: JSON.stringify({
        tableAddr,
        leaverAddr: P1_ADDR,
        exitHand: handId,
      }),
    };
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(handId - 1),
      [P1_ADDR, P2_ADDR],
      [new BigNumber(50000), new BigNumber(50000)],
      [new BigNumber(0), new BigNumber(0)],
    ]);
    sinon.stub(contract.leave, 'sendTransaction').yields(null, '0x112233');
    sinon.stub(sentry, 'captureMessage').yields(null, 'sentry');

    const worker = new EventWorker(new Table(web3, '0x1255'), null, null, ORACLE_PRIV, sentry);

    Promise.all(worker.process(event)).then(() => {
      expect(contract.leave.sendTransaction).calledWith(...leaveHex, { from: '0x1255', gas: sinon.match.any }, sinon.match.any);
      expect(sentry.captureMessage).calledWith('tx: table.leave()', {
        level: sinon.match.any,
        tags: { tableAddr, handId },
        extra: { leaveReceipt, txHash: '0x112233' },
      });
      done();
    }).catch(done);
  });

  it('should handle ProgressNetting event.', (done) => {
    const tableAddr = EMPTY_ADDR;

    const event = { Subject: `ProgressNetting::${tableAddr}` };
    sinon.stub(contract.net, 'sendTransaction').yields(null, '0x112233');
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const worker = new EventWorker(new Table(web3, '0x1255'), null, null, null, sentry);

    Promise.all(worker.process(event)).then(() => {
      expect(contract.net.sendTransaction).calledWith({ from: '0x1255', gas: sinon.match.any }, sinon.match.any);
      expect(sentry.captureMessage).calledWith('tx: table.net()', {
        level: sinon.match.any,
        tags: { tableAddr },
        extra: { txHash: '0x112233' },
      });
      done();
    }).catch(done);
  });

  it('should handle HandleDispute event.', (done) => {
    const tableAddr = EMPTY_ADDR;
    const event = {
      Subject: `HandleDispute::${tableAddr}`,
      Message: JSON.stringify({
        tableAddr,
        lastHandNetted: 5,
        lastNettingRequest: 6,
      }),
    };
    sinon.stub(dynamo, 'getItem').yields(null, { Item: {
      lineup: [{
        address: P1_ADDR,
        last: new EWT(ABI_BET).bet(6, 500).sign(P1_PRIV),
      }, {
        address: P2_ADDR,
        last: new EWT(ABI_BET).bet(6, 1000).sign(P2_PRIV),
      }],
      distribution: new EWT(ABI_DIST).distribution(6, 0, [EWT.concat(P2_ADDR, 1500).toString('hex')]).sign(ORACLE_PRIV),
    } });
    sinon.stub(contract.submitDists, 'sendTransaction').yields(null, '0x112233');
    sinon.stub(contract.submitBets, 'sendTransaction').yields(null, '0x445566');
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const worker = new EventWorker(new Table(web3, '0x1255'), null, new Db(dynamo), null, sentry);

    Promise.all(worker.process(event)).then((tx) => {
      expect(tx[0]).to.eql(['0x112233', '0x445566']);
      const distHex = '0x3a10de590000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000001e10f3d125e5f4c753a6456fc37123cf17c6900f20000000000000000000005dc';
      const distSig = '0x6d34f174751a6abe871b531647be82c0b39055a451d12d193f9672c7acd474b25f62166d8a1e0999932892c65f303054f483ca44513f6a6333c50b75a9ac404f1c';
      expect(contract.submitDists.sendTransaction).calledWith(distHex, distSig, { from: '0x1255', gas: sinon.match.any }, sinon.match.any);
      const betsHex = '0x6ffcc719000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000001f46ffcc719000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000003e8';
      const betSigs = '0x165d657d180e5e3f31a68791532b0fb5be389e91b88c8b34e4f78c264cf1639214593a897dac8bdf05b3a4324c17fd03520774ff2b1a2f64417683db00ce30281caffe3c1e8c6617b8e82ab789f5f6f2c5330749db275eff8f657f81ce3ac6fcea5b939d5a000107dd46d159f8752c3ba479634f5de7d264a01e86bd3e0c7f0f291b';
      expect(contract.submitBets.sendTransaction).calledWith(betsHex, betSigs, { from: '0x1255', gas: sinon.match.any }, sinon.match.any);
      done();
    }).catch(done);
  });

  it('should handle TableLeave and Payout if netting not needed.', (done) => {
    const handId = 2;
    const tableAddr = EMPTY_ADDR;
    const leaveReceipt = new Receipt(tableAddr).leave(handId, P1_ADDR).sign(ORACLE_PRIV);
    const leaveHex = Receipt.parseToParams(leaveReceipt);

    const event = {
      Subject: `TableLeave::${tableAddr}`,
      Message: JSON.stringify({
        tableAddr,
        leaverAddr: P1_ADDR,
        exitHand: handId,
      }),
    };
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(handId),
      [P1_ADDR, P2_ADDR],
      [new BigNumber(50000), new BigNumber(50000)],
      [new BigNumber(0), new BigNumber(0)],
    ]);
    sinon.stub(contract.leave, 'sendTransaction').yields(null, '0x112233');
    sinon.stub(contract.payoutFrom, 'sendTransaction').yields(null, '0x445566');
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const worker = new EventWorker(new Table(web3, '0x1255'), null, null, ORACLE_PRIV, sentry);

    Promise.all(worker.process(event)).then(() => {
      expect(contract.leave.sendTransaction).calledWith(...leaveHex, { from: '0x1255', gas: sinon.match.any }, sinon.match.any);
      expect(contract.payoutFrom.sendTransaction).calledWith(P1_ADDR, { from: '0x1255', gas: sinon.match.any }, sinon.match.any);
      expect(sentry.captureMessage).callCount(2);
      expect(sentry.captureMessage).calledWith('tx: table.payout()', {
        level: sinon.match.any,
        tags: { tableAddr },
        extra: {
          txHash: '0x445566',
          leaverAddr: P1_ADDR,
        },
      });
      expect(sentry.captureMessage).calledWith('tx: table.leave()', {
        level: sinon.match.any,
        tags: { tableAddr, handId },
        extra: { txHash: '0x112233', leaveReceipt },
      });

      done();
    }).catch(done);
  });

  it('should handle Kick.', (done) => {
    const tableAddr = EMPTY_ADDR;
    const event = {
      Subject: `Kick::${tableAddr}`,
      Message: JSON.stringify({
        tableAddr,
        pos: 0,
      }),
    };
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(2),
      [P1_ADDR, P2_ADDR],
      [new BigNumber(50000), new BigNumber(50000)],
      [new BigNumber(0), new BigNumber(0)],
    ]);
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 3,
      state: 'waiting',
      lineup: [{
        address: P1_ADDR,
        sitout: 1,
      }, {
        address: P2_ADDR,
      }],
    }] });
    sinon.stub(contract.leave, 'sendTransaction').yields(null, '0x112233');
    sinon.stub(sentry, 'captureMessage').yields(null, {});
    sinon.stub(contract.payoutFrom, 'sendTransaction').yields(null, '0x445566');

    const worker = new EventWorker(new Table(web3, '0x1255'), null, new Db(dynamo), ORACLE_PRIV, sentry);

    Promise.all(worker.process(event)).then(() => {
      const leaveReceipt = new Receipt(tableAddr).leave(2, P1_ADDR).sign(ORACLE_PRIV);
      const leaveHex = Receipt.parseToParams(leaveReceipt);
      expect(contract.leave.sendTransaction).calledWith(...leaveHex, { from: '0x1255', gas: sinon.match.any }, sinon.match.any);
      expect(sentry.captureMessage).calledWith('tx: table.leave()', {
        level: sinon.match.any,
        tags: { tableAddr, handId: 2 },
        extra: { txHash: '0x112233', leaveReceipt },
      });
      expect(contract.payoutFrom.sendTransaction).callCount(1);
      done();
    }).catch(done);
  });

  it('should handle new Table.', (done) => {
    const event = { Subject: 'HandComplete::0xa2de', Message: '' };
    sinon.stub(dynamo, 'query').yields(null, { Items: [] });
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(0),
      [EMPTY_ADDR, EMPTY_ADDR],
      [new BigNumber(0), new BigNumber(0)],
      [new BigNumber(0), new BigNumber(0)],
    ]);
    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(dynamo, 'putItem').yields(null, {});
    sinon.stub(sentry, 'captureMessage').yields(null, {});
    sinon.stub(sentry, 'captureException').yields(null, {});

    const worker = new EventWorker(new Table(web3, '0x1255'), null, new Db(dynamo), null, sentry);
    Promise.all(worker.process(event)).then(() => {
      expect(dynamo.putItem).calledWith({ Item: {
        tableAddr: '0xa2de',
        handId: 1,
        deck: sinon.match.any,
        state: 'waiting',
        dealer: 0,
        sb: 50,
        lineup: [{ address: EMPTY_ADDR }, { address: EMPTY_ADDR }],
        changed: sinon.match.any,
      },
        TableName: 'poker' });
      done();
    }).catch(done);
  });

  // create netting when hand with leaving player turns complete.
  it('should handle TableNettingRequest event.', (done) => {
    const event = {
      Subject: 'TableNettingRequest::0xa2decf075b96c8e5858279b31f644501a140e8a7',
      Message: JSON.stringify({
        tableAddr: '0xa2decf075b96c8e5858279b31f644501a140e8a7',
        handId: 2,
      }),
    };
    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(0),
      [P1_ADDR, P2_ADDR, EMPTY_ADDR],
      [new BigNumber(50000), new BigNumber(50000), new BigNumber(0)],
      [new BigNumber(0), new BigNumber(2), new BigNumber(0)],
    ]);
    sinon.stub(dynamo, 'getItem').yields(null, { Item: {
      lineup: [{
        address: P1_ADDR,
        last: new EWT(ABI_FOLD).fold(2, 500).sign(P1_PRIV),
      }, {
        address: P2_ADDR,
        last: new EWT(ABI_BET).bet(2, 1000).sign(P2_PRIV),
        lastHand: 2,
        leaveReceipt: '0x99',
      }, {
        address: EMPTY_ADDR,
      }],
      distribution: new EWT(ABI_DIST).distribution(2, 0, [EWT.concat(P2_ADDR, 1500).toString('hex')]).sign(ORACLE_PRIV),
    } }).onFirstCall().yields(null, { Item: {
      lineup: [{
        address: P1_ADDR,
        last: new EWT(ABI_BET).bet(1, 10000).sign(P1_PRIV),
      }, {
        address: P2_ADDR,
        last: new EWT(ABI_BET).bet(1, 10000).sign(P2_PRIV),
      }, {
        address: EMPTY_ADDR,
      }],
      distribution: new EWT(ABI_DIST).distribution(1, 0, [EWT.concat(P1_ADDR, 20000).toString('hex')]).sign(ORACLE_PRIV),
    } });
    sinon.stub(dynamo, 'updateItem').yields(null, {});
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const worker = new EventWorker(new Table(web3, '0x1255'), null, new Db(dynamo), ORACLE_PRIV, sentry);
    Promise.all(worker.process(event)).then(() => {
      const netting = {
        '0x82e8c6cf42c8d1ff9594b17a3f50e94a12cc860f': '0x306f6bc2348440582ca694d4998b082d3b77ad25b62fcf2f22e526a14e50ecf45bdb61d92d77bce6b5c7bce2800ddda525af1622af6b3d6f918993431fff18551c',
        newBalances: '0x000000025b96c8e5858279b31f644501a140e8a7000000000000000082e8c6cf42c8d1ff9594b17a3f50e94a12cc860f000000000000e86cf3beac30c498d9e26865f34fcaa57dbb935b0d740000000000009e34e10f3d125e5f4c753a6456fc37123cf17c6900f2',
      };
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':n', netting)));
      done();
    }).catch(done);
  });

  it('should prevent TableNettingRequest event from overwriting netting.', (done) => {
    const event = {
      Subject: 'TableNettingRequest::0xa2decf075b96c8e5858279b31f644501a140e8a7',
      Message: JSON.stringify({
        tableAddr: '0xa2decf075b96c8e5858279b31f644501a140e8a7',
        handId: 2,
      }),
    };
    sinon.stub(contract.smallBlind, 'call').yields(null, new BigNumber(50));
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(0),
      [P1_ADDR, P2_ADDR, EMPTY_ADDR],
      [new BigNumber(50000), new BigNumber(50000), new BigNumber(0)],
      [new BigNumber(0), new BigNumber(2), new BigNumber(0)],
    ]);
    sinon.stub(dynamo, 'getItem').yields(null, { Item: {
      netting: {},
    } }).onFirstCall().yields(null, { Item: {} });
    sinon.stub(dynamo, 'updateItem').yields(null, {});
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const worker = new EventWorker(new Table(web3, '0x1255'), null, new Db(dynamo), ORACLE_PRIV, sentry);
    Promise.all(worker.process(event)).then(() => {
      expect(dynamo.updateItem).callCount(0);
      done();
    }).catch(done);
  });

  // submit netting when netting complete.
  it('should handle TableNettingComplete event.', (done) => {
    const event = {
      Subject: 'TableNettingComplete::0x1234',
      Message: JSON.stringify({
        tableAddr: '0x77aabb11ee00',
        handId: 2,
      }),
    };
    sinon.stub(dynamo, 'getItem').yields(null, { Item: {
      netting: {
        newBalances: '0x112233',
        [ORACLE_ADDR]: '0x223344',
        [P1_ADDR]: '0x334455',
        [P2_ADDR]: '0x445566',
      },
    } });
    sinon.stub(contract.settle, 'sendTransaction').yields(null, '0x123456');
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const worker = new EventWorker(new Table(web3, '0x1255'), null, new Db(dynamo), null, sentry);
    Promise.all(worker.process(event)).then(() => {
      expect(contract.settle.sendTransaction).calledWith('0x112233', '0x223344334455445566', { from: '0x1255', gas: sinon.match.any }, sinon.match.any);
      expect(sentry.captureMessage).calledWith('tx: table.settle()', {
        level: sinon.match.any,
        tags: { tableAddr: '0x77aabb11ee00' },
        extra: { txHash: '0x123456', bals: '0x112233', sigs: '0x223344334455445566' },
      });
      done();
    }).catch(done);
  });

  it('should handle WalletCreated event.', (done) => {
    const event = {
      Subject: 'WalletCreated::0x1234',
      Message: JSON.stringify({
        signerAddr: P1_ADDR,
        accountId: 'someuuid',
      }),
    };
    sinon.stub(contract.create, 'sendTransaction').yields(null, '0x123456');
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const worker = new EventWorker(null, new Factory(web3, '0x1255', '0x1234'), null, null, sentry);
    Promise.all(worker.process(event)).then((rsp) => {
      expect(rsp[0]).to.eql('0x123456');
      expect(contract.create.sendTransaction).calledWith(P1_ADDR, '0x1255', 259200, { from: '0x1255', gas: sinon.match.any }, sinon.match.any);
      expect(sentry.captureMessage).calledWith(sinon.match.any, {
        extra: { accountId: 'someuuid', signerAddr: P1_ADDR },
        level: 'info',
        user: { id: P1_ADDR },
      });
      done();
    }).catch(done);
  });

  it('should handle WalletReset event.', (done) => {
    const event = {
      Subject: 'WalletReset::0x1234',
      Message: JSON.stringify({
        oldSignerAddr: P1_ADDR,
        newSignerAddr: P2_ADDR,
      }),
    };
    const contrAddr = P3_ADDR;
    sinon.stub(contract.getAccount, 'call').yields(null, ['0x1122', contrAddr, new BigNumber(5)]);
    sinon.stub(contract.changeSigner, 'sendTransaction').yields(null, '0x123456');
    sinon.stub(sentry, 'captureMessage').yields(null, {});
    const recoveryReceipt = new Receipt(contrAddr).recover(5, P2_ADDR).sign(ORACLE_PRIV);
    const recoveryHex = Receipt.parseToParams(recoveryReceipt);

    const worker = new EventWorker(null, new Factory(web3, '0x1255', '0x1234'),
      null, null, sentry, new Controller(web3, P3_ADDR), ORACLE_PRIV);
    Promise.all(worker.process(event)).then(() => {
      expect(contract.changeSigner.sendTransaction).calledWith(
        ...recoveryHex, { from: P3_ADDR, gas: sinon.match.any }, sinon.match.any);
      expect(sentry.captureMessage).calledWith(sinon.match.any, {
        extra: {
          oldAddr: P1_ADDR,
          newAddr: P2_ADDR,
          recoveryReceipt,
          txHash: '0x123456',
        },
        level: 'info',
      });
      done();
    }).catch(done);
  });

  // payout players after Netted event.
  it('should handle Netted event in table.', (done) => {
    const event = {
      Subject: 'ContractEvent::0x77aabb11ee00',
      Message: JSON.stringify({
        address: '0x77aabb11ee00',
        event: 'Netted',
        args: {},
      }),
    };
    const lineup = [
      new BigNumber(3),
      [P1_ADDR, P2_ADDR],
      [new BigNumber(50000), new BigNumber(50000)],
      [new BigNumber(0), new BigNumber(2)],
    ];
    sinon.stub(dynamo, 'query').yields(null, { Items: [{ handId: 2 }] });
    sinon.stub(dynamo, 'deleteItem').yields(null, {});
    sinon.stub(contract.getLineup, 'call').yields(null, lineup);
    sinon.stub(contract.payoutFrom, 'sendTransaction').yields(null, '0x123456');
    sinon.stub(sentry, 'captureMessage').yields(null, {});

    const worker = new EventWorker(new Table(web3, '0x1255'), null, new Db(dynamo), null, sentry);
    Promise.all(worker.process(event)).then((rsp) => {
      expect(rsp[0]).to.eql(['0x123456']);
      expect(contract.payoutFrom.sendTransaction).calledWith(P2_ADDR, { from: '0x1255', gas: sinon.match.any }, sinon.match.any);
      expect(dynamo.deleteItem).callCount(2);
      expect(dynamo.deleteItem).calledWith({ Key: {
        handId: 2,
        tableAddr: '0x77aabb11ee00',
      },
        TableName: 'poker' });
      expect(dynamo.deleteItem).calledWith({ Key: {
        handId: 3,
        tableAddr: '0x77aabb11ee00',
      },
        TableName: 'poker' });
      done();
    }).catch(done);
  });

  // payout multiple players after Netted event.
  it('should handle Netted event in table for multiple players.', (done) => {
    const event = {
      Subject: 'ContractEvent::0x77aabb11ee00',
      Message: JSON.stringify({
        address: '0x77aabb11ee00',
        event: 'Netted',
        args: {},
      }),
    };
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(2),
      [P1_ADDR, P2_ADDR],
      [new BigNumber(50000), new BigNumber(50000)],
      [new BigNumber(1), new BigNumber(2)],
    ]);
    sinon.stub(dynamo, 'query').yields(null, { Items: [{ handId: 2 }] });
    sinon.stub(dynamo, 'deleteItem').yields(null, {});
    sinon.stub(sentry, 'captureMessage').yields(null, {});
    sinon.stub(contract.payoutFrom, 'sendTransaction')
      .yields(null, '0x123456')
      .onFirstCall().yields(null, '0x789abc');

    const worker = new EventWorker(new Table(web3, '0x1255'), null, new Db(dynamo), null, sentry);
    Promise.all(worker.process(event)).then((rsp) => {
      expect(rsp[0]).to.eql(['0x789abc', '0x123456']);
      expect(contract.payoutFrom.sendTransaction).callCount(2);
      expect(contract.payoutFrom.sendTransaction).calledWith(P1_ADDR, { from: '0x1255', gas: sinon.match.any }, sinon.match.any);
      expect(contract.payoutFrom.sendTransaction).calledWith(P2_ADDR, { from: '0x1255', gas: sinon.match.any }, sinon.match.any);
      expect(dynamo.deleteItem).callCount(1);
      expect(dynamo.deleteItem).calledWith({ Key: {
        handId: 2,
        tableAddr: '0x77aabb11ee00',
      },
        TableName: 'poker' });
      done();
    }).catch(done);
  });

  it('should handle Table join as first player.', (done) => {
    const event = {
      Subject: 'ContractEvent::0x77aabb11ee00',
      Message: JSON.stringify({
        address: '0x77aabb11ee00',
        event: 'Join',
        args: {},
      }),
    };
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(2),
      [EMPTY_ADDR, P2_ADDR],
      [new BigNumber(0), new BigNumber(50000)],
      [new BigNumber(0), new BigNumber(0)],
    ]);
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 3,
      state: 'waiting',
      lineup: [{
        address: EMPTY_ADDR,
      }, {
        address: EMPTY_ADDR,
      }],
    }] });
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    const worker = new EventWorker(new Table(web3, '0x1255'), null, new Db(dynamo), null, sentry);
    const trueIsh = sinon.match((value) => {
      const hasSeat = value.ExpressionAttributeValues[':s'].address === P2_ADDR;
      const hasDealer = value.ExpressionAttributeValues[':d'] === 1;
      return hasSeat && hasDealer;
    }, 'trueIsh');
    Promise.all(worker.process(event)).then(() => {
      expect(dynamo.updateItem).calledWith(sinon.match(trueIsh));
      done();
    }).catch(done);
  });

  it('should handle Table join.', (done) => {
    const event = {
      Subject: 'ContractEvent::0x77aabb11ee00',
      Message: JSON.stringify({
        address: '0x77aabb11ee00',
        event: 'Join',
        args: {},
      }),
    };
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(2),
      [P1_ADDR, P2_ADDR],
      [new BigNumber(50000), new BigNumber(50000)],
      [new BigNumber(0), new BigNumber(0)],
    ]);
    sinon.stub(sentry, 'captureMessage').yields(null, {});
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 3,
      state: 'waiting',
      lineup: [{
        address: P1_ADDR,
      }, {
        // empty
      }],
    }] });
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    const worker = new EventWorker(new Table(web3, '0x1255'), null, new Db(dynamo), null, sentry);
    Promise.all(worker.process(event)).then(() => {
      const seat = { address: P2_ADDR };
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':s', seat)));
      done();
    }).catch(done);
  });

  it('should handle Table join after game started.', (done) => {
    const event = {
      Subject: 'ContractEvent::0x77aabb11ee00',
      Message: JSON.stringify({
        address: '0x77aabb11ee00',
        event: 'Join',
        args: {},
      }),
    };
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(2),
      [P1_ADDR, P2_ADDR, P3_ADDR],
      [new BigNumber(50000), new BigNumber(50000), new BigNumber(50000)],
      [new BigNumber(0), new BigNumber(0), new BigNumber(0)],
    ]);
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 3,
      state: 'flop',
      lineup: [{
        address: P1_ADDR,
      }, {
        address: P2_ADDR,
      }, {
        // empty
      }],
    }] });
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    const worker = new EventWorker(new Table(web3, '0x1255'), null, new Db(dynamo), null, sentry);
    Promise.all(worker.process(event)).then(() => {
      const seat = { address: P3_ADDR, sitout: sinon.match.number };
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':s', seat)));
      done();
    }).catch(done);
  });

  it('should handle Table leave.', (done) => {
    const event = {
      Subject: 'ContractEvent::0x77aabb11ee00',
      Message: JSON.stringify({
        address: '0x77aabb11ee00',
        event: 'Leave',
        args: {},
      }),
    };
    sinon.stub(contract.getLineup, 'call').yields(null, [new BigNumber(2),
      [P1_ADDR, EMPTY_ADDR],
      [new BigNumber(50000), new BigNumber(0)],
      [new BigNumber(0), new BigNumber(0)],
    ]);
    sinon.stub(dynamo, 'query').yields(null, { Items: [{
      handId: 3,
      lineup: [{
        address: P1_ADDR,
      }, {
        address: P2_ADDR,
        last: '0x11',
      }],
    }] });
    sinon.stub(dynamo, 'updateItem').yields(null, {});

    const worker = new EventWorker(new Table(web3, '0x1255'), null, new Db(dynamo), null, sentry);
    Promise.all(worker.process(event)).then(() => {
      const seat = { address: EMPTY_ADDR };
      expect(dynamo.updateItem).calledWith(sinon.match.has('ExpressionAttributeValues', sinon.match.has(':s', seat)));
      done();
    }).catch(done);
  });

  afterEach(() => {
    if (contract.leave.sendTransaction.restore) contract.leave.sendTransaction.restore();
    if (contract.settle.sendTransaction.restore) contract.settle.sendTransaction.restore();
    if (contract.payoutFrom.sendTransaction.restore) contract.payoutFrom.sendTransaction.restore();
    if (contract.net.sendTransaction.restore) contract.net.sendTransaction.restore();
    if (contract.create.sendTransaction.restore) contract.create.sendTransaction.restore();
    if (contract.getLineup.call.restore) contract.getLineup.call.restore();
    if (contract.smallBlind.call.restore) contract.smallBlind.call.restore();
    if (dynamo.getItem.restore) dynamo.getItem.restore();
    if (dynamo.putItem.restore) dynamo.putItem.restore();
    if (dynamo.query.restore) dynamo.query.restore();
    if (dynamo.updateItem.restore) dynamo.updateItem.restore();
    if (dynamo.deleteItem.restore) dynamo.deleteItem.restore();
    if (sentry.captureMessage.restore) sentry.captureMessage.restore();
    if (sentry.captureException.restore) sentry.captureException.restore();
  });
});
