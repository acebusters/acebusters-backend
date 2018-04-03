import _ from 'lodash';
import txIsReady from './txIsReady';

const EMPTY_ADDR = '0x0000000000000000000000000000000000000000';

export default class ReserveSerivce {

  constructor(table, pusher, db, web3) {
    this.table = table;
    this.pusher = pusher;
    this.db = db;
    this.web3 = web3;
  }

  notify(tableAddr, event) {
    return new Promise((resolve, reject) => {
      this.pusher.trigger(tableAddr, 'update', event, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  getReservations(tableAddr) {
    return this.db.getTableReservations(tableAddr);
  }

  async reserve(tableAddr, pos, signerAddr, txHash, amount) {
    try {
      const transaction = await this.table.getTransaction(txHash);
      if (!transaction) {
        throw new Error('Transaction does not exist');
      }

      if (transaction.input.indexOf(tableAddr.replace('0x', '')) === -1) {
        throw new Error('Wrong tableAddr or txHash');
      }

      const reservations = await this.db.getTableReservations(tableAddr);
      if (reservations[pos]) {
        throw new Error('Seat is busy');
      }

      const signerAddrs = Object.keys(reservations).map(k => reservations[k].signerAddr);
      if (signerAddrs.indexOf(signerAddr) > -1) {
        throw new Error('Already at table');
      }

      const { lineup } = await this.table.getLineup(tableAddr);
      if (lineup[pos].address !== EMPTY_ADDR) {
        throw new Error('Seat is busy');
      }

      if (lineup.findIndex(seat => seat.address === signerAddr) > -1) {
        throw new Error('Already at table');
      }

      const result = await this.db.reserveSeat(tableAddr, pos, signerAddr, txHash, amount);
      await this.notify(tableAddr, {
        type: 'seatReserve',
        payload: { pos: String(pos), amount, txHash, signerAddr },
      });
      return result;
    } catch (e) {
      throw e;
    }
  }

  async cleanup(timeout) {
    const items = await this.db.getReservations();
    const now = Math.round(Date.now() / 1000);
    const deletedItems = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (
        Number(item.created) + timeout < now ||
        await txIsReady(this.web3, item.txHash) // eslint-disable-line no-await-in-loop
      ) {
        deletedItems.push(item);
      }
    }

    await this.db.deleteItems(deletedItems);

    await Promise.all(_.map(_.groupBy(deletedItems, 'tableAddr'), (payload, key) => this.notify(key, {
      type: 'seatsRelease',
      payload,
    })));

    return deletedItems;
  }

}
