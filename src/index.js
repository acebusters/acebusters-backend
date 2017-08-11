const EMPTY_ADDR = '0x0000000000000000000000000000000000000000';

export default class ReserveSerivce {

  constructor(table, pusher, db) {
    this.table = table;
    this.pusher = pusher;
    this.db = db;
  }

  getReservations(tableAddr) {
    return this.db.getTableReservations(tableAddr);
  }

  async reserve(tableAddr, pos, signerAddr, txHash, amount) {
    try {
      const seat = await this.db.getSeat(tableAddr, pos);

      if (seat) {
        throw new Error('Seat is busy');
      }

      const lineup = await this.table.getLineup(tableAddr);
      if (lineup[1][pos] !== EMPTY_ADDR) {
        throw new Error('Seat is busy');
      }

      return await this.db.reserveSeat(tableAddr, pos, signerAddr, txHash, amount);
      // notify through pusher
    } catch (e) {
      throw e;
    }
  }

  async cleanup() {
    console.log(this);
    // find outdated reservations
    // delete outdated reservations
    // notify about outdated reservations through pusher
  }

}
