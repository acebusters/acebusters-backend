import Raven from 'raven';

module.exports = class Logger {

  constructor(sentryUrl, serverName, serviceName) {
    Raven.config(sentryUrl).install();
    this.sentry = Raven;
    this.serverName = serverName || serviceName;

    if (process.env.SERVICE_NAME !== serviceName) {
      this.log(`${serviceName} is deployed on ${serverName}, but expected ${process.env.SERVICE_NAME}`, {
        level: 'error',
      });
    }
  }

  log(message, context) {
    return new Promise((resolve) => {
      const now = Math.floor(Date.now() / 1000);
      this.sentry.captureMessage(
        `${now} - ${message}`,
        Object.assign({
          level: 'info',
          server_name: this.serverName,
        }, context),
        (error, eventId) => {
          if (error) {
            // not able to captureMessage, use just console.log
            console.log(message, context);
            resolve(error);
            return;
          }
          resolve(eventId);
        }
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
