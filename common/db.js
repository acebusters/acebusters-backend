import { dbMethod } from './utils';

function dynamoMethod(dynamo, tableName, methodName, params) {
  if (!dynamo || !tableName) {
    throw new Error(`Dynamo instance or tableName is undefined. Table name: ${tableName}`);
  }

  if (methodName !== 'batchGetItem') {
    Object.assign(params, {
      TableName: tableName,
    });
  }

  return dbMethod(dynamo, methodName, params);
}

function sdbMethod(sdb, tableName, methodName, params) {
  if (!sdb || !tableName) {
    throw new Error(`SDB instance or tableName is undefined. Table name: ${tableName}`);
  }

  Object.assign(params, {
    DomainName: tableName,
  });

  return dbMethod(sdb, methodName, params);
}

export class Dynamo {
  constructor(dynamo, tableName) {
    this.dynamo = dynamo;
    this.tableName = tableName;
  }

  query(params) { return dynamoMethod(this.dynamo, this.tableName, 'query', params); }
  putItem(params) { return dynamoMethod(this.dynamo, this.tableName, 'putItem', params); }
  getItem(params) { return dynamoMethod(this.dynamo, this.tableName, 'getItem', params); }
  batchGetItem(params) { return dynamoMethod(this.dynamo, this.tableName, 'batchGetItem', params); }
  updateItem(params) { return dynamoMethod(this.dynamo, this.tableName, 'updateItem', params); }
  deleteItem(params) { return dynamoMethod(this.dynamo, this.tableName, 'deleteItem', params); }
}

export class Sdb {
  constructor(sdb, tableName) {
    this.sdb = sdb;
    this.tableName = tableName;
  }

  putAttributes(params) { return sdbMethod(this.sdb, this.tableName, 'putAttributes', params); }
  select(params) { return sdbMethod(this.sdb, this.tableName, 'select', params); }
  getAttributes(params) { return sdbMethod(this.sdb, this.tableName, 'getAttributes', params); }
  deleteAttributes(params) { return sdbMethod(this.sdb, this.tableName, 'deleteAttributes', params); }
}
