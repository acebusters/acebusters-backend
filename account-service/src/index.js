
/**
 * Copyright (c) 2017-present, Parsec Labs (parseclabs.org)
 *
 * This source code is licensed under the GNU Affero General Public License,
 * version 3, found in the LICENSE file in the root directory of this source 
 * tree.
 */

import poly from 'buffer-v6-polyfill'; // eslint-disable-line no-unused-vars
import { Receipt, Type } from 'poker-helper';
import ethUtil from 'ethereumjs-util';
import { BadRequest, Unauthorized, Forbidden, Conflict, EnhanceYourCalm, Teapot } from './errors';

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const refRegex = /^[0-9a-f]{8}$/i;
const emailRegex = /^(([^<>()[\]\\.,;:\s@']+(\.[^<>()[\]\\.,;:\s@']+)*)|('.+'))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

function fakeId(email) {
  const hash = ethUtil.sha3(`${email}${'fakeid[405723v5'}`).toString('hex');
  const p1 = hash.slice(0, 8);
  const p2 = hash.slice(8, 12);
  const p3 = hash.match(/[1-5]/)[0];
  const p4 = hash.slice(12, 15);
  const p5 = hash.match(/[89ab]/)[0];
  const p6 = hash.slice(15, 18);
  const p7 = hash.slice(18, 30);

  return `${p1}-${p2}-${p3}${p4}-${p5}${p6}-${p7}`;
}

/**
 * Checks if the given string is a checksummed address
 *
 * @method isChecksumAddress
 * @param {String} address the given HEX adress
 * @return {Boolean}
*/
function isChecksumAddress(addr) {
  // Check each case
  const address = addr.replace('0x', '');
  const addressHash = ethUtil.sha3(address.toLowerCase());
  for (let i = 0; i < 40; i += 1) {
    // the nth letter should be uppercase if the nth digit of casemap is 1
    if ((parseInt(addressHash[i], 16) > 7
      && address[i].toUpperCase() !== address[i])
      || (parseInt(addressHash[i], 16) <= 7
        && address[i].toLowerCase() !== address[i])) {
      return false;
    }
  }
  return true;
}

/**
 * Checks if the given string is an address
 *
 * @method isAddress
 * @param {String} address the given HEX adress
 * @return {Boolean}
*/
function isAddress(address) {
  if (!/^(0x)?[0-9a-f]{40}$/i.test(address)) {
    // check if it has the basic requirements of an address
    return false;
  } else if (/^(0x)?[0-9a-f]{40}$/.test(address) || /^(0x)?[0-9A-F]{40}$/.test(address)) {
    // If it's all small caps or all all caps, return true
    return true;
  }
  // Otherwise check each case
  return isChecksumAddress(address);
}

function checkSession(sessionReceipt, sessionAddr, type, timeoutHours) {
  // check session
  let session;
  try {
    session = Receipt.parse(sessionReceipt);
  } catch (err) {
    throw new Unauthorized(`invalid session: ${err.message}.`);
  }
  if (session.signer !== sessionAddr) {
    throw new Unauthorized(`invalid session signer: ${session.signer}.`);
  }

  if (timeoutHours) {
    const timeout = (Date.now() / 1000) - (60 * 60 * timeoutHours);
    if (timeoutHours > 0 && session.created < timeout) {
      throw new Unauthorized(`session expired since ${timeout - session.created} seconds.`);
    } else if (timeoutHours < 0 && session.created >= timeout) {
      throw new Unauthorized('session is too fresh.');
    }
  }

  if (session.type !== type) {
    throw new Forbidden(`Wallet operation forbidden with session type ${session.type}.`);
  }
  return session;
}

function checkWallet(walletStr) {
  let wallet;
  try {
    wallet = JSON.parse(walletStr);
  } catch (err) {
    throw new BadRequest(`invalid wallet json: ${err.message}.`);
  }
  if (!isAddress(wallet.address)) {
    throw new BadRequest(`invalid address ${wallet.address} in wallet.`);
  }
  return wallet;
}

class AccountManager {
  constructor(db, email, recaptcha, sns, topicArn, sessionPriv, proxy, nutz,
    logger, unlockPriv, slackAlert, minProxiesAlertThreshold) {
    this.db = db;
    this.email = email;
    this.recaptcha = recaptcha;
    this.sns = sns;
    this.proxy = proxy;
    this.nutz = nutz;
    this.topicArn = topicArn;
    this.logger = logger;
    this.unlockPriv = unlockPriv;
    this.slackAlert = slackAlert;
    this.minProxiesAlertThreshold = minProxiesAlertThreshold;
    if (sessionPriv) {
      this.sessionPriv = sessionPriv;
      const priv = new Buffer(sessionPriv.replace('0x', ''), 'hex');
      this.sessionAddr = `0x${ethUtil.privateToAddress(priv).toString('hex')}`;
    }
  }

  async getAccount(accountId) {
    const account = await this.db.getAccount(accountId);
    return { ...account, id: accountId };
  }

