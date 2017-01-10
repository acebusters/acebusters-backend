const Web3 = require('web3');
const ProviderEngine = require('web3-provider-engine');
const CacheSubprovider = require('web3-provider-engine/subproviders/cache.js');
const FixtureSubprovider = require('web3-provider-engine/subproviders/fixture.js');
const FilterSubprovider = require('web3-provider-engine/subproviders/filters.js');
const RpcSubprovider = require('web3-provider-engine/subproviders/rpc.js');
const HookedWalletSubprovider = require('web3-provider-engine/subproviders/hooked-wallet.js');
const NonceSubprovider = require('web3-provider-engine/subproviders/nonce-tracker.js');
const wallet = require('eth-lightwallet');


const pwDerivedKey = new Uint8Array([215,152,86,175,5,168,43,177,135,97,218,89,136,5,110,93,193,114,94,197,247,212,127,83,200,150,255,124,17,245,91,10]);
const tableAbi = [{"constant":false,"inputs":[{"name":"_leaveReceipt","type":"bytes"}],"name":"leave","outputs":[{"name":"","type":"address"}],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"_handId","type":"uint256"},{"name":"_addr","type":"address"}],"name":"getOut","outputs":[{"name":"","type":"uint96"},{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"","type":"uint256"}],"name":"seats","outputs":[{"name":"addr","type":"address"},{"name":"amount","type":"uint96"},{"name":"lastHand","type":"uint256"},{"name":"conn","type":"bytes32"}],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"lastNettingRequestTime","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"lastHandNetted","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_sender","type":"address"}],"name":"payoutFrom","outputs":[],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_newBalances","type":"bytes"},{"name":"_sigs","type":"bytes"}],"name":"settle","outputs":[{"name":"","type":"bool"}],"payable":false,"type":"function"},{"constant":false,"inputs":[],"name":"payout","outputs":[],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_now","type":"uint256"}],"name":"netHelp","outputs":[],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"oracle","outputs":[{"name":"","type":"address"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_buyIn","type":"uint96"},{"name":"_conn","type":"bytes32"}],"name":"join","outputs":[],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"_handId","type":"uint256"},{"name":"_addr","type":"address"}],"name":"getIn","outputs":[{"name":"","type":"uint96"}],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"getLineup","outputs":[{"name":"","type":"uint256"},{"name":"addr","type":"address[]"},{"name":"amount","type":"uint256[]"},{"name":"lastHand","type":"uint256[]"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_bets","type":"bytes"},{"name":"_sigs","type":"bytes"}],"name":"submitBets","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"lastNettingRequestHandId","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":false,"inputs":[],"name":"net","outputs":[],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"smallBlind","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_dists","type":"bytes"},{"name":"_sigs","type":"bytes"}],"name":"submitDists","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"inputs":[{"name":"_token","type":"address"},{"name":"_oracle","type":"address"},{"name":"_smallBlind","type":"uint256"},{"name":"_seats","type":"uint256"}],"payable":false,"type":"constructor"},{"anonymous":false,"inputs":[{"indexed":false,"name":"addr","type":"address"},{"indexed":false,"name":"conn","type":"bytes32"},{"indexed":false,"name":"amount","type":"uint256"}],"name":"Join","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"hand","type":"uint256"}],"name":"NettingRequest","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"hand","type":"uint256"}],"name":"Netted","type":"event"}];

function Provider (rpcUrl, secret) {
  var engine = new ProviderEngine();
  var web3 = new Web3(engine);
  
  engine.addProvider(new FixtureSubprovider({
    web3_clientVersion: 'ProviderEngine/v0.0.0/javascript',
    net_listening: true,
    eth_hashrate: '0x00',
    eth_mining: false,
    eth_syncing: true,
  }));

  // cache layer
  engine.addProvider(new CacheSubprovider());

  // filters 
  //engine.addProvider(new FilterSubprovider())

  // pending nonce
  engine.addProvider(new NonceSubprovider());

  // vm
  //engine.addProvider(new VmSubprovider());

  if (secret) {
    var ks;
    if (secret && secret.length > 70) {
      ks = new wallet.keystore(secret, pwDerivedKey);
      ks.generateNewAddress(pwDerivedKey, 1);
    } else if (secret) {
      ks = new wallet.keystore();
      ks.addPriv = function(privkeyHex) {
        var privKey = new Buffer(privkeyHex.replace('0x',''), 'hex');
        var encPrivKey = wallet.keystore._encryptKey(privKey, pwDerivedKey);
        var address = wallet.keystore._computeAddressFromPrivKey(privKey);
        this.ksData["m/0'/0'/0'"].encPrivKeys[address] = encPrivKey;
        this.ksData["m/0'/0'/0'"].addresses.push(address);
      };
      ks.isDerivedKeyCorrect = function(pwDerivedKey) {
        if (!this.encSeed)
          return true;
        var paddedSeed = KeyStore._decryptString(this.encSeed, pwDerivedKey);
        if (paddedSeed.length > 0) {
          return true;
        }
        return false;
      };
      ks.addPriv(secret);
    }

    var addr = '0x' + ks.getAddresses()[0];

    engine.addProvider(new HookedWalletSubprovider({
      getAccounts: function(cb) {
        cb(null, [addr]);
      },
      approveTransaction: function(txParams, cb) {
        cb(null, true);
      },
      signTransaction: function(txData, cb) {
        txData.gasPrice = parseInt(txData.gasPrice, 16);
        txData.nonce = parseInt(txData.nonce, 16);
        txData.gasLimit = txData.gas;
        var tx = wallet.txutils.createContractTx(addr, txData);
        var signed = wallet.signing.signTx(ks, pwDerivedKey, tx.tx, addr);
        cb(null, signed);
      }
    }));
  }

  engine.addProvider(new RpcSubprovider({
    rpcUrl: rpcUrl,
  }));
  engine.start();

  this.web3 = web3;
  this.address = addr;
}

Provider.prototype.getTable = function (tableAddr) {
  return this.web3.eth.contract(tableAbi).at(tableAddr);
}

Provider.prototype.getWeb3 = function () {
  return this.web3;
}

Provider.prototype.getAddress = function () {
  return this.address;
}

module.exports = Provider;
