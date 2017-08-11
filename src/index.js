export default class ReserveSerivce {

  constructor(table, pusher, db) {
    this.table = table;
    this.pusher = pusher;
    this.db = db;
  }

  reserve(tableAddr, pos, singerAddr, txHash, amount) {
    console.log(this, tableAddr, pos, singerAddr, txHash, amount);
    return Promise.resolve('');
  }

}
