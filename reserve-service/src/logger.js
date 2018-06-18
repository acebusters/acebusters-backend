
/**
 * Copyright (c) 2017-present, Parsec Labs (parseclabs.org)
 *
 * This source code is licensed under the GNU Affero General Public License,
 * version 3, found in the LICENSE file in the root directory of this source 
 * tree.
 */

export default class Logger {

  constructor(sentry, serverName) {
    this.sentry = sentry;
    this.serverName = serverName;
  }

  log(message, context) {
    return new Promise((fulfill, reject) => {
      const now = Math.floor(Date.now() / 1000);
      this.sentry.captureMessage(
        `${now} - ${message}`,
        {
          level: 'info',
          ...context,
          server_name: this.serverName,
        },
        (error, eventId) => {
          if (error) {
            reject(error);
            return;
          }
          fulfill(eventId);
        },
      );
    });
  }

  exception(e) {
    return new Promise((resolve) => {
      this.sentry.captureException(e, {
        server_name: this.serverName,
      }, (sendErr) => {
        if (sendErr) {
          console.log(JSON.stringify(sendErr)); // eslint-disable-line no-console
          return resolve(sendErr);
        }
        return resolve(e);
      });
    });
  }

}
