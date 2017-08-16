import chai, { expect } from 'chai';
import sinonChai from 'sinon-chai';
import sinon from 'sinon';
import { it, describe, afterEach } from 'mocha';
import Db from './src/db';
import TableContract from './src/tableContract';
import Service from './src/index';

chai.use(sinonChai);

const sdb = {
  getAttributes() {},
  putAttributes() {},
  deleteAttributes() {},
  select() {},
};

const web3 = {
  eth: {
    contract() {},
    at() {},
    getTransaction() {},
  },
};

const pusher = {
  trigger() {},
};

const contract = {
  getLineup: { call() {} },
};

const TABLE_ADDR = '0x1f17f994c1a9edcc98fdc59ac5a0f287cd1efc2e';
const TX_HASH = '0x8995de222b85f61928ac83594ee754341ef9a41d67c1b49a610630ae207289bb';
const SIGNER_ADDR = '0x82e8c6cf42c8d1ff9594b17a3f50e94a12cc860f';
const TX_INPUT = '0xd7f31eb9000000000000000000000000179237e4e955369a69bd26499e3b89f6df9e5d7b0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a4422810ea0000000000000000000000001f17f994c1a9edcc98fdc59ac5a0f287cd1efc2e0000000000000000000000000000000000000000000000000000246139ca8000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000150032adb84cc8054048448a8696292c0c89030c554b000000000000000000000000000000000000000000000000000000000000000000000000000000';

sinon.stub(web3.eth, 'contract').returns(web3.eth);
sinon.stub(web3.eth, 'at').returns(contract);
sinon.stub(pusher, 'trigger').yields(null);
    // sinon.stub(sdb, 'select').yields(null, {});
    // const manager = new AccountManager(new Db({}));
    // try {
    //   manager.addAccount('123', TEST_MAIL, {});
    // } catch (err) {
    //   expect(err.message).to.contain('Bad Request: ');
    //   return;
    // }
    // throw new Error('should have thrown');

describe('Reservation Service - reserve seat ', () => {
  it('should reserve seat for player and notify about that', async () => {
    const db = new Db(sdb, 'tableName');
    const service = new Service(
      new TableContract(web3),
      pusher,
      db,
    );

    sinon.stub(sdb, 'putAttributes').yields(null, { ResponseMetadata: {} });
    sinon.stub(sdb, 'select').yields(null, {});
    sinon.stub(contract.getLineup, 'call').yields(null, [[], [], [], []]);
    sinon.stub(web3.eth, 'getTransaction').yields(null, {
      input: TX_INPUT,
    });

    try {
      await service.reserve(TABLE_ADDR, 0, SIGNER_ADDR, TX_HASH, '10000');
      expect(sdb.putAttributes).calledWith({
        DomainName: 'tableName',
        ItemName: `${TABLE_ADDR}-0`,
        Attributes: [
          { Name: 'tableAddr', Value: TABLE_ADDR },
          { Name: 'pos', Value: '0' },
          { Name: 'signerAddr', Value: SIGNER_ADDR },
          { Name: 'txHash', Value: TX_HASH },
          { Name: 'amount', Value: '10000' },
          { Name: 'created', Value: sinon.match.any },
        ],
      });
      expect(pusher.trigger).calledWith(
        TABLE_ADDR,
        'update',
        {
          type: 'seatReserve',
          payload: {
            pos: '0',
            amount: '10000',
            txHash: TX_HASH,
            signerAddr: SIGNER_ADDR,
          },
        },
      );
    } catch (e) {
      throw e;
    }
  });

  it('should not reserve reserved seat', async () => {
    const db = new Db(sdb, 'tableName');
    const service = new Service(
      new TableContract(web3),
      pusher,
      db,
    );

    sinon.stub(sdb, 'select').yields(null, {
      Items: [
        {
          Attributes: [
            { Name: 'pos', Value: '0' },
          ],
        },
      ],
    });
    sinon.stub(web3.eth, 'getTransaction').yields(null, {
      input: TX_INPUT,
    });

    try {
      await service.reserve(TABLE_ADDR, 0, SIGNER_ADDR, TX_HASH, '10000');
    } catch (e) {
      expect(e.message).equal('Seat is busy');
    }
  });

  it('should not reserve seat busy in contract', async () => {
    const db = new Db(sdb, 'tableName');
    const service = new Service(
      new TableContract(web3),
      pusher,
      db,
    );

    sinon.stub(sdb, 'select').yields(null, {});
    sinon.stub(contract.getLineup, 'call').yields(null, [[], [
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000000',
    ], [], []]);
    sinon.stub(web3.eth, 'getTransaction').yields(null, {
      input: TX_INPUT,
    });

    try {
      await service.reserve(TABLE_ADDR, 0, SIGNER_ADDR, TX_HASH, '10000');
    } catch (e) {
      expect(e.message).equal('Seat is busy');
    }
  });

  it('should not reserve seat for player that already have reserved seat at table', async () => {
    const db = new Db(sdb, 'tableName');
    const service = new Service(
      new TableContract(web3),
      pusher,
      db,
    );

    sinon.stub(sdb, 'select').yields(null, {
      Items: [
        {
          Attributes: [
            { Name: 'pos', Value: '1' },
            { Name: 'signerAddr', Value: SIGNER_ADDR },
          ],
        },
      ],
    });
    sinon.stub(contract.getLineup, 'call').yields(null, [[], [], [], []]);
    sinon.stub(web3.eth, 'getTransaction').yields(null, {
      input: TX_INPUT,
    });

    try {
      await service.reserve(TABLE_ADDR, 0, SIGNER_ADDR, TX_HASH, '10000');
    } catch (e) {
      expect(e.message).equal('Already at table');
    }
  });

  it('should not reserve seat for player already seated at table', async () => {
    const db = new Db(sdb, 'tableName');
    const service = new Service(
      new TableContract(web3),
      pusher,
      db,
    );

    sinon.stub(sdb, 'select').yields(null, {});
    sinon.stub(contract.getLineup, 'call').yields(null, [[], [
      '0x0000000000000000000000000000000000000000',
      SIGNER_ADDR,
    ], [], []]);
    sinon.stub(web3.eth, 'getTransaction').yields(null, {
      input: TX_INPUT,
    });

    try {
      await service.reserve(TABLE_ADDR, 0, SIGNER_ADDR, TX_HASH, '10000');
    } catch (e) {
      expect(e.message).equal('Already at table');
    }
  });

  it('should not reserve seat when tableAddr and txHash mismatch', async () => {
    const db = new Db(sdb, 'tableName');
    const service = new Service(
      new TableContract(web3),
      pusher,
      db,
    );

    sinon.stub(web3.eth, 'getTransaction').yields(null, {
      input: '',
    });

    try {
      await service.reserve(TABLE_ADDR, 0, SIGNER_ADDR, TX_HASH, '10000');
    } catch (e) {
      expect(e.message).equal('Wrong tableAddr or txHash');
    }
  });

  afterEach(() => {
    if (sdb.getAttributes.restore) sdb.getAttributes.restore();
    if (sdb.putAttributes.restore) sdb.putAttributes.restore();
    if (sdb.deleteAttributes.restore) sdb.deleteAttributes.restore();
    if (sdb.select.restore) sdb.select.restore();
    if (contract.getLineup.call.restore) contract.getLineup.call.restore();
    if (web3.eth.getTransaction.restore) web3.eth.getTransaction.restore();
  });
});