  async getRef(refCode) {
    const globalRef = '00000000';
    // todo: check ref format
    if (!refRegex.test(refCode)) {
      // http 400
      throw new BadRequest(`passed refCode ${refCode} not valid.`);
    }

    const isGlob = globalRef === refCode;
    const referral = isGlob ? { allowance: 1 } : await this.db.getRef(refCode);
    const glob = await this.db.getRef(globalRef);

    if (glob.allowance < 1) {
      // 420 - global signup limit reached
      throw new EnhanceYourCalm('global limit reached');
    }
    if (referral.allowance < 1) {
      // 418 - invite limit for this code reached
      throw new Teapot('account invite limit reached');
    }
    if (uuidRegex.test(glob.account)) {
      // 200 - return global ref code
      // this will allow users without ref code to sign up
      return { defaultRef: glob.account };
    }
    // 200 - do not provide default ref code
    // users without ref code will not be able to sign up
    return {};
  }

  async forward(forwardReceipt) {
    try {
      const { signer: signerAddr, destinationAddr, amount, data } = Receipt.parse(forwardReceipt);
      const account = await this.db.getAccountBySignerAddr(signerAddr);
      const [owner, isLocked] = await Promise.all([
        this.proxy.getOwner(account.proxyAddr),
        this.proxy.isLocked(account.proxyAddr),
      ]);

      if (!isLocked) {
        throw new BadRequest(`${account.proxyAddr} is an unlocked account. send tx with ${owner}`);
      }

      if (owner !== this.proxy.senderAddr) {
        throw new BadRequest(`wrong owner ${owner} found on proxy ${account.proxyAddr}`);
      }

      const response = await this.proxy.forward(
        account.proxyAddr,
        destinationAddr,
        amount,
        data,
        signerAddr,
      );

      return response[0];
    } catch (e) {
      // console.log(e);
      return Promise.reject(`Bad Request: ${e}`);
    }
  }

  queryRefCodes(accountId) {
    return this.db.getRefsByAccount(accountId);
  }

  async queryAccount(email) {
    try {
      const account = await this.db.getAccountByEmail(email);

      return {
        id: account.id,
        proxyAddr: account.proxyAddr,
        wallet: account.wallet,
      };
    } catch (err) {
      return {
        id: fakeId(email),
        proxyAddr: `0x${ethUtil.sha3(`${email}${'proxyAddrobeqw4cq'}`).slice(0, 20).toString('hex')}`,
        wallet: JSON.stringify({
          address: `0x${ethUtil.sha3(`${email}${'addressawobeqw4cq'}`).slice(0, 20).toString('hex')}`,
          Crypto: {
            cipher: 'aes-128-ctr',
            cipherparams: {
              iv: ethUtil.sha3(`${email}${'cipherparamsivaic4w6b'}`).slice(0, 16).toString('hex'),
            },
            ciphertext: ethUtil.sha3(`${email}${'ciphertextaoc84noq354'}`).slice(0, 32).toString('hex'),
            kdf: 'scrypt',
            kdfparams: {
              dklen: 32,
              n: 65536,
              r: 1,
              p: 8,
              salt: ethUtil.sha3(`${email}${'kdfparamssalta7c465oa754'}`).slice(0, 32).toString('hex'),
            },
            mac: ethUtil.sha3(`${email}${'maco8wb47q5496q38745'}`).slice(0, 32).toString('hex'),
          },
          version: 3,
        }),
      };
    }
  }

  async queryUnlockReceipt(unlockRequest) {
    try {
      const unlockRequestReceipt = Receipt.parse(unlockRequest);
      const secsFromCreated = Math.floor(Date.now() / 1000) - unlockRequestReceipt.created;
      const account = await this.db.getAccountBySignerAddr(unlockRequestReceipt.signer);

      if (secsFromCreated > 600) {
        throw new BadRequest('Receipt is outdated');
      }

      if (account.proxyAddr !== '0x') {
        const receipt = new Receipt(account.proxyAddr)
                        .unlock(unlockRequestReceipt.newOwner)
                        .sign(this.unlockPriv);
        return receipt;
      }

      throw new BadRequest(`Account with signerAddr = ${unlockRequestReceipt.signer} doesn't exist`);
    } catch (e) {
      throw e;
    }
  }

  async addAccount(accountId,
    email, recapResponse, origin, sourceIp, refCode) {
    if (!uuidRegex.test(accountId)) {
      throw new BadRequest(`passed accountId ${accountId} not uuid v4.`);
    }
    if (!emailRegex.test(email)) {
      throw new BadRequest(`passed email ${email} has invalid format.`);
    }
    if (!refRegex.test(refCode)) {
      throw new BadRequest(`passed refCode ${refCode} has invalid format.`);
    }
    const receipt = new Receipt().createConf(accountId).sign(this.sessionPriv);

    const [referral] = await Promise.all([
      this.db.getRef(refCode),
      this.recaptcha.verify(recapResponse, sourceIp),
    ]);

    const proxyAddr = await this.db.getProxy();

    if (referral.allowance < 1) {
      // 418 - invite limit for this code reached
      throw new Teapot('referral invite limit reached.');
    }

    if (!uuidRegex.test(referral.account)) {
      throw new BadRequest(`passed refCode ${refCode} can not be used for signup.`);
    }

    await this.db.checkAccountConflict(accountId, email);
    await Promise.all([
      this.db.putAccount(
        accountId,
        email.toLowerCase(),
        Array.isArray(referral.account) ? referral.account[0] : referral.account,
        proxyAddr,
      ),
      this.db.deleteProxy(proxyAddr),
      this.db.setRefAllowance(refCode, referral.allowance - 1),
    ]);

    // check we have enough proxies in the pool.
    try {
      await this.checkProxyPoolSize();
    } catch (e) {
      // Do nothing on failure - we don't want this to mess with the business logic
      console.warn(`Proxy pool size check failed: ${e}`);
    }

    return this.email.sendConfirm(email, receipt, origin);
  }

