
/**
 * Copyright (c) 2017-present, Parsec Labs (parseclabs.org)
 *
 * This source code is licensed under the GNU Affero General Public License,
 * version 3, found in the LICENSE file in the root directory of this source 
 * tree.
 */

export const FACTORY_ABI = [{"constant":true,"inputs":[{"name":"","type":"uint256"}],"name":"admins","outputs":[{"name":"","type":"address"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"_admin","type":"address"}],"name":"removeAdmin","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"disputeTime","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"_admin","type":"address"}],"name":"addAdmin","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[{"name":"","type":"uint256"}],"name":"tables","outputs":[{"name":"","type":"address"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"tokenAddress","outputs":[{"name":"","type":"address"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"oracleAddress","outputs":[{"name":"","type":"address"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"getTables","outputs":[{"name":"","type":"address[]"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"_token","type":"address"},{"name":"_oracle","type":"address"},{"name":"_disputeTime","type":"uint256"}],"name":"configure","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"name":"_blindStructure","type":"uint16[]"},{"name":"_blindLevelDuration","type":"uint256"},{"name":"_seats","type":"uint256"}],"name":"create","outputs":[{"name":"","type":"address"}],"payable":false,"stateMutability":"nonpayable","type":"function"}]; // eslint-disable-line

function FactoryContract(web3, factoryAddr) {
  this.web3 = web3;
  this.factoryAddr = factoryAddr;
}

FactoryContract.prototype.getTables = function getTables() {
  const contract = this.web3.eth.contract(FACTORY_ABI).at(this.factoryAddr);
  return new Promise((fulfill, reject) => {
    contract.getTables.call((err, val) => {
      if (err) {
        reject(err);
      }
      fulfill(val);
    });
  });
};

module.exports = FactoryContract;