  async checkProxyPoolSize() {
    if (this.slackAlert && this.minProxiesAlertThreshold) {
      const proxiesCount = await this.db.getAvailableProxiesCount();

      if (proxiesCount >= this.minProxiesAlertThreshold) {
        return true;
      }

      const text = `Only ${proxiesCount} spare account proxies available.\n` +
                  'Create some more to prevent failing signups.';
      return this.slackAlert.sendAlert(text);
    }

    return undefined;
  }

  async resetRequest(email, recapResponse, origin, sourceIp) {
    try {
      await this.recaptcha.verify(recapResponse, sourceIp);
      const account = await this.db.getAccountByEmail(email);
      const wallet = JSON.parse(account.wallet);
      const receipt = new Receipt().resetConf(account.id, wallet.address).sign(this.sessionPriv);
      await this.email.sendReset(email, receipt, origin);
    } finally {
      return undefined; // eslint-disable-line
    }
  }

  async setWallet(sessionReceipt, walletStr, proxyAddr) {
    const session = checkSession(sessionReceipt, this.sessionAddr, Type.CREATE_CONF, 2);
    const wallet = checkWallet(walletStr);

    // check pending wallet exists
    const account = await this.getAccount(session.accountId);
    if (account.wallet) {
      throw new Conflict('wallet already set.');
    }
    // if the user brings a proxy, put reserved one back into pool
    const reservedProxy = proxyAddr && account.proxyAddr;
    account.proxyAddr = proxyAddr || account.proxyAddr;

    const promises = [
      this.db.setWallet(session.accountId, walletStr, wallet.address, account.proxyAddr),
      // create ref code
      this.db.putRef(Math.floor(Math.random() * 4294967295).toString(16), session.accountId, 3),
    ];

    if (reservedProxy) {
      promises.push(this.db.addProxy(reservedProxy));
    }

    await Promise.all(promises);

    // notify worker to add account to email newsletter
    return this.notify(`WalletCreated::${wallet.address}`, {
      accountId: account.id,
      email: account.email,
      proxyAddr: account.proxyAddr,
      signerAddr: wallet.address,
      referral: account.referral,
    });
  }

  async resetWallet(sessionReceipt, walletStr) {
    const session = checkSession(sessionReceipt, this.sessionAddr, Type.RESET_CONF, 2);

    const wallet = checkWallet(walletStr);
    if (!isAddress(wallet.address)) {
      throw new BadRequest(`invalid address ${wallet.address} in wallet.`);
    }

    const account = await this.getAccount(session.accountId);
    if (!account.wallet) {
      throw new Conflict('no existing wallet found.');
    }

    const existing = JSON.parse(account.wallet);
    if (existing.address === wallet.address) {
      throw new Conflict('can not reset wallet with same address.');
    }

    // save new wallet
    await this.db.setWallet(session.accountId, walletStr, wallet.address, account.proxyAddr);

    return this.notify(`WalletUpdated::${wallet.address}`, {
      accountId: account.id,
      signerAddr: wallet.address,
    });
  }

  async confirmEmail(sessionReceipt) {
    const session = checkSession(sessionReceipt, this.sessionAddr, Type.CREATE_CONF, 2);
    const account = await this.getAccount(session.accountId);

    // handle email
    if (!account.email) {
      return this.db.updateEmailComplete(session.accountId, account.pendingEmail);
    }

    return true;
  }

  async resendEmail(email, origin) {
    const lastFiveMins = Date.now() - (5 * 60 * 1000);
    try {
      const account = await this.db.getAccountByPendingEmail(email);
      if (new Date(account.updated).getTime() < lastFiveMins) {
        const receipt = new Receipt().createConf(account.id).sign(this.sessionPriv);
        await this.db.touchAccount(account.id);
        return this.email.sendConfirm(account.pendingEmail, receipt, origin);
      }
    } catch (err) {} // eslint-disable-line

    return true;
  }

  async recentRefs(refCode) {
    const lastSevenDays = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const ref = await this.db.getRef(refCode);
    const list = await this.db.getRecentRefs(ref.account, lastSevenDays);
    return list;
  }

  notify(subject, event) {
    return new Promise((fulfill, reject) => {
      this.sns.publish({
        Message: JSON.stringify(event),
        Subject: subject,
        TopicArn: this.topicArn,
      }, (err) => {
        if (err) {
          reject(err);
          return;
        }
        fulfill({});
      });
    });
  }
}

module.exports = AccountManager;
